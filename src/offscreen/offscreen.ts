import browser from 'webextension-polyfill';
import { PiperRuntime } from '../core/neural/piper-runtime';
import type { ExtensionMessage } from '../shared/types';

const runtime = new PiperRuntime({
  ortWasmDir: browser.runtime.getURL('wasm/'),
  piperWasm: browser.runtime.getURL('wasm/piper_phonemize.wasm'),
  piperData: browser.runtime.getURL('wasm/piper_phonemize.data'),
});

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
      runtime.cancelPending();
      return Promise.resolve({ ok: true as const, data: { cancelled: true as const } });
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
