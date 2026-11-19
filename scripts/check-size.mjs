import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const MAX_CONTENT_UI_BYTES = 200 * 1024; // Content script + Popup UI must remain ultra-light (< 200 KB)

function walkFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else {
      const stat = fs.statSync(fullPath);
      results.push({ path: fullPath, size: stat.size });
    }
  }
  return results;
}

let failed = false;
for (const target of ['chrome', 'firefox']) {
  const dir = path.join(rootDir, 'dist', target);
  const files = walkFiles(dir);
  if (files.length === 0) {
    console.error(`Missing build output for ${target} (${dir})`);
    failed = true;
    continue;
  }

  let uiBytes = 0;
  let wasmBytes = 0;
  let totalBytes = 0;

  for (const f of files) {
    const rel = path.relative(dir, f.path);
    totalBytes += f.size;
    if (rel.startsWith('wasm' + path.sep) || rel === 'offscreen.js' || rel === 'background.js') {
      wasmBytes += f.size;
    } else {
      uiBytes += f.size;
    }
  }

  console.log(
    `\n[${target}] Injected UI + Popup: ${(uiBytes / 1024).toFixed(2)} KB (limit 200 KB) | Local Neural WASM Runtime: ${(wasmBytes / (1024 * 1024)).toFixed(2)} MB | Total: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
  );
  for (const f of files.sort((a, b) => b.size - a.size)) {
    const rel = path.relative(dir, f.path);
    const label =
      f.size >= 1024 * 1024
        ? `${(f.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(f.size / 1024).toFixed(2)} KB`;
    console.log(`  - ${rel}: ${label}`);
  }

  if (uiBytes >= MAX_CONTENT_UI_BYTES) {
    console.error(
      `FAIL: ${target} injected UI + popup (${(uiBytes / 1024).toFixed(2)} KB) exceeds 200 KB budget.`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  '\nPASS: Injected UI stays under 200 KB and local Piper WASM assets are bundled cleanly.'
);
