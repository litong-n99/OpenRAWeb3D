import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Headless Chromium caveats:
// - FPS counters may be unstable because headless browsers often throttle requestAnimationFrame.
// - Visual precision (color, antialiasing) can differ from a GPU-backed desktop browser.
// - Screenshots in this file are captured as evidence, not as pixel-perfect golden images.

test.use({ viewport: { width: 1920, height: 1080 } });

interface TerrainHarness {
  scene: any;
  camera: any;
  engine: any;
  getCurrentMesh(): any;
  getVertexCount(): number;
  getTriangleCount(): number;
  getMaxVertexY(): number;
  showTerrain(mode: 'flat' | 'ramp' | 'iso'): void;
  toggleWireframe(): void;
}

declare global {
  interface Window {
    __testHarness: TerrainHarness;
  }
}

function evidencePath(name: string): string {
  const dir = test.info().outputPath('evidence');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness;
      return h && typeof h.getCurrentMesh === 'function' && h.getCurrentMesh() !== null;
    },
    { timeout }
  );
  // Headless WebGL init is slower; give the first frame time to render.
  await page.waitForTimeout(2500);
}

async function waitForFrame(page: Page): Promise<void> {
  // Mesh disposal/recreation needs at least one render frame to settle.
  await page.waitForTimeout(100);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function deltaE(a: Rgb, b: Rgb): number {
  return Math.sqrt(
    Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2)
  );
}

async function getMaterialColor(
  page: Page,
  kind: 'diffuse' | 'emissive'
): Promise<Rgb | null> {
  return page.evaluate((kind) => {
    const mesh = window.__testHarness.getCurrentMesh();
    if (!mesh || !mesh.material) return null;
    const c = mesh.material[`${kind}Color`];
    if (!c) return null;
    return {
      r: Math.round(c.r * 255),
      g: Math.round(c.g * 255),
      b: Math.round(c.b * 255),
    };
  }, kind);
}

async function getMeshYPositions(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const mesh = window.__testHarness.getCurrentMesh();
    if (!mesh) return [];
    const data = mesh.getVerticesData('position') as Float32Array | number[];
    const ys: number[] = [];
    for (let i = 1; i < data.length; i += 3) {
      ys.push(data[i]);
    }
    return ys;
  });
}

async function getBoundingBoxRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const mesh = window.__testHarness.getCurrentMesh();
    if (!mesh) return 0;
    const data = mesh.getVerticesData('position') as Float32Array | number[];
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < data.length; i += 3) {
      const x = data[i];
      const z = data[i + 2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const width = maxX - minX;
    const depth = maxZ - minZ;
    return depth === 0 ? 0 : width / depth;
  });
}

