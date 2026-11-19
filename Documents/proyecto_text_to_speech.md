# Especificación Técnica y Guía Open Source: EchoSelect TTS

> **Nombre tentativo del proyecto:** `EchoSelect TTS` (Lector universal de texto seleccionado 100% local, liviano y de código abierto).

---

## 1. Visión General del Proyecto

**EchoSelect TTS** es una extensión de navegador multiplataforma (Chrome, Firefox, Brave, Edge) diseñada para leer en voz alta cualquier texto subrayado en cualquier página web mediante un botón flotante minimalista (inspirado en la experiencia de usuario de DeepL), ejecutándose **100% de forma local** y con un consumo mínimo de recursos.

Adicionalmente, incluye un **módulo especializado para chats de IA** (iniciando con Google Gemini) que permite la lectura automática en tiempo real (*streaming*) a medida que se generan las respuestas, omitiendo bloques de código y formato ruidoso.

---

## 2. ¿Qué tiene que hacer el proyecto? (Requerimientos)

### 2.1 Requerimientos Funcionales (RF)

1. **Disparador Universal por Selección:**
   * Detectar cuando el usuario selecciona texto en cualquier sitio web (`<all_urls>`).
   * Mostrar un ícono flotante discreto junto al final de la selección sin alterar el diseño ni el flujo de lectura de la página.
   * Ocultar automáticamente el botón si el usuario hace clic fuera o limpia la selección.

2. **Reproducción Local con Cola de Oraciones:**
   * Iniciar la lectura inmediata usando las voces nativas del sistema operativo a través de la API `window.speechSynthesis`.
   * Dividir textos largos en oraciones (`.`, `?`, `!`, `\n`) para evitar cortes abruptos (especialmente el límite de ~15 segundos de Chromium) y reducir la latencia inicial.

3. **Mini-Reproductor Flotante (Overlay):**
   * Al activar la lectura, mostrar una píldora flotante compacta con controles de:
     * **Reproducir / Pausar**
     * **Detener**
     * **Saltar oración anterior / siguiente**
     * **Control de velocidad** (`0.75x`, `1x`, `1.25x`, `1.5x`, `2x`)
     * **Indicador visual de estado** (leyendo / pausado).

4. **Detección Automática de Idioma:**
   * Identificar el idioma del texto seleccionado (ej. español vs. inglés) y asignar automáticamente la voz local preferida para ese idioma.

5. **Limpieza Inteligente de Texto (Sanitización):**
   * Eliminar o resumir elementos que suenan mal en voz alta: URLs largas, símbolos repetitivos de Markdown, bloques `<pre><code>` (reemplazables por *"bloque de código omitido"*) y saltos de línea innecesarios.

6. **Módulo Especial para Gemini (`gemini.google.com`):**
   * Botón *toggle* para activar/desactivar el modo **"Lectura Automática"**.
   * Detectar nuevas respuestas en *streaming* y leerlas párrafo por párrafo sin necesidad de subrayar manualmente.

7. **Panel de Configuración (Popup) y Atajos de Teclado:**
   * Permitir activar/desactivar la extensión globalmente o por dominio (lista negra de sitios donde no quieres que aparezca el botón).
   * Seleccionar voces preferidas por idioma y ajustar velocidad por defecto.
   * Soportar atajos de teclado (ej. `Alt + S` para leer la selección actual o detener la lectura).

8. **Modo Avanzado Opcional (Arquitectura Pluggable):**
   * Permitir configurar un *endpoint* local (`http://localhost:...`) para usuarios avanzados que deseen conectar motores neuronales offline como **Piper TTS** o **Kokoro** en lugar de las voces del sistema.

### 2.2 Requerimientos No Funcionales (RNF)

* **Privacidad Total:** Cero telemetría, cero servidores externos y cero envío de texto a terceros. Todo ocurre en el navegador del usuario.
* **Rendimiento y Ligereza:** Peso total del paquete menor a 200 KB (sin modelos pesados embebidos) y consumo de memoria casi nulo en reposo.
* **Aislamiento Visual:** La interfaz inyectada nunca debe heredar estilos de la página anfitriona ni romper el CSS del sitio web visitado.
* **Compatibilidad Cross-Browser:** Código base único compatible con Manifest V3 en navegadores basados en Chromium y en Firefox.
* **Accesibilidad:** Controles navegables por teclado, atributos `aria-label` claros y buen contraste en modo claro y oscuro.

