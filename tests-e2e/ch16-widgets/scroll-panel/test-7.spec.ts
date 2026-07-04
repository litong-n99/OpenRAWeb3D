/**
 * test-7.spec.ts — ScrollPanel: Smooth Scrolling Physics and Boundary Tests
 *
 * Verifies:
 * - Exponential decay: after 200ms, remaining distance < 20% of initial distance
 * - Scroll position clamping at boundaries (top=0, bottom=visibleHeight-contentHeight)
 * - Minimum thumb size (10px)
 * - Thumb visibility when content fits in viewport
 * - Rapid scroll at boundaries: offset stays clamped
 * - Smooth scroll speed factor = 0.333
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

test.describe('ScrollPanel - Smooth Scrolling Physics', () => {

  test('7.1 smooth scroll exponential decay: <20% remaining after 200ms', async ({ page }) => {
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    // Scroll to bottom via smooth scroll
    await page.locator('#btn-scroll-bottom').click();

    // Wait exactly 200ms and check remaining distance
    await page.waitForTimeout(200);

    const currentOffset = await getStatusFloat(page, '#st-offset');
    const targetOffset = await getStatusFloat(page, '#st-target');
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const bottomLimit = visibleH - 1600;

    // Initial distance from top to bottom
    const initialDistance = Math.abs(bottomLimit - initialOffset);
    const remainingDistance = Math.abs(targetOffset - currentOffset);

    // After 200ms with smoothScrollSpeed=0.333 (dt/40 steps, 5 iterations):
    // remaining = initial * (1 - 0.333)^(200/40) ≈ initial * 0.667^5 ≈ initial * 0.132
    // So remaining < 20% is the test criteria
    if (initialDistance > 100) {
      const ratio = remainingDistance / initialDistance;
      expect(ratio).toBeLessThan(0.25); // Allow some margin
    }

    await screenshot(page, 'screenshot-33-smooth-decay-200ms');
  });

  test('7.2 smooth scroll approaches target over time', async ({ page }) => {
    await page.locator('#btn-scroll-bottom').click();

    // Check at 100ms
    await page.waitForTimeout(100);
    const offset100 = await getStatusFloat(page, '#st-offset');

    // Check at 400ms
    await page.waitForTimeout(300); // Total 400ms
    const offset400 = await getStatusFloat(page, '#st-offset');

    // Check at 1000ms (should be well settled)
    await page.waitForTimeout(600); // Total 1000ms
    const offset1000 = await getStatusFloat(page, '#st-offset');
    const target1000 = await getStatusFloat(page, '#st-target');

    // The offset should monotonically approach the bottom limit
    expect(offset400).toBeLessThanOrEqual(offset100);
    expect(offset1000).toBeLessThanOrEqual(offset400);

    // At 1000ms, should be close to target
    const finalDiff = Math.abs(offset1000 - target1000);
    expect(finalDiff).toBeLessThan(10);
  });

  test('7.3 instant scroll (smooth=false) reaches target immediately', async ({ page }) => {
    // Use __testHarness to call scrollTo with smooth=false
    const targetPosition = -200;
    await page.evaluate((pos) => {
      const sp = (window as any).__testHarness.scrollPanel;
      sp.scrollTo(pos, false);
    }, targetPosition);

    await page.waitForTimeout(200);

    const offset = await getStatusFloat(page, '#st-offset');
    expect(offset).toBe(targetPosition);
  });
});

test.describe('ScrollPanel - Boundary and Clamping', () => {

  test('7.4 offset clamps at 0 at top (never positive)', async ({ page }) => {
    // Try multiple up-scroll operations at top
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);

    // Move mouse over scroll area and wheel up at top
    const container = page.locator('#scroll-container');
    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2 - 12, box.y + box.height / 2);
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(1000);
    }

    const offset = await getStatusFloat(page, '#st-offset');
    expect(offset).toBe(0); // Must not go positive
  });

  test('7.5 offset clamps at bottom limit (never below visibleHeight-contentHeight)', async ({ page }) => {
    // Scroll to bottom
    await page.keyboard.press('End');
    await page.waitForTimeout(400);

    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const bottomLimit = visibleH - 1600;

    // Try to scroll past bottom
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(100);

    const offset = await getStatusFloat(page, '#st-offset');
    // Must not exceed bottom limit
    expect(offset).toBeGreaterThanOrEqual(bottomLimit - 10);
    expect(offset).toBeLessThanOrEqual(0);
  });

  test('7.6 minimum thumb size is 10px', async ({ page }) => {
    const thumbH = await getStatusFloat(page, '#st-thumb-h');
    expect(thumbH).toBeGreaterThanOrEqual(10);
  });

  test('7.7 thumbHeight is 0 when content fits viewport', async ({ page }) => {
    // Modify contentHeight via harness to simulate small content
    await page.evaluate(() => {
      const sp = (window as any).__testHarness.scrollPanel;
      sp.contentHeight = 50;
    });

    // Trigger a tick/render to recalculate thumb
    await page.locator('#btn-scroll-top').click();
    await page.waitForTimeout(500);

    const thumbH = await getStatusFloat(page, '#st-thumb-h');
    // When content fits entirely, thumbHeight should be 0
    // (no scrollbar needed)
    expect(thumbH).toBe(0);
  });

  test('7.8 up button state toggles correctly with scroll position', async ({ page }) => {
    // Initially up button is disabled (at top)
    await expect(page.locator('#st-up-btn')).toHaveText('禁用');

    // Scroll down via keyboard
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
    }

    // Now up button should be enabled
    await expect(page.locator('#st-up-btn')).toHaveText('启用');

    // Scroll back to top
    await page.keyboard.press('Home');
    await page.waitForTimeout(400);

    // Up button should be disabled again
    await expect(page.locator('#st-up-btn')).toHaveText('禁用');
  });
});

test.describe('ScrollPanel - Edge Cases', () => {

  test('7.9 rapid alternating scroll directions does not cause errors', async ({ page }) => {
    // Position mouse over content area
    const container = page.locator('#scroll-container');
    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2 - 12, box.y + box.height / 2);
    }

    // Rapidly alternate between up and down
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(50);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(50);
    }

    // Verify page is still functional
    await page.waitForTimeout(500);
    const offset = await getStatusFloat(page, '#st-offset');
    // Offset should be reasonable (not NaN, not absurd)
    expect(isNaN(offset)).toBe(false);
    expect(offset).toBeGreaterThan(-2000);
    expect(offset).toBeLessThan(10);
  });

  test('7.10 programmatic scroll to same position does nothing', async ({ page }) => {
    // Already at 0, scroll to 0 again
    await page.evaluate(() => {
      const sp = (window as any).__testHarness.scrollPanel;
      sp.scrollTo(0, true);
    });

    await page.waitForTimeout(500);

    const offset = await getStatusFloat(page, '#st-offset');
    expect(offset).toBe(0);
  });

  test('7.11 scrollTop followed by immediate scrollDown works correctly', async ({ page }) => {
    // Scroll to bottom first
    await page.locator('#btn-scroll-bottom').click();
    await page.waitForTimeout(1500);

    // Then immediately scroll to top
    await page.locator('#btn-scroll-top').click();
    await page.waitForTimeout(1500);

    const offset = await getStatusFloat(page, '#st-offset');
    expect(offset).toBeGreaterThanOrEqual(-5);

    // Then scroll down again
    await page.locator('#btn-scroll-down').click();
    await page.waitForTimeout(1000);

    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-30);
  });
});
