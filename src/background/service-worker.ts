import browser from 'webextension-polyfill';
import { PiperRuntime } from '../core/neural/piper-runtime';
import { resolvePiperVoiceForLang } from '../core/neural/piper-voices';
import { getExtensionStorage } from '../shared/storage';
import type { ExtensionMessage, MessageResult } from '../shared/types';
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
}): Promise<{ readonly mimeType: string; readonly audioBase64: string }> {
  const offscreen = getChromeOffscreen();
  if (offscreen) {
    await ensureOffscreenDocument(offscreen);
    const response = (await browser.runtime.sendMessage({
      type: 'OFFSCREEN_PIPER_SYNTHESIZE',
      payload: request,
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

  return getOrCreateFirefoxRuntime().synthesize(request.text, request.voiceId);
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
  scheduleDefaultVoiceWarmup();
});

browser.runtime.onStartup?.addListener(() => {
  registerContextMenu();
  scheduleDefaultVoiceWarmup();
});

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
  if (msg?.type === 'OFFSCREEN_PIPER_SYNTHESIZE' || msg?.type === 'OFFSCREEN_PIPER_WARMUP') {
    return undefined;
  }

  return handleRuntimeMessage(message, sender, {
    runtimeId: browser.runtime.id,
    getSettings: () => getExtensionStorage().getSettings(),
    synthesizeNeural: synthesizeNeuralInBackground,
    warmupNeural: warmupNeuralInBackground,
    detectLanguage: browser.i18n?.detectLanguage
      ? (text) => browser.i18n.detectLanguage(text)
      : undefined,
  });
});
