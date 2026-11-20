/** Supported synthesis engine identifiers. */
export type EngineId = 'piper-neural' | 'web-speech' | 'local-http';

/** Allowed playback speed multipliers in the UI and TTS pipeline. */
export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export type ThemePreference = 'auto' | 'light' | 'dark';
export type LocalHttpProtocol = 'piper' | 'kokoro-openai';
/** Viewport corner anchor targets for the floating Auto-Read dock/orb. */
export type DockCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  readonly isLocal: boolean;
  readonly isDefault: boolean;
  readonly engine: EngineId;
}

export interface EngineOptions {
  readonly lang: string;
  readonly voiceId?: string;
  readonly rate: PlaybackRate;
  readonly pitch?: number;
  readonly volume?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (message: string) => void;
  readonly onPlaying?: () => void;
}

export type TTSErrorCode =
  | 'ENGINE_UNAVAILABLE'
  | 'VOICE_NOT_FOUND'
  | 'SYNTHESIS_FAILED'
  | 'INVALID_ENDPOINT'
  | 'NETWORK_BLOCKED'
  | 'TIMEOUT'
  | 'ABORTED';

/**
 * Typed domain error thrown across TTS engines, transport adapters, and queue management.
 */
export class TTSError extends Error {
  public readonly code: TTSErrorCode;

  public constructor(code: TTSErrorCode, message: string) {
    super(message);
    this.name = 'TTSError';
    this.code = code;
  }
}

export interface LocalHttpConfig {
  readonly endpointUrl: string;
  readonly protocol: LocalHttpProtocol;
  readonly timeoutMs: number;
}

export interface AppearanceSettings {
  readonly iconBgColor: string;
  readonly iconFgColor: string;
  readonly accentColor: string;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  iconBgColor: '#2563eb',
  iconFgColor: '#ffffff',
  accentColor: '#1d4ed8',
};

export interface ExtensionSettings {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly blockedDomains: readonly string[];
  readonly engine: EngineId;
  readonly defaultRate: PlaybackRate;
  readonly voicePreferences: Readonly<Record<string, string>>;
  readonly theme: ThemePreference;
  readonly appearance: AppearanceSettings;
  readonly omitCodeBlocks: boolean;
  readonly omitFileNames: boolean;
  readonly stripUrls: boolean;
  readonly autoReadSelection: boolean;
  readonly autoReadCorner: DockCorner;
  readonly autoReadMinimized: boolean;
  readonly geminiAutoRead: boolean;
  readonly localHttp: LocalHttpConfig;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 1,
  enabled: true,
  blockedDomains: [],
  engine: 'piper-neural',
  defaultRate: 1,
  voicePreferences: {},
  theme: 'auto',
  appearance: DEFAULT_APPEARANCE,
  omitCodeBlocks: true,
  omitFileNames: true,
  stripUrls: true,
  autoReadSelection: false,
  autoReadCorner: 'bottom-right',
  autoReadMinimized: false,
  geminiAutoRead: false,
  localHttp: {
    endpointUrl: 'http://127.0.0.1:5000/tts',
    protocol: 'piper',
    timeoutMs: 15_000,
  },
};

export type QueueSource = 'selection' | 'shortcut' | 'context-menu' | 'gemini-stream';

export interface SentenceItem {
  readonly id: string;
  readonly index: number;
  readonly text: string;
  readonly lang: string;
}

export interface QueueError {
  readonly code: TTSErrorCode;
  readonly message: string;
}

export type SentenceQueueState =
  | {
      readonly status: 'idle';
      readonly items: readonly [];
      readonly currentIndex: -1;
      readonly rate: PlaybackRate;
      readonly detectedLang: string | null;
      readonly source: null;
      readonly error: null;
    }
  | {
      readonly status: 'loading' | 'playing' | 'paused';
      readonly items: readonly SentenceItem[];
      readonly currentIndex: number;
      readonly rate: PlaybackRate;
      readonly detectedLang: string;
      readonly source: QueueSource;
      readonly loadingMessage?: string;
      readonly hasMoreChunks?: boolean;
      readonly error: null;
    }
  | {
      readonly status: 'error';
      readonly items: readonly SentenceItem[];
      readonly currentIndex: number;
      readonly rate: PlaybackRate;
      readonly detectedLang: string | null;
      readonly source: QueueSource | null;
      readonly error: QueueError;
    };

export type MessageResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type ExtensionMessage =
  | { readonly type: 'DETECT_LANGUAGE'; readonly payload: { readonly text: string } }
  | {
      readonly type: 'NEURAL_TTS_SYNTHESIZE';
      readonly payload: {
        readonly text: string;
        readonly lang: string;
        readonly voiceId?: string;
        readonly rate: PlaybackRate;
      };
    }
  | {
      readonly type: 'NEURAL_TTS_WARMUP';
      readonly payload: {
        readonly lang: string;
        readonly voiceId?: string;
      };
    }
  | { readonly type: 'NEURAL_TTS_CANCEL' }
  | {
      readonly type: 'OFFSCREEN_PIPER_SYNTHESIZE';
      readonly payload: {
        readonly text: string;
        readonly voiceId: string;
        readonly rate?: PlaybackRate;
      };
    }
  | {
      readonly type: 'OFFSCREEN_PIPER_WARMUP';
      readonly payload: {
        readonly voiceId: string;
      };
    }
  | { readonly type: 'OFFSCREEN_PIPER_CANCEL' }
  | {
      readonly type: 'OFFSCREEN_PLAY_AUDIO';
      readonly payload: {
        readonly mimeType: string;
        readonly audioBase64: string;
        readonly rate: PlaybackRate;
      };
    }
  | {
      readonly type: 'LOCAL_TTS_SYNTHESIZE';
      readonly payload: {
        readonly endpointUrl: string;
        readonly protocol: LocalHttpProtocol;
        readonly text: string;
        readonly voiceId?: string;
        readonly rate: PlaybackRate;
        readonly timeoutMs?: number;
      };
    }
  | {
      readonly type: 'COMMAND_TOGGLE_READ';
      readonly payload: {
        readonly source: 'shortcut' | 'context-menu' | 'popup';
        readonly text?: string;
      };
    }
  | { readonly type: 'COMMAND_STOP' }
  | { readonly type: 'GET_TAB_PLAYBACK_STATE' };