---

## 3. Arquitectura del Sistema

La extensión sigue una **arquitectura modular basada en eventos y adaptadores**, separando estrictamente la interfaz inyectada, la lógica de procesamiento de texto y el motor de síntesis de voz.

### 3.1 Diagrama de Componentes

```text
+-------------------------------------------------------------------+
|                        PÁGINA WEB ANFITRIONA                      |
|  [DOM del sitio] <--- (lectura) --- [Selection Listener]          |
|                                            |                      |
|  [Shadow DOM Host]                         v                      |
|  ├── Botón Flotante (estilo DeepL)   [DOM Cleaner / Parser]       |
|  └── Mini-Reproductor                      |                      |
|         ^                                  v                      |
|         | (eventos UI)            [Language Detector]             |
|         v                                  |                      |
|  [TTS Manager / Sentence Queue] <----------+                      |
|     ├── Adaptador 1: Web Speech API (Por defecto, 100% nativo)    |
|     └── Adaptador 2: Local HTTP Engine (Opcional: Piper/Kokoro)   |
+-------------------------------------------------------------------+
         ^                                         ^
         | (mensajes browser.runtime)              | (preferencias)
         v                                         v
+------------------------+              +---------------------------+
|   Background Service   |              |    Storage API (Sync/     |
|   Worker (Atajos,      |              |    Local) + Popup UI      |
|   i18n.detectLanguage) |              |                           |
+------------------------+              +---------------------------+
```

### 3.2 Decisiones Arquitectónicas Clave

1. **Shadow DOM (Modo `open` o `closed`):**
   * Todo el HTML y CSS del botón flotante y del mini-reproductor se monta dentro de un `ShadowRoot`. Esto garantiza encapsulación completa frente a hojas de estilo agresivas (como Tailwind o estilos globales de blogs y aplicaciones SPA).
2. **Patrón Strategy para el Motor de Voz (`TTSEngineInterface`):**
   * Definir una interfaz común (`speak(text, options)`, `pause()`, `resume()`, `stop()`, `getVoices()`).
   * Permite que el motor por defecto sea `WebSpeechEngine` y que en el futuro la comunidad pueda añadir fácilmente adaptadores locales (`PiperLocalEngine`, `KokoroLocalEngine`) sin tocar la interfaz ni el gestor de colas.
3. **Cola de Oraciones (`SentenceQueue`):**
   * Divide el texto usando `Intl.Segmenter` (API nativa moderna del navegador para segmentación lingüística precisa) con *fallback* a expresiones regulares.
   * Encadena cada segmento mediante el evento `onend`, evitando bloqueos del sintetizador en textos extensos.
4. **Módulos por Sitio (Site Adapters):**
   * El núcleo funciona en toda la web. Los adaptadores específicos (como `gemini-adapter.js`) se cargan de forma condicional según el `hostname` y usan selectores resilientes (atributos `role`, `aria-live`, estructura semántica) en lugar de depender únicamente de clases CSS ofuscadas que cambian con frecuencia.

### 3.3 Estructura de Carpetas Recomendada

```text
echo-select-tts/
├── .github/
│   ├── workflows/           # CI/CD (lint, tests, build, release)
│   └── ISSUE_TEMPLATE/      # Plantillas de bugs y features
├── public/
│   └── icons/               # Íconos SVG/PNG (16, 32, 48, 128px)
├── src/
│   ├── background/
│   │   └── service-worker.ts    # Atajos, detección de idioma, menú contextual
│   ├── content/
│   │   ├── index.ts             # Punto de entrada del content script
│   │   ├── selection-handler.ts # Cálculo de coordenadas (getBoundingClientRect)
│   │   ├── ui/
│   │   │   ├── shadow-host.ts   # Contenedor Shadow DOM
│   │   │   ├── floating-btn.ts  # Botón estilo DeepL
│   │   │   └── mini-player.ts   # Barra de controles de reproducción
│   │   └── adapters/
│   │       └── gemini-adapter.ts # MutationObserver para auto-lectura
│   ├── core/
│   │   ├── cleaner.ts           # Limpieza de Markdown, código y URLs
│   │   ├── segmenter.ts         # División en oraciones (Intl.Segmenter)
│   │   ├── tts-manager.ts       # Controlador de cola y estado
│   │   └── engines/
│   │       ├── engine.interface.ts
│   │       ├── web-speech.engine.ts
│   │       └── local-http.engine.ts
│   ├── popup/                   # Interfaz de configuración de la extensión
│   └── shared/
│       ├── storage.ts           # Wrapper de browser.storage
│       └── types.ts             # Tipos TypeScript compartidos
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── manifest.chrome.json         # Manifiesto MV3 específico para Chromium
├── manifest.firefox.json        # Manifiesto MV3 específico para Firefox
├── package.json
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
└── LICENSE
```

