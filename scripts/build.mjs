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

// 4. Copy target manifest and icons
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
