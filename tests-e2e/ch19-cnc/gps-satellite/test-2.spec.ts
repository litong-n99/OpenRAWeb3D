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

test('T2: Launch and ascent', async ({ page }) => {
  await page.click('#btn-launch');

  // Wait long enough for ticks to accumulate at 1x speed.
  await page.waitForTimeout(600);

  const posZ = await getNum(page, 'st-posz');
  const ticks = await getNum(page, 'st-ticks');
  const orbit = await getText(page, 'st-orbit');

  // Satellite should have left the launch point (E2).
  expect(posZ, 'pos.Z should be increasing after launch').toBeGreaterThan(0);
  expect(ticks, 'tick counter should be greater than 0').toBeGreaterThan(0);

  // With default revealDelay=60, orbit should not be reached yet.
  expect(orbit).toBe('false');

  // Verify continued upward movement by sampling Z twice.
  const z1 = await getNum(page, 'st-posz');
  await page.waitForTimeout(300);
  const z2 = await getNum(page, 'st-posz');
  expect(z2, 'pos.Z should continue increasing during ascent').toBeGreaterThan(z1);

  await screenshot(page, 'test-2-during-ascent');
});
