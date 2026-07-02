/**
 * Playwright E2E Tests — Cloak Alpha Effect (shroud/cloak-alpha)
 *
 * Target: /test/ch12-shroud-fog/cloak-alpha/
 * Module: CloakStyle.Alpha — cloaked unit alpha=0.55 for owner, invisible for enemy.
 *
 * Acceptance criteria covered:
 *   ER1. Cloaked owner view: gold tank visible at alpha=0.55
 *   ER2. Cloaked enemy view: tank completely invisible (alpha=0.00)
 *   ER3. Uncloak via Attack: both viewports alpha=1.00
 *   ER4. Uncloak via Move: tank moves + both viewports alpha=1.00
 *   ER5. Auto re-cloak after CloakDelay ticks
 *   ER6. CloakDelay slider controls re-cloak duration
 *   Edge A. Rapid attacks: remainingTime stays capped at CloakDelay
 *   Edge B. Force re-cloak via "等待隐形" button
 *
 * CRITICAL CLICK NOTE:
 *   Playwright's locator.click() does NOT reliably trigger the addEventListener
 *   handlers for #btn-attack and #btn-move. Dispatch a bubbling Event('click')
 *   via page.evaluate() for those two buttons. The #btn-cloak-only button works
 *   with normal locator.click().
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = '/test/ch12-shroud-fog/cloak-alpha/';
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/manual/ch12-shroud-fog/cloak-alpha',
  'evidence'
);

const DEFAULT_CLOAK_DELAY = 30;
const TICK_INTERVAL_MS = 100; // one visual tick ≈ 100ms

function evidenceFile(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

async function attachScreenshot(page: Page, fileName: string): Promise<void> {
  const filePath = evidenceFile(fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  await test.info().attach(fileName, { path: filePath });
}

async function attachViewportScreenshot(page: Page, fileName: string): Promise<void> {
  const filePath = evidenceFile(fileName);
  await page.locator('#sandbox').screenshot({ path: filePath });
  await test.info().attach(fileName, { path: filePath });
}

async function waitForEngineReady(page: Page, timeout = 20000): Promise<void> {
  await expect(page.locator('#info-engine'), 'engine info should be set').not.toHaveText('-', { timeout });
  await expect(page.locator('#canvas-owner'), 'owner canvas should be attached').toBeAttached({ timeout });
  await expect(page.locator('#canvas-enemy'), 'enemy canvas should be attached').toBeAttached({ timeout });
}

async function assertWebGL2(page: Page): Promise<void> {
  await expect(page.locator('#info-engine')).toHaveText('WebGL 2.0');
}

/**
 * Dispatch a click event directly from the page for buttons whose
 * addEventListener('click') handler is not triggered by Playwright's
 * element.click().
 */
async function dispatchButtonClick(page: Page, id: string): Promise<void> {
  await page.evaluate((buttonId: string) => {
    const btn = document.getElementById(buttonId);
    if (!btn) throw new Error(`Button #${buttonId} not found`);
    btn.dispatchEvent(new Event('click', { bubbles: true }));
  }, id);
  // Small settle for the render loop to reflect the state change.
  await page.waitForTimeout(50);
}

