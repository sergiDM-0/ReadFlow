import { TTSError } from '../../shared/types';

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Validates that `rawUrl` is a strict `http://` loopback endpoint (`localhost`, `127.0.0.1`, `[::1]`)
 * with no embedded credentials, preventing SSRF and data exfiltration.
 * @throws {TTSError} With code `'INVALID_ENDPOINT'` if validation fails.
 */
export function assertLocalhostEndpoint(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new TTSError('INVALID_ENDPOINT', 'Local TTS endpoint must be a valid HTTP URL.');
  }

  if (parsed.protocol !== 'http:') {
    throw new TTSError('INVALID_ENDPOINT', 'Local TTS endpoint must use http:// on localhost.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new TTSError(
      'INVALID_ENDPOINT',
      'Credentials are not permitted in the local endpoint URL.'
    );
  }

  if (!ALLOWED_LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new TTSError(
      'INVALID_ENDPOINT',
      'Endpoint must target loopback only (localhost, 127.0.0.1, or [::1]).'
    );
  }

  return parsed;
}