---

## 4. Stack Tecnológico

Para mantener la extensión ultra liviana, fácil de contribuir y sin sobrecarga innecesaria:

| Capa | Tecnología Recomendada | Justificación |
| :--- | :--- | :--- |
| **Lenguaje** | **TypeScript** | Tipado estático para evitar errores en APIs del DOM y facilitar contribuciones de terceros. |
| **UI Inyectada** | **Vanilla TS + Web Components / Shadow DOM** | Cero peso de frameworks (sin React/Vue en el *content script*), carga instantánea en cualquier web. |
| **Estilos** | **CSS puro con variables CSS** | Soporte nativo para modo claro/oscuro (`prefers-color-scheme`) sin dependencias. |
| **Empaquetador (Build)** | **Vite** (con `vite-plugin-web-extension` o **WXT**) | *Hot Reload* rápido durante desarrollo y generación automática de builds separados para Chrome y Firefox. |
| **Compatibilidad WebExt** | **`webextension-polyfill`** (de Mozilla) | Unifica las promesas entre `chrome.*` y `browser.*` en un solo código base. |
| **Síntesis de Voz** | **Web Speech API (`window.speechSynthesis`)** | 100% local, nativa del navegador y sin costo de recursos ni red. |
| **Calidad de Código** | **ESLint + Prettier** (o **Biome**) | Formato consistente y detección temprana de errores. |

---

## 5. Estrategia de Pruebas (Testing)

Un proyecto open source confiable debe tener pruebas automatizadas que se ejecuten en cada *Pull Request*.

### 5.1 Pruebas Unitarias (Vitest)
Enfocadas en lógica pura sin depender del navegador real:
* **`cleaner.test.ts`:** Verificar que bloques de código, URLs largas, emojis repetitivos y caracteres especiales se limpien correctamente.
* **`segmenter.test.ts`:** Comprobar que abreviaturas comunes (ej. `Sr.`, `Dr.`, `v1.2.3`, `etc.`) no corten las oraciones a la mitad.
* **`tts-manager.test.ts`:** Simular (*mock*) `speechSynthesis` para probar la cola de reproducción: pausar, reanudar, cancelar a mitad de texto, cambiar velocidad en vivo y manejo de errores.

### 5.2 Pruebas de Integración (Vitest + jsdom / happy-dom)
* Verificar que `selection-handler` calcule posiciones válidas dentro del *viewport* (evitando que el botón flotante se salga de la pantalla en los bordes).
* Verificar que el Shadow DOM se monte y desmonte limpiamente sin dejar fugas de memoria (*memory leaks*) ni *event listeners* huérfanos.
* Probar `gemini-adapter.ts` simulando mutaciones de DOM progresivas (*streaming* de texto) para confirmar que no lee dos veces el mismo párrafo.

### 5.3 Pruebas End-to-End / E2E (Playwright)
* Cargar la extensión compilada en un navegador Chromium real.
* Abrir una página de prueba local, simular el arrastre del ratón para subrayar texto, verificar que aparezca el botón dentro del Shadow DOM y que al hacer clic se abra el mini-reproductor.

### 5.4 Matriz de Pruebas Manuales (Antes de cada Release)
Dado que las voces del sistema operativo varían mucho entre plataformas, mantener una lista de verificación manual:
* **macOS:** Safari/Firefox/Chrome (voces nativas de Apple).
* **Linux (Debian/Ubuntu):** Firefox y Chromium (verificación con `speech-dispatcher` / voces locales).
* **Windows:** Edge y Chrome (voces SAPI / Microsoft Natural).
* **Sitios complejos:** Google Docs, PDFs integrados en el navegador, páginas con `iframe` y Google Gemini.

---

## 6. Despliegue y Distribución

