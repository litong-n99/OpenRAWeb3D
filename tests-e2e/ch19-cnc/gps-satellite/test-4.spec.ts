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

test('T4: Post-orbit immobility', async ({ page }) => {
  await page.selectOption('#sel-speed', '10');
  await page.click('#btn-launch');

  await page.waitForFunction(() => {
    const el = document.getElementById('st-orbit');
    return el && el.textContent === 'true';
  }, { timeout: 15000 });

  // Record the orbit position (E4).
  const orbitZ = await getNum(page, 'st-posz');
  expect(orbitZ).toBeGreaterThan(0);

  // Wait to confirm the satellite does not move after reaching orbit.
  await page.waitForTimeout(2000);
  const laterZ = await getNum(page, 'st-posz');

  expect(laterZ, 'pos.Z should not change after orbit').toBe(orbitZ);

  await screenshot(page, 'test-4-post-orbit-immobile');
});
