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
import { segmentForStreaming, segmentSentences } from '../core/segmenter';
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
  void browser.runtime
    .sendMessage({
      type: 'NEURAL_TTS_WARMUP',
      payload: { lang, voiceId },
    } satisfies ExtensionMessage)
    .catch(() => undefined);
}

function createEngineForSettings(settings: ExtensionSettings): TTSEngineInterface {
  if (settings.engine === 'local-http') {
    return new LocalHttpEngine(settings.localHttp, sendLocalSynthesize);
  }
  if (settings.engine === 'web-speech') {
    return new WebSpeechEngine();
  }
  return new PiperNeuralEngine(sendNeuralSynthesize);
}

export class EchoSelectContentApp {
  private settings: ExtensionSettings = DEFAULT_SETTINGS;
  private host: ShadowHost | null = null;
  private floatingBtn: FloatingButton | null = null;
  private miniPlayer: MiniPlayer | null = null;
  private selectionHandler: SelectionHandler | null = null;
  private geminiAdapter: GeminiAdapter | null = null;
  private geminiToggleBtn: HTMLButtonElement | null = null;
  private ttsManager: TTSManager | null = null;
  private currentEngine: TTSEngineInterface | null = null;
  private pendingText = '';
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

  private shouldBeActive(): boolean {
    if (!this.settings.enabled) {
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
      this.refreshEngine();
      this.syncGeminiToggleUi();
    }
  }

  private mountUi(): void {
    this.host = new ShadowHost(this.settings.theme);
    this.host.mount();

    this.currentEngine = createEngineForSettings(this.settings);
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
      onStop: () => this.ttsManager?.stop(),
      onPrev: () => this.ttsManager?.prev(),
      onNext: () => this.ttsManager?.next(),
      onRateChange: (rate) => this.ttsManager?.setRate(rate),
    });

    this.unsubTts = this.ttsManager.subscribe((state) => {
      this.miniPlayer?.update(state);
    });

    this.selectionHandler = new SelectionHandler({
      isInsideOwnUi: (target, path) => this.host?.containsEventTarget(target, path) ?? false,
      omitCodeBlocks: () => this.settings.omitCodeBlocks,
      stripUrls: () => this.settings.stripUrls,
      onSelect: ({ text, position }) => {
        this.pendingText = text;
        this.floatingBtn?.show(position);
        this.warmupNeuralForText(text);
      },
      onClear: () => {
        this.pendingText = '';
        this.floatingBtn?.hide();
      },
    });
    this.selectionHandler.attach();

    if (GEMINI_SELECTORS.hostPattern.test(window.location.hostname)) {
      this.mountGeminiAdapter();
    }
  }

  private mountGeminiAdapter(): void {
    if (!this.host) return;

    this.geminiAdapter = new GeminiAdapter({
      omitCodeBlocks: this.settings.omitCodeBlocks,
      onSentences: (sentences) => {
        void this.enqueueStreamingSentences(sentences);
      },
    });

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'es-gemini-pill';
    pill.setAttribute('data-es-role', 'gemini-autoread-toggle');
    pill.addEventListener('click', () => {
      const next = !this.geminiAdapter?.isEnabled();
      this.geminiAdapter?.setEnabled(next);
      this.updateGeminiPillLabel(next);
      if (!next) {
        this.ttsManager?.stop();
      }
    });

    this.geminiToggleBtn = pill;
    this.host.container.appendChild(pill);
    this.syncGeminiToggleUi();
  }

  private syncGeminiToggleUi(): void {
    if (!this.geminiAdapter || !this.geminiToggleBtn) return;
    this.geminiAdapter.setEnabled(this.settings.geminiAutoRead);
    this.updateGeminiPillLabel(this.settings.geminiAutoRead);
  }

  private updateGeminiPillLabel(active: boolean): void {
    if (!this.geminiToggleBtn) return;
    this.geminiToggleBtn.setAttribute('aria-pressed', String(active));
    this.geminiToggleBtn.textContent = active ? '🔊 Auto-lectura: ON' : '🔇 Auto-lectura: OFF';
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

  private refreshEngine(): void {
    if (!this.ttsManager) return;
    this.warmedVoiceKey = '';
    const nextEngine = createEngineForSettings(this.settings);
    this.currentEngine?.dispose();
    this.currentEngine = nextEngine;
    this.ttsManager.setEngine(nextEngine);
    this.ttsManager.setRate(this.settings.defaultRate);
  }

  private teardownUi(): void {
    this.speakSeq += 1;
    this.geminiAdapter?.dispose();
    this.geminiAdapter = null;
    this.geminiToggleBtn?.remove();
    this.geminiToggleBtn = null;
    this.selectionHandler?.detach();
    this.selectionHandler = null;
    this.unsubTts?.();
    this.unsubTts = null;
    this.ttsManager?.dispose();
    this.ttsManager = null;
    this.currentEngine = null;
    this.floatingBtn?.destroy();
    this.floatingBtn = null;
    this.miniPlayer?.destroy();
    this.miniPlayer = null;
    this.host?.destroy();
    this.host = null;
    this.pendingText = '';
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
    const lang = await detectLanguage(text, {
      remoteDetect: detectViaBackground,
      fallbackLang,
      preferFastLocal: true,
    });

    if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

    const cleaned = cleanText(text, {
      lang,
      omitCodeBlocks: this.settings.omitCodeBlocks,
      stripUrls: this.settings.stripUrls,
    });
    const firstChunkMax = this.currentEngine.capabilities.streamingFirstChunkChars;
    const sentences = firstChunkMax
      ? segmentForStreaming(cleaned, lang, {
          firstChunkMaxChars: firstChunkMax,
          maxChunkChars: this.currentEngine.capabilities.maxChunkChars,
        })
      : segmentSentences(cleaned, lang, this.currentEngine.capabilities.maxChunkChars);
    if (sentences.length === 0) return;

    const voices = await this.currentEngine.getVoices();
    if (token !== this.speakSeq || !this.ttsManager || !this.currentEngine) return;

    const preferred = selectPreferredVoice(voices, lang, this.settings.voicePreferences);

    const playPromise = this.ttsManager.play(sentences, {
      lang,
      voiceId: preferred?.id,
      rate: this.settings.defaultRate,
      source,
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
