import { describe, it, expect, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';

const { synthesizeMock } = vi.hoisted(() => ({
  synthesizeMock: vi.fn(),
}));

vi.mock('../../src/core/neural/piper-runtime', () => ({
  PiperRuntime: vi.fn().mockImplementation(() => ({
    synthesize: synthesizeMock,
  })),
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
  });
});
