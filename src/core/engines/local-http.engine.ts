import {
  TTSError,
  type EngineOptions,
  type LocalHttpConfig,
  type PlaybackRate,
  type VoiceInfo,
} from '../../shared/types';
import type { TTSEngineCapabilities, TTSEngineInterface } from './engine.interface';
import { assertLocalhostEndpoint } from './local-url';

export interface LocalSynthesizeRequest {
  readonly endpointUrl: string;
  readonly protocol: LocalHttpConfig['protocol'];
  readonly text: string;
  readonly voiceId?: string;
  readonly rate: PlaybackRate;
  readonly timeoutMs: number;
}

export interface LocalSynthesizeResponse {
  readonly mimeType: string;
  readonly audioBase64: string;
}

export type LocalHttpTransport = (
  request: LocalSynthesizeRequest
) => Promise<LocalSynthesizeResponse>;

export type AudioPlayerFn = (
  mimeType: string,
  audioBase64: string,
  signal?: AbortSignal
) => Promise<void>;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function defaultPlayAudio(
  mimeType: string,
  audioBase64: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new TTSError('ABORTED', 'Audio playback aborted.');
  }

  const bytes = base64ToUint8Array(audioBase64);
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(objectUrl);
    };

    const onAbort = () => {
      audio.pause();
      cleanup();
      reject(new TTSError('ABORTED', 'Audio playback cancelled.'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new TTSError('SYNTHESIS_FAILED', 'Failed to play audio from local TTS engine.'));
    };

    void audio.play().catch(() => {
      cleanup();
      reject(new TTSError('SYNTHESIS_FAILED', 'Browser blocked local audio playback.'));
    });
  });
}

export class LocalHttpEngine implements TTSEngineInterface {
  public readonly id = 'local-http' as const;
  public readonly capabilities: TTSEngineCapabilities = {
    supportsPauseResume: false,
    supportsLiveRateChange: false,
    maxChunkChars: 420,
  };

  private readonly config: LocalHttpConfig;
  private readonly transport: LocalHttpTransport;
  private readonly playAudio: AudioPlayerFn;
  private currentAbort: AbortController | null = null;

  public constructor(
    config: LocalHttpConfig,
    transport: LocalHttpTransport,
    playAudio: AudioPlayerFn = defaultPlayAudio
  ) {
    this.config = config;
    this.transport = transport;
    this.playAudio = playAudio;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      assertLocalhostEndpoint(this.config.endpointUrl);
      return true;
    } catch {
      return false;
    }
  }

  public async getVoices(): Promise<readonly VoiceInfo[]> {
    return [
      {
        id: 'default',
        name: `Local ${this.config.protocol === 'kokoro-openai' ? 'Kokoro' : 'Piper'} Default`,
        lang: 'mul',
        isLocal: true,
        isDefault: true,
        engine: 'local-http',
      },
    ];
  }

  public async speak(text: string, options: EngineOptions): Promise<void> {
    const validatedUrl = assertLocalhostEndpoint(this.config.endpointUrl);

    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Local synthesis aborted before start.');
    }

    const controller = new AbortController();
    this.currentAbort = controller;
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await this.transport({
        endpointUrl: validatedUrl.toString(),
        protocol: this.config.protocol,
        text,
        voiceId: options.voiceId,
        rate: options.rate,
        timeoutMs: this.config.timeoutMs,
      });

      if (controller.signal.aborted) {
        throw new TTSError('ABORTED', 'Local synthesis cancelled.');
      }

      await this.playAudio(response.mimeType, response.audioBase64, options.signal);
    } finally {
      options.signal?.removeEventListener('abort', onParentAbort);
      if (this.currentAbort === controller) {
        this.currentAbort = null;
      }
    }
  }

  public pause(): void {
    // Pause is unsupported on stateless local audio chunks; stop() cancels cleanly.
  }

  public resume(): void {
    // Resume is unsupported on stateless local audio chunks.
  }

  public stop(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
  }

  public dispose(): void {
    this.stop();
  }
}
