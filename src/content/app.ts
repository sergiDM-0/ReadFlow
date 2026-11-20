import browser from 'webextension-polyfill';
import { cleanText } from '../core/cleaner';
import {
  LocalHttpEngine,
  type LocalSynthesizeRequest,
  type LocalSynthesizeResponse,
} from '../core/engines/local-http.engine';
import {
  PiperNeuralEngine,
  type NeuralSynthesizeRequest,
  type NeuralSynthesizeResponse,
} from '../core/engines/piper-neural.engine';
import { WebSpeechEngine } from '../core/engines/web-speech.engine';
import type { TTSEngineInterface } from '../core/engines/engine.interface';
import {
  detectLanguage,
  detectLanguageHeuristic,
  selectPreferredVoice,
} from '../core/language-detector';
import { createProceduralTextStream } from '../core/procedural-stream';
import { TTSManager } from '../core/tts-manager';
import { getExtensionStorage, isHostBlocked, onSettingsChanged } from '../shared/storage';
import {
  DEFAULT_SETTINGS,
  TTSError,
  type ExtensionMessage,
  type ExtensionSettings,
  type MessageResult,
  type QueueSource,
} from '../shared/types';
import { GeminiAdapter } from './adapters/gemini-adapter';
import { GEMINI_SELECTORS } from './adapters/gemini-selectors';
import { SelectionHandler } from './selection-handler';
import { AutoReadDock } from './ui/auto-read-dock';
import { FloatingButton } from './ui/floating-btn';
import { MiniPlayer } from './ui/mini-player';
import { ShadowHost } from './ui/shadow-host';

async function sendLocalSynthesize(
  request: LocalSynthesizeRequest
): Promise<LocalSynthesizeResponse> {
  const response = (await browser.runtime.sendMessage({
    type: 'LOCAL_TTS_SYNTHESIZE',
    payload: request,
  } satisfies ExtensionMessage)) as MessageResult<LocalSynthesizeResponse>;

  if (!response || !response.ok) {
    throw new TTSError(
      'SYNTHESIS_FAILED',
      response && !response.ok ? response.message : 'Local TTS synthesis failed.'
    );
  }
  return response.data;
}

async function detectViaBackground(text: string) {
  const response = (await browser.runtime.sendMessage({
    type: 'DETECT_LANGUAGE',
    payload: { text },
  } satisfies ExtensionMessage)) as MessageResult<{
    readonly lang: string;
    readonly confidence: number;
    readonly isReliable: boolean;
  }>;

  return response && response.ok ? response.data : null;
}

async function sendNeuralSynthesize(
  request: NeuralSynthesizeRequest
): Promise<NeuralSynthesizeResponse> {
  const response = (await browser.runtime.sendMessage({
    type: 'NEURAL_TTS_SYNTHESIZE',
    payload: request,
  } satisfies ExtensionMessage)) as MessageResult<NeuralSynthesizeResponse>;

  if (!response || !response.ok) {
    throw new TTSError(
      'SYNTHESIS_FAILED',
      response && !response.ok ? response.message : 'La síntesis neuronal local falló.'
    );
  }
  return response.data;
}

function sendNeuralWarmup(lang: string, voiceId?: string): void {
  void Promise.resolve(
    browser.runtime.sendMessage({
      type: 'NEURAL_TTS_WARMUP',
      payload: { lang, voiceId },
    } satisfies ExtensionMessage)
  ).catch(() => undefined);
}

function sendNeuralCancel(): void {
  void Promise.resolve(
    browser.runtime.sendMessage({
      type: 'NEURAL_TTS_CANCEL',
    } satisfies ExtensionMessage)
  ).catch(() => undefined);
}

function createEngineForSettings(settings: ExtensionSettings): TTSEngineInterface {
  if (settings.engine === 'local-http') {
    return new LocalHttpEngine(settings.localHttp, sendLocalSynthesize);
  }
  if (settings.engine === 'web-speech') {
    return new WebSpeechEngine();
  }
  return new PiperNeuralEngine(sendNeuralSynthesize, undefined, sendNeuralCancel);
}

/**
 * Main content-script orchestrator that coordinates `ShadowHost`, `FloatingButton`, `MiniPlayer`,
 * `AutoReadDock`, `SelectionHandler`, `GeminiAdapter`, `TTSManager`, and `ProceduralTextStream`.
 */
