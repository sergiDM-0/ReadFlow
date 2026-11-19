# Contributing to EchoSelect TTS

Thank you for helping improve **EchoSelect TTS**!

## Development Setup

```bash
git clone <repo-url>
cd Text_to_Speech
npm install
npm test
npm run build
```

## Coding & Quality Standards

1. **TypeScript Strict Mode:** No `any`, no `console.log` in `src/`, immutable state updates.
2. **Security & Privacy:**
   - Never use `innerHTML` with untrusted content; build UI/SVG elements via safe DOM APIs (`createElement`, `createElementNS`, `textContent`).
   - Validate all persisted colors (`#RRGGBB` strict regex) and local endpoints (loopback-only with `redirect: 'error'`).
   - Never add telemetry or external analytics.
3. **TDD & Coverage:** Add unit/integration tests for every feature or fix and keep global coverage `>= 80%` across statements, branches, functions, and lines.
4. **Bundle Budget:** Injected UI + Popup assets for both `dist/chrome` and `dist/firefox` must stay under **200 KB** (`npm run check:size`). Zero heavy UI frameworks.
5. **Conventional Commits:** Use atomic commits with prefixes like `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Key Extension Points

- **Neural Voices:** Add or adjust curated voices in `src/core/neural/piper-voices.ts`.
- **Dock Icon & Color Presets:** Update presets or vector geometry in `src/shared/icon-renderer.ts`.
- **Gemini Selectors:** All Google Gemini DOM selectors are isolated in `src/content/adapters/gemini-selectors.ts`.
- **Procedural Streaming:** Tune batch windows and fast-start chunk ramp in `src/core/procedural-stream.ts` and `src/core/segmenter.ts`.

## Verification Checklist Before Opening a PR

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run check:size
```
