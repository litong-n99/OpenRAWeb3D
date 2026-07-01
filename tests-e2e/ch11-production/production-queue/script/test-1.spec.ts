/**
 * test-1.spec.ts — Automated acceptance test for Chapter 11 Production Queue
 *
 * Test page: /test/ch11-production/production-queue/
 * Type: HTML + Babylon.js 3D production queue visual acceptance test
 *
 * Acceptance criteria covered:
 *   E1. Progress bar fills linearly and changes color at thresholds
 *   E2. Countdown timer shows remaining seconds and switches to READY
 *   E3. Ready item triggers factory pulse glow
 *   E4. Cancel triggers proportional refund (or no refund if already ready)
 *   E5. Cancel head-of-queue reorders and next item progresses
 *
 * Implementation notes:
 *   - All programmatic state is read through window.__testHarness.
 *   - Visual state (colors, labels) is asserted through DOM selectors.
 *   - Tests use setSimulationSpeed() to keep real elapsed time reasonable.
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TEST_URL = '/test/ch11-production/production-queue/';
const SCREENSHOT_DIR = 'test-results/manual/ch11-production/production-queue';

interface QueueItem {
  type: string;
  name: string;
  progressPct: number;
  remainingTime: number;
  isReady: boolean;
}

interface ProductionQueueHarness {
  enqueueItem(type: string): boolean;
  getQueueItems(): QueueItem[];
  getProgressPercent(): number;
  getTimeRemaining(): number;
  isReadyPulsing(): boolean;
  cancelItem(index: number): boolean;
  reset(): void;
  getSimulationSpeed(): number;
  setSimulationSpeed(speed: number): void;
  getCompletedCount(): number;
  getRefundedTotal(): number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

function screenshotPath(name: string): string {
  ensureScreenshotDir();
  return path.join(SCREENSHOT_DIR, `${name}.png`);
}

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness as Partial<ProductionQueueHarness>;
      return (
        !!h &&
        typeof h.enqueueItem === 'function' &&
        typeof h.getProgressPercent === 'function' &&
        typeof h.getQueueItems === 'function' &&
        typeof h.cancelItem === 'function'
      );
    },
    { timeout }
  );
}

async function resetQueue(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.reset());
}

async function setSpeed(page: Page, speed: number): Promise<void> {
  await page.evaluate((s) => (window as any).__testHarness.setSimulationSpeed(s), speed);
}

async function enqueue(page: Page, type: string): Promise<boolean> {
  return page.evaluate((t) => (window as any).__testHarness.enqueueItem(t), type);
}

async function getQueueItems(page: Page): Promise<QueueItem[]> {
  return page.evaluate(() => (window as any).__testHarness.getQueueItems());
}

async function getProgress(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getProgressPercent());
}

async function getRemaining(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getTimeRemaining());
}

async function isPulsing(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__testHarness.isReadyPulsing());
}

async function cancel(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => (window as any).__testHarness.cancelItem(i), index);
}

async function getRefundedTotal(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getRefundedTotal());
}

async function getCompletedCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getCompletedCount());
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return '';
  return (
    '#' +
    m
      .slice(0, 3)
      .map((v) => parseInt(v, 10).toString(16).padStart(2, '0'))
      .join('')
  );
}

async function getHeadBarFillColor(page: Page): Promise<string> {
  const rgb = await page.evaluate(() => {
    const el = document.querySelector('.q-item.q-head .q-bar-fill') as HTMLElement | null;
    if (!el) return '';
    return window.getComputedStyle(el).backgroundColor;
  });
  return rgbToHex(rgb);
}

async function waitForProgressInRange(
  page: Page,
  min: number,
  max: number,
  timeout = 15000
): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(80); // let rAF frames process
    const p = await getProgress(page);
    if (p >= min && p <= max) {
      return p;
    }
  }
  throw new Error(`waitForProgressInRange: timeout waiting for progress in [${min}, ${max}]`);
}

// waitForReady that returns if ANY item in queue is ready (not just head)
async function waitForAnyReady(page: Page, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(80);
    const items = await getQueueItems(page);
    if (items.some((i) => i.isReady)) return;
  }
  throw new Error('waitForAnyReady: timeout');
}

async function waitForReady(page: Page, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(80);
    const items = await getQueueItems(page);
    if (items.length > 0 && items[0].isReady) return;
  }
  throw new Error('waitForReady: timeout');
}

async function waitForCompletedCount(
  page: Page,
  count: number,
  timeout = 15000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100); // let rAF frames process
    const c = await getCompletedCount(page);
    if (c >= count) return;
  }
  throw new Error(`waitForCompletedCount: timeout waiting for count >= ${count}`);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Production Queue Acceptance Test (E1-E5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForHarness(page);
    // Give WebGL/Babylon one extra second to settle before interacting.
    await page.waitForTimeout(1000);
    ensureScreenshotDir();
  });

  // ================================================================
  // E1. Progress bar fills linearly
  // ================================================================

  test('E1 - Progress bar fills linearly and switches colors', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 2);

    expect(await enqueue(page, 'medTank')).toBe(true);
    // One frame may have elapsed between enqueue and progress check (≤2% at 2x speed)
    expect(await getProgress(page)).toBeLessThan(3);

    // E1.1 + E1.2: ~20% should be blue.
    const p20 = await waitForProgressInRange(page, 18, 29);
    expect(p20).toBeGreaterThanOrEqual(18);
    expect(p20).toBeLessThan(30);
    expect(await getHeadBarFillColor(page)).toBe('#3498db');
    await page.screenshot({ path: screenshotPath('E1-progress-20pct-blue') });

    // E1.1 + E1.2: ~50% should be yellow.
    const p50 = await waitForProgressInRange(page, 47, 55);
    expect(p50).toBeGreaterThanOrEqual(30);
    expect(p50).toBeLessThan(70);
    expect(await getHeadBarFillColor(page)).toBe('#f39c12');
    await page.screenshot({ path: screenshotPath('E1-progress-50pct-yellow') });

    // E1.1 + E1.2: ~80% should be green.
    const p80 = await waitForProgressInRange(page, 77, 85);
    expect(p80).toBeGreaterThanOrEqual(70);
    expect(p80).toBeLessThanOrEqual(100);
    expect(await getHeadBarFillColor(page)).toBe('#2ecc71');
    await page.screenshot({ path: screenshotPath('E1-progress-80pct-green') });

    // E1.3: the visual bar width matches the harness progress (≤2% drift).
    const barWidthPct = await page.evaluate(() => {
      const el = document.querySelector('.q-item.q-head .q-bar-fill') as HTMLElement | null;
      if (!el) return -1;
      return parseFloat(el.style.width || '0');
    });
    expect(barWidthPct).toBeGreaterThanOrEqual(p80 - 2);
    expect(barWidthPct).toBeLessThanOrEqual(p80 + 2);
  });

  // ================================================================
  // E2. Countdown timer
  // ================================================================

  test('E2 - Countdown timer is accurate and turns into READY', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 2);

    expect(await enqueue(page, 'infantry')).toBe(true);

    // E2.1: timer starts at the full build time.
    const timerLocator = page.locator('.q-item.q-head .q-timer');
    await expect(timerLocator).toHaveText('5.0s');

    // E2.2: timer is red. Query element directly to avoid DOM race with per-frame updateQueueUI().
    const timerColor = rgbToHex(await page.evaluate(() => {
      const el = document.querySelector('.q-item.q-head .q-timer');
      if (!el) return '';
      return window.getComputedStyle(el).color;
    }));
    expect(timerColor).toBe('#e74c3c');
    await page.screenshot({ path: screenshotPath('E2-timer-start') });

    // E2.1: after roughly half the build time the remaining time is ~2.5s (±0.5s).
    await page.waitForFunction(
      () => {
        const r = (window as any).__testHarness.getTimeRemaining();
        return r <= 2.7 && r >= 2.0;
      },
      { timeout: 8000 }
    );
    const midText = await timerLocator.textContent();
    expect(midText).toMatch(/^2\.[0-9]s$/);

    // E2.3: when the item completes the timer disappears and READY is shown.
    await waitForReady(page, 8000);
    await expect(page.locator('.q-item.q-head .ready-label')).toHaveText('READY — Pulse Active');
    await expect(timerLocator).toHaveCount(0);
    await page.screenshot({ path: screenshotPath('E2-timer-ready') });
  });

  // ================================================================
  // E3. Ready item pulses
  // ================================================================

  test('E3 - Ready item makes the factory pulse', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 3);

    expect(await enqueue(page, 'infantry')).toBe(true);
    await waitForReady(page, 8000);

    await page.screenshot({ path: screenshotPath('E3-ready-pulse-start') });

    // E3.1: isReadyPulsing must toggle between true and false over a 2s cycle.
    const samples: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      samples.push(await isPulsing(page));
      await page.waitForTimeout(220);
    }
    expect(samples).toContain(true);
    expect(samples).toContain(false);

    // E3.3: removing the ready item stops the pulse immediately.
    expect(await cancel(page, 0)).toBe(true);
    await page.waitForTimeout(100);
    expect(await isPulsing(page)).toBe(false);
    await page.screenshot({ path: screenshotPath('E3-pulse-stopped') });
  });

  // ================================================================
  // E4. Cancel triggers refund
  // ================================================================

  test('E4 - Cancel incomplete item refunds proportionally', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 4);

    expect(await enqueue(page, 'medTank')).toBe(true);

    // Wait until roughly 50% completion.
    const p = await waitForProgressInRange(page, 45, 55);

    // E4.1: Verify cancel item and get refund in ONE evaluate to minimize frame drift.
    const refundResult = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      const item = h.getQueueItems()[0];
      const progress = item.progressPct / 100;
      const expectedRefund = Math.floor(800 * (1 - progress) * 0.75);
      h.cancelItem(0);
      return { expectedRefund, actualRefund: h.getRefundedTotal() };
    });
    // Refund formula: cost × (1 - progress) × 0.75, calculated at cancel time
    expect(refundResult.actualRefund).toBe(refundResult.expectedRefund);

    const feedback = await page.locator('#feedback').textContent();
    expect(feedback).toContain(`Refunded $${refundResult.actualRefund}`);
    await page.screenshot({ path: screenshotPath('E4-cancel-incomplete-refund') });

    // E4.3: item is removed from the queue.
    expect(await getQueueItems(page)).toHaveLength(0);
  });

  test('E4.2 - Cancel completed item gives no refund', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 5);

    expect(await enqueue(page, 'infantry')).toBe(true);
    await waitForReady(page, 8000);

    expect(await cancel(page, 0)).toBe(true);

    expect(await getRefundedTotal(page)).toBe(0);
    const feedback = await page.locator('#feedback').textContent();
    expect(feedback).toContain('already complete, no refund');
    await page.screenshot({ path: screenshotPath('E4-cancel-completed-no-refund') });

    expect(await getQueueItems(page)).toHaveLength(0);
  });

  // ================================================================
  // E5. Cancel head triggers reorder
  // ================================================================

  test('E5 - Cancel head reorders queue and keeps progress smooth', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 2);

    await enqueue(page, 'infantry');
    await enqueue(page, 'rocket');
    await enqueue(page, 'lightTank');

    // Let all items progress for a short while.
    await page.waitForTimeout(2200);
    const before = await getQueueItems(page);
    expect(before).toHaveLength(3);
    const rocketProgressBefore = before[1].progressPct;

    // E5.1: cancel head → rocket becomes the new head.
    expect(await cancel(page, 0)).toBe(true);
    const afterCancel = await getQueueItems(page);
    expect(afterCancel).toHaveLength(2);
    expect(afterCancel[0].type).toBe('rocket');

    // The new head should retain the progress it already had (±2% drift from frame timing and evaluate scheduling).
    expect(afterCancel[0].progressPct).toBeGreaterThanOrEqual(rocketProgressBefore - 2);
    expect(afterCancel[0].progressPct).toBeLessThanOrEqual(rocketProgressBefore + 2);
    await page.screenshot({ path: screenshotPath('E5-reorder-after-head-cancel') });

    // E5.2: UI reorders within 300ms — the first DOM item should now be rocket.
    const firstName = await page.locator('#queue-list .q-item').nth(0).locator('.q-name').textContent();
    expect(firstName).toContain('Rocket Soldier');

    // E5.3: cancelling the non-head item must not reset the head's progress.
    const headProgressBefore = await getProgress(page);
    expect(await cancel(page, 1)).toBe(true);
    await page.waitForTimeout(800);
    const headProgressAfter = await getProgress(page);
    expect(headProgressAfter).toBeGreaterThan(headProgressBefore);
    await page.screenshot({ path: screenshotPath('E5-nonhead-cancel-progress-continues') });
  });

  // ================================================================
  // Edge cases
  // ================================================================

  test('Edge case - Empty queue cancel shows a message', async ({ page }) => {
    await resetQueue(page);
    await page.locator('#btnCancelHead').click();
    await expect(page.locator('#feedback')).toHaveText('Queue empty — nothing to cancel.');
    await page.screenshot({ path: screenshotPath('edge-empty-queue-cancel') });
  });

  test('Edge case - 10x speed completes all items quickly', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 10);

    await enqueue(page, 'infantry');
    await enqueue(page, 'engineer');
    await enqueue(page, 'rocket');
    await enqueue(page, 'lightTank');

    await waitForCompletedCount(page, 4, 10000);

    const items = await getQueueItems(page);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.isReady)).toBe(true);
    await page.screenshot({ path: screenshotPath('edge-10x-speed-all-ready') });
  });

  test('Edge case - Multiple same-type items progress independently', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 3);

    await enqueue(page, 'infantry');
    await enqueue(page, 'infantry');
    await enqueue(page, 'infantry');

    const initial = await getQueueItems(page);
    expect(initial).toHaveLength(3);
    expect(initial.every((i) => i.name === 'Rifle Infantry')).toBe(true);
    await page.screenshot({ path: screenshotPath('edge-three-infantry-start') });

    await waitForCompletedCount(page, 3, 10000);

    const final = await getQueueItems(page);
    expect(final).toHaveLength(3);
    expect(final.every((i) => i.isReady)).toBe(true);
    await page.screenshot({ path: screenshotPath('edge-three-infantry-ready') });
  });

  test('Edge case - Pause and resume stops and restores progress', async ({ page }) => {
    await resetQueue(page);
    await setSpeed(page, 1);

    await enqueue(page, 'medTank');
    await page.waitForTimeout(1100);
    const progressBeforePause = await getProgress(page);
    expect(progressBeforePause).toBeGreaterThan(2);

    await page.locator('#btnPause').click();
    await page.waitForTimeout(1500);
    const progressWhilePaused = await getProgress(page);

    // Progress should be essentially frozen (≤1.5% drift to account for frame timing).
    expect(progressWhilePaused).toBeGreaterThanOrEqual(progressBeforePause - 1.5);
    expect(progressWhilePaused).toBeLessThanOrEqual(progressBeforePause + 1.5);
    await page.screenshot({ path: screenshotPath('edge-paused-progress-frozen') });

    await page.locator('#btnPause').click();
    await page.waitForTimeout(1200);
    const progressAfterResume = await getProgress(page);
    expect(progressAfterResume).toBeGreaterThan(progressWhilePaused + 2);
    await page.screenshot({ path: screenshotPath('edge-resumed-progress-moved') });
  });
});