export class EchoSelectContentApp {
  private settings: ExtensionSettings = DEFAULT_SETTINGS;
  private host: ShadowHost | null = null;
  private floatingBtn: FloatingButton | null = null;
  private miniPlayer: MiniPlayer | null = null;
  private selectionHandler: SelectionHandler | null = null;
  private geminiAdapter: GeminiAdapter | null = null;
  private autoReadDock: AutoReadDock | null = null;
  private ttsManager: TTSManager | null = null;
  private currentEngine: TTSEngineInterface | null = null;
  private activeEngineConfigKey = '';
  private pendingText = '';
  private lastAutoReadText = '';
  private warmedVoiceKey = '';
  private speakSeq = 0;
  private streamQueue: Promise<void> = Promise.resolve();
  private unsubSettings: (() => void) | null = null;
  private unsubTts: (() => void) | null = null;

  public async start(): Promise<void> {
    const storage = getExtensionStorage();
    this.settings = await storage.getSettings();
    this.applyActiveState();

    this.unsubSettings = onSettingsChanged((nextSettings) => {
      this.settings = nextSettings;
      this.applyActiveState();
    });

    browser.runtime.onMessage.addListener((rawMessage: unknown) => {
      const message = rawMessage as ExtensionMessage | undefined;
      if (!message || typeof message !== 'object') {
        return undefined;
      }

      if (message.type === 'COMMAND_TOGGLE_READ') {
        return this.handleToggleCommand(message.payload.source, message.payload.text);
      }

      if (message.type === 'COMMAND_STOP') {
        this.ttsManager?.stop();
        return Promise.resolve({ ok: true, data: undefined });
      }

      if (message.type === 'GET_TAB_PLAYBACK_STATE' && this.ttsManager) {
        return Promise.resolve({ ok: true, data: { state: this.ttsManager.getState() } });
      }

      return undefined;
    });
  }

  public destroy(): void {
    this.teardownUi();
    this.unsubSettings?.();
    this.unsubSettings = null;
  }

  private isSameOriginSubframe(): boolean {
    try {
      return window !== window.top && Boolean(window.parent?.document);
    } catch {
      return false;
    }
  }

  private shouldBeActive(): boolean {
    if (!this.settings.enabled || this.isSameOriginSubframe()) {
      return false;
    }
    return !isHostBlocked(window.location.hostname, this.settings.blockedDomains);
  }

  private applyActiveState(): void {
    if (!this.shouldBeActive()) {
      this.teardownUi();
      return;
    }

    if (!this.host) {
      this.mountUi();
    } else {
      this.host.setTheme(this.settings.theme);
      this.host.setAppearance(this.settings.appearance);
      this.refreshEngineIfNeeded();
      this.syncAutoReadUi();
    }
  }

  private getEngineConfigKey(settings: ExtensionSettings): string {
    if (settings.engine === 'local-http') {
      return `local-http::${settings.localHttp.endpointUrl}::${settings.localHttp.protocol}::${settings.localHttp.timeoutMs}`;
    }
    return settings.engine;
  }

  private isAutoReadActive(): boolean {
    if (this.settings.autoReadSelection) {
      return true;
    }
    return Boolean(this.geminiAdapter && this.settings.geminiAutoRead);
  }

  private mountUi(): void {
    this.host = new ShadowHost(this.settings.theme);
    this.host.setAppearance(this.settings.appearance);
    this.host.mount();

    this.currentEngine = createEngineForSettings(this.settings);
    this.activeEngineConfigKey = this.getEngineConfigKey(this.settings);
    this.ttsManager = new TTSManager(this.currentEngine, this.settings.defaultRate);

    this.floatingBtn = new FloatingButton(this.host.container, () => {
      const text = this.pendingText || this.selectionHandler?.getCurrentSelectedText() || '';
      this.floatingBtn?.hide();
      if (text) {
        void this.speakText(text, 'selection', true);
      }
    });

    this.miniPlayer = new MiniPlayer(this.host.container, {
      onTogglePlayPause: () => this.ttsManager?.togglePauseResume(),
      onStop: () => {
        this.lastAutoReadText = '';
        this.ttsManager?.stop();
      },
      onPrev: () => this.ttsManager?.prev(),
      onNext: () => this.ttsManager?.next(),
      onRateChange: (rate) => {
        this.settings = { ...this.settings, defaultRate: rate };
        this.ttsManager?.setRate(rate);
        void getExtensionStorage()
          .updateSettings({ defaultRate: rate })
          .catch(() => undefined);
      },
      onLayoutChange: (rect) => {
        this.autoReadDock?.updateCollisionAvoidance(rect);
      },
    });

    this.unsubTts = this.ttsManager.subscribe((state) => {
      this.miniPlayer?.update(state);
      if (state.status === 'idle') {
        this.lastAutoReadText = '';
      }
    });

    this.selectionHandler = new SelectionHandler({
      isInsideOwnUi: (target, path) => this.host?.containsEventTarget(target, path) ?? false,
      omitCodeBlocks: () => this.settings.omitCodeBlocks,
      omitFileNames: () => this.settings.omitFileNames,
      stripUrls: () => this.settings.stripUrls,
      onSelect: ({ text, position }) => {
        this.pendingText = text;
        if (this.isAutoReadActive()) {
          this.floatingBtn?.hide();
          const status = this.ttsManager?.getState().status;
          if (text === this.lastAutoReadText && (status === 'playing' || status === 'loading')) {
            return;
          }
          this.lastAutoReadText = text;
          void this.speakText(text, 'selection', false);
          return;
        }
        this.floatingBtn?.show(position);
        this.warmupNeuralForText(text);
      },
      onClear: () => {
        this.pendingText = '';
        this.lastAutoReadText = '';
        this.floatingBtn?.hide();
      },
    });
    this.selectionHandler.attach();

    if (GEMINI_SELECTORS.hostPattern.test(window.location.hostname)) {
      this.geminiAdapter = new GeminiAdapter({
        omitCodeBlocks: this.settings.omitCodeBlocks,
        omitFileNames: this.settings.omitFileNames,
        onSentences: (sentences) => {
          void this.enqueueStreamingSentences(sentences);
        },
      });
    }

    this.mountAutoReadPill();
  }

