import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Acceptance test: TerrainMeshBuilder basic visual generation
// URL: http://localhost:5173/test/ch04-map-terrain/basic/
//
// Headless caveats:
//   * FPS readouts are capped/artificial in headless Chromium and should not be
//     treated as production performance numbers.
//   * Very subtle shading differences can occur between GPU and SwiftShader
//     rasterizers; this script checks geometric facts (counts, bounds, slope)
//     and uses screenshots for human/Kimi visual validation.
// ---------------------------------------------------------------------------

interface TerrainTestHarness {
  scene: any;
  camera: any;
  engine: any;
  getCurrentMesh(): any | null;
  getVertexCount(): number;
  getTriangleCount(): number;
  getMaxVertexY(): number;
  showTerrain(mode: 'flat' | 'ramp' | 'iso'): void;
  toggleWireframe(): void;
}

const PAGE_URL = '/test/ch04-map-terrain/basic/';
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/manual/ch04-map-terrain/basic/evidence');

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

async function waitForHarnessReady(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness;
      return (
        !!h &&
        !!h.scene &&
        !!h.engine &&
        !!h.camera &&
        !!h.getCurrentMesh &&
        h.getCurrentMesh() !== null
      );
    },
    { timeout }
  );
}

async function switchTerrain(page: Page, mode: 'flat' | 'ramp' | 'iso'): Promise<void> {
  await page.evaluate((m) => (window as any).__testHarness.showTerrain(m), mode);
  await page.waitForTimeout(250);
}

async function pressModeKey(page: Page, key: '1' | '2' | '3'): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
}

async function pressWireframeKey(page: Page): Promise<void> {
  await page.keyboard.press('w');
  await page.waitForTimeout(150);
}

async function setCamera(page: Page, alpha: number, beta: number, radius: number): Promise<void> {
  await page.evaluate(
    ({ alpha, beta, radius }) => {
      const cam = (window as any).__testHarness.camera;
      cam.alpha = alpha;
      cam.beta = beta;
      cam.radius = radius;
    },
    { alpha, beta, radius }
  );
  await page.waitForTimeout(300);
}

async function resetCamera(page: Page): Promise<void> {
  await setCamera(page, Math.PI / 4, Math.PI / 3, 25);
}

