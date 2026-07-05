import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.PLAYWRIGHT_OUTPUT_DIR || './test-results/manual/ch19-cnc/gps-satellite';
const EVIDENCE_DIR = path.resolve(BASE, 'evidence');
const TEST_URL = '/test/ch19-cnc/gps-satellite/';

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TEST_URL);
  await page.waitForSelector('#renderCanvas');
  await page.waitForTimeout(500);
});

async function screenshot(page: any, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function getNum(page: any, id: string): Promise<number> {
  const text = await page.evaluate((selectorId: string) => {
    const el = document.getElementById(selectorId);
    return el ? el.textContent?.trim() ?? '' : '';
  }, id);
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : NaN;
}

async function setRevealDelay(page: any, delayValue: number): Promise<void> {
  await page.evaluate((val: number) => {
    const input = document.getElementById('rng-delay') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )!.set!;
    nativeInputValueSetter.call(input, String(val));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, delayValue);
}

test('T5: Different revealDelay values', async ({ page }) => {
  await page.selectOption('#sel-speed', '10');

  // Case 1: revealDelay = 30 => orbit at tick 31, Z ≈ 31 * 427 = 13237.
  await setRevealDelay(page, 30);
  await page.click('#btn-reset');
  await page.waitForTimeout(200);
  await page.click('#btn-launch');

  await page.waitForFunction(() => {
    const el = document.getElementById('st-orbit');
    return el && el.textContent === 'true';
  }, { timeout: 15000 });

  const z30 = await getNum(page, 'st-posz');
  expect(z30, 'delay=30 orbit height should be ~13237').toBeGreaterThanOrEqual(13237 - 500);
  expect(z30, 'delay=30 orbit height should be ~13237').toBeLessThanOrEqual(13237 + 500);

  await screenshot(page, 'test-5-delay-30');

  // Case 2: revealDelay = 120 => orbit at tick 121, Z ≈ 121 * 427 = 51667.
  await setRevealDelay(page, 120);
  await page.click('#btn-reset');
  await page.waitForTimeout(200);
  await page.click('#btn-launch');

  await page.waitForFunction(() => {
    const el = document.getElementById('st-orbit');
    return el && el.textContent === 'true';
  }, { timeout: 15000 });

  const z120 = await getNum(page, 'st-posz');
  expect(z120, 'delay=120 orbit height should be ~51667').toBeGreaterThanOrEqual(51667 - 500);
  expect(z120, 'delay=120 orbit height should be ~51667').toBeLessThanOrEqual(51667 + 500);

  await screenshot(page, 'test-5-delay-120');
});
