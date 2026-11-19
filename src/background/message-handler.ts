import { assertLocalhostEndpoint } from '../core/engines/local-url';
import { findPiperVoiceById, resolvePiperVoiceForLang } from '../core/neural/piper-voices';
import { isHostBlocked } from '../shared/storage';
import {
  TTSError,
  type ExtensionMessage,
  type ExtensionSettings,
  type LocalHttpProtocol,
  type MessageResult,
} from '../shared/types';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB safety ceiling
const DEFAULT_TIMEOUT_MS = 15_000;

export interface DetectLanguageApiResult {
  readonly isReliable: boolean;
  readonly languages: ReadonlyArray<{ readonly language: string; readonly percentage: number }>;
}

export interface MessageHandlerDeps {
  readonly runtimeId: string;
  readonly detectLanguage?: (text: string) => Promise<DetectLanguageApiResult>;
  readonly getSettings?: () => Promise<ExtensionSettings>;
  readonly synthesizeNeural?: (request: {
    readonly text: string;
    readonly voiceId: string;
  }) => Promise<{ readonly mimeType: string; readonly audioBase64: string }>;
  readonly warmupNeural?: (voiceId: string) => Promise<void>;
  readonly fetchFn?: typeof fetch;
}

export interface MessageSenderLike {
  readonly id?: string;
  readonly tab?: { readonly url?: string };
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

function extractSenderHostname(sender: MessageSenderLike): string {
  const url = sender.tab?.url;
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
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
    const payload = isRecord(message.payload) ? message.payload : null;
    const text = typeof payload?.text === 'string' ? payload.text.slice(0, 1000) : '';
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

  if (message.type === 'NEURAL_TTS_SYNTHESIZE') {
    return handleNeuralSynthesize(message.payload, sender, deps);
  }

  if (message.type === 'NEURAL_TTS_WARMUP') {
    return handleNeuralWarmup(message.payload, sender, deps);
  }

  if (message.type === 'LOCAL_TTS_SYNTHESIZE') {
    return handleLocalSynthesize(message.payload, sender, deps);
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_MESSAGE',
    message: `Unsupported background message type: ${message.type}`,
  };
}

async function handleNeuralSynthesize(
  rawPayload: unknown,
  sender: MessageSenderLike,
  deps: MessageHandlerDeps
): Promise<MessageResult<{ readonly mimeType: string; readonly audioBase64: string }>> {
  if (!isRecord(rawPayload)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Missing neural synthesis payload.' };
  }

  const text = typeof rawPayload.text === 'string' ? rawPayload.text.trim().slice(0, 1200) : '';
  const lang = typeof rawPayload.lang === 'string' ? rawPayload.lang : 'es';
  const requestedVoiceId = typeof rawPayload.voiceId === 'string' ? rawPayload.voiceId : '';

  if (!text) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Empty text cannot be synthesized.' };
  }

  if (!deps.synthesizeNeural) {
    return {
      ok: false,
      code: 'ENGINE_UNAVAILABLE',
      message: 'Neural TTS runtime is unavailable in this environment.',
    };
  }

  let voicePrefs: Readonly<Record<string, string>> = {};
  if (deps.getSettings) {
    const settings = await deps.getSettings();
    const senderHost = extractSenderHostname(sender);
    if (!settings.enabled || settings.engine !== 'piper-neural') {
      return {
        ok: false,
        code: 'ENGINE_UNAVAILABLE',
        message: 'Neural TTS engine is disabled in extension settings.',
      };
    }
    if (senderHost && isHostBlocked(senderHost, settings.blockedDomains)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_SENDER',
        message: 'Neural TTS is blocked for this domain.',
      };
    }
    voicePrefs = settings.voicePreferences;
  }

  const resolvedVoice =
    (requestedVoiceId ? findPiperVoiceById(requestedVoiceId) : undefined) ??
    resolvePiperVoiceForLang(lang, voicePrefs);

  try {
    const data = await deps.synthesizeNeural({
      text,
      voiceId: resolvedVoice.id,
    });
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      code: 'SYNTHESIS_FAILED',
      message: err instanceof Error ? err.message : 'Neural TTS synthesis failed.',
    };
  }
}

