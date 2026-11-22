import { describe, it, expect, vi } from 'vitest';
import {
  PIPER_NEURAL_VOICES,
  resolvePiperVoiceForLang,
  getPiperModelUrls,
} from '../../src/core/neural/piper-voices';
import {
  pcmToWavBuffer,
  arrayBufferToBase64,
  trimPcmSilence,
} from '../../src/core/neural/wav-encoder';
import { PiperNeuralEngine } from '../../src/core/engines/piper-neural.engine';
import { selectPreferredVoice } from '../../src/core/language-detector';
import type { VoiceInfo } from '../../src/shared/types';

describe('piper-voices catalog', () => {
  it('resolves smooth default Spanish and English neural voices and honors user preference', () => {
    expect(resolvePiperVoiceForLang('es-CO', {}).id).toBe('es_MX-claude-high');
    expect(resolvePiperVoiceForLang('es-ES', {}).id).toBe('es_MX-claude-high');
    expect(resolvePiperVoiceForLang('en-US', {}).id).toBe('en_US-hfc_female-medium');
    expect(resolvePiperVoiceForLang('es', { es: 'es_ES-sharvard-medium' }).id).toBe(
      'es_ES-sharvard-medium'
    );
    expect(resolvePiperVoiceForLang('ja-JP', {}).id).toBe('es_MX-claude-high');
    expect(PIPER_NEURAL_VOICES.length).toBeGreaterThanOrEqual(8);

    const urls = getPiperModelUrls('es_MX-claude-high');
    expect(urls.modelUrl).toMatch(/^https:\/\/huggingface\.co\/.*\.onnx$/);
    expect(urls.configUrl).toMatch(/\.onnx\.json$/);
    expect(getPiperModelUrls('unknown-id').modelUrl).toContain('es_MX-claude-high');
  });
});

describe('pcmToWavBuffer', () => {
  it('encodes Float32 PCM samples into a valid RIFF/WAVE header + 16-bit PCM payload', () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1.5, -1.5]);
    const wav = pcmToWavBuffer(pcm, 22050);
    const view = new DataView(wav);
    expect(wav.byteLength).toBe(44 + pcm.length * 2);
    expect(
      String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    ).toBe('RIFF');
    expect(
      String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))
    ).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getInt16(44 + 6, true)).toBe(32767);
    expect(view.getInt16(44 + 8, true)).toBe(-32768);
    expect(arrayBufferToBase64(wav).length).toBeGreaterThan(20);
  });

  it('trims dead leading/trailing silence from Piper PCM while keeping a short natural pad', () => {
    const sampleRate = 1000; // 1 sample = 1 ms for simple assertions
    const pcm = new Float32Array(800);
    // Active speech from 300ms to 450ms
    for (let i = 300; i < 450; i += 1) {
      pcm[i] = 0.4;
    }
    const trimmed = trimPcmSilence(pcm, sampleRate);
    // 30ms lead + 150ms speech + 50ms trail = 230 samples (saved 570ms of dead silence!)
    expect(trimmed.length).toBe(230);
    expect(trimPcmSilence(new Float32Array(0), sampleRate).length).toBe(0);
    expect(trimPcmSilence(new Float32Array(20), sampleRate).length).toBe(20);
    // All-silent buffer or invalid sampleRate returns input untouched
    const allSilent = new Float32Array(200);
    expect(trimPcmSilence(allSilent, sampleRate)).toBe(allSilent);
    expect(trimPcmSilence(pcm, 0)).toBe(pcm);
  });
});

