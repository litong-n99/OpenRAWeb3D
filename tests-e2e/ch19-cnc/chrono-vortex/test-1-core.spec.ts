/**
 * test-1-core.spec.ts — ConyardChronoVortex acceptance tests
 *
 * URL: http://localhost:5173/test/ch19-cnc/chrono-vortex/
 *
 * NOTE: The test page auto-ticks the vortex at 25 ticks/s. The IDLE phase
 * is extremely short (1 tick ≈ 40ms after reset). Tests account for this
 * by resetting before each test and verifying fresh state accordingly.
 *
 * Verifies E1-E7 from README.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const PAGE_URL = '/test/ch19-cnc/chrono-vortex/';
const TICK_MS = 40;

const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  'evidence',
);
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoAndInit(page: any): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });

  await page.waitForSelector('#renderCanvas', { timeout: 20000 });
  await page.waitForSelector('#info-engine', { timeout: 20000 });
  await page.waitForFunction(
    () => (document.getElementById('info-engine')?.textContent || '').includes('WebGL'),
    { timeout: 20000 },
  );

  // Page auto-ticks the vortex. Reset to get a fresh state,
  // then wait briefly for the first tick to fire.
  await page.locator('#btn-reset').click();
  await page.waitForTimeout(100);
}

async function screenshot(page: any, name: string): Promise<string> {
  const fullPath = path.resolve(EVIDENCE_DIR, name);
  await page.screenshot({ path: fullPath, fullPage: false });
  return fullPath;
}

// --- DOM readers ---

async function getFrame(page: any): Promise<number> {
  return parseInt(await page.$eval('#st-frame', (el: Element) => el.textContent || '0'), 10);
}
async function getMaxFrame(page: any): Promise<number> {
  return parseInt(await page.$eval('#st-maxframe', (el: Element) => el.textContent || '0'), 10);
}
async function getPhase(page: any): Promise<string> {
  return page.$eval('#st-phase', (el: Element) => el.textContent || '');
}
async function getLoopsRemaining(page: any): Promise<number> {
  return parseInt(await page.$eval('#st-loops', (el: Element) => el.textContent || '0'), 10);
}
async function getAngle(page: any): Promise<number> {
  return parseInt(await page.$eval('#st-angle', (el: Element) => el.textContent || '0'), 10);
}
async function getComplete(page: any): Promise<boolean> {
  return (await page.$eval('#st-complete', (el: Element) => el.textContent || 'false')).trim().toLowerCase() === 'true';
}

// --- Actions ---

async function startVortex(page: any): Promise<void> {
  await page.locator('#btn-start').click();
  await page.waitForTimeout(TICK_MS + 10);
}
async function resetVortex(page: any): Promise<void> {
  await page.locator('#btn-reset').click();
  await page.waitForTimeout(TICK_MS + 10);
}
async function setLoops(page: any, loops: number): Promise<void> {
  await page.locator('#sel-loops').selectOption(String(loops));
  await page.waitForTimeout(100);
}
async function setAngleStep(page: any, step: number): Promise<void> {
  await page.locator('#rng-angle').fill(String(step));
  await page.waitForTimeout(100);
}

/**
 * Poll for a specific phase, returning when found or failing after timeout.
 * NOTE: The vortex auto-advances; use short timeouts for opening phases.
 */
async function waitForPhase(page: any, phase: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await getPhase(page) === phase) return;
    await page.waitForTimeout(TICK_MS);
  }
  const current = await getPhase(page);
  expect(current).toBe(phase);
}

async function waitForComplete(page: any, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await getComplete(page)) return;
    await page.waitForTimeout(TICK_MS);
  }
  expect(await getComplete(page)).toBe(true);
}

/**
 * Collect N angle samples spaced ~sampleIntervalMs apart.
 * Returns average per-tick delta (modulo 1024 accounted for).
 */
