/**
 * projectile-lifecycle acceptance test — Playwright automated verification
 *
 * Verifies the six core projectile lifecycle test cases on the acceptance test
 * page. All harness methods are synchronous; assertions run immediately after
 * each call.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/projectile-lifecycle/';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'test-results/manual/ch08-weapons-combat/projectile-lifecycle/evidence');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ---- Types ----

interface ProjectileTestHarness {
  runRegistryTest(): void;
  runMissileTest(): void;
  runInstantHitTest(): void;
  runGravityBombTest(): void;
  runBeamShapeTest(): void;
  runLaserZapTest(): void;
  runAllTests(): void;
  getEventLog(): string[];
  getFps?(): number;
}

declare global {
  interface Window {
    __projectileTestHarness?: ProjectileTestHarness;
  }
}

// ---- Helpers ----

async function gotoPage(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const h = window.__projectileTestHarness;
    return h != null && typeof h.runRegistryTest === 'function' && typeof h.getEventLog === 'function';
  }, { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function getEventLog(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const log = window.__projectileTestHarness!.getEventLog();
    return log.map((e: any) => `T${e.tick} [${e.projectile}] ${e.detail}`);
  });
}

async function logContains(page: Page, text: string): Promise<boolean> {
  const log = await getEventLog(page);
  return log.some((entry) => String(entry).includes(text));
}

async function getSummaryText(page: Page, id: string): Promise<string> {
  return page.evaluate(({ id }) => {
    const el = document.getElementById(id);
    return el ? el.textContent || '' : '';
  }, { id });
}

async function expectSummaryPass(page: Page, id: string): Promise<void> {
  const text = await getSummaryText(page, id);
  expect(text.trim().startsWith('✅')).toBe(true);
}

async function expectAllSummariesPass(page: Page): Promise<void> {
  for (let i = 1; i <= 6; i++) {
    await expectSummaryPass(page, `tc${i}-summary`);
  }
}

// =======================================================================
// Shared beforeEach
// =======================================================================

test.beforeEach(async ({ page }) => {
  await gotoPage(page);
});

// =======================================================================
// TC1 - ProjectileRegistry (8 types registered)
// =======================================================================

test('TC1 - ProjectileRegistry registers all 8 projectile types', async ({ page }) => {
  await page.evaluate(() => window.__projectileTestHarness!.runRegistryTest());

  await expectSummaryPass(page, 'tc1-summary');

  const requiredTypes = [
    'Bullet', 'Missile', 'GravityBomb', 'InstantHit',
    'LaserZap', 'Railgun', 'AreaBeam', 'NukeLaunch',
  ];
  for (const type of requiredTypes) {
    expect(await logContains(page, type)).toBe(true);
  }
});

// =======================================================================
// TC2 - Missile state machine
// =======================================================================

test('TC2 - Missile state machine transitions to destruction', async ({ page }) => {
  await page.evaluate(() => window.__projectileTestHarness!.runMissileTest());

  await expectSummaryPass(page, 'tc2-summary');
  expect(await logContains(page, '初始状态: Freefall')).toBe(true);
  expect(await logContains(page, 'isDestroyed=true')).toBe(true);
});

// =======================================================================
// TC3 - InstantHit zero-travel
// =======================================================================

test('TC3 - InstantHit performs zero-travel hit', async ({ page }) => {
  await page.evaluate(() => window.__projectileTestHarness!.runInstantHitTest());

  await expectSummaryPass(page, 'tc3-summary');
  expect(await logContains(page, '武器触发次数=1')).toBe(true);
  expect(await logContains(page, 'isDestroyed=true')).toBe(true);
});

// =======================================================================
// TC4 - GravityBomb trajectory
// =======================================================================

test('TC4 - GravityBomb follows arc and detonates on ground', async ({ page }) => {
  await page.evaluate(() => window.__projectileTestHarness!.runGravityBombTest());

  await expectSummaryPass(page, 'tc4-summary');
  expect(await logContains(page, '触地引爆')).toBe(true);
  expect(await logContains(page, '轨迹:')).toBe(true);
});

// =======================================================================
// TC5 - BeamRenderableShape enum
// =======================================================================

test('TC5 - BeamRenderableShape enum values are correct', async ({ page }) => {
  await page.evaluate(() => window.__projectileTestHarness!.runBeamShapeTest());

  await expectSummaryPass(page, 'tc5-summary');
  expect(await logContains(page, 'Cylindrical = 0')).toBe(true);
  expect(await logContains(page, 'Flat = 1')).toBe(true);
});

// =======================================================================
// TC6 - LaserZap duration tracking
// =======================================================================

test('TC6 - LaserZap beam alpha decays to zero', async ({ page }) => {
  await page.evaluate(() => window.__projectileTestHarness!.runLaserZapTest());

  await expectSummaryPass(page, 'tc6-summary');
  expect(await logContains(page, 'beamAlpha=0')).toBe(true);
});

// =======================================================================
// Boundary tests
// =======================================================================

test('Boundary - runAllTests three times keeps all summaries passing', async ({ page }) => {
  for (let run = 1; run <= 3; run++) {
    await page.evaluate(() => window.__projectileTestHarness!.runAllTests());
    await expectAllSummariesPass(page);
  }
});
