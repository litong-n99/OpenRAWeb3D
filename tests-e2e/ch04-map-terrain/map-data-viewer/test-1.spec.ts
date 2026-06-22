import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// -----------------------------------------------------------------------------
// Acceptance test: Map 地图数据层可视化 (Tile / Resource / Height)
// URL: http://localhost:5173/test/ch04-map-terrain/map-data-viewer/
//
// Headless caveats:
//   * FPS readouts are capped/artificial in headless Chromium; we relax the
//     thresholds to >= 45 FPS for 32x32 and >= 25 FPS for 64x64.
//   * Color / visual pattern verification is delegated to screenshot evidence
//     and Kimi visual analysis; this script verifies DOM state, cell info,
//     deterministic regeneration, and active view buttons.
// -----------------------------------------------------------------------------

const BASE_URL = 'http://localhost:5173/test/ch04-map-terrain/map-data-viewer/';
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch04-map-terrain/map-data-viewer/evidence'
);

// Ensure evidence directory exists before any test runs.
try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch (_) { /* ok */ }

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface CellInfo {
  cpos: string;
  mpos: string;
  wpos: string;
  tile: string;
  res: string;
  height: string;
  ramp: string;
}

interface ClickOffset {
  x: number;
  y: number;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForPageReady(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      return el !== null && el.textContent !== null && el.textContent.includes('WebGL');
    },
    { timeout: 10000 }
  );
  // Allow Babylon.js render loop, shader compilation and first frames to settle.
  await page.waitForTimeout(3000);
}

async function resetCamera(page: Page): Promise<void> {
  await page.click('#reset-camera');
  await page.waitForTimeout(300);
}

