/**
 * test-4.spec.ts — ScrollPanel: Arrow Button Scrolling
 *
 * Verifies that the up/down arrow buttons on the scrollbar:
 * - Click/hold down-arrow: scrolls down (offset becomes negative)
 * - Click/hold up-arrow: scrolls up (offset approaches 0)
 * - Up button disables ("禁用") when at top (offset >= 0)
 * - Down button disables ("禁用") when at bottom
 *
 * NOTE: Arrow buttons work via the tick() loop. A single click()
 * sends mousedown+mouseup in the same event loop tick, so tick()
 * never fires while _upPressed/_downPressed is true. To trigger
 * scrolling, we must use mousedown → wait → mouseup to simulate
 * holding the button long enough for tick() to execute.
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
 * Click-and-hold an arrow button to allow tick() to fire.
 * Uses mousedown → wait → mouseup pattern.
 */
async function holdButton(page: any, locator: any, holdMs: number = 200) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Button element not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

test.describe('ScrollPanel - Arrow Buttons', () => {

  test('4.1 up-arrow button is disabled at top', async ({ page }) => {
    // Initially at top, up button should be disabled
    await expect(page.locator('#st-up-btn')).toHaveText('禁用');
    await expect(page.locator('#st-down-btn')).toHaveText('启用');
    await screenshot(page, 'screenshot-17-arrows-initial');
  });

  test('4.2 hold down-arrow scrolls content down', async ({ page }) => {
    const initialOffset = await getStatusFloat(page, '#st-offset');
    expect(initialOffset).toBe(0);

    // Hold down arrow for 300ms to allow tick() to fire multiple times
    await holdButton(page, page.locator('.scroll-panel-arrow-down'), 300);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // After holding for 300ms, tick should fire several times at ~16ms/frame
    // Each tick scrolls by uiScrollSpeed=32px, so ~18 frames * 32 ≈ 576px of accumulated scroll target
    expect(afterOffset).toBeLessThan(-30);
    await screenshot(page, 'screenshot-18-down-arrow-hold');
  });

  test('4.3 hold up-arrow scrolls content up', async ({ page }) => {
    // First scroll down by holding down arrow
    await holdButton(page, page.locator('.scroll-panel-arrow-down'), 300);

    const downOffset = await getStatusFloat(page, '#st-offset');
    expect(downOffset).toBeLessThan(-30);

    // Now hold up arrow
    await holdButton(page, page.locator('.scroll-panel-arrow-up'), 300);

    const upOffset = await getStatusFloat(page, '#st-offset');
    // Should be less negative (closer to 0) after holding up
    expect(upOffset).toBeGreaterThan(downOffset);
    await screenshot(page, 'screenshot-19-up-arrow-hold');
  });

  test('4.4 down-arrow disables when scrolled to bottom', async ({ page }) => {
    // Scroll to bottom via programmatic button
    await page.locator('#btn-scroll-bottom').click();
    await page.waitForTimeout(1500);

    const offset = await getStatusFloat(page, '#st-offset');
    const visibleH = await getStatusFloat(page, '#st-visible-h');
    const bottomLimit = visibleH - 1600;

    // Verify we're at or near bottom
    expect(offset).toBeLessThanOrEqual(bottomLimit + 10);

    // Down button should be disabled at bottom
    await expect(page.locator('#st-down-btn')).toHaveText('禁用');
    await expect(page.locator('#st-up-btn')).toHaveText('启用');
    await screenshot(page, 'screenshot-20-down-disabled');
  });

  test('4.5 up-arrow enables after scrolling away from top', async ({ page }) => {
    // Hold down arrow to scroll away from top
    await holdButton(page, page.locator('.scroll-panel-arrow-down'), 300);

    const afterOffset = await getStatusFloat(page, '#st-offset');
    // Verify we actually scrolled
    expect(afterOffset).toBeLessThan(-10);

    // Up button should now be enabled (was disabled at top)
    await expect(page.locator('#st-up-btn')).toHaveText('启用');
  });

  test('4.6 holding down-arrow longer scrolls more', async ({ page }) => {
    const offsetBefore = await getStatusFloat(page, '#st-offset');
    expect(offsetBefore).toBe(0);

    // Hold for longer to see more scrolling
    await holdButton(page, page.locator('.scroll-panel-arrow-down'), 500);

    const offsetAfter = await getStatusFloat(page, '#st-offset');
    // After holding 500ms (≈30 frames), should have scrolled significantly
    expect(offsetAfter).toBeLessThan(-300);
    await screenshot(page, 'screenshot-21-hold-down-arrow-long');
  });

  test('4.7 arrow buttons are within scrollbar', async ({ page }) => {
    const upArrow = page.locator('.scroll-panel-arrow-up');
    const downArrow = page.locator('.scroll-panel-arrow-down');

    await expect(upArrow).toBeVisible();
    await expect(downArrow).toBeVisible();

    // Arrow buttons should have content (▲ and ▼)
    await expect(upArrow).toHaveText(/▲/);
    await expect(downArrow).toHaveText(/▼/);
  });
});
