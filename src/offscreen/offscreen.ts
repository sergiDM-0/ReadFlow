import browser from 'webextension-polyfill';
import { PiperRuntime } from '../core/neural/piper-runtime';
import type { ExtensionMessage, PlaybackRate } from '../shared/types';

const runtime = new PiperRuntime({
  ortWasmDir: browser.runtime.getURL('wasm/'),
  piperWasm: browser.runtime.getURL('wasm/piper_phonemize.wasm'),
  piperData: browser.runtime.getURL('wasm/piper_phonemize.data'),
});

let activeAudio: HTMLAudioElement | null = null;
let activeBlobUrl: string | null = null;
let activeSettle: (() => void) | null = null;

function stopActiveOffscreenAudio(): void {
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    try {
      activeAudio.pause();
      activeAudio.src = '';
    } catch {
      // Ignore teardown errors.
    }
    activeAudio = null;
  }
  if (activeBlobUrl) {
    try {
      URL.revokeObjectURL(activeBlobUrl);
    } catch {
      // Ignore revoke errors.
    }
    activeBlobUrl = null;
  }
  if (activeSettle) {
    const settle = activeSettle;
    activeSettle = null;
    settle();
  }
}

async function playAudioInOffscreen(
  mimeType: string,
  audioBase64: string,
  rate: PlaybackRate
): Promise<void> {
  stopActiveOffscreenAudio();
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  activeBlobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'audio/wav' }));
  const audio = new Audio(activeBlobUrl);
  activeAudio = audio;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;

  await new Promise<void>((resolve, reject) => {
    activeSettle = () => resolve();
    audio.onended = () => {
      activeSettle = null;
      stopActiveOffscreenAudio();
      resolve();
    };
    audio.onerror = () => {
      activeSettle = null;
      stopActiveOffscreenAudio();
      reject(new Error('Offscreen audio playback failed.'));
    };
    void audio.play().catch((err: unknown) => {
      activeSettle = null;
      stopActiveOffscreenAudio();
      reject(err);
    });
  });
}

browser.runtime.onMessage.addListener(
  (rawMessage: unknown, sender: browser.Runtime.MessageSender) => {
    if (!sender || sender.id !== browser.runtime.id) {
      return undefined;
    }
    const message = rawMessage as ExtensionMessage | undefined;
    if (!message) {
      return undefined;
    }

    if (message.type === 'OFFSCREEN_PIPER_CANCEL') {
      stopActiveOffscreenAudio();
      runtime.cancelPending();
      return Promise.resolve({ ok: true as const, data: { cancelled: true as const } });
    }

    if (message.type === 'OFFSCREEN_PLAY_AUDIO') {
      return playAudioInOffscreen(
        message.payload.mimeType,
        message.payload.audioBase64,
        message.payload.rate
      )
        .then(() => ({ ok: true as const, data: { played: true as const } }))
        .catch((err: unknown) => ({
          ok: false as const,
          code: 'SYNTHESIS_FAILED',
          message: err instanceof Error ? err.message : 'Offscreen audio playback failed.',
        }));
    }

    if (message.type === 'OFFSCREEN_PIPER_WARMUP') {
      return runtime
        .warmup(message.payload.voiceId)
        .then(() => ({ ok: true as const, data: { warmed: true as const } }))
        .catch((err: unknown) => ({
          ok: false as const,
          code: 'SYNTHESIS_FAILED',
          message: err instanceof Error ? err.message : 'Neural warmup failed.',
        }));
    }

    if (message.type !== 'OFFSCREEN_PIPER_SYNTHESIZE') {
      return undefined;
    }

    return runtime
      .synthesize(message.payload.text, message.payload.voiceId, message.payload.rate)
      .then((data) => ({ ok: true as const, data }))
      .catch((err: unknown) => ({
        ok: false as const,
        code: 'SYNTHESIS_FAILED',
        message: err instanceof Error ? err.message : 'Neural synthesis failed.',
      }));
  }
);
