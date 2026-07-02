import { test, expect, Page } from '@playwright/test';

const TEST_URL = '/test/ch12-shroud-fog/edges/';
const EVIDENCE_DIR = 'E:/OpenRAWeb3D/test-results/manual/ch12-shroud-fog/edges/evidence';

// ---------------------------------------------------------------------------
// Page harness helpers
// ---------------------------------------------------------------------------

interface ShroudEdgesTestHarness {
  visibilityData: Uint8Array;
  getCellEdges(col: number, row: number): [number, number];
  computeEdges(neighbors: number[], cellState: number): number;
  presetCheckerboard(): void;
  presetIsland(): void;
  presetDiagonal(): void;
  expandVisible(): void;
  shrinkVisible(): void;
}

async function loadPreset(page: Page, name: 'checkerboard' | 'island' | 'diagonal') {
  await page.evaluate((presetName) => {
    const harness = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
    if (presetName === 'checkerboard') harness.presetCheckerboard();
    else if (presetName === 'island') harness.presetIsland();
    else if (presetName === 'diagonal') harness.presetDiagonal();
  }, name);
  await page.waitForTimeout(100);
}

async function getCounts(page: Page) {
  return page.evaluate(() => {
    const parse = (id: string) => {
      const el = document.getElementById(id);
      return el ? parseInt(el.textContent || '0', 10) : NaN;
    };
    return {
      hidden: parse('info-hidden'),
      explored: parse('info-explored'),
      visible: parse('info-visible'),
    };
  });
}

async function getCellState(page: Page, col: number, row: number): Promise<number> {
  return page.evaluate(([c, r]) => {
    const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
    return h.visibilityData[r * 12 + c];
  }, [col, row] as [number, number]);
}

