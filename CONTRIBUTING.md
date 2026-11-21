# Contributing to ReadFlow

¡Gracias por contribuir a **ReadFlow**! Este documento refleja los scripts reales de [`package.json`](./package.json) y la estructura actual de [`src/`](./src).

## 1. Requisitos e instalación

- **Node.js >= 20** y **npm**
- Navegador basado en Chromium (Chrome/Brave/Edge) o Firefox para pruebas manuales

```bash
git clone <repo-url>
cd ReadFlow
npm install
npm test
npm run build
```

---

## 2. Estándares de código, seguridad y arquitectura

1. **TypeScript estricto (`tsconfig.json`):**
   - `strict: true`, `noUncheckedIndexedAccess: true`.
   - Prohibido usar `any` o dejar `console.log` en `src/`.
   - Actualizaciones de estado inmutables (ver `src/core/tts-manager.ts` y `src/shared/storage.ts`).
2. **Documentación JSDoc / TypeDoc:**
   - Toda nueva clase, interfaz exportada o función pública en `src/` debe incluir un comentario `/** ... */` encima de su declaración.
   - Puedes validar que la documentación técnica se genera sin errores con `npm run docs:api` (`npx typedoc --options typedoc.json`).
3. **Seguridad y privacidad (100 % local):**
   - Prohibido usar `innerHTML`, `outerHTML`, `insertAdjacentHTML` o `eval`. Construye nodos DOM y SVG con `document.createElement`, `document.createElementNS` y `textContent`.
   - Cualquier color persistido en `storage` debe validarse con `isValidHexColor` (`/^#[0-9a-f]{6}$/i`) antes de aplicarse a variables CSS (`src/shared/storage.ts`, `src/shared/icon-renderer.ts`).
   - Los endpoints HTTP locales deben validarse siempre con `assertLocalhostEndpoint()` (`src/core/engines/local-url.ts`), permitiendo solo `http://` en `localhost`, `127.0.0.1` o `[::1]`.
4. **Presupuesto de tamaño (`scripts/check-size.mjs`):**
   - La suma de la UI inyectada (`content.js`) + `popup.*` + `manifest.json` + `icons/*` debe mantenerse siempre **por debajo de 200 KB** tanto en `dist/chrome` como en `dist/firefox` (`npm run check:size`).
5. **TDD y cobertura (`vitest.config.ts`):**
   - Toda nueva funcionalidad o corrección debe ir acompañada de pruebas en `tests/unit/` o `tests/integration/`.
   - La cobertura global mínima obligatoria es **80 %** en `statements`, `branches`, `functions` y `lines` (`npm run test:coverage`).

---

## 3. Puntos de extensión frecuentes en `src/`

- **Agregar o ajustar voces neuronales Piper:** edita `PIPER_NEURAL_VOICES` en [`src/core/neural/piper-voices.ts`](./src/core/neural/piper-voices.ts).
- **Ajustar la rampa de streaming procedural:** edita [`src/core/segmenter.ts`](./src/core/segmenter.ts) (`segmentForStreaming`) y [`src/core/procedural-stream.ts`](./src/core/procedural-stream.ts) (`createProceduralTextStream`).
- **Agregar paletas de colores o modificar el icono del dock:** edita `ICON_COLOR_PRESETS`, `createBrandIconSvg` y `renderToolbarIconImageData` en [`src/shared/icon-renderer.ts`](./src/shared/icon-renderer.ts).
- **Actualizar selectores de Google Gemini:** todos los selectores CSS de Gemini están aislados en [`src/content/adapters/gemini-selectors.ts`](./src/content/adapters/gemini-selectors.ts).

---

## 4. Lista de verificación obligatoria antes de hacer commit / PR

Ejecuta las 6 fases de verificación y asegúrate de que todas terminen con código `0`:

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run check:size
```

Usa mensajes de commit atómicos siguiendo **Conventional Commits** (`feat:`, `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, `chore:`).
