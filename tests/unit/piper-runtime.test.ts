import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock, releaseMock, createSessionMock, callMainMock, phonemizeFactoryMock } = vi.hoisted(
  () => {
    const runMock = vi.fn();
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    const createSessionMock = vi.fn();
    const callMainMock = vi.fn();
    const phonemizeFactoryMock = vi.fn();
    return { runMock, releaseMock, createSessionMock, callMainMock, phonemizeFactoryMock };
  }
);

vi.mock('onnxruntime-web/wasm', () => {
  class FakeTensor {
    public readonly type: string;
    public readonly data: unknown;
    public readonly dims: readonly number[];
    public constructor(type: string, data: unknown, dims: readonly number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }
  return {
    env: { wasm: { numThreads: 4, wasmPaths: '' } },
    Tensor: FakeTensor,
    InferenceSession: {
      create: createSessionMock,
    },
  };
});

vi.mock('@diffusionstudio/piper-wasm/build/piper_phonemize.js', () => ({
  default: phonemizeFactoryMock,
}));

import { PiperRuntime } from '../../src/core/neural/piper-runtime';

describe('PiperRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const fakeConfig = JSON.stringify({
      audio: { sample_rate: 22050 },
      espeak: { voice: 'es-419' },
      inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
      speaker_id_map: { s0: 0, s1: 1 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        clone() {
          return this;
        },
        arrayBuffer: async () =>
          url.endsWith('.json')
            ? new TextEncoder().encode(fakeConfig).buffer
            : new Uint8Array([1, 2, 3, 4]).buffer,
      }))
    );

    createSessionMock.mockResolvedValue({
      run: runMock,
      release: releaseMock,
    });

    runMock.mockResolvedValue({
      output: { data: new Float32Array([0, 0.25, -0.25, 0.5]) },
    });

    phonemizeFactoryMock.mockImplementation(
      async (opts: { print: (line: string) => void; locateFile: (f: string) => string }) => {
        expect(opts.locateFile('piper_phonemize.wasm')).toBe('ext://wasm/piper_phonemize.wasm');
        expect(opts.locateFile('piper_phonemize.data')).toBe('ext://wasm/piper_phonemize.data');
        expect(opts.locateFile('other.txt')).toBe('other.txt');
        return {
          callMain: () => {
            callMainMock();
            opts.print(JSON.stringify({ phoneme_ids: [1, 14, 22, 2] }));
          },
        };
      }
    );
  });

  it('loads voice model once, synthesizes WAV base64, caches session, and releases on voice switch', async () => {
    const runtime = new PiperRuntime({
      ortWasmDir: 'ext://wasm/',
      piperWasm: 'ext://wasm/piper_phonemize.wasm',
      piperData: 'ext://wasm/piper_phonemize.data',
    });

    const first = await runtime.synthesize('Hola mundo', 'es_MX-claude-high');
    expect(first.mimeType).toBe('audio/wav');
    expect(first.audioBase64.length).toBeGreaterThan(10);
    expect(createSessionMock).toHaveBeenCalledTimes(1);

    // Same voice reuses existing ONNX session
    const second = await runtime.synthesize('Segunda frase', 'es_MX-claude-high');
    expect(second.mimeType).toBe('audio/wav');
    expect(createSessionMock).toHaveBeenCalledTimes(1);

    // Switching voice loads new session and releases previous one
    await runtime.synthesize('Tercera frase', 'es_ES-sharvard-medium');
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rejects empty text cleanly', async () => {
    const runtime = new PiperRuntime({
      ortWasmDir: 'ext://wasm/',
      piperWasm: 'ext://wasm/piper_phonemize.wasm',
      piperData: 'ext://wasm/piper_phonemize.data',
    });
    await expect(runtime.synthesize('   ', 'es_MX-claude-high')).rejects.toThrow(/empty text/i);
  });

  it('uses Cache Storage when available and throws on HTTP error when downloading model', async () => {
    const cacheMap = new Map<string, { arrayBuffer: () => Promise<ArrayBuffer> }>();
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({
        match: vi.fn(async (url: string) => cacheMap.get(url)),
        put: vi.fn(async (url: string, res: { arrayBuffer: () => Promise<ArrayBuffer> }) => {
          cacheMap.set(url, res);
        }),
      }),
    });

    const runtime = new PiperRuntime({
      ortWasmDir: 'ext://wasm/',
      piperWasm: 'ext://wasm/piper_phonemize.wasm',
      piperData: 'ext://wasm/piper_phonemize.data',
    });

    await runtime.synthesize('Cacheado', 'es_MX-claude-high');
    expect(cacheMap.size).toBe(2);

    // Second runtime hits warm Cache Storage without hitting fetch
    const runtime2 = new PiperRuntime({
      ortWasmDir: 'ext://wasm/',
      piperWasm: 'ext://wasm/piper_phonemize.wasm',
      piperData: 'ext://wasm/piper_phonemize.data',
    });
    const fetchCallsBefore = vi.mocked(fetch).mock.calls.length;
    await runtime2.synthesize('Desde cache', 'es_MX-claude-high');
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore);

    vi.stubGlobal('caches', undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })
    );
    const runtime3 = new PiperRuntime({
      ortWasmDir: 'ext://wasm/',
      piperWasm: 'ext://wasm/piper_phonemize.wasm',
      piperData: 'ext://wasm/piper_phonemize.data',
    });
    await expect(runtime3.synthesize('Fallo', 'es_MX-claude-high')).rejects.toThrow(/503/);
  });
});