async function getMeshMaterialFacts(page: Page): Promise<{ wireframe: boolean; colorHex: string }> {
  return page.evaluate(() => {
    const mesh = (window as any).__testHarness.getCurrentMesh();
    const mat = mesh?.material;
    const color = mat?.diffuseColor ?? mat?.emissiveColor ?? { r: 0, g: 0, b: 0 };
    const toHex = (v: number) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0');
    return {
      wireframe: !!mat?.wireframe,
      colorHex: `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase(),
    };
  });
}

async function meshIsOnScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const mesh = (window as any).__testHarness.getCurrentMesh();
    const camera = (window as any).__testHarness.camera;
    if (!mesh || !camera) return false;
    return camera.isInFrustum(mesh);
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function colorsAreClose(actual: string, expected: string, tolerance = 24): boolean {
  const a = hexToRgb(actual);
  const b = hexToRgb(expected);
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance
  );
}

test.describe('Terrain Mesh — Basic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await waitForHarnessReady(page);
    // Allow WebGL context, shader compilation and first frames to settle.
    await page.waitForTimeout(2500);
    await resetCamera(page);
  });

  // -------------------------------------------------------------------------
  // Expected result 1: Flat terrain
  // -------------------------------------------------------------------------
  test('1. Flat terrain: 81 vertices, 128 triangles, Y=0 plane', async ({ page }) => {
    await pressModeKey(page, '1');

    const { verts, tris, maxY } = await page.evaluate(() => ({
      verts: (window as any).__testHarness.getVertexCount(),
      tris: (window as any).__testHarness.getTriangleCount(),
      maxY: (window as any).__testHarness.getMaxVertexY(),
    }));

    expect(verts).toBe(81);
    expect(tris).toBe(128);
    expect(maxY).toBe(0);

    const modeText = await page.locator('#info-mode').textContent();
    expect(modeText?.toLowerCase()).toContain('flat');

    await page.locator('#renderCanvas').screenshot({ path: evidencePath('01-flat-solid.png') });
  });

  // -------------------------------------------------------------------------
  // Expected result 2: Ramp terrain
  // -------------------------------------------------------------------------
  test('2. Ramp terrain: diagonal slope, max Y >= 0.5', async ({ page }) => {
    await pressModeKey(page, '2');

    const { verts, tris, maxY } = await page.evaluate(() => ({
      verts: (window as any).__testHarness.getVertexCount(),
      tris: (window as any).__testHarness.getTriangleCount(),
      maxY: (window as any).__testHarness.getMaxVertexY(),
    }));

    expect(verts).toBeGreaterThan(0);
    expect(tris).toBeGreaterThan(0);
    expect(maxY).toBeGreaterThanOrEqual(0.5);

    // Sanity-check that the mesh is not flat: some vertex must be above zero.
    const { minY, uniqueY } = await page.evaluate(() => {
      const mesh = (window as any).__testHarness.getCurrentMesh();
      const positions = mesh?.getVerticesData?.('position') as Float32Array | undefined;
      if (!positions || positions.length === 0) return { minY: 0, uniqueY: 0 };
      const ys = new Set<number>();
      let minY = Infinity;
      for (let i = 1; i < positions.length; i += 3) {
        const y = positions[i];
        ys.add(Math.round(y * 1000) / 1000);
        if (y < minY) minY = y;
      }
      return { minY, uniqueY: ys.size };
    });

    expect(minY).toBeCloseTo(0, 1);
    expect(uniqueY).toBeGreaterThan(1);

    const modeText = await page.locator('#info-mode').textContent();
    expect(modeText?.toLowerCase()).toContain('ramp');

    await page.locator('#renderCanvas').screenshot({ path: evidencePath('02-ramp-solid.png') });
  });

  // -------------------------------------------------------------------------
  // Expected result 3: Isometric diamond terrain
  // -------------------------------------------------------------------------
  test('3. Iso terrain: diamond layout, 40-100 verts, 72-144 tris', async ({ page }) => {
    await pressModeKey(page, '3');

    const { verts, tris } = await page.evaluate(() => ({
      verts: (window as any).__testHarness.getVertexCount(),
      tris: (window as any).__testHarness.getTriangleCount(),
    }));

    expect(verts).toBeGreaterThanOrEqual(40);
    expect(verts).toBeLessThanOrEqual(100);
    expect(tris).toBeGreaterThanOrEqual(72);
    expect(tris).toBeLessThanOrEqual(144);

    // Verify diamond-ish aspect ratio from vertex bounds.
    const aspect = await page.evaluate(() => {
      const mesh = (window as any).__testHarness.getCurrentMesh();
      const positions = mesh?.getVerticesData?.('position') as Float32Array | undefined;
      if (!positions || positions.length === 0) return 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const width = maxX - minX;
      const depth = maxZ - minZ;
      return depth === 0 ? 0 : width / depth;
    });

    // Diamond layout is expected to be roughly twice as wide as it is deep.
    expect(aspect).toBeGreaterThanOrEqual(1.3);
    expect(aspect).toBeLessThanOrEqual(3.0);

    const modeText = await page.locator('#info-mode').textContent();
    expect(modeText?.toLowerCase()).toContain('iso');

    await page.locator('#renderCanvas').screenshot({ path: evidencePath('03-iso-solid.png') });
  });

  // -------------------------------------------------------------------------
  // Expected result 4: Wireframe toggle
  // -------------------------------------------------------------------------
  test('4. Wireframe mode: green lines, single edges at cell boundaries', async ({ page }) => {
    await pressModeKey(page, '1');
    await pressWireframeKey(page);

    const { wireframe, colorHex } = await getMeshMaterialFacts(page);
    expect(wireframe).toBe(true);
    expect(colorsAreClose(colorHex, '#66CC66')).toBe(true);

    const modeText = await page.locator('#info-mode').textContent();
    expect(modeText?.toLowerCase()).toContain('wireframe');

    // Evidence: wireframe on flat terrain.
    await page.locator('#renderCanvas').screenshot({ path: evidencePath('04-wireframe-flat.png') });

    // Zoom in close so a human can inspect that cell boundaries show single
    // lines rather than doubled/overlapping edges (crack detection).
    await setCamera(page, Math.PI / 4, Math.PI / 3, 2);
    expect(await meshIsOnScreen(page)).toBe(true);

    await page.locator('#renderCanvas').screenshot({ path: evidencePath('05-wireframe-flat-close.png') });

    // Return to a normal working distance.
    await resetCamera(page);
    await pressWireframeKey(page);
  });

  // -------------------------------------------------------------------------
  // Expected result 5: No cracks across all terrain modes
  // -------------------------------------------------------------------------
  test('5. All modes no cracks: wireframe inspection across Flat/Ramp/Iso', async ({ page }) => {
    // Enable wireframe once and cycle through modes.
    await pressModeKey(page, '1');
    await pressWireframeKey(page);

    for (const mode of ['flat', 'ramp', 'iso'] as const) {
      await switchTerrain(page, mode);

      const { wireframe } = await getMeshMaterialFacts(page);
      expect(wireframe).toBe(true);

      await page.locator('#renderCanvas').screenshot({
        path: evidencePath(`06-wireframe-${mode}.png`),
      });
    }

    await pressWireframeKey(page);
  });

  // -------------------------------------------------------------------------
  // Edge case 1: rapid mode switching
  // -------------------------------------------------------------------------
  test('6. Boundary: rapid mode switching no crash', async ({ page }) => {
    const sequence: Array<'1' | '2' | '3'> = ['1', '2', '3', '1', '2', '3'];
    for (const key of sequence) {
      await pressModeKey(page, key);
    }

    const stillHealthy = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return (
        !!h &&
        !!h.scene &&
        !h.scene.isDisposed &&
        !!h.engine &&
        !h.engine.isDisposed &&
        !!h.getCurrentMesh()
      );
    });

    expect(stillHealthy).toBe(true);

    // End in a known state and verify counts are still correct.
    await switchTerrain(page, 'flat');
    const { verts, tris } = await page.evaluate(() => ({
      verts: (window as any).__testHarness.getVertexCount(),
      tris: (window as any).__testHarness.getTriangleCount(),
    }));
    expect(verts).toBe(81);
    expect(tris).toBe(128);
  });

  // -------------------------------------------------------------------------
  // Edge case 2: extreme camera angles
  // -------------------------------------------------------------------------
  test('7. Boundary: extreme camera angles terrain visible', async ({ page }) => {
    await pressModeKey(page, '1');

    // Top-down view.
    await setCamera(page, 0, 0.01, 30);
    expect(await meshIsOnScreen(page)).toBe(true);
    await page.locator('#renderCanvas').screenshot({ path: evidencePath('07-camera-top-down.png') });

    // Bottom-up view.
    await setCamera(page, 0, Math.PI - 0.01, 30);
    expect(await meshIsOnScreen(page)).toBe(true);
    await page.locator('#renderCanvas').screenshot({ path: evidencePath('08-camera-bottom-up.png') });

    await resetCamera(page);
  });

  // -------------------------------------------------------------------------
  // Edge case 3: min/max zoom distance
  // -------------------------------------------------------------------------
  test('8. Boundary: min/max zoom distance', async ({ page }) => {
    await pressModeKey(page, '1');

    // Very close: should still render detail.
    await setCamera(page, Math.PI / 4, Math.PI / 3, 2);
    expect(await meshIsOnScreen(page)).toBe(true);
    await page.locator('#renderCanvas').screenshot({ path: evidencePath('09-zoom-close-radius-2.png') });

    // Very far: should still show the overall outline.
    await setCamera(page, Math.PI / 4, Math.PI / 3, 50);
    expect(await meshIsOnScreen(page)).toBe(true);
    await page.locator('#renderCanvas').screenshot({ path: evidencePath('10-zoom-far-radius-50.png') });

    await resetCamera(page);
  });
});
