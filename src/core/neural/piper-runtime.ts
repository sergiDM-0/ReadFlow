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
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(wasmPaths: PiperWasmPaths) {
    this.wasmPaths = wasmPaths;
  }

  public synthesize(text: string, voiceId: string): Promise<PiperSynthesizeResult> {
    const task = this.queue.then(() => this.runSynthesis(text, voiceId));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async ensureVoiceLoaded(voiceId: string): Promise<void> {
    if (this.loadedVoiceId === voiceId && this.session && this.modelConfig) {
      return;
    }

    // Configure single-threaded local WASM (no SharedArrayBuffer / COOP-COEP needed in MV3).
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = this.wasmPaths.ortWasmDir;

    const { modelUrl, configUrl } = getPiperModelUrls(voiceId);
    const [configBytes, modelBytes] = await Promise.all([
      fetchCachedBytes(configUrl),
      fetchCachedBytes(modelUrl),
    ]);

    const configText = new TextDecoder().decode(configBytes);
    const parsedConfig = JSON.parse(configText) as PiperModelConfig;

    const prevSession = this.session;
    this.session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
    });
    this.modelConfig = parsedConfig;
    this.loadedVoiceId = voiceId;

    if (prevSession) {
      void prevSession.release().catch(() => undefined);
    }
  }

  private async phonemize(text: string, espeakVoice: string): Promise<number[]> {
    const factory = createPiperPhonemize as unknown as PiperPhonemizeFactory;
    const input = JSON.stringify([{ text: text.trim() }]);

    return new Promise<number[]>((resolve, reject) => {
      let resolved = false;
      void factory({
        print: (line: string) => {
          if (resolved) return;
          try {
            const parsed = JSON.parse(line) as { phoneme_ids?: number[] };
            if (Array.isArray(parsed.phoneme_ids)) {
              resolved = true;
              resolve(parsed.phoneme_ids);
            }
          } catch {
            // Ignore non-JSON diagnostic lines from espeak.
          }
        },
        printErr: (errLine: string) => {
          if (!resolved && errLine.toLowerCase().includes('error')) {
            resolved = true;
            reject(new Error(errLine));
          }
        },
        locateFile: (file: string) => {
          if (file.endsWith('.wasm')) return this.wasmPaths.piperWasm;
          if (file.endsWith('.data')) return this.wasmPaths.piperData;
          return file;
        },
      })
        .then((mod) => {
          mod.callMain(['-l', espeakVoice, '--input', input, '--espeak_data', '/espeak-ng-data']);
          if (!resolved) {
            resolved = true;
            resolve([]);
          }
        })
        .catch((err) => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
    });
  }

  private async runSynthesis(text: string, voiceId: string): Promise<PiperSynthesizeResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Cannot synthesize empty text.');
    }

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
