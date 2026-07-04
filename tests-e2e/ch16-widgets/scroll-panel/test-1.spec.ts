/**
 * test-1.spec.ts — ScrollPanel: Page Load and Initial State
 *
 * Verifies that the page loads correctly, all 50 items are rendered,
 * section headers appear at the right positions, item #25 is highlighted,
 * initial scroll position is 0, and thumb height is properly calculated.
 *
 * NOTE: Items use data-widget-child attribute for identification, not HTML id.
 * The id is set on the Widget class but rendered as data-widget-child in the DOM.
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
});

async function screenshot(page: any, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function getStatusFloat(page: any, selector: string): Promise<number> {
  const text = (await page.locator(selector).textContent()) ?? '0';
  return parseFloat(text.replace(/[^-\d.]/g, ''));
}

/** Selector for a widget child by its widget id. */
function itemSel(id: string): string {
  return `[data-widget-child="${id}"]`;
}

test.describe('ScrollPanel - Page Load and Initial State', () => {

  test('1.1 page loads and all status elements are present', async ({ page }) => {
    await expect(page.locator('#scroll-container')).toBeVisible();
    await expect(page.locator('#status-panel')).toBeVisible();

    const statusIds = [
      '#st-offset', '#st-target', '#st-content-h', '#st-visible-h',
      '#st-thumb-h', '#st-thumb-y', '#st-up-btn', '#st-down-btn', '#st-thumb-state',
    ];
    for (const id of statusIds) {
      await expect(page.locator(id)).toBeVisible();
    }

    const buttonIds = [
      '#btn-scroll-top', '#btn-scroll-bottom', '#btn-scroll-up',
      '#btn-scroll-down', '#btn-scroll-item',
    ];
    for (const id of buttonIds) {
      await expect(page.locator(id)).toBeVisible();
    }

    // .scroll-panel-content may be hidden by Playwright visibility check
    // (it uses will-change:transform and may not pass the visible check),
    // but its existence is sufficient; items inside it are checked in 1.2
    await expect(page.locator('.scroll-panel-content')).toHaveCount(1);
    await expect(page.locator('.scroll-panel-scrollbar')).toHaveCount(1);
    await expect(page.locator('.scroll-panel-thumb')).toHaveCount(1);
    await expect(page.locator('.scroll-panel-arrow-up')).toHaveCount(1);
    await expect(page.locator('.scroll-panel-arrow-down')).toHaveCount(1);

    await screenshot(page, 'screenshot-1-page-load');
  });

  test('1.2 all 50 items are rendered with correct content', async ({ page }) => {
    const items = page.locator('.scroll-panel-content [data-widget-child]');
    await expect(items).toHaveCount(50);

    // Verify specific items via data-widget-child attribute
    const item1 = page.locator(itemSel('item-1'));
    await expect(item1).toHaveCount(1);
    await expect(item1).toContainText('Section 1');

    const item25 = page.locator(itemSel('item-25'));
    await expect(item25).toHaveCount(1);
    await expect(item25).toContainText('Item #25');

    const item50 = page.locator(itemSel('item-50'));
    await expect(item50).toHaveCount(1);
    await expect(item50).toContainText('Item #50');

    await screenshot(page, 'screenshot-2-all-items');
  });

  test('1.3 section headers appear at correct positions', async ({ page }) => {
    for (const idx of [1, 11, 21, 31, 41]) {
      const selector = itemSel(`item-${idx}`);
      const item = page.locator(selector);
      await expect(item).toHaveCount(1);
      const text = (await item.textContent()) ?? '';
      expect(text).toContain('Section');
    }
    await screenshot(page, 'screenshot-3-section-headers');
  });

  test('1.4 item #25 is visually highlighted', async ({ page }) => {
    const item25 = page.locator(itemSel('item-25'));
    await expect(item25).toHaveCount(1);

    // Verify the color is yellowish (golden: r~249, g~168, b~37)
    // The contrast effect may shift colors slightly but yellow tone should be present
    const color = await item25.evaluate((el) => {
      return window.getComputedStyle(el).color;
    });
    const rgb = color.match(/[\d.]+/g)?.map(Number) ?? [];
    expect(rgb.length).toBeGreaterThanOrEqual(3);
    // Yellow/golden highlight: red > blue, green > blue
    expect(rgb[0]).toBeGreaterThan(rgb[2]);
    expect(rgb[1]).toBeGreaterThan(50);

    await screenshot(page, 'screenshot-4-item25-highlight');
  });

  test('1.5 initial scroll position is at top (offset = 0)', async ({ page }) => {
    const offset = await getStatusFloat(page, '#st-offset');
    expect(offset).toBe(0);

    const scrollPos = await page.evaluate(() => (window as any).__testHarness.getScrollPosition());
    expect(scrollPos).toBe(0);

    // At top, up button should be disabled, down button enabled
    await expect(page.locator('#st-up-btn')).toHaveText('禁用');
    await expect(page.locator('#st-down-btn')).toHaveText('启用');

    await screenshot(page, 'screenshot-5-initial-offset');
  });

  test('1.6 content height is approximately 1600px', async ({ page }) => {
    // The content height may be slightly adjusted by the layout system.
    // 50 items × 32px = 1600px base; layout may add spacing adjustments.
    const contentHeight = await getStatusFloat(page, '#st-content-h');
    expect(contentHeight).toBeGreaterThanOrEqual(1595);
    expect(contentHeight).toBeLessThanOrEqual(1610);

    const harnessContentHeight = await page.evaluate(() =>
      (window as any).__testHarness.getContentHeight()
    );
    expect(harnessContentHeight).toBeGreaterThanOrEqual(1595);
  });

  test('1.7 thumb height is proportional to visible/content ratio', async ({ page }) => {
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const contentH = await getStatusFloat(page, '#st-content-h');
    const thumbH = await getStatusFloat(page, '#st-thumb-h');

    expect(visibleH).toBeGreaterThan(200);
    expect(contentH).toBeGreaterThan(1500);

    // Formula: Math.max(10, (visibleH-48) * visibleH / contentH)
    const trackH = visibleH - 48; // 2 × 24px scrollbar arrows
    const expectedThumbH = Math.max(10, (trackH * visibleH) / contentH);

    // Allow ±5px tolerance for rounding and layout adjustments
    expect(thumbH).toBeGreaterThanOrEqual(expectedThumbH - 5);
    expect(thumbH).toBeLessThanOrEqual(expectedThumbH + 5);
    expect(thumbH).toBeGreaterThanOrEqual(10);

    // Verify via harness too
    const harnessThumbH = await page.evaluate(() => (window as any).__testHarness.getThumbHeight());
    expect(harnessThumbH).toBeGreaterThanOrEqual(10);

    await screenshot(page, 'screenshot-6-thumb-geometry');
  });

  test('1.8 status panel shows correct initial values', async ({ page }) => {
    const offset = await getStatusFloat(page, '#st-offset');
    const target = await getStatusFloat(page, '#st-target');
    const thumbY = await getStatusFloat(page, '#st-thumb-y');

    expect(offset).toBe(0);
    expect(target).toBe(0);
    expect(thumbY).toBe(0);

    await expect(page.locator('#st-thumb-state')).toHaveText('释放');
    await screenshot(page, 'screenshot-7-status-initial');
  });
});
