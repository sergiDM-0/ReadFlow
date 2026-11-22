import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import browser from 'webextension-polyfill';
import { ReadFlowContentApp } from '../../src/content/app';
import { SETTINGS_STORAGE_KEY } from '../../src/shared/storage';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

describe('ReadFlowContentApp integration', () => {
  let messageListener: ((msg: unknown) => unknown) | null = null;
  let storageChangeListener: ((changes: Record<string, unknown>) => void) | null = null;
  let mockUtterances: Array<{ text: string; onend: (() => void) | null }> = [];

  class FakeUtterance {
    public text: string;
    public lang = '';
    public rate = 1;
    public pitch = 1;
    public volume = 1;
    public voice: SpeechSynthesisVoice | null = null;
    public onend: (() => void) | null = null;
    public onerror: ((ev: { error: string }) => void) | null = null;
    public constructor(text: string) {
      this.text = text;
    }
  }

  beforeEach(() => {
    document.body.textContent = '';
    document.querySelectorAll('readflow-ui').forEach((el) => el.remove());
    mockUtterances = [];
    messageListener = null;
    storageChangeListener = null;

    vi.mocked(browser.storage.sync.get).mockResolvedValue({
      [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, engine: 'web-speech' },
    });
    vi.mocked(browser.runtime.onMessage.addListener).mockImplementation((fn) => {
      messageListener = fn as (msg: unknown) => unknown;
    });
    vi.mocked(browser.storage.onChanged.addListener).mockImplementation((fn) => {
      storageChangeListener = fn as (changes: Record<string, unknown>) => void;
    });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      ok: true,
      data: { lang: 'es', confidence: 98, isReliable: true },
    });

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        paused: false,
        getVoices: () => [
          {
            voiceURI: 'es-local',
            name: 'Local ES',
            lang: 'es-ES',
            localService: true,
            default: true,
          },
        ],
        speak: (u: FakeUtterance) => {
          mockUtterances.push(u);
        },
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeUtterance,
    });
  });

  afterEach(() => {
    document.querySelectorAll('readflow-ui').forEach((el) => el.remove());
    vi.clearAllMocks();
  });

  it('mounts Shadow DOM, speaks on COMMAND_TOGGLE_READ, stops on COMMAND_STOP, and tears down when disabled', async () => {
    const app = new ReadFlowContentApp();
    await app.start();

    expect(document.querySelector('readflow-ui')).not.toBeNull();
    expect(messageListener).not.toBeNull();

    // Start reading via explicit command text
    const startPromise = messageListener!({
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'context-menu', text: 'Primera frase. Segunda frase.' },
    }) as Promise<{ ok: boolean; data: { active: boolean } }>;

    await new Promise((r) => setTimeout(r, 10));
    expect(mockUtterances.length).toBeGreaterThanOrEqual(1);
    expect(mockUtterances[0]?.text).toBe('Primera frase.');

    // Exercise mini-player buttons wired through ReadFlowContentApp
    const shadow = document.querySelector('readflow-ui')?.shadowRoot;
    (shadow?.querySelector('[data-es-action="toggle"]') as HTMLButtonElement | null)?.click();
    (shadow?.querySelector('[data-es-action="toggle"]') as HTMLButtonElement | null)?.click();
    (shadow?.querySelector('[data-es-action="next"]') as HTMLButtonElement | null)?.click();
    (shadow?.querySelector('[data-es-action="prev"]') as HTMLButtonElement | null)?.click();
    (shadow?.querySelector('[data-es-action="rate"]') as HTMLButtonElement | null)?.click();
    await new Promise((r) => setTimeout(r, 10));

    // Query playback state & verify invalid/unknown messages are ignored cleanly
    expect(messageListener!(null)).toBeUndefined();
    expect(messageListener!({ type: 'UNKNOWN_MESSAGE' })).toBeUndefined();

    const stateRes = (await messageListener!({ type: 'GET_TAB_PLAYBACK_STATE' })) as {
      ok: boolean;
      data: { state: { status: string } };
    };
    expect(stateRes.ok).toBe(true);
    expect(stateRes.data.state.status).toBe('playing');

    // Second COMMAND_TOGGLE_READ while playing stops playback
    const toggleOff = (await messageListener!({
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'shortcut' },
    })) as { ok: boolean; data: { active: boolean } };
    expect(toggleOff.data.active).toBe(false);
    await startPromise;

    // Empty toggle command is a clean no-op
    const emptyToggle = (await messageListener!({
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'shortcut', text: '   ' },
    })) as { ok: boolean; data: { active: boolean } };
    expect(emptyToggle.data.active).toBe(false);

    // COMMAND_STOP works cleanly
    await messageListener!({ type: 'COMMAND_STOP' });

    const afterStop = (await messageListener!({ type: 'GET_TAB_PLAYBACK_STATE' })) as {
      ok: boolean;
      data: { state: { status: string } };
    };
    expect(afterStop.data.state.status).toBe('idle');

    // Disable globally via storage.onChanged -> UI tears down cleanly
    storageChangeListener?.({
      [SETTINGS_STORAGE_KEY]: {
        newValue: { ...DEFAULT_SETTINGS, enabled: false },
      },
    });
    expect(document.querySelector('readflow-ui')).toBeNull();

    // Toggle command when disabled returns inactive
    const disabledToggle = (await messageListener!({
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'shortcut', text: 'Ignored' },
    })) as { ok: boolean; data: { active: boolean } };
    expect(disabledToggle.data.active).toBe(false);

    // Re-enable with local-http engine and dark theme, then update theme again while mounted
    storageChangeListener?.({
      [SETTINGS_STORAGE_KEY]: {
        newValue: { ...DEFAULT_SETTINGS, enabled: true, theme: 'dark', engine: 'local-http' },
      },
    });
    expect(document.querySelector('readflow-ui')?.getAttribute('data-theme')).toBe('dark');

    storageChangeListener?.({
      [SETTINGS_STORAGE_KEY]: {
        newValue: { ...DEFAULT_SETTINGS, enabled: true, theme: 'light', engine: 'web-speech' },
      },
    });
    expect(document.querySelector('readflow-ui')?.getAttribute('data-theme')).toBe('light');

    app.destroy();
    expect(document.querySelector('readflow-ui')).toBeNull();
  });

  it('mounts Gemini auto-read toggle pill on gemini.google.com and toggles cleanly', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname: 'gemini.google.com' },
    });

    try {
      const app = new ReadFlowContentApp();
      await app.start();

      const shadow = document.querySelector('readflow-ui')?.shadowRoot;
      const pill = shadow?.querySelector(
        'button[data-es-role="gemini-autoread-toggle"]'
      ) as HTMLButtonElement | null;
      expect(pill).not.toBeNull();
      expect(pill?.getAttribute('aria-pressed')).toBe('false');

      pill?.click();
      expect(pill?.getAttribute('aria-pressed')).toBe('true');
      expect(pill?.querySelectorAll('svg')).toHaveLength(1);
      expect(pill?.querySelector('.es-pill-badge')?.textContent).toBe('ON');

      // Append a Gemini response node to trigger GeminiAdapter -> enqueueStreamingSentences
      const responseNode = document.createElement('model-response');
      const md = document.createElement('div');
      md.className = 'markdown';
      const para = document.createElement('p');
      para.textContent = 'Hola desde Gemini en streaming automático.';
      md.appendChild(para);
      responseNode.appendChild(md);
      document.body.appendChild(responseNode);
      await new Promise((r) => setTimeout(r, 80));

      pill?.click();
      expect(pill?.getAttribute('aria-pressed')).toBe('false');
      expect(pill?.querySelectorAll('svg')).toHaveLength(1);
      expect(pill?.querySelector('.es-pill-badge')?.textContent).toBe('OFF');

      app.destroy();
      responseNode.remove();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('auto-reads any selected text immediately when Auto-lectura is ON without duplicating icons', async () => {
    const app = new ReadFlowContentApp();
    await app.start();

    const shadow = document.querySelector('readflow-ui')?.shadowRoot;
    const pill = shadow?.querySelector(
      'button[data-es-role="gemini-autoread-toggle"]'
    ) as HTMLButtonElement | null;
    expect(pill).not.toBeNull();
    expect(pill?.querySelectorAll('svg')).toHaveLength(1);

    // Enable Auto-lectura
    pill?.click();
    expect(pill?.getAttribute('aria-pressed')).toBe('true');
    expect(pill?.querySelectorAll('svg')).toHaveLength(1);

    // Simulate selecting text on the page
    const p = document.createElement('p');
    p.textContent = 'Texto seleccionado para lectura automática inmediata.';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    range.getBoundingClientRect = () =>
      ({ top: 100, left: 100, right: 300, bottom: 120, width: 200, height: 20 }) as DOMRect;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));

    expect(mockUtterances.length).toBeGreaterThanOrEqual(1);
    expect(mockUtterances[0]?.text).toContain('Texto seleccionado');
    // Floating trigger stays hidden when auto-reading
    const triggerBtn = shadow?.querySelector(
      'button[data-es-role="floating-trigger"]'
    ) as HTMLButtonElement | null;
    expect(triggerBtn?.hidden).toBe(true);

    // Minimize Auto-Read dock to orb and snap corner via keyboard (persists through ReadFlowContentApp)
    const collapseBtn = shadow?.querySelector(
      'button[data-es-role="autoread-collapse"]'
    ) as HTMLButtonElement | null;
    collapseBtn?.click();
    pill?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(
      shadow?.querySelector('[data-es-role="autoread-dock"]')?.getAttribute('data-minimized')
    ).toBe('true');
    expect(
      shadow?.querySelector('[data-es-role="autoread-dock"]')?.getAttribute('data-corner')
    ).toBe('top-right');

    app.destroy();
  });

  it('uses piper-neural as default engine and handles neural transport errors cleanly', async () => {
    vi.mocked(browser.storage.sync.get).mockResolvedValue({
      [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS },
    });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (msg: unknown) => {
      const m = msg as { type: string };
      if (m.type === 'DETECT_LANGUAGE') {
        return { ok: true, data: { lang: 'es', confidence: 99, isReliable: true } };
      }
      return { ok: false, code: 'SYNTHESIS_FAILED', message: 'Offline model unavailable' };
    });

    const app = new ReadFlowContentApp();
    await app.start();

    await messageListener!({
      type: 'COMMAND_TOGGLE_READ',
      payload: {
        source: 'shortcut',
        text: 'Cuando seleccionas una oración larga para leer, el motor neuronal divide la primera cláusula corta y reproduce casi al instante.',
      },
    });

    // Verify fast-start streaming chunking sent a short opening micro-chunk (<= 48 chars) first
    const synthCall = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.find((c) => (c[0] as { type?: string })?.type === 'NEURAL_TTS_SYNTHESIZE');
    expect(synthCall).toBeDefined();
    const sentText = (synthCall?.[0] as { payload: { text: string } }).payload.text;
    expect(sentText).toBe('Cuando seleccionas una oración larga para leer,');
    expect(sentText.length).toBeLessThanOrEqual(48);

    const stateRes = (await messageListener!({ type: 'GET_TAB_PLAYBACK_STATE' })) as {
      ok: boolean;
      data: { state: { status: string } };
    };
    expect(stateRes.data.state.status).toBe('error');

    // Empty text in COMMAND_TOGGLE_READ with collapsed selection returns active: false cleanly
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      toString: () => '',
    } as unknown as Selection);
    const emptyRes = (await messageListener!({
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'shortcut', text: '   ' },
    })) as { ok: boolean; data: { active: boolean } };
    expect(emptyRes).toEqual({ ok: true, data: { active: false } });

    // Exercise MiniPlayer controls & rate callback mounted by ReadFlowContentApp
    const shadow = document.querySelector('readflow-ui')?.shadowRoot;
    (shadow?.querySelector('[data-es-action="prev"]') as HTMLButtonElement | null)?.click();
    (shadow?.querySelector('[data-es-action="next"]') as HTMLButtonElement | null)?.click();
    (shadow?.querySelector('[data-es-action="toggle"]') as HTMLButtonElement | null)?.click();
    const rateSel = shadow?.querySelector('[data-es-action="rate"]') as HTMLSelectElement | null;
    if (rateSel) {
      rateSel.value = '1.5';
      rateSel.dispatchEvent(new Event('change'));
    }
    (shadow?.querySelector('[data-es-action="stop"]') as HTMLButtonElement | null)?.click();

    // Simulate selecting text with autoReadSelection disabled -> shows FloatingButton, triggers warmup, and speaks on click
    const selP = document.createElement('p');
    selP.textContent =
      'Texto de prueba para calentar el motor neuronal y activar el botón flotante.';
    document.body.appendChild(selP);
    const selRange = document.createRange();
    selRange.selectNodeContents(selP);
    selRange.getClientRects = () =>
      [
        { top: 10, left: 10, right: 180, bottom: 28, width: 170, height: 18 },
      ] as unknown as DOMRectList;
    const getSelSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => selP.textContent ?? '',
      getRangeAt: () => selRange,
    } as unknown as Selection);
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 20, bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));

    const triggerBtn = document
      .querySelector('readflow-ui')
      ?.shadowRoot?.querySelector(
        'button[data-es-role="floating-trigger"]'
      ) as HTMLButtonElement | null;
    expect(triggerBtn?.hidden).toBe(false);
    triggerBtn?.click();
    await new Promise((r) => setTimeout(r, 20));
    getSelSpy.mockRestore();
    selP.remove();

    // Switching engine setting to local-http refreshes engine cleanly
    const storageListener = vi.mocked(browser.storage.onChanged.addListener).mock.calls[0]?.[0] as
      ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | undefined;
    storageListener?.(
      {
        [SETTINGS_STORAGE_KEY]: {
          newValue: { ...DEFAULT_SETTINGS, engine: 'local-http', defaultRate: 1.5 },
        },
      },
      'sync'
    );
    app.destroy();
  });

  it('continues playing uninterrupted without pausing or restarting when clicking elsewhere after selecting text', async () => {
    vi.mocked(browser.storage.sync.get).mockResolvedValue({
      [SETTINGS_STORAGE_KEY]: {
        ...DEFAULT_SETTINGS,
        engine: 'web-speech',
        autoReadSelection: true,
      },
    });

    const p = document.createElement('p');
    p.textContent = 'Texto seleccionado para leer sin interrupciones al hacer clic fuera.';
    document.body.appendChild(p);

    const range = document.createRange();
    range.selectNodeContents(p);
    range.getClientRects = () =>
      [
        { top: 10, left: 10, right: 120, bottom: 28, width: 110, height: 18 },
      ] as unknown as DOMRectList;
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => p.textContent ?? '',
      getRangeAt: () => range,
    } as unknown as Selection);

    const app = new ReadFlowContentApp();
    await app.start();

    // 1. Initial selection triggers Auto-Read playback
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 20, bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUtterances.length).toBeGreaterThanOrEqual(1);
    const initialCalls = mockUtterances.length;
    const cancelSpy = vi.spyOn(window.speechSynthesis, 'cancel');
    cancelSpy.mockClear();

    // 2. Clicking elsewhere (mousedown -> onClear, then mouseup with residual selection) must NOT pause/cancel or restart
    document.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 300, clientY: 300, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 300, clientY: 300, bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(mockUtterances.length).toBe(initialCalls);
    const stateRes = (await messageListener!({ type: 'GET_TAB_PLAYBACK_STATE' })) as {
      ok: boolean;
      data: { state: { status: string } };
    };
    expect(stateRes.data.state.status).toBe('playing');

    app.destroy();
  });
});
