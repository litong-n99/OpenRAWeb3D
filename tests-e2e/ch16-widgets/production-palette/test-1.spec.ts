import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, './evidence');

const COLORS = {
  buildableBg: '#0d2a4a',
  queuedBg: '#1e4d7a',
  hotkeyGold: '#ffd700',
  white: '#ffffff',
};

type TestHarness = {
  palette: {
    columns: number;
    iconWidth: number;
    iconHeight: number;
    iconMarginX: number;
    iconMarginY: number;
    displayedIconCount: number;
  };
  mockQueue: {
    allQueued: () => Array<{
      item: string;
      totalCost: number;
      remainingCost: number;
      done: boolean;
      paused: boolean;
      infinite: boolean;
    }>;
  };
  mockQueuedItems: Array<{
    item: string;
    totalCost: number;
    remainingCost: number;
    done: boolean;
    paused: boolean;
    infinite: boolean;
  }>;
  mockActors: Array<{ name: string }>;
  rebuildIcons: () => void;
  mountWidget: () => void;
  getClockAngles: () => Record<string, string>;
};

declare global {
  interface Window {
    __testHarness: TestHarness;
  }
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto('/test/ch16-widgets/production-palette/');
  await page.waitForSelector('#palette-container .production-palette-widget');
  // Ensure the harness is in its initial state for every test.
  await page.click('#btn-reset');
  await page.waitForTimeout(150);
});

async function screenshot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

function normalizeHex(hex: string): string {
  return hex.toLowerCase().trim();
}