async function assertNoOverlappingEdges(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const mesh = window.__testHarness.getCurrentMesh();
    if (!mesh) return { ok: false, error: 'no mesh' };
    const positions = mesh.getVerticesData('position') as Float32Array | number[];
    const indices = mesh.getIndices() as number[] | Uint16Array | Uint32Array;
    if (!positions || !indices) return { ok: false, error: 'missing geometry data' };

    const eps = 1e-4;
    const keyOf = (idx: number) => {
      const x = positions[idx * 3];
      const y = positions[idx * 3 + 1];
      const z = positions[idx * 3 + 2];
      return `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
    };

    const geoEdges = new Map<string, Set<string>>();
    for (let i = 0; i < indices.length; i += 3) {
      const tri = [indices[i], indices[i + 1], indices[i + 2]];
      const pairs = [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ];
      for (const [a, b] of pairs) {
        const k1 = keyOf(a);
        const k2 = keyOf(b);
        const geoKey = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        const idxKey = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!geoEdges.has(geoKey)) {
          geoEdges.set(geoKey, new Set());
        }
        geoEdges.get(geoKey)!.add(idxKey);
      }
    }

    for (const [geoKey, set] of geoEdges) {
      if (set.size > 1) {
        return {
          ok: false,
          error: `overlapping edge ${geoKey} (${set.size} index pairs)`,
        };
      }
    }
    return { ok: true, edgeCount: geoEdges.size };
  });

  expect(result.ok, result.error).toBe(true);
}

async function focusCanvasAndPress(page: Page, key: string): Promise<void> {
  await page.locator('#renderCanvas').click();
  await page.waitForTimeout(50);
  await page.keyboard.press(key);
  await page.waitForTimeout(100);
}

test.describe('Terrain Mesh — Basic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/ch04-map-terrain/basic/');
    await waitForHarness(page);
  });

  test('1. Flat terrain: 81 vertices, 128 triangles, Y=0 plane', async ({ page }) => {
    await page.evaluate(() => window.__testHarness.showTerrain('flat'));
    await waitForFrame(page);

    const stats = await page.evaluate(() => ({
      verts: window.__testHarness.getVertexCount(),
      tris: window.__testHarness.getTriangleCount(),
      maxY: window.__testHarness.getMaxVertexY(),
    }));

    expect(stats.verts, 'flat vertex count should be 81').toBe(81);
    expect(stats.tris, 'flat triangle count should be 128').toBe(128);
    expect(stats.maxY, 'flat terrain max Y should be 0').toBe(0);

    const ys = await getMeshYPositions(page);
    expect(ys.length, 'position data should be available').toBeGreaterThan(0);
    const offPlane = ys.filter((y) => Math.abs(y) > 1e-4);
    expect(offPlane.length, 'all flat vertices should lie on Y=0').toBe(0);

    const color = await getMaterialColor(page, 'diffuse');
    if (color) {
      const expectedFlat = { r: 128, g: 160, b: 96 }; // #80A060
      expect(
        deltaE(color, expectedFlat),
        `flat color ${JSON.stringify(color)} should be close to #80A060`
      ).toBeLessThanOrEqual(20);
    }

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Solid flat terrain should render as a light green plane.',
    });
    await page.screenshot({ path: evidencePath('01-flat-solid.png') });
  });

  test('2. Ramp terrain: diagonal slope, max Y >= 0.5', async ({ page }) => {
    await page.evaluate(() => window.__testHarness.showTerrain('ramp'));
    await waitForFrame(page);

    const stats = await page.evaluate(() => ({
      verts: window.__testHarness.getVertexCount(),
      tris: window.__testHarness.getTriangleCount(),
      maxY: window.__testHarness.getMaxVertexY(),
    }));

    expect(stats.verts, 'ramp should keep indexed grid vertices').toBe(81);
    expect(stats.tris, 'ramp should keep indexed grid triangles').toBe(128);
    expect(stats.maxY, 'ramp max vertex Y should be at least 0.5').toBeGreaterThanOrEqual(0.5);

    const ys = await getMeshYPositions(page);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    expect(minY, 'ramp should start near Y=0').toBeCloseTo(0, 1);
    expect(maxY, 'ramp should reach maxTerrainHeight / 4 or higher').toBeGreaterThanOrEqual(0.5);

    await assertNoOverlappingEdges(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Ramp should show a smooth diagonal slope from SW to NE with no Z-fighting.',
    });
    await page.screenshot({ path: evidencePath('02-ramp-solid.png') });
  });

  test('3. Iso terrain: diamond layout, 40-100 verts, 72-144 tris', async ({ page }) => {
    // Use the keyboard shortcut to exercise the input path.
    await focusCanvasAndPress(page, '3');
    await waitForFrame(page);

    const stats = await page.evaluate(() => ({
      verts: window.__testHarness.getVertexCount(),
      tris: window.__testHarness.getTriangleCount(),
    }));

    expect(stats.verts, 'iso vertex count should be in 40-100 range').toBeGreaterThanOrEqual(40);
    expect(stats.verts, 'iso vertex count should be in 40-100 range').toBeLessThanOrEqual(100);
    expect(stats.tris, 'iso triangle count should be in 72-144 range').toBeGreaterThanOrEqual(72);
    expect(stats.tris, 'iso triangle count should be in 72-144 range').toBeLessThanOrEqual(144);

    const aspect = await getBoundingBoxRatio(page);
    expect(aspect, 'iso diamond aspect ratio should be approximately 2:1').toBeGreaterThanOrEqual(1.5);
    expect(aspect, 'iso diamond aspect ratio should be approximately 2:1').toBeLessThanOrEqual(2.5);

    await assertNoOverlappingEdges(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Iso terrain should render a diamond-shaped patch with a ~2:1 aspect ratio.',
    });
    await page.screenshot({ path: evidencePath('03-iso-solid.png') });
  });

  test('4. Wireframe mode: green lines, single edges at cell boundaries', async ({ page }) => {
    await page.evaluate(() => window.__testHarness.showTerrain('flat'));
    await waitForFrame(page);

    const elapsed = await page.evaluate(() => {
      const t0 = performance.now();
      window.__testHarness.toggleWireframe();
      return performance.now() - t0;
    });

    expect(elapsed, 'wireframe toggle should be instant (<100ms)').toBeLessThan(100);

    const wireframe = await page.evaluate(() => {
      const mesh = window.__testHarness.getCurrentMesh();
      return mesh && mesh.material ? mesh.material.wireframe === true : false;
    });
    expect(wireframe, 'material should be in wireframe mode').toBe(true);

    const emissive = await getMaterialColor(page, 'emissive');
    const diffuse = await getMaterialColor(page, 'diffuse');
    const candidates = [emissive, diffuse].filter((c): c is Rgb => c !== null);
    const expectedWire = { r: 102, g: 204, b: 102 }; // #66CC66
    const hasGreen = candidates.some((c) => deltaE(c, expectedWire) <= 20);
    expect(hasGreen, 'wireframe color should be bright green (#66CC66)').toBe(true);

    await assertNoOverlappingEdges(page);

    // Zoom in close to make any duplicated cell-boundary lines obvious.
    await page.evaluate(() => {
      const cam = window.__testHarness.camera;
      cam.radius = 2;
      cam.alpha = Math.PI / 4;
      cam.beta = Math.PI / 3;
    });
    await waitForFrame(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Close-up wireframe should show a single clean line per cell boundary.',
    });
    await page.screenshot({ path: evidencePath('04-flat-wireframe-close.png') });
  });

  test('5. All modes no cracks: wireframe inspection across Flat/Ramp/Iso', async ({ page }) => {
    // Enable wireframe with the W shortcut.
    await focusCanvasAndPress(page, 'w');

    const modes: Array<{
      key: '1' | '2' | '3';
      name: 'flat' | 'ramp' | 'iso';
      file: string;
    }> = [
      { key: '1', name: 'flat', file: '05-flat-wireframe.png' },
      { key: '2', name: 'ramp', file: '05-ramp-wireframe.png' },
      { key: '3', name: 'iso', file: '05-iso-wireframe.png' },
    ];

    for (const mode of modes) {
      await focusCanvasAndPress(page, mode.key);
      // Ensure the harness actually switched to the requested mode.
      await page.evaluate((name) => window.__testHarness.showTerrain(name), mode.name);
      await waitForFrame(page);

      const meshExists = await page.evaluate(
        () => window.__testHarness.getCurrentMesh() !== null
      );
      expect(meshExists, `${mode.name} mesh should exist in wireframe`).toBe(true);

      await assertNoOverlappingEdges(page);

      test.info().annotations.push({
        type: 'visual-check',
        description: `${mode.name} wireframe should have no overlapping edges.`,
      });
      await page.screenshot({ path: evidencePath(mode.file) });
    }
  });

  test('6. Boundary: rapid mode switching no crash', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    // Rapid 1->2->3->1->2->3 using keyboard shortcuts.
    for (let i = 0; i < 2; i++) {
      await focusCanvasAndPress(page, '1');
      await focusCanvasAndPress(page, '2');
      await focusCanvasAndPress(page, '3');
    }

    await waitForFrame(page);

    expect(
      errors.length,
      `page errors during rapid switching: ${errors.map((e) => e.message).join(', ')}`
    ).toBe(0);

    const current = await page.evaluate(() => {
      const mesh = window.__testHarness.getCurrentMesh();
      return {
        exists: mesh !== null,
        verts: window.__testHarness.getVertexCount(),
        tris: window.__testHarness.getTriangleCount(),
      };
    });

    expect(current.exists, 'current mesh should exist after rapid switching').toBe(true);
    expect(current.verts, 'vertex count should be valid after rapid switching').toBeGreaterThan(0);
    expect(current.tris, 'triangle count should be valid after rapid switching').toBeGreaterThan(0);
  });

  test('7. Boundary: extreme camera angles terrain visible', async ({ page }) => {
    await page.evaluate(() => window.__testHarness.showTerrain('flat'));
    await waitForFrame(page);

    const angles = [
      { beta: 0.1, label: 'top-down' },
      { beta: Math.PI - 0.1, label: 'bottom-up' },
    ];

    for (const { beta, label } of angles) {
      await page.evaluate(
        (beta) => {
          const cam = window.__testHarness.camera;
          cam.alpha = 0;
          cam.beta = beta;
          cam.radius = 15;
        },
        beta
      );
      await waitForFrame(page);

      const visible = await page.evaluate(() => {
        const mesh = window.__testHarness.getCurrentMesh();
        const cam = window.__testHarness.camera;
        return mesh !== null && mesh.isEnabled() && mesh.isInFrustum(cam.getFrustumPlanes());
      });
      expect(visible, `terrain should be visible from ${label} angle`).toBe(true);

      if (label === 'top-down') {
        test.info().annotations.push({
          type: 'visual-check',
          description: 'Top-down view should show the full terrain patch.',
        });
        await page.screenshot({ path: evidencePath('07-top-down-view.png') });
      }
    }
  });

  test('8. Boundary: min/max zoom distance', async ({ page }) => {
    await page.evaluate(() => window.__testHarness.showTerrain('flat'));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__testHarness.toggleWireframe());
    await waitForFrame(page);

    const zooms = [
      { radius: 2, label: 'close', file: '08-zoom-close.png' },
      { radius: 50, label: 'far', file: '08-zoom-far.png' },
    ];

    for (const zoom of zooms) {
      await page.evaluate(
        (radius) => {
          const cam = window.__testHarness.camera;
          cam.radius = radius;
          cam.alpha = Math.PI / 4;
          cam.beta = Math.PI / 3;
        },
        zoom.radius
      );
      await waitForFrame(page);

      const visible = await page.evaluate(() => {
        const mesh = window.__testHarness.getCurrentMesh();
        const cam = window.__testHarness.camera;
        return mesh !== null && mesh.isEnabled() && mesh.isInFrustum(cam.getFrustumPlanes());
      });
      expect(
        visible,
        `terrain should be visible at ${zoom.label} zoom (radius=${zoom.radius})`
      ).toBe(true);

      test.info().annotations.push({
        type: 'visual-check',
        description: `${zoom.label} zoom screenshot should show terrain detail or overall outline.`,
      });
      await page.screenshot({ path: evidencePath(zoom.file) });
    }
  });
});