async function handleNeuralWarmup(
  rawPayload: unknown,
  sender: MessageSenderLike,
  deps: MessageHandlerDeps
): Promise<MessageResult<{ readonly voiceId: string }>> {
  if (!isRecord(rawPayload)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Missing neural warmup payload.' };
  }

  if (!deps.warmupNeural) {
    return { ok: true, data: { voiceId: '' } };
  }

  const lang = typeof rawPayload.lang === 'string' ? rawPayload.lang : 'es';
  const requestedVoiceId = typeof rawPayload.voiceId === 'string' ? rawPayload.voiceId : '';

  let voicePrefs: Readonly<Record<string, string>> = {};
  if (deps.getSettings) {
    const settings = await deps.getSettings();
    const senderHost = extractSenderHostname(sender);
    if (!settings.enabled || settings.engine !== 'piper-neural') {
      return {
        ok: false,
        code: 'ENGINE_UNAVAILABLE',
        message: 'Neural TTS engine is disabled in extension settings.',
      };
    }
    if (senderHost && isHostBlocked(senderHost, settings.blockedDomains)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_SENDER',
        message: 'Neural TTS is blocked for this domain.',
      };
    }
    voicePrefs = settings.voicePreferences;
  }

  const resolvedVoice =
    (requestedVoiceId ? findPiperVoiceById(requestedVoiceId) : undefined) ??
    resolvePiperVoiceForLang(lang, voicePrefs);

  try {
    await deps.warmupNeural(resolvedVoice.id);
    return { ok: true, data: { voiceId: resolvedVoice.id } };
  } catch (err) {
    return {
      ok: false,
      code: 'SYNTHESIS_FAILED',
      message: err instanceof Error ? err.message : 'Neural TTS warmup failed.',
    };
  }
}

async function handleLocalSynthesize(
  rawPayload: unknown,
  sender: MessageSenderLike,
  deps: MessageHandlerDeps
): Promise<MessageResult<{ readonly mimeType: string; readonly audioBase64: string }>> {
  if (!isRecord(rawPayload)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Missing synthesis payload.' };
  }

  const text = typeof rawPayload.text === 'string' ? rawPayload.text.trim() : '';
  const rate = typeof rawPayload.rate === 'number' ? rawPayload.rate : NaN;
  const voiceId = typeof rawPayload.voiceId === 'string' ? rawPayload.voiceId : undefined;

  if (!text || !Number.isFinite(rate) || rate < 0.25 || rate > 4) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: 'Synthesis payload requires non-empty text and valid playback rate.',
    };
  }

  // Prefer trusted extension settings when available (blocks compromised content script SSRF).
  let endpointUrl: string;
  let protocol: LocalHttpProtocol;
  let timeoutMs: number;

  if (deps.getSettings) {
    const settings = await deps.getSettings();
    const senderHost = extractSenderHostname(sender);
    if (!settings.enabled || settings.engine !== 'local-http') {
      return {
        ok: false,
        code: 'ENGINE_UNAVAILABLE',
        message: 'Local HTTP TTS engine is disabled in extension settings.',
      };
    }
    if (senderHost && isHostBlocked(senderHost, settings.blockedDomains)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED_SENDER',
        message: 'Local TTS is blocked for this domain.',
      };
    }
    endpointUrl = settings.localHttp.endpointUrl;
    protocol = settings.localHttp.protocol;
    timeoutMs = settings.localHttp.timeoutMs;
  } else {
    endpointUrl = typeof rawPayload.endpointUrl === 'string' ? rawPayload.endpointUrl : '';
    protocol = rawPayload.protocol === 'kokoro-openai' ? 'kokoro-openai' : 'piper';
    timeoutMs =
      typeof rawPayload.timeoutMs === 'number' && rawPayload.timeoutMs >= 1_000
        ? Math.min(rawPayload.timeoutMs, 60_000)
        : DEFAULT_TIMEOUT_MS;
  }

  let validatedUrl: URL;
  try {
    validatedUrl = assertLocalhostEndpoint(endpointUrl);
  } catch (err) {
    const code = err instanceof TTSError ? err.code : 'INVALID_ENDPOINT';
    const msg = err instanceof Error ? err.message : 'Invalid local TTS endpoint.';
    return { ok: false, code, message: msg };
  }

  const effectiveTimeout = Math.min(Math.max(timeoutMs, 1_000), 60_000);
  const body =
    protocol === 'kokoro-openai'
      ? JSON.stringify({
          model: 'kokoro',
          input: text,
          voice: voiceId || 'af_heart',
          speed: rate,
          response_format: 'wav',
        })
      : JSON.stringify({
          text,
          voice: voiceId,
          length_scale: Number((1 / rate).toFixed(3)),
        });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const fetchFn = deps.fetchFn ?? fetch;
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

    const contentType =
      (response.headers.get('content-type') || 'audio/wav').split(';')[0]?.trim() || 'audio/wav';
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
