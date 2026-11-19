# EchoSelect TTS

> **Lector universal de texto seleccionado 100% local, liviano (<200 KB) y de código abierto para Chrome, Firefox, Brave y Edge.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](manifest.chrome.json)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-success.svg)](SECURITY.md)

## ¿Qué hace EchoSelect TTS?

- **Disparador flotante universal (estilo DeepL):** Subraya texto en cualquier página web y haz clic en el botón flotante (aislado en Shadow DOM) para escucharlo al instante.
- **Cola inteligente de oraciones:** Usa `Intl.Segmenter` (con protección de abreviaturas como `Sr.`, `Dr.`, `v1.2.3`, `etc.`) y sub-división de frases largas para evitar cortes de ~15s en Chromium.
- **Mini-reproductor accesible:** Play/Pausa, Detener, Oración anterior/siguiente, control de velocidad (`0.75x` – `2x`) e indicador de estado con soporte para modo claro y oscuro.
- **Detección automática de idioma y voces locales:** Selecciona automáticamente tu voz local preferida según el idioma del texto.
- **Limpieza inteligente de texto:** Omite bloques `<pre><code>` / Markdown, URLs largas y emojis repetitivos.
- **Auto-lectura en tiempo real para Google Gemini (`gemini.google.com`):** Botón *toggle* para leer respuestas en *streaming* párrafo por párrafo sin repetir contenido ni leer código.
- **Arquitectura Pluggable (`TTSEngineInterface`):** Usa `WebSpeechEngine` (100% nativo del navegador) por defecto, o conecta un motor neuronal local en `localhost` / `127.0.0.1` como **Piper TTS** o **Kokoro**.
- **Atajos y control por dominio:** `Alt + S` para leer/detener, menú contextual y lista negra de sitios desde el popup.

## Privacidad y Ligereza

- **Cero telemetría y cero servidores externos.**
- Los endpoints HTTP locales están restringidos estrictamente a direcciones loopback (`localhost`, `127.0.0.1`, `[::1]`) con `redirect: 'error'`.
- Cero frameworks pesados en el *content script* (Vanilla TypeScript + Shadow DOM + CSS puro).

## Instalación en modo desarrollador (3 pasos)

Requisitos: **Node.js >= 20** y **npm**.

```bash
npm install
npm run build
npm run check:size
```

### Chrome / Brave / Edge
1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Haz clic en **Cargar descomprimida** (*Load unpacked*).
3. Selecciona la carpeta `dist/chrome`.

### Firefox
1. Abre `about:debugging#/runtime/this-firefox`.
2. Haz clic en **Cargar complemento temporal...** (*Load Temporary Add-on*).
3. Selecciona `dist/firefox/manifest.json`.

## Scripts de desarrollo y verificación

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # Pruebas unitarias e integración (Vitest + happy-dom)
npm run test:coverage  # Cobertura (umbral mínimo 80%)
npm run build          # Genera dist/chrome y dist/firefox
npm run check:size     # Verifica que ambos bundles pesen < 200 KB
npm run test:e2e       # Pruebas E2E en Chromium real (Playwright)
```

## Arquitectura

```text
src/
├── background/
│   ├── message-handler.ts      # Detección de idioma y proxy loopback validado
│   └── service-worker.ts       # Menú contextual, atajo Alt+S y mensajería MV3
├── content/
│   ├── index.ts                # Orquestador del content script
│   ├── selection-handler.ts    # Detección de selección y clamping al viewport
│   ├── adapters/
│   │   ├── gemini-selectors.ts # Selectores aislados (fácil mantenimiento)
│   │   └── gemini-adapter.ts   # MutationObserver con deduplicación en streaming
│   └── ui/
│       ├── shadow-host.ts      # Aislamiento Shadow DOM (:host { all: initial })
│       ├── floating-btn.ts     # Botón flotante accesible
│       ├── mini-player.ts      # Controles de reproducción + ARIA live status
│       └── styles.ts           # Variables CSS (light/dark + reduced motion)
├── core/
│   ├── cleaner.ts              # Limpieza de Markdown, código y URLs
│   ├── segmenter.ts            # Segmentación con Intl.Segmenter + fallback
│   ├── language-detector.ts    # i18n.detectLanguage + heurística local
│   ├── tts-manager.ts          # Cola inmutable de oraciones y estado
│   └── engines/
│       ├── engine.interface.ts # Estrategia TTSEngineInterface
│       ├── local-url.ts        # Validación estricta de endpoints loopback
│       ├── web-speech.engine.ts
│       └── local-http.engine.ts
├── popup/                      # Configuración, voces y lista negra por dominio
└── shared/
    ├── storage.ts              # Wrapper de browser.storage (webextension-polyfill)
    └── types.ts                # Contratos TypeScript inmutables
```

## Roadmap

- [ ] Adaptadores de auto-lectura para ChatGPT y Claude.
- [ ] Resaltado sincronizado palabra/oración en pantalla.
- [ ] Soporte mejorado para lectores PDF embebidos e `iframe`.
- [ ] Traducción del popup a inglés y portugués.

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) y [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) antes de abrir un Pull Request.

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).
