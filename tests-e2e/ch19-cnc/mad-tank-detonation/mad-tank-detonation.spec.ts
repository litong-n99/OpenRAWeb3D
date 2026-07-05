/**
 * ch19-cnc/mad-tank-detonation — Playwright acceptance test
 *
 * Verifies the Babylon.js MAD Tank DetonationSequence state machine and
 * visual effects using DOM status assertions and screenshots.
 *
 * Page: http://localhost:5173/test/ch19-cnc/mad-tank-detonation/
 * Tick rate: 25 ticks/s (40 ms/tick)
 * Default config: chargeDelay=96, detonationDelay=42, thumpInterval=8
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

const TEST_URL = 'http://localhost:5173/test/ch19-cnc/mad-tank-detonation/';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../../../test-results/manual/ch19-cnc/mad-tank-detonation/evidence');

const TICK_MS = 40;
const DEFAULT_CHARGE_DELAY = 96;
const DEFAULT_DETONATION_DELAY = 42;
const DEFAULT_THUMP_INTERVAL = 8;
const DEFAULT_TOTAL = DEFAULT_CHARGE_DELAY + DEFAULT_DETONATION_DELAY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function screenshot(page: Page, name: string): Promise<string> {
  const fp = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  return fp;
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const e = (id: string) => document.getElementById(id)?.textContent?.trim() ?? '';
    return {
      phase: e('st-phase'),
      ticks: parseInt(e('st-ticks'), 10) || 0,
      total: parseInt(e('st-total'), 10) || 0,
      thumps: parseInt(e('st-thumps'), 10) || 0,
      initiated: e('st-initiated'),
      cancelling: e('st-cancelling'),
      interruptible: e('st-intr'),
    };
  });
}

async function getPhase(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('st-phase')?.textContent?.trim() ?? '');
}

async function getTicks(page: Page): Promise<number> {
  return page.evaluate(() => parseInt(document.getElementById('st-ticks')?.textContent?.trim() ?? '0', 10));
}

async function waitForPhase(page: Page, phase: string, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (p) => document.getElementById('st-phase')?.textContent?.trim() === p,
    phase,
    { timeout },
  );
}

async function waitForTicksGE(page: Page, min: number, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const t = parseInt(document.getElementById('st-ticks')?.textContent?.trim() ?? '0', 10);
      return t >= n;
    },
    min,
    { timeout },
  );
}

async function setSlider(page: Page, selector: string, value: number): Promise<void> {
  await page.evaluate((args) => {
    const el = document.querySelector(args.selector) as HTMLInputElement | null;
    if (!el) return;
    el.value = String(args.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
  await page.waitForTimeout(100);
}

async function clickDetonate(page: Page): Promise<void> {
  await page.click('#btn-detonate');
}

async function clickCancel(page: Page): Promise<void> {
  await page.click('#btn-cancel');
}

async function clickReset(page: Page): Promise<void> {
  await page.click('#btn-reset');
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#renderCanvas', { timeout: 15000 });
  await page.waitForSelector('#st-phase', { timeout: 15000 });

  // Wait for Babylon.js / WebGL initialization.
  await page.waitForFunction(
    () => document.getElementById('info-engine')?.textContent?.includes('WebGL'),
    {},
    { timeout: 15000 },
  );

  // Wait for the first render-loop update to set the phase to IDLE.
  await page.waitForFunction(
    () => document.getElementById('st-phase')?.textContent?.trim() === 'IDLE',
    {},
    { timeout: 5000 },
  );
});

// ---------------------------------------------------------------------------
// E1 — Initiate (tick 0)
// ---------------------------------------------------------------------------

test.describe('E1: Initiate', () => {
  test('E1.1: first tick enters INITIATE with initiated=true and interruptible=false', async ({ page }) => {
    const initial = await readState(page);
    expect(initial.phase).toBe('IDLE');
    expect(initial.interruptible).toBe('true');
    expect(initial.initiated).toBe('false');

    await clickDetonate(page);

    // Phase transitions: FIRST_RUN → INITIATE on the first tick().
    await waitForPhase(page, 'INITIATE', 2000);

    const s = await readState(page);
    expect(s.phase).toBe('INITIATE');
    expect(s.initiated).toBe('true');
    expect(s.interruptible).toBe('false');
    expect(s.cancelling).toBe('false');

    await screenshot(page, 'e1-initiate-tick-0');
  });
});

// ---------------------------------------------------------------------------
// E2 — Charge Phase (ticks 1-96)
// ---------------------------------------------------------------------------

test.describe('E2: Charge Phase', () => {
  test('E2.1: thumps occur and ticks advance during charge', async ({ page }) => {
    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    // Wait until tick 64 — by then we should have seen 8 thumps.
    await waitForTicksGE(page, 64, 5000);

    const s = await readState(page);
    expect(s.thumps).toBeGreaterThan(0);
    expect(s.thumps).toBeGreaterThanOrEqual(8);
    expect(s.ticks).toBeGreaterThanOrEqual(64);
    expect(s.total).toBe(DEFAULT_TOTAL);
    // Phase is either INITIATE (before tick 96) or CHARGING (at tick 96).
    expect(['INITIATE', 'CHARGING']).toContain(s.phase);
    expect(s.initiated).toBe('true');

    await screenshot(page, 'e2-mid-charge');
  });
});

// ---------------------------------------------------------------------------
// E3 — Charge Sound (tick 96)
// ---------------------------------------------------------------------------

test.describe('E3: Charge Sound', () => {
  test('E3.1: phase switches to CHARGING and thump count reaches 12', async ({ page }) => {
    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    // Wait until the charge delay tick.
    await page.waitForFunction(
      (chargeDelay) => {
        const phase = document.getElementById('st-phase')?.textContent?.trim() ?? '';
        const ticks = parseInt(document.getElementById('st-ticks')?.textContent?.trim() ?? '0', 10);
        return phase === 'CHARGING' || ticks >= chargeDelay;
      },
      DEFAULT_CHARGE_DELAY,
      { timeout: 8000 },
    );

    // Give the render loop one more frame to settle.
    await page.waitForTimeout(TICK_MS * 2);

    const s = await readState(page);
    expect(s.phase).toBe('CHARGING');
    expect(s.ticks).toBeGreaterThanOrEqual(DEFAULT_CHARGE_DELAY);
    expect(s.thumps).toBe(Math.floor(DEFAULT_CHARGE_DELAY / DEFAULT_THUMP_INTERVAL));
    expect(s.total).toBe(DEFAULT_TOTAL);

    await screenshot(page, 'e3-charge-sound-peak');
  });
});

// ---------------------------------------------------------------------------
// E4 — Detonation (tick 138)
// ---------------------------------------------------------------------------

test.describe('E4: Detonation', () => {
  test('E4.1: sequence completes, indicator shows DETONATE!', async ({ page }) => {
    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    await page.waitForFunction(
      (total) => {
        const phase = document.getElementById('st-phase')?.textContent?.trim() ?? '';
        const ticks = parseInt(document.getElementById('st-ticks')?.textContent?.trim() ?? '0', 10);
        return phase === 'COMPLETE' || ticks >= total;
      },
      DEFAULT_TOTAL,
      { timeout: 15000 },
    );

    // Allow the detonation visual frame to render.
    await page.waitForTimeout(TICK_MS * 2);

    const s = await readState(page);
    expect(s.phase).toBe('COMPLETE');
    expect(s.total).toBe(DEFAULT_TOTAL);
    expect(s.ticks).toBeGreaterThanOrEqual(DEFAULT_TOTAL);
    expect(s.thumps).toBe(Math.floor(DEFAULT_TOTAL / DEFAULT_THUMP_INTERVAL));
    expect(s.cancelling).toBe('false');

    const indicatorOpacity = await page.evaluate(
      () => document.getElementById('phase-indicator')?.style.opacity ?? '',
    );
    expect(indicatorOpacity).toBe('1');

    const indicatorText = await page.evaluate(
      () => document.getElementById('phase-indicator')?.textContent?.trim() ?? '',
    );
    expect(indicatorText).toBe('DETONATE!');

    await screenshot(page, 'e4-detonation-complete');
  });
});

// ---------------------------------------------------------------------------
// E5 — Cancel
// ---------------------------------------------------------------------------

test.describe('E5: Cancel', () => {
  test('E5.1: cancel mid-sequence sets phase CANCELLED and isCancelling=true', async ({ page }) => {
    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    // Let ~12 ticks elapse.
    await page.waitForTimeout(500);

    const before = await readState(page);
    expect(before.phase).not.toBe('IDLE');
    expect(before.phase).not.toBe('COMPLETE');

    await clickCancel(page);
    await waitForPhase(page, 'CANCELLED', 3000);

    const s = await readState(page);
    expect(s.phase).toBe('CANCELLED');
    expect(s.cancelling).toBe('true');
    // Cancelled sequences do not complete; initiated was already true.
    expect(s.initiated).toBe('true');

    await screenshot(page, 'e5-cancelled');
  });
});

// ---------------------------------------------------------------------------
// E6 — Parameter Configuration
// ---------------------------------------------------------------------------

test.describe('E6: Parameter Configuration', () => {
  test('E6.1: custom delays and thump interval produce correct total and thump count', async ({ page }) => {
    const chargeDelay = 48;
    const detonationDelay = 20;
    const thumpInterval = 4;
    const expectedTotal = chargeDelay + detonationDelay;
    const expectedThumps = Math.floor((expectedTotal - 1) / thumpInterval);

    await setSlider(page, '#rng-charge', chargeDelay);
    await setSlider(page, '#rng-detonate', detonationDelay);
    await setSlider(page, '#rng-thump', thumpInterval);

    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    // The total is only committed to the sequence once startDetonation() calls reset().
    const totalLabel = await page.evaluate(() => document.getElementById('st-total')?.textContent?.trim() ?? '');
    expect(parseInt(totalLabel, 10)).toBe(expectedTotal);

    await waitForPhase(page, 'COMPLETE', 8000);

    const s = await readState(page);
    expect(s.phase).toBe('COMPLETE');
    expect(s.total).toBe(expectedTotal);
    expect(s.thumps).toBe(expectedThumps);

    await screenshot(page, 'e6-custom-config-complete');
  });
});

// ---------------------------------------------------------------------------
// Edge — Fast Cancel
// ---------------------------------------------------------------------------

test.describe('Edge: Fast Cancel', () => {
  test('Edge.1: cancel within 100ms aborts before charge', async ({ page }) => {
    await clickDetonate(page);
    await page.waitForTimeout(100);
    await clickCancel(page);

    await waitForPhase(page, 'CANCELLED', 3000);

    const s = await readState(page);
    expect(s.phase).toBe('CANCELLED');
    expect(s.cancelling).toBe('true');
    // Aborted before significant progress (allow for render-loop/action overhead).
    expect(s.ticks).toBeLessThan(20);

    await screenshot(page, 'edge-fast-cancel');
  });
});

// ---------------------------------------------------------------------------
// Edge — Reset and Restart
// ---------------------------------------------------------------------------

test.describe('Edge: Reset and Restart', () => {
  test('Edge.2: reset restores IDLE state and sequence can restart', async ({ page }) => {
    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    // Let ~12 ticks elapse.
    await page.waitForTimeout(500);

    await clickReset(page);

    const resetState = await readState(page);
    expect(resetState.phase).toBe('IDLE');
    expect(resetState.ticks).toBe(0);
    expect(resetState.total).toBe(DEFAULT_TOTAL);
    expect(resetState.thumps).toBe(0);
    expect(resetState.initiated).toBe('false');
    expect(resetState.cancelling).toBe('false');
    expect(resetState.interruptible).toBe('true');

    await screenshot(page, 'edge-reset-idle');

    // Restart the sequence.
    await clickDetonate(page);
    await waitForPhase(page, 'INITIATE', 2000);

    const restarted = await readState(page);
    expect(restarted.phase).toBe('INITIATE');
    expect(restarted.initiated).toBe('true');
    expect(restarted.interruptible).toBe('false');
    expect(restarted.ticks).toBeLessThan(5);

    await screenshot(page, 'edge-restarted');
  });
});

// ---------------------------------------------------------------------------
// Bonus — DetonateAttack equivalence
// ---------------------------------------------------------------------------

test.describe('Bonus: DetonateAttack', () => {
  test('Bonus.1: DetonateAttack button starts the same sequence', async ({ page }) => {
    await page.click('#btn-detonate-attack');
    await waitForPhase(page, 'INITIATE', 2000);

    const s = await readState(page);
    expect(s.phase).toBe('INITIATE');
    expect(s.initiated).toBe('true');
    expect(s.interruptible).toBe('false');
    expect(s.total).toBe(DEFAULT_TOTAL);

    await screenshot(page, 'bonus-detonate-attack');
  });
});
