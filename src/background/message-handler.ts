import { assertLocalhostEndpoint } from '../core/engines/local-url';
import { TTSError, type ExtensionMessage, type MessageResult } from '../shared/types';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB safety ceiling
const DEFAULT_TIMEOUT_MS = 15_000;

export interface DetectLanguageApiResult {
  readonly isReliable: boolean;
  readonly languages: ReadonlyArray<{ readonly language: string; readonly percentage: number }>;
}

export interface MessageHandlerDeps {
  readonly runtimeId: string;
  readonly detectLanguage?: (text: string) => Promise<DetectLanguageApiResult>;
  readonly fetchFn?: typeof fetch;
}

export interface MessageSenderLike {
  readonly id?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function handleRuntimeMessage(
  rawMessage: unknown,
  sender: MessageSenderLike | undefined,
  deps: MessageHandlerDeps
): Promise<MessageResult<unknown>> {
  if (!sender || sender.id !== deps.runtimeId) {
    return {
      ok: false,
      code: 'UNAUTHORIZED_SENDER',
      message: 'Message rejected: unauthorized sender.',
    };
  }

  if (!isRecord(rawMessage) || typeof rawMessage.type !== 'string') {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: 'Malformed runtime message.',
    };
  }

  const message = rawMessage as ExtensionMessage;

  if (message.type === 'DETECT_LANGUAGE') {
    const text = typeof message.payload?.text === 'string' ? message.payload.text.slice(0, 1000) : '';
    if (!text.trim() || !deps.detectLanguage) {
      return { ok: true, data: { lang: '', confidence: 0, isReliable: false } };
    }
    try {
      const result = await deps.detectLanguage(text);
      const top = result.languages[0];
      return {
        ok: true,
        data: {
          lang: top?.language ?? '',
          confidence: top?.percentage ?? 0,
          isReliable: Boolean(result.isReliable && top),
        },
      };
    } catch {
      return { ok: false, code: 'DETECT_FAILED', message: 'Language detection failed.' };
    }
  }

  if (message.type === 'LOCAL_TTS_SYNTHESIZE') {
    return handleLocalSynthesize(message.payload, deps.fetchFn ?? fetch);
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_MESSAGE',
    message: `Unsupported background message type: ${message.type}`,
  };
}

async function handleLocalSynthesize(
  payload: Extract<ExtensionMessage, { type: 'LOCAL_TTS_SYNTHESIZE' }>['payload'],
  fetchFn: typeof fetch
): Promise<MessageResult<{ readonly mimeType: string; readonly audioBase64: string }>> {
  let validatedUrl: URL;
  try {
    validatedUrl = assertLocalhostEndpoint(payload.endpointUrl);
  } catch (err) {
    const code = err instanceof TTSError ? err.code : 'INVALID_ENDPOINT';
    const msg = err instanceof Error ? err.message : 'Invalid local TTS endpoint.';
    return { ok: false, code, message: msg };
  }

  const timeoutMs =
    typeof payload.timeoutMs === 'number' && payload.timeoutMs >= 1_000
      ? Math.min(payload.timeoutMs, 60_000)
      : DEFAULT_TIMEOUT_MS;

  const body =
    payload.protocol === 'kokoro-openai'
      ? JSON.stringify({
          model: 'kokoro',
          input: payload.text,
          voice: payload.voiceId || 'af_heart',
          speed: payload.rate,
          response_format: 'wav',
        })
      : JSON.stringify({
          text: payload.text,
          voice: payload.voiceId,
          length_scale: Number((1 / payload.rate).toFixed(3)),
        });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(validatedUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        code: 'SYNTHESIS_FAILED',
        message: `Local TTS server returned HTTP ${response.status}.`,
      };
    }

    const contentType = (response.headers.get('content-type') || 'audio/wav').split(';')[0]?.trim() || 'audio/wav';
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      return {
        ok: false,
        code: 'SYNTHESIS_FAILED',
        message: `Unexpected content-type from local TTS server: ${contentType}`,
      };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        code: 'SYNTHESIS_FAILED',
        message: 'Local TTS audio response is empty or exceeds 10 MB limit.',
      };
    }

    return {
      ok: true,
      data: {
        mimeType: contentType === 'application/octet-stream' ? 'audio/wav' : contentType,
        audioBase64: arrayBufferToBase64(buffer),
      },
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      code: isAbort ? 'TIMEOUT' : 'NETWORK_BLOCKED',
      message: isAbort
        ? 'Local TTS request timed out.'
        : 'Could not reach local TTS server. Verify Piper/Kokoro is running on localhost.',
    };
  } finally {
    clearTimeout(timer);
  }
}