async function sampleAngleDelta(
  page: any,
  samples: number,
  sampleIntervalMs: number,
): Promise<{ avgDelta: number; rawSamples: number[] }> {
  const raw: number[] = [];
  for (let i = 0; i < samples; i++) {
    raw.push(await getAngle(page));
    if (i < samples - 1) await page.waitForTimeout(sampleIntervalMs);
  }
  const deltas: number[] = [];
  for (let i = 1; i < raw.length; i++) {
    deltas.push((raw[i] - raw[i - 1] + 1024) % 1024);
  }
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return { avgDelta, rawSamples: raw };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('ConyardChronoVortex', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndInit(page);
  });

  // ==========================================================================
  // E1: Page loads, canvas renders, info bar populated
  // ==========================================================================
  test('E1: Page loads — canvas, controls, and info bar are present', async ({ page }) => {
    // After gotoAndInit, the vortex has been reset and is freshly ticking.
    // Phase should be OPENING (frame 0-2) at this point — IDLE is only 1 tick wide.

    const canvasBox = await page.locator('#renderCanvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(0);
    expect(canvasBox!.height).toBeGreaterThan(0);

    // After reset, frame should be small (0-5 within the first ~200ms).
    const frame = await getFrame(page);
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThanOrEqual(10);

    // Phase should be OPENING soon after reset (renders at 25 ticks/s).
    const phase = await getPhase(page);
    expect(phase).toMatch(/^(OPENING|LOOP)$/);

    // Default maxFrame = 80 (3 loops).
    expect(await getMaxFrame(page)).toBe(80);

    // Complete should be false.
    expect(await getComplete(page)).toBe(false);

    // Controls at defaults.
    expect(await page.inputValue('#sel-loops')).toBe('3');
    const angleSlider = await page.$eval('#rng-angle', (el: HTMLInputElement) => el.value);
    expect(parseInt(angleSlider, 10)).toBe(42);

    // Info bar populated.
    const ua = await page.textContent('#info-ua');
    const viewport = await page.textContent('#info-viewport');
    const engine = await page.textContent('#info-engine');
    const tickRate = await page.textContent('#info-tickrate');
    expect(ua).toBeTruthy();
    expect(viewport).toContain('x');
    expect(engine).toContain('WebGL');
    expect(tickRate).toContain('25');

    await screenshot(page, 'e1-page-loaded.png');
  });

  // ==========================================================================
  // E2: Full lifecycle — OPENING → LOOP → CLOSING → COMPLETE (3 loops, 80 frames)
  // ==========================================================================
  test('E2: Default 3 loops — visits all 4 phases and completes', async ({ page }) => {
    // Reset to get a clean starting vortex.
    await resetVortex(page);

    // Should shortly enter LOOP (frame 16-31), but first passes through OPENING.
    // Wait for LOOP to confirm the vortex is running.
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);
    expect(await getLoopsRemaining(page)).toBeGreaterThanOrEqual(1);
    await screenshot(page, 'e2-loop-phase.png');

    // Wait for CLOSING phase (after 3 loop iterations ≈ 48 frames + transition).
    await waitForPhase(page, 'CLOSING', 75 * TICK_MS + 1000);
    await screenshot(page, 'e2-closing-phase.png');

    // Wait for COMPLETE.
    await waitForComplete(page, 30 * TICK_MS + 500);
    expect(await getPhase(page)).toBe('COMPLETE');
    expect(await getComplete(page)).toBe(true);
    await screenshot(page, 'e2-complete-phase.png');
  });

  // ==========================================================================
  // E3: loops=0 — 32 frames total
  // ==========================================================================
  test('E3: loops=0 — total 32 frames, goes directly to closing', async ({ page }) => {
    await setLoops(page, 0);
    // Must reset AFTER setting loops so the new vortex uses the updated value.
    await resetVortex(page);
    expect(await getMaxFrame(page)).toBe(32);

    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);
    await screenshot(page, 'e3-loops0-loop.png');

    await waitForPhase(page, 'CLOSING', 30 * TICK_MS + 500);
    await screenshot(page, 'e3-loops0-closing.png');

    await waitForComplete(page, 30 * TICK_MS + 500);
    expect(await getPhase(page)).toBe('COMPLETE');
    await screenshot(page, 'e3-loops0-complete.png');
  });

  // ==========================================================================
  // E4: loops=1 — 48 frames total
  // ==========================================================================
  test('E4: loops=1 — total 48 frames', async ({ page }) => {
    await setLoops(page, 1);
    await resetVortex(page);
    expect(await getMaxFrame(page)).toBe(48);

    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);
    await screenshot(page, 'e4-loops1-loop.png');

    await waitForPhase(page, 'CLOSING', 35 * TICK_MS + 500);
    await screenshot(page, 'e4-loops1-closing.png');

    await waitForComplete(page, 30 * TICK_MS + 500);
    expect(await getPhase(page)).toBe('COMPLETE');
    expect(await getComplete(page)).toBe(true);
    await screenshot(page, 'e4-loops1-complete.png');
  });

  // ==========================================================================
  // E5: loops=5 — 112 frames total
  // ==========================================================================
  test('E5: loops=5 — total 112 frames', async ({ page }) => {
    await setLoops(page, 5);
    await resetVortex(page);
    expect(await getMaxFrame(page)).toBe(112);

    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);
    // Stay in loop for a bit and verify it persists.
    await page.waitForTimeout(32 * TICK_MS); // ~1.28s, should still be in LOOP
    expect(await getPhase(page)).toBe('LOOP');
    await screenshot(page, 'e5-loops5-loop-mid.png');

    await waitForPhase(page, 'CLOSING', 110 * TICK_MS + 1000);
    await screenshot(page, 'e5-loops5-closing.png');

    await waitForComplete(page, 30 * TICK_MS + 500);
    expect(await getPhase(page)).toBe('COMPLETE');
    expect(await getComplete(page)).toBe(true);
    await screenshot(page, 'e5-loops5-complete.png');
  });

  // ==========================================================================
  // E6: Angle step — slider controls rotation speed (relative comparison)
  // ==========================================================================
  test('E6: Angle step 42 vs 120 — higher step = faster rotation', async ({ page }) => {
    // Measure angle advance at step=42.
    await setAngleStep(page, 42);
    await resetVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);

    const angle42Start = await getAngle(page);
    await page.waitForTimeout(400); // ~10 ticks
    const angle42End = await getAngle(page);
    const advance42 = (angle42End - angle42Start + 1024) % 1024;

    // Measure angle advance at step=120.
    await setAngleStep(page, 120);
    await resetVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);

    const angle120Start = await getAngle(page);
    await page.waitForTimeout(400);
    const angle120End = await getAngle(page);
    const advance120 = (angle120End - angle120Start + 1024) % 1024;

    // Step 120 should advance substantially more than step 42.
    // At 25 ticks/s, 400ms ≈ 10 ticks. Step 42 → ~420 advance. Step 120 → ~1200 advance.
    expect(advance120).toBeGreaterThan(advance42);
    // Step 42 should show reasonable advance (>100 for 10+ ticks at 42 each).
    expect(advance42).toBeGreaterThan(100);
    // Step 120 should show substantial advance.
    expect(advance120).toBeGreaterThan(400);

    await screenshot(page, 'e6-angle-step-comparison.png');
  });

  // ==========================================================================
  // E7: Angle step — minimum and maximum slider verification
  // ==========================================================================
  test('E7: Angle step min (5) — very slow rotation', async ({ page }) => {
    await setAngleStep(page, 5);
    // Verify the slider value is correctly set.
    const sliderVal = await page.$eval('#rng-angle', (el: HTMLInputElement) => el.value);
    expect(sliderVal).toBe('5');

    await resetVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);

    // At step=5, 400ms (~10 ticks) should advance ~50 WAngle units.
    const start = await getAngle(page);
    await page.waitForTimeout(400);
    const end = await getAngle(page);
    const advance = (end - start + 1024) % 1024;
    // Very slow: should be < 150 (far below the 42-step ~420 advance).
    expect(advance).toBeLessThan(150);

    await screenshot(page, 'e7-angle-step-5.png');
  });

  // ==========================================================================
  // E8: Angle step max (120) — fast rotation
  // ==========================================================================
  test('E8: Angle step max (120) — fast rotation', async ({ page }) => {
    await setAngleStep(page, 120);
    const sliderVal = await page.$eval('#rng-angle', (el: HTMLInputElement) => el.value);
    expect(sliderVal).toBe('120');

    await resetVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);

    // At step=120, 400ms (~10 ticks) should advance significantly.
    const start = await getAngle(page);
    await page.waitForTimeout(400);
    const end = await getAngle(page);
    const advance = (end - start + 1024) % 1024;
    // Should be substantial (10 ticks × 120 = 1200, mod 1024 ≈ 176, but could wrap multiple times)
    // Just verify it's not tiny.
    expect(advance).toBeGreaterThan(50);

    await screenshot(page, 'e8-angle-step-120.png');
  });

  // ==========================================================================
  // E9: Boundary — Reset returns to fresh state
  // ==========================================================================
  test('E9: Reset during animation restarts vortex from frame 0', async ({ page }) => {
    // Start (vortex already auto-running, but click start anyway to ensure fresh).
    await startVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);
    expect(await getFrame(page)).toBeGreaterThanOrEqual(16);

    await resetVortex(page);

    // After reset, frame should be small (0-3).
    expect(await getFrame(page)).toBeLessThanOrEqual(5);
    expect(await getComplete(page)).toBe(false);

    // Phase should be OPENING soon after reset.
    const phase = await getPhase(page);
    expect(phase).toMatch(/^(OPENING|LOOP)$/);

    await screenshot(page, 'e9-after-reset.png');
  });

  // ==========================================================================
  // E10: Boundary — Repeated start restarts
  // ==========================================================================
  test('E10: Repeated start clicks restart from beginning', async ({ page }) => {
    await startVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);
    expect(await getFrame(page)).toBeGreaterThanOrEqual(10);

    // Click start again.
    await startVortex(page);
    // Frame should be small again (0-5, depending on timing).
    expect(await getFrame(page)).toBeLessThanOrEqual(10);
    expect(await getComplete(page)).toBe(false);

    await screenshot(page, 'e10-restarted.png');
  });

  // ==========================================================================
  // E11: Completion callback
  // ==========================================================================
  test('E11: Completion callback fires — isComplete=true, phase=COMPLETE', async ({ page }) => {
    await setLoops(page, 1); // shorter test
    await startVortex(page); // reset + start
    await waitForComplete(page, 70 * TICK_MS + 1000);

    expect(await getPhase(page)).toBe('COMPLETE');
    expect(await getComplete(page)).toBe(true);
    expect(await getFrame(page)).toBeGreaterThanOrEqual(48);

    // Wait for the 500ms flash timeout that hides the particle.
    await page.waitForTimeout(700);
    // State should remain stable.
    expect(await getComplete(page)).toBe(true);
    expect(await getPhase(page)).toBe('COMPLETE');

    await screenshot(page, 'e11-completed.png');
  });

  // ==========================================================================
  // E12: Position rotates on a circle of radius ~171 WDist
  // ==========================================================================
  test('E12: Position rotates around center, radius ≈ 171, angle increases', async ({ page }) => {
    await resetVortex(page);
    await waitForPhase(page, 'LOOP', 25 * TICK_MS + 300);

    const angle1 = await getAngle(page);
    const pos1 = await page.$eval('#st-pos', (el: Element) => el.textContent || '0,0,0');
    const [x1, y1] = pos1.split(',').map((s: string) => parseInt(s.trim(), 10));

    // Wait several ticks.
    await page.waitForTimeout(5 * TICK_MS);

    const angle2 = await getAngle(page);
    const pos2 = await page.$eval('#st-pos', (el: Element) => el.textContent || '0,0,0');
    const [x2, y2] = pos2.split(',').map((s: string) => parseInt(s.trim(), 10));

    // Angle should increase (modulo 1024).
    const angleDelta = (angle2 - angle1 + 1024) % 1024;
    expect(angleDelta).toBeGreaterThan(0);

    // Position should change (vortex is rotating).
    expect(x1 !== x2 || y1 !== y2).toBe(true);

    // Distance from center ≈ 171 WDist (with ±3 tolerance for integer rounding).
    const radius1 = Math.sqrt(x1 ** 2 + y1 ** 2);
    const radius2 = Math.sqrt(x2 ** 2 + y2 ** 2);
    expect(radius1).toBeGreaterThanOrEqual(168);
    expect(radius1).toBeLessThanOrEqual(174);
    expect(radius2).toBeGreaterThanOrEqual(168);
    expect(radius2).toBeLessThanOrEqual(174);

    await screenshot(page, 'e12-position-rotation.png');
  });

  // ==========================================================================
  // E13: All phases visited during a complete run
  // ==========================================================================
  test('E13: All 4 phases (OPENING, LOOP, CLOSING, COMPLETE) are visited', async ({ page }) => {
    await resetVortex(page);

    const phasesSeen = new Set<string>();
    const deadline = Date.now() + 6000;

    while (Date.now() < deadline) {
      phasesSeen.add(await getPhase(page));
      if (await getComplete(page)) break;
      await page.waitForTimeout(TICK_MS);
    }

    // Ensure COMPLETE is recorded.
    phasesSeen.add(await getPhase(page));

    expect(phasesSeen.has('OPENING')).toBe(true);
    expect(phasesSeen.has('LOOP')).toBe(true);
    expect(phasesSeen.has('CLOSING')).toBe(true);
    expect(phasesSeen.has('COMPLETE')).toBe(true);

    await screenshot(page, 'e13-all-phases-visited.png');
  });
});