### 6.1 Pipeline de CI/CD con GitHub Actions
Configurar flujos automáticos en `.github/workflows/`:
1. **CI (`ci.yml`):** En cada *push* o *Pull Request*, ejecuta linter, chequeo de tipos (`tsc --noEmit`), pruebas unitarias y build de producción.
2. **Release (`release.yml`):** Al publicar un tag (ej. `v1.0.0`), compila automáticamente:
   * `echo-select-tts-chrome-v1.0.0.zip`
   * `echo-select-tts-firefox-v1.0.0.zip` (junto con el paquete de código fuente que exige Mozilla para revisión)
   * Adjunta los archivos directamente a **GitHub Releases**.

### 6.2 Publicación en Tiendas Oficiales
1. **Chrome Web Store (Chrome, Brave, Arc, Opera):**
   * Requiere cuenta de desarrollador (pago único de $5 USD).
   * Justificar claramente cada permiso en el formulario de privacidad (pedir permisos mínimos: `storage`, `activeTab` o *host permissions* bien explicados).
2. **Firefox Add-ons (AMO - addons.mozilla.org):**
   * Completamente gratuito.
   * Como usas TypeScript/Vite, Mozilla requiere subir el código fuente original + instrucciones exactas de compilación para verificar que el bundle coincide con el código abierto.
3. **Microsoft Edge Add-ons:**
   * Gratuito y acepta prácticamente el mismo paquete `.zip` de Chrome.

*(Opcional)* Automatizar la subida a Chrome Web Store y AMO usando herramientas como `wxt submit` o `web-ext` desde GitHub Actions.

---

## 7. Mantenimiento y Ciclo de Vida

1. **Versionado Semántico (SemVer - `MAJOR.MINOR.PATCH`):**
   * `PATCH` (`1.0.1`): Corrección de bugs o actualización de selectores si cambia el DOM de Gemini.
   * `MINOR` (`1.1.0`): Nuevas funciones compatibles (ej. nuevo adaptador para ChatGPT o Claude, soporte para Piper TTS).
   * `MAJOR` (`2.0.0`): Cambios estructurales grandes en la configuración o arquitectura.
2. **Resiliencia ante cambios de Gemini:**
   * Aislar los selectores de `gemini-adapter.ts` en un único archivo de configuración para que, si Google actualiza la interfaz, cualquier colaborador pueda arreglarlo cambiando 2 líneas en un *Pull Request* rápido.
3. **Dependencias al día:**
   * Activar **Dependabot** o **Renovate** en GitHub para recibir PRs automáticos con actualizaciones de seguridad en dependencias de desarrollo (`vite`, `typescript`, `vitest`).
4. **Historial de Cambios:**
   * Mantener un `CHANGELOG.md` actualizado (siguiendo *Keep a Changelog* y *Conventional Commits* como `feat:`, `fix:`, `docs:`).

---

## 8. Cómo hacer que sea un gran repositorio Open Source en GitHub

Un código excelente no basta si la presentación y la experiencia para colaboradores están descuidadas. Para que destaque y atraiga estrellas y contribuciones:

1. **Un `README.md` impecable (Tu carta de presentación):**
   * **Logo limpio + Badges** (Licencia, Versión, Build Passing, Navegadores soportados).
   * **GIF o video corto (10-15 segundos) arriba del todo:** Mostrando el flujo real (subrayar texto $\rightarrow$ aparece el botón $\rightarrow$ empieza a leer) y el modo automático en Gemini. Es el factor #1 para conseguir estrellas.
   * **Propuesta de valor clara:** Enfatizar *"100% local, cero rastreo, ultra liviano, sin API keys"*.
   * **Guía rápida de instalación** (tanto desde tiendas como en modo desarrollador en 3 pasos).
   * **Roadmap público:** Lista de funciones planeadas (ej. soporte para Claude/ChatGPT, conexión con Piper TTS, lectura de PDFs) para que la gente vea en qué puede colaborar.

2. **Documentación de Comunidad Estándar:**
   * **`CONTRIBUTING.md`:** Cómo clonar, correr el proyecto en local, ejecutar pruebas y enviar un PR.
   * **`CODE_OF_CONDUCT.md`:** Adopta el *Contributor Covenant* estándar.
   * **`SECURITY.md`:** Cómo reportar vulnerabilidades de forma responsable.
   * **Plantillas de Issues y PRs:** En `.github/ISSUE_TEMPLATE/` (Reporte de Bug, Solicitud de Función, Falla en un sitio web específico).