function hexFromRgbString(rgb: string): string {
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [];
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(m[0] ?? 0)}${toHex(m[1] ?? 0)}${toHex(m[2] ?? 0)}`;
}

async function getComputedBackground(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`Element ${selector} not found`);
    return window.getComputedStyle(el).backgroundColor;
  }, selector);
}

async function getComputedColor(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`Element ${selector} not found`);
    return window.getComputedStyle(el).color;
  }, selector);
}

async function expectBackground(page: Page, selector: string, expectedHex: string) {
  const bg = await getComputedBackground(page, selector);
  expect(normalizeHex(hexFromRgbString(bg))).toBe(normalizeHex(expectedHex));
}

async function expectColor(page: Page, selector: string, expectedHex: string) {
  const color = await getComputedColor(page, selector);
  expect(normalizeHex(hexFromRgbString(color))).toBe(normalizeHex(expectedHex));
}

function extractConicAngle(background: string): number | null {
  const match = background.match(/conic-gradient\([^)]*(\d+(?:\.\d+)?)deg/);
  return match ? parseFloat(match[1]) : null;
}

async function getCell(page: Page, name: string) {
  return page.locator(`.production-icon-cell[data-icon-name="${name}"]`);
}

// -----------------------------------------------------------------------------
// P1. Page load & harness presence
// -----------------------------------------------------------------------------

test('P1.1: page loads with 12 icon cells and status panel values', async ({ page }) => {
  const cells = page.locator('.production-icon-cell');
  await expect(cells).toHaveCount(12);

  const iconCount = await page.locator('#st-icon-count').textContent();
  const queueCount = await page.locator('#st-queue-count').textContent();
  expect(iconCount).toBe('12');
  expect(queueCount).toBe('6');

  await screenshot(page, 'p01-page-load');
});

test('P1.2: window.__testHarness exposes expected API', async ({ page }) => {
  const harness = await page.evaluate(() => ({
    hasPalette: !!window.__testHarness.palette,
    hasMockQueue: !!window.__testHarness.mockQueue,
    hasMockQueuedItems: Array.isArray(window.__testHarness.mockQueuedItems),
    hasMockActors: Array.isArray(window.__testHarness.mockActors),
    hasRebuildIcons: typeof window.__testHarness.rebuildIcons === 'function',
    hasMountWidget: typeof window.__testHarness.mountWidget === 'function',
    hasGetClockAngles: typeof window.__testHarness.getClockAngles === 'function',
  }));

  expect(harness).toEqual({
    hasPalette: true,
    hasMockQueue: true,
    hasMockQueuedItems: true,
    hasMockActors: true,
    hasRebuildIcons: true,
    hasMountWidget: true,
    hasGetClockAngles: true,
  });
});

// -----------------------------------------------------------------------------
// P2. Grid layout
// -----------------------------------------------------------------------------

test('P2.1: icon cells are 72x56px with 4px margin in a 4x3 grid', async ({ page }) => {
  const cells = await page.locator('.production-icon-cell').all();
  expect(cells.length).toBe(12);

  for (const cell of cells) {
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBe(72);
    expect(box!.height).toBe(56);
  }

  const positions = await page.evaluate(() => {
    const container = document.querySelector('#palette-container')!.getBoundingClientRect();
    const nodes = document.querySelectorAll('.production-icon-cell');
    return Array.from(nodes).map((node) => {
      const r = node.getBoundingClientRect();
      return {
        name: node.getAttribute('data-icon-name') ?? '?',
        left: r.left - container.left,
        top: r.top - container.top,
      };
    });
  });

  // Reading order left-to-right, top-to-bottom.
  for (let i = 0; i < positions.length; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const expectedLeft = col * (72 + 4);
    const expectedTop = row * (56 + 4);
    expect(positions[i].left).toBeCloseTo(expectedLeft, 1);
    expect(positions[i].top).toBeCloseTo(expectedTop, 1);
  }

  await screenshot(page, 'p02-grid-layout');
});

test('P2.2: palette widget dimensions are approximately 308x260px', async ({ page }) => {
  const widget = page.locator('#palette-container .production-palette-widget');
  await expect(widget).toBeVisible();

  const box = await widget.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(300);
  expect(box!.width).toBeLessThanOrEqual(320);
  expect(box!.height).toBeGreaterThanOrEqual(240);
  expect(box!.height).toBeLessThanOrEqual(280);
});

// -----------------------------------------------------------------------------
// P3. Clock overlay angles
// -----------------------------------------------------------------------------

test('P3.1: e1 clock overlay has initial angle 72 degrees', async ({ page }) => {
  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  const angle = extractConicAngle(angles.e1 ?? '');
  expect(angle).not.toBeNull();
  expect(angle).toBe(72);
});

test('P3.2: e3 clock overlay has initial angle 240 degrees', async ({ page }) => {
  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  const angle = extractConicAngle(angles.e3 ?? '');
  expect(angle).not.toBeNull();
  expect(angle).toBe(240);
});

test('P3.3: shok clock overlay has initial angle 324 degrees', async ({ page }) => {
  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  const angle = extractConicAngle(angles.shok ?? '');
  expect(angle).not.toBeNull();
  expect(angle).toBe(324);
});

test('P3.4: done item e2 has no clock overlay initially', async ({ page }) => {
  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  expect(angles.e2).toBeUndefined();

  const cell = await getCell(page, 'e2');
  await expect(cell.locator('.production-clock-overlay')).toHaveCount(0);
});

test('P3.5: full-cost item e4 has 360-degree clock overlay', async ({ page }) => {
  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  const angle = extractConicAngle(angles.e4 ?? '');
  expect(angle).not.toBeNull();
  expect(angle).toBe(360);
});

// -----------------------------------------------------------------------------
// P4. Overlay text states
// -----------------------------------------------------------------------------

test('P4.1: e2 shows READY text overlay', async ({ page }) => {
  const cell = await getCell(page, 'e2');
  await expect(cell).toContainText('READY');

  const overlay = cell.locator('.production-overlays span');
  await expect(overlay).toHaveCount(1);
  await expectColor(page, '.production-icon-cell[data-icon-name="e2"] .production-overlays span', COLORS.white);
  await screenshot(page, 'p04-ready-overlay');
});

test('P4.2: e3 shows HOLD text overlay', async ({ page }) => {
  const cell = await getCell(page, 'e3');
  await expect(cell).toContainText('HOLD');

  const overlay = cell.locator('.production-overlays span');
  await expect(overlay).toHaveCount(1);
  await expectColor(page, '.production-icon-cell[data-icon-name="e3"] .production-overlays span', COLORS.white);
});

test('P4.3: e1 shows formatted time remaining overlay', async ({ page }) => {
  const cell = await getCell(page, 'e1');
  const text = await cell.locator('.production-overlays span').textContent();
  expect(text).toMatch(/^\d+:\d{2}$/);
});

test('P4.4: shok shows formatted time remaining overlay', async ({ page }) => {
  const cell = await getCell(page, 'shok');
  const text = await cell.locator('.production-overlays span').textContent();
  expect(text).toMatch(/^\d+:\d{2}$/);
});

test('P4.5: e4 shows infinite symbol overlay', async ({ page }) => {
  const cell = await getCell(page, 'e4');
  await expect(cell).toContainText('∞');
  await screenshot(page, 'p04-infinite-overlay');
});

test('P4.6: e1 displays queue count badge of 2', async ({ page }) => {
  const cell = await getCell(page, 'e1');
  const absolutes = cell.locator('.production-cell-absolute');
  await expect(absolutes).toHaveCount(2); // hotkey F1 + queue count 2

  const texts = await absolutes.allTextContents();
  expect(texts).toContain('2');
});

// -----------------------------------------------------------------------------
// P5. Cell background states
// -----------------------------------------------------------------------------

test('P5.1: queued/done cells use medium blue background', async ({ page }) => {
  await expectBackground(page, '.production-icon-cell[data-icon-name="e1"]', COLORS.queuedBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="e2"]', COLORS.queuedBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="e3"]', COLORS.queuedBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="shok"]', COLORS.queuedBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="e4"]', COLORS.queuedBg);
});

test('P5.2: buildable cells without queue use dark blue background', async ({ page }) => {
  await expectBackground(page, '.production-icon-cell[data-icon-name="dog"]', COLORS.buildableBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="harv"]', COLORS.buildableBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="mcv"]', COLORS.buildableBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="barr"]', COLORS.buildableBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="tent"]', COLORS.buildableBg);
  await expectBackground(page, '.production-icon-cell[data-icon-name="weap"]', COLORS.buildableBg);
  await screenshot(page, 'p05-buildable-backgrounds');
});

// -----------------------------------------------------------------------------
// P6. Hotkey labels
// -----------------------------------------------------------------------------

test('P6.1: first nine icons display F1-F9 hotkey labels in gold', async ({ page }) => {
  const hotkeyNames = ['e1', 'e2', 'e3', 'e4', 'shok', 'dog', 'harv', 'mcv', 'powr'];
  for (let i = 0; i < hotkeyNames.length; i++) {
    const cell = await getCell(page, hotkeyNames[i]);
    const hotkey = cell.locator('.production-cell-absolute');
    await expect(hotkey).toContainText(`F${i + 1}`);
    await expectColor(page, `.production-icon-cell[data-icon-name="${hotkeyNames[i]}"] .production-cell-absolute`, COLORS.hotkeyGold);
  }
  await screenshot(page, 'p06-hotkeys');
});

test('P6.2: icons 10-12 show no hotkey labels', async ({ page }) => {
  for (const name of ['barr', 'tent', 'weap']) {
    const cell = await getCell(page, name);
    const absolutes = cell.locator('.production-cell-absolute');
    const count = await absolutes.count();
    for (let i = 0; i < count; i++) {
      const text = await absolutes.nth(i).textContent();
      expect(text).not.toMatch(/^F\d+$/);
    }
  }
});

// -----------------------------------------------------------------------------
// P7. Progress button
// -----------------------------------------------------------------------------

test('P7.1: progress button reduces remaining cost and shrinks e1 clock angle', async ({ page }) => {
  const before = await page.evaluate(() => {
    const angles = window.__testHarness.getClockAngles();
    return extractConicAngle(angles.e1 ?? '');
  });
  expect(before).toBe(72);

  await page.click('#btn-progress');
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => {
    const angles = window.__testHarness.getClockAngles();
    return extractConicAngle(angles.e1 ?? '');
  });
  // remainingCost drops from 20 to 5; ratio 5/100 -> floor(0.05 * 360) = 18 degrees.
  expect(after).toBe(18);
  expect(after).toBeLessThan(before!);

  await screenshot(page, 'p07-progress-once');
});

test('P7.2: enough progress clicks complete e1 and switch overlay to READY', async ({ page }) => {
  // e1 starts at remainingCost 20, two clicks of -15 complete it.
  await page.click('#btn-progress');
  await page.click('#btn-progress');
  await page.waitForTimeout(100);

  const cell = await getCell(page, 'e1');
  await expect(cell).toContainText('READY');
  await expect(cell.locator('.production-clock-overlay')).toHaveCount(0);

  const lastOp = await page.locator('#st-last-op').textContent();
  expect(lastOp).toContain('推进所有建造进度');
  await screenshot(page, 'p07-e1-ready');
});

test('P7.3: paused e3 clock does not change on progress click', async ({ page }) => {
  const before = await page.evaluate(() => {
    const angles = window.__testHarness.getClockAngles();
    return extractConicAngle(angles.e3 ?? '');
  });
  expect(before).toBe(240);

  await page.click('#btn-progress');
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => {
    const angles = window.__testHarness.getClockAngles();
    return extractConicAngle(angles.e3 ?? '');
  });
  expect(after).toBe(240);
});

// -----------------------------------------------------------------------------
// P8. Add/Remove queue
// -----------------------------------------------------------------------------

test('P8.1: add queue increments e1 queue count badge from 2 to 3', async ({ page }) => {
  const cell = await getCell(page, 'e1');
  const before = await cell.locator('.production-cell-absolute').allTextContents();
  expect(before).toContain('2');

  await page.click('#btn-add-queue');
  await page.waitForTimeout(150);

  const after = await cell.locator('.production-cell-absolute').allTextContents();
  expect(after).toContain('3');

  const queueCount = await page.locator('#st-queue-count').textContent();
  expect(queueCount).toBe('7');
  await screenshot(page, 'p08-queue-count-three');
});

test('P8.2: remove queue decrements e1 queue count badge from 3 back to 2', async ({ page }) => {
  await page.click('#btn-add-queue');
  await page.waitForTimeout(150);

  let cell = await getCell(page, 'e1');
  let texts = await cell.locator('.production-cell-absolute').allTextContents();
  expect(texts).toContain('3');

  await page.click('#btn-remove-queue');
  await page.waitForTimeout(150);

  cell = await getCell(page, 'e1');
  texts = await cell.locator('.production-cell-absolute').allTextContents();
  expect(texts).toContain('2');

  const queueCount = await page.locator('#st-queue-count').textContent();
  expect(queueCount).toBe('6');
});

test('P8.3: complete-one button finishes first non-done non-paused item', async ({ page }) => {
  // Before click: first non-done/non-paused is e1.
  const beforeAngles = await page.evaluate(() => window.__testHarness.getClockAngles());
  expect(extractConicAngle(beforeAngles.e1 ?? '')).not.toBeNull();

  await page.click('#btn-complete-one');
  await page.waitForTimeout(100);

  const cell = await getCell(page, 'e1');
  await expect(cell).toContainText('READY');
  await expect(cell.locator('.production-clock-overlay')).toHaveCount(0);

  const lastOp = await page.locator('#st-last-op').textContent();
  expect(lastOp).toContain('完成');
  await screenshot(page, 'p08-complete-one');
});

// -----------------------------------------------------------------------------
// P9. Reset
// -----------------------------------------------------------------------------

test('P9.1: reset button restores all initial clock angles and e3 HOLD state', async ({ page }) => {
  // Mutate state first.
  await page.click('#btn-progress');
  await page.click('#btn-complete-one');
  await page.waitForTimeout(100);

  // Reset.
  await page.click('#btn-reset');
  await page.waitForTimeout(150);

  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  expect(extractConicAngle(angles.e1 ?? '')).toBe(72);
  expect(extractConicAngle(angles.e3 ?? '')).toBe(240);
  expect(extractConicAngle(angles.shok ?? '')).toBe(324);
  expect(extractConicAngle(angles.e4 ?? '')).toBe(360);
  expect(angles.e2).toBeUndefined();

  const e3Cell = await getCell(page, 'e3');
  await expect(e3Cell).toContainText('HOLD');
  await screenshot(page, 'p09-reset-state');
});

test('P9.2: reset causes e2 to show clock overlay again instead of READY', async ({ page }) => {
  // Force e2 into the READY state by marking it done.
  await page.evaluate(() => {
    const e2 = window.__testHarness.mockQueuedItems.find((q) => q.item === 'e2');
    if (e2) {
      e2.done = true;
      e2.remainingCost = 0;
      e2.remainingTime = 0;
    }
  });
  await page.evaluate(() => window.__testHarness.palette.refreshIcons?.());
  await page.waitForTimeout(100);

  let e2Cell = await getCell(page, 'e2');
  await expect(e2Cell).toContainText('READY');
  await expect(e2Cell.locator('.production-clock-overlay')).toHaveCount(0);

  // Reset should restore e2 to in-progress with a full-clock overlay.
  await page.click('#btn-reset');
  await page.waitForTimeout(150);

  const angles = await page.evaluate(() => window.__testHarness.getClockAngles());
  expect(angles.e2).toBeDefined();
  expect(extractConicAngle(angles.e2 ?? '')).toBe(360);

  e2Cell = await getCell(page, 'e2');
  await expect(e2Cell).not.toContainText('READY');
  await expect(e2Cell.locator('.production-clock-overlay')).toHaveCount(1);
});

// -----------------------------------------------------------------------------
// P10. Boundary tests
// -----------------------------------------------------------------------------

test('P10.1: viewport resize keeps all 12 icons visible and properly spaced', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);

  const cells = page.locator('.production-icon-cell');
  await expect(cells).toHaveCount(12);

  const visibleCount = await cells.evaluateAll((nodes) =>
    nodes.filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length,
  );
  expect(visibleCount).toBe(12);
  await screenshot(page, 'p10-resize-1280x720');
});

test('P10.2: clock overlay maintains circular border-radius within cell bounds', async ({ page }) => {
  const clock = page.locator('.production-clock-overlay').first();
  await expect(clock).toBeVisible();

  const radius = await page.evaluate(() => {
    const el = document.querySelector('.production-clock-overlay') as HTMLElement | null;
    if (!el) return null;
    return window.getComputedStyle(el).borderRadius;
  });
  expect(radius).toBe('50%');
});

test('P10.3: empty queue removal does not crash and leaves buildable state', async ({ page }) => {
  // Remove all queued items via repeated clicks.
  for (let i = 0; i < 10; i++) {
    await page.click('#btn-remove-queue');
    await page.waitForTimeout(50);
  }

  const queueCount = await page.locator('#st-queue-count').textContent();
  expect(queueCount).toBe('0');

  // All cells should remain buildable (dark blue) with no clock overlays.
  const cellCount = await page.locator('.production-icon-cell').count();
  expect(cellCount).toBe(12);
  await expectBackground(page, '.production-icon-cell[data-icon-name="e1"]', COLORS.buildableBg);
  await screenshot(page, 'p10-empty-queue');
});