describe('PiperNeuralEngine', () => {
  it('synthesizes neural audio, supports instant pause/resume, live rate change, and stop', async () => {
    const transport = vi.fn().mockResolvedValue({
      mimeType: 'audio/wav',
      audioBase64: 'UklGRg==',
    });

    let finishPlayback!: () => void;
    const controls = {
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      setRate: vi.fn(),
    };

    const createPlayer = vi.fn(() => ({
      play: () =>
        new Promise<void>((resolve) => {
          finishPlayback = resolve;
        }),
      ...controls,
    }));

    const engine = new PiperNeuralEngine(transport, createPlayer);
    expect(await engine.isAvailable()).toBe(true);
    expect((await engine.getVoices()).length).toBeGreaterThan(0);
    expect(engine.capabilities.supportsPauseResume).toBe(true);
    expect(engine.capabilities.supportsLiveRateChange).toBe(true);

    // Prefetch caches upcoming sentence so speak reuses the single transport call
    engine.prefetch('   ', { lang: 'es', rate: 1 });
    engine.prefetch('Hola, esta es una voz suave y natural.', { lang: 'es', rate: 1 });
    engine.prefetch('Hola, esta es una voz suave y natural.', { lang: 'es', rate: 1 });
    engine.prefetch('Segunda oración', { lang: 'es', rate: 1 });
    engine.prefetch('Tercera oración', { lang: 'es', rate: 1 });
    engine.prefetch('Cuarta oración', { lang: 'es', rate: 1 });

    const onProgress = vi.fn();
    const onPlaying = vi.fn();
    const speakPromise = engine.speak('Hola, esta es una voz suave y natural.', {
      lang: 'es',
      rate: 1,
      onProgress,
      onPlaying,
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(onProgress).toHaveBeenCalled();
    expect(onPlaying).toHaveBeenCalledOnce();

    engine.pause();
    expect(controls.pause).toHaveBeenCalledOnce();

    engine.resume();
    expect(controls.resume).toHaveBeenCalledOnce();

    engine.setPlaybackRate(1.5);
    expect(controls.setRate).toHaveBeenCalledWith(1.5);

    finishPlayback();
    await expect(speakPromise).resolves.toBeUndefined();

    // Aborted signal rejects immediately
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      engine.speak('Cancelado', { lang: 'es', rate: 1, signal: aborted.signal })
    ).rejects.toMatchObject({ code: 'ABORTED' });

    engine.dispose();
  });

  it('uses pitch-preserving HTMLAudioElement by default and keeps prefetches valid across live speed changes', async () => {
    const createdAudios: Array<{
      preservesPitch: boolean;
      playbackRate: number;
      defaultPlaybackRate: number;
      paused: boolean;
      src: string;
      onended: (() => void) | null;
      onerror: (() => void) | null;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    }> = [];

    const origAudio = window.Audio;
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:readflow-mock');

    class FakeHtmlAudio {
      public preservesPitch = false;
      public mozPreservesPitch = false;
      public webkitPreservesPitch = false;
      public playbackRate = 1;
      public defaultPlaybackRate = 1;
      public paused = true;
      public src: string;
      public onended: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public play = vi.fn(async () => {
        this.paused = false;
      });
      public pause = vi.fn(() => {
        this.paused = true;
      });
      public constructor(src: string) {
        this.src = src;
        createdAudios.push(this);
      }
    }

    Object.defineProperty(window, 'Audio', { configurable: true, value: FakeHtmlAudio });

    try {
      const transport = vi.fn().mockResolvedValue({
        mimeType: 'audio/wav',
        audioBase64: 'UklGRg==',
      });
      const cancelTransport = vi.fn();
      const engine = new PiperNeuralEngine(transport, undefined, cancelTransport);

      // Prefetch chunk 1 at rate 1x, then change speed mid-playback to 1.5x -> chunk 1 still hits cache!
      const p1 = engine.speak('Primera frase', { lang: 'es', rate: 1 });
      engine.prefetch('Segunda frase', { lang: 'es', rate: 1 });
      await new Promise((r) => setTimeout(r, 10));

      const audio1 = createdAudios[0]!;
      expect(audio1.preservesPitch).toBe(true);
      expect(audio1.playbackRate).toBe(1);

      // Live speed changes update playbackRate immediately with preservesPitch=true
      engine.setPlaybackRate(1.5);
      expect(audio1.playbackRate).toBe(1.5);
      expect(audio1.preservesPitch).toBe(true);

      engine.setPlaybackRate(2);
      expect(audio1.playbackRate).toBe(2);

      engine.pause();
      expect(audio1.pause).toHaveBeenCalledOnce();
      engine.resume();
      expect(audio1.play).toHaveBeenCalledTimes(2);

      audio1.onended?.();
      await expect(p1).resolves.toBeUndefined();
      expect(revokeSpy).toHaveBeenCalledWith('blob:readflow-mock');

      // Second chunk at 2x reuses prefetched audio (transport called only 2 times total, not 3!)
      const p2 = engine.speak('Segunda frase', { lang: 'es', rate: 2 });
      await new Promise((r) => setTimeout(r, 10));
      expect(transport).toHaveBeenCalledTimes(2);
      expect(createdAudios[1]!.playbackRate).toBe(2);
      expect(createdAudios[1]!.preservesPitch).toBe(true);

      engine.stop();
      await expect(p2).rejects.toMatchObject({ code: 'ABORTED' });
      expect(cancelTransport).toHaveBeenCalledOnce();

      // Media playback error mid-stream surfaces SYNTHESIS_FAILED cleanly
      const p3 = engine.speak('Tercera frase', { lang: 'es', rate: 1 });
      await new Promise((r) => setTimeout(r, 10));
      createdAudios[2]!.onerror?.();
      await expect(p3).rejects.toMatchObject({ code: 'SYNTHESIS_FAILED' });

      // Abort signal mid-playback cancels HTMLAudioElement cleanly
      const ctrl = new AbortController();
      const p4 = engine.speak('Cuarta frase', { lang: 'es', rate: 1, signal: ctrl.signal });
      await new Promise((r) => setTimeout(r, 10));
      ctrl.abort();
      await expect(p4).rejects.toMatchObject({ code: 'ABORTED' });

      engine.dispose();
    } finally {
      Object.defineProperty(window, 'Audio', { configurable: true, value: origAudio });
      revokeSpy.mockRestore();
      createUrlSpy.mockRestore();
    }
  });

  it('falls back seamlessly to persistent Web Audio API when HTMLAudioElement is blocked by CSP', async () => {
    const origAudio = window.Audio;
    // Simulate a strict CSP page where HTMLAudioElement.play() rejects
    class BlockedHtmlAudio {
      public play = vi.fn().mockRejectedValue(new Error('CSP media-src blocked'));
      public pause = vi.fn();
      public src = '';
      public onended: (() => void) | null = null;
      public onerror: (() => void) | null = null;
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: BlockedHtmlAudio });
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:blocked');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const hooks: { onEnded: (() => void) | null } = { onEnded: null };
    const stopNode = vi.fn(() => hooks.onEnded?.());
    const startNode = vi.fn();
    const disconnectNode = vi.fn();
    const playbackRate = { value: 1 };
    const suspendCtx = vi.fn(async () => {
      fakeCtx.state = 'suspended';
    });
    const resumeCtx = vi.fn(async () => {
      fakeCtx.state = 'running';
    });
    const closeCtx = vi.fn(async () => undefined);
    const fakeCtx = {
      state: 'running',
      destination: {},
      decodeAudioData: vi.fn(async () => ({ duration: 1.5 })),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        playbackRate,
        connect: vi.fn(),
        disconnect: disconnectNode,
        start: startNode,
        stop: stopNode,
        set onended(fn: (() => void) | null) {
          hooks.onEnded = fn;
        },
      })),
      suspend: suspendCtx,
      resume: resumeCtx,
      close: closeCtx,
    };

    const audioCtxCtor = vi.fn(function () {
      return fakeCtx;
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: audioCtxCtor,
    });

    try {
      const transport = vi.fn().mockResolvedValue({
        mimeType: 'audio/wav',
        audioBase64: 'UklGRg==',
      });
      const engine = new PiperNeuralEngine(transport);

      const p = engine.speak('Prueba Web Audio', { lang: 'es', rate: 1 });
      await new Promise((r) => setTimeout(r, 15));
      expect(startNode).toHaveBeenCalledOnce();

      // Prefetch while AudioContext fallback is active pre-decodes WAV for gapless handoff
      engine.prefetch('Siguiente frase', { lang: 'es', rate: 1 });
      await new Promise((r) => setTimeout(r, 15));
      expect(fakeCtx.decodeAudioData).toHaveBeenCalledTimes(2);

      engine.pause();
      expect(suspendCtx).toHaveBeenCalledOnce();

      engine.resume();
      expect(resumeCtx).toHaveBeenCalledOnce();

      engine.setPlaybackRate(1.25);
      expect(playbackRate.value).toBe(1.25);

      hooks.onEnded?.();
      await expect(p).resolves.toBeUndefined();
      // Persistent AudioContext stays open between segments (no close/reopen gap!)
      expect(closeCtx).not.toHaveBeenCalled();

      // Second segment reuses the same AudioContext and uses pre-decoded buffer without re-decoding
      const pPrefetched = engine.speak('Siguiente frase', { lang: 'es', rate: 1.25 });
      await new Promise((r) => setTimeout(r, 15));
      expect(audioCtxCtor).toHaveBeenCalledTimes(1);
      expect(fakeCtx.decodeAudioData).toHaveBeenCalledTimes(2);
      hooks.onEnded?.();
      await expect(pPrefetched).resolves.toBeUndefined();

      // Stop mid-playback cancels cleanly with ABORTED
      const p2 = engine.speak('Segunda prueba', { lang: 'es', rate: 1 });
      await new Promise((r) => setTimeout(r, 15));
      engine.stop();
      await expect(p2).rejects.toMatchObject({ code: 'ABORTED' });

      // Decode error surfaces SYNTHESIS_FAILED
      fakeCtx.decodeAudioData.mockRejectedValueOnce(new Error('bad wav'));
      await expect(engine.speak('Corrupto', { lang: 'es', rate: 1 })).rejects.toMatchObject({
        code: 'SYNTHESIS_FAILED',
      });

      // Dispose closes the persistent AudioContext cleanly
      engine.dispose();
      expect(closeCtx).toHaveBeenCalledOnce();

      // Missing AudioContext surfaces ENGINE_UNAVAILABLE
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
      const engineNoAudio = new PiperNeuralEngine(transport);
      await expect(engineNoAudio.speak('Sin audio', { lang: 'es', rate: 1 })).rejects.toMatchObject(
        {
          code: 'ENGINE_UNAVAILABLE',
        }
      );

      // WASM OOM error falls back seamlessly to WebSpeechEngine and forwards pause/resume/stop
      const speechSpeak = vi.fn((u: { onend?: () => void }) => {
        setTimeout(() => u.onend?.(), 15);
      });
      const speechPause = vi.fn();
      const speechResume = vi.fn();
      const speechCancel = vi.fn();
      const origSynth = window.speechSynthesis;
      const origUtterance = window.SpeechSynthesisUtterance;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speaking: true,
          paused: false,
          getVoices: () => [],
          speak: speechSpeak,
          pause: speechPause,
          resume: speechResume,
          cancel: speechCancel,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: vi.fn(function (this: Record<string, unknown>, text: string) {
          this.text = text;
        }),
      });
      try {
        const oomTransport = vi
          .fn()
          .mockRejectedValue(new Error('Aborted(InternalError: out of memory)'));
        const oomEngine = new PiperNeuralEngine(oomTransport);
        const oomPromise = oomEngine.speak('Fallback por memoria', { lang: 'es', rate: 1 });
        await new Promise((r) => setTimeout(r, 5));
        oomEngine.pause();
        oomEngine.resume();
        await expect(oomPromise).resolves.toBeUndefined();
        expect(speechSpeak).toHaveBeenCalledOnce();
        expect(speechPause).toHaveBeenCalled();
        expect(speechResume).toHaveBeenCalled();
        oomEngine.stop();
        oomEngine.dispose();
      } finally {
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: origSynth });
        Object.defineProperty(window, 'SpeechSynthesisUtterance', {
          configurable: true,
          value: origUtterance,
        });
      }
    } finally {
      Object.defineProperty(window, 'Audio', { configurable: true, value: origAudio });
      createUrlSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });
});

describe('selectPreferredVoice naturalness ranking', () => {
  it('ranks neural/natural voices above robotic eSpeak voices', () => {
    const voices: VoiceInfo[] = [
      {
        id: 'espeak-es',
        name: 'Spanish (Latin America)+Adam',
        lang: 'es-419',
        isLocal: true,
        isDefault: true,
        engine: 'web-speech',
      },
      {
        id: 'google-es',
        name: 'Google español',
        lang: 'es-ES',
        isLocal: false,
        isDefault: false,
        engine: 'web-speech',
      },
      {
        id: 'natural-es',
        name: 'Microsoft Dalia Online (Natural)',
        lang: 'es-MX',
        isLocal: false,
        isDefault: false,
        engine: 'web-speech',
      },
    ];

    expect(selectPreferredVoice(voices, 'es', {})?.id).toBe('natural-es');
  });
});
