import type { EngineId, EngineOptions, PlaybackRate, VoiceInfo } from '../../shared/types';

/** Capability descriptors advertised by a `TTSEngineInterface` implementation. */
export interface TTSEngineCapabilities {
  readonly supportsPauseResume: boolean;
  readonly supportsLiveRateChange: boolean;
  readonly maxChunkChars: number;
  readonly streamingFirstChunkChars?: number;
}

/** Strategy contract implemented by all pluggable TTS engines (`piper-neural`, `web-speech`, `local-http`). */
export interface TTSEngineInterface {
  readonly id: EngineId;
  readonly capabilities: TTSEngineCapabilities;
  isAvailable(): Promise<boolean>;
  getVoices(): Promise<readonly VoiceInfo[]>;
  speak(text: string, options: EngineOptions): Promise<void>;
  setPlaybackRate?(rate: PlaybackRate): void;
  prefetch?(text: string, options: EngineOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
}
