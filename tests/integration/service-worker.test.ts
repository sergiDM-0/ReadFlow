import { describe, it, expect, vi } from 'vitest';
import { handleRuntimeMessage } from '../../src/background/message-handler';

describe('background message handler', () => {
  it('rejects messages from foreign extension sender IDs', async () => {
    const result = await handleRuntimeMessage(
      { type: 'DETECT_LANGUAGE', payload: { text: 'Hola mundo' } },
      { id: 'malicious-ext' },
      { runtimeId: 'echoselect-test-id' }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNAUTHORIZED_SENDER');
    }
  });

  it('detects language via browser.i18n.detectLanguage', async () => {
    const detectLanguage = vi.fn().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'es', percentage: 98 }],
    });
    const result = await handleRuntimeMessage(
      { type: 'DETECT_LANGUAGE', payload: { text: 'Hola mundo desde EchoSelect' } },
      { id: 'echoselect-test-id' },
      { runtimeId: 'echoselect-test-id', detectLanguage }
    );
    expect(result).toEqual({
      ok: true,
      data: { lang: 'es', confidence: 98, isReliable: true },
    });
  });

  it('blocks non-localhost URLs on LOCAL_TTS_SYNTHESIZE to prevent SSRF/data leak', async () => {
    const fetchFn = vi.fn();
    const result = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'https://remote.attacker.com/exfil',
          protocol: 'piper',
          text: 'Private selected text',
          rate: 1,
        },
      },
      { id: 'echoselect-test-id' },
      { runtimeId: 'echoselect-test-id', fetchFn }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_ENDPOINT');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches audio safely from localhost endpoint with redirect: error', async () => {
    const audioBytes = new Uint8Array([82, 73, 70, 70]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/wav' }),
      arrayBuffer: async () => audioBytes.buffer,
    });

    const result = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:5000/tts',
          protocol: 'piper',
          text: 'Hola local',
          rate: 1.25,
        },
      },
      { id: 'echoselect-test-id' },
      { runtimeId: 'echoselect-test-id', fetchFn }
    );

    expect(fetchFn).toHaveBeenCalledOnce();
    const initArg = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(initArg.redirect).toBe('error');
    expect(initArg.credentials).toBe('omit');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { mimeType: string; audioBase64: string };
      expect(data.mimeType).toBe('audio/wav');
      expect(data.audioBase64).toBe('UklGRg==');
    }
  });
});
