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

test('T3: Orbit achievement', async ({ page }) => {
  // Use 10x speed so orbit is reached quickly (~0.24 s real time).
  await page.selectOption('#sel-speed', '10');
  await page.click('#btn-launch');

  await page.waitForFunction(() => {
    const el = document.getElementById('st-orbit');
    return el && el.textContent === 'true';
  }, { timeout: 15000 });

  // GPS activation message should now be visible (E3).
  expect(await getDisplay(page, 'st-gps')).not.toBe('none');
  expect(await getText(page, 'st-gps')).toContain('GPS');

  // Orbit height should be approximately 61 * 427 = 26047 WDist.
  const posZ = await getNum(page, 'st-posz');
  expect(posZ, 'orbit height should be ~26047 WDist').toBeGreaterThanOrEqual(26047 - 500);
  expect(posZ, 'orbit height should be ~26047 WDist').toBeLessThanOrEqual(26047 + 500);

  await screenshot(page, 'test-3-orbit-achieved');
});
