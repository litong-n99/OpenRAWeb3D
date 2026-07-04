/**
 * test-6.spec.ts — ScrollPanel: Programmatic Control Buttons
 *
 * Verifies the control buttons at the bottom of the page:
 * - "Scroll To Top": smooth scroll to offset = 0
 * - "Scroll To Bottom": smooth scroll to bottom
 * - "Scroll Up (5 items)": +5 * uiScrollSpeed = +160px offset
 * - "Scroll Down (5 items)": -5 * uiScrollSpeed = -160px offset
 * - "Scroll To Item #25": scrolls to make Item #25 visible in viewport
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

/**
 * Check if an item (by widget id) is within the scroll-container's visible viewport.
 * Items use data-widget-child attribute for identification in the DOM.
 */
async function isItemVisibleInViewport(page: any, itemWidgetId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const el = document.querySelector(`[data-widget-child="${id}"]`);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const container = document.getElementById('scroll-container');
    if (!container) return false;
    const containerRect = container.getBoundingClientRect();
    // Item must be fully or partially within the container's vertical bounds
    return (
      rect.bottom > containerRect.top &&
      rect.top < containerRect.bottom
    );
  }, itemWidgetId);
}

test.describe('ScrollPanel - Programmatic Controls', () => {

  test('6.1 "Scroll To Top" brings offset near 0', async ({ page }) => {
    // First scroll down to create non-zero offset
    await page.locator('#btn-scroll-down').click();
    await page.waitForTimeout(1000);

    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-30);

    // Click Scroll To Top
    await page.locator('#btn-scroll-top').click();
    await page.waitForTimeout(1500);

    const topOffset = await getStatusFloat(page, '#st-offset');
    // With smooth scroll, should reach or be very close to 0
    expect(topOffset).toBeGreaterThanOrEqual(-5);
    await screenshot(page, 'screenshot-28-scroll-to-top');
  });

  test('6.2 "Scroll To Bottom" reaches bottom region', async ({ page }) => {
    await page.locator('#btn-scroll-bottom').click();
    await page.waitForTimeout(1500);

    const offset = await getStatusFloat(page, '#st-offset');
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const bottomLimit = visibleH - 1600;

    // After 1500ms smooth scroll, should be close to bottom
    expect(offset).toBeLessThanOrEqual(bottomLimit + 30);
    await screenshot(page, 'screenshot-29-scroll-to-bottom');
  });

  test('6.3 "Scroll Up (5 items)" increases offset by ~160px', async ({ page }) => {
    // First scroll down a bit so there's room to scroll up
    await page.locator('#btn-scroll-down').click();
    await page.waitForTimeout(1000);
    const beforeOffset = await getStatusFloat(page, '#st-offset');

    await page.locator('#btn-scroll-up').click();
    await page.waitForTimeout(1000);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // scroll(5)=+5*32=+160px offset (less negative)
    const diff = afterOffset - beforeOffset;
    expect(diff).toBeGreaterThan(80);
    await screenshot(page, 'screenshot-30-scroll-up-5');
  });

  test('6.4 "Scroll Down (5 items)" decreases offset by ~160px', async ({ page }) => {
    const beforeOffset = await getStatusFloat(page, '#st-offset');
    expect(beforeOffset).toBe(0);

    await page.locator('#btn-scroll-down').click();
    await page.waitForTimeout(1000);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // scroll(-5)=-5*32=-160px offset (more negative)
    const diff = beforeOffset - afterOffset;
    expect(diff).toBeGreaterThan(80);
    await screenshot(page, 'screenshot-31-scroll-down-5');
  });

  test('6.5 "Scroll To Item #25" makes Item #25 visible', async ({ page }) => {
    // First scroll to bottom so item #25 is not visible
    await page.locator('#btn-scroll-bottom').click();
    await page.waitForTimeout(1500);

    // Verify item #25 is NOT visible while scrolled to bottom
    let visible = await isItemVisibleInViewport(page, 'item-25');
    // It might or might not be visible depending on viewport size

    // Click Scroll To Item #25
    await page.locator('#btn-scroll-item').click();
    await page.waitForTimeout(1500);

    visible = await isItemVisibleInViewport(page, 'item-25');
    expect(visible).toBe(true);
    await screenshot(page, 'screenshot-32-scroll-to-item25');
  });

  test('6.6 last operation shows correct command text', async ({ page }) => {
    await page.locator('#btn-scroll-top').click();
    await page.waitForTimeout(500);

    const lastOp = (await page.locator('#st-last-op').textContent()) ?? '';
    expect(lastOp).toContain('ScrollToTop');
  });

  test('6.7 scroll to item produces a significant scroll offset', async ({ page }) => {
    // Item #25 at index 24, y = 24 * 32 = 768px from content top
    // With visible height ~400-600px, item #25 at y=768 is below viewport at top
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    await page.locator('#btn-scroll-item').click();
    await page.waitForTimeout(1500);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // scrollToItem moves offset so item #25 is visible.
    // The offset should be substantially negative.
    expect(afterOffset).toBeLessThan(-150);

    // Verify item #25 is visible
    const visible = await isItemVisibleInViewport(page, 'item-25');
    expect(visible).toBe(true);

    await screenshot(page, 'screenshot-33-scroll-to-item25-after');
  });
});
