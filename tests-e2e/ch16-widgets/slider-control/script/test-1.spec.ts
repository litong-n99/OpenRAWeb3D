/**
 * test-1.spec.ts — SliderWidget: Programmatic verification via __testHarness
 *
 * Validates the linear mapping between slider value and thumb position,
 * track fill geometry, step snapping, and boundary behavior using the
 * page's __testHarness API.
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

async function setSliderValue(page: Page, id: string, v: number) {
  return page.evaluate(({ id, v }) => window.__testHarness.setSliderValue(id, v), { id, v });
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

async function getStep(page: Page): Promise<number> {
  return page.evaluate(() => window.__testHarness.getStep());
}

async function getDiagnosticValue(page: Page, id: string): Promise<number> {
  const text = await page.locator(`#${id}`).textContent();
  return parseFloat((text ?? '0').replace(/[^-\d.]/g, ''));
}

function expectedX(value: number): number {
  return (value / 100) * TRACK_WIDTH;
}

function isMultipleOfStep(v: number, step: number): boolean {
  return Math.abs(v % step) < Number.EPSILON * 100 || Math.abs((v % step) - step) < Number.EPSILON * 100;
}

// -----------------------------------------------------------------------------
// S1. Thumb Linear Mapping
// -----------------------------------------------------------------------------

test('S1.1 linear mapping: value=0 → thumb at 0', async ({ page }) => {
  await setSliderValue(page, 'slider', 0);
  await page.waitForTimeout(100);

  const x = await getThumbPosition(page);
  expect(x).toBeGreaterThanOrEqual(0 - TOLERANCE_PX);
  expect(x).toBeLessThanOrEqual(0 + TOLERANCE_PX);

  await screenshot(page, 's01-value-0-thumb-left');
});

test('S1.2 linear mapping: value=100 → thumb at trackWidth', async ({ page }) => {
  await setSliderValue(page, 'slider', 100);
  await page.waitForTimeout(100);

  const x = await getThumbPosition(page);
  expect(x).toBeGreaterThanOrEqual(TRACK_WIDTH - TOLERANCE_PX);
  expect(x).toBeLessThanOrEqual(TRACK_WIDTH + TOLERANCE_PX);

  await screenshot(page, 's01-value-100-thumb-right');
});

test('S1.3 linear mapping: value=50 → thumb at trackWidth/2', async ({ page }) => {
  await setSliderValue(page, 'slider', 50);
  await page.waitForTimeout(100);

  const x = await getThumbPosition(page);
  expect(x).toBeGreaterThanOrEqual(TRACK_WIDTH / 2 - TOLERANCE_PX);
  expect(x).toBeLessThanOrEqual(TRACK_WIDTH / 2 + TOLERANCE_PX);

  await screenshot(page, 's01-value-50-thumb-center');
});

test('S1.4 linear mapping: random values match formula with ≤2px tolerance', async ({ page }) => {
  // Use step-aligned values so setSliderValue does not snap away from the target.
  const values = [5, 10, 20, 25, 35, 40, 55, 60, 75, 80, 90, 95];

  for (const v of values) {
    await setSliderValue(page, 'slider', v);
    await page.waitForTimeout(50);

    const x = await getThumbPosition(page);
    const expected = expectedX(v);
    expect(Math.abs(x - expected), `value=${v}: thumb X ${x}px should be close to ${expected}px`).toBeLessThanOrEqual(TOLERANCE_PX);
  }

  await screenshot(page, 's01-random-values-mapping');
});

// -----------------------------------------------------------------------------
// S2. Track Fill Width
// -----------------------------------------------------------------------------

test('S2.1 fill width equals thumb position for boundary values', async ({ page }) => {
  for (const v of [0, 50, 100]) {
    await setSliderValue(page, 'slider', v);
    await page.waitForTimeout(50);

    const x = await getThumbPosition(page);
    const w = await getTrackFillWidth(page);
    expect(Math.abs(w - x), `value=${v}: fill width ${w}px should equal thumb X ${x}px`).toBeLessThanOrEqual(TOLERANCE_PX);
  }

  await screenshot(page, 's02-boundary-fill-widths');
});

test('S2.2 fill width equals thumb position for random values', async ({ page }) => {
  // Use step-aligned values so setSliderValue does not snap away from the target.
  const values = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];

  for (const v of values) {
    await setSliderValue(page, 'slider', v);
    await page.waitForTimeout(50);

    const x = await getThumbPosition(page);
    const w = await getTrackFillWidth(page);
    expect(Math.abs(w - x), `value=${v}: fill width ${w}px should equal thumb X ${x}px`).toBeLessThanOrEqual(TOLERANCE_PX);
  }

  await screenshot(page, 's02-random-fill-widths');
});

// -----------------------------------------------------------------------------
// S3. Step Snap
// -----------------------------------------------------------------------------

test('S3.1 setSliderValue always snaps to step=5 multiples', async ({ page }) => {
  const rawValues = [1, 2, 4, 7, 11, 13, 18, 22, 26, 31, 37, 43, 49, 52, 58, 63, 67, 71, 77, 82, 86, 93, 97, 99];

  for (const v of rawValues) {
    await setSliderValue(page, 'slider', v);
    await page.waitForTimeout(50);

    const snapped = await getSliderValue(page);
    expect(isMultipleOfStep(snapped, STEP), `value=${v} should snap to a multiple of 5, got ${snapped}`).toBe(true);
  }

  await screenshot(page, 's03-step-snap-multiples');
});

test('S3.2 getSliderValue returns snapped values after setSliderValue', async ({ page }) => {
  const cases = [
    { raw: 2, expected: 0 },
    { raw: 3, expected: 5 },
    { raw: 7, expected: 5 },
    { raw: 8, expected: 10 },
    { raw: 47, expected: 45 },
    { raw: 48, expected: 50 },
    { raw: 96, expected: 95 },
    { raw: 99, expected: 100 },
  ];

  for (const { raw, expected } of cases) {
    await setSliderValue(page, 'slider', raw);
    await page.waitForTimeout(50);

    const actual = await getSliderValue(page);
    expect(actual).toBe(expected);
  }

  await screenshot(page, 's03-snapped-values');
});

// -----------------------------------------------------------------------------
// S4. Bounds
// -----------------------------------------------------------------------------

test('S4.1 value=0 is valid (lower bound)', async ({ page }) => {
  await setSliderValue(page, 'slider', 0);
  await page.waitForTimeout(100);

  const value = await getSliderValue(page);
  const x = await getThumbPosition(page);

  expect(value).toBe(0);
  expect(x).toBeGreaterThanOrEqual(-TOLERANCE_PX);
  expect(x).toBeLessThanOrEqual(TOLERANCE_PX);

  await screenshot(page, 's04-lower-bound');
});

test('S4.2 value=100 is valid (upper bound)', async ({ page }) => {
  await setSliderValue(page, 'slider', 100);
  await page.waitForTimeout(100);

  const value = await getSliderValue(page);
  const x = await getThumbPosition(page);

  expect(value).toBe(100);
  expect(x).toBeGreaterThanOrEqual(TRACK_WIDTH - TOLERANCE_PX);
  expect(x).toBeLessThanOrEqual(TRACK_WIDTH + TOLERANCE_PX);

  await screenshot(page, 's04-upper-bound');
});

// -----------------------------------------------------------------------------
// Diagnostics panel consistency
// -----------------------------------------------------------------------------

test('Diagnostic panel dV/dX/dW/dS match harness values', async ({ page }) => {
  for (const v of [0, 25, 50, 75, 100]) {
    await setSliderValue(page, 'slider', v);
    await page.waitForTimeout(50);

    const harnessValue = await getSliderValue(page);
    const harnessX = await getThumbPosition(page);
    const harnessW = await getTrackFillWidth(page);
    const harnessStep = await getStep(page);

    const diagValue = await getDiagnosticValue(page, 'dV');
    const diagX = await getDiagnosticValue(page, 'dX');
    const diagW = await getDiagnosticValue(page, 'dW');
    const diagStep = await getDiagnosticValue(page, 'dS');

    expect(Math.abs(diagValue - harnessValue)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(diagX - harnessX)).toBeLessThanOrEqual(1);
    expect(Math.abs(diagW - harnessW)).toBeLessThanOrEqual(1);
    expect(diagStep).toBe(harnessStep);
  }

  await screenshot(page, 'diagnostic-panel-consistency');
});
