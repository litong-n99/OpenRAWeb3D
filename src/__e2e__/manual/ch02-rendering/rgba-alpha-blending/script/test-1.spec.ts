/**
 * Playwright E2E Tests — RgbaColorRenderer Alpha Blending (Expect 1)
 *
 * Target: http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/
 *
 * Validates that three semi-transparent overlapping bars are rendered:
 *   - Babylon.js / WebGL 2.0 engine initializes successfully
 *   - Canvas is created inside #sandbox
 *   - GPU error overlay remains hidden
 *   - Overlap reference values are computed (not placeholder '-')
 *   - Premultiplied alpha blend math matches the page's reference labels
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/';
const EVIDENCE_DIR = path.resolve(
  'test-results/manual/ch02-rendering/rgba-alpha-blending/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgba(text: string): Rgba | null {
  const m = text.match(/rgba\((\d+),(\d+),(\d+),(\d+)\)/);
  if (!m) return null;
  return {
    r: parseInt(m[1], 10),
    g: parseInt(m[2], 10),
    b: parseInt(m[3], 10),
    a: parseInt(m[4], 10),
  };
}

function hexToRgba255(hex: string): Rgba {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 255,
  };
}

function blendChannel(v1: number, v2: number, alpha: number): number {
  // Matches the page's blend(): C_out = C_src + C_dst * (1 - alpha_src)
  const pm1 = Math.round(v1 * alpha);
  const pm2 = Math.round(v2 * (1 - alpha));
  return Math.min(255, pm1 + pm2);
}

function expectedOverlap(c1: Rgba, c2: Rgba, alpha: number): Rgba {
  return {
    r: blendChannel(c1.r, c2.r, alpha),
    g: blendChannel(c1.g, c2.g, alpha),
    b: blendChannel(c1.b, c2.b, alpha),
    a: blendChannel(c1.a, c2.a, alpha),
  };
}

test('semi-transparent bars overlap and blend correctly', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // 1. Engine / WebGL initialization
  const engineInfo = await page.locator('#info-engine').textContent();
  expect(engineInfo).toMatch(/Babylon\.js.*WebGL\s*2/);
  await expect(page.locator('#gpu-error')).toBeHidden();

  // 2. Canvas created inside #sandbox
  const canvasCount = await page.locator('#sandbox canvas').count();
  expect(canvasCount).toBe(1);

  const hasWebGL = await page.evaluate(() => {
    const canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl !== null;
  });
  expect(hasWebGL, 'canvas must have a WebGL rendering context').toBe(true);

  // 3. Reference value elements exist and the two computed refs are populated
  await expect(page.locator('#ref-rg')).toBeVisible();
  await expect(page.locator('#ref-gb')).toBeVisible();
  await expect(page.locator('#ref-rgb')).toBeVisible();

  const refRgText = await page.locator('#ref-rg').textContent();
  const refGbText = await page.locator('#ref-gb').textContent();

  expect(refRgText).not.toBe('-');
  expect(refGbText).not.toBe('-');

  const refRg = parseRgba(refRgText ?? '');
  const refGb = parseRgba(refGbText ?? '');
  expect(refRg, 'ref-rg must be a valid rgba(...) string').toBeDefined();
  expect(refGb, 'ref-gb must be a valid rgba(...) string').toBeDefined();

  // 4. Verify premultiplied alpha blend math against current colors and alpha
  const leftHex = await page.locator('#color-left').inputValue();
  const midHex = await page.locator('#color-mid').inputValue();
  const rightHex = await page.locator('#color-right').inputValue();
  const alpha = parseFloat(await page.locator('#alpha-slider').inputValue());

  const left = hexToRgba255(leftHex);
  const mid = hexToRgba255(midHex);
  const right = hexToRgba255(rightHex);

  const expectedRg = expectedOverlap(left, mid, alpha);
  const expectedGb = expectedOverlap(mid, right, alpha);

  expect(refRg!.r).toBe(expectedRg.r);
  expect(refRg!.g).toBe(expectedRg.g);
  expect(refRg!.b).toBe(expectedRg.b);
  expect(refRg!.a).toBe(expectedRg.a);

  expect(refGb!.r).toBe(expectedGb.r);
  expect(refGb!.g).toBe(expectedGb.g);
  expect(refGb!.b).toBe(expectedGb.b);
  expect(refGb!.a).toBe(expectedGb.a);

  // 5. Evidence screenshot for visual review
  await page.screenshot({
    path: evidenceFile('screenshot-overlap-default-alpha.png'),
    fullPage: true,
  });
});
