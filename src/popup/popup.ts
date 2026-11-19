import browser from 'webextension-polyfill';
import { WebSpeechEngine } from '../core/engines/web-speech.engine';
import { getExtensionStorage } from '../shared/storage';
import { initPopup } from './popup-controller';

async function getActiveTabHost(): Promise<string> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return '';
    const parsed = new URL(tab.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
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

async function bootstrap(): Promise<void> {
  try {
    const engine = new WebSpeechEngine();
    await initPopup({
      root: document,
      storage: getExtensionStorage(),
      getActiveTabHost,
      getAvailableVoices: () => engine.getVoices(),
      requestOriginPermission,
    });
  } catch {
    // Prevent unhandled promise rejection if popup closes mid-bootstrap.
  }
}

void bootstrap();
