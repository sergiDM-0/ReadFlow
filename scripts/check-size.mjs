import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const MAX_BYTES = 200 * 1024; // 200 KB hard ceiling from specification

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
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const kb = (total / 1024).toFixed(2);
  console.log(`\n[${target}] Total unpacked size: ${kb} KB (${total} bytes / limit ${MAX_BYTES} bytes)`);
  for (const f of files.sort((a, b) => b.size - a.size)) {
    console.log(`  - ${path.relative(dir, f.path)}: ${(f.size / 1024).toFixed(2)} KB`);
  }
  if (total >= MAX_BYTES) {
    console.error(`FAIL: ${target} bundle (${kb} KB) exceeds 200 KB limit.`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('\nPASS: All extension targets are within the 200 KB budget.');
