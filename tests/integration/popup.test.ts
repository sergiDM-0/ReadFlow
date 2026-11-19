import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initPopup } from '../../src/popup/popup-controller';
import { createStorageAdapter } from '../../src/shared/storage';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

function createPopupDom(): HTMLElement {
  const root = document.createElement('div');
  const htmlParts = [
    ['input', { id: 'toggle-enabled', type: 'checkbox' }],
    ['input', { id: 'toggle-domain-block', type: 'checkbox' }],
    ['span', { id: 'current-domain' }],
    ['select', { id: 'select-rate' }],
    ['select', { id: 'select-engine' }],
    ['select', { id: 'select-voice-es' }],
    ['select', { id: 'select-voice-en' }],
    ['input', { id: 'toggle-gemini-autoread', type: 'checkbox' }],
    ['input', { id: 'toggle-omit-code', type: 'checkbox' }],
    ['input', { id: 'input-local-endpoint', type: 'url' }],
    ['select', { id: 'select-local-protocol' }],
    ['button', { id: 'btn-save-endpoint', type: 'button' }],
    ['div', { id: 'endpoint-feedback' }],
    ['ul', { id: 'blocked-domains-list' }],
  ] as const;

  for (const [tag, attrs] of htmlParts) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    root.appendChild(el);
  }

  const rateSelect = root.querySelector('#select-rate')!;
  for (const r of ['0.75', '1', '1.25', '1.5', '2']) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = `${r}x`;
    rateSelect.appendChild(opt);
  }

  const engineSelect = root.querySelector('#select-engine')!;
  for (const e of ['web-speech', 'local-http']) {
    const opt = document.createElement('option');
    opt.value = e;
    engineSelect.appendChild(opt);
  }

  const protocolSelect = root.querySelector('#select-local-protocol')!;
  for (const p of ['piper', 'kokoro-openai']) {
    const opt = document.createElement('option');
    opt.value = p;
    protocolSelect.appendChild(opt);
  }

  document.body.textContent = '';
  document.body.appendChild(root);
  return root;
}

describe('popup controller', () => {
  beforeEach(() => {
    createPopupDom();
  });

  it('hydrates settings, toggles domain blocklist, and validates localhost endpoint', async () => {
    const store: Record<string, unknown> = {};
    const storage = createStorageAdapter({
      get: async (k) => ({ [k]: store[k] }),
      set: async (items) => {
        Object.assign(store, items);
      },
    });

    await initPopup({
      root: document,
      storage,
      getActiveTabHost: vi.fn().mockResolvedValue('news.example.com'),
      getAvailableVoices: vi.fn().mockResolvedValue([
        { id: 'v-es', name: 'Español Local', lang: 'es-ES', isLocal: true, isDefault: false, engine: 'web-speech' },
        { id: 'v-en', name: 'English Local', lang: 'en-US', isLocal: true, isDefault: true, engine: 'web-speech' },
      ]),
    });

    expect(document.querySelector('#current-domain')?.textContent).toBe('news.example.com');

    // Toggle domain block
    const blockCheckbox = document.querySelector('#toggle-domain-block') as HTMLInputElement;
    blockCheckbox.checked = true;
    blockCheckbox.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));

    let saved = await storage.getSettings();
    expect(saved.blockedDomains).toContain('news.example.com');

    // Invalid remote endpoint is rejected with feedback and NOT persisted
    const endpointInput = document.querySelector('#input-local-endpoint') as HTMLInputElement;
    const saveBtn = document.querySelector('#btn-save-endpoint') as HTMLButtonElement;
    endpointInput.value = 'https://evil.example/tts';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('#endpoint-feedback')?.getAttribute('data-state')).toBe('error');
    saved = await storage.getSettings();
    expect(saved.localHttp.endpointUrl).toBe(DEFAULT_SETTINGS.localHttp.endpointUrl);

    // Valid loopback endpoint is saved
    endpointInput.value = 'http://localhost:8880/v1/audio/speech';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('#endpoint-feedback')?.getAttribute('data-state')).toBe('ok');
    saved = await storage.getSettings();
    expect(saved.localHttp.endpointUrl).toBe('http://localhost:8880/v1/audio/speech');
  });
});
