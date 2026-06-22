import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// -----------------------------------------------------------------------------
// Acceptance test: Minimap Rendering Pipeline (Rgba32 pixel format)
// URL: http://localhost:5173/test/ch04-map-terrain/minimap-rendering/
// -----------------------------------------------------------------------------

const BASE_URL = 'http://localhost:5173/test/ch04-map-terrain/minimap-rendering/';
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch04-map-terrain/minimap-rendering/evidence'
);

try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch (_) { /* ok */ }

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface PlaneDimensions {
  width: number;
  height: number;
  longestSide: number;
  ratio: number;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForPageReady(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForSelector('#renderCanvas', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      return el !== null && el.textContent !== null && el.textContent.includes('WebGL');
    },
    { timeout: 10000 }
  );
  await page.waitForTimeout(2000);
}

async function getPlaneDimensions(page: Page): Promise<PlaneDimensions> {
  return page.evaluate(() => {
    const harness = (window as any).__testHarness;
    const plane = harness.getCurrentPlane();
    if (!plane) throw new Error('No current plane');
    plane.computeWorldMatrix(true);
    const boundingInfo = plane.getBoundingInfo();
    const min = boundingInfo.minimum;
    const max = boundingInfo.maximum;
    const width = max.x - min.x;
    const height = max.z - min.z;
    return {
      width,
      height,
      longestSide: Math.max(width, height),
      ratio: width / height,
    };
  });
}

async function getCurrentFps(page: Page): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseFloat((text ?? '0').trim());
}

