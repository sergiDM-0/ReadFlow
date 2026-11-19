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

## Coding & Testing Standards

1. **TypeScript Strict Mode:** No `any`, no `console.log` in `src/`, immutable state updates.
2. **Security & Privacy:** Never use `innerHTML` with untrusted content; never add telemetry or external network requests.
3. **TDD & Coverage:** Add unit/integration tests for every change and keep coverage >= 80%.
4. **Bundle Budget:** Total unpacked size for both `dist/chrome` and `dist/firefox` must stay under **200 KB** (`npm run check:size`).
5. **Conventional Commits:** Use prefixes like `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Updating Gemini Selectors

If Google Gemini updates its DOM structure, all selectors are isolated in `src/content/adapters/gemini-selectors.ts` so fixes require editing only one file.

## Verification Checklist Before Opening a PR

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run check:size
```
