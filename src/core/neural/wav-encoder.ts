const SILENCE_THRESHOLD = 0.008;
const LEAD_PAD_MS = 30;
const TRAIL_PAD_MS = 50;

/**
 * Trims dead leading and trailing silence from raw Float32 PCM audio emitted by Piper VITS
 * while preserving a natural 30 ms attack pad and 50 ms release pad.
 */
export function trimPcmSilence(samples: Float32Array, sampleRate: number): Float32Array {
  if (samples.length === 0 || sampleRate <= 0) {
    return samples;
  }

  let firstActive = -1;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]!) >= SILENCE_THRESHOLD) {
      firstActive = i;
      break;
    }
  }
  if (firstActive === -1) {
    return samples;
  }

  let lastActive = samples.length - 1;
  for (let i = samples.length - 1; i >= firstActive; i -= 1) {
    if (Math.abs(samples[i]!) >= SILENCE_THRESHOLD) {
      lastActive = i;
      break;
    }
  }

  const leadPad = Math.round((sampleRate * LEAD_PAD_MS) / 1000);
  const trailPad = Math.round((sampleRate * TRAIL_PAD_MS) / 1000);
  const start = Math.max(0, firstActive - leadPad);
  const end = Math.min(samples.length, lastActive + 1 + trailPad);

  return start === 0 && end === samples.length ? samples : samples.subarray(start, end);
}

/** Encodes mono `Float32Array` PCM samples (`-1..1`) into a 16-bit RIFF/WAVE `ArrayBuffer`. */
export function pcmToWavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const headerLength = 44;
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataLength = samples.length * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(headerLength + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x46464952, true); // 'RIFF'
  view.setUint32(4, 36 + dataLength, true);
  view.setUint32(8, 0x45564157, true); // 'WAVE'

  // fmt chunk
  view.setUint32(12, 0x20746d66, true); // 'fmt '
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);

  // data chunk
  view.setUint32(36, 0x61746164, true); // 'data'
  view.setUint32(40, dataLength, true);

  const pcm = new Int16Array(buffer, headerLength, samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    pcm[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  return buffer;
}

/** Encodes a binary `ArrayBuffer` into a Base64 string in 32 KB chunks without stack overflow. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
