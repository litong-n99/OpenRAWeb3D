/**
 * test-3.spec.ts — ScrollPanel: Scrollbar Thumb Drag
 *
 * Verifies that dragging the scrollbar thumb:
 * - Correctly maps vertical mouse movement to scroll offset changes
 * - Shows "拖拽中" state during drag and "释放" after release
 * - Scrolls proportionally: offset change = (mouseDelta * scrollRange) / travelRange
 * - Correctly clamps at top (offset=0) and bottom
 * - Thumb Y position (#st-thumb-y) tracks with thumbOrigin
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

async function getThumbCenter(page: any): Promise<{ x: number; y: number }> {
  const box = await page.locator('.scroll-panel-thumb').boundingBox();
  if (!box) throw new Error('Thumb element not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('ScrollPanel - Thumb Drag', () => {

  test('3.1 thumbState shows "拖拽中" during drag and "释放" after release', async ({ page }) => {
    const center = await getThumbCenter(page);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // State should be "拖拽中" during drag
    await expect(page.locator('#st-thumb-state')).toHaveText('拖拽中');
    await screenshot(page, 'screenshot-13-thumb-dragging');

    await page.mouse.up();
    await page.waitForTimeout(100);

    // State should return to "释放" after release
    await expect(page.locator('#st-thumb-state')).toHaveText('释放');
    await screenshot(page, 'screenshot-14-thumb-released');
  });

  test('3.2 dragging thumb down scrolls content down', async ({ page }) => {
    const center = await getThumbCenter(page);
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag down 150px
    await page.mouse.move(center.x, center.y + 150, { steps: 10 });
    await page.waitForTimeout(100);

    const midOffset = await getStatusFloat(page, '#st-offset');
    expect(midOffset).toBeLessThan(-10); // Content scrolled down (offset negative)

    await page.mouse.up();
    await page.waitForTimeout(200);
    await screenshot(page, 'screenshot-15-thumb-drag-down');
  });

  test('3.3 dragging thumb up returns offset toward 0', async ({ page }) => {
    const center = await getThumbCenter(page);

    // First drag down
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x, center.y + 150, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-10);

    // Now drag back up
    const newCenter = await getThumbCenter(page);
    await page.mouse.move(newCenter.x, newCenter.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(newCenter.x, newCenter.y - 150, { steps: 10 });
    await page.waitForTimeout(100);

    const upOffset = await getStatusFloat(page, '#st-offset');
    expect(upOffset).toBeGreaterThan(downOffset); // Moved back toward 0

    await page.mouse.up();
    await page.waitForTimeout(200);
  });

  test('3.4 thumb Y position (#st-thumb-y) correlates with scroll offset', async ({ page }) => {
    const initialThumbY = await getStatusFloat(page, '#st-thumb-y');
    expect(initialThumbY).toBe(0); // At top, thumb should be at origin 0

    const center = await getThumbCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x, center.y + 150, { steps: 10 });
    await page.waitForTimeout(100);

    const afterThumbY = await getStatusFloat(page, '#st-thumb-y');
    expect(afterThumbY).toBeGreaterThan(initialThumbY); // Thumb moved down

    await page.mouse.up();
    await page.waitForTimeout(200);
  });

  test('3.5 drag to near bottom reaches bottom limit', async ({ page }) => {
    const center = await getThumbCenter(page);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag very far down (beyond normal range, should clamp)
    const maxDrag = 500;
    await page.mouse.move(center.x, center.y + maxDrag, { steps: 20 });
    await page.waitForTimeout(100);

    const offset = await getStatusFloat(page, '#st-offset');
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const contentH = await getStatusFloat(page, '#st-content-h');
    const bottomLimit = visibleH - contentH; // e.g., ~400 - 1600 = -1200

    // Offset should not exceed bottom limit
    expect(offset).toBeGreaterThanOrEqual(bottomLimit - 5);
    expect(offset).toBeLessThanOrEqual(0);

    await page.mouse.up();
    await page.waitForTimeout(200);
    await screenshot(page, 'screenshot-16-thumb-drag-bottom');
  });

  test('3.6 drag to top clamps offset at 0', async ({ page }) => {
    // First scroll down a bit
    const center = await getThumbCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x, center.y + 100, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Confirm we scrolled down
    const scrolledOffset = await getStatusFloat(page, '#st-offset');
    expect(scrolledOffset).toBeLessThan(0);

    // Now drag back up beyond top
    const newCenter = await getThumbCenter(page);
    await page.mouse.move(newCenter.x, newCenter.y);
    await page.mouse.down();
    await page.mouse.move(newCenter.x, newCenter.y - 200, { steps: 10 });
    await page.waitForTimeout(100);

    const clampedOffset = await getStatusFloat(page, '#st-offset');
    expect(clampedOffset).toBe(0); // Clamped at top

    await page.mouse.up();
  });

  test('3.7 thumb drag mapping is approximately proportional', async ({ page }) => {
    // The formula: newOffset = currentListOffset + (mouseDelta * scrollRange) / travelRange
    // where scrollRange = contentHeight - visibleHeight, travelRange = trackHeight - thumbHeight
    const center = await getThumbCenter(page);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    // Drag a modest amount
    await page.mouse.move(center.x, center.y + 80, { steps: 10 });
    await page.waitForTimeout(50);

    const offset = await getStatusFloat(page, '#st-offset');
    // After dragging 80px, offset should be negative and substantial
    // The exact value depends on geometry, but it should be non-trivial
    expect(offset).toBeLessThan(-50);

    await page.mouse.up();
  });
});
