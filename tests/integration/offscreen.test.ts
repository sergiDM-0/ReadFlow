import { describe, it, expect, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';

const { synthesizeMock, warmupMock, cancelPendingMock } = vi.hoisted(() => ({
  synthesizeMock: vi.fn(),
  warmupMock: vi.fn(),
  cancelPendingMock: vi.fn(),
}));

vi.mock('../../src/core/neural/piper-runtime', () => ({
  PiperRuntime: vi.fn(function () {
    return {
      synthesize: synthesizeMock,
      warmup: warmupMock,
      cancelPending: cancelPendingMock,
      dispose: vi.fn(),
    };
  }),
}));

describe('offscreen Piper neural document listener', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('ignores unauthorized senders and handles OFFSCREEN_PIPER_SYNTHESIZE cleanly', async () => {
    let listener: ((msg: unknown, sender: browser.Runtime.MessageSender) => unknown) | null = null;
    vi.mocked(browser.runtime.onMessage.addListener).mockImplementation((fn) => {
      listener = fn as (msg: unknown, sender: browser.Runtime.MessageSender) => unknown;
    });

    await import('../../src/offscreen/offscreen');
    expect(listener).not.toBeNull();

    // Unauthorized sender ignored
    expect(
      listener!(
        {
          type: 'OFFSCREEN_PIPER_SYNTHESIZE',
          payload: { text: 'Hola', voiceId: 'es_MX-claude-high' },
        },
        { id: 'foreign-ext' }
      )
    ).toBeUndefined();

    // Unrelated message type ignored
    expect(listener!({ type: 'COMMAND_STOP' }, { id: browser.runtime.id })).toBeUndefined();

    // Valid synthesis returns ok
    synthesizeMock.mockResolvedValueOnce({ mimeType: 'audio/wav', audioBase64: 'UklGRg==' });
    const okRes = await listener!(
      {
        type: 'OFFSCREEN_PIPER_SYNTHESIZE',
        payload: { text: 'Hola', voiceId: 'es_MX-claude-high' },
      },
      { id: browser.runtime.id }
    );
    expect(okRes).toEqual({
      ok: true,
      data: { mimeType: 'audio/wav', audioBase64: 'UklGRg==' },
    });

    // Runtime error returns ok: false
    synthesizeMock.mockRejectedValueOnce(new Error('WASM OOM'));
    const errRes = await listener!(
      {
        type: 'OFFSCREEN_PIPER_SYNTHESIZE',
        payload: { text: 'Hola', voiceId: 'es_MX-claude-high' },
      },
      { id: browser.runtime.id }
    );
    expect(errRes).toMatchObject({ ok: false, code: 'SYNTHESIS_FAILED', message: 'WASM OOM' });

    // Warmup succeeds and handles errors cleanly
    warmupMock.mockResolvedValueOnce(undefined);
    const warmupOk = await listener!(
      {
        type: 'OFFSCREEN_PIPER_WARMUP',
        payload: { voiceId: 'es_MX-claude-high' },
      },
      { id: browser.runtime.id }
    );
    expect(warmupOk).toEqual({ ok: true, data: { warmed: true } });

    warmupMock.mockRejectedValueOnce(new Error('Offline'));
    const warmupErr = await listener!(
      {
        type: 'OFFSCREEN_PIPER_WARMUP',
        payload: { voiceId: 'es_MX-claude-high' },
      },
      { id: browser.runtime.id }
    );
    expect(warmupErr).toMatchObject({ ok: false, code: 'SYNTHESIS_FAILED', message: 'Offline' });

    const cancelRes = await listener!(
      { type: 'OFFSCREEN_PIPER_CANCEL' },
      { id: browser.runtime.id }
    );
    expect(cancelRes).toEqual({ ok: true, data: { cancelled: true } });
    expect(cancelPendingMock).toHaveBeenCalledOnce();

    // OFFSCREEN_PLAY_AUDIO plays synthesized audio and cleans up on end or cancel
    let lastAudioInstance: {
      onended: (() => void) | null;
      onerror: (() => void) | null;
      play: () => Promise<void>;
      pause: () => void;
    } | null = null;
    const origAudio = globalThis.Audio;
    const origCreateObjectUrl = URL.createObjectURL;
    const origRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:offscreen-audio');
    URL.revokeObjectURL = vi.fn();
    globalThis.Audio = vi.fn(function () {
      const instance = {
        src: '',
        defaultPlaybackRate: 1,
        playbackRate: 1,
        onended: null as (() => void) | null,
        onerror: null as (() => void) | null,
        play: vi.fn().mockImplementation(async () => {
          setTimeout(() => instance.onended?.(), 5);
        }),
        pause: vi.fn(),
      };
      lastAudioInstance = instance;
      return instance;
    }) as unknown as typeof Audio;

    try {
      const playRes = await listener!(
        {
          type: 'OFFSCREEN_PLAY_AUDIO',
          payload: { mimeType: 'audio/wav', audioBase64: 'UklGRg==', rate: 1.25 },
        },
        { id: browser.runtime.id }
      );
      expect(playRes).toEqual({ ok: true, data: { played: true } });
      expect(lastAudioInstance).not.toBeNull();

      // Cancelling while playing settles the pending playAudioInOffscreen promise cleanly
      globalThis.Audio = vi.fn(function () {
        return {
          src: '',
          defaultPlaybackRate: 1,
          playbackRate: 1,
          onended: null,
          onerror: null,
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
        };
      }) as unknown as typeof Audio;

      const pendingPlay = listener!(
        {
          type: 'OFFSCREEN_PLAY_AUDIO',
          payload: { mimeType: 'audio/wav', audioBase64: 'UklGRg==', rate: 1 },
        },
        { id: browser.runtime.id }
      );
      await listener!({ type: 'OFFSCREEN_PIPER_CANCEL' }, { id: browser.runtime.id });
      await expect(pendingPlay).resolves.toEqual({ ok: true, data: { played: true } });

      // Playback rejection returns ok: false
      globalThis.Audio = vi.fn(function () {
        return {
          src: '',
          defaultPlaybackRate: 1,
          playbackRate: 1,
          onended: null,
          onerror: null,
          play: vi.fn().mockRejectedValue(new Error('Autoplay blocked')),
          pause: vi.fn(),
        };
      }) as unknown as typeof Audio;

      const errPlay = await listener!(
        {
          type: 'OFFSCREEN_PLAY_AUDIO',
          payload: { mimeType: 'audio/wav', audioBase64: 'UklGRg==', rate: 1 },
        },
        { id: browser.runtime.id }
      );
      expect(errPlay).toMatchObject({
        ok: false,
        code: 'SYNTHESIS_FAILED',
        message: 'Autoplay blocked',
      });

      // Audio onerror event also rejects cleanly
      globalThis.Audio = vi.fn(function () {
        const instance = {
          src: '',
          defaultPlaybackRate: 1,
          playbackRate: 1,
          onended: null as (() => void) | null,
          onerror: null as (() => void) | null,
          play: vi.fn().mockImplementation(async () => {
            setTimeout(() => instance.onerror?.(), 5);
          }),
          pause: vi.fn(),
        };
        return instance;
      }) as unknown as typeof Audio;

      const onErrorPlay = await listener!(
        {
          type: 'OFFSCREEN_PLAY_AUDIO',
          payload: { mimeType: '', audioBase64: 'UklGRg==', rate: 1 },
        },
        { id: browser.runtime.id }
      );
      expect(onErrorPlay).toMatchObject({
        ok: false,
        code: 'SYNTHESIS_FAILED',
      });
    } finally {
      globalThis.Audio = origAudio;
      URL.createObjectURL = origCreateObjectUrl;
      URL.revokeObjectURL = origRevokeObjectUrl;
    }
  });
});