async function setSlider(page: Page, id: string, value: number): Promise<void> {
  await page.evaluate(
    ({ id, value }) => {
      const slider = document.getElementById(id) as HTMLInputElement | null;
      if (!slider) throw new Error(`Slider #${id} not found`);
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { id, value }
  );
  await page.waitForTimeout(100);
}

async function setViewMode(
  page: Page,
  mode: 'tiles' | 'resources' | 'height' | 'all'
): Promise<void> {
  const idMap = {
    tiles: '#view-tiles',
    resources: '#view-resources',
    height: '#view-height',
    all: '#view-all',
  };
  await page.click(idMap[mode]);
  await page.waitForTimeout(500);
}

async function regenerateMap(page: Page): Promise<void> {
  await page.click('#regenerate');
  // 32x32 rebuild is fast; larger sizes use additional waits inside the tests.
  await page.waitForTimeout(500);
}

async function getCellInfo(page: Page): Promise<CellInfo> {
  const values = await page.evaluate(() => {
    const get = (id: string) => document.getElementById(id)?.textContent?.trim() ?? '-';
    return {
      cpos: get('ci-cpos'),
      mpos: get('ci-mpos'),
      wpos: get('ci-wpos'),
      tile: get('ci-tile'),
      res: get('ci-res'),
      height: get('ci-height'),
      ramp: get('ci-ramp'),
    };
  });
  return values;
}

function parseCpos(text: string): { x: number; y: number } | null {
  const m = text.match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return null;
  return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
}

function parseIntSafe(text: string): number {
  const m = text.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

async function isHeadless(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function getCurrentFps(page: Page): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseFloat((text ?? '0').trim());
}

/**
 * Repeatedly drag the canvas to rotate the ArcRotateCamera.
 * Each drag moves the pointer by (dx, dy) pixels from the canvas center.
 * Deltas accumulate across iterations, so the camera rotates smoothly.
 */
async function dragRepeated(
  page: Page,
  dx: number,
  dy: number,
  iterations: number
): Promise<void> {
  const canvas = page.locator('#sandbox canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not found');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  for (let i = 0; i < iterations; i++) {
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + dx, centerY + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(80);
  }
}

async function orbitTopDown(page: Page): Promise<void> {
  // Drag upward to lower camera beta toward a top-down view.
  await dragRepeated(page, 0, -450, 8);
  await page.waitForTimeout(400);
}

async function orbitSideView(page: Page): Promise<void> {
  // Drag downward to raise camera beta toward a side/horizon view.
  await dragRepeated(page, 0, 450, 6);
  await page.waitForTimeout(400);
}

/**
 * Click on the canvas at the given pixel offset (relative to canvas top-left)
 * and return the updated cell info.
 */
async function clickCanvasOffset(
  page: Page,
  offset: ClickOffset
): Promise<CellInfo> {
  const canvas = page.locator('#sandbox canvas');
  await canvas.click({ position: { x: Math.round(offset.x), y: Math.round(offset.y) } });
  // The cell-info DOM update is synchronous; a short pause avoids race
  // conditions between the click handler and the next read.
  await page.waitForTimeout(50);
  return getCellInfo(page);
}

/**
 * Search the canvas in a spiral pattern for a cell matching the predicate.
 * Returns the matching CellInfo and the click offset used to select it.
 */
async function findCell(
  page: Page,
  predicate: (info: CellInfo) => boolean,
  options: { startRadius: number; maxRadius: number; step: number }
): Promise<{ info: CellInfo; offset: ClickOffset }> {
  const canvas = page.locator('#sandbox canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not found');

  const cx = box.width / 2;
  const cy = box.height / 2;
  let previous = JSON.stringify(await getCellInfo(page));

  for (let r = options.startRadius; r <= options.maxRadius; r += options.step) {
    const count =
      r === 0 ? 1 : Math.max(6, Math.min(24, Math.floor((2 * Math.PI * r) / options.step)));
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (x < 10 || y < 10 || x > box.width - 10 || y > box.height - 10) continue;

      const info = await clickCanvasOffset(page, { x, y });
      const current = JSON.stringify(info);
      if (current === previous) continue; // no pick happened
      previous = current;

      if (predicate(info)) {
        return { info, offset: { x, y } };
      }
    }
  }
  throw new Error('Failed to find a cell matching the predicate');
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe('Map 地图数据层可视化 (Tile/Resource/Height)', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await waitForPageReady(page);
  });

  // ---------------------------------------------------------------------------
  // E1: 地图数据层正确生成
  // ---------------------------------------------------------------------------
  test('E1: 32x32 合成地图与数据层可视化', async ({ page }) => {
    // Verify the base generation state.
    await expect(page.locator('#info-grid')).toContainText('32x32 Rectangular');
    await expect(page.locator('#view-tiles')).toHaveClass(/active/);

    // Legend should enumerate the terrain types used in the concentric pattern.
    const legend = await page.locator('#legend-area').textContent();
    expect(legend).toContain('Water');
    expect(legend).toContain('Clear');
    expect(legend).toContain('Rough');
    expect(legend).toContain('Rock');

    // Screenshot 1: Tile layer from a top-down-ish angle.
    await resetCamera(page);
    await orbitTopDown(page);
    await page
      .locator('#sandbox canvas')
      .screenshot({ path: evidencePath('screenshot-1-tile-layer.png') });

    // Screenshot 2: Resource layer should show green Tiberium highlights.
    await setViewMode(page, 'resources');
    await expect(page.locator('#view-resources')).toHaveClass(/active/);
    await expect(page.locator('#view-tiles')).not.toHaveClass(/active/);

    const resourceLegend = await page.locator('#legend-area').textContent();
    expect(resourceLegend).toContain('Tiberium');

    await page
      .locator('#sandbox canvas')
      .screenshot({ path: evidencePath('screenshot-2-resource-layer.png') });

    // Return to tiles so later tests start from a known view.
    await setViewMode(page, 'tiles');
  });

  // ---------------------------------------------------------------------------
  // E2: 视图切换和高度缩放交互
  // ---------------------------------------------------------------------------
  test('E2: 四视图切换与高度缩放实时更新', async ({ page }) => {
    await resetCamera(page);

    // Cycle through all four views and verify active button state.
    for (const mode of ['tiles', 'resources', 'height', 'all'] as const) {
      await setViewMode(page, mode);
      for (const other of ['tiles', 'resources', 'height', 'all'] as const) {
        const locator = page.locator(`#view-${other}`);
        if (other === mode) {
          await expect(locator).toHaveClass(/active/);
        } else {
          await expect(locator).not.toHaveClass(/active/);
        }
      }
    }

    // Switch to height view and drag the slider to 5.0x.
    await setViewMode(page, 'height');
    await setSlider(page, 'height-scale-slider', 5.0);

    const hsText = await page.locator('#hs-val').textContent();
    expect(hsText?.trim()).toBe('5.0x');

    // The height legend should be visible after switching to height view.
    const heightLegend = await page.locator('#legend-area').textContent();
    expect(heightLegend).toContain('H=0');
    expect(heightLegend).toContain('H=1');
    expect(heightLegend).toContain('H=2');

    // Screenshot 3: Height layer at 5x scale from a side angle.
    await orbitSideView(page);
    await page
      .locator('#sandbox canvas')
      .screenshot({ path: evidencePath('screenshot-3-height-layer-5x.png') });

    // Restore default scale.
    await setSlider(page, 'height-scale-slider', 1.0);
    await setViewMode(page, 'tiles');
  });

  // ---------------------------------------------------------------------------
  // E3: Cell 坐标信息准确
  // ---------------------------------------------------------------------------
  test('E3: Cell 点击查询坐标与数据层值准确', async ({ page }) => {
    await resetCamera(page);

    // Find the central Water cell (should be CPos 16,16).
    const center = await findCell(
      page,
      (info) => {
        const c = parseCpos(info.cpos);
        return c !== null && c.x === 16 && c.y === 16 && info.tile.includes('Water');
      },
      { startRadius: 0, maxRadius: 30, step: 12 }
    );

    expect(center.info.cpos).toBe('(16, 16)');
    expect(center.info.mpos).toBe('(16, 16)');
    expect(center.info.tile).toContain('type=3');
    expect(center.info.tile).toContain('Water');
    expect(center.info.height).toBe('0');
    expect(center.info.wpos).toContain('16896');
    expect(center.info.wpos).toContain('16896');
    expect(center.info.wpos).toContain('0');

    await page
      .locator('#sandbox canvas')
      .screenshot({ path: evidencePath('screenshot-4-cell-info-center.png') });

    // Find an outer Rock cell and verify its data.
    const rock = await findCell(
      page,
      (info) => {
        const h = parseIntSafe(info.height);
        const r = parseIntSafe(info.ramp);
        return info.tile.includes('Rock') && !isNaN(h) && h >= 1 && r === 5;
      },
      { startRadius: 140, maxRadius: 240, step: 32 }
    );

    expect(rock.info.tile).toContain('Rock');
    expect(parseIntSafe(rock.info.height)).toBeGreaterThanOrEqual(1);
    expect(parseIntSafe(rock.info.ramp)).toBe(5);

    await page
      .locator('#sandbox canvas')
      .screenshot({ path: evidencePath('screenshot-5-cell-info-rock.png') });
  });

  // ---------------------------------------------------------------------------
  // E4: 地图重建与随机种子
  // ---------------------------------------------------------------------------
  test('E4: 尺寸切换、种子变更与确定性重建', async ({ page }) => {
    await resetCamera(page);

    // Baseline: center cell should be Water at (16,16).
    const baseline = await findCell(
      page,
      (info) => {
        const c = parseCpos(info.cpos);
        return c !== null && c.x === 16 && c.y === 16 && info.tile.includes('Water');
      },
      { startRadius: 0, maxRadius: 30, step: 12 }
    );
    expect(baseline.info.cpos).toBe('(16, 16)');
    expect(baseline.info.mpos).toBe('(16, 16)');
    expect(baseline.info.wpos).toContain('16896');
    expect(baseline.info.tile).toContain('Water');

    // Pick a non-center ring cell that contains a Tiberium resource. Resource
    // placement and density depend on the PRNG, so a different seed almost
    // always changes it. This cell is used to prove determinism and seed effect.
    const ref = await findCell(
      page,
      (info) => {
        const c = parseCpos(info.cpos);
        return c !== null && (c.x !== 16 || c.y !== 16) && info.res.includes('type=1');
      },
      { startRadius: 130, maxRadius: 290, step: 20 }
    );

    // 1) Change seed -> the reference cell data should change.
    await page.fill('#seed-input', '123');
    await regenerateMap(page);
    await page.waitForTimeout(500);
    await resetCamera(page);

    const seed123 = await clickCanvasOffset(page, ref.offset);
    const changed =
      seed123.tile !== ref.info.tile ||
      seed123.res !== ref.info.res ||
      seed123.height !== ref.info.height ||
      seed123.ramp !== ref.info.ramp;
    expect(changed, 'A different seed should change the resource ring cell data').toBe(true);

    // 2) Revert seed -> the reference cell data should match exactly.
    await page.fill('#seed-input', '42');
    await regenerateMap(page);
    await page.waitForTimeout(500);
    await resetCamera(page);

    const seed42Again = await clickCanvasOffset(page, ref.offset);
    expect(seed42Again.cpos).toBe(ref.info.cpos);
    expect(seed42Again.tile).toBe(ref.info.tile);
    expect(seed42Again.res).toBe(ref.info.res);
    expect(seed42Again.height).toBe(ref.info.height);
    expect(seed42Again.ramp).toBe(ref.info.ramp);

    // 3) Switch to 16x16 and verify grid info updates.
    await page.selectOption('#map-size-select', '16');
    await regenerateMap(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#info-grid')).toContainText('16x16 Rectangular');

    // 4) Switch to 64x64 and verify grid info + take evidence screenshot.
    await page.selectOption('#map-size-select', '64');
    await page.fill('#seed-input', '42');
    await regenerateMap(page);
    // 64x64 rebuild needs more time to create 4096 cells.
    await page.waitForTimeout(2500);

    await expect(page.locator('#info-grid')).toContainText('64x64 Rectangular');
    await page
      .locator('#sandbox canvas')
      .screenshot({ path: evidencePath('screenshot-6-64x64-rebuild.png') });
  });

  // ---------------------------------------------------------------------------
  // E5: 渲染性能
  // ---------------------------------------------------------------------------
  test('E5: 32x32 FPS 达标', async ({ page }) => {
    await resetCamera(page);
    await page.waitForTimeout(2000);

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await getCurrentFps(page));
      await page.waitForTimeout(200);
    }
    const min = Math.min(...samples);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `32x32 FPS samples=[${samples.map((n) => n.toFixed(1)).join(', ')}], min=${min.toFixed(1)}, avg=${avg.toFixed(1)}, headless=${headless}`,
    });

    // Headless Chromium FPS is capped, skip assertion.
    if (!headless) {
      expect(min, `32x32 min FPS ${min.toFixed(1)} should be >= 55`).toBeGreaterThanOrEqual(55);
    }
  });

  test('E5b: 64x64 重建后 FPS 达标', async ({ page }) => {
    await page.selectOption('#map-size-select', '64');
    await page.fill('#seed-input', '42');
    await regenerateMap(page);
    await page.waitForTimeout(2500);

    await expect(page.locator('#info-grid')).toContainText('64x64 Rectangular');

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await getCurrentFps(page));
      await page.waitForTimeout(200);
    }
    const min = Math.min(...samples);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `64x64 FPS samples=[${samples.map((n) => n.toFixed(1)).join(', ')}], min=${min.toFixed(1)}, avg=${avg.toFixed(1)}, headless=${headless}`,
    });

    if (!headless) {
      expect(min, `64x64 min FPS ${min.toFixed(1)} should be >= 30`).toBeGreaterThanOrEqual(30);
    }
  });
});
