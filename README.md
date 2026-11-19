# EchoSelect TTS

> **Lector de voz neuronal 100 % local, rápido, personalizable y de código abierto para Chrome, Firefox, Brave, Edge, Opera, Zen, Floorp y LibreWolf.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](manifest.chrome.json)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-success.svg)](SECURITY.md)
[![UI Bundle](https://img.shields.io/badge/Injected%20UI%20%2B%20Popup-%3C%20130%20KB-brightgreen.svg)](scripts/check-size.mjs)

## Características principales

### Voz neuronal suave y arranque casi instantáneo

- **Voz Neuronal Local por defecto (Piper ONNX + WebAssembly):** Reemplaza las voces robóticas del sistema operativo (como `eSpeak` en Linux) por voces neuronales suaves (`es_MX-claude-high` para español, `en_US-hfc_female-medium` para inglés y catálogo curado en ES/EN/PT/FR/DE/IT). El modelo se descarga una única vez en el `Cache Storage` del navegador y luego funciona **100 % offline**.
- **Lectura procedural incremental para textos grandes:** No procesa documentos enormes de golpe. Limpia y segmenta por ventanas (~640 caracteres) bajo demanda con una **rampa de arranque rápido** (`48 → 95 → 140 → 175` caracteres), pre-sintetizando los 2 fragmentos siguientes en segundo plano sobre un **`AudioContext` persistente** para transiciones continuas (_gapless_).
- **Velocidad natural sin distorsión de tono:** Ajusta el `length_scale` nativo de Piper ONNX (`0.75x` – `2x`) recortando silencios muertos iniciales y finales, y cancela en `0 ms` tareas pendientes al cambiar de texto.
- **Motores intercambiables (`TTSEngineInterface`):** Elige entre **Piper Neuronal Local**, **Web Speech API** (con ranking de voces naturales y pausa/reanudación corregida en Linux) o un **Endpoint HTTP Local** (`localhost` / `127.0.0.1`) para servidores propios de Piper o Kokoro.

### Interfaz moderna, anclable y personalizable (sin dejar de ser liviana)

- **Icono anclable en el dock / barra de herramientas con colores personalizables en vivo:**
  - Personaliza el **color de fondo del icono**, el **color del símbolo**, el **color de acento de la UI** y el **tema** (`Automático`, `Claro`, `Oscuro`) desde 6 paletas rápidas o selectores libres.
  - Los cambios se reflejan en tiempo real en el **icono anclado del navegador** (`browser.action.setIcon`), en el **popup** y en todos los controles flotantes en pestañas abiertas, además de mostrar insignia `ON` / `OFF` de estado.
- **Panel de configuración rápido (estilo Reverso):** Al hacer clic en el icono del dock dispones de:
  - **Caja de lectura rápida:** escribe o pega cualquier texto para escucharlo al instante, o pulsa **▶ Leer ahora** para leer la selección de la pestaña activa / **⏹ Detener**.
  - **3 pestañas limpias:** `General` (auto-lectura, velocidad en píldoras, voces), `Apariencia` (vista previa del dock, paletas, selectores de color y tema) y `Avanzado` (motor, servidor local y lista negra de sitios).
- **Auto-lectura universal ON / OFF:** Píldora flotante limpia con icono SVG (sin emojis duplicados) disponible en cualquier web y sincronizada con el popup. Al activarla en **ON**, todo texto que selecciones se lee automáticamente; en `gemini.google.com` además lee respuestas nuevas en streaming.
- **Mini-reproductor flotante arrastrable:** Ventana compacta en Shadow DOM que puedes arrastrar a cualquier esquina con el ratón (`⋮⋮`) o mover con teclado (flechas + `Inicio` para restablecer), con Play/Pausa, Detener, Anterior/Siguiente, velocidad en vivo y progreso procedural (`1/4+`).
- **Limpieza inteligente:** Omite bloques de código `<pre><code>` / Markdown, URLs largas y emojis repetitivos.

---

## Instalación y anclaje en el dock / barra de herramientas

Requisitos para compilar desde el código fuente: **Node.js >= 20** y **npm**.

```bash
npm install
npm run build
npm run check:size
```

### Google Chrome, Brave, Microsoft Edge, Opera y Vivaldi

1. Abre la página de extensiones (`chrome://extensions`, `brave://extensions`, `edge://extensions` u `opera://extensions`).
2. Activa **Modo de desarrollador** (_Developer mode_).
3. Haz clic en **Cargar descomprimida** (_Load unpacked_) y selecciona la carpeta `dist/chrome`.
4. **Cómo anclar al dock/barra:** Haz clic en el icono de piezas de rompecabezas **🧩 (Extensiones)** en la esquina superior derecha y pulsa el icono de **chincheta 📌 (Fijar)** junto a **EchoSelect TTS**.

### Mozilla Firefox, Zen Browser, LibreWolf y Floorp

1. Abre `about:debugging#/runtime/this-firefox`.
2. Haz clic en **Cargar complemento temporal...** (_Load Temporary Add-on..._).
3. Selecciona el archivo `dist/firefox/manifest.json`.
4. **Anclaje automático en el dock:** `manifest.firefox.json` incluye `"default_area": "navbar"`, por lo que el icono de **EchoSelect TTS** aparece **anclado directamente en la barra principal**. Si lo ocultaste, haz clic en **🧩** → menú del engranaje → **Anclar a la barra de herramientas**.

---

## Uso rápido y atajos

| Acción                            | Cómo hacerlo                                                                                                                    |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **Leer selección puntual**        | Selecciona texto en cualquier página y pulsa el botón flotante **🔊** o presiona **`Alt + S`**.                                 |
| **Auto-lectura al seleccionar**   | Activa la píldora **Auto-lectura: ON** en pantalla (o en el panel del dock). Cualquier texto que subrayes se leerá al instante. |
| **Lectura rápida desde el dock**  | Haz clic en el icono anclado, escribe/pega texto (o déjalo vacío para leer tu selección) y pulsa **▶ Leer ahora**.              |
| **Mover el reproductor flotante** | Arrastra desde el asa **`⋮⋮`** o enfócala con `Tab` y usa las flechas (`Inicio` restablece la posición).                        |
| **Personalizar icono y colores**  | Icono del dock → pestaña **Apariencia** → elige una paleta o colores personalizados.                                            |
| **Detener lectura**               | Pulsa **`Alt + S`**, el botón **⏹** del reproductor o **⏹ Detener** en el panel del dock.                                       |

---

## Privacidad, seguridad y presupuesto de peso

- **Cero telemetría y cero APIs externas de texto:** Tu texto nunca sale de tu equipo. Las únicas descargas opcionales son los pesos abiertos `.onnx` de Piper desde HuggingFace (una sola vez, guardados localmente en `Cache Storage`).
- **Aislamiento total:** Toda la UI inyectada corre en un `ShadowRoot` cerrado en estilos (`:host { all: initial }`), sin `innerHTML` y con validación estricta de colores hexadecimales (`#RRGGBB`) y URLs locales (`localhost` / `127.0.0.1` / `[::1]` con `redirect: 'error'`).
- **Súper liviana:** Cero React/Vue/frameworks en el _content script_ y popup.
  - **UI inyectada + Popup + Iconos:** ~**122 KB** (muy por debajo del límite de **200 KB** verificado por `npm run check:size`).
  - **Runtime local WASM (`wasm/`):** empaquetado localmente en la extensión para cumplir CSP estricto de MV3 (`wasm-unsafe-eval`, cero ejecución remota).

---

## Scripts de desarrollo y verificación

```bash
npm run format:check   # Verifica formato con Prettier
npm run typecheck      # tsc --noEmit (strict mode)
npm run lint           # ESLint (0 warnings)
npm test               # Pruebas unitarias e integración (Vitest + happy-dom)
npm run test:coverage  # Cobertura (umbral mínimo 80 % en todas las métricas)
npm run build          # Compila dist/chrome y dist/firefox
npm run check:size     # Verifica presupuesto < 200 KB en UI + Popup
npm run test:e2e       # Pruebas E2E en Chromium real (Playwright)
```

---

## Arquitectura del proyecto

```text
src/
├── background/
│   ├── message-handler.ts      # Mensajería validada (síntesis, warmup, cancel, idioma, loopback)
│   └── service-worker.ts       # Icono dinámico del dock, badge, menú contextual, Alt+S y Piper Firefox
├── offscreen/
│   ├── offscreen.html          # Documento MV3 Offscreen (Chrome/Brave/Edge)
│   └── offscreen.ts            # Host del runtime ONNX/WASM fuera del Service Worker
├── content/
│   ├── index.ts                # Entrada del content script
│   ├── app.ts                  # Orquestador: auto-lectura, streaming procedural, warmup y temas
│   ├── selection-handler.ts    # Detección de selección y posicionamiento clamped al viewport
│   ├── adapters/
│   │   ├── gemini-selectors.ts # Selectores aislados para gemini.google.com
│   │   └── gemini-adapter.ts   # MutationObserver con deduplicación en streaming
│   └── ui/
│       ├── shadow-host.ts      # Shadow DOM limpio (limpia hosts huérfanos + aplica colores CSS)
│       ├── floating-btn.ts     # Botón flotante accesible
│       ├── mini-player.ts      # Reproductor flotante arrastrable (pointer + teclado + ARIA live)
│       └── styles.ts           # Variables CSS (light/dark, acento dinámico, reduced motion)
├── core/
│   ├── cleaner.ts              # Limpieza de Markdown, código, URLs y emojis
│   ├── segmenter.ts            # Intl.Segmenter + rampa streaming (48 → 95 → 140 → 175 chars)
│   ├── procedural-stream.ts    # Generador incremental por bloques (~640 chars) para textos largos
│   ├── language-detector.ts    # Detección rápida local + fallback browser.i18n.detectLanguage
│   ├── tts-manager.ts          # Cola de oraciones, buffer procedural y lookahead de 2 chunks
│   ├── neural/
│   │   ├── piper-voices.ts     # Catálogo curado de voces neuronales suaves
│   │   ├── piper-runtime.ts    # Runtime ONNX + phonemizer WASM reutilizado + LRU + length_scale
│   │   └── wav-encoder.ts      # Codificador WAV PCM 16-bit + recorte de silencios muertos
│   └── engines/
│       ├── engine.interface.ts # Contrato TTSEngineInterface
│       ├── piper-neural.engine.ts # AudioContext persistente + pre-decodificación gapless
│       ├── web-speech.engine.ts   # Fallback OS con ranking natural y fix de pausa en Linux
│       ├── local-http.engine.ts   # Cliente HTTP local (Piper / Kokoro)
│       └── local-url.ts           # Validación estricta de loopback
├── popup/                      # Panel tipo Reverso (lectura rápida, 3 pestañas, personalizador)
└── shared/
    ├── icon-renderer.ts        # Renderizador SVG + OffscreenCanvas del icono del dock y paletas
    ├── storage.ts              # Persistencia segura con cola de escritura y sanitización hex
    └── types.ts                # Contratos TypeScript inmutables
```

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) y [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) antes de abrir un Pull Request.

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).