async function isHeadless(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function generateAndWait(page: Page, width: number, height: number, seed: number): Promise<void> {
  await page.evaluate(
    ({ width, height, seed }) => {
      (window as any).__testHarness.generateAndRender(width, height, seed);
    },
    { width, height, seed }
  );
  // Allow render loop to process the new plane/texture.
  await page.waitForTimeout(250);
}

async function setWireframe(page: Page, enabled: boolean): Promise<void> {
  const active = await page.evaluate(() => {
    const btn = document.getElementById('btn-wireframe');
    return btn !== null && btn.classList.contains('active');
  });
  if (active !== enabled) {
    await page.evaluate(() => (window as any).__testHarness.toggleWireframe());
    await page.waitForTimeout(100);
  }
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe('Minimap Rendering Pipeline (Rgba32)', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await waitForPageReady(page);
  });

  test('E1: 128x128 color rendering matches terrain palette (Bug 1)', async ({ page }) => {
    await generateAndWait(page, 128, 128, 42);

    const { samples, waterFound, clearFound } = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      const terrainMap = harness.getTerrainMap();
      const width = 128;
      const height = 128;

      const samples: { x: number; y: number; terrain: string; rgba: number[] }[] = [];
      let waterFound = false;
      let clearFound = false;

      for (let y = 0; y < height; y += 8) {
        for (let x = 0; x < width; x += 8) {
          const idx = terrainMap[y * width + x];
          const rgba = harness.getPixelAt(x, y);
          const name = harness.TERRAIN_TYPES[idx]?.name ?? 'Unknown';
          samples.push({ x, y, terrain: name, rgba });
          if (idx === 0) waterFound = true;
          if (idx === 3) clearFound = true;
        }
      }

      return { samples, waterFound, clearFound };
    });

    expect(samples.length).toBeGreaterThan(0);
    expect(waterFound, 'Should sample at least one Water (deep) pixel').toBe(true);
    expect(clearFound, 'Should sample at least one Clear pixel').toBe(true);

    // Verify exact palette colors for Water (deep) and Clear.
    const water = samples.find((s) => s.terrain === 'Water (deep)');
    const clear = samples.find((s) => s.terrain === 'Clear');

    expect(water).toBeDefined();
    expect(water!.rgba).toEqual([64, 64, 192, 255]);

    expect(clear).toBeDefined();
    expect(clear!.rgba).toEqual([192, 176, 128, 255]);

    // No R↔B swap: for sampled colors R should not equal B when they are intended to differ.
    for (const s of samples) {
      const [r, , b] = s.rgba;
      if (s.terrain === 'Water (deep)') {
        expect(r, `Water R should be 64, got ${r}`).toBe(64);
        expect(b, `Water B should be 192, got ${b}`).toBe(192);
      }
      if (s.terrain === 'Clear') {
        expect(r, `Clear R should be 192, got ${r}`).toBe(192);
        expect(b, `Clear B should be 128, got ${b}`).toBe(128);
      }
    }

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-1-128x128-colors.png') });
  });

  test('E2: 200x100 aspect ratio preserves texture proportions (Bug 2)', async ({ page }) => {
    await generateAndWait(page, 200, 100, 123);

    const dims = await getPlaneDimensions(page);
    expect(dims.longestSide).toBeCloseTo(4, 1);
    expect(dims.ratio).toBeCloseTo(2, 1);

    await expect(page.locator('#stat-size')).toContainText('200 x 100');
    await expect(page.locator('#stat-aspect')).toContainText('2.000 : 1');

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-2-200x100-aspect.png') });

    // Restore square default for downstream tests.
    await generateAndWait(page, 128, 128, 42);
  });

  test('E3: Wireframe toggle reveals a clean single-quad mesh', async ({ page }) => {
    await setWireframe(page, true);

    const indexCount = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      const plane = harness.getCurrentPlane();
      if (!plane) throw new Error('No current plane');
      const geometry = plane.geometry;
      if (!geometry) throw new Error('Plane has no geometry');
      return geometry.getTotalIndices();
    });

    // A single-quad ground mesh has 6 indices = 2 triangles.
    expect(indexCount).toBe(6);

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-3-wireframe.png') });

    await setWireframe(page, false);
  });

  test('E4: Dynamic updates complete successfully and FPS stays reasonable', async ({ page }) => {
    const fpsSamples: number[] = [];
    const sizes: Array<{ width: number; height: number }> = [];

    for (let i = 0; i < 5; i++) {
      await generateAndWait(page, 128, 128, 1000 + i);

      const sizeText = await page.locator('#stat-size').textContent();
      expect(sizeText).toContain('128 x 128');

      const lengthText = await page.locator('#stat-length').textContent();
      expect(lengthText).toContain('65,536');

      const genTimeText = await page.locator('#stat-time').textContent();
      const genTime = parseFloat((genTimeText ?? '0').trim());
      expect(genTime).toBeLessThan(200);

      sizes.push({ width: 128, height: 128 });
      fpsSamples.push(await getCurrentFps(page));
    }

    const minFps = Math.min(...fpsSamples);
    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `Dynamic update FPS samples=[${fpsSamples.map((n) => n.toFixed(1)).join(', ')}], min=${minFps.toFixed(1)}, avg=${avgFps.toFixed(1)}, headless=${headless}`,
    });

    if (!headless) {
      expect(minFps, `Min FPS during dynamic updates should stay >= 30`).toBeGreaterThanOrEqual(30);
    }

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-4-dynamic-update.png') });
  });

  test('E5: Channel format data length equals width*height*4', async ({ page }) => {
    await generateAndWait(page, 128, 128, 42);
    await expect(page.locator('#stat-format')).toContainText('Rgba32 (4 B/px)');
    await expect(page.locator('#stat-length')).toContainText('65,536');

    await generateAndWait(page, 64, 64, 42);
    await expect(page.locator('#stat-length')).toContainText('16,384');

    await generateAndWait(page, 256, 256, 42);
    await expect(page.locator('#stat-length')).toContainText('262,144');
  });

  test('B1: Boundary - 16x16 minimum size renders correctly', async ({ page }) => {
    await generateAndWait(page, 16, 16, 7);

    await expect(page.locator('#stat-size')).toContainText('16 x 16');
    await expect(page.locator('#stat-length')).toContainText('1,024');

    const dims = await getPlaneDimensions(page);
    expect(dims.longestSide).toBeCloseTo(4, 1);
    expect(dims.ratio).toBeCloseTo(1, 6);

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-b1-16x16.png') });
  });

  test('B2: Boundary - 512x512 maximum size renders correctly', async ({ page }) => {
    await generateAndWait(page, 512, 512, 99);

    await expect(page.locator('#stat-size')).toContainText('512 x 512');
    await expect(page.locator('#stat-length')).toContainText('1,048,576');

    const dims = await getPlaneDimensions(page);
    expect(dims.longestSide).toBeCloseTo(4, 1);
    expect(dims.ratio).toBeCloseTo(1, 6);

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await getCurrentFps(page));
      await page.waitForTimeout(200);
    }
    const minFps = Math.min(...samples);
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `512x512 FPS samples=[${samples.map((n) => n.toFixed(1)).join(', ')}], min=${minFps.toFixed(1)}, headless=${headless}`,
    });

    if (!headless) {
      expect(minFps, `512x512 min FPS ${minFps.toFixed(1)} should be >= 25`).toBeGreaterThanOrEqual(25);
    }

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-b2-512x512.png') });
  });

  test('B3: Boundary - 100x100 NPOT size renders correctly', async ({ page }) => {
    await generateAndWait(page, 100, 100, 55);

    await expect(page.locator('#stat-size')).toContainText('100 x 100');
    await expect(page.locator('#stat-length')).toContainText('40,000');

    const dims = await getPlaneDimensions(page);
    expect(dims.longestSide).toBeCloseTo(4, 1);
    expect(dims.ratio).toBeCloseTo(1, 6);

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-b3-100x100-npot.png') });
  });

  test('B4: Boundary - rapid 20x generation without errors or FPS collapse', async ({ page }) => {
    const fpsBefore = await getCurrentFps(page);
    const start = Date.now();

    for (let i = 0; i < 20; i++) {
      await generateAndWait(page, 128, 128, 2000 + i);
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(8000);

    const fpsAfter = await getCurrentFps(page);
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `Rapid 20x gen: before=${fpsBefore.toFixed(1)}, after=${fpsAfter.toFixed(1)}, elapsed=${elapsed}ms, headless=${headless}`,
    });

    if (!headless) {
      expect(fpsAfter, `FPS after rapid generation should stay >= 30`).toBeGreaterThanOrEqual(30);
    }

    await expect(page.locator('#stat-size')).toContainText('128 x 128');

    await page
      .locator('#renderCanvas')
      .screenshot({ path: evidencePath('screenshot-b4-rapid-20x.png') });
  });
});
