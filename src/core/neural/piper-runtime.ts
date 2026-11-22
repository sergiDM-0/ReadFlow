import * as ort from 'onnxruntime-web/wasm';
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import { findPiperVoiceById, getPiperModelUrls } from './piper-voices';
import { arrayBufferToBase64, pcmToWavBuffer, trimPcmSilence } from './wav-encoder';

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

const CACHE_NAME = 'readflow-piper-models-v1';
const MAX_AUDIO_CACHE_ENTRIES = 24;
// Keep at most 1 active ONNX session in the 32-bit WASM heap to prevent OOM aborts when switching voices.
const MAX_CACHED_SESSIONS = 1;
// Fixed brisk natural cadence (~10% livelier) so voice timbre stays 100% consistent across speed changes.
const BASE_CADENCE_SCALE = 0.9;
const MIN_LENGTH_SCALE = 0.65;
const MAX_LENGTH_SCALE = 1.35;

interface CachedVoiceSession {
  readonly session: ort.InferenceSession;
  readonly modelConfig: PiperModelConfig;
}

let modelCachePromise: Promise<Cache | null> | null = null;

function getModelCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') {
    return Promise.resolve(null);
  }
  if (!modelCachePromise) {
    modelCachePromise = caches.open(CACHE_NAME).catch(() => {
      modelCachePromise = null;
      return null;
    });
  }
  return modelCachePromise;
}