  private isTopFrame(): boolean {
    try {
      return window === window.top;
    } catch {
      return false;
    }
  }

  private mountAutoReadPill(): void {
    if (!this.host || !this.isTopFrame()) return;

    this.autoReadDock = new AutoReadDock(
      this.host.container,
      {
        active: this.isAutoReadActive(),
        corner: this.settings.autoReadCorner,
        minimized: this.settings.autoReadMinimized,
      },
      {
        onToggleAutoRead: () => {
          const next = !this.isAutoReadActive();
          const patch: Partial<ExtensionSettings> = this.geminiAdapter
            ? { autoReadSelection: next, geminiAutoRead: next }
            : { autoReadSelection: next };
          this.settings = { ...this.settings, ...patch };
          this.syncAutoReadUi();
          void getExtensionStorage()
            .updateSettings(patch)
            .catch(() => undefined);

          if (!next) {
            this.lastAutoReadText = '';
            this.ttsManager?.stop();
            return;
          }

          const selected =
            this.pendingText || this.selectionHandler?.getCurrentSelectedText() || '';
          if (selected) {
            this.floatingBtn?.hide();
            this.lastAutoReadText = selected;
            void this.speakText(selected, 'selection', false);
          }
        },
        onCornerChange: (corner) => {
          this.settings = { ...this.settings, autoReadCorner: corner };
          void getExtensionStorage()
            .updateSettings({ autoReadCorner: corner })
            .catch(() => undefined);
        },
        onMinimizedChange: (minimized) => {
          this.settings = { ...this.settings, autoReadMinimized: minimized };
          void getExtensionStorage()
            .updateSettings({ autoReadMinimized: minimized })
            .catch(() => undefined);
        },
      }
    );

    this.syncAutoReadUi();
  }

  private syncAutoReadUi(): void {
    const active = this.isAutoReadActive();
    if (this.geminiAdapter) {
      this.geminiAdapter.setSanitizeOptions({
        omitCodeBlocks: this.settings.omitCodeBlocks,
        omitFileNames: this.settings.omitFileNames,
      });
      this.geminiAdapter.setEnabled(
        this.settings.geminiAutoRead || this.settings.autoReadSelection
      );
    }
    this.autoReadDock?.update({
      active,
      corner: this.settings.autoReadCorner,
      minimized: this.settings.autoReadMinimized,
    });
    this.autoReadDock?.updateCollisionAvoidance(this.miniPlayer?.getVisibleRect() ?? null);
  }

  private warmupNeuralForText(text: string): void {
    if (this.settings.engine !== 'piper-neural') return;
    const fallbackLang = document.documentElement.lang || navigator.language || 'es';
    const lang = detectLanguageHeuristic(text, fallbackLang);
    const preferredVoiceId = this.settings.voicePreferences[lang];
    const key = `${lang}::${preferredVoiceId ?? ''}`;
    if (this.warmedVoiceKey === key) return;
    this.warmedVoiceKey = key;
    sendNeuralWarmup(lang, preferredVoiceId);
  }

