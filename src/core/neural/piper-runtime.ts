import * as ort from 'onnxruntime-web/wasm';
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import { findPiperVoiceById, getPiperModelUrls } from './piper-voices';
import { arrayBufferToBase64, pcmToWavBuffer } from './wav-encoder';

interface PiperModelConfig {
  readonly audio: { readonly sample_rate: number };
  readonly espeak: { readonly voice: string };
  readonly inference: {
    readonly noise_scale: number;
    readonly length_scale: number;
    readonly noise_w: number;
  };
  readonly speaker_id_map?: Record<string, number>;
}

interface PiperPhonemizeModule {
  callMain(args: string[]): void;
}

type PiperPhonemizeFactory = (opts: {
  noExitRuntime?: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
}) => Promise<PiperPhonemizeModule>;

export interface PiperWasmPaths {
  readonly ortWasmDir: string;
  readonly piperWasm: string;
  readonly piperData: string;
}

export interface PiperSynthesizeResult {
  readonly mimeType: 'audio/wav';
  readonly audioBase64: string;
}

const CACHE_NAME = 'echoselect-piper-models-v1';
const MAX_AUDIO_CACHE_ENTRIES = 24;

function resolveOptimalWasmThreads(): number {
  const g = globalThis as unknown as {
    crossOriginIsolated?: boolean;
    navigator?: { hardwareConcurrency?: number };
  };
  if (g.crossOriginIsolated === true) {
    const cores = g.navigator?.hardwareConcurrency ?? 2;
    return Math.min(4, Math.max(1, cores));
  }
  return 1;
}

async function fetchCachedBytes(url: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        return await cached.arrayBuffer();
      }
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} downloading voice model`);
      }
      await cache.put(url, response.clone());
      return await response.arrayBuffer();
    } catch {
      // Fall through to direct fetch if Cache Storage is unavailable in private windows.
    }
  }

  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading voice model`);
  }
  return await response.arrayBuffer();
}

export class PiperRuntime {
  private readonly wasmPaths: PiperWasmPaths;
  private loadedVoiceId: string | null = null;
  private modelConfig: PiperModelConfig | null = null;
  private session: ort.InferenceSession | null = null;
  private phonemizer: PiperPhonemizeModule | null = null;
  private phonemizerInitPromise: Promise<PiperPhonemizeModule> | null = null;
  private activePrintHandler: ((line: string) => void) | null = null;
  private activeErrHandler: ((line: string) => void) | null = null;
  private readonly audioCache = new Map<string, PiperSynthesizeResult>();
  private warmupTargetVoiceId: string | null = null;
  private warmupPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(wasmPaths: PiperWasmPaths) {
    this.wasmPaths = wasmPaths;
  }

  public warmup(voiceId: string): Promise<void> {
    if (this.loadedVoiceId === voiceId && this.session && this.modelConfig && this.phonemizer) {
      return Promise.resolve();
    }
    if (this.warmupPromise && this.warmupTargetVoiceId === voiceId) {
      return this.warmupPromise;
    }

    this.warmupTargetVoiceId = voiceId;
    const task = this.queue.then(() => this.ensureVoiceLoaded(voiceId));
    this.queue = task.catch(() => undefined);
    this.warmupPromise = task.finally(() => {
      if (this.warmupPromise === task) {
        this.warmupPromise = null;
        this.warmupTargetVoiceId = null;
      }
    });
    return this.warmupPromise;
  }

