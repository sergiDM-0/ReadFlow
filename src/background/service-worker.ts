import browser from 'webextension-polyfill';
import { handleRuntimeMessage } from './message-handler';

const CONTEXT_MENU_ID = 'echoselect-read-selection';

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
});

browser.runtime.onStartup?.addListener(() => {
  registerContextMenu();
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
  return handleRuntimeMessage(message, sender, {
    runtimeId: browser.runtime.id,
    detectLanguage: browser.i18n?.detectLanguage
      ? (text) => browser.i18n.detectLanguage(text)
      : undefined,
  });
});