  private refreshEngineIfNeeded(): void {
    if (!this.ttsManager) return;
    const nextKey = this.getEngineConfigKey(this.settings);
    if (nextKey !== this.activeEngineConfigKey) {
      this.warmedVoiceKey = '';
      this.activeEngineConfigKey = nextKey;
      const nextEngine = createEngineForSettings(this.settings);
      this.currentEngine?.dispose();
      this.currentEngine = nextEngine;
      this.ttsManager.setEngine(nextEngine);
    }
    if (this.ttsManager.getState().rate !== this.settings.defaultRate) {
      this.ttsManager.setRate(this.settings.defaultRate);
    }
  }

  private teardownUi(): void {
    this.speakSeq += 1;
    this.geminiAdapter?.dispose();
    this.geminiAdapter = null;
    this.autoReadDock?.destroy();
    this.autoReadDock = null;
    this.selectionHandler?.detach();
    this.selectionHandler = null;
    this.unsubTts?.();
    this.unsubTts = null;
    this.ttsManager?.dispose();
    this.ttsManager = null;
    this.currentEngine = null;
    this.activeEngineConfigKey = '';
    this.floatingBtn?.destroy();
    this.floatingBtn = null;
    this.miniPlayer?.destroy();
    this.miniPlayer = null;
    this.host?.destroy();
    this.host = null;
    this.pendingText = '';
    this.lastAutoReadText = '';
  }

  private async handleToggleCommand(
    source: 'shortcut' | 'context-menu' | 'popup',
    explicitText?: string
  ): Promise<MessageResult<{ readonly active: boolean }>> {
    if (!this.shouldBeActive() || !this.ttsManager) {
      return { ok: true, data: { active: false } };
    }

    const state = this.ttsManager.getState();
    if (state.status === 'playing' || state.status === 'paused') {
      this.ttsManager.stop();
      return { ok: true, data: { active: false } };
    }

    const raw = explicitText?.trim() || this.selectionHandler?.getCurrentSelectedText() || '';
    const cleaned = cleanText(raw, {
      omitCodeBlocks: this.settings.omitCodeBlocks,
      omitFileNames: this.settings.omitFileNames,
      stripUrls: this.settings.stripUrls,
    });
    if (!cleaned) {
      return { ok: true, data: { active: false } };
    }

    this.floatingBtn?.hide();
    await this.speakText(cleaned, source === 'popup' ? 'shortcut' : source);
    return { ok: true, data: { active: true } };
  }

  private async speakText(text: string, source: QueueSource, focusPlayer = false): Promise<void> {
    if (!this.ttsManager || !this.currentEngine) return;
    const token = ++this.speakSeq;

    const fallbackLang = document.documentElement.lang || navigator.language || 'en';
    const lang = await detectLanguage(text.slice(0, 500), {
      remoteDetect: detectViaBackground,
      fallbackLang,
      preferFastLocal: true,
    });

    if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

    const stream = createProceduralTextStream(text, {
      lang,
      omitCodeBlocks: this.settings.omitCodeBlocks,
      omitFileNames: this.settings.omitFileNames,
      stripUrls: this.settings.stripUrls,
      maxChunkChars: this.currentEngine.capabilities.maxChunkChars,
      firstChunkMaxChars: this.currentEngine.capabilities.streamingFirstChunkChars,
    });
    const initialChunks = stream.nextBatch();
    if (initialChunks.length === 0) return;

    const voices = await this.currentEngine.getVoices();
    if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

    const preferred = selectPreferredVoice(voices, lang, this.settings.voicePreferences);

    const playPromise = this.ttsManager.play(initialChunks, {
      lang,
      voiceId: preferred?.id,
      rate: this.settings.defaultRate,
      source,
      pullMoreChunks: () => stream.nextBatch(),
      hasMoreChunks: () => stream.hasMore(),
    });

    if (focusPlayer) {
      this.miniPlayer?.focusPrimaryControl();
    }

    await playPromise;
  }

  private enqueueStreamingSentences(sentences: readonly string[]): Promise<void> {
    if (sentences.length === 0) return Promise.resolve();
    const token = this.speakSeq;

    const task = this.streamQueue.then(async () => {
      if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

      const sample = sentences.join(' ');
      const fallbackLang = document.documentElement.lang || navigator.language || 'en';
      const lang = await detectLanguage(sample, {
        remoteDetect: detectViaBackground,
        fallbackLang,
      });

      if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

      const voices = await this.currentEngine.getVoices();
      if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

      const preferred = selectPreferredVoice(voices, lang, this.settings.voicePreferences);

      await this.ttsManager.enqueue(sentences, {
        lang,
        voiceId: preferred?.id,
        rate: this.settings.defaultRate,
        source: 'gemini-stream',
      });
    });

    this.streamQueue = task.catch(() => undefined);
    return task;
  }
}
