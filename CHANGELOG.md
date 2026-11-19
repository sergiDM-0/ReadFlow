# Changelog

All notable changes to **EchoSelect TTS** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-11-19

### Performance

- **Near-streaming startup latency for local Piper Neural TTS**:
  - Reused a single persistent `piper_phonemize` Emscripten WASM instance (`noExitRuntime: true`) instead of reloading the 18 MB `piper_phonemize.data` archive per sentence, plus ONNX graph optimization (`graphOptimizationLevel: 'all'`), parallel phonemizer+model loading, and in-memory LRU audio cache.
  - Added proactive background warmup (`NEURAL_TTS_WARMUP`) on extension startup, text selection (while moving to click the floating play trigger), and popup voice selection.
  - Added fast-start streaming chunking (`segmentForStreaming`) that splits the opening clause (~75 chars) for minimal time-to-first-audio while overlapping synthesis of the next 2 chunks.
  - Fixed `TTSManager` prefetch ordering so the active chunk always enters the synthesis queue ahead of lookahead prefetches, and reused a persistent `AudioContext` with pre-decoded `AudioBuffer` handoff for gapless transitions.
  - Skipped redundant `DETECT_LANGUAGE` IPC roundtrips when local heuristic confidence is high.

## [1.1.0] - 2026-11-19

### Added

- Embedded **100% local Piper Neural TTS (ONNX + WebAssembly)** engine as the default voice (`es_MX-claude-high` for Spanish, `en_US-hfc_female-medium` for English, plus curated Spanish/English/PT/FR/DE/IT voices cached locally in Cache Storage after first use — zero robotic OS voices on Linux/Windows/macOS).
- Chrome MV3 Offscreen Document (`offscreen.html`) and Firefox MV3 background event-page runtime with locally bundled WASM assets (`wasm/`).
- **Draggable floating MiniPlayer window** with pointer drag (`setPointerCapture`), viewport clamping, and accessible keyboard repositioning (`Arrow` keys + `Home` reset).
- Live speed switching without restarting active neural audio and automatic next-sentence pre-fetching.
- Naturalness-aware voice ranking in `WebSpeechEngine` (preferring Neural/Natural voices over robotic eSpeak voices).

### Fixed

- Fixed **Pause / Resume** reliability across all engines: instant `AudioContext.suspend()`/`resume()` in `PiperNeuralEngine` and Linux `speech-dispatcher` workaround in `WebSpeechEngine` (`supportsPauseResume: false` cancels cleanly on Pause and resumes deterministically from the paused sentence).
- Security & WCAG 2.2 AA audit hardening (trusted background settings verification, WCAG AA dark-mode contrast, ARIA live-region cleanup, focus management).

## [1.0.0] - 2026-11-19

### Added

- Universal text selection floating trigger and Shadow DOM mini-player (`0.75x–2x` speed, Play/Pause, Stop, Prev/Next, ARIA status).
- Smart text sanitizer (omits `<pre><code>` blocks, long URLs, Markdown noise, and repetitive emojis) and `Intl.Segmenter` sentence queue with abbreviation protection.
- Automatic language detection (`browser.i18n.detectLanguage` + local heuristic fallback) and per-language local voice selection.
- Pluggable `TTSEngineInterface` with `WebSpeechEngine` (default) and loopback-validated `LocalHttpEngine` (Piper / Kokoro).
- Streaming auto-read adapter for `gemini.google.com` with isolated selector configuration (`gemini-selectors.ts`) and deduplication.
- Popup settings UI with global toggle, per-domain blocklist, default speed, preferred voices, and `Alt+S` keyboard shortcut + context menu.
- Dual MV3 builds for Chrome and Firefox (`< 200 KB` verified), Vitest unit/integration suite (`>= 80%` coverage), Playwright E2E spec, and GitHub Actions CI/Release workflows.
