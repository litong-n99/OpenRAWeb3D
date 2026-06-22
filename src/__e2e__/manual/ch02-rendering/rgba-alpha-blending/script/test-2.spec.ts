/**
 * Playwright E2E Tests — RgbaColorRenderer Global Alpha Attenuation (Expect 2)
 *
 * Target: http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/
 *
 * Validates global alpha attenuation:
 *   - alpha=1.0: bars fully opaque, reference values reflect opaque blending
 *   - alpha=0.5: bars semi-transparent, reference values reflect 50% blending
 *   - alpha=0.0: bars fully invisible, reference values are rgba(0,0,0,0)
 *   - Slider value label updates in sync
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

async function setSliderValue(
  page: any,
  selector: string,
  value: string
): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLInputElement, val: string) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('global alpha attenuation is correct', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  const leftHex = await page.locator('#color-left').inputValue();
  const midHex = await page.locator('#color-mid').inputValue();
  const rightHex = await page.locator('#color-right').inputValue();

  const left = hexToRgba255(leftHex);
  const mid = hexToRgba255(midHex);
  const right = hexToRgba255(rightHex);

  // 1. alpha = 1.0 — fully opaque
  await setSliderValue(page, '#alpha-slider', '1.0');
  await page.waitForTimeout(200);
  await expect(page.locator('#alpha-val')).toHaveText('1.00');

  const refRgOpaque = parseRgba((await page.locator('#ref-rg').textContent()) ?? '');
  const refGbOpaque = parseRgba((await page.locator('#ref-gb').textContent()) ?? '');
  expect(refRgOpaque).toBeDefined();
  expect(refGbOpaque).toBeDefined();

  const expectedRgOpaque = expectedOverlap(left, mid, 1.0);
  const expectedGbOpaque = expectedOverlap(mid, right, 1.0);
  expect(refRgOpaque).toEqual(expectedRgOpaque);
  expect(refGbOpaque).toEqual(expectedGbOpaque);

  await page.screenshot({
    path: evidenceFile('screenshot-alpha-1.0.png'),
    fullPage: true,
  });

  // 2. alpha = 0.5 — semi-transparent blend
  await setSliderValue(page, '#alpha-slider', '0.5');
  await page.waitForTimeout(200);
  await expect(page.locator('#alpha-val')).toHaveText('0.50');

  const refRgHalf = parseRgba((await page.locator('#ref-rg').textContent()) ?? '');
  const refGbHalf = parseRgba((await page.locator('#ref-gb').textContent()) ?? '');
  expect(refRgHalf).toBeDefined();
  expect(refGbHalf).toBeDefined();

  const expectedRgHalf = expectedOverlap(left, mid, 0.5);
  const expectedGbHalf = expectedOverlap(mid, right, 0.5);
  expect(refRgHalf).toEqual(expectedRgHalf);
  expect(refGbHalf).toEqual(expectedGbHalf);

  await page.screenshot({
    path: evidenceFile('screenshot-alpha-0.5.png'),
    fullPage: true,
  });

  // 3. alpha = 0.0 — fully invisible visually, reference labels show the
  //    destination color because the blend formula weights the source at 0.
  await setSliderValue(page, '#alpha-slider', '0.0');
  await page.waitForTimeout(200);
  await expect(page.locator('#alpha-val')).toHaveText('0.00');

  const refRgZero = parseRgba((await page.locator('#ref-rg').textContent()) ?? '');
  const refGbZero = parseRgba((await page.locator('#ref-gb').textContent()) ?? '');
  expect(refRgZero).toBeDefined();
  expect(refGbZero).toBeDefined();

  const expectedRgZero = expectedOverlap(left, mid, 0.0);
  const expectedGbZero = expectedOverlap(mid, right, 0.0);
  expect(refRgZero).toEqual(expectedRgZero);
  expect(refGbZero).toEqual(expectedGbZero);

  await page.screenshot({
    path: evidenceFile('screenshot-alpha-0.0.png'),
    fullPage: true,
  });
});
