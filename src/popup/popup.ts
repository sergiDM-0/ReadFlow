import browser from 'webextension-polyfill';
import { WebSpeechEngine } from '../core/engines/web-speech.engine';
import { getExtensionStorage } from '../shared/storage';
import type { ExtensionMessage, MessageResult } from '../shared/types';
import { initPopup } from './popup-controller';

async function getActiveTab(): Promise<browser.Tabs.Tab | undefined> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  } catch {
    return undefined;
  }
}

async function getActiveTabHost(): Promise<string> {
  const tab = await getActiveTab();
  if (!tab?.url) return '';
  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function triggerQuickRead(text?: string): Promise<boolean> {
  const tab = await getActiveTab();
  if (tab?.id === undefined) {
    return false;
  }
  const response = (await browser.tabs.sendMessage(
    tab.id,
    {
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'popup', text },
    } satisfies ExtensionMessage,
    { frameId: 0 }
  )) as MessageResult<{ readonly active: boolean }> | undefined;
  return Boolean(response && response.ok && response.data.active);
}

async function stopActiveTabPlayback(): Promise<void> {
  const tab = await getActiveTab();
  if (tab?.id === undefined) {
    return;
  }
  await browser.tabs
    .sendMessage(tab.id, { type: 'COMMAND_STOP' } satisfies ExtensionMessage)
    .catch(() => undefined);
}

async function requestOriginPermission(originPattern: string): Promise<boolean> {
  if (!browser.permissions?.request) {
    return true;
  }
  try {
    return await browser.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

function warmupNeuralVoice(lang: string, voiceId?: string): void {
  void browser.runtime
    .sendMessage({
      type: 'NEURAL_TTS_WARMUP',
      payload: { lang, voiceId },
    } satisfies ExtensionMessage)
    .catch(() => undefined);
}

async function bootstrap(): Promise<void> {
  try {
    const engine = new WebSpeechEngine();
    await initPopup({
      root: document,
      storage: getExtensionStorage(),
      getActiveTabHost,
      getAvailableVoices: () => engine.getVoices(),
      requestOriginPermission,
      warmupNeuralVoice,
      triggerQuickRead,
      stopActiveTabPlayback,
    });
  } catch {
    // Prevent unhandled promise rejection if popup closes mid-bootstrap.
  }
}

void bootstrap();