3. **Facilitar la primera contribución:**
   * Crear issues claros y pequeños con las etiquetas **`good first issue`** y **`help wanted`** (ej. *"Traducir el popup al portugués"*, *"Añadir atajo de teclado para subir velocidad"*).
   * Responder con amabilidad y rapidez a los primeros issues o PRs que lleguen.

4. **Visibilidad y Lanzamiento:**
   * Añadir *Topics* relevantes en GitHub (`browser-extension`, `tts`, `text-to-speech`, `web-speech-api`, `privacy`, `accessibility`, `gemini`, `open-source`).
   * Al tener un MVP pulido con GIF, compartirlo en comunidades como Reddit (`r/opensource`, `r/firefox`, `r/chrome_extensions`, `r/SideProject`) o Hacker News (*Show HN*).

---

## 9. Licencias de Software Libre: Comparativa y Recomendación

Elegir la licencia correcta desde el primer commit es fundamental: sin una licencia explícita en GitHub, por defecto el código tiene todos los derechos reservados y legalmente nadie puede usarlo ni contribuir.

### 9.1 Principales Licencias de Software Libre y Código Abierto

Las licencias se dividen en dos grandes familias: **Permisivas** (máxima libertad para reutilizar incluso en proyectos cerrados) y **Copyleft** (exigen que cualquier mejora o derivado también sea libre).

| Licencia | Tipo | ¿Permite uso comercial? | ¿Exige liberar cambios (Copyleft)? | Resumen práctico |
| :--- | :--- | :--- | :--- | :--- |
| **MIT** | Permisiva | Sí | No | La más simple y popular. Cualquiera puede usar, copiar, modificar y distribuir tu código (incluso en software propietario) siempre que mantenga tu aviso de copyright y la licencia. |
| **Apache 2.0** | Permisiva | Sí | No | Similar a MIT, pero más robusta legalmente: incluye una concesión explícita de patentes y obliga a indicar si se modificaron los archivos. Muy valorada en entornos corporativos. |
| **BSD (2-Clause / 3-Clause)** | Permisiva | Sí | No | Muy parecida a MIT. La versión 3-Clause añade que nadie puede usar tu nombre o marca para promocionar productos derivados sin permiso. |
| **MPL 2.0** *(Mozilla Public License)* | Copyleft débil (por archivo) | Sí | Solo en archivos modificados | Punto medio excelente. Si alguien modifica tus archivos, debe liberar esas mejoras bajo MPL 2.0; pero puede combinarlos con archivos nuevos bajo otra licencia. |
| **GPL v3** *(GNU General Public License)* | Copyleft fuerte | Sí | Sí (todo el proyecto) | Garantiza que tu software y **cualquier extensión o fork derivado** permanezcan 100% libres y de código abierto bajo GPL v3. Evita que una empresa tome tu extensión, la cierre y la venda. |
| **AGPL v3** | Copyleft de red | Sí | Sí (incluso si corre en un servidor) | Como GPL v3, pero diseñada para aplicaciones web/SaaS: obliga a liberar el código incluso si solo se ofrece como servicio en la nube. (Menos necesaria para una extensión 100% local). |

### 9.2 ¿Cuál licencia te conviene para EchoSelect TTS?

Tu elección depende de tu objetivo estratégico con el proyecto:

* **Opción A — Recomendada si quieres máxima adopción y portafolio: `MIT License`**
  * Es el estándar de facto en extensiones web y proyectos de JavaScript/TypeScript. Reduce al mínimo cualquier fricción para que otros desarrolladores hagan *fork*, reutilicen módulos (como tu `SentenceQueue` o `ShadowDOM` UI) y contribuyan sin dudas legales.
* **Opción B — Recomendada si quieres proteger el proyecto contra clones cerrados: `GPL v3`**
  * Si te preocupa que alguien copie tu extensión, le cambie el logo, le meta anuncios o suscripciones de pago en la Chrome Web Store y cierre el código, **GPL v3** es la mejor opción. Obliga legalmente a que cualquier versión derivada también sea open source y reconozca tu autoría.
* **Opción C — Equilibrio profesional: `MPL 2.0`**
  * Muy respetada en el ecosistema de extensiones (es la licencia oficial de Firefox). Protege las mejoras a tus archivos clave sin ser tan restrictiva como la GPL.

**Recomendación final:** Para arrancar con máxima tracción comunitaria y facilidad de contribución, **MIT** es la opción más ágil; si priorizas la filosofía estricta de software libre y evitar clones propietarios en las tiendas de navegadores, elige **GPL v3**.