async function setCloakDelay(page: Page, ticks: number): Promise<void> {
  await page.evaluate((value: number) => {
    const slider = document.getElementById('range-delay') as HTMLInputElement | null;
    if (!slider) throw new Error('CloakDelay slider not found');
    slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, ticks);
  await expect(page.locator('#val-delay')).toHaveText(`${ticks} ticks`);
  await page.waitForTimeout(50);
}

async function getStatus(page: Page) {
  return page.evaluate(() => ({
    status: document.getElementById('status-text')!.textContent ?? '',
    remaining: document.getElementById('status-remaining')!.textContent ?? '',
    ownerAlpha: document.getElementById('status-owner-alpha')!.textContent ?? '',
    enemyAlpha: document.getElementById('status-enemy-alpha')!.textContent ?? '',
    timer: document.getElementById('cloak-timer')!.textContent ?? '',
  }));
}

async function assertCloaked(page: Page): Promise<void> {
  const status = await getStatus(page);
  expect(status.status).toBe('Cloaked');
  expect(status.ownerAlpha).toBe('0.55');
  expect(status.enemyAlpha).toBe('0.00');
  expect(status.timer).toBe('Cloaked');
}

async function assertUncloaked(
  page: Page,
  expectedTicks: number = DEFAULT_CLOAK_DELAY,
  tolerance: number = 5
): Promise<void> {
  const status = await getStatus(page);
  expect(status.status).toBe('Uncloaked');
  expect(status.ownerAlpha).toBe('1.00');
  expect(status.enemyAlpha).toBe('1.00');

  const remainingMatch = status.remaining.match(/^(\d+) ticks$/);
  expect(remainingMatch).not.toBeNull();
  const remainingTicks = parseInt(remainingMatch![1], 10);
  expect(remainingTicks).toBeGreaterThan(0);
  expect(remainingTicks).toBeGreaterThanOrEqual(expectedTicks - tolerance);
  expect(remainingTicks).toBeLessThanOrEqual(expectedTicks);
}

/**
 * Assert the unit is currently uncloaked and returns the remaining tick count.
 * Useful when the exact countdown is not predictable (e.g. mid-way through a
 * long cloak delay).
 */
async function assertUncloakedPositive(page: Page): Promise<number> {
  const status = await getStatus(page);
  expect(status.status).toBe('Uncloaked');
  expect(status.ownerAlpha).toBe('1.00');
  expect(status.enemyAlpha).toBe('1.00');

  const remainingMatch = status.remaining.match(/^(\d+) ticks$/);
  expect(remainingMatch).not.toBeNull();
  const remainingTicks = parseInt(remainingMatch![1], 10);
  expect(remainingTicks).toBeGreaterThan(0);
  return remainingTicks;
}

test.describe.configure({ mode: 'serial' });

test.describe('Cloak Alpha Effect — Owner/Enemy Viewports', () => {
  let page: Page;
  let initialPositionX: number;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(PAGE_URL);
    await waitForEngineReady(page);
    await assertWebGL2(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ---------------------------------------------------------------------------
  // ER1: Cloaked - Owner View
  // ---------------------------------------------------------------------------
  test('ER1: Cloaked owner view shows tank at alpha=0.55', async () => {
    test.setTimeout(60000);

    await assertCloaked(page);
    await expect(page.locator('#vp-left')).toBeVisible();
    await expect(page.locator('#canvas-owner')).toBeAttached();

    await attachViewportScreenshot(page, 'screenshot-er1-owner-cloaked.png');
  });

  // ---------------------------------------------------------------------------
  // ER2: Cloaked - Enemy View
  // ---------------------------------------------------------------------------
  test('ER2: Cloaked enemy view hides tank completely', async () => {
    test.setTimeout(60000);

    await assertCloaked(page);
    await expect(page.locator('#vp-right')).toBeVisible();
    await expect(page.locator('#canvas-enemy')).toBeAttached();

    const enemyInvisible = await page.evaluate(() => {
      const harness = (window as any).__cloakAlphaTest;
      return harness && harness.enemyUnit ? !harness.enemyUnit.isVisible : false;
    });
    expect(enemyInvisible).toBe(true);

    await attachViewportScreenshot(page, 'screenshot-er2-enemy-cloaked.png');
  });

  // ---------------------------------------------------------------------------
  // ER3: Uncloak via Attack
  // ---------------------------------------------------------------------------
  test('ER3: Attack button uncloaks tank to alpha=1.00 in both viewports', async () => {
    test.setTimeout(60000);

    // Ensure starting from a cloaked state.
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    await dispatchButtonClick(page, 'btn-attack');

    await assertUncloaked(page, DEFAULT_CLOAK_DELAY);

    const enemyVisible = await page.evaluate(() => {
      const harness = (window as any).__cloakAlphaTest;
      return harness && harness.enemyUnit ? harness.enemyUnit.isVisible : false;
    });
    expect(enemyVisible).toBe(true);

    await attachViewportScreenshot(page, 'screenshot-er3-uncloaked-attack.png');
  });

  // ---------------------------------------------------------------------------
  // ER4: Uncloak via Move
  // ---------------------------------------------------------------------------
  test('ER4: Move button uncloaks tank and shifts position', async () => {
    test.setTimeout(60000);

    // Reset to cloaked and record current position.
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    initialPositionX = await page.evaluate(() => {
      const harness = (window as any).__cloakAlphaTest;
      return harness && harness.ownerUnit ? harness.ownerUnit.position.x : 0;
    });

    await dispatchButtonClick(page, 'btn-move');

    await assertUncloaked(page, DEFAULT_CLOAK_DELAY);

    const newPositionX = await page.evaluate(() => {
      const harness = (window as any).__cloakAlphaTest;
      return harness && harness.ownerUnit ? harness.ownerUnit.position.x : 0;
    });
    expect(newPositionX).toBeGreaterThan(initialPositionX);

    await attachViewportScreenshot(page, 'screenshot-er4-uncloaked-move.png');
  });

  // ---------------------------------------------------------------------------
  // ER5: Auto Re-cloak
  // ---------------------------------------------------------------------------
  test('ER5: Tank auto re-cloaks after CloakDelay ticks', async () => {
    test.setTimeout(60000);

    // Reset to default delay and cloaked state.
    await setCloakDelay(page, DEFAULT_CLOAK_DELAY);
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    await dispatchButtonClick(page, 'btn-attack');
    await assertUncloaked(page, DEFAULT_CLOAK_DELAY);

    // Wait for the full cloak delay plus a generous margin for timer jitter.
    // 30 ticks * 100ms/tick = 3000ms
    await page.waitForTimeout(DEFAULT_CLOAK_DELAY * TICK_INTERVAL_MS + 1500);

    await assertCloaked(page);

    await attachViewportScreenshot(page, 'screenshot-er5-auto-recloak.png');
  });

  // ---------------------------------------------------------------------------
  // ER6: CloakDelay Slider
  // ---------------------------------------------------------------------------
  test('ER6: CloakDelay slider controls re-cloak duration', async () => {
    test.setTimeout(60000);

    // --- Short delay: 10 ticks (~1s) ---
    await setCloakDelay(page, 10);
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    await dispatchButtonClick(page, 'btn-attack');
    await assertUncloaked(page, 10, 2);

    await page.waitForTimeout(10 * TICK_INTERVAL_MS + 1000);
    await assertCloaked(page);
    await attachViewportScreenshot(page, 'screenshot-er6-short-delay.png');

    // --- Long delay: 120 ticks (~12s) ---
    await setCloakDelay(page, 120);
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    await dispatchButtonClick(page, 'btn-move');
    await assertUncloaked(page, 120, 2);

    // Confirm it does NOT re-cloak too early.
    await page.waitForTimeout(2000);
    const remainingAtMid = await assertUncloakedPositive(page);
    await attachViewportScreenshot(page, 'screenshot-er6-long-delay-mid.png');

    // Wait the remaining time plus a margin and confirm re-cloak.
    await page.waitForTimeout(remainingAtMid * TICK_INTERVAL_MS + 1500);
    await assertCloaked(page);
    await attachViewportScreenshot(page, 'screenshot-er6-long-delay-end.png');

    // Restore default delay for subsequent tests.
    await setCloakDelay(page, DEFAULT_CLOAK_DELAY);
  });

  // ---------------------------------------------------------------------------
  // Edge A: Rapid Attacks
  // ---------------------------------------------------------------------------
  test('Edge A: Rapid attacks cap remaining time at CloakDelay', async () => {
    test.setTimeout(60000);

    await setCloakDelay(page, DEFAULT_CLOAK_DELAY);
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    // Fire 5 rapid Attack events. The page's uncloak() uses
    // remainingTime = max(remainingTime, cloakDelay), so rapid clicks must not
    // accumulate beyond the configured delay.
    for (let i = 0; i < 5; i++) {
      await dispatchButtonClick(page, 'btn-attack');
    }

    await assertUncloaked(page, DEFAULT_CLOAK_DELAY, 5);

    await attachViewportScreenshot(page, 'screenshot-edgea-rapid-attacks.png');
  });

  // ---------------------------------------------------------------------------
  // Edge B: Force Re-cloak
  // ---------------------------------------------------------------------------
  test('Edge B: Force re-cloak button immediately returns to cloaked state', async () => {
    test.setTimeout(60000);

    await setCloakDelay(page, DEFAULT_CLOAK_DELAY);
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);
    await assertCloaked(page);

    await dispatchButtonClick(page, 'btn-attack');
    await assertUncloaked(page, DEFAULT_CLOAK_DELAY);

    // Normal click works for the cloak-only button.
    await page.locator('#btn-cloak-only').click();
    await page.waitForTimeout(150);

    await assertCloaked(page);

    await attachViewportScreenshot(page, 'screenshot-edgeb-force-recloak.png');
  });
});
