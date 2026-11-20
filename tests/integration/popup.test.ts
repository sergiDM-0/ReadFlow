import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initPopup } from '../../src/popup/popup-controller';
import { createStorageAdapter } from '../../src/shared/storage';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

function createPopupDom(): HTMLElement {
  const root = document.createElement('div');
  const htmlParts = [
    ['span', { id: 'brand-icon-slot' }],
    ['span', { id: 'preview-dock-icon' }],
    ['input', { id: 'toggle-enabled', type: 'checkbox' }],
    ['input', { id: 'toggle-domain-block', type: 'checkbox' }],
    ['span', { id: 'current-domain' }],
    ['textarea', { id: 'quick-read-input' }],
    ['button', { id: 'btn-quick-read', type: 'button' }],
    ['button', { id: 'btn-quick-stop', type: 'button' }],
    ['div', { id: 'quick-feedback' }],
    ['button', { id: 'tab-general', role: 'tab', 'data-tab': 'general', 'aria-selected': 'true' }],
    [
      'button',
      { id: 'tab-appearance', role: 'tab', 'data-tab': 'appearance', 'aria-selected': 'false' },
    ],
    [
      'button',
      { id: 'tab-advanced', role: 'tab', 'data-tab': 'advanced', 'aria-selected': 'false' },
    ],
    ['section', { id: 'panel-general', role: 'tabpanel', 'data-panel': 'general' }],
    ['section', { id: 'panel-appearance', role: 'tabpanel', 'data-panel': 'appearance' }],
    ['section', { id: 'panel-advanced', role: 'tabpanel', 'data-panel': 'advanced' }],
    ['div', { id: 'color-presets' }],
    ['div', { id: 'quick-color-presets' }],
    ['input', { id: 'quick-color-picker', type: 'color', value: '#2563eb' }],
    ['input', { id: 'input-icon-bg', type: 'color', value: '#2563eb' }],
    ['input', { id: 'input-icon-fg', type: 'color', value: '#ffffff' }],
    ['input', { id: 'input-accent-color', type: 'color', value: '#1d4ed8' }],
    ['span', { id: 'hex-icon-bg' }],
    ['span', { id: 'hex-icon-fg' }],
    ['span', { id: 'hex-accent-color' }],
    ['select', { id: 'select-theme' }],
    ['button', { id: 'btn-reset-appearance', type: 'button' }],
    ['select', { id: 'select-rate' }],
    ['select', { id: 'select-engine' }],
    ['select', { id: 'select-voice-es' }],
    ['select', { id: 'select-voice-en' }],
    ['input', { id: 'toggle-autoread-selection', type: 'checkbox' }],
    ['input', { id: 'toggle-gemini-autoread', type: 'checkbox' }],
    ['input', { id: 'toggle-omit-code', type: 'checkbox' }],
    ['input', { id: 'input-local-endpoint', type: 'url' }],
    ['select', { id: 'select-local-protocol' }],
    ['button', { id: 'btn-save-endpoint', type: 'button' }],
    ['div', { id: 'endpoint-feedback' }],
    ['div', { id: 'blocklist-status' }],
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

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'rate-pill';
    pill.setAttribute('data-rate', r);
    pill.textContent = `${r}x`;
    root.appendChild(pill);
  }

  const themeSelect = root.querySelector('#select-theme')!;
  for (const t of ['auto', 'light', 'dark']) {
    const opt = document.createElement('option');
    opt.value = t;
    themeSelect.appendChild(opt);
  }

  const engineSelect = root.querySelector('#select-engine')!;
  for (const e of ['piper-neural', 'web-speech', 'local-http']) {
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

    const requestOriginPermission = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const triggerQuickRead = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const stopActiveTabPlayback = vi.fn().mockResolvedValue(undefined);
    const warmupNeuralVoice = vi.fn();

    await initPopup({
      root: document,
      storage,
      getActiveTabHost: vi.fn().mockResolvedValue('news.example.com'),
      getAvailableVoices: vi.fn().mockResolvedValue([
        {
          id: 'v-es',
          name: 'Español Local',
          lang: 'es-ES',
          isLocal: true,
          isDefault: false,
          engine: 'web-speech',
        },
        {
          id: 'v-en',
          name: 'English Local',
          lang: 'en-US',
          isLocal: true,
          isDefault: true,
          engine: 'web-speech',
        },
      ]),
      requestOriginPermission,
      warmupNeuralVoice,
      triggerQuickRead,
      stopActiveTabPlayback,
    });

    expect(document.querySelector('#current-domain')?.textContent).toBe('news.example.com');
    expect(document.querySelector('#brand-icon-slot svg')).not.toBeNull();
    expect(document.querySelector('#preview-dock-icon svg')).not.toBeNull();

    // Quick-read box (Reverso style) reads explicit text and stops active tab playback
    const quickInput = document.querySelector('#quick-read-input') as HTMLTextAreaElement;
    const quickReadBtn = document.querySelector('#btn-quick-read') as HTMLButtonElement;
    const quickStopBtn = document.querySelector('#btn-quick-stop') as HTMLButtonElement;
    quickInput.value = 'Lectura rápida desde el panel del dock.';
    quickReadBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(triggerQuickRead).toHaveBeenCalledWith('Lectura rápida desde el panel del dock.');
    expect(document.querySelector('#quick-feedback')?.getAttribute('data-state')).toBe('ok');

    quickInput.value = '';
    quickReadBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('#quick-feedback')?.getAttribute('data-state')).toBe('error');

    quickStopBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(stopActiveTabPlayback).toHaveBeenCalledOnce();

    // Tab switching works cleanly
    (document.querySelector('#tab-appearance') as HTMLButtonElement).click();
    expect((document.querySelector('#panel-appearance') as HTMLElement).hidden).toBe(false);
    expect((document.querySelector('#panel-general') as HTMLElement).hidden).toBe(true);

    // Color preset + custom pickers + theme + reset update storage & live CSS custom properties
    const emeraldPreset = document.querySelector('[data-preset-id="emerald"]') as HTMLButtonElement;
    emeraldPreset.click();
    await new Promise((r) => setTimeout(r, 10));
    expect((await storage.getSettings()).appearance.iconBgColor).toBe('#059669');

    const iconBgInput = document.querySelector('#input-icon-bg') as HTMLInputElement;
    iconBgInput.value = '#7c3aed';
    iconBgInput.dispatchEvent(new Event('input'));
    const iconFgInput = document.querySelector('#input-icon-fg') as HTMLInputElement;
    iconFgInput.value = '#fef08a';
    iconFgInput.dispatchEvent(new Event('input'));
    const accentInput = document.querySelector('#input-accent-color') as HTMLInputElement;
    accentInput.value = '#6d28d9';
    accentInput.dispatchEvent(new Event('input'));
    const themeSel = document.querySelector('#select-theme') as HTMLSelectElement;
    themeSel.value = 'dark';
    themeSel.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 15));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect((await storage.getSettings()).appearance).toEqual({
      iconBgColor: '#7c3aed',
      iconFgColor: '#fef08a',
      accentColor: '#6d28d9',
    });

    // Quick color picker on the main General tab updates the unified icon + UI color in one step
    const quickColorInput = document.querySelector('#quick-color-picker') as HTMLInputElement;
    quickColorInput.value = '#e11d48';
    quickColorInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 10));
    expect((await storage.getSettings()).appearance).toEqual({
      iconBgColor: '#e11d48',
      iconFgColor: '#ffffff',
      accentColor: '#e11d48',
    });

    (document.querySelector('#btn-reset-appearance') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect((await storage.getSettings()).appearance).toEqual(DEFAULT_SETTINGS.appearance);
    expect((await storage.getSettings()).theme).toBe('auto');

    // Rate pill updates playback speed directly
    (document.querySelector('.rate-pill[data-rate="1.25"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect((await storage.getSettings()).defaultRate).toBe(1.25);

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

    // Permission denied surfaces error feedback without persisting
    endpointInput.value = 'http://localhost:8880/v1/audio/speech';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('#endpoint-feedback')?.getAttribute('data-state')).toBe('error');

    // Valid loopback endpoint with granted permission is saved
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('#endpoint-feedback')?.getAttribute('data-state')).toBe('ok');
    expect(endpointInput.hasAttribute('aria-invalid')).toBe(false);
    saved = await storage.getSettings();
    expect(saved.localHttp.endpointUrl).toBe('http://localhost:8880/v1/audio/speech');

    // Default engine is piper-neural -> dropdown offers smooth Piper neural voices
    const esSel = document.querySelector('#select-voice-es') as HTMLSelectElement;
    esSel.value = 'es_ES-sharvard-medium';
    esSel.dispatchEvent(new Event('change'));

    const enSel = document.querySelector('#select-voice-en') as HTMLSelectElement;
    enSel.value = 'en_US-amy-medium';
    enSel.dispatchEvent(new Event('change'));

    // Update other controls and remove domain from list
    const rateSel = document.querySelector('#select-rate') as HTMLSelectElement;
    rateSel.value = '1.5';
    rateSel.dispatchEvent(new Event('change'));

    const engineSel = document.querySelector('#select-engine') as HTMLSelectElement;
    engineSel.value = 'local-http';
    engineSel.dispatchEvent(new Event('change'));

    const autoSelCb = document.querySelector('#toggle-autoread-selection') as HTMLInputElement;
    autoSelCb.checked = true;
    autoSelCb.dispatchEvent(new Event('change'));

    const geminiCb = document.querySelector('#toggle-gemini-autoread') as HTMLInputElement;
    geminiCb.checked = true;
    geminiCb.dispatchEvent(new Event('change'));

    const codeCb = document.querySelector('#toggle-omit-code') as HTMLInputElement;
    codeCb.checked = false;
    codeCb.dispatchEvent(new Event('change'));

    const removeBtn = document.querySelector('.remove-domain-btn') as HTMLButtonElement;
    removeBtn?.click();

    const enabledCb = document.querySelector('#toggle-enabled') as HTMLInputElement;
    enabledCb.checked = false;
    enabledCb.dispatchEvent(new Event('change'));

    await new Promise((r) => setTimeout(r, 10));
    saved = await storage.getSettings();
    expect(saved.enabled).toBe(false);
    expect(saved.defaultRate).toBe(1.5);
    expect(saved.engine).toBe('local-http');
    expect(saved.voicePreferences.es).toBe('es_ES-sharvard-medium');
    expect(saved.voicePreferences.en).toBe('en_US-amy-medium');
    expect(saved.autoReadSelection).toBe(true);
    expect(saved.geminiAutoRead).toBe(true);
    expect(saved.omitCodeBlocks).toBe(false);
    expect(saved.blockedDomains).not.toContain('news.example.com');
  });
});
