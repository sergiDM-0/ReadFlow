# Source Code Review & Reproducible Build Guide (Mozilla AMO)

This document provides exact instructions for Mozilla Add-ons (AMO) reviewers to reproduce the **ReadFlow** Firefox extension bundle (`dist/firefox/`) from source and verify all third-party WebAssembly binaries.

## 1. Build Environment

- **Operating System:** Linux, macOS, or Windows
- **Node.js:** `v22.x` LTS (e.g., `22.13.0+`)
- **npm:** `v10.x+`

## 2. Reproducible Build Steps

1. Install exact locked dependencies from `package-lock.json`:

   ```bash
   npm ci
   ```

2. Run the Firefox production build (`node scripts/build.mjs firefox`):

   ```bash
   npm run build:firefox
   ```

3. The built Firefox Manifest V3 extension is output to:

   ```text
   dist/firefox/
   ```

4. *(Optional)* Run verification checks (`format:check`, `typecheck`, `lint`, `test`, `check:size`):

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run check:size
   ```

## 3. Origin of WebAssembly (`.wasm`) & Data Binaries

ReadFlow does **not** compile custom C/C++/Rust binaries. All files inside `dist/firefox/wasm/` are copied unmodified by [`scripts/build.mjs`](./scripts/build.mjs) (lines 161–176) directly from official npm packages locked in `package-lock.json`:

| File in `dist/firefox/wasm/` | Source npm package | Purpose |
|---|---|---|
| `ort-wasm-simd-threaded.mjs` | `onnxruntime-web` (`node_modules/onnxruntime-web/dist/`) | ONNX Runtime Web JS loader |
| `ort-wasm-simd-threaded.wasm` | `onnxruntime-web` (`node_modules/onnxruntime-web/dist/`) | Microsoft ONNX Runtime WebAssembly backend |
| `piper_phonemize.wasm` | `@diffusionstudio/piper-wasm` (`node_modules/@diffusionstudio/piper-wasm/build/`) | Open-source Piper `espeak-ng` phonemizer WASM |
| `piper_phonemize.data` | `@diffusionstudio/piper-wasm` (`node_modules/@diffusionstudio/piper-wasm/build/`) | Open-source `espeak-ng` phoneme data bundle |

## 4. Network & Privacy Behavior

- No remote code is fetched or executed (`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`).
- When a user selects a neural voice for the first time, the extension downloads only static voice model weights (`.onnx` and `.onnx.json`) from `https://huggingface.co/rhasspy/piper-voices` into browser `Cache Storage` (`readflow-piper-models-v1`).
- No user text, browsing history, or telemetry is ever transmitted to external servers.
