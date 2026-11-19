import browser from 'webextension-polyfill';
import { PiperRuntime } from '../core/neural/piper-runtime';
import { resolvePiperVoiceForLang } from '../core/neural/piper-voices';
import { renderToolbarIconImageData } from '../shared/icon-renderer';
import { getExtensionStorage, onSettingsChanged } from '../shared/storage';
import type { ExtensionMessage, ExtensionSettings, MessageResult } from '../shared/types';
import { handleRuntimeMessage } from './message-handler';

const CONTEXT_MENU_ID = 'echoselect-read-selection';

interface ChromeOffscreenApi {
  hasDocument?: () => Promise<boolean>;
  createDocument: (params: {
    url: string;
    reasons: string[];
    justification: string;
  }) => Promise<void>;
}

let firefoxRuntime: PiperRuntime | null = null;
let offscreenCreatePromise: Promise<void> | null = null;

function getChromeOffscreen(): ChromeOffscreenApi | null {
  const g = globalThis as unknown as { chrome?: { offscreen?: ChromeOffscreenApi } };
  return g.chrome?.offscreen ?? null;
}

function getOrCreateFirefoxRuntime(): PiperRuntime {
  if (!firefoxRuntime) {
    firefoxRuntime = new PiperRuntime({
      ortWasmDir: browser.runtime.getURL('wasm/'),
      piperWasm: browser.runtime.getURL('wasm/piper_phonemize.wasm'),
      piperData: browser.runtime.getURL('wasm/piper_phonemize.data'),
    });
  }
  return firefoxRuntime;
}

async function ensureOffscreenDocument(offscreen: ChromeOffscreenApi): Promise<void> {
  if (offscreen.hasDocument && (await offscreen.hasDocument())) {
    return;
  }
  if (!offscreenCreatePromise) {
    offscreenCreatePromise = offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Run 100% local Piper ONNX WebAssembly neural text-to-speech synthesis.',
      })
      .finally(() => {
        offscreenCreatePromise = null;
      });
  }
  await offscreenCreatePromise;
}

async function synthesizeNeuralInBackground(request: {
  readonly text: string;
  readonly voiceId: string;
  readonly rate?: number;
}): Promise<{ readonly mimeType: string; readonly audioBase64: string }> {
  const offscreen = getChromeOffscreen();
  if (offscreen) {
    await ensureOffscreenDocument(offscreen);
    const response = (await browser.runtime.sendMessage({
      type: 'OFFSCREEN_PIPER_SYNTHESIZE',
      payload: {
        text: request.text,
        voiceId: request.voiceId,
        rate: request.rate as import('../shared/types').PlaybackRate | undefined,
      },
    } satisfies ExtensionMessage)) as MessageResult<{
      readonly mimeType: string;
      readonly audioBase64: string;
    }>;

    if (!response || !response.ok) {
      throw new Error(
        response && !response.ok ? response.message : 'Offscreen neural synthesis failed.'
      );
    }
    return response.data;
  }

  return getOrCreateFirefoxRuntime().synthesize(request.text, request.voiceId, request.rate);
}

async function cancelNeuralInBackground(): Promise<void> {
  const offscreen = getChromeOffscreen();
  if (offscreen) {
    if (offscreen.hasDocument && !(await offscreen.hasDocument())) {
      return;
    }
    await browser.runtime
      .sendMessage({ type: 'OFFSCREEN_PIPER_CANCEL' } satisfies ExtensionMessage)
      .catch(() => undefined);
    return;
  }
  firefoxRuntime?.cancelPending();
}

async function warmupNeuralInBackground(voiceId: string): Promise<void> {
  const offscreen = getChromeOffscreen();
  if (offscreen) {
    await ensureOffscreenDocument(offscreen);
    const response = (await browser.runtime.sendMessage({
      type: 'OFFSCREEN_PIPER_WARMUP',
      payload: { voiceId },
    } satisfies ExtensionMessage)) as MessageResult<{ readonly warmed: true }>;

    if (!response || !response.ok) {
      throw new Error(
        response && !response.ok ? response.message : 'Offscreen neural warmup failed.'
      );
    }
    return;
  }

  await getOrCreateFirefoxRuntime().warmup(voiceId);
}

