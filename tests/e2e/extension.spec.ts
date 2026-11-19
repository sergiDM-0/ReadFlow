import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';

const EXTENSION_PATH = path.resolve(process.cwd(), 'dist/chrome');
const FIXTURE_PATH = path.resolve(process.cwd(), 'tests/e2e/fixtures/test-page.html');

test.describe('EchoSelect TTS Chrome Extension E2E', () => {
  let server: http.Server;
  let baseUrl: string;
  let context: BrowserContext;

  test.beforeAll(async () => {
    const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind local fixture server');
    }
    baseUrl = `http://127.0.0.1:${addr.port}/`;

    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  test('selecting text shows floating button in Shadow DOM and opens mini-player', async () => {
    const page = await context.newPage();

    // Provide deterministic speechSynthesis mock for headless/CI environments lacking OS voices
    await page.addInitScript(() => {
      const spoken: string[] = [];
      (window as unknown as { __spoken: string[] }).__spoken = spoken;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speaking: false,
          paused: false,
          getVoices: () => [
            {
              voiceURI: 'mock-es',
              name: 'Mock ES',
              lang: 'es-ES',
              localService: true,
              default: true,
            },
          ],
          speak(u: SpeechSynthesisUtterance) {
            spoken.push(u.text);
          },
          pause() {},
          resume() {},
          cancel() {},
          addEventListener() {},
          removeEventListener() {},
        },
      });
    });

    await page.goto(baseUrl);
    const paragraph = page.locator('#sample-paragraph');
    const box = await paragraph.boundingBox();
    expect(box).not.toBeNull();

    // Drag across paragraph to select text
    await page.mouse.move(box!.x + 4, box!.y + 6);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height - 4, { steps: 5 });
    await page.mouse.up();

    // Playwright pierces open Shadow DOM automatically
    const triggerBtn = page.locator('button[data-es-role="floating-trigger"]');
    await expect(triggerBtn).toBeVisible();

    await triggerBtn.click();

    const playerRegion = page.locator('[role="region"][aria-label="EchoSelect TTS player"]');
    await expect(playerRegion).toBeVisible();

    await page.locator('[data-es-action="stop"]').click();
    await expect(playerRegion).toBeHidden();
  });
});
