import { describe, it, expect, vi } from 'vitest';
import { TTSManager } from '../../src/core/tts-manager';
import type { TTSEngineInterface } from '../../src/core/engines/engine.interface';
import { TTSError, type EngineOptions, type SentenceQueueState } from '../../src/shared/types';

function createDeferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeEngine() {
  const calls: Array<{
    text: string;
    options: EngineOptions;
    deferred: ReturnType<typeof createDeferred>;
  }> = [];
  const engine: TTSEngineInterface = {
    id: 'web-speech',
    capabilities: { supportsPauseResume: true, supportsLiveRateChange: false, maxChunkChars: 240 },
    isAvailable: vi.fn().mockResolvedValue(true),
    getVoices: vi.fn().mockResolvedValue([]),
    speak: vi.fn((text: string, options: EngineOptions) => {
      const deferred = createDeferred();
      options.signal?.addEventListener('abort', () => {
        deferred.reject(new TTSError('ABORTED', 'aborted'));
      });
      calls.push({ text, options, deferred });
      return deferred.promise;
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  return { engine, calls };
}

describe('TTSManager', () => {
  it('plays sentences sequentially and returns to idle when queue finishes', async () => {
    const { engine, calls } = createFakeEngine();
    const manager = new TTSManager(engine);
    const states: SentenceQueueState[] = [];
    manager.subscribe((s) => states.push(s));

    void manager.play(['One.', 'Two.'], { lang: 'en', rate: 1, source: 'selection' });
    await Promise.resolve();

    expect(manager.getState().status).toBe('playing');
    expect(manager.getState().currentIndex).toBe(0);
    expect(calls[0]?.text).toBe('One.');

    calls[0]?.deferred.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.getState().currentIndex).toBe(1);
    expect(calls[1]?.text).toBe('Two.');

    calls[1]?.deferred.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.getState().status).toBe('idle');
    expect(states.length).toBeGreaterThan(2);
  });

  it('supports pause, resume, next, prev, live rate change, and stop', async () => {
    const { engine, calls } = createFakeEngine();
    const manager = new TTSManager(engine);

    void manager.play(['First.', 'Second.', 'Third.'], {
      lang: 'en',
      rate: 1,
      source: 'selection',
    });
    await Promise.resolve();

    manager.pause();
    expect(manager.getState().status).toBe('paused');
    expect(engine.pause).toHaveBeenCalledOnce();

    manager.resume();
    expect(manager.getState().status).toBe('playing');
    expect(engine.resume).toHaveBeenCalledOnce();

    manager.next();
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getState().currentIndex).toBe(1);
    expect(calls.at(-1)?.text).toBe('Second.');

    manager.setRate(1.5);
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getState().rate).toBe(1.5);
    expect(calls.at(-1)?.options.rate).toBe(1.5);

    manager.prev();
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getState().currentIndex).toBe(0);

    manager.stop();
    expect(manager.getState().status).toBe('idle');
    expect(engine.stop).toHaveBeenCalled();
  });

  it('appends streaming sentences seamlessly without restarting active utterance', async () => {
    const { engine, calls } = createFakeEngine();
    const manager = new TTSManager(engine);

    void manager.enqueue(['Stream 1.'], { lang: 'en', rate: 1, source: 'gemini-stream' });
    await Promise.resolve();

    void manager.enqueue(['Stream 2.'], { lang: 'en', rate: 1, source: 'gemini-stream' });
    expect(manager.getState().items).toHaveLength(2);
    expect(calls).toHaveLength(1);

    calls[0]?.deferred.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[1]?.text).toBe('Stream 2.');
  });

  it('transitions to error state cleanly when engine fails', async () => {
    const { engine, calls } = createFakeEngine();
    const manager = new TTSManager(engine);

    void manager.play(['Broken.'], { lang: 'en', rate: 1, source: 'selection' });
    await Promise.resolve();

    calls[0]?.deferred.reject(new TTSError('SYNTHESIS_FAILED', 'No OS voices'));
    await new Promise((r) => setTimeout(r, 0));

    const state = manager.getState();
    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.error.code).toBe('SYNTHESIS_FAILED');
    }

    // Retry from error state resumes playback at failed sentence
    manager.togglePauseResume();
    await Promise.resolve();
    expect(manager.getState().status).toBe('playing');
    expect(calls).toHaveLength(2);

    // Pause/resume on non-pausable engine cancels and restarts cleanly
    const nonPausableEngine: TTSEngineInterface = {
      ...engine,
      capabilities: {
        supportsPauseResume: false,
        supportsLiveRateChange: false,
        maxChunkChars: 420,
      },
    };
    const localMgr = new TTSManager(nonPausableEngine);
    void localMgr.play(['Chunk one.', 'Chunk two.'], { lang: 'en', rate: 1, source: 'selection' });
    await Promise.resolve();
    localMgr.pause();
    expect(localMgr.getState().status).toBe('paused');
    localMgr.resume();
    await Promise.resolve();
    expect(localMgr.getState().status).toBe('playing');
    localMgr.stop();

    // Live rate change + prefetch ordering (speak BEFORE prefetch) + 2-chunk lookahead
    const setPlaybackRate = vi.fn();
    const callOrder: string[] = [];
    const prefetch = vi.fn((text: string) => {
      callOrder.push(`prefetch:${text}`);
    });
    const liveDeferred = createDeferred();
    const liveEngine: TTSEngineInterface = {
      ...engine,
      capabilities: {
        supportsPauseResume: true,
        supportsLiveRateChange: true,
        maxChunkChars: 220,
        streamingFirstChunkChars: 75,
      },
      setPlaybackRate,
      prefetch,
      speak: vi.fn((text, opts) => {
        callOrder.push(`speak:${text}`);
        opts.onProgress?.('Preparando voz...');
        opts.onPlaying?.();
        return liveDeferred.promise;
      }),
    };
    const liveMgr = new TTSManager(liveEngine);
    void liveMgr.play(['Uno.', 'Dos.', 'Tres.', 'Cuatro.'], {
      lang: 'es',
      rate: 1,
      source: 'selection',
    });
    await Promise.resolve();
    expect(callOrder).toEqual(['speak:Uno.', 'prefetch:Dos.', 'prefetch:Tres.']);
    liveMgr.setRate(1.5);
    expect(setPlaybackRate).toHaveBeenCalledWith(1.5);
    liveDeferred.resolve();
    liveMgr.stop();

    // Edge cases: empty play, idle/error setRate, togglePauseResume, next at end, dispose
    await manager.play(['   '], { lang: 'en', rate: 1, source: 'selection' });
    manager.setRate(2);
    expect(manager.getState().rate).toBe(2);

    void manager.play(['Only one.'], { lang: 'en', rate: 1.25, source: 'selection' });
    await Promise.resolve();
    manager.togglePauseResume();
    expect(manager.getState().status).toBe('paused');
    manager.togglePauseResume();
    expect(manager.getState().status).toBe('playing');
    manager.next();
    expect(manager.getState().status).toBe('idle');

    manager.setRate(0.75);
    expect(manager.getState().rate).toBe(0.75);
    manager.dispose();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
});