function applyToolbarIconAndBadge(settings: ExtensionSettings): void {
  const actionApi = browser.action;
  if (!actionApi) {
    return;
  }

  const autoReadActive = settings.autoReadSelection;
  const icon16 = renderToolbarIconImageData(settings.appearance, 16, {
    enabled: settings.enabled,
    autoReadActive,
  });
  const icon32 = renderToolbarIconImageData(settings.appearance, 32, {
    enabled: settings.enabled,
    autoReadActive,
  });
  const icon48 = renderToolbarIconImageData(settings.appearance, 48, {
    enabled: settings.enabled,
    autoReadActive,
  });

  if (icon16 && icon32 && icon48 && typeof actionApi.setIcon === 'function') {
    const imageDataMap: Record<string, browser.Action.ImageDataType> = {
      '16': icon16 as unknown as browser.Action.ImageDataType,
      '32': icon32 as unknown as browser.Action.ImageDataType,
      '48': icon48 as unknown as browser.Action.ImageDataType,
    };
    void actionApi.setIcon({ imageData: imageDataMap }).catch(() => undefined);
  }

  if (typeof actionApi.setBadgeText === 'function') {
    const badgeText = !settings.enabled ? 'OFF' : autoReadActive ? 'ON' : '';
    void actionApi.setBadgeText({ text: badgeText }).catch(() => undefined);
  }

  if (typeof actionApi.setBadgeBackgroundColor === 'function') {
    const badgeColor = !settings.enabled ? '#64748b' : '#16a34a';
    void actionApi.setBadgeBackgroundColor({ color: badgeColor }).catch(() => undefined);
  }

  if (typeof actionApi.setTitle === 'function') {
    const title = !settings.enabled
      ? 'EchoSelect TTS (Desactivado)'
      : autoReadActive
        ? 'EchoSelect TTS (Auto-lectura ON — clic para configurar)'
        : 'EchoSelect TTS — Leer y configurar (Alt+S)';
    void actionApi.setTitle({ title }).catch(() => undefined);
  }
}

function syncToolbarFromStorage(): void {
  void getExtensionStorage()
    .getSettings()
    .then((settings) => {
      applyToolbarIconAndBadge(settings);
    })
    .catch(() => undefined);
}

function scheduleDefaultVoiceWarmup(): void {
  void getExtensionStorage()
    .getSettings()
    .then((settings) => {
      if (!settings.enabled || settings.engine !== 'piper-neural') {
        return;
      }
      const uiLang =
        (typeof navigator !== 'undefined' && navigator.language) ||
        browser.i18n?.getUILanguage?.() ||
        'es';
      const defaultVoice = resolvePiperVoiceForLang(uiLang, settings.voicePreferences);
      return warmupNeuralInBackground(defaultVoice.id);
    })
    .catch(() => {
      // Warmup is best-effort; synthesis retries on demand if offline or blocked.
    });
}

function registerContextMenu(): void {
  if (!browser.contextMenus) {
    return;
  }
  void browser.contextMenus
    .removeAll()
    .then(() => {
      browser.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'EchoSelect: Leer selección',
        contexts: ['selection'],
      });
    })
    .catch(() => {
      // Ignore transient startup race conditions on extension reload.
    });
}

async function sendToggleToActiveTab(
  source: 'shortcut' | 'context-menu',
  tabId?: number,
  text?: string
): Promise<void> {
  let targetTabId = tabId;
  if (targetTabId === undefined) {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    targetTabId = activeTab?.id;
  }
  if (targetTabId === undefined) {
    return;
  }
  try {
    await browser.tabs.sendMessage(targetTabId, {
      type: 'COMMAND_TOGGLE_READ',
      payload: { source, text },
    });
  } catch {
    // Active tab may be a restricted browser page (chrome://, about:) without content script.
  }
}

browser.runtime.onInstalled?.addListener(() => {
  registerContextMenu();
  syncToolbarFromStorage();
  scheduleDefaultVoiceWarmup();
});

browser.runtime.onStartup?.addListener(() => {
  registerContextMenu();
  syncToolbarFromStorage();
  scheduleDefaultVoiceWarmup();
});

onSettingsChanged((nextSettings) => {
  applyToolbarIconAndBadge(nextSettings);
});

syncToolbarFromStorage();

browser.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }
  void sendToggleToActiveTab('context-menu', tab?.id, info.selectionText);
});

browser.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-read-selection') {
    void sendToggleToActiveTab('shortcut');
  }
});

browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
  const msg = message as ExtensionMessage | undefined;
  if (
    msg?.type === 'OFFSCREEN_PIPER_SYNTHESIZE' ||
    msg?.type === 'OFFSCREEN_PIPER_WARMUP' ||
    msg?.type === 'OFFSCREEN_PIPER_CANCEL'
  ) {
    return undefined;
  }

  return handleRuntimeMessage(message, sender, {
    runtimeId: browser.runtime.id,
    getSettings: () => getExtensionStorage().getSettings(),
    synthesizeNeural: synthesizeNeuralInBackground,
    warmupNeural: warmupNeuralInBackground,
    cancelNeural: cancelNeuralInBackground,
    detectLanguage: browser.i18n?.detectLanguage
      ? (text) => browser.i18n.detectLanguage(text)
      : undefined,
  });
});
