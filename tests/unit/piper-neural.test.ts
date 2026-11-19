import { describe, it, expect, vi } from 'vitest';
import {
  PIPER_NEURAL_VOICES,
  resolvePiperVoiceForLang,
  getPiperModelUrls,
} from '../../src/core/neural/piper-voices';
import { pcmToWavBuffer, arrayBufferToBase64 } from '../../src/core/neural/wav-encoder';
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

  it('plays, pauses, resumes, updates playbackRate live, and stops via Web Audio API', async () => {
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

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: vi.fn(() => fakeCtx),
    });

    const transport = vi.fn().mockResolvedValue({
      mimeType: 'audio/wav',
      audioBase64: 'UklGRg==',
    });
    const engine = new PiperNeuralEngine(transport);

    const p = engine.speak('Prueba Web Audio', { lang: 'es', rate: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(startNode).toHaveBeenCalledOnce();

    engine.pause();
    expect(suspendCtx).toHaveBeenCalledOnce();

    engine.resume();
    expect(resumeCtx).toHaveBeenCalledOnce();

    engine.setPlaybackRate(1.25);
    expect(playbackRate.value).toBe(1.25);

    hooks.onEnded?.();
    await expect(p).resolves.toBeUndefined();
    expect(closeCtx).toHaveBeenCalledOnce();

    // Stop mid-playback cancels cleanly with ABORTED
    const p2 = engine.speak('Segunda prueba', { lang: 'es', rate: 1 });
    await new Promise((r) => setTimeout(r, 10));
    engine.stop();
    await expect(p2).rejects.toMatchObject({ code: 'ABORTED' });

    // Decode error surfaces SYNTHESIS_FAILED
    fakeCtx.decodeAudioData.mockRejectedValueOnce(new Error('bad wav'));
    await expect(engine.speak('Corrupto', { lang: 'es', rate: 1 })).rejects.toMatchObject({
      code: 'SYNTHESIS_FAILED',
    });

    // Missing AudioContext surfaces ENGINE_UNAVAILABLE
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    await expect(engine.speak('Sin audio', { lang: 'es', rate: 1 })).rejects.toMatchObject({
      code: 'ENGINE_UNAVAILABLE',
    });
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
