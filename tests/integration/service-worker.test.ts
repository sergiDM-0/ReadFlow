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

  it('handles malformed messages, unsupported types, kokoro protocol, and local HTTP failure cases', async () => {
    const badMsg = await handleRuntimeMessage(null, { id: 'ext' }, { runtimeId: 'ext' });
    expect(badMsg.ok).toBe(false);

    const unsupported = await handleRuntimeMessage(
      { type: 'COMMAND_STOP' },
      { id: 'ext' },
      { runtimeId: 'ext' }
    );
    expect(unsupported.ok).toBe(false);

    // Kokoro OpenAI-compatible protocol + HTTP 500 error
    const failFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const httpErr = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://localhost:8880/v1/audio/speech',
          protocol: 'kokoro-openai',
          text: 'Hello',
          rate: 1,
        },
      },
      { id: 'ext' },
      { runtimeId: 'ext', fetchFn: failFetch }
    );
    expect(httpErr.ok).toBe(false);

    // Non-audio content type rejected
    const htmlFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
    });
    const badMime = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:5000/tts',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
        },
      },
      { id: 'ext' },
      { runtimeId: 'ext', fetchFn: htmlFetch }
    );
    expect(badMime.ok).toBe(false);

    // Empty body rejected
    const emptyFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/wav' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const emptyRes = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:5000/tts',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
        },
      },
      { id: 'ext' },
      { runtimeId: 'ext', fetchFn: emptyFetch }
    );
    expect(emptyRes.ok).toBe(false);

    // Network failure
    const netFailFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const netRes = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:5000/tts',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
        },
      },
      { id: 'ext' },
      { runtimeId: 'ext', fetchFn: netFailFetch }
    );
    expect(netRes.ok).toBe(false);
    if (!netRes.ok) {
      expect(netRes.code).toBe('NETWORK_BLOCKED');
    }

    // Timeout abort error
    const abortFetch = vi.fn().mockRejectedValue(new DOMException('Timeout', 'AbortError'));
    const abortRes = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:5000/tts',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
          timeoutMs: 2000,
        },
      },
      { id: 'ext' },
      { runtimeId: 'ext', fetchFn: abortFetch }
    );
    expect(abortRes.ok).toBe(false);
    if (!abortRes.ok) {
      expect(abortRes.code).toBe('TIMEOUT');
    }

    // DETECT_LANGUAGE blank text & failure
    const blankDetect = await handleRuntimeMessage(
      { type: 'DETECT_LANGUAGE', payload: { text: '   ' } },
      { id: 'ext' },
      { runtimeId: 'ext' }
    );
    expect(blankDetect).toEqual({ ok: true, data: { lang: '', confidence: 0, isReliable: false } });

    const errDetect = await handleRuntimeMessage(
      { type: 'DETECT_LANGUAGE', payload: { text: 'Hola' } },
      { id: 'ext' },
      { runtimeId: 'ext', detectLanguage: vi.fn().mockRejectedValue(new Error('i18n err')) }
    );
    expect(errDetect.ok).toBe(false);

    // Trusted settings enforcement: rejects when local-http disabled or domain blocked
    const disabledSettingsRes = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:9999/probe',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
        },
      },
      { id: 'ext', tab: { url: 'https://example.com' } },
      {
        runtimeId: 'ext',
        getSettings: async () => ({
          schemaVersion: 1,
          enabled: true,
          blockedDomains: [],
          engine: 'web-speech',
          defaultRate: 1,
          voicePreferences: {},
          theme: 'auto',
          appearance: { iconBgColor: '#2563eb', iconFgColor: '#ffffff', accentColor: '#1d4ed8' },
          omitCodeBlocks: true,
          stripUrls: true,
          autoReadSelection: false,
          autoReadCorner: 'bottom-right',
          autoReadMinimized: false,
          geminiAutoRead: false,
          localHttp: {
            endpointUrl: 'http://127.0.0.1:5000/tts',
            protocol: 'piper',
            timeoutMs: 5000,
          },
        }),
      }
    );
    expect(disabledSettingsRes.ok).toBe(false);
    if (!disabledSettingsRes.ok) {
      expect(disabledSettingsRes.code).toBe('ENGINE_UNAVAILABLE');
    }

    // Rejects when sender domain is blocked in trusted settings
    const blockedDomainRes = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:9999/probe',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
        },
      },
      { id: 'ext', tab: { url: 'https://blocked.example.com/page' } },
      {
        runtimeId: 'ext',
        getSettings: async () => ({
          schemaVersion: 1,
          enabled: true,
          blockedDomains: ['blocked.example.com'],
          engine: 'local-http',
          defaultRate: 1,
          voicePreferences: {},
          theme: 'auto',
          appearance: { iconBgColor: '#2563eb', iconFgColor: '#ffffff', accentColor: '#1d4ed8' },
          omitCodeBlocks: true,
          stripUrls: true,
          autoReadSelection: false,
          autoReadCorner: 'bottom-right',
          autoReadMinimized: false,
          geminiAutoRead: false,
          localHttp: {
            endpointUrl: 'http://127.0.0.1:5000/tts',
            protocol: 'piper',
            timeoutMs: 5000,
          },
        }),
      }
    );
    expect(blockedDomainRes.ok).toBe(false);

    // Uses trusted settings endpoint instead of content-script spoofed URL
    const trustedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/wav' }),
      arrayBuffer: async () => new Uint8Array([82, 73, 70, 70]).buffer,
    });
    const trustedRes = await handleRuntimeMessage(
      {
        type: 'LOCAL_TTS_SYNTHESIZE',
        payload: {
          endpointUrl: 'http://127.0.0.1:9999/spoofed',
          protocol: 'piper',
          text: 'Hi',
          rate: 1,
        },
      },
      { id: 'ext', tab: { url: 'https://allowed.example.com' } },
      {
        runtimeId: 'ext',
        fetchFn: trustedFetch,
        getSettings: async () => ({
          schemaVersion: 1,
          enabled: true,
          blockedDomains: [],
          engine: 'local-http',
          defaultRate: 1,
          voicePreferences: {},
          theme: 'auto',
          appearance: { iconBgColor: '#2563eb', iconFgColor: '#ffffff', accentColor: '#1d4ed8' },
          omitCodeBlocks: true,
          stripUrls: true,
          autoReadSelection: false,
          autoReadCorner: 'bottom-right',
          autoReadMinimized: false,
          geminiAutoRead: false,
          localHttp: {
            endpointUrl: 'http://127.0.0.1:5000/trusted',
            protocol: 'piper',
            timeoutMs: 5000,
          },
        }),
      }
    );
    expect(trustedRes.ok).toBe(true);
    expect(trustedFetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:5000/trusted');

    // Rejects invalid rate/missing payload
    const badRate = await handleRuntimeMessage(
      { type: 'LOCAL_TTS_SYNTHESIZE', payload: { text: 'Hi', rate: -1 } },
      { id: 'ext' },
      { runtimeId: 'ext' }
    );
    expect(badRate.ok).toBe(false);

    // NEURAL_TTS_SYNTHESIZE resolves smooth default Piper voice and delegates to synthesizeNeural
    const synthesizeNeural = vi
      .fn()
      .mockResolvedValue({ mimeType: 'audio/wav', audioBase64: 'UklGRg==' });
    const neuralOk = await handleRuntimeMessage(
      {
        type: 'NEURAL_TTS_SYNTHESIZE',
        payload: { text: 'Hola voz suave', lang: 'es-CO', rate: 1 },
      },
      { id: 'ext', tab: { url: 'https://example.com' } },
      { runtimeId: 'ext', synthesizeNeural }
    );
    expect(neuralOk.ok).toBe(true);
    expect(synthesizeNeural).toHaveBeenCalledWith({
      text: 'Hola voz suave',
      voiceId: 'es_MX-claude-high',
      rate: 1,
    });

    // Rejects neural synthesis when engine disabled in trusted settings
    const neuralDisabled = await handleRuntimeMessage(
      {
        type: 'NEURAL_TTS_SYNTHESIZE',
        payload: { text: 'Hola', lang: 'es', rate: 1 },
      },
      { id: 'ext', tab: { url: 'https://example.com' } },
      {
        runtimeId: 'ext',
        synthesizeNeural,
        getSettings: async () => ({
          schemaVersion: 1,
          enabled: true,
          blockedDomains: [],
          engine: 'web-speech',
          defaultRate: 1,
          voicePreferences: {},
          theme: 'auto',
          appearance: { iconBgColor: '#2563eb', iconFgColor: '#ffffff', accentColor: '#1d4ed8' },
          omitCodeBlocks: true,
          stripUrls: true,
          autoReadSelection: false,
          autoReadCorner: 'bottom-right',
          autoReadMinimized: false,
          geminiAutoRead: false,
          localHttp: {
            endpointUrl: 'http://127.0.0.1:5000/tts',
            protocol: 'piper',
            timeoutMs: 5000,
          },
        }),
      }
    );
    expect(neuralDisabled.ok).toBe(false);

    // Additional neural validation branches: missing payload, empty text, missing runtime, synthesis failure
    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_SYNTHESIZE', payload: null },
          { id: 'ext' },
          { runtimeId: 'ext', synthesizeNeural }
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_SYNTHESIZE', payload: { text: '   ', lang: 'es', rate: 1 } },
          { id: 'ext' },
          { runtimeId: 'ext', synthesizeNeural }
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_SYNTHESIZE', payload: { text: 'Hola', lang: 'es', rate: 1 } },
          { id: 'ext' },
          { runtimeId: 'ext' }
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_SYNTHESIZE', payload: { text: 'Hola', lang: 'es', rate: 1 } },
          { id: 'ext' },
          { runtimeId: 'ext', synthesizeNeural: vi.fn().mockRejectedValue(new Error('WASM fail')) }
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_SYNTHESIZE', payload: { text: 'Hola', lang: 'es', rate: 1 } },
          { id: 'ext', tab: { url: 'https://blocked.example.com' } },
          {
            runtimeId: 'ext',
            synthesizeNeural,
            getSettings: async () => ({
              schemaVersion: 1,
              enabled: true,
              blockedDomains: ['blocked.example.com'],
              engine: 'piper-neural',
              defaultRate: 1,
              voicePreferences: {},
              theme: 'auto',
              appearance: {
                iconBgColor: '#2563eb',
                iconFgColor: '#ffffff',
                accentColor: '#1d4ed8',
              },
              omitCodeBlocks: true,
              stripUrls: true,
              autoReadSelection: false,
              autoReadCorner: 'bottom-right',
              autoReadMinimized: false,
              geminiAutoRead: false,
              localHttp: {
                endpointUrl: 'http://127.0.0.1:5000/tts',
                protocol: 'piper',
                timeoutMs: 5000,
              },
            }),
          }
        )
      ).ok
    ).toBe(false);

    // NEURAL_TTS_WARMUP resolves default voice and enforces settings/domain rules
    const warmupNeural = vi.fn().mockResolvedValue(undefined);
    const warmupOk = await handleRuntimeMessage(
      { type: 'NEURAL_TTS_WARMUP', payload: { lang: 'es-CO' } },
      { id: 'ext', tab: { url: 'https://example.com' } },
      { runtimeId: 'ext', warmupNeural }
    );
    expect(warmupOk).toEqual({ ok: true, data: { voiceId: 'es_MX-claude-high' } });
    expect(warmupNeural).toHaveBeenCalledWith('es_MX-claude-high');

    const cancelNeural = vi.fn();
    const cancelOk = await handleRuntimeMessage(
      { type: 'NEURAL_TTS_CANCEL' },
      { id: 'ext' },
      { runtimeId: 'ext', cancelNeural }
    );
    expect(cancelOk).toEqual({ ok: true, data: { cancelled: true } });
    expect(cancelNeural).toHaveBeenCalledOnce();

    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_WARMUP', payload: null },
          { id: 'ext' },
          { runtimeId: 'ext', warmupNeural }
        )
      ).ok
    ).toBe(false);

    expect(
      (
        await handleRuntimeMessage(
          { type: 'NEURAL_TTS_WARMUP', payload: { lang: 'es' } },
          { id: 'ext', tab: { url: 'https://blocked.example.com' } },
          {
            runtimeId: 'ext',
            warmupNeural,
            getSettings: async () => ({
              schemaVersion: 1,
              enabled: true,
              blockedDomains: ['blocked.example.com'],
              engine: 'piper-neural',
              defaultRate: 1,
              voicePreferences: {},
              theme: 'auto',
              appearance: {
                iconBgColor: '#2563eb',
                iconFgColor: '#ffffff',
                accentColor: '#1d4ed8',
              },
              omitCodeBlocks: true,
              stripUrls: true,
              autoReadSelection: false,
              autoReadCorner: 'bottom-right',
              autoReadMinimized: false,
              geminiAutoRead: false,
              localHttp: {
                endpointUrl: 'http://127.0.0.1:5000/tts',
                protocol: 'piper',
                timeoutMs: 5000,
              },
            }),
          }
        )
      ).ok
    ).toBe(false);
  });
});
