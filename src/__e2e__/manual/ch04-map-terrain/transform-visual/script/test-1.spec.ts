/**
 * CoordinateTransformer — WPos ↔ Vector3 visual verification acceptance test
 *
 * URL: http://localhost:5173/test/ch04-map-terrain/transform-visual/
 *
 * Validates WPos to Vector3 coordinate mapping, LRU cache statistics,
 * round-trip precision, real-time slider/keyboard interaction, 3D scene
 * structure, grid toggle, cache overflow, and rendering performance.
 *
 * Headless caveats:
 *   * FPS readouts are approximate in headless Chromium/SwiftShader.
 *   * 3D scene structure is verified through the Babylon.js scene graph
 *     (mesh names, materials, colors) rather than canvas pixel reads.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PAGE_URL = '/test/ch04-map-terrain/transform-visual/';
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || path.resolve('test-results', 'manual/ch04-map-terrain/transform-visual'),
  'evidence'
);

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface WPosLike {
  X: number;
  Y: number;
  Z: number;
}

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface PresetExpectation {
  id: string;
  wpos: WPosLike;
  vec3: Vector3Like;
  screenshot: string;
}

const PRESETS: PresetExpectation[] = [
  {
    id: 'preset-origin',
    wpos: { X: 0, Y: 0, Z: 0 },
    vec3: { x: 0, y: 0, z: 0 },
    screenshot: 'transform-visual-1-origin.png',
  },
  {
    id: 'preset-center',
    wpos: { X: 5120, Y: 5120, Z: 0 },
    vec3: { x: 5, y: 0, z: 5 },
    screenshot: 'transform-visual-1-center.png',
  },
  {
    id: 'preset-corner',
    wpos: { X: 10240, Y: 10240, Z: 0 },
    vec3: { x: 10, y: 0, z: 10 },
    screenshot: 'transform-visual-1-corner.png',
  },
  {
    id: 'preset-elevated',
    wpos: { X: 2560, Y: 7680, Z: 2048 },
    vec3: { x: 2.5, y: 4, z: 7.5 },
    screenshot: 'transform-visual-1-elevated.png',
  },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForPageReady(page: Page, timeout = 20000): Promise<void> {
  await page.goto(PAGE_URL);

  // Wait for the canvas.
  await page.waitForSelector('#renderCanvas', { timeout });

  // Wait for WebGL engine info.
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      return el !== null && el.textContent !== null && el.textContent.includes('WebGL');
    },
    { timeout }
  );

  // Wait for initial values to be populated (not placeholder '-').
  await page.waitForFunction(
    () => {
      const wpos = document.getElementById('wpos-display')?.textContent ?? '';
      const vec3 = document.getElementById('vec3-display')?.textContent ?? '';
      const fps = document.getElementById('info-fps')?.textContent ?? '';
      return wpos.includes(',') && vec3.includes(',') && /^\d+$/.test(fps.trim());
    },
    { timeout }
  );

  // Allow the first render frames and camera animation to complete.
  await page.waitForTimeout(800);
}

async function getCurrentWPos(page: Page): Promise<WPosLike> {
  return page.evaluate(() => {
    const w = (window as any).__testHarness.getCurrentWPos();
    return { X: w.X, Y: w.Y, Z: w.Z };
  });
}

async function getCurrentVector3(page: Page): Promise<Vector3Like> {
  return page.evaluate(() => {
    const v = (window as any).__testHarness.getCurrentVector3();
    return { x: v.x, y: v.y, z: v.z };
  });
}

async function setWPos(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate((args) => {
    (window as any).__testHarness.setWPos(args.x, args.y, args.z);
  }, { x, y, z });
  // Camera animation is 0.5s; allow it to settle.
  await page.waitForTimeout(600);
}

async function clearCacheViaHarness(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.clearCache());
  await page.waitForTimeout(100);
}

async function getCacheSize(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getCacheSize());
}

async function getHitRate(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getHitRate());
}

async function getCurrentFps(page: Page): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseFloat((text ?? '0').trim());
}

async function isHeadlessEnvironment(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.userAgent.toLowerCase().includes('headless'));
}

function parseVec3Text(text: string): Vector3Like {
  const parts = text.split(',').map((p) => parseFloat(p.trim()));
  return { x: parts[0]!, y: parts[1]!, z: parts[2]! };
}

function parseWPosText(text: string): WPosLike {
  const parts = text.split(',').map((p) => parseInt(p.trim(), 10));
  return { X: parts[0]!, Y: parts[1]!, Z: parts[2]! };
}

function parseHitRateText(text: string): number {
  const match = text.match(/([\d.]+)/);
  return match ? parseFloat(match[1]!) : 0;
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe('CoordinateTransformer — WPos ↔ Vector3 visual verification', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await waitForPageReady(page);
  });

  // ===========================================================================
  // 1. WPos → Vector3 mapping correctness
  // ===========================================================================

  test('1.1 - Presets produce exact WPos → Vector3 mappings', async ({ page }) => {
    for (const preset of PRESETS) {
      await page.click(`#${preset.id}`);
      await page.waitForTimeout(600); // camera animation

      // Verify harness values.
      const harnessWPos = await getCurrentWPos(page);
      const harnessVec3 = await getCurrentVector3(page);
      expect(harnessWPos.X).toBe(preset.wpos.X);
      expect(harnessWPos.Y).toBe(preset.wpos.Y);
      expect(harnessWPos.Z).toBe(preset.wpos.Z);
      expect(harnessVec3.x).toBeCloseTo(preset.vec3.x, 6);
      expect(harnessVec3.y).toBeCloseTo(preset.vec3.y, 6);
      expect(harnessVec3.z).toBeCloseTo(preset.vec3.z, 6);

      // Verify DOM displays.
      const wposText = await page.locator('#wpos-display').textContent();
      const vec3Text = await page.locator('#vec3-display').textContent();
      const domWPos = parseWPosText(wposText ?? '');
      const domVec3 = parseVec3Text(vec3Text ?? '');
      expect(domWPos).toEqual(preset.wpos);
      expect(domVec3.x).toBeCloseTo(preset.vec3.x, 6);
      expect(domVec3.y).toBeCloseTo(preset.vec3.y, 6);
      expect(domVec3.z).toBeCloseTo(preset.vec3.z, 6);

      // Verify Vector3 display uses 6 decimal places.
      const vec3Parts = (vec3Text ?? '').split(',').map((p) => p.trim());
      for (const part of vec3Parts) {
        const decimal = part.split('.')[1];
        expect(decimal?.length).toBe(6);
      }

      await page.screenshot({ path: evidencePath(preset.screenshot), fullPage: false });
    }
  });

  test('1.2 - Initial WPos(5120,5120,512) maps to Vector3(5,1,5)', async ({ page }) => {
    // The page initializes to this coordinate; verify the explicit expected mapping.
    const harnessVec3 = await getCurrentVector3(page);
    expect(harnessVec3.x).toBeCloseTo(5, 6);
    expect(harnessVec3.y).toBeCloseTo(1, 6);
    expect(harnessVec3.z).toBeCloseTo(5, 6);

    const vec3Text = await page.locator('#vec3-display').textContent();
    const domVec3 = parseVec3Text(vec3Text ?? '');
    expect(domVec3.x).toBeCloseTo(5, 6);
    expect(domVec3.y).toBeCloseTo(1, 6);
    expect(domVec3.z).toBeCloseTo(5, 6);
  });

  test('1.3 - Scale constants are exposed and correct', async ({ page }) => {
    const constants = await page.evaluate(async () => {
      const mod = await import('/src/OpenRA.Game/CoordinateTransformer.ts');
      return {
        WORLD_SCALE: mod.WORLD_SCALE,
        HEIGHT_SCALE: mod.HEIGHT_SCALE,
        CACHE_SIZE: mod.CACHE_SIZE,
      };
    });
    expect(constants.WORLD_SCALE).toBeCloseTo(1 / 1024, 9);
    expect(constants.HEIGHT_SCALE).toBeCloseTo(1 / 512, 9);
    expect(constants.CACHE_SIZE).toBe(1000);

    const totalText = await page.locator('#cache-total').textContent();
    expect(totalText).toContain('CACHE_SIZE=1000');
    expect(totalText).toContain('WORLD_SCALE=1/1024');
    expect(totalText).toContain('HEIGHT_SCALE=1/512');
  });

  // ===========================================================================
  // 2. Round-trip precision
  // ===========================================================================

  test('2.1 - Extreme coordinates round-trip within tolerance', async ({ page }) => {
    const extremes: WPosLike[] = [
      { X: 0, Y: 0, Z: 0 },
      { X: 10240, Y: 10240, Z: 4096 },
    ];

    for (const wpos of extremes) {
      await setWPos(page, wpos.X, wpos.Y, wpos.Z);

      const roundTrip = await page.evaluate(async (start) => {
        const { vector3ToWPos } = await import('/src/OpenRA.Game/CoordinateTransformer.ts');
        const vec3 = (window as any).__testHarness.getCurrentVector3();
        const back = vector3ToWPos(vec3);
        return {
          deltaX: Math.abs(back.X - start.X),
          deltaY: Math.abs(back.Y - start.Y),
          deltaZ: Math.abs(back.Z - start.Z),
          delta: Math.abs(back.X - start.X) + Math.abs(back.Y - start.Y) + Math.abs(back.Z - start.Z),
        };
      }, wpos);

      expect(roundTrip.deltaX).toBeLessThanOrEqual(2);
      expect(roundTrip.deltaY).toBeLessThanOrEqual(2);
      expect(roundTrip.deltaZ).toBeLessThanOrEqual(2);
      expect(roundTrip.delta).toBeLessThanOrEqual(3);

      const rtText = await page.locator('#rt-delta').textContent();
      const rtMatch = rtText?.match(/^(\d+) su/);
      const domDelta = rtMatch ? parseInt(rtMatch[1]!, 10) : Number.POSITIVE_INFINITY;
      expect(domDelta).toBeLessThanOrEqual(3);
    }

    await page.screenshot({ path: evidencePath('transform-visual-2-1-extreme.png'), fullPage: false });
  });

  test('2.2 - Stress test runs 200 random conversions without errors', async ({ page }) => {
    await clearCacheViaHarness(page);

    const result = await page.evaluate(() => {
      return new Promise<{ durationMs: number; cacheSize: number; hitRate: number }>((resolve) => {
        (window as any).__testHarness.runStressTest();
        // Allow console logs to flush and stats to update.
        setTimeout(() => {
          resolve({
            durationMs: 0, // not directly exposed; we rely on console log
            cacheSize: (window as any).__testHarness.getCacheSize(),
            hitRate: (window as any).__testHarness.getHitRate(),
          });
        }, 100);
      });
    });

    expect(result.cacheSize).toBeGreaterThan(0);
    expect(result.cacheSize).toBeLessThanOrEqual(1000);

    test.info().annotations.push({
      type: 'stress-test',
      description: `cacheSize=${result.cacheSize}, hitRate=${result.hitRate.toFixed(1)}%`,
    });

    await page.screenshot({ path: evidencePath('transform-visual-2-2-stress.png'), fullPage: false });
  });

  // ===========================================================================
  // 3. Cache statistics
  // ===========================================================================

  test('3.1 - Clear cache resets size and hit rate to zero', async ({ page }) => {
    // Verify the clear-cache button is present.
    await expect(page.locator('#btn-clear-cache')).toBeVisible();

    // First generate a hit.
    await setWPos(page, 1024, 1024, 0);
    await setWPos(page, 1024, 1024, 0);
    expect(await getHitRate(page)).toBeGreaterThan(0);

    // Click the clear-cache button: clears caches, resets counters, re-queries current WPos.
    await page.click('#btn-clear-cache');
    await page.waitForTimeout(200);

    const cacheSize = await getCacheSize(page);
    const hitRateText = await page.locator('#cache-vec').textContent();
    const hitRate = parseHitRateText(hitRateText ?? '');

    expect(cacheSize).toBe(2); // fresh wPos→vec + vec→wPos misses after clear
    expect(hitRate).toBe(0);

    await page.screenshot({ path: evidencePath('transform-visual-3-1-cache-cleared.png'), fullPage: false });
  });

  test('3.2 - Preset sequence produces expected LRU hit rate', async ({ page }) => {
    await clearCacheViaHarness(page);

    // Step 1: origin (0,0,0) first visit → 2 misses, 2 queries, 0% hit
    await setWPos(page, 0, 0, 0);
    expect(await getCacheSize(page)).toBe(2);
    expect(await getHitRate(page)).toBe(0);

    // Step 2: center (5120,5120,0) first visit → 2 misses, 4 queries, 0% hit
    await setWPos(page, 5120, 5120, 0);
    expect(await getCacheSize(page)).toBe(4);
    expect(await getHitRate(page)).toBe(0);

    // Step 3: corner (10240,10240,0) first visit → 2 misses, 6 queries, 0% hit
    await setWPos(page, 10240, 10240, 0);
    expect(await getCacheSize(page)).toBe(6);
    expect(await getHitRate(page)).toBe(0);

    // Step 4: center again → 2 hits, 8 queries, 25% hit
    await setWPos(page, 5120, 5120, 0);
    expect(await getCacheSize(page)).toBe(6); // no new entries
    expect(await getHitRate(page)).toBeCloseTo(25, 1);

    // Verify DOM reflects 25% hit rate.
    const hitRateText = await page.locator('#cache-vec').textContent();
    expect(parseHitRateText(hitRateText ?? '')).toBeCloseTo(25, 1);

    const totalText = await page.locator('#cache-cell').textContent();
    expect(parseInt((totalText ?? '').trim(), 10)).toBe(8);

    await page.screenshot({ path: evidencePath('transform-visual-3-2-lru-hitrate.png'), fullPage: false });
  });

  // ===========================================================================
  // 4. Real-time interaction
  // ===========================================================================

  test('4.1 - Slider updates reflect in DOM and harness within 50ms', async ({ page }) => {
    await clearCacheViaHarness(page);

    // Measure update latency inside the page to avoid Playwright overhead.
    const timing = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      const t0 = performance.now();
      harness.setWPos(10240, 5120, 1024);
      const t1 = performance.now();
      return { duration: t1 - t0 };
    });

    // setWPos is synchronous; the 50ms target covers DOM + sphere + display updates.
    expect(timing.duration).toBeLessThan(50);

    const harnessWPos = await getCurrentWPos(page);
    const harnessVec3 = await getCurrentVector3(page);
    expect(harnessWPos.X).toBe(10240);
    expect(harnessWPos.Y).toBe(5120);
    expect(harnessWPos.Z).toBe(1024);
    expect(harnessVec3.x).toBeCloseTo(10, 6);
    expect(harnessVec3.y).toBeCloseTo(2, 6);
    expect(harnessVec3.z).toBeCloseTo(5, 6);

    // Also verify the DOM reflects the new values via real slider interaction.
    await page.fill('#slider-x', '2048');
    await page.waitForTimeout(50);
    const wposText = await page.locator('#wpos-display').textContent();
    expect(parseWPosText(wposText ?? '').X).toBe(2048);
  });

  test('4.2 - Keyboard stepping uses 64 su and Shift+arrow uses 256 su', async ({ page }) => {
    await setWPos(page, 5120, 5120, 512);

    // Normal arrow step: 64 su.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    let wpos = await getCurrentWPos(page);
    expect(wpos.X).toBe(5120 + 64);

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    wpos = await getCurrentWPos(page);
    expect(wpos.Y).toBe(5120 + 64);

    await page.keyboard.press('PageUp');
    await page.waitForTimeout(100);
    wpos = await getCurrentWPos(page);
    expect(wpos.Z).toBe(512 + 64);

    // Shift+arrow step: 256 su.
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(100);
    wpos = await getCurrentWPos(page);
    expect(wpos.X).toBe(5120 + 64 - 256);

    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(100);
    wpos = await getCurrentWPos(page);
    expect(wpos.Y).toBe(5120 + 64 - 256);

    await page.keyboard.press('Shift+PageDown');
    await page.waitForTimeout(100);
    wpos = await getCurrentWPos(page);
    expect(wpos.Z).toBe(512 + 64 - 256);
  });

  // ===========================================================================
  // 5. 3D scene structure
  // ===========================================================================

  test('5.1 - Reference grid, axes, spheres, and dropline exist', async ({ page }) => {
    const sceneInfo = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene;
      if (!scene) throw new Error('Babylon scene not found');

      const meshNames = scene.meshes.map((m: any) => m.name);
      const posSphere = scene.getMeshByName('posSphere');
      const ghostSphere = scene.getMeshByName('ghost');
      const originSphere = scene.getMeshByName('origin');
      const ground = scene.getMeshByName('refGround');

      return {
        meshCount: scene.meshes.length,
        meshNames,
        hasPosSphere: !!posSphere,
        hasGhostSphere: !!ghostSphere,
        hasOriginSphere: !!originSphere,
        hasGround: !!ground,
        axisCount: meshNames.filter((n: string) => n === 'axis').length,
        hLineCount: meshNames.filter((n: string) => n === 'hline').length,
        vLineCount: meshNames.filter((n: string) => n === 'vline').length,
        dotCount: meshNames.filter((n: string) => n === 'dot').length,
      };
    });

    expect(sceneInfo.meshCount).toBeGreaterThan(120); // 11x11 grid + spheres + axes + markers
    expect(sceneInfo.hasPosSphere).toBe(true);
    expect(sceneInfo.hasGhostSphere).toBe(true);
    expect(sceneInfo.hasOriginSphere).toBe(true);
    expect(sceneInfo.hasGround).toBe(true);
    expect(sceneInfo.axisCount).toBe(3);
    expect(sceneInfo.hLineCount).toBe(11);
    expect(sceneInfo.vLineCount).toBe(11);
    expect(sceneInfo.dotCount).toBe(100); // 10x10 cell center markers
  });

  test('5.2 - Axis colors follow RGB=XYZ convention', async ({ page }) => {
    const axisColors = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene;
      if (!scene) throw new Error('Babylon scene not found');

      const axes = scene.meshes.filter((m: any) => m.name === 'axis');
      return axes.map((axis: any) => {
        const to = axis.getBoundingInfo()?.boundingBox?.maximumWorld ?? { x: 0, y: 0, z: 0 };
        // LinesMesh color is stored directly on the mesh.
        const color = axis.color;
        return {
          toX: to.x,
          toY: to.y,
          toZ: to.z,
          r: Math.round(color.r * 255),
          g: Math.round(color.g * 255),
          b: Math.round(color.b * 255),
        };
      });
    });

    expect(axisColors.length).toBe(3);

    // X axis points primarily along +X and is red.
    const xAxis = axisColors.find((a: any) => a.toX > a.toY && a.toX > a.toZ);
    expect(xAxis).toBeDefined();
    expect(xAxis!.r).toBeGreaterThan(200);
    expect(xAxis!.g).toBeLessThan(100);
    expect(xAxis!.b).toBeLessThan(100);

    // Y axis points primarily along +Y and is green.
    const yAxis = axisColors.find((a: any) => a.toY > a.toX && a.toY > a.toZ);
    expect(yAxis).toBeDefined();
    expect(yAxis!.g).toBeGreaterThan(200);
    expect(yAxis!.r).toBeLessThan(100);
    expect(yAxis!.b).toBeLessThan(100);

    // Z axis points primarily along +Z and is blue.
    const zAxis = axisColors.find((a: any) => a.toZ > a.toX && a.toZ > a.toY);
    expect(zAxis).toBeDefined();
    expect(zAxis!.b).toBeGreaterThan(200);
    expect(zAxis!.r).toBeLessThan(100);
    expect(zAxis!.g).toBeLessThan(100);
  });

  test('5.3 - Position sphere is orange and dropline connects to ground', async ({ page }) => {
    const sphereInfo = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene;
      const posSphere = scene.getMeshByName('posSphere');
      const dropLine = scene.meshes.find((m: any) => m.name === 'dropline');
      const posMat = posSphere?.material;
      const diff = posMat?.diffuseColor;
      return {
        posSphereExists: !!posSphere,
        dropLineExists: !!dropLine,
        r: Math.round(diff?.r * 255),
        g: Math.round(diff?.g * 255),
        b: Math.round(diff?.b * 255),
      };
    });

    expect(sphereInfo.posSphereExists).toBe(true);
    expect(sphereInfo.dropLineExists).toBe(true);
    // Orange: high red, medium green, low blue.
    expect(sphereInfo.r).toBeGreaterThan(200);
    expect(sphereInfo.g).toBeGreaterThan(100);
    expect(sphereInfo.g).toBeLessThan(150);
    expect(sphereInfo.b).toBeLessThan(80);
  });

  // ===========================================================================
  // 6. Grid toggle
  // ===========================================================================

  test('6.1 - G key toggles grid visibility within 100ms', async ({ page }) => {
    const timing = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      const scene = harness.scene;
      const ground = scene.getMeshByName('refGround');
      const before = ground?.isVisible ?? false;
      const t0 = performance.now();
      harness.toggleGrid();
      const t1 = performance.now();
      const after = ground?.isVisible ?? false;
      return { before, after, duration: t1 - t0 };
    });

    expect(timing.before).toBe(true);
    expect(timing.after).toBe(false);
    expect(timing.duration).toBeLessThan(100);

    // Toggle back on.
    await page.keyboard.press('g');
    await page.waitForTimeout(100);
    const groundVisible = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene;
      return scene.getMeshByName('refGround')?.isVisible ?? false;
    });
    expect(groundVisible).toBe(true);

    await page.screenshot({ path: evidencePath('transform-visual-6-1-grid-toggle.png'), fullPage: false });
  });

  // ===========================================================================
  // 7. Boundary — cache overflow
  // ===========================================================================

  test('7.1 - Generating >1000 unique coordinates does not crash and caps cache', async ({ page }) => {
    await clearCacheViaHarness(page);

    const result = await page.evaluate(async () => {
      const { wPosToVector3 } = await import('/src/OpenRA.Game/CoordinateTransformer.ts');
      const { WPos } = await import('/src/OpenRA.Game/WPos');
      const harness = (window as any).__testHarness;
      const start = performance.now();
      for (let i = 0; i < 1500; i++) {
        const wpos = new WPos(i * 7 % 10240, i * 13 % 10240, i * 3 % 4096);
        wPosToVector3(wpos);
      }
      const end = performance.now();
      return {
        duration: end - start,
        cacheSize: harness.getCacheSize(),
      };
    });

    expect(result.duration).toBeLessThan(5000); // generous upper bound
    expect(result.cacheSize).toBeLessThanOrEqual(1000);
    expect(result.cacheSize).toBeGreaterThanOrEqual(990); // allow minor variance

    test.info().annotations.push({
      type: 'cache-overflow',
      description: `duration=${result.duration.toFixed(1)}ms, cacheSize=${result.cacheSize}`,
    });
  });

  // ===========================================================================
  // 8. FPS stability
  // ===========================================================================

  test('8.1 - FPS counter is active in simple scene', async ({ page }) => {
    await page.waitForTimeout(1500);

    const fps = await getCurrentFps(page);
    const headless = await isHeadlessEnvironment(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `FPS=${fps.toFixed(1)}, headless=${headless}`,
    });

    // FPS is approximate in headless mode; ensure counter is updating.
    expect(fps).toBeGreaterThan(0);

    // In a real GPU environment, expect at least 55 FPS for this simple scene.
    if (!headless) {
      expect(fps).toBeGreaterThanOrEqual(55);
    }

    await page.screenshot({ path: evidencePath('transform-visual-8-1-fps.png'), fullPage: false });
  });

  test('8.2 - Rapid slider dragging keeps scene responsive', async ({ page }) => {
    await clearCacheViaHarness(page);
    const fpsBefore = await getCurrentFps(page);

    // Rapidly change all three sliders several times.
    for (let i = 0; i < 10; i++) {
      const x = (i * 1024) % 10240;
      const y = (i * 2048) % 10240;
      const z = (i * 256) % 4096;
      await page.evaluate((args) => {
        (window as any).__testHarness.setWPos(args.x, args.y, args.z);
      }, { x, y, z });
      await page.waitForTimeout(30);
    }

    const fpsAfter = await getCurrentFps(page);
    const headless = await isHeadlessEnvironment(page);

    test.info().annotations.push({
      type: 'rapid-drag',
      description: `fpsBefore=${fpsBefore.toFixed(1)}, fpsAfter=${fpsAfter.toFixed(1)}, headless=${headless}`,
    });

    expect(fpsAfter).toBeGreaterThan(0);
    if (!headless) {
      expect(fpsAfter).toBeGreaterThan(55);
    }

    await page.screenshot({ path: evidencePath('transform-visual-8-2-rapid-drag.png'), fullPage: false });
  });
});
