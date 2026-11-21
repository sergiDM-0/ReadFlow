import { describe, it, expect, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';

const { piperSynthesizeMock, piperWarmupMock, piperCancelMock } = vi.hoisted(() => ({
  piperSynthesizeMock: vi
    .fn()
    .mockResolvedValue({ mimeType: 'audio/wav', audioBase64: 'UklGRg==' }),
  piperWarmupMock: vi.fn().mockResolvedValue(undefined),
  piperCancelMock: vi.fn(),
}));

vi.mock('../../src/core/neural/piper-runtime', () => ({
  PiperRuntime: vi.fn().mockImplementation(() => ({
    synthesize: piperSynthesizeMock,
    warmup: piperWarmupMock,
    cancelPending: piperCancelMock,
  })),
}));

describe('service-worker entrypoint wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registers context menu, keyboard shortcut, and runtime message listeners', async () => {
    const installedListeners: Array<() => void> = [];
    const commandListeners: Array<(cmd: string) => void> = [];
    const menuListeners: Array<
      (info: { menuItemId: string; selectionText?: string }, tab?: { id?: number }) => void
    > = [];
    const messageListeners: Array<
      (msg: unknown, sender: browser.Runtime.MessageSender) => unknown
    > = [];

    (
      browser.runtime as unknown as { onInstalled: { addListener: ReturnType<typeof vi.fn> } }
    ).onInstalled = {
      addListener: vi.fn((fn: () => void) => installedListeners.push(fn)),
    };
    const startupListeners: Array<() => void> = [];
    (
      browser.runtime as unknown as { onStartup: { addListener: ReturnType<typeof vi.fn> } }
    ).onStartup = {
      addListener: vi.fn((fn: () => void) => startupListeners.push(fn)),
    };
    vi.mocked(browser.commands.onCommand.addListener).mockImplementation((fn) => {
      commandListeners.push(fn as (cmd: string) => void);
    });
    vi.mocked(browser.contextMenus.onClicked.addListener).mockImplementation((fn) => {
      menuListeners.push(
        fn as (info: { menuItemId: string; selectionText?: string }, tab?: { id?: number }) => void
      );
    });
    vi.mocked(browser.runtime.onMessage.addListener).mockImplementation((fn) => {
      messageListeners.push(fn as (msg: unknown, sender: browser.Runtime.MessageSender) => unknown);
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 42 } as browser.Tabs.Tab]);

    await import('../../src/background/service-worker');

    // Trigger onInstalled & onStartup -> registers context menu
    installedListeners.forEach((fn) => fn());
    startupListeners.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(browser.contextMenus.removeAll).toHaveBeenCalled();
    expect(browser.contextMenus.create).toHaveBeenCalled();

    // Unknown command and menu ID are cleanly ignored
    commandListeners.forEach((fn) => fn('unknown-command'));
    menuListeners.forEach((fn) => fn({ menuItemId: 'other-menu' }, { id: 99 }));

    // Trigger Alt+S shortcut
    commandListeners.forEach((fn) => fn('toggle-read-selection'));
    await new Promise((r) => setTimeout(r, 0));
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'shortcut', text: undefined },
    });

    // Trigger context menu click
    menuListeners.forEach((fn) =>
      fn(
        { menuItemId: 'readflow-read-selection', selectionText: 'Texto seleccionado' },
        { id: 99 }
      )
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(99, {
      type: 'COMMAND_TOGGLE_READ',
      payload: { source: 'context-menu', text: 'Texto seleccionado' },
    });

    // If active tab has no content script (e.g. native PDF viewer), context menu falls back to background playback
    const origAudio = globalThis.Audio;
    const origCreateObjectUrl = URL.createObjectURL;
    const origRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:bg-audio');
    URL.revokeObjectURL = vi.fn();
    globalThis.Audio = vi.fn().mockImplementation(() => {
      const instance = {
        playbackRate: 1,
        onended: null as (() => void) | null,
        onerror: null as (() => void) | null,
        play: vi.fn().mockImplementation(async () => {
          setTimeout(() => instance.onended?.(), 5);
        }),
      };
      return instance;
    }) as unknown as typeof Audio;

    try {
      // Trigger context menu click without frameId
      menuListeners.forEach((fn) =>
        fn({ menuItemId: 'readflow-read-selection', selectionText: 'Sin frameId' }, { id: 105 })
      );
      await new Promise((r) => setTimeout(r, 10));

      vi.mocked(browser.tabs.sendMessage).mockRejectedValueOnce(new Error('No receiving end'));
      menuListeners.forEach((fn) =>
        fn(
          {
            menuItemId: 'readflow-read-selection',
            selectionText: 'Texto en PDF nativo',
            frameId: 0,
          } as { menuItemId: string; selectionText?: string },
          { id: 105 }
        )
      );
      await new Promise((r) => setTimeout(r, 25));
      expect(piperSynthesizeMock).toHaveBeenCalled();
    } finally {
      globalThis.Audio = origAudio;
      URL.createObjectURL = origCreateObjectUrl;
      URL.revokeObjectURL = origRevokeObjectUrl;
    }

    // Trigger runtime onMessage
    const res = await messageListeners[0]?.(
      { type: 'DETECT_LANGUAGE', payload: { text: 'Hello world' } },
      { id: browser.runtime.id }
    );
    expect(res).toMatchObject({ ok: true });

    // Background ignores OFFSCREEN_PIPER_SYNTHESIZE and OFFSCREEN_PIPER_WARMUP (intended for offscreen.html)
    const ignored = messageListeners[0]?.(
      { type: 'OFFSCREEN_PIPER_SYNTHESIZE', payload: { text: 'Hi', voiceId: 'es_MX-claude-high' } },
      { id: browser.runtime.id }
    );
    expect(ignored).toBeUndefined();
    const ignoredWarmup = messageListeners[0]?.(
      { type: 'OFFSCREEN_PIPER_WARMUP', payload: { voiceId: 'es_MX-claude-high' } },
      { id: browser.runtime.id }
    );
    expect(ignoredWarmup).toBeUndefined();

    // Firefox path warmup ran on startup/install
    expect(piperWarmupMock).toHaveBeenCalled();

    // Chrome offscreen path for NEURAL_TTS_SYNTHESIZE and NEURAL_TTS_WARMUP
    const createDocument = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { chrome?: unknown }).chrome = {
      offscreen: { hasDocument: vi.fn().mockResolvedValue(false), createDocument },
    };
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({
        ok: true,
        data: { mimeType: 'audio/wav', audioBase64: 'UklGRg==' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { warmed: true },
      });
    const neuralRes = await messageListeners[0]?.(
      { type: 'NEURAL_TTS_SYNTHESIZE', payload: { text: 'Hola', lang: 'es', rate: 1 } },
      { id: browser.runtime.id }
    );
    expect(createDocument).toHaveBeenCalledOnce();
    expect(neuralRes).toMatchObject({ ok: true });

    const warmupRes = await messageListeners[0]?.(
      { type: 'NEURAL_TTS_WARMUP', payload: { lang: 'es' } },
      { id: browser.runtime.id }
    );
    expect(warmupRes).toMatchObject({ ok: true, data: { voiceId: 'es_MX-claude-high' } });

    const cancelRes = await messageListeners[0]?.(
      { type: 'NEURAL_TTS_CANCEL' },
      { id: browser.runtime.id }
    );
    expect(cancelRes).toEqual({ ok: true, data: { cancelled: true } });

    // Also test Chrome offscreen background playback fallback when tabs.sendMessage rejects
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      ok: true,
      data: { mimeType: 'audio/wav', audioBase64: 'UklGRg==' },
    });
    vi.mocked(browser.tabs.sendMessage).mockRejectedValueOnce(new Error('No receiving end'));
    menuListeners.forEach((fn) =>
      fn(
        { menuItemId: 'readflow-read-selection', selectionText: 'Texto en PDF Chrome' },
        { id: 108 }
      )
    );
    await new Promise((r) => setTimeout(r, 25));
    const playCalls = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.filter((c) => (c[0] as { type?: string })?.type === 'OFFSCREEN_PLAY_AUDIO');
    expect(playCalls.length).toBeGreaterThanOrEqual(1);

    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });
});
