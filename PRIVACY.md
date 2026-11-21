# Privacy Policy — ReadFlow

**Effective Date:** November 21, 2026

ReadFlow ("the Extension") is a local-first browser extension for text-to-speech synthesis. We are committed to protecting your privacy and collecting zero personal data.

## 1. Local Processing of Selected Text

- **100% Local Speech Synthesis:** All text you highlight or enter into ReadFlow is processed locally within your browser using either our bundled WebAssembly neural synthesizer (`onnxruntime-web` and `@diffusionstudio/piper-wasm`) or your browser's built-in `window.speechSynthesis` API.
- **No Transmission of Page Content:** The Extension **never** sends the text you read, your browsing history, or page content to our servers or to any third-party analytics service.

## 2. Voice Model Downloads

- When you select a neural voice for the first time, the Extension downloads the corresponding open-source voice model weights (`.onnx` and `.onnx.json`) directly from Hugging Face (`https://huggingface.co/rhasspy/piper-voices`) and caches them locally in your browser's `Cache Storage` (`readflow-piper-models-v1`) for offline use.

## 3. Local Storage of Preferences

- User settings (selected voice, playback speed, theme colors, Auto-Read corner dock position, and per-domain blocklist) are stored exclusively in your browser's local extension storage (`chrome.storage.local` / `browser.storage.local`).

## 4. Optional Local HTTP Endpoint

- If you explicitly enable the optional **Local HTTP Server** engine in settings, requests are strictly restricted to loopback addresses (`localhost`, `127.0.0.1`, `[::1]`) on your own machine and are never routed to external servers.

## 5. Zero Telemetry, Ads, or Data Sales

- ReadFlow contains **no** analytics scripts, tracking pixels, advertisements, or affiliate injectors.
- We do **not** collect, sell, rent, or transfer any user data to third parties.

## 6. Contact

For privacy questions or support, please open an issue at [https://github.com/sergiDM-0/ReadFlow/issues](https://github.com/sergiDM-0/ReadFlow/issues) or use the support link on the Chrome Web Store / Firefox Add-ons listing.
