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

async function getDisplay(page: any, id: string): Promise<string> {
  return page.evaluate((selectorId: string) => {
    const el = document.getElementById(selectorId);
    return el ? getComputedStyle(el).display : '';
  }, id);
}

test('T6: Reset functionality', async ({ page }) => {
  await page.click('#btn-launch');
  await page.waitForTimeout(800);

  const launchedZ = await getNum(page, 'st-posz');
  const launchedTicks = await getNum(page, 'st-ticks');

  expect(launchedZ, 'satellite should have ascended before reset').toBeGreaterThan(0);
  expect(launchedTicks, 'ticks should have accumulated before reset').toBeGreaterThan(0);

  await page.click('#btn-reset');
  await page.waitForTimeout(300);

  // Reset should clear all state back to the initial values (edge case).
  expect(await getText(page, 'st-ticks')).toBe('0');
  expect(await getText(page, 'st-posz')).toBe('0');
  expect(await getText(page, 'st-orbit')).toBe('false');
  expect(await getDisplay(page, 'st-gps')).toBe('none');

  await screenshot(page, 'test-6-after-reset');
});
