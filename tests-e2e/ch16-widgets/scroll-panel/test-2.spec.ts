/**
 * test-2.spec.ts — ScrollPanel: Mouse Wheel Scrolling
 *
 * Verifies that mouse wheel events correctly scroll the content:
 * - deltaY direction mapping (positive = scroll down = more negative offset)
 * - Smooth scrolling interpolation after wheel events
 * - Continuous offset changes (no jumps)
 * - Multiple rapid wheel events accumulate correctly
 *
 * IMPORTANT: page.mouse.wheel() fires at the current mouse position.
 * The mouse MUST be over the scroll panel content area for the wheel
 * event to bubble up to the ScrollPanelWidget's handler.
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

async function screenshot(page: any, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function getStatusFloat(page: any, selector: string): Promise<number> {
  const text = (await page.locator(selector).textContent()) ?? '0';
  return parseFloat(text.replace(/[^-\d.]/g, ''));
}

test.describe('ScrollPanel - Mouse Wheel Scrolling', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(TEST_URL);
    await page.waitForSelector('.scroll-panel-scrollbar');
    await page.waitForTimeout(200);
    // Position mouse over the center of the scroll panel content area
    const container = page.locator('#scroll-container');
    const box = await container.boundingBox();
    if (!box) throw new Error('Scroll container not found');
    // Move to center of content area (left half of container, avoiding scrollbar on right)
    await page.mouse.move(box.x + box.width / 2 - 12, box.y + box.height / 2);
  });

  test('2.1 wheel down (positive deltaY) scrolls content down', async ({ page }) => {
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    // Simulate one notch of mouse wheel down (deltaY ≈ 100)
    await page.mouse.wheel(0, 100);
    // Wait for smooth scroll to settle
    await page.waitForTimeout(800);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    expect(afterOffset).toBeLessThan(initialOffset);
    // With uiScrollSpeed=32, smoothScrollSpeed=0.333, after 800ms the offset
    // should be substantially negative (> 80% toward target)
    expect(afterOffset).toBeLessThan(-60);
    await screenshot(page, 'screenshot-8-wheel-down');
  });

  test('2.2 wheel up scrolls content back toward top', async ({ page }) => {
    // First scroll down
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(800);
    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-30);

    // Now scroll up
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(800);
    const upOffset = await getStatusFloat(page, '#st-offset');
    // Should have moved back toward 0
    expect(upOffset).toBeGreaterThan(downOffset);

    await screenshot(page, 'screenshot-9-wheel-up');
  });

  test('2.3 multiple wheel notches accumulate', async ({ page }) => {
    // 5 notches down
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1000);

    const offset5 = await getStatusFloat(page, '#st-offset');
    expect(offset5).toBeLessThan(-250);
    await screenshot(page, 'screenshot-10-multi-wheel');
  });

  test('2.4 smooth scroll interpolation is active (not instant jump)', async ({ page }) => {
    // Capture offset immediately after wheel and compare to settled value
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(50); // Only 50ms - smooth scroll should not be complete

    const earlyOffset = await getStatusFloat(page, '#st-offset');
    const earlyTarget = await getStatusFloat(page, '#st-target');

    // After only 50ms, offset and target should differ (smooth scrolling in progress)
    const offsetDiff = Math.abs(earlyOffset - earlyTarget);
    // If smooth scrolling is active, target differs from current
    // This confirms interpolation is happening (offset hasn't caught up)
    // Even if difference is small by 50ms, the target should be more extreme
    expect(offsetDiff).toBeGreaterThan(1.0);

    // Wait full settling time
    await page.waitForTimeout(800);
    const settledOffset = await getStatusFloat(page, '#st-offset');
    // The settled offset should be different from early offset (more scrolled)
    expect(settledOffset).toBeLessThanOrEqual(earlyOffset);

    await screenshot(page, 'screenshot-11-smooth-interpolation');
  });

  test('2.5 wheel scrolling respects boundary at top (offset never > 0)', async ({ page }) => {
    // At top already, scroll up should not make offset positive
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(800);

    const offset = await getStatusFloat(page, '#st-offset');
    expect(offset).toBe(0); // Clamped at top
  });

  test('2.6 last operation reflects wheel scroll direction', async ({ page }) => {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(500);

    const offset = await getStatusFloat(page, '#st-offset');
    // Verify offset changed (scroll happened)
    expect(offset).toBeLessThan(0);

    // The last operation text is set by the monitorState polling,
    // which compares lastOffset to currentOffset. A change of >0.5px
    // triggers "滚动 up/down"
    const lastOp = (await page.locator('#st-last-op').textContent()) ?? '';
    // If offset changed, lastOp should not be "-"
    expect(lastOp).not.toBe('-');

    await screenshot(page, 'screenshot-12-last-op-wheel');
  });
});
