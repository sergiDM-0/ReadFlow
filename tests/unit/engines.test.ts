import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertLocalhostEndpoint } from '../../src/core/engines/local-url';
import { WebSpeechEngine } from '../../src/core/engines/web-speech.engine';
import { LocalHttpEngine } from '../../src/core/engines/local-http.engine';
import { TTSError } from '../../src/shared/types';

describe('assertLocalhostEndpoint', () => {
  it('allows valid loopback HTTP URLs', () => {
    expect(assertLocalhostEndpoint('http://localhost:5000/tts').hostname).toBe('localhost');
    expect(assertLocalhostEndpoint('http://127.0.0.1:8880/v1/audio/speech').hostname).toBe(
      '127.0.0.1'
    );
    expect(assertLocalhostEndpoint('http://[::1]:5000/tts').hostname).toBe('[::1]');
  });

  it('rejects non-loopback hosts, https/file schemes, and credentials', () => {
    expect(() => assertLocalhostEndpoint('https://api.openai.com/v1/audio')).toThrow(TTSError);
    expect(() => assertLocalhostEndpoint('http://192.168.1.10:5000/tts')).toThrow(TTSError);
    expect(() => assertLocalhostEndpoint('http://user:pass@localhost:5000/tts')).toThrow(TTSError);
    expect(() => assertLocalhostEndpoint('file:///etc/passwd')).toThrow(TTSError);
    expect(() => assertLocalhostEndpoint('not-a-url')).toThrow(TTSError);
  });
});

