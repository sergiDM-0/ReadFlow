# Changelog

All notable changes to **EchoSelect TTS** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-11-19

### Added

- **Customizable Dock / Toolbar Icon & Live Color Theming**:
  - New `icon-renderer.ts` renders the EchoSelect brand icon dynamically via `OffscreenCanvas` (`browser.action.setIcon`) and inline SVG (`createBrandIconSvg`), syncing custom icon background, symbol foreground, UI accent color, theme (`auto` / `light` / `dark`), and `ON`/`OFF` toolbar badge in real time across Chrome, Brave, Edge, Opera, Vivaldi, Firefox, Zen, LibreWolf, and Floorp.
  - Added `"default_area": "navbar"` in `manifest.firefox.json` so Firefox and Gecko variants pin EchoSelect directly to the main toolbar/dock on install.
- **Redesigned Reverso-Style Dock Panel (`popup.html` / `popup.css` / `popup-controller.ts`)**:
  - Header with live dynamic SVG icon, active domain subtitle, and pill global enable switch.
  - Quick-read box to speak pasted/typed text or the active tab's selection directly from the dock panel (`▶ Leer ahora` / `⏹ Detener`).
  - Clean 3-tab navigation (`General`, `Apariencia`, `Avanzado`) with tactile speed pills (`0.75x`–`2x`), live dock/floating-button color preview, 6 one-click color presets, custom color pickers, and reset button — keeping injected UI + Popup well under the 200 KB budget.
- **Comprehensive Documentation Overhaul**: updated `README.md` and `CONTRIBUTING.md` with dock pinning steps for Chromium and Gecko browsers, appearance customization guide, procedural streaming architecture, and verification checklist.

## [1.2.0] - 2026-11-19

### Added

- **Procedural incremental chunk streaming (`createProceduralTextStream`)** for large texts: processes and speaks huge selections on-demand in ~640-char batches with a progressive opening ramp (`48 → 95 → 140 → 175` chars) so time-to-first-audio stays `O(1)` regardless of document size, showing `1/4+` progress in the MiniPlayer while more batches remain.
- **Universal Auto-Read on Selection (`autoReadSelection`)**: clean SVG Auto-Read ON/OFF toggle pill available on all pages and synced with the popup; enabling it immediately reads any text you select without clicking the floating button.

### Performance

- **Faster native neural speech**: applies brisker natural cadence (`BASE_CADENCE_SCALE = 0.88`) and scales Piper ONNX `length_scale` natively by playback rate (faster synthesis with natural pitch, no chipmunk distortion), trims dead leading/trailing Piper silence (`trimPcmSilence`), and cancels obsolete queued prefetches (`NEURAL_TTS_CANCEL`) in 0 ms when switching selections.

### Fixed

- Fixed duplicated Auto-Read icon glitch by replacing OS-dependent emojis with a single inline SVG icon + ON/OFF badge and cleaning up orphaned `<echo-select-ui>` Shadow DOM hosts on extension reload.

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
