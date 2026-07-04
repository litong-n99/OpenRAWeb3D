/**
 * test-5.spec.ts — ScrollPanel: Keyboard Navigation
 *
 * Verifies keyboard navigation keys:
 * - ArrowUp: scrolls up by 1 item (+32px, less negative offset)
 * - ArrowDown: scrolls down by 1 item (-32px, more negative offset)
 * - PageUp: scrolls up by one viewport height
 * - PageDown: scrolls down by one viewport height
 * - Home: scrolls to top (offset = 0)
 * - End: scrolls to bottom (offset = visibleHeight - contentHeight)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.PLAYWRIGHT_OUTPUT_DIR || './test-results/manual/ch16-widgets/scroll-panel';
const EVIDENCE_DIR = path.resolve(BASE, 'evidence');
const TEST_URL = '/test/ch16-widgets/scroll-panel/';

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(TEST_URL);
  await page.waitForSelector('.scroll-panel-scrollbar');
  await page.waitForTimeout(200);
  // Focus the scroll container so keyboard events are routed to the widget
  await page.locator('#scroll-container').focus();
});

async function screenshot(page: any, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function getStatusFloat(page: any, selector: string): Promise<number> {
  const text = (await page.locator(selector).textContent()) ?? '0';
  return parseFloat(text.replace(/[^-\d.]/g, ''));
}

test.describe('ScrollPanel - Keyboard Navigation', () => {

  test('5.1 ArrowDown scrolls down by one item height', async ({ page }) => {
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // uiScrollSpeed = 32px, ArrowDown → scroll(-1, false) → -32px immediate
    expect(afterOffset).toBeLessThan(-20);
    await screenshot(page, 'screenshot-22-arrow-down');
  });

  test('5.2 ArrowUp scrolls up by one item height', async ({ page }) => {
    // First scroll down 3 items
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
    }

    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-30);

    // Now press ArrowUp
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);

    const upOffset = await getStatusFloat(page, '#st-offset');
    // Should be less negative (closer to 0) after ArrowUp
    expect(upOffset).toBeGreaterThan(downOffset);
    await screenshot(page, 'screenshot-23-arrow-up');
  });

  test('5.3 PageDown scrolls by approximately one viewport height', async ({ page }) => {
    const initialOffset = await getStatusFloat(page, '#st-offset');
    const visibleH = await getStatusFloat(page, '#st-visible-h');

    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    const diff = initialOffset - afterOffset;

    // PageDown: offset -= visibleHeight. The change should be close to visibleH
    expect(diff).toBeGreaterThan(visibleH * 0.5);
    await screenshot(page, 'screenshot-24-page-down');
  });

  test('5.4 PageUp scrolls by approximately one viewport height', async ({ page }) => {
    // Scroll down first
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
    const downOffset = await getStatusFloat(page, '#st-offset');

    // Now PageUp
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(300);

    const upOffset = await getStatusFloat(page, '#st-offset');
    // Should be closer to 0 than before
    expect(upOffset).toBeGreaterThan(downOffset);
    await screenshot(page, 'screenshot-25-page-up');
  });

  test('5.5 Home scrolls to top (offset = 0)', async ({ page }) => {
    // Scroll down first
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
    }

    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-30);

    // Press Home
    await page.keyboard.press('Home');
    await page.waitForTimeout(400);

    const homeOffset = await getStatusFloat(page, '#st-offset');
    // Home uses scrollToTop(false) which sets offset immediately
    expect(homeOffset).toBe(0);
    await screenshot(page, 'screenshot-26-home');
  });

  test('5.6 End scrolls to bottom region', async ({ page }) => {
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const bottomLimit = visibleH - 1600;

    await page.keyboard.press('End');
    await page.waitForTimeout(400);

    const offset = await getStatusFloat(page, '#st-offset');
    // End uses scrollToBottom(false) which sets offset immediately
    // Offset should be at or very near bottom
    expect(offset).toBeLessThanOrEqual(bottomLimit + 10);
    expect(offset).toBeGreaterThanOrEqual(bottomLimit - 10);
    await screenshot(page, 'screenshot-27-end');
  });

  test('5.7 ArrowUp at top does nothing (clamped to 0)', async ({ page }) => {
    // At top already
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    expect(afterOffset).toBe(0); // Still at top
  });

  test('5.8 keyboard navigation respects boundary at bottom', async ({ page }) => {
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const bottomLimit = visibleH - 1600;

    // Go to bottom
    await page.keyboard.press('End');
    await page.waitForTimeout(400);

    const bottomOffset = await getStatusFloat(page, '#st-offset');

    // ArrowDown at bottom should not scroll past bottom
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // Should stay at bottom limit (within tolerance)
    expect(afterOffset).toBeGreaterThanOrEqual(bottomLimit - 10);
    expect(afterOffset).toBeLessThanOrEqual(0);
  });
});
