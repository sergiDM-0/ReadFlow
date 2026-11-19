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
const HTML_AUDIO_UNSUPPORTED_ERR = 'HTML_AUDIO_BLOCKED';

function decodeBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

function canUseHtmlAudio(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.Audio === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

function applyPitchPreservingRate(audio: HTMLAudioElement, rate: PlaybackRate): void {
  const extended = audio as HTMLAudioElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  extended.preservesPitch = true;
  extended.mozPreservesPitch = true;
  extended.webkitPreservesPitch = true;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
}

function createHtmlAudioPlayer(
  audioBase64: string,
  initialRate: PlaybackRate,
  signal?: AbortSignal
): AudioPlaybackHandle {
  let audio: HTMLAudioElement | null = null;
  let blobUrl: string | null = null;
  let settled = false;
  let stopped = false;
  let started = false;
  let currentRate = initialRate;
  let rejectFn: ((err: unknown) => void) | null = null;

  const cleanup = () => {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.src = '';
      } catch {
        // Ignore teardown errors on detached media element.
      }
      audio = null;
    }
    if (blobUrl) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Ignore revoke errors in synthetic environments.
      }
      blobUrl = null;
    }
  };

  const abortNow = () => {
    stopped = true;
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
      if (!canUseHtmlAudio()) {
        return Promise.reject(new Error(HTML_AUDIO_UNSUPPORTED_ERR));
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

        try {
          const bytes = decodeBase64ToUint8Array(audioBase64);
          blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
          audio = new window.Audio(blobUrl);
          applyPitchPreservingRate(audio, currentRate);

          audio.onended = () => finish();
          audio.onerror = () => {
            if (!started) {
              finish(new Error(HTML_AUDIO_UNSUPPORTED_ERR));
            } else {
              finish(new TTSError('SYNTHESIS_FAILED', 'Neural audio playback error.'));
            }
          };

          const playResult = audio.play();
          if (playResult && typeof playResult.then === 'function') {
            playResult
              .then(() => {
                if (signal?.aborted || stopped) {
                  finish(new TTSError('ABORTED', 'Neural playback cancelled.'));
                  return;
                }
                started = true;
                if (audio) {
                  applyPitchPreservingRate(audio, currentRate);
                }
              })
              .catch(() => {
                finish(new Error(HTML_AUDIO_UNSUPPORTED_ERR));
              });
          } else {
            started = true;
          }
        } catch {
          finish(new Error(HTML_AUDIO_UNSUPPORTED_ERR));
        }
      });
    },

    pause(): void {
      if (audio && !audio.paused) {
        try {
          audio.pause();
        } catch {
          // Ignore pause errors.
        }
      }
    },

    resume(): void {
      if (audio && audio.paused && !stopped) {
        applyPitchPreservingRate(audio, currentRate);
        void audio.play().catch(() => undefined);
      }
    },

    stop(): void {
      abortNow();
    },

    setRate(rate: PlaybackRate): void {
      currentRate = rate;
      if (audio) {
        try {
          applyPitchPreservingRate(audio, rate);
        } catch {
          // Ignore out-of-range rate errors in synthetic DOM.
        }
      }
    },
  };
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
      const rawBuffer = decodeBase64ToUint8Array(audioBase64).buffer;
      return await ctx.decodeAudioData(rawBuffer.slice(0));
    } catch {
      return undefined;
    }
  }

  public createPlayer(
    audioBase64: string,
    initialRate: PlaybackRate,
    signal?: AbortSignal,
    preDecodedBuffer?: AudioBuffer
  ): AudioPlaybackHandle {
    let source: AudioBufferSourceNode | null = null;
    let activeCtx: AudioContext | null = null;
    let settled = false;
    let stopped = false;
    let currentRate = initialRate;
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
                (await ctx.decodeAudioData(decodeBase64ToUint8Array(audioBase64).buffer.slice(0)));

              if (signal?.aborted || stopped || ctx.state === 'closed') {
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
        currentRate = rate;
        if (source) {
          source.playbackRate.value = rate;
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
  private currentRate: PlaybackRate = 1;
  private preferWebAudio = false;

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
    // Rate-independent prefetch key: changing speed never invalidates pre-synthesized chunks.
    const key = `${voiceId}::${trimmed}`;
    if (this.prefetchCache.has(key)) return;

    if (this.prefetchCache.size >= MAX_PREFETCH_ENTRIES) {
      const oldestKey = this.prefetchCache.keys().next().value;
      if (oldestKey) this.prefetchCache.delete(oldestKey);
    }

    const preparedPromise: Promise<PreparedNeuralAudio> = this.transport({
      text: trimmed,
      lang: options.lang,
      voiceId,
      rate: 1,
    }).then(async (response) => {
      const decodedBuffer =
        !this.customPlayerFactory && this.preferWebAudio
          ? await this.audioPool.tryPreDecode(response.audioBase64)
          : undefined;
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
    const cacheKey = `${voiceId}::${trimmed}`;
    this.currentRate = options.rate;

    options.onProgress?.('Preparando voz neuronal...');

    let preparedPromise = this.prefetchCache.get(cacheKey);
    if (preparedPromise) {
      this.prefetchCache.delete(cacheKey);
    } else {
      preparedPromise = this.transport({
        text: trimmed,
        lang: options.lang,
        voiceId,
        rate: 1,
      }).then((response) => ({ response }));
    }

    const prepared = await preparedPromise;

    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Neural playback cancelled.');
    }

    const effectiveRate = this.currentRate;

    if (this.customPlayerFactory) {
      const player = this.customPlayerFactory(
        prepared.response.audioBase64,
        effectiveRate,
        options.signal,
        prepared.decodedBuffer
      );
      await this.runPlayer(player, options.onPlaying);
      return;
    }

    // Prefer HTMLAudioElement with preservesPitch=true so speed changes keep the exact natural voice.
    // Automatically fall back to persistent Web Audio API if a host page's CSP blocks blob: media.
    if (!this.preferWebAudio && canUseHtmlAudio()) {
      const htmlPlayer = createHtmlAudioPlayer(
        prepared.response.audioBase64,
        effectiveRate,
        options.signal
      );
      try {
        await this.runPlayer(htmlPlayer, options.onPlaying);
        return;
      } catch (err) {
        if (err instanceof Error && err.message === HTML_AUDIO_UNSUPPORTED_ERR) {
          this.preferWebAudio = true;
        } else {
          throw err;
        }
      }
    }

    if (options.signal?.aborted) {
      throw new TTSError('ABORTED', 'Neural playback cancelled.');
    }

    const webAudioPlayer = this.audioPool.createPlayer(
      prepared.response.audioBase64,
      this.currentRate,
      options.signal,
      prepared.decodedBuffer
    );
    await this.runPlayer(webAudioPlayer, options.onPlaying);
  }

  public setPlaybackRate(rate: PlaybackRate): void {
    this.currentRate = rate;
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

  private async runPlayer(player: AudioPlaybackHandle, onPlaying?: () => void): Promise<void> {
    this.activePlayer = player;
    onPlaying?.();
    try {
      await player.play();
    } finally {
      if (this.activePlayer === player) {
        this.activePlayer = null;
      }
    }
  }
}
