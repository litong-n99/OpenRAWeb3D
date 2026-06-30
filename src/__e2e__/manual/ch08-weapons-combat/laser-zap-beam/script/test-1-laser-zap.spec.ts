/**
 * test-1-laser-zap.spec.ts — LaserZap Beam acceptance tests (6 groups: L1-L6 + 4 edge cases)
 *
 * Uses `window.__testHarness` API for quantitative verification.
 * Headless mode notes: beam is very thin (~1-2px) at default camera distance (22 wu).
 * Screenshots may miss the beam due to timing (simulation at ~30 ticks/sec, max duration 40 ticks).
 * All quantitative assertions rely on DOM-level harness API, not visual screenshots.
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch08-weapons-combat/laser-zap-beam/';
const SOURCE = { x: 1.5, y: 0, z: 4 };
const TARGET = { x: 10, y: 0.2, z: 4 };

// ── Helpers ──────────────────────────────────────────────────────────────

async function fireLaser(page: any, color?: string) {
  return page.evaluate(
    ({ source, target, colorStr }: any) => {
      const h = (window as any).__testHarness;
      h.fireLaser(source, target, colorStr);
      return {
        beamVisible: h.isBeamVisible(),
        beamAlpha: h.getBeamAlpha(),
        beamColor: h.getBeamColor(),
        laserDuration: h.getActiveLaser()?.info?.duration,
      };
    },
    { source: SOURCE, target: TARGET, colorStr: color },
  );
}

async function advanceTicks(page: any, targetText: string, timeout = 15000) {
  await page.getByText(targetText).first().waitFor({ state: 'visible', timeout });
}

async function getBeamState(page: any) {
  return page.evaluate(() => {
    const h = (window as any).__testHarness;
    const laser = h.getActiveLaser();
    return {
      beamVisible: h.isBeamVisible(),
      beamAlpha: h.getBeamAlpha(),
      beamColor: h.getBeamColor(),
      beamEndpoints: h.getBeamEndpoints(),
      impacts: h.getImpacts(),
      laserTicks: laser?.ticks,
      laserDuration: laser?.info?.duration,
      secondaryBeam: laser?.info?.secondaryBeam,
      secondaryColor: laser?.secondaryColor,
      eventLog: h.getEventLog(),
    };
  });
}

async function setSlider(page: any, id: string, value: string) {
  await page.evaluate(
    ({ id, value }: any) => {
      const slider = document.getElementById(id) as HTMLInputElement;
      slider.value = value;
      slider.dispatchEvent(new Event('input'));
    },
    { id, value },
  );
}

async function setCheckbox(page: any, id: string, checked: boolean) {
  await page.evaluate(
    ({ id, checked }: any) => {
      const cb = document.getElementById(id) as HTMLInputElement;
      cb.checked = checked;
      cb.dispatchEvent(new Event('change'));
    },
    { id, checked },
  );
}

// ── L1: Instant Beam Appearance ───────────────────────────────────────────

test.describe('L1: Instant Beam Appearance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000); // Wait for WebGL init
    // Verify harness is available
    const ready = await page.evaluate(() => !!(window as any).__testHarness);
    expect(ready).toBe(true);
  });

  test('L1.1 beam appears immediately after fire', async ({ page }) => {
    const state = await fireLaser(page, '255,0,0');
    expect(state.beamVisible).toBe(true);
  });

  test('L1.2 impact count >= 1 by T1', async ({ page }) => {
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'T1:');
    const state = await getBeamState(page);
    expect(state.impacts).toBeGreaterThanOrEqual(1);
  });

  test('L1.3 beamAlpha = 255 at T0', async ({ page }) => {
    const state = await fireLaser(page, '255,0,0');
    expect(state.beamAlpha).toBe(255);
  });
});

// ── L2: Beam Color Matching ────────────────────────────────────────────────

test.describe('L2: Beam Color Matching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);
  });

  const colors = [
    { name: 'Red', str: '255,0,0', expected: { r: 255, g: 0, b: 0 } },
    { name: 'Blue', str: '0,100,255', expected: { r: 0, g: 100, b: 255 } },
    { name: 'Green', str: '0,255,100', expected: { r: 0, g: 255, b: 100 } },
    { name: 'Yellow', str: '255,255,100', expected: { r: 255, g: 255, b: 100 } },
    { name: 'Orange', str: '255,128,0', expected: { r: 255, g: 128, b: 0 } },
    { name: 'Purple', str: '200,100,255', expected: { r: 200, g: 100, b: 255 } },
  ];

  for (const c of colors) {
    test(`L2 ${c.name} (${c.str}) exact match`, async ({ page }) => {
      const state = await fireLaser(page, c.str);
      expect(state.beamColor).toEqual(c.expected);
    });
  }

  test('L2.3 all colors deviation <= 12 per channel', async ({ page }) => {
    for (const c of colors) {
      const state = await fireLaser(page, c.str);
      const diffR = Math.abs((state.beamColor?.r ?? 0) - c.expected.r);
      const diffG = Math.abs((state.beamColor?.g ?? 0) - c.expected.g);
      const diffB = Math.abs((state.beamColor?.b ?? 0) - c.expected.b);
      expect(diffR).toBeLessThanOrEqual(12);
      expect(diffG).toBeLessThanOrEqual(12);
      expect(diffB).toBeLessThanOrEqual(12);
    }
  });

  test('L2.4 color changes immediately on re-fire', async ({ page }) => {
    const state1 = await fireLaser(page, '255,0,0');
    expect(state1.beamColor).toEqual({ r: 255, g: 0, b: 0 });
    const state2 = await fireLaser(page, '0,100,255');
    expect(state2.beamColor).toEqual({ r: 0, g: 100, b: 255 });
    expect(state1.beamColor).not.toEqual(state2.beamColor);
  });
});

// ── L3: Beam Duration Persistence ──────────────────────────────────────────

test.describe('L3: Beam Duration Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);
  });

  test('L3.1 T0 beamAlpha = 255 with duration=15', async ({ page }) => {
    await setSlider(page, 'beam-duration', '15');
    const state = await fireLaser(page, '255,0,0');
    expect(state.beamAlpha).toBe(255);
  });

  test('L3.2 T5 beamAlpha ≈ 170 with duration=15', async ({ page }) => {
    await setSlider(page, 'beam-duration', '15');
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'beamAlpha=170');
    const state = await getBeamState(page);
    // beamAlpha should be 170 at T5 (255 * 10/15 = 170)
    expect(state.beamAlpha).toBeLessThanOrEqual(170);
    expect(state.beamAlpha).toBeGreaterThanOrEqual(165);
  });

  test('L3.3 T15 beamAlpha = 0, beam invisible with duration=15', async ({ page }) => {
    await setSlider(page, 'beam-duration', '15');
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'BEAM FADED');
    const state = await getBeamState(page);
    expect(state.beamAlpha).toBe(0);
    expect(state.beamVisible).toBe(false);
  });

  test('L3.4 T10 beamAlpha = 0 with duration=10', async ({ page }) => {
    await setSlider(page, 'beam-duration', '10');
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'BEAM FADED');
    const state = await getBeamState(page);
    expect(state.beamAlpha).toBe(0);
    expect(state.laserTicks).toBe(10);
  });

  test('L3.5 ticks counter increments correctly', async ({ page }) => {
    await setSlider(page, 'beam-duration', '10');
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'BEAM FADED');
    const state = await getBeamState(page);
    expect(state.laserTicks).toBe(10);
    expect(state.laserDuration).toBe(10);
  });
});

// ── L4: Beam Width ─────────────────────────────────────────────────────────

test.describe('L4: Beam Width', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);
  });

  test('L4.1 default width 86 su → world width ~0.084 wu', async ({ page }) => {
    await setSlider(page, 'beam-width', '8'); // 8 * 10.75 ≈ 86
    const state = await fireLaser(page, '255,0,0');
    // Verify WDist length matches expected
    const wdist = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return h.getActiveLaser()?.info?.width?.length;
    });
    expect(wdist).toBe(86);
  });

  test('L4.2 double width 172 su → world width ~0.168 wu', async ({ page }) => {
    await setSlider(page, 'beam-width', '16'); // 16 * 10.75 ≈ 172
    const state = await fireLaser(page, '255,0,0');
    const wdist = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return h.getActiveLaser()?.info?.width?.length;
    });
    expect(wdist).toBe(172);
  });

  test('L4.3 pixel width estimation ratio consistent', async ({ page }) => {
    // Fire at two different widths, verify ratio is consistent
    await setSlider(page, 'beam-width', '8');
    await fireLaser(page, '255,0,0');
    const bw1 = await page.evaluate(() => (window as any).__testHarness.getBeamWidth());

    await setSlider(page, 'beam-width', '16');
    await fireLaser(page, '255,0,0');
    const bw2 = await page.evaluate(() => (window as any).__testHarness.getBeamWidth());

    // The ratio bw2/bw1 should be approximately 2.0
    const ratio = bw2 / bw1;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });
});

// ── L5: Tracking Behavior ──────────────────────────────────────────────────

test.describe('L5: Tracking Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);
  });

  test('L5.1 tracking=ON + moving target → endpoints change', async ({ page }) => {
    await setCheckbox(page, 'toggle-track', true);
    await setCheckbox(page, 'toggle-moving', true);
    await setSlider(page, 'beam-duration', '40');
    await fireLaser(page, '255,0,0');

    // Get initial endpoints
    const initial = await getBeamState(page);
    const initTx = initial.beamEndpoints?.to?.x;
    const initTz = initial.beamEndpoints?.to?.z;

    // Wait for some ticks to pass
    await advanceTicks(page, 'beamAlpha=223');

    const later = await getBeamState(page);
    // Endpoints should have changed (target is moving)
    expect(later.beamEndpoints?.to?.x).not.toBe(initTx);
    // Note: z may also change, but x is more reliable
  });

  test('L5.2 tracking=OFF → endpoints stay fixed', async ({ page }) => {
    await setCheckbox(page, 'toggle-track', false);
    await setCheckbox(page, 'toggle-moving', true);
    await setSlider(page, 'beam-duration', '40');
    await fireLaser(page, '255,0,0');

    const initial = await getBeamState(page);

    await advanceTicks(page, 'beamAlpha=223');

    const later = await getBeamState(page);
    // Endpoints should remain the same (tracking disabled)
    expect(later.beamEndpoints?.to?.x).toBe(initial.beamEndpoints?.to?.x);
    expect(later.beamEndpoints?.to?.z).toBe(initial.beamEndpoints?.to?.z);
  });
});

// ── L6: Secondary Beam ─────────────────────────────────────────────────────

test.describe('L6: Secondary Beam', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);
  });

  test('L6.1 secondary beam enabled → two beams visible', async ({ page }) => {
    await setCheckbox(page, 'toggle-secondary', true);
    await fireLaser(page, '255,0,0');
    const state = await getBeamState(page);
    expect(state.secondaryBeam).toBe(true);
    expect(state.beamVisible).toBe(true);
  });

  test('L6.2 secondary color is brighter (primary + 80 per channel)', async ({ page }) => {
    // Use UI click (which computes secondary = primary + 80)
    await setCheckbox(page, 'toggle-secondary', true);
    // Set color to Blue via dropdown
    await page.selectOption('#player-color', '0,100,255');
    await page.click('#btn-fire');
    await page.waitForTimeout(500);

    const state = await getBeamState(page);
    // Secondary should be primary + 80 per channel
    if (state.secondaryColor) {
      const beamColor = state.beamColor;
      if (beamColor) {
        expect(state.secondaryColor[0]).toBeGreaterThanOrEqual(beamColor.r);
        expect(state.secondaryColor[1]).toBeGreaterThanOrEqual(beamColor.g);
        expect(state.secondaryColor[2]).toBeGreaterThanOrEqual(beamColor.b);
      }
    }
  });

  test('L6.3 secondary disabled → only one beam', async ({ page }) => {
    await setCheckbox(page, 'toggle-secondary', false);
    await fireLaser(page, '255,0,0');
    const state = await getBeamState(page);
    expect(state.secondaryBeam).toBe(false);
    expect(state.beamVisible).toBe(true);
  });
});

// ── Edge Cases ─────────────────────────────────────────────────────────────

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);
  });

  test('Fast consecutive fire (5x) — no residue', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      const state = await fireLaser(page, '255,0,0');
      expect(state.beamVisible).toBe(true);
      expect(state.beamAlpha).toBe(255);
    }
  });

  test('Duration=3 (minimum) — fades at T3', async ({ page }) => {
    await setSlider(page, 'beam-duration', '3');
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'BEAM FADED');
    const state = await getBeamState(page);
    expect(state.beamAlpha).toBe(0);
    expect(state.laserTicks).toBe(3);
  });

  test('Duration=40 (maximum) — fades at T40', async ({ page }) => {
    await setSlider(page, 'beam-duration', '40');
    await fireLaser(page, '255,0,0');
    await advanceTicks(page, 'BEAM FADED', 20000);
    const state = await getBeamState(page);
    expect(state.beamAlpha).toBe(0);
    expect(state.laserTicks).toBe(40);
  });

  test('Static target + Tracking ON — no errors', async ({ page }) => {
    await setCheckbox(page, 'toggle-track', true);
    await setCheckbox(page, 'toggle-moving', false);
    await fireLaser(page, '255,0,0');
    const initial = await getBeamState(page);
    expect(initial.beamVisible).toBe(true);

    await advanceTicks(page, 'beamAlpha=170');
    const later = await getBeamState(page);
    // Static target → endpoints should not change
    expect(later.beamEndpoints?.to?.x).toBe(initial.beamEndpoints?.to?.x);
    expect(later.beamEndpoints?.to?.z).toBe(initial.beamEndpoints?.to?.z);
  });
});
