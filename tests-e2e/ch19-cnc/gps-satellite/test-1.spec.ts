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

async function getDisplay(page: any, id: string): Promise<string> {
  return page.evaluate((selectorId: string) => {
    const el = document.getElementById(selectorId);
    return el ? getComputedStyle(el).display : '';
  }, id);
}

test('T1: Page load and initial state', async ({ page }) => {
  // All controls should be visible on the page.
  await expect(page.locator('#btn-launch')).toBeVisible();
  await expect(page.locator('#btn-reset')).toBeVisible();
  await expect(page.locator('#rng-delay')).toBeVisible();
  await expect(page.locator('#lbl-delay')).toBeVisible();
  await expect(page.locator('#sel-speed')).toBeVisible();
  await expect(page.locator('#renderCanvas')).toBeVisible();

  // Status panel initial values (E1).
  expect(await getText(page, 'st-ticks')).toBe('0');
  expect(await getText(page, 'st-posz')).toBe('0');
  expect(await getText(page, 'st-orbit')).toBe('false');
  expect(await getText(page, 'st-delay')).toBe('60');
  expect(await getText(page, 'st-speed')).toBe('427');

  // GPS activation message should remain hidden until orbit is reached.
  expect(await getDisplay(page, 'st-gps')).toBe('none');

  // Info bar should be populated with non-empty text.
  for (const id of ['info-ua', 'info-viewport', 'info-engine', 'info-fps', 'info-time', 'info-tickrate']) {
    const text = await getText(page, id);
    expect(text.length, `${id} should be populated`).toBeGreaterThan(0);
  }

  await screenshot(page, 'test-1-initial-state');
});
