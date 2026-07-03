import { expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// -----------------------------------------------------------------------------
// Shared helpers for the Ch16 RadarWidget Canvas minimap acceptance tests.
// URL: http://localhost:5173/test/ch16-widgets/radar/
// -----------------------------------------------------------------------------

export const TEST_PATH = '/test/ch16-widgets/radar/';
export const MAP_CELLS_W = 64;
export const MAP_CELLS_H = 48;
export const RADAR_SCALE = 4;
export const RADAR_W = MAP_CELLS_W * RADAR_SCALE; // 256
export const RADAR_H = MAP_CELLS_H * RADAR_SCALE; // 192

export const VIS_NONE = 0;
export const VIS_FOG = 1;
export const VIS_VISIBLE = 2;

export interface MockActor {
  x: number;
  y: number;
  ownerId: number;
  color: [number, number, number];
  size: number;
}

export interface Harness {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  terrainGrid: string[];
  visibilityGrid: number[];
  mockActors: MockActor[];
  viewportX: number;
  viewportY: number;
  viewportW: number;
  viewportH: number;
  renderMinimap(): void;
  updateStatus(): void;
  getCellColor(cx: number, cy: number): {
    terrain: string;
    color: [number, number, number, number];
    visibility: number;
  } | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../../test-results/manual/ch16-widgets/radar/evidence'
);

export function ensureEvidenceDir(): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

export async function gotoRadar(page: Page): Promise<void> {
  await page.goto(TEST_PATH);
  await page.waitForSelector('#radar-canvas', { state: 'visible' });
  await expect(page.locator('#st-map-size')).toContainText('64 x 48 cells');
  await expect(page.locator('#st-radar-px')).toContainText('256 x 192 px (4x scale)');
}

export async function screenshot(page: Page, name: string): Promise<void> {
  ensureEvidenceDir();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

export async function getHarness(page: Page): Promise<Harness> {
  return page.evaluate(() => (window as any).__testHarness as Harness);
}

/** Read a single canvas pixel (RGBA) at the given radar-pixel coordinate. */
export async function getPixel(
  page: Page,
  x: number,
  y: number
): Promise<[number, number, number, number]> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.getElementById('radar-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}

/** Compare an RGBA pixel to an expected color with a per-channel tolerance. */
export function expectColor(
  actual: [number, number, number, number],
  expected: [number, number, number, number],
  tolerance = 5,
  label = 'color'
): void {
  expect.soft(Math.abs(actual[0] - expected[0]), `${label} R`).toBeLessThanOrEqual(tolerance);
  expect.soft(Math.abs(actual[1] - expected[1]), `${label} G`).toBeLessThanOrEqual(tolerance);
  expect.soft(Math.abs(actual[2] - expected[2]), `${label} B`).toBeLessThanOrEqual(tolerance);
  expect.soft(Math.abs(actual[3] - expected[3]), `${label} A`).toBeLessThanOrEqual(tolerance);
}

/** Find the first cell that matches a terrain type and optional visibility state. */
export async function findCell(
  page: Page,
  terrain: string,
  visibility?: number
): Promise<{ cx: number; cy: number }> {
  return page.evaluate(
    ({ terrain, visibility }) => {
      const h = (window as any).__testHarness as Harness;
      for (let cy = 0; cy < 48; cy++) {
        for (let cx = 0; cx < 64; cx++) {
          const info = h.getCellColor(cx, cy);
          if (
            info &&
            info.terrain === terrain &&
            (visibility === undefined || info.visibility === visibility)
          ) {
            return { cx, cy };
          }
        }
      }
      throw new Error(`No ${terrain} cell${visibility !== undefined ? ` with visibility ${visibility}` : ''} found`);
    },
    { terrain, visibility }
  );
}

/** Return the viewport rectangle currently shown in the status panel. */
export async function getViewportFromDOM(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const text = await page.locator('#st-viewport-rect').textContent();
  const m = (text ?? '').match(/\((\d+),\s*(\d+)\)\s*(\d+)x(\d+)/);
  if (!m) throw new Error(`Cannot parse viewport rect: ${text}`);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}

/** Return the three shroud counters from the status panel. */
export async function getCounts(page: Page): Promise<{ visible: number; fog: number; shroud: number }> {
  const [v, f, s] = await Promise.all([
    page.locator('#st-visible-cells').textContent(),
    page.locator('#st-fog-cells').textContent(),
    page.locator('#st-shroud-cells').textContent(),
  ]);
  return {
    visible: parseInt(v ?? '0', 10),
    fog: parseInt(f ?? '0', 10),
    shroud: parseInt(s ?? '0', 10),
  };
}

/** Return the bounding box of the radar canvas. */
export async function getCanvasBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('#radar-canvas').boundingBox();
  if (!box) throw new Error('Radar canvas bounding box not found');
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** Convert a cell coordinate to the pixel coordinate of the cell's centre. */
export function cellToPixel(cx: number, cy: number): { x: number; y: number } {
  return {
    x: cx * RADAR_SCALE + RADAR_SCALE / 2,
    y: cy * RADAR_SCALE + RADAR_SCALE / 2,
  };
}
