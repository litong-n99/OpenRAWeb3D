/**
 * Playwright E2E Tests — RevealsMap (Full Map Reveal)
 *
 * Target: /test/ch12-shroud-fog/reveal-map/
 * Module: RevealsMap — when enabled, all cells become Explored (dim gray fog).
 *                  When disabled, restores the previous visibility state.
 *
 * Acceptance criteria covered (from README.md):
 *   ER1. RevealMap OFF — map shows actual exploration state
 *   ER2. RevealMap ON  — entire map becomes Explored
 *   ER3. RevealMap OFF after ON — restores previous state
 *   ER4. Multiple toggle consistency
 *   ER5. effectiveState correctness
 *
 * Verification steps covered:
 *   1. Initial state: all Hidden
 *   2. Explore corners: 4 corner 3x3 regions
 *   3. RevealMap ON: all cells Explored
 *   4. RevealMap OFF: restore corners state
 *   5. Toggle + explore center: center + corners preserved
 *   6. Explore strip + toggle 3x: state preserved, counts consistent
 *   Boundary A: Reset all → toggle ON → OFF → all Hidden
 *   Boundary B: RevealMap ON → explore corners → OFF → corners show
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = '/test/ch12-shroud-fog/reveal-map/';
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/manual/ch12-shroud-fog/reveal-map',
  'evidence'
);

const TOTAL_CELLS = 100;
const HIDDEN = 0;
const EXPLORED = 1;
const VISIBLE = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function waitForEngineReady(page: Page): Promise<void> {
  await expect(page.locator('#info-engine'), 'engine info should be WebGL 2.0').toHaveText('WebGL 2.0', {
    timeout: 20000,
  });
  await expect(page.locator('#renderCanvas'), 'render canvas should be attached').toBeAttached({ timeout: 20000 });
}

async function clickButton(page: Page, id: string): Promise<void> {
  await page.locator(`#${id}`).click();
  // Give the Babylon.js render loop a moment to reflect state changes.
  await page.waitForTimeout(150);
}

interface Counts {
  hidden: number;
  explored: number;
  visible: number;
}

async function getInfoCounts(page: Page): Promise<Counts> {
  const hidden = await page.locator('#info-hidden').textContent();
  const explored = await page.locator('#info-explored').textContent();
  const visible = await page.locator('#info-visible').textContent();
  return {
    hidden: parseInt(hidden || '0', 10),
    explored: parseInt(explored || '0', 10),
    visible: parseInt(visible || '0', 10),
  };
}

interface StateExplored {
  current: number;
  total: number;
  previous: number;
  raw: string;
}

async function getStateExplored(page: Page): Promise<StateExplored> {
  const text = (await page.locator('#state-explored').textContent()) || '';
  const match = text.match(/(\d+)\s*\/\s*(\d+)\s*\(先前:\s*(\d+)\)/);
  return {
    current: parseInt(match?.[1] || '0', 10),
    total: parseInt(match?.[2] || '100', 10),
    previous: parseInt(match?.[3] || '0', 10),
    raw: text,
  };
}

async function getBaseStateCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const base = (window as any).__revealMapTest.baseState as Uint8Array;
    let hidden = 0;
    let explored = 0;
    let visible = 0;
    for (let i = 0; i < base.length; i++) {
      switch (base[i]) {
        case 0:
          hidden++;
          break;
        case 1:
          explored++;
          break;
        case 2:
          visible++;
          break;
      }
    }
    return { hidden, explored, visible };
  });
}

async function getEffectiveStateCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const harness = (window as any).__revealMapTest;
    let hidden = 0;
    let explored = 0;
    let visible = 0;
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        switch (harness.effectiveState(col, row)) {
          case 0:
            hidden++;
            break;
          case 1:
            explored++;
            break;
          case 2:
            visible++;
            break;
        }
      }
    }
    return { hidden, explored, visible };
  });
}

async function assertRevealStateEnabled(page: Page, enabled: boolean): Promise<void> {
  const btn = page.locator('#btn-reveal');
  const stateEl = page.locator('#state-reveal');
  if (enabled) {
    await expect(btn).toHaveClass(/toggle-on/);
    await expect(btn).toHaveText('Reveal Map (关闭)');
    await expect(stateEl).toHaveClass(/enabled/);
    await expect(stateEl).toHaveText('Enabled (全图Explored)');
  } else {
    await expect(btn).toHaveClass(/toggle-off/);
    await expect(btn).toHaveText('Reveal Map (开启)');
    await expect(stateEl).toHaveClass(/disabled/);
    await expect(stateEl).toHaveText('Disabled');
  }
}

async function assertCornersExplored(page: Page, expectCenterVisible: boolean): Promise<void> {
  const errors = await page.evaluate((expectCenterVisible) => {
    const harness = (window as any).__revealMapTest;
    const regions = [
      { c: 0, r: 0 },
      { c: 7, r: 0 },
      { c: 0, r: 7 },
      { c: 7, r: 7 },
    ];
    const errs: string[] = [];
    for (const reg of regions) {
      for (let row = reg.r; row < reg.r + 3; row++) {
        for (let col = reg.c; col < reg.c + 3; col++) {
          const state = harness.effectiveState(col, row);
          const isCenter = col === reg.c + 1 && row === reg.r + 1;
          if (isCenter) {
            const expected = expectCenterVisible ? 2 : 1;
            if (state !== expected) {
              errs.push(`corner center (${col},${row}) expected ${expected}, got ${state}`);
            }
          } else if (state !== 1) {
            errs.push(`corner cell (${col},${row}) expected EXPLORED, got ${state}`);
          }
        }
      }
    }
    return errs;
  }, expectCenterVisible);
  expect(errors, `corner region mismatch: ${errors.join('; ')}`).toHaveLength(0);
}

async function assertCenterRegion(page: Page, expectVisibleCore: boolean): Promise<void> {
  const errors = await page.evaluate((expectVisibleCore) => {
    const harness = (window as any).__revealMapTest;
    const errs: string[] = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const dx = col - 4.5;
        const dy = row - 4.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const state = harness.effectiveState(col, row);
        if (dist <= 2) {
          const expected = expectVisibleCore ? 2 : 1;
          if (state !== expected) {
            errs.push(`center core (${col},${row}) expected ${expected}, got ${state}`);
          }
        } else if (dist <= 3) {
          if (state !== 1) {
            errs.push(`center ring (${col},${row}) expected EXPLORED, got ${state}`);
          }
        }
      }
    }
    return errs;
  }, expectVisibleCore);
  expect(errors, `center region mismatch: ${errors.join('; ')}`).toHaveLength(0);
}

async function assertStripRegion(page: Page, expectVisibleCore: boolean): Promise<void> {
  const errors = await page.evaluate((expectVisibleCore) => {
    const harness = (window as any).__revealMapTest;
    const errs: string[] = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const state = harness.effectiveState(col, row);
        if (row >= 3 && row <= 6) {
          const expected = expectVisibleCore ? 2 : 1;
          if (state !== expected) {
            errs.push(`strip visible (${col},${row}) expected ${expected}, got ${state}`);
          }
        } else if (row === 2 || row === 7) {
          if (state !== 1) {
            errs.push(`strip explored (${col},${row}) expected EXPLORED, got ${state}`);
          }
        }
      }
    }
    return errs;
  }, expectVisibleCore);
  expect(errors, `strip region mismatch: ${errors.join('; ')}`).toHaveLength(0);
}

interface UnitRenderState {
  name: string;
  gridCol: number;
  gridRow: number;
  liveVisible: boolean;
  frozenVisible: boolean;
  frozenAlpha: number | undefined;
}

async function getUnitRenderState(page: Page): Promise<UnitRenderState[]> {
  return page.evaluate(() => {
    const harness = (window as any).__revealMapTest;
    return harness.units.map((u: any) => ({
      name: u.name,
      gridCol: u.gridCol,
      gridRow: u.gridRow,
      liveVisible: u.mesh.isVisible,
      frozenVisible: u.frozenClone?.isVisible ?? false,
      frozenAlpha: u.frozenClone?.material?.alpha,
    }));
  });
}

async function assertUnitsFrozenGray(page: Page): Promise<void> {
  const units = await getUnitRenderState(page);
  expect(units).toHaveLength(2);
  for (const u of units) {
    expect(u.liveVisible, `${u.name} live mesh should be hidden in fog`).toBe(false);
    expect(u.frozenVisible, `${u.name} frozen clone should be visible in fog`).toBe(true);
    expect(u.frozenAlpha, `${u.name} frozen alpha`).toBeCloseTo(0.5, 1);
  }
}

async function assertUnitsHidden(page: Page): Promise<void> {
  const units = await getUnitRenderState(page);
  for (const u of units) {
    expect(u.liveVisible, `${u.name} live mesh should be hidden`).toBe(false);
    expect(u.frozenVisible, `${u.name} frozen clone should be hidden`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.describe('RevealsMap (Full Map Reveal) Acceptance Test', () => {
  let page: Page;
  let recordedCorners: Counts;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(PAGE_URL);
    await waitForEngineReady(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // -------------------------------------------------------------------------
  // Step 1: Initial state — all Hidden
  // -------------------------------------------------------------------------
  test('Step 1: Initial state — all Hidden, RevealMap Disabled', async () => {
    test.setTimeout(60000);

    await assertRevealStateEnabled(page, false);

    const info = await getInfoCounts(page);
    expect(info.hidden).toBe(TOTAL_CELLS);
    expect(info.explored).toBe(0);
    expect(info.visible).toBe(0);

    const state = await getStateExplored(page);
    expect(state.current).toBe(0);
    expect(state.previous).toBe(0);

    const effective = await getEffectiveStateCounts(page);
    expect(effective).toEqual({ hidden: 100, explored: 0, visible: 0 });

    const revealOn = await page.evaluate(() => (window as any).__revealMapTest.revealMapOn);
    expect(revealOn).toBe(false);

    await assertUnitsHidden(page);
    await attachScreenshot(page, 'screenshot-step1-initial-hidden.png');
  });

  // -------------------------------------------------------------------------
  // Step 2: Explore corners
  // -------------------------------------------------------------------------
  test('Step 2: Explore corners — four 3x3 corner regions with visible centers', async () => {
    test.setTimeout(60000);

    await clickButton(page, 'btn-explore-corners');

    await assertRevealStateEnabled(page, false);
    await assertCornersExplored(page, true);

    const info = await getInfoCounts(page);
    // 4 corners * 9 cells = 36 touched; 4 center cells are VISIBLE, rest EXPLORED.
    expect(info.hidden).toBe(64);
    expect(info.explored).toBe(32);
    expect(info.visible).toBe(4);
    recordedCorners = { ...info };

    const state = await getStateExplored(page);
    expect(state.current).toBe(36); // baseState >= EXPLORED
    expect(state.previous).toBe(0); // RevealMap has not been enabled yet

    const base = await getBaseStateCounts(page);
    expect(base).toEqual({ hidden: 64, explored: 32, visible: 4 });

    await attachScreenshot(page, 'screenshot-step2-corners-explored.png');
  });

  // -------------------------------------------------------------------------
  // Step 3: RevealMap ON
  // -------------------------------------------------------------------------
  test('Step 3: RevealMap ON — all cells become Explored, units frozen', async () => {
    test.setTimeout(60000);

    await clickButton(page, 'btn-reveal');

    await assertRevealStateEnabled(page, true);

    const info = await getInfoCounts(page);
    expect(info.hidden).toBe(0);
    expect(info.explored).toBe(TOTAL_CELLS);
    expect(info.visible).toBe(0);

    const effective = await getEffectiveStateCounts(page);
    expect(effective).toEqual({ hidden: 0, explored: 100, visible: 0 });

    // baseState itself should NOT have been mutated by enabling RevealMap.
    const base = await getBaseStateCounts(page);
    expect(base).toEqual({ hidden: 64, explored: 32, visible: 4 });

    // State panel records the previously explored count saved at enable time.
    const state = await getStateExplored(page);
    expect(state.current).toBe(36);
    expect(state.previous).toBe(36);

    // ER5: effectiveState returns EXPLORED even for a Hidden base cell.
    const effective55 = await page.evaluate(() => (window as any).__revealMapTest.effectiveState(5, 5));
    expect(effective55).toBe(EXPLORED);
    const base55 = await page.evaluate(() => (window as any).__revealMapTest.baseState[55]);
    expect(base55).toBe(HIDDEN);

    await assertUnitsFrozenGray(page);
    await attachScreenshot(page, 'screenshot-step3-reveal-on.png');
  });

  // -------------------------------------------------------------------------
  // Step 4: RevealMap OFF — restore previous state
  // -------------------------------------------------------------------------
  test('Step 4: RevealMap OFF — restores corner exploration state exactly', async () => {
    test.setTimeout(60000);

    await clickButton(page, 'btn-reveal');

    await assertRevealStateEnabled(page, false);
    await assertCornersExplored(page, true);

    const info = await getInfoCounts(page);
    expect(info).toEqual(recordedCorners);

    const state = await getStateExplored(page);
    expect(state.current).toBe(36);
    expect(state.previous).toBe(36);

    // ER5: effectiveState now returns baseState for cell (5,5).
    const effective55 = await page.evaluate(() => (window as any).__revealMapTest.effectiveState(5, 5));
    expect(effective55).toBe(HIDDEN);

    await assertUnitsHidden(page);
    await attachScreenshot(page, 'screenshot-step4-reveal-off-restored.png');
  });

  // -------------------------------------------------------------------------
  // Step 5: Toggle + explore center
  // -------------------------------------------------------------------------
  test('Step 5: Toggle RevealMap and explore center — both regions preserved', async () => {
    test.setTimeout(60000);

    // ON → OFF (re-saves current corner state).
    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, true);
    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, false);
    await assertCornersExplored(page, true);

    // Add center region.
    await clickButton(page, 'btn-explore-center');
    await assertRevealStateEnabled(page, false);
    await assertCenterRegion(page, true);
    // Corners should still be present (center does not overwrite them entirely).
    await assertCornersExplored(page, true);

    const beforeToggle = await getInfoCounts(page);
    const beforeState = await getStateExplored(page);

    // Toggle ON then OFF.
    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, true);
    const onInfo = await getInfoCounts(page);
    expect(onInfo).toEqual({ hidden: 0, explored: 100, visible: 0 });
    await attachScreenshot(page, 'screenshot-step5-reveal-on-center.png');

    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, false);

    // Both center and corners restored.
    await assertCenterRegion(page, true);
    await assertCornersExplored(page, true);

    const afterToggle = await getInfoCounts(page);
    expect(afterToggle).toEqual(beforeToggle);

    const afterState = await getStateExplored(page);
    expect(afterState.current).toBe(beforeState.current);
    expect(afterState.previous).toBe(beforeState.current);

    await attachScreenshot(page, 'screenshot-step5-reveal-off-center-restored.png');
  });

  // -------------------------------------------------------------------------
  // Step 6: Explore strip + toggle 3x consistency
  // -------------------------------------------------------------------------
  test('Step 6: Explore strip and toggle 3x — regions and counts stay consistent', async () => {
    test.setTimeout(60000);

    await clickButton(page, 'btn-explore-strip');
    await assertRevealStateEnabled(page, false);
    await assertStripRegion(page, true);

    // The strip is applied on top of any previously explored regions (corners,
    // center).  Record the actual counts and verify consistency across toggles.
    const stripInfo = await getInfoCounts(page);
    expect(stripInfo.hidden + stripInfo.explored + stripInfo.visible).toBe(TOTAL_CELLS);
    expect(stripInfo.visible).toBeGreaterThan(0);
    expect(stripInfo.explored).toBeGreaterThan(0);

    const stripBase = await getBaseStateCounts(page);
    expect(stripBase).toEqual(stripInfo);

    const stripState = await getStateExplored(page);
    expect(stripState.current).toBe(stripInfo.explored + stripInfo.visible);

    await attachScreenshot(page, 'screenshot-step6-strip-explored.png');

    // Toggle ON → OFF three times; each OFF should restore the same recorded state.
    for (let i = 1; i <= 3; i++) {
      await clickButton(page, 'btn-reveal');
      await assertRevealStateEnabled(page, true);
      const onInfo = await getInfoCounts(page);
      expect(onInfo, `cycle ${i} ON`).toEqual({ hidden: 0, explored: 100, visible: 0 });

      const onState = await getStateExplored(page);
      expect(onState.current, `cycle ${i} ON current`).toBe(stripState.current);
      expect(onState.previous, `cycle ${i} ON previous`).toBe(stripState.current);

      await clickButton(page, 'btn-reveal');
      await assertRevealStateEnabled(page, false);
      await assertStripRegion(page, true);

      const offInfo = await getInfoCounts(page);
      expect(offInfo, `cycle ${i} OFF`).toEqual(stripInfo);

      const offState = await getStateExplored(page);
      expect(offState.current, `cycle ${i} OFF current`).toBe(stripState.current);
      expect(offState.previous, `cycle ${i} OFF previous`).toBe(stripState.current);
    }

    await attachScreenshot(page, 'screenshot-step6-strip-after-3-toggles.png');
  });

  // -------------------------------------------------------------------------
  // Boundary A: Reset all → toggle ON → OFF → all Hidden
  // -------------------------------------------------------------------------
  test('Boundary A: Reset all then toggle ON/OFF returns to all Hidden', async () => {
    test.setTimeout(60000);

    await clickButton(page, 'btn-reset-all');
    await assertRevealStateEnabled(page, false);

    const afterReset = await getInfoCounts(page);
    expect(afterReset).toEqual({ hidden: 100, explored: 0, visible: 0 });

    const resetState = await getStateExplored(page);
    expect(resetState.current).toBe(0);

    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, true);
    expect(await getInfoCounts(page)).toEqual({ hidden: 0, explored: 100, visible: 0 });
    await assertUnitsFrozenGray(page);

    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, false);

    const final = await getInfoCounts(page);
    expect(final).toEqual({ hidden: 100, explored: 0, visible: 0 });

    const finalState = await getStateExplored(page);
    expect(finalState.current).toBe(0);
    expect(finalState.previous).toBe(0);

    await assertUnitsHidden(page);
    await attachScreenshot(page, 'screenshot-boundarya-reset-toggle-hidden.png');
  });

  // -------------------------------------------------------------------------
  // Boundary B: RevealMap ON → explore corners → OFF → corners show
  // -------------------------------------------------------------------------
  test('Boundary B: Exploring while RevealMap ON updates baseState and restores correctly', async () => {
    test.setTimeout(60000);

    // Ensure clean Hidden start.
    await clickButton(page, 'btn-reset-all');
    await assertRevealStateEnabled(page, false);

    // Enable RevealMap (saves empty previouslyExplored).
    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, true);

    // Explore corners while RevealMap is active.
    await clickButton(page, 'btn-explore-corners');

    // Effective state is still all Explored because RevealMap is ON.
    expect(await getEffectiveStateCounts(page)).toEqual({ hidden: 0, explored: 100, visible: 0 });
    await assertUnitsFrozenGray(page);

    // But baseState was updated underneath.
    const base = await getBaseStateCounts(page);
    expect(base).toEqual({ hidden: 64, explored: 32, visible: 4 });

    // Disable RevealMap — corners should now appear.
    await clickButton(page, 'btn-reveal');
    await assertRevealStateEnabled(page, false);
    await assertCornersExplored(page, true);

    const info = await getInfoCounts(page);
    expect(info).toEqual({ hidden: 64, explored: 32, visible: 4 });

    // previouslyExplored was captured as empty at enable time.
    const state = await getStateExplored(page);
    expect(state.current).toBe(36);
    expect(state.previous).toBe(0);

    await attachScreenshot(page, 'screenshot-boundaryb-explore-while-on.png');
  });
});