async function getCellEdges(page: Page, col: number, row: number): Promise<[number, number]> {
  return page.evaluate(([c, r]) => {
    const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
    return h.getCellEdges(c, r);
  }, [col, row] as [number, number]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Shroud (Fog of War) — Edge Blending Visualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await page.waitForSelector('#renderCanvas', { state: 'visible' });
    await page.waitForFunction(() => !!(window as any).__shroudEdgesTest);
  });

  // -------------------------------------------------------------------------
  // ER2: Fully Visible Interior Has No Edges
  // -------------------------------------------------------------------------
  test('ER2a: island preset — cell (6,6) is fully interior, shroudEdges = 0', async ({ page }) => {
    await loadPreset(page, 'island');

    // Cell (6,6) is the center of the Euclidean-radius=2 visible diamond.
    // All 8 neighbors are at distance ≤2 from center, so all are VISIBLE.
    // shroudEdges should be 0 (no different-state neighbors).
    const [shroudEdges] = await getCellEdges(page, 6, 6);
    expect(shroudEdges).toBe(0x00);

    // Cell (5,6) is VISIBLE but has non-visible diagonal neighbors (TopLeft at distance >2).
    // Its shroudEdges should NOT be 0.
    const [edges56] = await getCellEdges(page, 5, 6);
    expect(edges56).not.toBe(0x00);
    // Specifically should include corner flags from EXPLORED TopLeft/BottomLeft neighbors
    expect(edges56 & 0x01).toBe(0x01); // TL from neighbor (4,5)
    expect(edges56 & 0x08).toBe(0x08); // BL from neighbor (4,7)
  });

  // -------------------------------------------------------------------------
  // ER2: Checkerboard — ALL cells have edge flags
  // -------------------------------------------------------------------------
  test('ER2b: checkerboard — every cell has all 4 diagonal corner flags', async ({ page }) => {
    await loadPreset(page, 'checkerboard');

    const cornerFlags = 0x01 | 0x02 | 0x04 | 0x08; // TL|TR|BR|BL
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        const [shroudEdges] = await getCellEdges(page, col, row);
        expect(shroudEdges & cornerFlags, `checkerboard cell (${col},${row})`).toBe(cornerFlags);
      }
    }
  });

  // -------------------------------------------------------------------------
  // ER2: Diagonal — EXPLORED band interior cells have no edges
  // -------------------------------------------------------------------------
  test('ER2c: diagonal preset — cell (6,6) in EXPLORED band has shroudEdges = 0', async ({ page }) => {
    await loadPreset(page, 'diagonal');

    // Cell (6,6): sum=12, in EXPLORED band (8≤sum<16).
    // All 8 neighbors have sum 10-14, all in EXPLORED band. Same state.
    const [shroudEdges] = await getCellEdges(page, 6, 6);
    expect(shroudEdges).toBe(0x00);

    // Verify it IS an EXPLORED cell
    const state = await getCellState(page, 6, 6);
    expect(state).toBe(1); // EXPLORED
  });

  // -------------------------------------------------------------------------
  // ER3: computeEdges bitmask correctness with 8-neighbor enumeration
  // -------------------------------------------------------------------------
  test('ER3a: computeEdges — all neighbors different = 0xFF', async ({ page }) => {
    await loadPreset(page, 'island');

    // Visible cell surrounded by all hidden neighbors → all 8 flags set
    const allSides = await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      return h.computeEdges([0, 0, 0, 0, 0, 0, 0, 0], 2);
    });
    expect(allSides).toBe(0xff);
  });

  test('ER3b: computeEdges — all neighbors same = 0x00', async ({ page }) => {
    await loadPreset(page, 'island');

    const noEdges = await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      return h.computeEdges([2, 2, 2, 2, 2, 2, 2, 2], 2);
    });
    expect(noEdges).toBe(0x00);
  });

  test('ER3c: computeEdges — only Top neighbor different', async ({ page }) => {
    await loadPreset(page, 'island');

    // order: [Top, Right, Bottom, Left, TopLeft, TopRight, BottomRight, BottomLeft]
    const result = await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      return h.computeEdges([0, 2, 2, 2, 0, 2, 2, 2], 2);
    });
    // Top different → TopSide + TopLeft + TopRight
    expect(result & 0x01).toBe(0x01); // TL
    expect(result & 0x10).toBe(0x10); // TopSide
    expect(result & 0x02).toBe(0x02); // TR
    // Should NOT set Bottom, Right, or Left side flags
    expect(result & 0x40).toBe(0);    // BottomSide
    expect(result & 0x20).toBe(0);    // RightSide
    expect(result & 0x80).toBe(0);    // LeftSide
  });

  test('ER3d: computeEdges — corner flag from side check', async ({ page }) => {
    await loadPreset(page, 'island');

    // Cell (0,0) is VISIBLE (even sum). Right neighbor (1,0) is EXPLORED (odd sum).
    // Right different → RightSide + TopRight + BottomRight all set.
    // This means BottomRight(0x04) is set even though BottomRight neighbor (1,1) is VISIBLE (same state).
    // This is CORRECT OpenRA behavior: corner flags are additive from side checks.
    const result = await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      // Simulate cell (0,0) in island mode:
      // Top=out(HIDDEN), Right=EXPLORED, Bottom=EXPLORED, Left=out(HIDDEN)
      // TL=out(HIDDEN), TR=out(HIDDEN), BR=VISIBLE, BL=out(HIDDEN)
      return h.computeEdges([0, 1, 1, 0, 0, 0, 2, 0], 2);
    });
    expect(result & 0x04).toBe(0x04); // BottomRight set via RightSide/BottomSide check
    expect(result & 0x20).toBe(0x20); // RightSide set
  });

  // -------------------------------------------------------------------------
  // ER1: Island preset renders expected visibility boundaries
  // -------------------------------------------------------------------------
  test('ER1: island preset has all 3 state types with correct boundaries', async ({ page }) => {
    await loadPreset(page, 'island');

    const counts = await getCounts(page);
    // Must have all three state types
    expect(counts.visible).toBeGreaterThan(0);
    expect(counts.explored).toBeGreaterThan(0);
    expect(counts.hidden).toBeGreaterThan(0);
    expect(counts.visible + counts.explored + counts.hidden).toBe(144);

    // Validate edge-detection boundary cells
    // The visible diamond has cells with edges (boundary) and without (interior)
    const [e66] = await getCellEdges(page, 6, 6); // interior
    expect(e66).toBe(0);

    // Edge cells should have non-zero edges
    const [e55] = await getCellEdges(page, 5, 5);
    expect(e55).not.toBe(0);

    // Screenshot for visual verification
    await page.locator('#renderCanvas').screenshot({ path: `${EVIDENCE_DIR}/er1-island-boundaries.png` });
  });

  // -------------------------------------------------------------------------
  // ER4: Dynamic Updates — Expand
  // -------------------------------------------------------------------------
  test('ER4a: expand increases visible count', async ({ page }) => {
    await loadPreset(page, 'island');

    const before = await getCounts(page);

    // Single expand promotes Explored→Visible cells adjacent to Visible cells
    await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      h.expandVisible();
    });
    await page.waitForTimeout(100);

    const after = await getCounts(page);
    expect(after.visible).toBeGreaterThan(before.visible);
    expect(after.visible + after.explored + after.hidden).toBe(144);
  });

  // -------------------------------------------------------------------------
  // ER4: Dynamic Updates — Shrink (FIXED: B1 resolved)
  // -------------------------------------------------------------------------
  test('ER4b: shrink degrades VISIBLE to EXPLORED and EXPLORED to HIDDEN', async ({ page }) => {
    await loadPreset(page, 'island');

    // Expand once so there are EXPLORED cells adjacent to VISIBLE
    await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      h.expandVisible();
    });
    await page.waitForTimeout(100);

    const before = await getCounts(page);
    expect(before.visible).toBeGreaterThan(13); // expanded from island

    // Shrink: VISIBLE cells with lower-state neighbors → EXPLORED;
    // EXPLORED cells with higher-state neighbors → HIDDEN.
    await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      h.shrinkVisible();
    });
    await page.waitForTimeout(100);

    const after = await getCounts(page);
    // VISIBLE should decrease (outer cells degraded to EXPLORED)
    expect(after.visible).toBeLessThan(before.visible);
    // HIDDEN should increase (EXPLORED→HIDDEN degradation)
    expect(after.hidden).toBeGreaterThan(before.hidden);
    // Total must remain 144
    expect(after.visible + after.explored + after.hidden).toBe(144);
  });

  // -------------------------------------------------------------------------
  // ER4: FPS in headless mode (lower threshold for headless)
  // -------------------------------------------------------------------------
  test('ER4c: FPS remains above 30 during continuous expansion (headless)', async ({ page }) => {
    await loadPreset(page, 'island');

    const fpsSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
        h.expandVisible();
      });
      await page.waitForTimeout(50);
      const fpsText = await page.locator('#info-fps').textContent();
      const fps = parseInt(fpsText || '0', 10);
      if (!isNaN(fps) && fps > 0) fpsSamples.push(fps);
    }

    expect(fpsSamples.length).toBeGreaterThan(0);
    const minFps = Math.min(...fpsSamples);
    expect(minFps, `minimum sampled FPS ${minFps}`).toBeGreaterThan(30);
  });

  // -------------------------------------------------------------------------
  // Preset coverage
  // -------------------------------------------------------------------------
  test('Info-bar counts update correctly for all presets', async ({ page }) => {
    await loadPreset(page, 'checkerboard');
    const checker = await getCounts(page);
    expect(checker.hidden + checker.explored + checker.visible).toBe(144);
    // Checkerboard uses only VISIBLE and EXPLORED (no HIDDEN)
    expect(checker.hidden).toBe(0);
    expect(checker.visible).toBe(72);
    expect(checker.explored).toBe(72);

    await loadPreset(page, 'island');
    const island = await getCounts(page);
    expect(island.visible + island.explored + island.hidden).toBe(144);
    expect(island.visible).toBeGreaterThan(0);
    expect(island.explored).toBeGreaterThan(0);
    expect(island.hidden).toBeGreaterThan(0);

    await loadPreset(page, 'diagonal');
    const diagonal = await getCounts(page);
    expect(diagonal.visible + diagonal.explored + diagonal.hidden).toBe(144);
    expect(diagonal.visible).toBeGreaterThan(0);
    expect(diagonal.hidden).toBeGreaterThan(0);
    expect(diagonal.explored).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Edge case: all hidden → checkerboard transition
  // -------------------------------------------------------------------------
  test('Edge case: all-hidden to checkerboard transition works', async ({ page }) => {
    // Set all to HIDDEN via harness
    await page.evaluate(() => {
      const h = (window as any).__shroudEdgesTest as ShroudEdgesTestHarness;
      for (let i = 0; i < 144; i++) h.visibilityData[i] = 0;
    });
    await page.waitForTimeout(50);

    // Verify all hidden
    let counts = await getCounts(page);
    expect(counts.hidden).toBe(144);

    // Switch to checkerboard
    await loadPreset(page, 'checkerboard');
    counts = await getCounts(page);
    expect(counts.hidden).toBe(0);
    expect(counts.visible).toBe(72);
    expect(counts.explored).toBe(72);
  });

  // -------------------------------------------------------------------------
  // Edge case: extreme viewpoint (verify no crash)
  // -------------------------------------------------------------------------
  test('Edge case: page does not crash and counts remain valid after rapid preset switching', async ({ page }) => {
    const presets: Array<'checkerboard' | 'island' | 'diagonal'> = [
      'checkerboard', 'island', 'diagonal', 'checkerboard', 'island',
    ];
    for (const preset of presets) {
      await loadPreset(page, preset);
      const counts = await getCounts(page);
      expect(counts.visible + counts.explored + counts.hidden).toBe(144);
    }
  });

  // -------------------------------------------------------------------------
  // Visual screenshots for Kimi verification
  // -------------------------------------------------------------------------
  test('Visual: screenshots capture boundary gradients for each preset', async ({ page }) => {
    const presets: Array<'checkerboard' | 'island' | 'diagonal'> = ['checkerboard', 'island', 'diagonal'];
    for (const preset of presets) {
      await loadPreset(page, preset);
      await page.locator('#renderCanvas').screenshot({
        path: `${EVIDENCE_DIR}/edges-${preset}.png`,
      });
      const counts = await getCounts(page);
      expect(counts.visible + counts.explored + counts.hidden).toBe(144);
    }
  });
});