async function fetchCachedBytes(url: string): Promise<ArrayBuffer> {
  try {
    const cache = await getModelCache();
    if (cache) {
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
    }
  } catch {
    // Fall through to direct fetch if Cache Storage is unavailable in private windows.
  }

  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading voice model`);
  }
  return await response.arrayBuffer();
}

/**
 * Local Piper VITS ONNX + Emscripten `piper_phonemize` runtime.
 * Caches `.onnx` models in browser `Cache Storage`, reuses a single persistent phonemizer WASM instance
 * (`noExitRuntime: true`), maintains an in-memory LRU audio cache, and supports 0 ms queue cancellation.
 */
export class PiperRuntime {
  private readonly wasmPaths: PiperWasmPaths;
  private readonly sessionCache = new Map<string, CachedVoiceSession>();
  private phonemizer: PiperPhonemizeModule | null = null;
  private phonemizerInitPromise: Promise<PiperPhonemizeModule> | null = null;
  private activePrintHandler: ((line: string) => void) | null = null;
  private activeErrHandler: ((line: string) => void) | null = null;
  private readonly audioCache = new Map<string, PiperSynthesizeResult>();
  private warmupTargetVoiceId: string | null = null;
  private warmupPromise: Promise<void> | null = null;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(wasmPaths: PiperWasmPaths) {
    this.wasmPaths = wasmPaths;
  }

  /** Discards any queued synthesis tasks ahead of the next active request in 0 ms. */
  public cancelPending(): void {
    this.generation += 1;
  }

  /** Pre-loads and compiles the phonemizer WASM and ONNX model for `voiceId` in parallel. */
  public warmup(voiceId: string): Promise<void> {
    if (this.sessionCache.has(voiceId) && this.phonemizer) {
      return Promise.resolve();
    }
    if (this.warmupPromise && this.warmupTargetVoiceId === voiceId) {
      return this.warmupPromise;
    }

    this.warmupTargetVoiceId = voiceId;
    const task = this.queue.then(() => this.ensureVoiceLoaded(voiceId).then(() => undefined));
    this.queue = task.catch(() => undefined);
    this.warmupPromise = task.finally(() => {
      if (this.warmupPromise === task) {
        this.warmupPromise = null;
        this.warmupTargetVoiceId = null;
      }
    });
    return this.warmupPromise;
  }

  /**
   * Synthesizes `text` into a 16-bit PCM WAV Base64 payload using `voiceId`,
   * serving from the in-memory LRU cache when repeated.
   */
  public synthesize(text: string, voiceId: string, _rate = 1): Promise<PiperSynthesizeResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return Promise.reject(new Error('Cannot synthesize empty text.'));
    }

    // Cache key is rate-independent: playback speed is handled pitch-preservingly on the player
    // so live speed changes never invalidate prefetches, stall the queue, or distort voice timbre.
    const cacheKey = `${voiceId}::${trimmed}`;
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      // Refresh LRU ordering.
      this.audioCache.delete(cacheKey);
      this.audioCache.set(cacheKey, cached);
      return Promise.resolve(cached);
    }

    const requestGen = this.generation;
    const task = this.queue.then(async () => {
      if (requestGen !== this.generation) {
        throw new Error('Neural synthesis cancelled.');
      }
      const result = await this.runSynthesis(trimmed, voiceId, requestGen);
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

  private async ensureVoiceLoaded(voiceId: string): Promise<CachedVoiceSession> {
    const cached = this.sessionCache.get(voiceId);
    if (cached) {
      // Refresh LRU position so frequently used bilingual voices remain hot in memory.
      this.sessionCache.delete(voiceId);
      this.sessionCache.set(voiceId, cached);
      await this.ensurePhonemizerLoaded();
      return cached;
    }

    ort.env.wasm.numThreads = 1;
    (ort.env.wasm as { proxy?: boolean }).proxy = false;
    ort.env.wasm.wasmPaths = this.wasmPaths.ortWasmDir;

    const { modelUrl, configUrl } = getPiperModelUrls(voiceId);
    const [, configBytes] = await Promise.all([
      this.ensurePhonemizerLoaded(),
      fetchCachedBytes(configUrl),
    ]);

    const configText = new TextDecoder().decode(configBytes);
    const parsedConfig = JSON.parse(configText) as PiperModelConfig;

    // Release any active ONNX session BEFORE fetching/allocating the next model (~60-115 MB)
    // so the 32-bit WASM heap never holds two models simultaneously.
    while (this.sessionCache.size >= MAX_CACHED_SESSIONS) {
      const oldestKey = this.sessionCache.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.sessionCache.get(oldestKey);
      this.sessionCache.delete(oldestKey);
      if (evicted) {
        await evicted.session.release().catch(() => undefined);
      }
    }

    const session = await this.createOnnxSession(modelUrl);

    const entry: CachedVoiceSession = { session, modelConfig: parsedConfig };
    this.sessionCache.set(voiceId, entry);
    return entry;
  }

  private async createOnnxSession(modelUrl: string): Promise<ort.InferenceSession> {
    const modelBytes = await fetchCachedBytes(modelUrl);
    return ort.InferenceSession.create(new Uint8Array(modelBytes), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      enableMemPattern: false,
      enableCpuMemArena: false,
    });
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

  private async runSynthesis(
    trimmed: string,
    voiceId: string,
    requestGen: number
  ): Promise<PiperSynthesizeResult> {
    const { session, modelConfig } = await this.ensureVoiceLoaded(voiceId);
    if (requestGen !== this.generation) {
      throw new Error('Neural synthesis cancelled.');
    }

    const phonemeIds = await this.phonemize(trimmed, modelConfig.espeak.voice);
    if (phonemeIds.length === 0) {
      throw new Error('Phonemizer produced empty phoneme sequence.');
    }

    const voiceSpec = findPiperVoiceById(voiceId);
    const speakerId = voiceSpec?.speakerId ?? 0;
    const { noise_scale, length_scale, noise_w } = modelConfig.inference;
    const effectiveLengthScale = Math.min(
      MAX_LENGTH_SCALE,
      Math.max(MIN_LENGTH_SCALE, length_scale * BASE_CADENCE_SCALE)
    );

    const inputData = new BigInt64Array(phonemeIds.length);
    for (let i = 0; i < phonemeIds.length; i += 1) {
      inputData[i] = BigInt(phonemeIds[i] ?? 0);
    }
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor('int64', inputData, [1, phonemeIds.length]),
      input_lengths: new ort.Tensor('int64', new BigInt64Array([BigInt(phonemeIds.length)]), [1]),
      scales: new ort.Tensor(
        'float32',
        new Float32Array([noise_scale, effectiveLengthScale, noise_w]),
        [3]
      ),
    };

    if (modelConfig.speaker_id_map && Object.keys(modelConfig.speaker_id_map).length > 0) {
      feeds.sid = new ort.Tensor('int64', new BigInt64Array([BigInt(speakerId)]), [1]);
    }

    const outputs = await session.run(feeds);
    try {
      const outputTensor = outputs.output;
      if (!outputTensor || !(outputTensor.data instanceof Float32Array)) {
        throw new Error('Piper ONNX output missing Float32 PCM audio.');
      }

      const trimmedPcm = trimPcmSilence(outputTensor.data, modelConfig.audio.sample_rate);
      const wavBuffer = pcmToWavBuffer(trimmedPcm, modelConfig.audio.sample_rate);
      return {
        mimeType: 'audio/wav',
        audioBase64: arrayBufferToBase64(wavBuffer),
      };
    } finally {
      for (const tensor of Object.values(feeds)) {
        (tensor as { dispose?: () => void }).dispose?.();
      }
      for (const tensor of Object.values(outputs)) {
        (tensor as { dispose?: () => void }).dispose?.();
      }
    }
  }
}
