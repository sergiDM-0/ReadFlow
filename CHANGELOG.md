# Changelog

All notable changes to **EchoSelect TTS** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-19

### Added
- Universal text selection floating trigger and Shadow DOM mini-player (`0.75x–2x` speed, Play/Pause, Stop, Prev/Next, ARIA status).
- Smart text sanitizer (omits `<pre><code>` blocks, long URLs, Markdown noise, and repetitive emojis) and `Intl.Segmenter` sentence queue with abbreviation protection.
- Automatic language detection (`browser.i18n.detectLanguage` + local heuristic fallback) and per-language local voice selection.
- Pluggable `TTSEngineInterface` with `WebSpeechEngine` (default) and loopback-validated `LocalHttpEngine` (Piper / Kokoro).
- Streaming auto-read adapter for `gemini.google.com` with isolated selector configuration (`gemini-selectors.ts`) and deduplication.
- Popup settings UI with global toggle, per-domain blocklist, default speed, preferred voices, and `Alt+S` keyboard shortcut + context menu.
- Dual MV3 builds for Chrome and Firefox (`< 200 KB` verified), Vitest unit/integration suite (`>= 80%` coverage), Playwright E2E spec, and GitHub Actions CI/Release workflows.