describe('WebSpeechEngine', () => {
  let mockUtterances: MockUtterance[];
  let mockSynth: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    speaking: boolean;
    paused: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  class MockUtterance {
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
    mockUtterances = [];
    mockSynth = {
      speaking: false,
      paused: false,
      getVoices: vi.fn(() => [
        { voiceURI: 'es-local', name: 'Spanish', lang: 'es-ES', localService: true, default: true },
      ]),
      speak: vi.fn((u: MockUtterance) => {
        mockUtterances.push(u);
        mockSynth.speaking = true;
      }),
      cancel: vi.fn(() => {
        mockSynth.speaking = false;
      }),
      pause: vi.fn(() => {
        mockSynth.paused = true;
      }),
      resume: vi.fn(() => {
        mockSynth.paused = false;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  it('lists normalized voices and speaks text until onend fires', async () => {
    const engine = new WebSpeechEngine(
      mockSynth as unknown as SpeechSynthesis,
      MockUtterance as unknown as typeof SpeechSynthesisUtterance
    );

    expect(await engine.isAvailable()).toBe(true);
    const voices = await engine.getVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0]?.id).toBe('es-local');

    const promise = engine.speak('Hola', { lang: 'es-ES', voiceId: 'es-local', rate: 1.25 });
    expect(mockSynth.speak).toHaveBeenCalledOnce();
    expect(mockUtterances[0]?.rate).toBe(1.25);

    mockUtterances[0]?.onend?.();
    await expect(promise).resolves.toBeUndefined();
    engine.dispose();
  });

  it('rejects with ABORTED when AbortSignal triggers', async () => {
    const engine = new WebSpeechEngine(
      mockSynth as unknown as SpeechSynthesis,
      MockUtterance as unknown as typeof SpeechSynthesisUtterance
    );
    const controller = new AbortController();
    const promise = engine.speak('Hola', { lang: 'es', rate: 1, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
    expect(mockSynth.cancel).toHaveBeenCalled();
  });

  it('supports pause, resume, stop, onerror, and unavailable speechSynthesis', async () => {
    const engine = new WebSpeechEngine(
      mockSynth as unknown as SpeechSynthesis,
      MockUtterance as unknown as typeof SpeechSynthesisUtterance
    );
    const promise = engine.speak('Error test', { lang: 'en', rate: 1 });
    engine.pause();
    expect(mockSynth.pause).toHaveBeenCalledOnce();
    engine.resume();
    expect(mockSynth.resume).toHaveBeenCalledOnce();

    mockUtterances[0]?.onerror?.({ error: 'synthesis-failed' });
    await expect(promise).rejects.toMatchObject({ code: 'SYNTHESIS_FAILED' });

    engine.stop();
    expect(mockSynth.cancel).toHaveBeenCalled();

    const unavailable = new WebSpeechEngine(null, null, false);
    expect(await unavailable.isAvailable()).toBe(false);
    expect(unavailable.capabilities.supportsPauseResume).toBe(true);
    expect(await unavailable.getVoices()).toEqual([]);
    await expect(unavailable.speak('x', { lang: 'en', rate: 1 })).rejects.toMatchObject({
      code: 'ENGINE_UNAVAILABLE',
    });

    // Linux speech-dispatcher marks native pause unsupported so TTSManager cancels cleanly
    const linuxEngine = new WebSpeechEngine(
      mockSynth as unknown as SpeechSynthesis,
      MockUtterance as unknown as typeof SpeechSynthesisUtterance,
      true
    );
    expect(linuxEngine.capabilities.supportsPauseResume).toBe(false);

    // Async voiceschanged event loads voices when initial getVoices() is empty
    const listeners = new Map<string, () => void>();
    let asyncVoices: Array<{
      voiceURI: string;
      name: string;
      lang: string;
      localService: boolean;
      default: boolean;
    }> = [];
    const asyncSynth = {
      ...mockSynth,
      getVoices: vi.fn(() => asyncVoices),
      addEventListener: vi.fn((ev: string, fn: () => void) => listeners.set(ev, fn)),
      removeEventListener: vi.fn((ev: string) => listeners.delete(ev)),
    };
    const asyncEngine = new WebSpeechEngine(
      asyncSynth as unknown as SpeechSynthesis,
      MockUtterance as unknown as typeof SpeechSynthesisUtterance
    );
    const voicesPromise = asyncEngine.getVoices();
    asyncVoices = [
      { voiceURI: 'v1', name: 'Async ES', lang: 'es-MX', localService: true, default: false },
    ];
    listeners.get('voiceschanged')?.();
    expect(await voicesPromise).toHaveLength(1);

    // Unknown voiceId falls back gracefully without throwing
    const unknownVoicePromise = engine.speak('Fallback', {
      lang: 'es',
      voiceId: 'non-existent',
      rate: 1,
    });
    mockUtterances[mockUtterances.length - 1]?.onerror?.({ error: 'canceled' });
    await expect(unknownVoicePromise).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('LocalHttpEngine', () => {
  it('validates endpoint, lists voices, and plays audio returned by transport', async () => {
    const transport = vi.fn().mockResolvedValue({
      mimeType: 'audio/wav',
      audioBase64: 'UklGRg==',
    });
    const playAudio = vi.fn().mockResolvedValue(undefined);
    const engine = new LocalHttpEngine(
      { endpointUrl: 'http://127.0.0.1:5000/tts', protocol: 'kokoro-openai', timeoutMs: 5000 },
      transport,
      playAudio
    );

    expect(await engine.isAvailable()).toBe(true);
    const voices = await engine.getVoices();
    expect(voices[0]?.name).toContain('Kokoro');

    await engine.speak('Hello local', { lang: 'en', rate: 1.5 });
    expect(transport).toHaveBeenCalledOnce();
    expect(playAudio).toHaveBeenCalledWith('audio/wav', 'UklGRg==', undefined);

    engine.pause();
    engine.resume();
    engine.stop();
    engine.dispose();

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      engine.speak('Skip', { lang: 'en', rate: 1, signal: aborted.signal })
    ).rejects.toMatchObject({
      code: 'ABORTED',
    });
  });

  it('rejects remote non-localhost endpoint before invoking transport', async () => {
    const transport = vi.fn();
    const engine = new LocalHttpEngine(
      { endpointUrl: 'https://evil.example/tts', protocol: 'piper', timeoutMs: 5000 },
      transport
    );

    expect(await engine.isAvailable()).toBe(false);
    await expect(engine.speak('Secret', { lang: 'en', rate: 1 })).rejects.toMatchObject({
      code: 'INVALID_ENDPOINT',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('exercises defaultPlayAudio lifecycle (onended, onerror, play rejection, and abort)', async () => {
    const origAudio = globalThis.Audio;
    const origCreateUrl = URL.createObjectURL;
    const origRevokeUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:local-http');
    URL.revokeObjectURL = vi.fn();

    let lastAudio!: {
      onended: (() => void) | null;
      onerror: (() => void) | null;
      pause: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
    };

    globalThis.Audio = vi.fn(function () {
      lastAudio = {
        onended: null,
        onerror: null,
        pause: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
      };
      return lastAudio;
    }) as unknown as typeof Audio;

    try {
      const transport = vi
        .fn()
        .mockResolvedValue({ mimeType: 'audio/wav', audioBase64: 'UklGRg==' });
      const engine = new LocalHttpEngine(
        { endpointUrl: 'http://127.0.0.1:5000/tts', protocol: 'piper', timeoutMs: 5000 },
        transport
      );

      expect((await engine.getVoices())[0]?.name).toContain('Piper');

      // 1. Resolves on audio.onended
      const p1 = engine.speak('Hi', { lang: 'en', rate: 1 });
      await new Promise((r) => setTimeout(r, 5));
      lastAudio.onended?.();
      await expect(p1).resolves.toBeUndefined();

      // 2. Rejects on audio.onerror
      const p2 = engine.speak('Err', { lang: 'en', rate: 1 });
      await new Promise((r) => setTimeout(r, 5));
      lastAudio.onerror?.();
      await expect(p2).rejects.toMatchObject({ code: 'SYNTHESIS_FAILED' });

      // 3. Rejects when audio.play() rejects
      globalThis.Audio = vi.fn(function () {
        lastAudio = {
          onended: null,
          onerror: null,
          pause: vi.fn(),
          play: vi.fn().mockRejectedValue(new Error('blocked')),
        };
        return lastAudio;
      }) as unknown as typeof Audio;
      await expect(engine.speak('Blocked', { lang: 'en', rate: 1 })).rejects.toMatchObject({
        code: 'SYNTHESIS_FAILED',
      });

      // 4. Aborts mid-playback via AbortController
      globalThis.Audio = vi.fn(function () {
        lastAudio = {
          onended: null,
          onerror: null,
          pause: vi.fn(),
          play: vi.fn().mockResolvedValue(undefined),
        };
        return lastAudio;
      }) as unknown as typeof Audio;
      const ctrl = new AbortController();
      const p4 = engine.speak('Abort me', { lang: 'en', rate: 1, signal: ctrl.signal });
      await new Promise((r) => setTimeout(r, 5));
      ctrl.abort();
      await expect(p4).rejects.toMatchObject({ code: 'ABORTED' });

      // 5. Aborts mid-transport when engine.stop() is called
      const slowTransport = vi.fn(
        () =>
          new Promise<{ mimeType: string; audioBase64: string }>((resolve) => {
            setTimeout(() => resolve({ mimeType: 'audio/wav', audioBase64: 'UklGRg==' }), 20);
          })
      );
      const slowEngine = new LocalHttpEngine(
        { endpointUrl: 'http://127.0.0.1:5000/tts', protocol: 'piper', timeoutMs: 5000 },
        slowTransport
      );
      const p5 = slowEngine.speak('Stop during fetch', { lang: 'en', rate: 1 });
      slowEngine.stop();
      await expect(p5).rejects.toMatchObject({ code: 'ABORTED' });
    } finally {
      globalThis.Audio = origAudio;
      URL.createObjectURL = origCreateUrl;
      URL.revokeObjectURL = origRevokeUrl;
    }
  });
});
