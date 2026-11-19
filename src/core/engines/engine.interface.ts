import type { EngineId, EngineOptions, VoiceInfo } from '../../shared/types';

export interface TTSEngineCapabilities {
  readonly supportsPauseResume: boolean;
  readonly supportsLiveRateChange: boolean;
  readonly maxChunkChars: number;
}

export interface TTSEngineInterface {
  readonly id: EngineId;
  readonly capabilities: TTSEngineCapabilities;
  isAvailable(): Promise<boolean>;
  getVoices(): Promise<readonly VoiceInfo[]>;
  speak(text: string, options: EngineOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
}
