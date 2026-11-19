import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const target = process.argv[2] || 'chrome';

if (target !== 'chrome' && target !== 'firefox') {
  console.error(`Unsupported target "${target}". Expected "chrome" or "firefox".`);
  process.exit(1);
}

const outDir = path.join(rootDir, 'dist', target);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Build content script as a self-contained IIFE bundle (MV3 Chrome & Firefox compatible)
await build({
  configFile: false,
  root: rootDir,
  logLevel: 'warn',
  define: {
    __TARGET_BROWSER__: JSON.stringify(target),
  },
  resolve: {
    alias: {
      // Ensure onnxruntime-web uses the lightweight external-WASM build instead of base64-inlining 15MB WASM into JS
      'onnxruntime-web/wasm': path.resolve(
        rootDir,
        'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
      ),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2022',
    lib: {
      entry: path.resolve(rootDir, 'src/content/index.ts'),
      name: 'EchoSelectContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

// 2. Build background service worker / event script as ES module
await build({
  configFile: false,
  root: rootDir,
  logLevel: 'warn',
  define: {
    __TARGET_BROWSER__: JSON.stringify(target),
  },
  resolve: {
    alias: {
      // Ensure onnxruntime-web uses the lightweight external-WASM build instead of base64-inlining 15MB WASM into JS
      'onnxruntime-web/wasm': path.resolve(
        rootDir,
        'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
      ),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2022',
    lib: {
      entry: path.resolve(rootDir, 'src/background/service-worker.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

// 3. Build popup HTML + CSS + TS
await build({
  configFile: false,
  root: path.resolve(rootDir, 'src/popup'),
  base: './',
  logLevel: 'warn',
  define: {
    __TARGET_BROWSER__: JSON.stringify(target),
  },
  resolve: {
    alias: {
      // Ensure onnxruntime-web uses the lightweight external-WASM build instead of base64-inlining 15MB WASM into JS
      'onnxruntime-web/wasm': path.resolve(
        rootDir,
        'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
      ),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2022',
    rollupOptions: {
      input: path.resolve(rootDir, 'src/popup/popup.html'),
      output: {
        entryFileNames: 'popup.js',
        assetFileNames: 'popup[extname]',
      },
    },
  },
});

// 4. Build Chrome MV3 Offscreen Document (hosts ONNX/Piper WASM safely outside Service Worker)
if (target === 'chrome') {
  await build({
    configFile: false,
    root: path.resolve(rootDir, 'src/offscreen'),
    base: './',
    logLevel: 'warn',
    define: {
      __TARGET_BROWSER__: JSON.stringify(target),
    },
    resolve: {
      alias: {
        // Ensure onnxruntime-web uses the lightweight external-WASM build instead of base64-inlining 15MB WASM into JS
        'onnxruntime-web/wasm': path.resolve(
          rootDir,
          'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
        ),
      },
    },
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      minify: 'esbuild',
      target: 'es2022',
      rollupOptions: {
        input: path.resolve(rootDir, 'src/offscreen/offscreen.html'),
        output: {
          entryFileNames: 'offscreen.js',
        },
      },
    },
  });
}

// 5. Bundle local ONNX & Piper WASM runtime binaries (zero remote code execution in MV3)
const wasmDst = path.join(outDir, 'wasm');
fs.mkdirSync(wasmDst, { recursive: true });
const wasmAssets = [
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper_phonemize.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper_phonemize.data'],
];
for (const [srcRel, dstName] of wasmAssets) {
  const srcAbs = path.join(rootDir, srcRel);
  if (!fs.existsSync(srcAbs)) {
    throw new Error(`Missing required WASM runtime asset: ${srcRel}`);
  }
  fs.copyFileSync(srcAbs, path.join(wasmDst, dstName));
}

// 6. Copy target manifest and icons
const manifestSource = path.join(rootDir, `manifest.${target}.json`);
fs.copyFileSync(manifestSource, path.join(outDir, 'manifest.json'));

const iconsSrc = path.join(rootDir, 'public/icons');
const iconsDst = path.join(outDir, 'icons');
fs.mkdirSync(iconsDst, { recursive: true });
for (const file of fs.readdirSync(iconsSrc)) {
  if (file.endsWith('.png') || file.endsWith('.svg')) {
    fs.copyFileSync(path.join(iconsSrc, file), path.join(iconsDst, file));
  }
}

console.log(`Built EchoSelect TTS (${target}) -> ${path.relative(rootDir, outDir)}`);
