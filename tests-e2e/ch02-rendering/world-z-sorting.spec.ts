import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch02-rendering/world-z-sorting/';
const SNAPSHOT_DIR = 'test-results/manual/ch02-rendering/world-z-sorting';
const EVIDENCE_DIR = `${SNAPSHOT_DIR}/evidence`;

const SPRITE_BASE_Y = {
  A: -1.0,
  B: 0.0,
  C: 1.0,
};

function calcSortKey(y: number, z: number, zOffset: number): number {
  return y + z + zOffset;
}

function evidenceFile(name: string): string {
  const dir = path.resolve(EVIDENCE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

async function isHeadless(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function setSlider(page: any, id: string, value: number): Promise<void> {
  await page.evaluate((opts: { id: string; value: number }) => {
    const slider = document.getElementById(opts.id) as HTMLInputElement | null;
    if (!slider) throw new Error(`Slider #${opts.id} not found`);
    slider.value = String(opts.value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

async function getSliderValue(page: any, id: string): Promise<number> {
  const text = await page.locator(`#${id}`).inputValue();
  return parseFloat(text || '0');
}

async function getDisplayedValue(page: any, id: string): Promise<number> {
  const text = await page.locator(`#${id}`).textContent();
  return parseFloat((text || '0').replace('−', '-'));
}

async function getSortKeys(page: any): Promise<{ A: number; B: number; C: number }> {
  const [a, b, c] = await Promise.all([
    page.locator('#state-key-a').textContent(),
    page.locator('#state-key-b').textContent(),
    page.locator('#state-key-c').textContent(),
  ]);
  return {
    A: parseFloat((a || '0').replace('−', '-')),
    B: parseFloat((b || '0').replace('−', '-')),
    C: parseFloat((c || '0').replace('−', '-')),
  };
}

test.use({ snapshotDir: SNAPSHOT_DIR });

test.describe('Ch02 World Z-Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForSelector('#info-engine', { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el && el.textContent?.includes('Babylon.js');
    }, { timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  test('test-1: default state sortKey order (A < B < C)', async ({ page }) => {
    const gpuError = page.locator('#gpu-error');
    await expect(gpuError).toHaveCSS('display', 'none');

    const keys = await getSortKeys(page);
    expect(keys.A, 'sprite A sortKey should be -1.000').toBeCloseTo(-1.0, 3);
    expect(keys.B, 'sprite B sortKey should be 0.000').toBeCloseTo(0.0, 3);
    expect(keys.C, 'sprite C sortKey should be 1.000').toBeCloseTo(1.0, 3);

    const order = await page.locator('#state-order').textContent();
    expect(order?.trim()).toBe('A → B → C');

    await page.screenshot({ path: evidenceFile('test-1-default-state.png') });
  });

  test('test-2: Y offset shifts sortKey uniformly', async ({ page }) => {
    await setSlider(page, 'y-slider', 0.1);
    await page.waitForTimeout(100);

    const yVal = await getDisplayedValue(page, 'y-val');
    expect(yVal, 'Y offset display should be 0.10').toBeCloseTo(0.1, 2);

    const keys = await getSortKeys(page);
    const expectedA = calcSortKey(SPRITE_BASE_Y.A + 0.1, 0, 0);
    const expectedB = calcSortKey(SPRITE_BASE_Y.B + 0.1, 0, 0);
    const expectedC = calcSortKey(SPRITE_BASE_Y.C + 0.1, 0, 0);

    expect(keys.A, 'sprite A sortKey should increase by 0.1').toBeCloseTo(expectedA, 3);
    expect(keys.B, 'sprite B sortKey should increase by 0.1').toBeCloseTo(expectedB, 3);
    expect(keys.C, 'sprite C sortKey should increase by 0.1').toBeCloseTo(expectedC, 3);

    const order = await page.locator('#state-order').textContent();
    expect(order?.trim()).toBe('A → B → C');

    await page.screenshot({ path: evidenceFile('test-2-y-offset-0.1.png') });
  });

  test('test-3: Z height and ZOffset contribute equal weight', async ({ page }) => {
    await setSlider(page, 'z-slider', 0.1);
    await page.waitForTimeout(100);

    const zVal = await getDisplayedValue(page, 'z-val');
    expect(zVal, 'Z height display should be 0.10').toBeCloseTo(0.1, 2);

    let keys = await getSortKeys(page);
    expect(keys.A, 'Z +0.1 should add 0.1 to A sortKey').toBeCloseTo(-0.9, 3);
    expect(keys.B, 'Z +0.1 should add 0.1 to B sortKey').toBeCloseTo(0.1, 3);
    expect(keys.C, 'Z +0.1 should add 0.1 to C sortKey').toBeCloseTo(1.1, 3);

    await page.screenshot({ path: evidenceFile('test-3a-z-height-0.1.png') });

    await setSlider(page, 'zoffset-slider', 0.1);
    await page.waitForTimeout(100);

    const zOffsetVal = await getDisplayedValue(page, 'zoffset-val');
    expect(zOffsetVal, 'ZOffset display should be 0.10').toBeCloseTo(0.1, 2);

    keys = await getSortKeys(page);
    expect(keys.A, 'Z +0.1 and ZOffset +0.1 should add 0.2 to A sortKey').toBeCloseTo(-0.8, 3);
    expect(keys.B, 'Z +0.1 and ZOffset +0.1 should add 0.2 to B sortKey').toBeCloseTo(0.2, 3);
    expect(keys.C, 'Z +0.1 and ZOffset +0.1 should add 0.2 to C sortKey').toBeCloseTo(1.2, 3);

    const order = await page.locator('#state-order').textContent();
    expect(order?.trim()).toBe('A → B → C');

    await page.screenshot({ path: evidenceFile('test-3b-z-and-zoffset-0.1.png') });
  });

  test('test-4: FPS >= 55 (headless >= 45)', async ({ page }) => {
    await page.waitForTimeout(2500);

    const fpsText = await page.locator('#info-fps').textContent();
    const fps = parseInt(fpsText || '0', 10);
    expect(fps, 'FPS display should be a positive number').toBeGreaterThan(0);

    const headless = await isHeadless(page);
    test.info().annotations.push({
      type: 'fps-note',
      description: `FPS=${fps}, headless=${headless}. FPS readings in headless mode can be unreliable due to software rendering and throttling; manual verification is recommended.`,
    });

    if (headless) {
      expect(fps, `FPS ${fps} should be >= 45 in headless mode`).toBeGreaterThanOrEqual(45);
    } else {
      expect(fps, `FPS ${fps} should be >= 55 in headed mode`).toBeGreaterThanOrEqual(55);
    }
  });

  test('test-5: reset button restores all parameters', async ({ page }) => {
    await setSlider(page, 'y-slider', 0.1);
    await setSlider(page, 'z-slider', 0.1);
    await setSlider(page, 'zoffset-slider', 0.1);
    await page.waitForTimeout(100);

    let keys = await getSortKeys(page);
    expect(keys.A).toBeCloseTo(-0.7, 3);
    expect(keys.B).toBeCloseTo(0.3, 3);
    expect(keys.C).toBeCloseTo(1.3, 3);

    await page.click('#reset-params');
    await page.waitForTimeout(100);

    const ySliderVal = await getSliderValue(page, 'y-slider');
    const zSliderVal = await getSliderValue(page, 'z-slider');
    const zOffsetSliderVal = await getSliderValue(page, 'zoffset-slider');
    expect(ySliderVal).toBeCloseTo(0, 2);
    expect(zSliderVal).toBeCloseTo(0, 2);
    expect(zOffsetSliderVal).toBeCloseTo(0, 2);

    const yVal = await getDisplayedValue(page, 'y-val');
    const zVal = await getDisplayedValue(page, 'z-val');
    const zOffsetVal = await getDisplayedValue(page, 'zoffset-val');
    expect(yVal).toBeCloseTo(0, 2);
    expect(zVal).toBeCloseTo(0, 2);
    expect(zOffsetVal).toBeCloseTo(0, 2);

    keys = await getSortKeys(page);
    expect(keys.A, 'reset should restore A sortKey to -1.000').toBeCloseTo(-1.0, 3);
    expect(keys.B, 'reset should restore B sortKey to 0.000').toBeCloseTo(0.0, 3);
    expect(keys.C, 'reset should restore C sortKey to 1.000').toBeCloseTo(1.0, 3);

    const order = await page.locator('#state-order').textContent();
    expect(order?.trim()).toBe('A → B → C');

    await page.screenshot({ path: evidenceFile('test-5-after-reset.png') });
  });

  test('test-6: hide sort key labels checkbox', async ({ page }) => {
    const checkbox = page.locator('#show-sort-keys');
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await page.waitForTimeout(100);

    await expect(checkbox).not.toBeChecked();

    // DOM state should still update correctly even when labels are hidden.
    await setSlider(page, 'y-slider', 0.1);
    await page.waitForTimeout(100);

    const keys = await getSortKeys(page);
    expect(keys.A, 'DOM sortKey should still update when labels are hidden').toBeCloseTo(-0.9, 3);
    expect(keys.B).toBeCloseTo(0.1, 3);
    expect(keys.C).toBeCloseTo(1.1, 3);

    test.info().annotations.push({
      type: 'visual-note',
      description: 'Sort-key label visibility is rendered on the Babylon.js canvas; verify via screenshot/evidence that the key labels disappear when the checkbox is unchecked.',
    });

    await page.screenshot({ path: evidenceFile('test-6-hide-sort-key-labels.png') });
  });
});
