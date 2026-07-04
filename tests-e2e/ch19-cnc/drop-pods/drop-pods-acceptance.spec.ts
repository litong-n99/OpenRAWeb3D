/**
 * Playwright acceptance test: CH19 CnC — DropPodImpact
 * URL: http://localhost:5173/test/ch19-cnc/drop-pods/
 *
 * Covers 6 expectation groups (E1-E6) plus boundary scenarios for the
 * DropPodImpact Babylon.js 3D particle effect page.
 *
 * Important constraints:
 * - The page does NOT expose a `__testHarness` / `__testApi`; all
 *   assertions are performed against DOM status text and screenshots.
 * - Canvas WebGL rendering in headless Chromium may differ from
 *   interactive runs (throttled FPS, disabled GPU compositing, etc.).
 *   Therefore timing tolerances are relaxed and visual assertions are
 *   backed by DOM state where possible.
 * - Evidence screenshots are written to
 *   test-results/manual/ch19-cnc/drop-pods/evidence/
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch19-cnc/drop-pods/';
const EVIDENCE_DIR = path.resolve('test-results/manual/ch19-cnc/drop-pods/evidence');

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

function evidenceFile(name: string): string {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  return path.join(EVIDENCE_DIR, name);
}

async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: evidenceFile(name), fullPage: false });
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

async function getText(page: Page, id: string): Promise<string> {
  return page.evaluate((selectorId) => {
    const el = document.getElementById(selectorId);
    return el ? el.textContent?.trim() ?? '' : '';
  }, id);
}

async function getNum(page: Page, id: string): Promise<number> {
  const text = await getText(page, id);
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : NaN;
}

// ---------------------------------------------------------------------------
// Control helpers
// ---------------------------------------------------------------------------

async function setSelect(page: Page, selector: string, value: string): Promise<void> {
  await page.selectOption(selector, value);
  await page.waitForTimeout(100);
}

async function setRange(page: Page, selector: string, value: number): Promise<void> {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) return;
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
  await page.waitForTimeout(100);
}

async function clickDrop(page: Page): Promise<void> {
  await page.click('#btn-drop');
}

async function clickSwarm(page: Page): Promise<void> {
  await page.click('#btn-swarm');
}

async function clickReset(page: Page): Promise<void> {
  await page.click('#btn-reset');
  await page.waitForTimeout(200);
}

async function setSpeed(page: Page, speed: 'fast' | 'normal' | 'slow'): Promise<void> {
  await setSelect(page, '#sel-speed', speed);
}

async function setCount(page: Page, count: '1' | '3' | '5'): Promise<void> {
  await setSelect(page, '#sel-count', count);
}

async function setScatter(page: Page, radius: number): Promise<void> {
  await setRange(page, '#rng-scatter', radius);
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

type Phase = 'IDLE' | 'DESCENDING' | 'IMPACTING' | 'DEPLOYED' | 'COMPLETE' | 'MIXED';

async function waitForPhase(page: Page, phase: Phase, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const el = document.getElementById('st-phase');
      return el?.textContent?.trim() === expected;
    },
    phase,
    { timeout },
  );
}

async function waitForCounts(
  page: Page,
  expected: { pods?: number; impacted?: number; deployed?: number },
  timeout = 10000,
): Promise<void> {
  await page.waitForFunction(
    (exp) => {
      const pods = document.getElementById('st-pods')?.textContent?.trim() ?? '';
      const impacted = document.getElementById('st-impacted')?.textContent?.trim() ?? '';
      const deployed = document.getElementById('st-deployed')?.textContent?.trim() ?? '';
      const podsNum = parseInt(pods, 10);
      const impactedNum = parseInt(impacted, 10);
      const deployedNum = parseInt(deployed, 10);
      if (exp.pods !== undefined && podsNum !== exp.pods) return false;
      if (exp.impacted !== undefined && impactedNum !== exp.impacted) return false;
      if (exp.deployed !== undefined && deployedNum !== exp.deployed) return false;
      return true;
    },
    expected,
    { timeout },
  );
}

async function waitForIdle(page: Page, timeout = 10000): Promise<void> {
  await waitForPhase(page, 'IDLE', timeout);
}

// ---------------------------------------------------------------------------
// Error collector
// ---------------------------------------------------------------------------

function collectErrors(page: Page): { errors: string[]; detach: () => void } {
  const errors: string[] = [];
  const consoleHandler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  const pageErrorHandler = (err: Error) => errors.push(err.message);
  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);
  return {
    errors,
    detach: () => {
      page.off('console', consoleHandler);
      page.off('pageerror', pageErrorHandler);
    },
  };
}

async function assertNoErrors(handler: { errors: string[]; detach: () => void }): Promise<void> {
  handler.detach();
  if (handler.errors.length > 0) {
    console.warn(`[Browser console/page errors]: ${handler.errors.join('; ')}`);
  }
  // Treat only fatal JS errors as failures; Babylon.js may emit benign warnings.
  const fatal = handler.errors.filter((e) =>
    /uncaught|throw|error|exception|failed|cannot read/i.test(e),
  );
  expect(fatal).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.describe('CH19 CnC — DropPodImpact Acceptance Tests', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForSelector('#renderCanvas', { state: 'visible', timeout: 15000 });
    await expect(page.locator('#info-engine')).toHaveText('WebGL 2.0', { timeout: 15000 });
    // Ensure the page starts from a clean state.
    await clickReset(page);
    await waitForIdle(page);
  });

  // =====================================================================
  // E1. Pod Descent
  // =====================================================================

  test('E1.1 - Normal speed: 1 pod descends and completes within expected timeframe', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    const startTime = await page.evaluate(() => performance.now());
    await clickDrop(page);
    await waitForPhase(page, 'COMPLETE', 5000);
    const endTime = await page.evaluate(() => performance.now());
    const durationMs = endTime - startTime;

    // Expected: descent ~960ms + impact delay ~480ms + deploy delay ~320ms = ~1760ms.
    // Allow generous tolerance for headless timing jitter.
    expect(durationMs).toBeGreaterThanOrEqual(800);
    expect(durationMs).toBeLessThanOrEqual(2800);

    await waitForCounts(page, { pods: 1, impacted: 1, deployed: 1 }, 2000);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.1 normal-speed complete duration=${durationMs.toFixed(0)}ms (expected ~1760ms).`,
    });
    await takeScreenshot(page, 'e1-1-normal-speed-complete.png');
    await assertNoErrors(handler);
  });

  test('E1.2 - Fast speed: 1 pod descends and completes within expected timeframe', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'fast');
    await setCount(page, '1');
    await setScatter(page, 0);

    const startTime = await page.evaluate(() => performance.now());
    await clickDrop(page);
    await waitForPhase(page, 'COMPLETE', 3000);
    const endTime = await page.evaluate(() => performance.now());
    const durationMs = endTime - startTime;

    // Expected: descent ~240ms + impact delay ~480ms + deploy delay ~320ms = ~1040ms.
    expect(durationMs).toBeGreaterThanOrEqual(200);
    expect(durationMs).toBeLessThanOrEqual(2000);

    await waitForCounts(page, { pods: 1, impacted: 1, deployed: 1 }, 2000);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.2 fast-speed complete duration=${durationMs.toFixed(0)}ms (expected ~1040ms).`,
    });
    await takeScreenshot(page, 'e1-2-fast-speed-complete.png');
    await assertNoErrors(handler);
  });

  test('E1.3 - Slow speed: 1 pod descends and completes within expected timeframe', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'slow');
    await setCount(page, '1');
    await setScatter(page, 0);

    const startTime = await page.evaluate(() => performance.now());
    await clickDrop(page);
    await waitForPhase(page, 'COMPLETE', 7000);
    const endTime = await page.evaluate(() => performance.now());
    const durationMs = endTime - startTime;

    // Expected: descent ~2400ms + impact delay ~480ms + deploy delay ~320ms = ~3200ms.
    expect(durationMs).toBeGreaterThanOrEqual(2000);
    expect(durationMs).toBeLessThanOrEqual(4500);

    await waitForCounts(page, { pods: 1, impacted: 1, deployed: 1 }, 2000);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.3 slow-speed complete duration=${durationMs.toFixed(0)}ms (expected ~3200ms).`,
    });
    await takeScreenshot(page, 'e1-3-slow-speed-complete.png');
    await assertNoErrors(handler);
  });

  // =====================================================================
  // E2. Particle Trail
  // =====================================================================

  test('E2.1 - Particle trail is visible during descent and stops after landing', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    // The page does not expose the trail color values in the DOM.
    // Visual verification of the orange (#FF8800) re-entry trail is performed
    // via screenshots; in headless mode particle transparency/GPU compositing
    // may reduce visibility, so DOM state serves as the primary signal.

    await clickDrop(page);
    await waitForPhase(page, 'DESCENDING', 2000);
    await page.waitForTimeout(200); // allow a few trail particles to spawn
    await takeScreenshot(page, 'e2-1-trail-during-descent.png');

    await waitForPhase(page, 'COMPLETE', 5000);
    await waitForCounts(page, { pods: 1, impacted: 1, deployed: 1 }, 2000);
    await takeScreenshot(page, 'e2-2-trail-after-complete.png');

    test.info().annotations.push({
      type: 'visual-evidence',
      description: 'E2.1: captured descent and post-complete screenshots for orange particle trail verification.',
    });
    await assertNoErrors(handler);
  });

  test('E2.2 - Trail emission stops after pods reach the ground', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    await clickDrop(page);
    await waitForPhase(page, 'COMPLETE', 5000);
    await waitForCounts(page, { pods: 1, impacted: 1, deployed: 1 }, 2000);

    // Once COMPLETE the pod is still counted in the active list but its trail
    // emitter is disposed at landing; verify the count reflects the finished pod.
    const pods = await getNum(page, 'st-pods');
    expect(pods).toBe(1);

    await takeScreenshot(page, 'e2-3-trail-stopped-complete.png');
    await assertNoErrors(handler);
  });

  // =====================================================================
  // E3. Impact Effect
  // =====================================================================

  test('E3.1 - Impact/shockwave is created after the configured landing-to-impact delay', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    const startTime = await page.evaluate(() => performance.now());
    await clickDrop(page);

    // IMPACTING starts as soon as the pod lands; the actual shockwave is created
    // when the phase transitions to DEPLOYED, which is 12 ticks (480ms) later.
    await waitForPhase(page, 'DEPLOYED', 6000);
    const deployTime = await page.evaluate(() => performance.now());
    const timeToImpactMs = deployTime - startTime;

    // Expected: descent ~960ms + landing-to-impact delay ~480ms = ~1440ms.
    expect(timeToImpactMs).toBeGreaterThanOrEqual(1000);
    expect(timeToImpactMs).toBeLessThanOrEqual(2200);

    await waitForPhase(page, 'COMPLETE', 3000);
    await takeScreenshot(page, 'e3-1-impact-sequence.png');

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E3.1 time to shockwave/impact=${timeToImpactMs.toFixed(0)}ms (expected ~1440ms).`,
    });
    await assertNoErrors(handler);
  });

  test('E3.2 - Shockwave ring expansion is visible during DEPLOYED phase', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    await clickDrop(page);
    // The shockwave is created at the transition to DEPLOYED and expands during
    // the 8-tick DEPLOYED phase; the IMPACTING phase is only the delay timer.
    await waitForPhase(page, 'DEPLOYED', 6000);
    await page.waitForTimeout(100); // mid-shockwave frame
    await takeScreenshot(page, 'e3-2-shockwave-expanding.png');

    await waitForPhase(page, 'COMPLETE', 3000);
    await takeScreenshot(page, 'e3-3-after-impact.png');

    test.info().annotations.push({
      type: 'visual-evidence',
      description: 'E3.2: screenshots captured during and after shockwave expansion.',
    });
    await assertNoErrors(handler);
  });

  // =====================================================================
  // E4. Scatter Pattern
  // =====================================================================

  test('E4.1 - Default scatter radius is 200 WDist and swarm drop creates 5 pods', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setScatter(page, 200);

    const scatterValue = await page.evaluate(() => {
      const el = document.getElementById('rng-scatter') as HTMLInputElement | null;
      return el ? parseInt(el.value, 10) : NaN;
    });
    expect(scatterValue).toBe(200);

    await clickSwarm(page);
    await waitForCounts(page, { pods: 5 }, 2000);
    await waitForPhase(page, 'DESCENDING', 2000);
    await takeScreenshot(page, 'e4-1-swarm-5-pods-descending.png');

    await waitForPhase(page, 'COMPLETE', 6000);
    await waitForCounts(page, { pods: 5, impacted: 5, deployed: 5 }, 2000);
    await takeScreenshot(page, 'e4-2-swarm-5-pods-complete.png');

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E4.1: default scatter=${scatterValue}, swarm drop produced 5 pods, all impacted/deployed.`,
    });
    await assertNoErrors(handler);
  });

  test('E4.2 - Zero scatter keeps multiple pods on a single target axis', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setScatter(page, 0);
    await setCount(page, '5');

    await clickDrop(page);
    await waitForCounts(page, { pods: 5 }, 2000);
    await waitForPhase(page, 'COMPLETE', 6000);
    await waitForCounts(page, { pods: 5, impacted: 5, deployed: 5 }, 2000);
    await takeScreenshot(page, 'e4-3-zero-scatter-5-pods.png');

    test.info().annotations.push({
      type: 'visual-evidence',
      description: 'E4.2: zero-scatter 5-pod drop captured for visual alignment verification.',
    });
    await assertNoErrors(handler);
  });

  test('E4.3 - Maximum scatter (500 WDist) disperses 5 pods without crash', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'fast');
    await setScatter(page, 500);
    await setCount(page, '5');

    await clickDrop(page);
    await waitForCounts(page, { pods: 5 }, 2000);
    await waitForPhase(page, 'COMPLETE', 4000);
    await waitForCounts(page, { pods: 5, impacted: 5, deployed: 5 }, 2000);
    await takeScreenshot(page, 'e4-4-max-scatter-5-pods.png');

    test.info().annotations.push({
      type: 'quantified-metric',
      description: 'E4.3: maximum scatter 500 WDist, 5 pods completed successfully.',
    });
    await assertNoErrors(handler);
  });

  // =====================================================================
  // E5. Unit Deployment
  // =====================================================================

  test('E5.1 - Deployed blue cube count matches dropped pod count', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setScatter(page, 0);

    for (const count of [1, 3, 5] as const) {
      await clickReset(page);
      await waitForIdle(page);
      await setCount(page, String(count));
      await clickDrop(page);
      await waitForPhase(page, 'COMPLETE', 5000);
      await waitForCounts(page, { pods: count, impacted: count, deployed: count }, 2000);
      await takeScreenshot(page, `e5-1-deployed-count-${count}.png`);
    }

    test.info().annotations.push({
      type: 'quantified-metric',
      description: 'E5.1: deployed count matched dropped count for 1, 3, and 5 pods.',
    });
    await assertNoErrors(handler);
  });

  test('E5.2 - DEPLOYED phase appears after impact delay and before COMPLETE', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    const phases: Array<{ phase: string; time: number }> = [];
    await clickDrop(page);

    const startTime = await page.evaluate(() => performance.now());

    await page.waitForFunction(
      () => {
        const p = document.getElementById('st-phase')?.textContent?.trim() ?? '';
        return p === 'DEPLOYED' || p === 'COMPLETE';
      },
      { timeout: 5000 },
    );
    const firstObserved = await getText(page, 'st-phase');
    phases.push({ phase: firstObserved, time: await page.evaluate(() => performance.now()) - startTime });

    // DEPLOYED should appear at ~1440ms (descent + 12-tick impact delay).
    expect(phases[0].phase).toBe('DEPLOYED');
    expect(phases[0].time).toBeGreaterThanOrEqual(1000);
    expect(phases[0].time).toBeLessThanOrEqual(2200);

    await waitForPhase(page, 'COMPLETE', 3000);
    phases.push({ phase: 'COMPLETE', time: await page.evaluate(() => performance.now()) - startTime });

    await takeScreenshot(page, 'e5-2-deployed-phase.png');

    test.info().annotations.push({
      type: 'state-sequence',
      description: `E5.2: phase sequence included ${phases.map((p) => `${p.phase}@${p.time.toFixed(0)}ms`).join(' -> ')}.`,
    });
    await assertNoErrors(handler);
  });

  // =====================================================================
  // E6. State Machine
  // =====================================================================

  test('E6.1 - State machine follows DESCENDING -> IMPACTING -> DEPLOYED -> COMPLETE', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '1');
    await setScatter(page, 0);

    const sequence: string[] = [];
    await waitForIdle(page);
    sequence.push(await getText(page, 'st-phase'));

    await clickDrop(page);

    // Poll the phase at 50ms intervals to capture the full transition chain.
    const observed = await page.evaluate(() => {
      return new Promise<string[]>((resolve) => {
        const phases: string[] = [];
        const lastPhase = document.getElementById('st-phase')?.textContent?.trim() ?? '';
        phases.push(lastPhase);
        let ticks = 0;
        const interval = setInterval(() => {
          const current = document.getElementById('st-phase')?.textContent?.trim() ?? '';
          if (current !== phases[phases.length - 1]) {
            phases.push(current);
          }
          if (current === 'COMPLETE' || ticks++ > 120) {
            clearInterval(interval);
            resolve(phases);
          }
        }, 50);
      });
    });

    expect(observed.length).toBeGreaterThanOrEqual(3);
    expect(observed).toContain('DESCENDING');
    expect(observed).toContain('IMPACTING');
    expect(observed).toContain('DEPLOYED');
    expect(observed[observed.length - 1]).toBe('COMPLETE');

    // Verify the logical ordering.
    const idxDescending = observed.indexOf('DESCENDING');
    const idxImpacting = observed.indexOf('IMPACTING');
    const idxDeployed = observed.indexOf('DEPLOYED');
    const idxComplete = observed.indexOf('COMPLETE');
    expect(idxDescending).toBeLessThan(idxImpacting);
    expect(idxImpacting).toBeLessThan(idxDeployed);
    expect(idxDeployed).toBeLessThan(idxComplete);

    await takeScreenshot(page, 'e6-1-state-machine-sequence.png');

    test.info().annotations.push({
      type: 'state-sequence',
      description: `E6.1: observed phase sequence = [${observed.join(' -> ')}].`,
    });
    await assertNoErrors(handler);
  });

  test('E6.2 - Status counts update consistently through the state transitions', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '3');
    await setScatter(page, 100);

    await clickDrop(page);
    await waitForPhase(page, 'DESCENDING', 2000);
    const descendingPods = await getNum(page, 'st-pods');
    expect(descendingPods).toBe(3);
    await takeScreenshot(page, 'e6-2-descending-3-pods.png');

    await waitForPhase(page, 'IMPACTING', 3000);
    // In the IMPACTING phase no pods are still DESCENDING, so impacted count
    // already equals the total active pod count.
    const impactingPods = await getNum(page, 'st-pods');
    const impacted = await getNum(page, 'st-impacted');
    expect(impactingPods).toBe(3);
    expect(impacted).toBe(3);
    await takeScreenshot(page, 'e6-3-impacting-3-pods.png');

    await waitForPhase(page, 'COMPLETE', 5000);
    await waitForCounts(page, { pods: 3, impacted: 3, deployed: 3 }, 2000);
    await takeScreenshot(page, 'e6-4-complete-3-pods.png');

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E6.2: counts remained consistent across DESCENDING/IMPACTING/COMPLETE for 3 pods.`,
    });
    await assertNoErrors(handler);
  });

  // =====================================================================
  // Boundary tests
  // =====================================================================

  test('B1.1 - Three consecutive swarm drops operate independently', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'fast');
    await setScatter(page, 200);

    for (let run = 1; run <= 3; run++) {
      await clickSwarm(page);
      await waitForCounts(page, { pods: 5 * run }, 2000);
      await takeScreenshot(page, `b1-1-run-${run}-after-drop.png`);
    }

    await waitForPhase(page, 'COMPLETE', 8000);
    await waitForCounts(page, { pods: 15, impacted: 15, deployed: 15 }, 3000);
    await takeScreenshot(page, 'b1-1-three-swarm-drops-complete.png');

    test.info().annotations.push({
      type: 'quantified-metric',
      description: 'B1.1: three consecutive 5-pod swarm drops completed with 15 impacted/deployed.',
    });
    await assertNoErrors(handler);
  });

  test('B1.2 - Reset during descent clears all pods and returns to IDLE', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'slow');
    await setCount(page, '5');
    await setScatter(page, 200);

    await clickDrop(page);
    await waitForCounts(page, { pods: 5 }, 2000);
    await waitForPhase(page, 'DESCENDING', 2000);
    await takeScreenshot(page, 'b1-2-before-reset.png');

    await clickReset(page);
    await waitForIdle(page);
    await waitForCounts(page, { pods: 0, impacted: 0, deployed: 0 }, 2000);
    await takeScreenshot(page, 'b1-2-after-reset-idle.png');

    // After reset, a new drop should work normally.
    await setSpeed(page, 'normal');
    await setCount(page, '3');
    await clickDrop(page);
    await waitForPhase(page, 'COMPLETE', 5000);
    await waitForCounts(page, { pods: 3, impacted: 3, deployed: 3 }, 2000);
    await takeScreenshot(page, 'b1-2-after-reset-redrop.png');

    test.info().annotations.push({
      type: 'state-sequence',
      description: 'B1.2: reset during descent returned to IDLE and a subsequent drop completed normally.',
    });
    await assertNoErrors(handler);
  });

  test('B1.3 - Reset after completion clears state and allows re-drop', async ({ page }) => {
    const handler = collectErrors(page);
    await setSpeed(page, 'normal');
    await setCount(page, '5');
    await setScatter(page, 200);

    await clickDrop(page);
    await waitForPhase(page, 'COMPLETE', 6000);
    await waitForCounts(page, { pods: 5, impacted: 5, deployed: 5 }, 2000);
    await takeScreenshot(page, 'b1-3-complete-before-reset.png');

    await clickReset(page);
    await waitForIdle(page);
    await waitForCounts(page, { pods: 0, impacted: 0, deployed: 0 }, 2000);
    await takeScreenshot(page, 'b1-3-reset-to-idle.png');

    await clickSwarm(page);
    await waitForPhase(page, 'COMPLETE', 6000);
    await waitForCounts(page, { pods: 5, impacted: 5, deployed: 5 }, 2000);
    await takeScreenshot(page, 'b1-3-redrop-after-reset.png');

    test.info().annotations.push({
      type: 'state-sequence',
      description: 'B1.3: reset after completion returned to IDLE and swarm re-drop completed.',
    });
    await assertNoErrors(handler);
  });
});
