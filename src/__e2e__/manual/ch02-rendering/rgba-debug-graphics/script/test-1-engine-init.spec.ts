/**
 * Playwright E2E Tests — RgbaColorRenderer Debug Graphics (Engine Init)
 *
 * Target: http://localhost:5173/test/ch02-rendering/rgba-debug-graphics/
 *
 * Validates:
 *   - Page loads and header is visible
 *   - Babylon.js / WebGL 2.0 engine initializes successfully
 *   - Canvas is created inside #sandbox
 *   - GPU error overlay remains hidden
 *   - Info bar shows populated values
 *   - Initial quad count > 0 (graphics rendered)
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/rgba-debug-graphics/';
const EVIDENCE_DIR = path.resolve(
  'test-results/manual/ch02-rendering/rgba-debug-graphics/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

test('engine initializes and renders debug graphics', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  // Wait for Babylon.js init + first render
  await page.waitForTimeout(1000);

  // 1. Header is visible
  await expect(page.locator('#header h1')).toBeVisible();
  const headerText = await page.locator('#header h1').textContent();
  expect(headerText).toContain('RGBA 颜色渲染器');

  // 2. GPU error overlay must be hidden
  await expect(page.locator('#gpu-error')).toBeHidden();

  // 3. Engine info contains Babylon.js and WebGL
  const engineInfo = await page.locator('#info-engine').textContent();
  expect(engineInfo).toMatch(/Babylon\.js.*WebGL\s*[12]/);

  // 4. Canvas created inside #sandbox
  const canvasCount = await page.locator('#sandbox canvas').count();
  expect(canvasCount).toBe(1);

  // 5. Canvas has WebGL context
  const hasWebGL = await page.evaluate(() => {
    const canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl !== null;
  });
  expect(hasWebGL, 'canvas must have a WebGL rendering context').toBe(true);

  // 6. Info bar values are populated
  const ua = await page.locator('#info-ua').textContent();
  expect(ua).not.toBe('-');
  expect(ua?.length).toBeGreaterThan(0);

  const viewport = await page.locator('#info-viewport').textContent();
  expect(viewport).toMatch(/\d+x\d+/);

  const fps = await page.locator('#info-fps').textContent();
  // FPS should eventually be a non-empty string after engine runs
  expect(fps).not.toBe('');
  expect(fps).not.toBe('-');

  // 7. Quad count > 0 means shapes were built and rendered
  const quadText = await page.locator('#state-quads').textContent();
  const quadCount = parseInt(quadText ?? '0', 10);
  expect(quadCount, 'quad count must be > 0, got: ' + quadCount).toBeGreaterThan(0);

  // 8. Evidence screenshot
  await page.screenshot({
    path: evidenceFile('screenshot-1-engine-init.png'),
    fullPage: true,
  });
});
