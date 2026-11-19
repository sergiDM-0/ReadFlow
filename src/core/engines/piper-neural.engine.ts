import {
  TTSError,
  type EngineOptions,
  type PlaybackRate,
  type VoiceInfo,
} from '../../shared/types';
import { PIPER_NEURAL_VOICES, resolvePiperVoiceForLang } from '../neural/piper-voices';
import type { TTSEngineCapabilities, TTSEngineInterface } from './engine.interface';

export interface NeuralSynthesizeRequest {
  readonly text: string;
  readonly lang: string;
  readonly voiceId: string;
  readonly rate: PlaybackRate;
}

export interface NeuralSynthesizeResponse {
  readonly mimeType: string;
  readonly audioBase64: string;
}

export type NeuralTransport = (
  request: NeuralSynthesizeRequest
) => Promise<NeuralSynthesizeResponse>;

export interface AudioPlaybackHandle {
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: PlaybackRate): void;
}

export type AudioPlayerFactory = (
  audioBase64: string,
  rate: PlaybackRate,
  signal?: AbortSignal
) => AudioPlaybackHandle;

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function createWebAudioPlayer(
  audioBase64: string,
  initialRate: PlaybackRate,
  signal?: AbortSignal
): AudioPlaybackHandle {
  const AudioCtx =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;

  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let settled = false;
  let stopped = false;
  let currentRate = initialRate;
  let rejectFn: ((err: unknown) => void) | null = null;

  const cleanup = () => {
    if (source) {
      source.onended = null;
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect on already-stopped node.
      }
      source = null;
    }
    if (ctx) {
      const closing = ctx;
      ctx = null;
      void closing.close().catch(() => undefined);
    }
  };

  const abortNow = () => {
    stopped = true;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Ignore stop on unstarted node.
      }
    }
    cleanup();
    if (!settled && rejectFn) {
      settled = true;
      rejectFn(new TTSError('ABORTED', 'Neural playback cancelled.'));
    }
  };

  return {
    play(): Promise<void> {
      if (signal?.aborted || stopped) {
        return Promise.reject(new TTSError('ABORTED', 'Neural playback aborted.'));
      }
      if (!AudioCtx) {
        return Promise.reject(new TTSError('ENGINE_UNAVAILABLE', 'Web Audio API unavailable.'));
      }

      return new Promise<void>((resolve, reject) => {
        rejectFn = reject;
        const onAbort = () => abortNow();
        signal?.addEventListener('abort', onAbort, { once: true });

        const finish = (err?: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          cleanup();
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        };

        void (async () => {
          try {
            ctx = new AudioCtx();
            const rawBuffer = decodeBase64ToArrayBuffer(audioBase64);
            const decoded = await ctx.decodeAudioData(rawBuffer.slice(0));

            if (signal?.aborted || stopped || !ctx) {
              finish(new TTSError('ABORTED', 'Neural playback cancelled.'));
              return;
            }

            source = ctx.createBufferSource();
            source.buffer = decoded;
            source.playbackRate.value = currentRate;
            source.connect(ctx.destination);
            source.onended = () => finish();

            if (ctx.state === 'suspended') {
              await ctx.resume();
            }
            source.start(0);
          } catch (err) {
            finish(
              err instanceof TTSError
                ? err
                : new TTSError('SYNTHESIS_FAILED', 'Failed to decode neural audio.')
            );
          }
        })();
      });
    },

    pause(): void {
      if (ctx && ctx.state === 'running') {
        void ctx.suspend().catch(() => undefined);
      }
    },

    resume(): void {
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    },

    stop(): void {
      abortNow();
    },

    setRate(rate: PlaybackRate): void {
      currentRate = rate;
      if (source) {
        source.playbackRate.value = rate;
      }
    },
  };
}

export class PiperNeuralEngine implements TTSEngineInterface {
  public readonly id = 'piper-neural' as const;
  public readonly capabilities: TTSEngineCapabilities = {
    supportsPauseResume: true,
    supportsLiveRateChange: true,
    maxChunkChars: 360,
  };

  private readonly transport: NeuralTransport;
  private readonly createPlayer: AudioPlayerFactory;
  private readonly prefetchCache = new Map<string, Promise<NeuralSynthesizeResponse>>();
  private activePlayer: AudioPlaybackHandle | null = null;

  public constructor(
    transport: NeuralTransport,
    createPlayer: AudioPlayerFactory = createWebAudioPlayer
  ) {
    this.transport = transport;
    this.createPlayer = createPlayer;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async getVoices(): Promise<readonly VoiceInfo[]> {
    return PIPER_NEURAL_VOICES;
  }

  public prefetch(text: string, options: EngineOptions): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const voiceId = options.voiceId || resolvePiperVoiceForLang(options.lang, {}).id;
    const key = `${voiceId}::${trimmed}`;
    if (this.prefetchCache.has(key)) return;

    // Keep cache bounded to 3 upcoming sentences to avoid memory growth.
    if (this.prefetchCache.size >= 3) {
      const oldestKey = this.prefetchCache.keys().next().value;
      if (oldestKey) this.prefetchCache.delete(oldestKey);
    }

    const reqPromise = this.transport({
      text: trimmed,
      lang: options.lang,
      voiceId,
      rate: options.rate,
    });
    reqPromise.catch(() => {
      this.prefetchCache.delete(key);
    });
    this.prefetchCache.set(key, reqPromise);
  }

  public async speak(text: string, options: EngineOptions): Promise<void> {
    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Neural playback aborted before start.');
    }

    const trimmed = text.trim();
    const voiceId = options.voiceId || resolvePiperVoiceForLang(options.lang, {}).id;
    const cacheKey = `${voiceId}::${trimmed}`;

    options.onProgress?.('Preparando voz neuronal...');

    let responsePromise = this.prefetchCache.get(cacheKey);
    if (responsePromise) {
      this.prefetchCache.delete(cacheKey);
    } else {
      responsePromise = this.transport({
        text: trimmed,
        lang: options.lang,
        voiceId,
        rate: options.rate,
      });
    }

    const response = await responsePromise;

    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Neural playback cancelled.');
    }

    const player = this.createPlayer(response.audioBase64, options.rate, options.signal);
    this.activePlayer = player;
    options.onPlaying?.();
    try {
      await player.play();
    } finally {
      if (this.activePlayer === player) {
        this.activePlayer = null;
      }
    }
  }

  public setPlaybackRate(rate: PlaybackRate): void {
    this.activePlayer?.setRate(rate);
  }

  public pause(): void {
    this.activePlayer?.pause();
  }

  public resume(): void {
    this.activePlayer?.resume();
  }

  public stop(): void {
    this.activePlayer?.stop();
    this.activePlayer = null;
    this.prefetchCache.clear();
  }

  public dispose(): void {
    this.stop();
  }
}