  public synthesize(text: string, voiceId: string): Promise<PiperSynthesizeResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return Promise.reject(new Error('Cannot synthesize empty text.'));
    }

    const cacheKey = `${voiceId}::${trimmed}`;
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      // Refresh LRU ordering.
      this.audioCache.delete(cacheKey);
      this.audioCache.set(cacheKey, cached);
      return Promise.resolve(cached);
    }

    const task = this.queue.then(async () => {
      const result = await this.runSynthesis(trimmed, voiceId);
      this.rememberAudio(cacheKey, result);
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private rememberAudio(key: string, result: PiperSynthesizeResult): void {
    if (this.audioCache.size >= MAX_AUDIO_CACHE_ENTRIES) {
      const oldestKey = this.audioCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.audioCache.delete(oldestKey);
      }
    }
    this.audioCache.set(key, result);
  }

  private ensurePhonemizerLoaded(): Promise<PiperPhonemizeModule> {
    if (this.phonemizer) {
      return Promise.resolve(this.phonemizer);
    }
    if (this.phonemizerInitPromise) {
      return this.phonemizerInitPromise;
    }

    const factory = createPiperPhonemize as unknown as PiperPhonemizeFactory;
    this.phonemizerInitPromise = factory({
      noExitRuntime: true,
      print: (line: string) => {
        this.activePrintHandler?.(line);
      },
      printErr: (errLine: string) => {
        this.activeErrHandler?.(errLine);
      },
      locateFile: (file: string) => {
        if (file.endsWith('.wasm')) return this.wasmPaths.piperWasm;
        if (file.endsWith('.data')) return this.wasmPaths.piperData;
        return file;
      },
    })
      .then((mod) => {
        this.phonemizer = mod;
        return mod;
      })
      .finally(() => {
        this.phonemizerInitPromise = null;
      });

    return this.phonemizerInitPromise;
  }

  private async ensureVoiceLoaded(voiceId: string): Promise<void> {
    if (this.loadedVoiceId === voiceId && this.session && this.modelConfig) {
      await this.ensurePhonemizerLoaded();
      return;
    }

    ort.env.wasm.numThreads = resolveOptimalWasmThreads();
    ort.env.wasm.wasmPaths = this.wasmPaths.ortWasmDir;

    const { modelUrl, configUrl } = getPiperModelUrls(voiceId);
    const [, configBytes, modelBytes] = await Promise.all([
      this.ensurePhonemizerLoaded(),
      fetchCachedBytes(configUrl),
      fetchCachedBytes(modelUrl),
    ]);

    const configText = new TextDecoder().decode(configBytes);
    const parsedConfig = JSON.parse(configText) as PiperModelConfig;

    const prevSession = this.session;
    this.session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      enableMemPattern: true,
      enableCpuMemArena: true,
    });
    this.modelConfig = parsedConfig;
    this.loadedVoiceId = voiceId;

    if (prevSession) {
      void prevSession.release().catch(() => undefined);
    }
  }

  private async phonemize(text: string, espeakVoice: string): Promise<number[]> {
    const mod = await this.ensurePhonemizerLoaded();
    const input = JSON.stringify([{ text }]);
    let capturedIds: number[] | null = null;
    let capturedError: string | null = null;

    this.activePrintHandler = (line: string) => {
      if (capturedIds !== null) return;
      try {
        const parsed = JSON.parse(line) as { phoneme_ids?: number[] };
        if (Array.isArray(parsed.phoneme_ids)) {
          capturedIds = parsed.phoneme_ids;
        }
      } catch {
        // Ignore non-JSON diagnostic lines from espeak.
      }
    };

    this.activeErrHandler = (errLine: string) => {
      if (capturedError === null && errLine.toLowerCase().includes('error')) {
        capturedError = errLine;
      }
    };

    try {
      mod.callMain(['-l', espeakVoice, '--input', input, '--espeak_data', '/espeak-ng-data']);
    } catch (err) {
      // Discard potentially corrupted Emscripten instance so next call recovers cleanly.
      this.phonemizer = null;
      throw err;
    } finally {
      this.activePrintHandler = null;
      this.activeErrHandler = null;
    }

    if (capturedError !== null) {
      throw new Error(capturedError);
    }

    return capturedIds ?? [];
  }

  private async runSynthesis(trimmed: string, voiceId: string): Promise<PiperSynthesizeResult> {
    await this.ensureVoiceLoaded(voiceId);
    if (!this.session || !this.modelConfig) {
      throw new Error('Piper ONNX session failed to initialize.');
    }

    const phonemeIds = await this.phonemize(trimmed, this.modelConfig.espeak.voice);
    if (phonemeIds.length === 0) {
      throw new Error('Phonemizer produced empty phoneme sequence.');
    }

    const voiceSpec = findPiperVoiceById(voiceId);
    const speakerId = voiceSpec?.speakerId ?? 0;
    const { noise_scale, length_scale, noise_w } = this.modelConfig.inference;

    const inputData = BigInt64Array.from(phonemeIds.map((id) => BigInt(id)));
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor('int64', inputData, [1, phonemeIds.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]),
      scales: new ort.Tensor(
        'float32',
        new Float32Array([noise_scale, length_scale, noise_w]),
        [3]
      ),
    };

    if (
      this.modelConfig.speaker_id_map &&
      Object.keys(this.modelConfig.speaker_id_map).length > 0
    ) {
      feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speakerId)]), [1]);
    }

    const outputs = await this.session.run(feeds);
    const outputTensor = outputs.output;
    if (!outputTensor || !(outputTensor.data instanceof Float32Array)) {
      throw new Error('Piper ONNX output missing Float32 PCM audio.');
    }

    const wavBuffer = pcmToWavBuffer(outputTensor.data, this.modelConfig.audio.sample_rate);
    return {
      mimeType: 'audio/wav',
      audioBase64: arrayBufferToBase64(wavBuffer),
    };
  }
}
