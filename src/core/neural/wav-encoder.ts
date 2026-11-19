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

  let offset = headerLength;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

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
