/**
 * Acceptance test: FrozenUnderFog — 冻结 actor 可见性
 * Page: http://localhost:5173/test/ch12-shroud-fog/frozen/
 *
 * Verifies 5 expected results from README.md:
 *   1. Frozen rendering in fog (alpha=0.5, gray/desaturated, no specular)
 *   2. Visible area real-time rendering (alpha=1.0, full color)
 *   3. Instant state switching (no double rendering, FPS stable)
 *   4. Hidden area completely invisible
 *   5. Independent tracking per building
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch12-shroud-fog/frozen/';

// Wait for Babylon.js WebGL engine to initialize
async function waitForEngine(page: any) {
  await page.waitForFunction(() => {
    const el = document.getElementById('info-engine');
    return el && el.textContent === 'WebGL 2.0';
  }, { timeout: 15000 });
}

// Get status text for a building
async function getBuildingStatus(page: any, name: string): Promise<string> {
  return (await page.locator(`#status-${name}`).textContent()) || '';
}

// Get info bar metric
async function getInfoMetric(page: any, id: string): Promise<string> {
  return (await page.locator(`#info-${id}`).textContent()) || '';
}

// Click a button by id
async function clickButton(page: any, id: string) {
  await page.locator(`#${id}`).click();
  // Small wait for Babylon.js render loop to update
  await page.waitForTimeout(300);
}

test.describe('FrozenUnderFog Acceptance Test', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await waitForEngine(page);
  });

  // -------------------------------------------------------------------------
  // Expected Result 1: Frozen rendering in fog
  // -------------------------------------------------------------------------
  test('ER1: Frozen buildings render with alpha=0.5, gray/desaturated, no specular', async ({ page }) => {
    // Switch to All Fog
    await clickButton(page, 'btn-all-fog');

    // Verify status panel shows Frozen for all 4 buildings
    for (const name of ['a1', 'b1', 'c1', 'd1']) {
      const status = await getBuildingStatus(page, name);
      expect(status).toContain('Frozen');
      expect(status).toContain('alpha=0.5');
      expect(status).toContain('desat');
    }

    // Verify mesh-level properties via harness
    const meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => {
        const fm = b.frozenClone?.material;
        return {
          name: b.name,
          liveVisible: b.mesh.isVisible,
          frozenVisible: b.frozenClone?.isVisible,
          frozenAlpha: fm?.alpha,
          frozenColorR: fm?.diffuseColor?.r,
          frozenColorG: fm?.diffuseColor?.g,
          frozenColorB: fm?.diffuseColor?.b,
          frozenSpecularR: fm?.specularColor?.r,
          frozenSpecularG: fm?.specularColor?.g,
          frozenSpecularB: fm?.specularColor?.b,
        };
      });
    });

    for (const b of meshData) {
      // Live mesh must be hidden
      expect(b.liveVisible).toBe(false);
      // Frozen clone must be visible
      expect(b.frozenVisible).toBe(true);
      // Frozen alpha = 0.5
      expect(b.frozenAlpha).toBeCloseTo(0.5, 1);
      // Frozen color = gray (0.35, 0.35, 0.35)
      expect(b.frozenColorR).toBeCloseTo(0.35, 1);
      expect(b.frozenColorG).toBeCloseTo(0.35, 1);
      expect(b.frozenColorB).toBeCloseTo(0.35, 1);
      // Frozen specular = black (0, 0, 0)
      expect(b.frozenSpecularR).toBeCloseTo(0, 1);
      expect(b.frozenSpecularG).toBeCloseTo(0, 1);
      expect(b.frozenSpecularB).toBeCloseTo(0, 1);
    }
  });

  // -------------------------------------------------------------------------
  // Expected Result 2: Visible area real-time rendering
  // -------------------------------------------------------------------------
  test('ER2: Visible buildings render with alpha=1.0, full original color', async ({ page }) => {
    // Start in All Visible (default state)
    await clickButton(page, 'btn-all-visible');

    // Verify status panel
    for (const name of ['a1', 'b1', 'c1', 'd1']) {
      const status = await getBuildingStatus(page, name);
      expect(status).toContain('Live');
      expect(status).toContain('alpha=1.0');
    }

    // Verify mesh properties
    const meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      const expectedColors: Record<string, { r: number; g: number; b: number }> = {
        A1: { r: 0.9, g: 0.45, b: 0.1 },
        B1: { r: 0.2, g: 0.5, b: 0.9 },
        C1: { r: 0.3, g: 0.8, b: 0.3 },
        D1: { r: 0.8, g: 0.3, b: 0.5 },
      };
      return h.buildings.map((b: any) => ({
        name: b.name,
        liveVisible: b.mesh.isVisible,
        liveAlpha: b.mesh.material?.alpha,
        liveColorR: b.mesh.material?.diffuseColor?.r,
        liveColorG: b.mesh.material?.diffuseColor?.g,
        liveColorB: b.mesh.material?.diffuseColor?.b,
        expectedColor: expectedColors[b.name],
        frozenVisible: b.frozenClone?.isVisible,
      }));
    });

    for (const b of meshData) {
      expect(b.liveVisible).toBe(true);
      expect(b.liveAlpha).toBeCloseTo(1.0, 1);
      // Original color matches
      expect(b.liveColorR).toBeCloseTo(b.expectedColor.r, 1);
      expect(b.liveColorG).toBeCloseTo(b.expectedColor.g, 1);
      expect(b.liveColorB).toBeCloseTo(b.expectedColor.b, 1);
      // Frozen clone must be hidden
      expect(b.frozenVisible).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Expected Result 3: Instant state switching, no double rendering
  // -------------------------------------------------------------------------
  test('ER3: State switching is instant with no double rendering', async ({ page }) => {
    // Verify initial state
    let meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => ({
        name: b.name,
        liveVisible: b.mesh.isVisible,
        frozenVisible: b.frozenClone?.isVisible,
        bothVisible: b.mesh.isVisible && b.frozenClone?.isVisible,
      }));
    });
    for (const b of meshData) {
      expect(b.bothVisible).toBe(false);
    }

    // Switch to All Fog
    await clickButton(page, 'btn-all-fog');
    meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => ({
        name: b.name,
        liveVisible: b.mesh.isVisible,
        frozenVisible: b.frozenClone?.isVisible,
        bothVisible: b.mesh.isVisible && b.frozenClone?.isVisible,
      }));
    });
    for (const b of meshData) {
      expect(b.bothVisible).toBe(false);
      expect(b.liveVisible).toBe(false);
      expect(b.frozenVisible).toBe(true);
    }

    // Switch back to All Visible
    await clickButton(page, 'btn-all-visible');
    meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => ({
        name: b.name,
        liveVisible: b.mesh.isVisible,
        frozenVisible: b.frozenClone?.isVisible,
        bothVisible: b.mesh.isVisible && b.frozenClone?.isVisible,
      }));
    });
    for (const b of meshData) {
      expect(b.bothVisible).toBe(false);
      expect(b.liveVisible).toBe(true);
      expect(b.frozenVisible).toBe(false);
    }

    // FPS check
    const fps = parseInt(await getInfoMetric(page, 'fps'));
    expect(fps).toBeGreaterThanOrEqual(55);
  });

  // -------------------------------------------------------------------------
  // Expected Result 4: Hidden area completely invisible
  // -------------------------------------------------------------------------
  test('ER4: Hidden area makes all buildings completely invisible', async ({ page }) => {
    await clickButton(page, 'btn-all-hidden');

    // Status panel
    for (const name of ['a1', 'b1', 'c1', 'd1']) {
      const status = await getBuildingStatus(page, name);
      expect(status).toContain('Hidden');
      expect(status).toContain('invisible');
    }

    // Mesh-level: both live and frozen must be hidden
    const meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => ({
        name: b.name,
        liveVisible: b.mesh.isVisible,
        frozenVisible: b.frozenClone?.isVisible,
      }));
    });
    for (const b of meshData) {
      expect(b.liveVisible).toBe(false);
      expect(b.frozenVisible).toBe(false);
    }

    // Info bar
    const hidden = await getInfoMetric(page, 'hidden');
    expect(hidden).toBe('100');
    const visible = await getInfoMetric(page, 'visible');
    expect(visible).toBe('0');
  });

  // -------------------------------------------------------------------------
  // Expected Result 5: Independent tracking per building
  // -------------------------------------------------------------------------
  test('ER5: Each building independently tracks frozen state', async ({ page }) => {
    // Partial fog: left half visible, right half explored
    await clickButton(page, 'btn-partial-fog');

    const meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => {
        const cellState = h.visibilityData[b.gridRow * 10 + b.gridCol];
        return {
          name: b.name,
          gridCol: b.gridCol,
          cellState, // 0=HIDDEN, 1=EXPLORED, 2=VISIBLE
          liveVisible: b.mesh.isVisible,
          frozenVisible: b.frozenClone?.isVisible,
        };
      });
    });

    // A1 (col 2) and C1 (col 2) are in left half (cols 0-4 = VISIBLE)
    // B1 (col 7) and D1 (col 7) are in right half (cols 5-9 = EXPLORED)
    for (const b of meshData) {
      if (b.name === 'A1' || b.name === 'C1') {
        expect(b.cellState).toBe(2); // VISIBLE
        expect(b.liveVisible).toBe(true);
        expect(b.frozenVisible).toBe(false);
      } else {
        expect(b.cellState).toBe(1); // EXPLORED
        expect(b.liveVisible).toBe(false);
        expect(b.frozenVisible).toBe(true);
      }
    }

    // Verify status panel shows mixed states
    const statusA1 = await getBuildingStatus(page, 'a1');
    expect(statusA1).toContain('Live');
    const statusB1 = await getBuildingStatus(page, 'b1');
    expect(statusB1).toContain('Frozen');
    const statusC1 = await getBuildingStatus(page, 'c1');
    expect(statusC1).toContain('Live');
    const statusD1 = await getBuildingStatus(page, 'd1');
    expect(statusD1).toContain('Frozen');
  });

  // -------------------------------------------------------------------------
  // Health damage test
  // -------------------------------------------------------------------------
  test('Health damage affects frozen snapshot darkness', async ({ page }) => {
    // Go to All Visible, damage B1
    await clickButton(page, 'btn-all-visible');
    await clickButton(page, 'btn-damage-b1');

    // Verify B1 HP dropped to 60%
    const visibleStatus = await getBuildingStatus(page, 'b1');
    expect(visibleStatus).toContain('HP:60%');

    // Switch to All Fog
    await clickButton(page, 'btn-all-fog');

    // Verify B1 frozen snapshot is darker than other frozen buildings
    const meshData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => {
        const fm = b.frozenClone?.material;
        return {
          name: b.name,
          health: b.health,
          frozenGray: fm?.diffuseColor?.r,
        };
      });
    });

    // B1 at 60% should have lower gray value than others at 100%
    const b1Data = meshData.find((b: any) => b.name === 'B1')!;
    const healthyData = meshData.filter((b: any) => b.name !== 'B1');
    for (const healthy of healthyData) {
      expect(b1Data.frozenGray).toBeLessThan(healthy.frozenGray);
    }

    // Heal all
    await clickButton(page, 'btn-heal-all');
    const healedData = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      return h.buildings.map((b: any) => ({
        name: b.name,
        health: b.health,
      }));
    });
    for (const b of healedData) {
      expect(b.health).toBeCloseTo(1.0, 1);
    }
  });

  // -------------------------------------------------------------------------
  // Boundary test: Rapid switching
  // -------------------------------------------------------------------------
  test('Boundary: Rapid V→F→H→V switching (5 cycles) causes no errors', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = (window as any).__shroudFrozenTest;
      const errors: string[] = [];
      for (let i = 0; i < 5; i++) {
        try { h.presetAllVisible(); } catch (e: any) { errors.push(`V:${e.message}`); }
        try { h.presetAllFog(); } catch (e: any) { errors.push(`F:${e.message}`); }
        try { h.presetAllHidden(); } catch (e: any) { errors.push(`H:${e.message}`); }
      }
      try { h.presetAllVisible(); } catch (e: any) { errors.push(`final-V:${e.message}`); }

      const buildings = h.buildings.map((b: any) => ({
        name: b.name,
        meshExists: !!b.mesh,
        frozenExists: !!b.frozenClone,
        liveVisible: b.mesh?.isVisible,
        health: b.health,
      }));

      return { cycleCount: 5, errors, buildings };
    });

    expect(result.errors).toHaveLength(0);
    for (const b of result.buildings) {
      expect(b.meshExists).toBe(true);
      expect(b.frozenExists).toBe(true);
      expect(b.liveVisible).toBe(true);
      expect(b.health).toBeCloseTo(1.0, 1);
    }
  });

  // -------------------------------------------------------------------------
  // Info bar validation
  // -------------------------------------------------------------------------
  test('Info bar displays correct environment info', async ({ page }) => {
    const engine = await getInfoMetric(page, 'engine');
    expect(engine).toBe('WebGL 2.0');

    const ua = await getInfoMetric(page, 'ua');
    expect(ua).toBeTruthy();
    expect(ua).not.toBe('-');

    const viewport = await getInfoMetric(page, 'viewport');
    expect(viewport).toBeTruthy();
    expect(viewport).not.toBe('-');

    const fps = await getInfoMetric(page, 'fps');
    const fpsNum = parseInt(fps);
    expect(fpsNum).toBeGreaterThan(0);
  });

});
