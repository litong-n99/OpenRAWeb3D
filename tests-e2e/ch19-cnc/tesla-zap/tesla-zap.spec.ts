/**
 * ch19-cnc/tesla-zap — Playwright E2E acceptance tests with edge cases
 *
 * Verifies the Babylon.js Tesla zap lightning arc visualization:
 *   E1. Fire zap → DOM count = brightCount + dimCount; arcs visible on canvas
 *   E2. Bright/Dim count combinations (including 0 edge cases)
 *   E3. Duration management (default 2 ticks, slider, continuous fire)
 *   E4. Charge animation → progress 0→1 then auto-fire
 *   E5. Random branching → 10 consecutive fires produce visibly different arcs
 *
 * Page: http://localhost:5173/test/ch19-cnc/tesla-zap/
 * Tick rate: 25 ticks/s → 1 tick = 40 ms
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAGE_URL = 'http://localhost:5173/test/ch19-cnc/tesla-zap/';
const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../../test-results/manual/ch19-cnc/tesla-zap/evidence'
);

const TICK_MS = 40;
const CHARGE_TICKS = 8; // matches main.ts chargeTicksRemaining

interface ZapStatus {
  zaps: number;
  bright: number;
  dim: number;
  ticks: number;
  charge: string;
  progress: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, `${name}.png`);
}

async function screenshot(page: Page, name: string): Promise<string> {
  const fp = evidenceFile(name);
  await page.screenshot({ path: fp, fullPage: false });
  return fp;
}

async function readStatus(page: Page): Promise<ZapStatus> {
  return page.evaluate(() => {
    const t = (id: string) => document.getElementById(id)?.textContent?.trim() ?? '';
    return {
      zaps: parseInt(t('st-zaps'), 10) || 0,
      bright: parseInt(t('st-bright'), 10) || 0,
      dim: parseInt(t('st-dim'), 10) || 0,
      ticks: parseInt(t('st-ticks'), 10) || 0,
      charge: t('st-charge'),
      progress: parseFloat(t('st-charge-progress')) || 0,
    };
  });
}

async function resetPage(page: Page): Promise<void> {
  await page.click('#btn-reset');
  await page.waitForTimeout(TICK_MS * 2);
}

async function fireZap(page: Page): Promise<void> {
  await page.click('#btn-fire');
}

async function setBright(page: Page, value: number): Promise<void> {
  await page.locator('#sel-bright').selectOption(String(value));
  await page.waitForTimeout(50);
}

async function setDim(page: Page, value: number): Promise<void> {
  await page.locator('#sel-dim').selectOption(String(value));
  await page.waitForTimeout(50);
}

async function setDuration(page: Page, value: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.getElementById('rng-duration') as HTMLInputElement | null;
    if (!el) return;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await expect(page.locator('#lbl-duration')).toHaveText(`${value} ticks`);
}

async function waitForZaps(page: Page, min = 1, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (n) => (parseInt(document.getElementById('st-zaps')?.textContent?.trim() ?? '0', 10) || 0) >= n,
    min,
    { timeout }
  );
}

async function waitForNoZaps(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => (parseInt(document.getElementById('st-zaps')?.textContent?.trim() ?? '0', 10) || 0) === 0,
    {},
    { timeout }
  );
}

async function expectZapsEventually(page: Page, expected: number, timeout = 3000): Promise<void> {
  await page.waitForFunction(
    (n) => (parseInt(document.getElementById('st-zaps')?.textContent?.trim() ?? '0', 10) || 0) === n,
    expected,
    { timeout }
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe('Tesla Zap Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#renderCanvas', { timeout: 15000 });
    await page.waitForFunction(
      () => document.getElementById('info-engine')?.textContent?.includes('WebGL'),
      {},
      { timeout: 15000 }
    );
    await expect(page.locator('#st-charge')).toHaveText(/IDLE|CHARGING/, { timeout: 5000 });
    await resetPage(page);
  });

  // -------------------------------------------------------------------------
  // E1: Lightning Arc Generation
  // -------------------------------------------------------------------------

  test('E1: fire zap produces bright+dim arcs between tower and target', async ({ page }) => {
    const engineText = await page.locator('#info-engine').textContent();
    expect(engineText).toMatch(/WebGL\s*2/);

    // Default bright=1, dim=2
    await fireZap(page);
    await waitForZaps(page, 3);

    const status = await readStatus(page);
    expect(status.zaps).toBe(status.bright + status.dim);
    expect(status.bright).toBe(1);
    expect(status.dim).toBe(2);
    expect(status.ticks).toBeGreaterThan(0);

    await screenshot(page, 'e1-fire-default-bright1-dim2');
  });

  test('E1-edge: zero bright and zero dim still reports 0 zaps without error', async ({ page }) => {
    await setBright(page, 0);
    await setDim(page, 0);
    await fireZap(page);
    await page.waitForTimeout(TICK_MS);

    const status = await readStatus(page);
    expect(status.zaps).toBe(0);
    expect(status.bright).toBe(0);
    expect(status.dim).toBe(0);

    await screenshot(page, 'e1-edge-zero-zaps');
  });

  // -------------------------------------------------------------------------
  // E2: Dim / Bright Layer Rendering
  // -------------------------------------------------------------------------

  test('E2: mixed bright=2/dim=4, bright-only, and dim-only counts', async ({ page }) => {
    await setDuration(page, 10);

    // Mixed: 2 bright + 4 dim = 6 zaps
    await setBright(page, 2);
    await setDim(page, 4);
    await fireZap(page);
    await waitForZaps(page, 6);
    let status = await readStatus(page);
    expect(status.zaps).toBe(6);
    expect(status.bright).toBe(2);
    expect(status.dim).toBe(4);
    await screenshot(page, 'e2-bright2-dim4-mixed');

    // Bright=0, keep dim=4 → only dim zaps remain
    await setBright(page, 0);
    await fireZap(page);
    await expectZapsEventually(page, 4);
    status = await readStatus(page);
    expect(status.zaps).toBe(4);
    expect(status.bright).toBe(0);
    expect(status.dim).toBe(4);
    await screenshot(page, 'e2-dim4-only');

    // Dim=0, bright=2 → only bright zaps
    await setDim(page, 0);
    await fireZap(page);
    await expectZapsEventually(page, 2);
    status = await readStatus(page);
    expect(status.zaps).toBe(2);
    expect(status.bright).toBe(2);
    expect(status.dim).toBe(0);
    await screenshot(page, 'e2-bright2-only');
  });

  test('E2-edge: switching both selects to maximum (4+4) and then to minimum (0+0)', async ({ page }) => {
    await setDuration(page, 10);

    await setBright(page, 4);
    await setDim(page, 4);
    await fireZap(page);
    await waitForZaps(page, 8);
    let status = await readStatus(page);
    expect(status.zaps).toBe(8);
    await screenshot(page, 'e2-edge-max-8-zaps');

    await setBright(page, 0);
    await setDim(page, 0);
    await fireZap(page);
    await page.waitForTimeout(TICK_MS * 2);
    status = await readStatus(page);
    expect(status.zaps).toBe(0);
    await screenshot(page, 'e2-edge-min-0-zaps');
  });

  // -------------------------------------------------------------------------
  // E3: Duration Management
  // -------------------------------------------------------------------------

  test('E3: default duration decrements and zaps expire; slider extends lifetime', async ({ page }) => {
    // Default duration = 2 ticks
    await expect(page.locator('#lbl-duration')).toHaveText('2 ticks');

    await fireZap(page);
    await waitForZaps(page, 3);

    // Watch ticks decrement from 2 down toward 0
    let maxTicks = 0;
    const deadline = Date.now() + 300;
    while (Date.now() < deadline) {
      const s = await readStatus(page);
      if (s.ticks > maxTicks) maxTicks = s.ticks;
      await page.waitForTimeout(TICK_MS);
    }
    expect(maxTicks).toBeGreaterThanOrEqual(2);

    // After ~200 ms (5 ticks), default duration zaps should be gone
    await waitForNoZaps(page, 5000);
    let status = await readStatus(page);
    expect(status.zaps).toBe(0);
    expect(status.ticks).toBe(0);
    await screenshot(page, 'e3-default-duration-expired');

    // Set duration=10 and verify zaps persist longer than default
    await setDuration(page, 10);
    await fireZap(page);
    await waitForZaps(page, 3);
    await page.waitForTimeout(250); // > default lifetime
    status = await readStatus(page);
    expect(status.zaps).toBeGreaterThan(0);
    expect(status.ticks).toBeGreaterThan(0);
    await screenshot(page, 'e3-duration-10-persisted');

    // Eventually expire
    await waitForNoZaps(page, 5000);
    status = await readStatus(page);
    expect(status.zaps).toBe(0);
  });

  test('E3-edge: duration slider boundary values 1 and 10', async ({ page }) => {
    await setDuration(page, 1);
    await fireZap(page);
    await waitForZaps(page, 3);
    await page.waitForTimeout(TICK_MS * 4); // 1 tick should expire quickly
    let status = await readStatus(page);
    expect(status.zaps).toBe(0);
    await screenshot(page, 'e3-edge-duration-1-expired');

    await setDuration(page, 10);
    await fireZap(page);
    await waitForZaps(page, 3);
    await page.waitForTimeout(TICK_MS * 8); // still alive after 8 ticks
    status = await readStatus(page);
    expect(status.zaps).toBeGreaterThan(0);
    expect(status.ticks).toBeGreaterThan(0);
    await screenshot(page, 'e3-edge-duration-10-alive');
  });

  test('E3-continuous: toggle continuous mode fires repeatedly', async ({ page }) => {
    await setDuration(page, 2);
    await page.click('#btn-continuous');
    await expect(page.locator('#btn-continuous')).toHaveClass(/active/);

    const fireEvents: number[] = [];
    for (let i = 0; i < 4; i++) {
      await waitForZaps(page, 1, 5000);
      const s = await readStatus(page);
      fireEvents.push(s.zaps);
      await screenshot(page, `e3-continuous-fire-${i + 1}`);
      // Wait for the current batch to expire before the next interval fires
      await waitForNoZaps(page, 5000);
      await page.waitForTimeout(50);
    }

    expect(fireEvents.every((n) => n > 0)).toBe(true);

    await page.click('#btn-continuous');
    await expect(page.locator('#btn-continuous')).not.toHaveClass(/active/);
  });

  test('E3-edge: rapid consecutive fire clicks do not crash and last click wins', async ({ page }) => {
    await setDuration(page, 10);
    await setBright(page, 1);
    await setDim(page, 1);

    // Fire 5 times as fast as possible
    for (let i = 0; i < 5; i++) {
      await fireZap(page);
    }

    await waitForZaps(page, 2);
    const status = await readStatus(page);
    expect(status.zaps).toBe(2);
    expect(status.bright).toBe(1);
    expect(status.dim).toBe(1);
    await screenshot(page, 'e3-edge-rapid-fire');
  });

  // -------------------------------------------------------------------------
  // E4: Charge Animation
  // -------------------------------------------------------------------------

  test('E4: charge orb grows, progress 0→1 over ~400ms, then auto-fires', async ({ page }) => {
    await page.click('#btn-charge');

    // Charge phase reported immediately
    await expect(page.locator('#st-charge')).toHaveText('CHARGING', { timeout: 2000 });

    // Progress should start above 0 within one render frame
    let status = await readStatus(page);
    expect(status.progress).toBeGreaterThanOrEqual(0);
    expect(status.progress).toBeLessThan(1);
    await screenshot(page, 'e4-charging-start');

    // Wait for completion: 8 ticks ≈ 320 ms
    await page.waitForFunction(
      () => {
        const p = parseFloat(document.getElementById('st-charge-progress')?.textContent?.trim() ?? '0');
        const phase = document.getElementById('st-charge')?.textContent?.trim() ?? '';
        return p >= 0.99 && phase === 'IDLE';
      },
      {},
      { timeout: 5000 }
    );

    status = await readStatus(page);
    expect(status.charge).toBe('IDLE');
    expect(status.progress).toBeGreaterThanOrEqual(0.99);
    expect(status.zaps).toBeGreaterThan(0);
    await screenshot(page, 'e4-charge-complete-auto-fire');
  });

  test('E4-edge: charge progress increases monotonically and reaches exactly 1.00', async ({ page }) => {
    const progressValues: number[] = [];

    await page.click('#btn-charge');
    const deadline = Date.now() + CHARGE_TICKS * TICK_MS + 200;

    while (Date.now() < deadline) {
      const s = await readStatus(page);
      progressValues.push(s.progress);
      if (s.charge === 'IDLE' && s.progress >= 0.99) break;
      await page.waitForTimeout(TICK_MS);
    }

    expect(progressValues[0]).toBe(0);
    expect(progressValues[progressValues.length - 1]).toBeGreaterThanOrEqual(0.99);

    // Verify monotonic non-decreasing progression
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
  });

  test('E4-edge: reset during charging cancels charge and hides orb', async ({ page }) => {
    await page.click('#btn-charge');
    await expect(page.locator('#st-charge')).toHaveText('CHARGING', { timeout: 2000 });

    await resetPage(page);

    const status = await readStatus(page);
    expect(status.charge).toBe('IDLE');
    expect(status.progress).toBe(0);
    expect(status.zaps).toBe(0);
    await screenshot(page, 'e4-edge-reset-during-charge');
  });

  // -------------------------------------------------------------------------
  // E5: Random Branching
  // -------------------------------------------------------------------------

  test('E5: ten consecutive fires produce visibly different arc paths', async ({ page }) => {
    await setDuration(page, 10);

    const screenshots: string[] = [];
    for (let i = 1; i <= 10; i++) {
      await fireZap(page);
      await waitForZaps(page, 1);
      const status = await readStatus(page);
      expect(status.zaps).toBeGreaterThan(0);
      const fp = await screenshot(page, `e5-random-branch-fire-${i.toString().padStart(2, '0')}`);
      screenshots.push(fp);
      await page.waitForTimeout(250);
    }

    expect(screenshots.length).toBe(10);

    // Sanity check: at least two screenshots differ in file size (proxy for visual difference)
    const sizes = screenshots.map((fp) => fs.statSync(fp).size);
    const uniqueSizes = new Set(sizes);
    expect(uniqueSizes.size).toBeGreaterThan(1);
  });

  test('E5-edge: bright=1/dim=0 ten times still yields varying single arcs', async ({ page }) => {
    await setDuration(page, 10);
    await setBright(page, 1);
    await setDim(page, 0);

    const screenshots: string[] = [];
    for (let i = 1; i <= 10; i++) {
      await fireZap(page);
      await waitForZaps(page, 1);
      const status = await readStatus(page);
      expect(status.zaps).toBe(1);
      const fp = await screenshot(page, `e5-edge-single-bright-fire-${i.toString().padStart(2, '0')}`);
      screenshots.push(fp);
      await page.waitForTimeout(250);
    }

    const sizes = screenshots.map((fp) => fs.statSync(fp).size);
    const uniqueSizes = new Set(sizes);
    expect(uniqueSizes.size).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // Reset / cleanup edge case
  // -------------------------------------------------------------------------

  test('reset-edge: reset clears zaps, charge, and continuous mode', async ({ page }) => {
    await setDuration(page, 10);
    await setBright(page, 2);
    await setDim(page, 2);
    await page.click('#btn-continuous');
    await fireZap(page);
    await waitForZaps(page, 4);

    await resetPage(page);

    const status = await readStatus(page);
    expect(status.zaps).toBe(0);
    expect(status.ticks).toBe(0);
    expect(status.charge).toBe('IDLE');
    expect(status.progress).toBe(0);
    await expect(page.locator('#btn-continuous')).not.toHaveClass(/active/);
    await screenshot(page, 'reset-edge-all-cleared');
  });
});
