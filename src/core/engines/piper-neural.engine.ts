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
  signal?: AbortSignal,
  preDecodedBuffer?: AudioBuffer
) => AudioPlaybackHandle;

interface PreparedNeuralAudio {
  readonly response: NeuralSynthesizeResponse;
  readonly decodedBuffer?: AudioBuffer;
}

const MAX_PREFETCH_ENTRIES = 4;

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

class SharedWebAudioPool {
  private ctx: AudioContext | null = null;

  public getContext(): AudioContext | null {
    const AudioCtx = getAudioContextCtor();
    if (!AudioCtx) {
      return null;
    }
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  public async tryPreDecode(audioBase64: string): Promise<AudioBuffer | undefined> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') {
      return undefined;
    }
    try {
      const rawBuffer = decodeBase64ToArrayBuffer(audioBase64);
      return await ctx.decodeAudioData(rawBuffer.slice(0));
    } catch {
      return undefined;
    }
  }

  public createPlayer(
    audioBase64: string,
    initialRate: PlaybackRate,
    signal?: AbortSignal,
    preDecodedBuffer?: AudioBuffer,
    synthesizedRate: PlaybackRate = initialRate
  ): AudioPlaybackHandle {
    let source: AudioBufferSourceNode | null = null;
    let activeCtx: AudioContext | null = null;
    let settled = false;
    let stopped = false;
    let currentPlaybackFactor = initialRate / synthesizedRate;
    let rejectFn: ((err: unknown) => void) | null = null;

    const cleanupSource = () => {
      if (source) {
        source.onended = null;
        try {
          source.disconnect();
        } catch {
          // Ignore disconnect on already-stopped node.
        }
        source = null;
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
      cleanupSource();
      if (!settled && rejectFn) {
        settled = true;
        rejectFn(new TTSError('ABORTED', 'Neural playback cancelled.'));
      }
    };

    return {
      play: (): Promise<void> => {
        if (signal?.aborted || stopped) {
          return Promise.reject(new TTSError('ABORTED', 'Neural playback aborted.'));
        }
        const ctx = this.getContext();
        if (!ctx) {
          return Promise.reject(new TTSError('ENGINE_UNAVAILABLE', 'Web Audio API unavailable.'));
        }
        activeCtx = ctx;

        return new Promise<void>((resolve, reject) => {
          rejectFn = reject;
          const onAbort = () => abortNow();
          signal?.addEventListener('abort', onAbort, { once: true });

          const finish = (err?: unknown) => {
            signal?.removeEventListener('abort', onAbort);
            if (settled) return;
            settled = true;
            cleanupSource();
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          };

          void (async () => {
            try {
              const decoded =
                preDecodedBuffer ??
                (await ctx.decodeAudioData(decodeBase64ToArrayBuffer(audioBase64).slice(0)));

              if (signal?.aborted || stopped || ctx.state === 'closed') {
                finish(new TTSError('ABORTED', 'Neural playback cancelled.'));
                return;
              }

              source = ctx.createBufferSource();
              source.buffer = decoded;
              source.playbackRate.value = currentPlaybackFactor;
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
        if (activeCtx && activeCtx.state === 'running') {
          void activeCtx.suspend().catch(() => undefined);
        }
      },

      resume(): void {
        if (activeCtx && activeCtx.state === 'suspended') {
          void activeCtx.resume().catch(() => undefined);
        }
      },

      stop(): void {
        abortNow();
      },

      setRate(rate: PlaybackRate): void {
        currentPlaybackFactor = rate / synthesizedRate;
        if (source) {
          source.playbackRate.value = currentPlaybackFactor;
        }
      },
    };
  }

  public dispose(): void {
    if (this.ctx) {
      const closing = this.ctx;
      this.ctx = null;
      void closing.close().catch(() => undefined);
    }
  }
}

export class PiperNeuralEngine implements TTSEngineInterface {
  public readonly id = 'piper-neural' as const;
  public readonly capabilities: TTSEngineCapabilities = {
    supportsPauseResume: true,
    supportsLiveRateChange: true,
    maxChunkChars: 175,
    streamingFirstChunkChars: 48,
  };

  private readonly transport: NeuralTransport;
  private readonly customPlayerFactory?: AudioPlayerFactory;
  private readonly cancelTransport?: () => void;
  private readonly audioPool = new SharedWebAudioPool();
  private readonly prefetchCache = new Map<string, Promise<PreparedNeuralAudio>>();
  private activePlayer: AudioPlaybackHandle | null = null;

  public constructor(
    transport: NeuralTransport,
    createPlayer?: AudioPlayerFactory,
    cancelTransport?: () => void
  ) {
    this.transport = transport;
    this.customPlayerFactory = createPlayer;
    this.cancelTransport = cancelTransport;
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
    const key = `${voiceId}::${options.rate}::${trimmed}`;
    if (this.prefetchCache.has(key)) return;

    if (this.prefetchCache.size >= MAX_PREFETCH_ENTRIES) {
      const oldestKey = this.prefetchCache.keys().next().value;
      if (oldestKey) this.prefetchCache.delete(oldestKey);
    }

    const preparedPromise: Promise<PreparedNeuralAudio> = this.transport({
      text: trimmed,
      lang: options.lang,
      voiceId,
      rate: options.rate,
    }).then(async (response) => {
      // Pre-decode WAV into AudioBuffer while previous chunk is still speaking for gapless handoff.
      const decodedBuffer = this.customPlayerFactory
        ? undefined
        : await this.audioPool.tryPreDecode(response.audioBase64);
      return { response, decodedBuffer };
    });

    preparedPromise.catch(() => {
      this.prefetchCache.delete(key);
    });
    this.prefetchCache.set(key, preparedPromise);
  }

  public async speak(text: string, options: EngineOptions): Promise<void> {
    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Neural playback aborted before start.');
    }

    const trimmed = text.trim();
    const voiceId = options.voiceId || resolvePiperVoiceForLang(options.lang, {}).id;
    const cacheKey = `${voiceId}::${options.rate}::${trimmed}`;

    options.onProgress?.('Preparando voz neuronal...');

    let preparedPromise = this.prefetchCache.get(cacheKey);
    if (preparedPromise) {
      this.prefetchCache.delete(cacheKey);
    } else {
      // Start synthesis synchronously before first await so chunk 0 always leads lookahead prefetches.
      preparedPromise = this.transport({
        text: trimmed,
        lang: options.lang,
        voiceId,
        rate: options.rate,
      }).then((response) => ({ response }));
    }

    const prepared = await preparedPromise;

    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Neural playback cancelled.');
    }

    const player = this.customPlayerFactory
      ? this.customPlayerFactory(
          prepared.response.audioBase64,
          options.rate,
          options.signal,
          prepared.decodedBuffer
        )
      : this.audioPool.createPlayer(
          prepared.response.audioBase64,
          options.rate,
          options.signal,
          prepared.decodedBuffer
        );

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
    this.cancelTransport?.();
  }

  public dispose(): void {
    this.stop();
    this.audioPool.dispose();
  }
}
