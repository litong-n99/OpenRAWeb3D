/**
 * test-2.spec.ts — SliderWidget: Mouse interaction verification
 *
 * Validates thumb dragging, track click snapping, boundary clamping,
 * CSS colors, and diagnostic panel consistency via real mouse input.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../../../test-results/manual/ch16-widgets/slider-control/evidence');

const TEST_URL = '/test/ch16-widgets/slider-control/';
const TRACK_WIDTH = 300;
const STEP = 5;
const TOLERANCE_PX = 2;

const COLORS = {
  fill: '#3a7bd5',
  track: '#0f3460',
};

declare global {
  interface Window {
    __testHarness: {
      setSliderValue(id: string, v: number): void;
      getSliderValue(): number;
      getThumbPosition(): number;
      getTrackFillWidth(): number;
      getStep(): number;
      reset(): void;
    };
  }
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(TEST_URL);
  await page.waitForSelector('#slider');
  await page.waitForSelector('#thumb');
  await page.waitForSelector('#fill');
  await page.waitForFunction(() => typeof window.__testHarness !== 'undefined');
  await page.evaluate(() => window.__testHarness.reset());
  await page.waitForTimeout(100);
});

async function screenshot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function getSliderValue(page: Page): Promise<number> {
  return page.evaluate(() => window.__testHarness.getSliderValue());
}

async function getThumbPosition(page: Page): Promise<number> {
  return page.evaluate(() => window.__testHarness.getThumbPosition());
}

async function getTrackFillWidth(page: Page): Promise<number> {
  return page.evaluate(() => window.__testHarness.getTrackFillWidth());
}

async function getDiagnosticValue(page: Page, id: string): Promise<number> {
  const text = await page.locator(`#${id}`).textContent();
  return parseFloat((text ?? '0').replace(/[^-\d.]/g, ''));
}

function normalizeHex(hex: string): string {
  return hex.toLowerCase().trim();
}

function hexFromRgbString(rgb: string): string {
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [];
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(m[0] ?? 0)}${toHex(m[1] ?? 0)}${toHex(m[2] ?? 0)}`;
}

async function getComputedBackground(page: Page, selector: string): Promise<string> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`Element ${selector} not found`);
    return window.getComputedStyle(el).backgroundColor;
  }, selector);
}

async function dragThumbToX(page: Page, targetX: number) {
  const track = await page.locator('#slider').boundingBox();
  if (!track) throw new Error('Track bounding box not found');

  const thumb = page.locator('#thumb');
  await thumb.hover();
  await page.mouse.down();
  await page.mouse.move(track.x + targetX, track.y + track.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function clickTrackAtX(page: Page, targetX: number) {
  const track = await page.locator('#slider').boundingBox();
  if (!track) throw new Error('Track bounding box not found');

  await page.mouse.click(track.x + targetX, track.y + track.height / 2);
  await page.waitForTimeout(100);
}

function isMultipleOfStep(v: number, step: number): boolean {
  return Math.abs(v % step) < Number.EPSILON * 100 || Math.abs((v % step) - step) < Number.EPSILON * 100;
}

// -----------------------------------------------------------------------------
// S1. Thumb moves with mouse drag
// -----------------------------------------------------------------------------

test('S1 thumb moves with mouse drag', async ({ page }) => {
  await dragThumbToX(page, 150);

  const x = await getThumbPosition(page);
  const w = await getTrackFillWidth(page);

  expect(x).toBeGreaterThanOrEqual(150 - TOLERANCE_PX);
  expect(x).toBeLessThanOrEqual(150 + TOLERANCE_PX);
  expect(Math.abs(w - x)).toBeLessThanOrEqual(TOLERANCE_PX);

  await screenshot(page, 's01-drag-to-center');
});

// -----------------------------------------------------------------------------
// S2. Track / fill colors
// -----------------------------------------------------------------------------

test('S2 fill color is #3a7bd5', async ({ page }) => {
  const fillBg = await getComputedBackground(page, '#fill');
  expect(normalizeHex(hexFromRgbString(fillBg))).toBe(COLORS.fill);
  await screenshot(page, 's02-fill-color');
});

test('S2 track color is #0f3460', async ({ page }) => {
  const trackBg = await getComputedBackground(page, '.slider-track');
  expect(normalizeHex(hexFromRgbString(trackBg))).toBe(COLORS.track);
  await screenshot(page, 's02-track-color');
});

// -----------------------------------------------------------------------------
// S3. Step snap on drag release and track click
// -----------------------------------------------------------------------------

test('S3 drag release snaps to step 5', async ({ page }) => {
  // Drag to a raw position that should snap to 45 or 50 after mouseup.
  await dragThumbToX(page, 143); // ~47.7 raw → snap to 50

  const value = await getSliderValue(page);
  expect(isMultipleOfStep(value, STEP), `value ${value} should be a multiple of ${STEP}`).toBe(true);
  expect(value).toBeGreaterThanOrEqual(45);
  expect(value).toBeLessThanOrEqual(50);

  await screenshot(page, 's03-drag-snap-143');
});

test('S3 drag release near 72px snaps to step 5', async ({ page }) => {
  await dragThumbToX(page, 72); // ~24 raw → snap to 25

  const value = await getSliderValue(page);
  expect(isMultipleOfStep(value, STEP), `value ${value} should be a multiple of ${STEP}`).toBe(true);
  expect(value).toBe(25);

  await screenshot(page, 's03-drag-snap-72');
});

test('S3 click on track snaps to step 5', async ({ page }) => {
  await clickTrackAtX(page, 143); // ~47.7 raw → snap to 50

  const value = await getSliderValue(page);
  expect(isMultipleOfStep(value, STEP), `value ${value} should be a multiple of ${STEP}`).toBe(true);
  expect(value).toBeGreaterThanOrEqual(45);
  expect(value).toBeLessThanOrEqual(50);

  await screenshot(page, 's03-click-track-143');
});

test('S3 click on track near left edge snaps to 0', async ({ page }) => {
  await clickTrackAtX(page, 2);

  const value = await getSliderValue(page);
  expect(value).toBe(0);

  await screenshot(page, 's03-click-track-left-edge');
});

test('S3 click on track near right edge snaps to 100', async ({ page }) => {
  await clickTrackAtX(page, 298);

  const value = await getSliderValue(page);
  expect(value).toBe(100);

  await screenshot(page, 's03-click-track-right-edge');
});

// -----------------------------------------------------------------------------
// S4. Bounds
// -----------------------------------------------------------------------------

test('S4 cannot drag below 0', async ({ page }) => {
  await page.evaluate(() => window.__testHarness.setSliderValue('slider', 0));
  await page.waitForTimeout(100);

  // Attempt to drag further left than the left edge.
  const track = await page.locator('#slider').boundingBox();
  if (!track) throw new Error('Track bounding box not found');

  const thumb = page.locator('#thumb');
  await thumb.hover();
  await page.mouse.down();
  await page.mouse.move(track.x - 50, track.y + track.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const value = await getSliderValue(page);
  const x = await getThumbPosition(page);

  expect(value).toBeGreaterThanOrEqual(0);
  expect(x).toBeGreaterThanOrEqual(-TOLERANCE_PX);

  await screenshot(page, 's04-drag-below-zero');
});

test('S4 cannot drag above 100', async ({ page }) => {
  await page.evaluate(() => window.__testHarness.setSliderValue('slider', 100));
  await page.waitForTimeout(100);

  // Attempt to drag further right than the right edge.
  const track = await page.locator('#slider').boundingBox();
  if (!track) throw new Error('Track bounding box not found');

  const thumb = page.locator('#thumb');
  await thumb.hover();
  await page.mouse.down();
  await page.mouse.move(track.x + track.width + 50, track.y + track.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const value = await getSliderValue(page);
  const x = await getThumbPosition(page);

  expect(value).toBeLessThanOrEqual(100);
  expect(x).toBeLessThanOrEqual(TRACK_WIDTH + TOLERANCE_PX);

  await screenshot(page, 's04-drag-above-hundred');
});

// -----------------------------------------------------------------------------
// Diagnostics panel consistency
// -----------------------------------------------------------------------------

test('Diagnostics panel consistency', async ({ page }) => {
  await dragThumbToX(page, 180);

  const harnessValue = await getSliderValue(page);
  const harnessX = await getThumbPosition(page);
  const harnessW = await getTrackFillWidth(page);

  const diagValue = await getDiagnosticValue(page, 'dV');
  const diagX = await getDiagnosticValue(page, 'dX');
  const diagW = await getDiagnosticValue(page, 'dW');
  const diagStep = await getDiagnosticValue(page, 'dS');

  expect(Math.abs(diagValue - harnessValue)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(diagX - harnessX)).toBeLessThanOrEqual(1);
  expect(Math.abs(diagW - harnessW)).toBeLessThanOrEqual(1);
  expect(diagStep).toBe(STEP);

  await screenshot(page, 'diagnostics-panel-mouse');
});
