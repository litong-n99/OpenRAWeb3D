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

async function getText(page: any, id: string): Promise<string> {
  return page.evaluate((selectorId: string) => {
    const el = document.getElementById(selectorId);
    return el ? el.textContent?.trim() ?? '' : '';
  }, id);
}

async function getNum(page: any, id: string): Promise<number> {
  const text = await getText(page, id);
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

test('T7: Edge cases', async ({ page }) => {
  await page.selectOption('#sel-speed', '10');

  // 1. Re-launch after orbit: launch, reach orbit, then launch again.
  await page.click('#btn-launch');
  await page.waitForFunction(() => {
    const el = document.getElementById('st-orbit');
    return el && el.textContent === 'true';
  }, { timeout: 15000 });

  const orbitZ = await getNum(page, 'st-posz');
  expect(orbitZ).toBeGreaterThan(0);

  // Re-launch after orbit and read the state that was written synchronously by
  // the launch handler, before the render loop can advance the satellite again.
  const afterRelaunch = await page.evaluate(() => {
    document.getElementById('btn-launch')!.click();
    return {
      ticks: document.getElementById('st-ticks')!.textContent?.trim() ?? '',
      posz: document.getElementById('st-posz')!.textContent?.trim() ?? '',
      orbit: document.getElementById('st-orbit')!.textContent?.trim() ?? '',
    };
  });

  // A fresh launch should reset the satellite to the launch point (E1, edge case).
  expect(afterRelaunch.ticks).toBe('0');
  expect(afterRelaunch.posz).toBe('0');
  expect(afterRelaunch.orbit).toBe('false');

  await screenshot(page, 'test-7-relaunch');

  // 2. Short delay: revealDelay = 10 => orbit at tick 11, Z ≈ 4697.
  await setRevealDelay(page, 10);
  await page.click('#btn-reset');
  await page.waitForTimeout(200);
  await page.click('#btn-launch');

  await page.waitForFunction(() => {
    const el = document.getElementById('st-orbit');
    return el && el.textContent === 'true';
  }, { timeout: 15000 });

  const ticks10 = await getNum(page, 'st-ticks');
  const z10 = await getNum(page, 'st-posz');

  expect(ticks10, 'short delay should reach orbit quickly').toBeLessThanOrEqual(15);
  expect(z10, 'delay=10 orbit height should be ~4697').toBeGreaterThanOrEqual(4697 - 500);
  expect(z10, 'delay=10 orbit height should be ~4697').toBeLessThanOrEqual(4697 + 500);

  await screenshot(page, 'test-7-short-delay');

  // 3. Post-orbit: wait 3+ seconds and confirm position does not change.
  const beforeZ = await getNum(page, 'st-posz');
  await page.waitForTimeout(3000);
  const afterZ = await getNum(page, 'st-posz');

  expect(afterZ, 'position should remain unchanged 3+ seconds after orbit').toBe(beforeZ);

  await screenshot(page, 'test-7-post-orbit-stationary');
});
