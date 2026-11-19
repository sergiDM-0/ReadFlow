import { TTSError, type EngineOptions, type VoiceInfo } from '../../shared/types';
import type { TTSEngineCapabilities, TTSEngineInterface } from './engine.interface';

const VOICES_TIMEOUT_MS = 1_000;
const KEEPALIVE_INTERVAL_MS = 10_000;

function detectLinuxPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent ?? '';
  const platform = navigator.platform ?? '';
  return /linux/i.test(ua) || /linux/i.test(platform);
}

export class WebSpeechEngine implements TTSEngineInterface {
  public readonly id = 'web-speech' as const;
  public readonly capabilities: TTSEngineCapabilities;

  private readonly synth: SpeechSynthesis | null;
  private readonly UtteranceCtor: typeof SpeechSynthesisUtterance | null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private activeAbort: (() => void) | null = null;

  public constructor(
    synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null,
    UtteranceCtor: typeof SpeechSynthesisUtterance | null = typeof SpeechSynthesisUtterance !==
    'undefined'
      ? SpeechSynthesisUtterance
      : null,
    isLinux: boolean = detectLinuxPlatform()
  ) {
    this.synth = synth;
    this.UtteranceCtor = UtteranceCtor;
    this.capabilities = {
      supportsPauseResume: !isLinux,
      supportsLiveRateChange: false,
      maxChunkChars: 220,
    };
  }

  public async isAvailable(): Promise<boolean> {
    return this.synth !== null && this.UtteranceCtor !== null;
  }

  public async getVoices(): Promise<readonly VoiceInfo[]> {
    if (!this.synth) {
      return [];
    }

    const immediate = this.synth.getVoices();
    if (immediate.length > 0) {
      return immediate.map((v) => this.mapVoice(v));
    }

    const loaded = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const synth = this.synth!;
      const timer = setTimeout(() => {
        synth.removeEventListener?.('voiceschanged', onVoicesChanged);
        resolve(synth.getVoices());
      }, VOICES_TIMEOUT_MS);

      const onVoicesChanged = () => {
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', onVoicesChanged);
        resolve(synth.getVoices());
      };

      synth.addEventListener?.('voiceschanged', onVoicesChanged);
    });

    return loaded.map((v) => this.mapVoice(v));
  }

  public speak(text: string, options: EngineOptions): Promise<void> {
    if (!this.synth || !this.UtteranceCtor) {
      return Promise.reject(new TTSError('ENGINE_UNAVAILABLE', 'Web Speech API is unavailable.'));
    }

    if (options.signal?.aborted) {
      return Promise.reject(new TTSError('ABORTED', 'Speech aborted before start.'));
    }

    const synth = this.synth;
    const utterance = new this.UtteranceCtor(text);
    utterance.lang = options.lang;
    utterance.rate = options.rate;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;

    if (options.voiceId) {
      const voice = synth.getVoices().find((v) => v.voiceURI === options.voiceId);
      if (voice) {
        utterance.voice = voice;
      }
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        this.clearKeepAlive();
        this.activeAbort = null;
        options.signal?.removeEventListener('abort', onAbort);
      };

      const finish = (err?: TTSError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      const onAbort = () => {
        synth.cancel();
        finish(new TTSError('ABORTED', 'Speech cancelled.'));
      };

      this.activeAbort = onAbort;
      options.signal?.addEventListener('abort', onAbort, { once: true });

      utterance.onend = () => finish();
      utterance.onerror = (event) => {
        const errCode =
          event.error === 'canceled' || event.error === 'interrupted'
            ? 'ABORTED'
            : 'SYNTHESIS_FAILED';
        finish(new TTSError(errCode, `Web Speech synthesis error: ${event.error || 'unknown'}`));
      };

      this.startKeepAlive();
      synth.speak(utterance);
    });
  }

  public pause(): void {
    this.clearKeepAlive();
    this.synth?.pause();
  }

  public resume(): void {
    this.synth?.resume();
    this.startKeepAlive();
  }

  public stop(): void {
    this.clearKeepAlive();
    const abort = this.activeAbort;
    this.activeAbort = null;
    if (abort) {
      abort();
    } else {
      this.synth?.cancel();
    }
  }

  public dispose(): void {
    this.stop();
  }

  private startKeepAlive(): void {
    this.clearKeepAlive();
    if (!this.synth) return;
    this.keepAliveTimer = setInterval(() => {
      if (this.synth?.speaking && !this.synth.paused) {
        this.synth.pause();
        this.synth.resume();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private mapVoice(voice: SpeechSynthesisVoice): VoiceInfo {
    return {
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      isLocal: voice.localService,
      isDefault: voice.default,
      engine: 'web-speech',
    };
  }
}
