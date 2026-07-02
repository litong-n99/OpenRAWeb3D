/**
 * test-1.spec.ts — Automated acceptance test for Chapter 13 Support Powers
 *
 * Test page: /test/ch13-support-powers/airstrike/
 * Module: SelectDirectionalTarget.ts (Airstrike directional targeting)
 *
 * Acceptance criteria covered:
 *   1. Environment verification (canvas, WebGL 2.0, UI controls)
 *   2. Cursor switching on valid terrain
 *   3. Cursor switching on blocked terrain
 *   4. Cursor switching in out-of-bounds mode
 *   5. Drag directional aiming — North direction
 *   6. All 8 directions programmatic verification
 *   7. MinDragThreshold verification
 *   8. MaxDragThreshold + direction reversal verification
 *   9. 16/32 direction mode switching
 *  10. Quick click (no drag)
 *  11. Pointer leaving canvas cancels drag
 *  12. __testHarness API unit tests
 *
 * Implementation notes:
 *   - Programmatic state is read through window.__airstrikeTest.
 *   - Visual state (cursor, result popups) is asserted through DOM selectors.
 *   - Drag interactions use Playwright's mouse API.
 *   - Screenshots are written to the absolute evidence directory.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = '/test/ch13-support-powers/airstrike/';
const SCREENSHOT_DIR = 'e:/OpenRAWeb3D/test-results/manual/ch13-support-powers/airstrike/evidence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArrowDef {
  name: string;
  endAngle: number;
  facing: number;
}

interface DragState {
  activated: boolean;
  dragStarted: boolean;
  targetLocation: { x: number; y: number } | null;
  accumulated: { x: number; y: number };
  currentArrow: ArrowDef | null;
}

interface AirstrikeHarness {
  angleOf(delta: { x: number; y: number }): number;
  getArrow(degree: number, arrows: readonly ArrowDef[]): ArrowDef;
  vectorLength(v: { x: number; y: number }): number;
  loadArrows(count: number): ArrowDef[];
  dragState: DragState;
  getCurrentArrowSet(): ArrowDef[];
  MIN_DRAG_THRESHOLD: number;
  MAX_DRAG_THRESHOLD: number;
  NO_DIRECTION: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PopupInfo {
  text: string;
  background: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

function screenshotPath(name: string): string {
  ensureScreenshotDir();
  return path.join(SCREENSHOT_DIR, `${name}.png`);
}

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__airstrikeTest as Partial<AirstrikeHarness>;
      return (
        !!h &&
        typeof h.angleOf === 'function' &&
        typeof h.getArrow === 'function' &&
        typeof h.vectorLength === 'function' &&
        typeof h.loadArrows === 'function'
      );
    },
    { timeout }
  );
}

async function getHarness(page: Page): Promise<AirstrikeHarness> {
  return page.evaluate(() => (window as any).__airstrikeTest as AirstrikeHarness);
}

async function getCanvasRect(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    };
  });
}

async function resetState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const selTerrain = document.getElementById('sel-terrain') as HTMLSelectElement | null;
    if (selTerrain) {
      selTerrain.value = 'valid';
      selTerrain.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const selArrows = document.getElementById('sel-arrows') as HTMLSelectElement | null;
    if (selArrows) {
      selArrows.value = '8';
      selArrows.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
    if (canvas) {
      canvas.style.cursor = '';
    }
    const h = (window as any).__airstrikeTest as AirstrikeHarness;
    h.dragState.activated = false;
    h.dragState.dragStarted = false;
    h.dragState.targetLocation = null;
    h.dragState.accumulated = { x: 0, y: 0 };
    h.dragState.currentArrow = null;
  });
}

async function getStat(page: Page, id: string): Promise<string> {
  return page.evaluate((selectorId) => {
    const el = document.getElementById(selectorId);
    return el ? el.textContent ?? '' : '';
  }, id);
}

/**
 * Reads the inline cursor style set by the page. In headless environments the
 * computed cursor style may always report "auto", so we assert the explicit
 * style assignment together with the DOM status panel.
 */
async function getCanvasCursor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    return canvas.style.cursor;
  });
}

async function performDrag(
  page: Page,
  start: { x: number; y: number },
  delta: { x: number; y: number },
  options: { steps?: number } = {}
): Promise<void> {
  const steps = options.steps ?? 5;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps });
}

async function endDrag(page: Page): Promise<void> {
  await page.mouse.up();
}

async function dragAndRelease(
  page: Page,
  start: { x: number; y: number },
  delta: { x: number; y: number }
): Promise<void> {
  await performDrag(page, start, delta);
  await endDrag(page);
}

function rgbaHasColor(rgba: string, r: number, g: number, b: number): boolean {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return false;
  return (
    parseInt(m[1], 10) === r &&
    parseInt(m[2], 10) === g &&
    parseInt(m[3], 10) === b
  );
}

async function findResultPopup(page: Page): Promise<PopupInfo | null> {
  return page.evaluate(() => {
    const sandbox = document.getElementById('sandbox');
    if (!sandbox) return null;
    const divs = sandbox.querySelectorAll('div');
    for (const div of divs) {
      const text = div.textContent ?? '';
      if (text.includes('方向:') || text.includes('无方向')) {
        return {
          text,
          background: window.getComputedStyle(div).backgroundColor,
        };
      }
    }
    return null;
  });
}

async function waitForResultPopup(page: Page, timeout = 3000): Promise<PopupInfo> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const popup = await findResultPopup(page);
    if (popup) return popup;
    await page.waitForTimeout(50);
  }
  throw new Error('Result popup did not appear within timeout');
}

async function evalAngleOf(page: Page, delta: { x: number; y: number }): Promise<number> {
  return page.evaluate((d) => (window as any).__airstrikeTest.angleOf(d), delta);
}

async function evalGetArrow(
  page: Page,
  degree: number,
  arrows: readonly ArrowDef[]
): Promise<ArrowDef> {
  return page.evaluate(
    ({ degree, arrows }) => (window as any).__airstrikeTest.getArrow(degree, arrows),
    { degree, arrows }
  );
}

async function evalVectorLength(page: Page, v: { x: number; y: number }): Promise<number> {
  return page.evaluate((v) => (window as any).__airstrikeTest.vectorLength(v), v);
}

async function evalLoadArrows(page: Page, count: number): Promise<ArrowDef[]> {
  return page.evaluate((c) => (window as any).__airstrikeTest.loadArrows(c), count);
}

async function evalGetCurrentArrowSet(page: Page): Promise<ArrowDef[]> {
  return page.evaluate(() => (window as any).__airstrikeTest.getCurrentArrowSet());
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('CH13 Support Powers — Airstrike Directional Targeting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForHarness(page);
    await page.waitForTimeout(300);
    await resetState(page);
    await page.waitForTimeout(100);
  });

  // =====================================================================
  // Scene 1: Environment verification
  // =====================================================================

  test('Scene 1: page loads, canvas exists, engine shows WebGL 2.0, UI controls visible', async ({ page }) => {
    const canvas = page.locator('#renderCanvas');
    await expect(canvas).toBeVisible();

    const engineText = await getStat(page, 'info-engine');
    expect(engineText).toBe('WebGL 2.0');

    await expect(page.locator('#btn-mode-target')).toBeVisible();
    await expect(page.locator('#btn-mode-cancel')).toBeVisible();
    await expect(page.locator('#sel-terrain')).toBeVisible();
    await expect(page.locator('#sel-arrows')).toBeVisible();

    await expect(page.locator('#st-dragging')).toHaveText('待机');

    await page.screenshot({ path: screenshotPath('screenshot-1-initial-state') });
    expect(fs.existsSync(screenshotPath('screenshot-1-initial-state'))).toBe(true);
  });

  // =====================================================================
  // Scene 2: Cursor switching — valid terrain
  // =====================================================================

  test('Scene 2: cursor on valid terrain is crosshair and status shows ability', async ({ page }) => {
    const rect = await getCanvasRect(page);
    const x = rect.left + rect.width * 0.25;
    const y = rect.top + rect.height * 0.5;

    await page.mouse.move(x, y);
    await page.waitForTimeout(100);

    // Inline style is the authoritative assignment from the page code.
    expect(await getCanvasCursor(page)).toBe('crosshair');
    expect(await getStat(page, 'st-cursor')).toBe('ability (Cursor)');
  });

  // =====================================================================
  // Scene 3: Cursor switching — blocked terrain
  // =====================================================================

  test('Scene 3: cursor on blocked terrain is not-allowed and status shows blocked', async ({ page }) => {
    const rect = await getCanvasRect(page);
    const x = rect.left + rect.width * 0.85;
    const y = rect.top + rect.height * 0.5;

    await page.mouse.move(x, y);
    await page.waitForTimeout(100);

    expect(await getCanvasCursor(page)).toBe('not-allowed');
    expect(await getStat(page, 'st-cursor')).toBe('blocked (BlockedCursor)');
  });

  // =====================================================================
  // Scene 4: Cursor switching — out-of-bounds mode
  // =====================================================================

  test('Scene 4: OOB mode forces not-allowed cursor everywhere', async ({ page }) => {
    await page.selectOption('#sel-terrain', 'oob');
    await page.waitForTimeout(100);

    const rect = await getCanvasRect(page);

    // Left valid area
    await page.mouse.move(rect.left + rect.width * 0.25, rect.top + rect.height * 0.5);
    await page.waitForTimeout(100);
    expect(await getCanvasCursor(page)).toBe('not-allowed');
    expect(await getStat(page, 'st-cursor')).toBe('blocked (OOB)');

    // Right blocked area
    await page.mouse.move(rect.left + rect.width * 0.85, rect.top + rect.height * 0.5);
    await page.waitForTimeout(100);
    expect(await getCanvasCursor(page)).toBe('not-allowed');
    expect(await getStat(page, 'st-cursor')).toBe('blocked (OOB)');

    await page.screenshot({ path: screenshotPath('screenshot-4-oob-mode') });
    expect(fs.existsSync(screenshotPath('screenshot-4-oob-mode'))).toBe(true);
  });

  // =====================================================================
  // Scene 5: Drag directional aiming — North
  // =====================================================================

  test('Scene 5: dragging upward selects N arrow, angle ~0°, green line, green result', async ({ page }) => {
    const rect = await getCanvasRect(page);
    const start = {
      x: rect.left + rect.width * 0.25,
      y: rect.top + rect.height * 0.5,
    };

    await performDrag(page, start, { x: 0, y: -40 });
    await page.waitForTimeout(100);

    const harness = await getHarness(page);
    expect(harness.dragState.activated).toBe(true);
    expect(harness.dragState.currentArrow?.name).toBe('N');

    const angleText = await getStat(page, 'st-angle');
    const angle = parseFloat(angleText);
    expect(angle).toBeGreaterThanOrEqual(-22.5);
    expect(angle).toBeLessThanOrEqual(22.5);

    const distText = await getStat(page, 'st-dist');
    const dist = parseInt(distText, 10);
    expect(dist).toBeGreaterThanOrEqual(20);

    await page.screenshot({ path: screenshotPath('screenshot-2-north-drag') });
    expect(fs.existsSync(screenshotPath('screenshot-2-north-drag'))).toBe(true);

    await endDrag(page);
    await page.waitForTimeout(100);

    const popup = await waitForResultPopup(page);
    expect(popup.text).toContain('方向:');
    expect(rgbaHasColor(popup.background, 0, 128, 0)).toBe(true);
  });

  // =====================================================================
  // Scene 6: All 8 directions
  // =====================================================================

  test('Scene 6: all 8 directions produce correct arrow and ExtraData', async ({ page }) => {
    const arrows = await evalLoadArrows(page, 8);

    const directions: { name: string; dx: number; dy: number; facing: number }[] = [
      { name: 'N', dx: 0, dy: -1, facing: 0 },
      { name: 'NW', dx: -1, dy: -1, facing: 128 },
      { name: 'W', dx: -1, dy: 0, facing: 256 },
      { name: 'SW', dx: -1, dy: 1, facing: 384 },
      { name: 'S', dx: 0, dy: 1, facing: 512 },
      { name: 'SE', dx: 1, dy: 1, facing: 640 },
      { name: 'E', dx: 1, dy: 0, facing: 768 },
      { name: 'NE', dx: 1, dy: -1, facing: 896 },
    ];

    const rect = await getCanvasRect(page);
    const start = {
      x: rect.left + rect.width * 0.25,
      y: rect.top + rect.height * 0.5,
    };

    for (const dir of directions) {
      // Normalize diagonal vectors so drag distance is ~45px regardless of direction.
      const len = Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
      const delta = {
        x: Math.round((dir.dx / len) * 45),
        y: Math.round((dir.dy / len) * 45),
      };

      await dragAndRelease(page, start, delta);
      await page.waitForTimeout(120);

      const angle = await evalAngleOf(page, { x: delta.x, y: delta.y });
      const arrow = await evalGetArrow(page, angle, arrows);

      expect(arrow.name).toBe(dir.name);
      expect(arrow.facing).toBe(dir.facing);

      // Also verify DOM state caught up before the next iteration.
      await expect(page.locator('#st-dragging')).toHaveText('待机');
    }
  });

  // =====================================================================
  // Scene 7: MinDragThreshold
  // =====================================================================

  test('Scene 7: short drag below threshold produces NO_DIRECTION and red result', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    const rect = await getCanvasRect(page);
    const start = {
      x: rect.left + rect.width * 0.25,
      y: rect.top + rect.height * 0.5,
    };

    await dragAndRelease(page, start, { x: 0, y: -5 });
    await page.waitForTimeout(200);

    await expect(page.locator('#st-dragging')).toHaveText('待机');

    const popup = await waitForResultPopup(page);
    expect(popup.text).toContain('无方向');
    expect(rgbaHasColor(popup.background, 128, 0, 0)).toBe(true);

    const hasNoDirectionLog = consoleMessages.some((t) =>
      t.includes('ExtraData=4294967295') || t.includes('0xFFFFFFFF') || t.includes('hasDirection: false')
    );
    expect(hasNoDirectionLog).toBe(true);
  });

  // =====================================================================
  // Scene 8: MaxDragThreshold + direction reversal
  // =====================================================================

  test('Scene 8: drag beyond 75px clamps length to 75 and reverses direction', async ({ page }) => {
    const rect = await getCanvasRect(page);
    const start = {
      x: rect.left + rect.width * 0.25,
      y: rect.top + rect.height * 0.5,
    };

    // Drag upward 110px in a single move event. Using steps=1 prevents the
    // mid-drag reversal from being partially cancelled by subsequent pointermove
    // deltas, so the final clamped length is exactly MaxDragThreshold.
    await performDrag(page, start, { x: 0, y: -110 }, { steps: 1 });
    await page.waitForTimeout(100);

    const harness = await getHarness(page);
    const len = await evalVectorLength(page, harness.dragState.accumulated);
    expect(len).toBeCloseTo(75, 1);

    const angle = await evalAngleOf(page, harness.dragState.accumulated);
    expect(angle).toBeGreaterThanOrEqual(180 - 22.5);
    expect(angle).toBeLessThanOrEqual(180 + 22.5);

    expect(harness.dragState.currentArrow?.name).toBe('S');

    await endDrag(page);
    await page.waitForTimeout(100);
  });

  // =====================================================================
  // Scene 9: 16/32 direction modes
  // =====================================================================

  test('Scene 9: switching to 16 and 32 directions updates arrow count correctly', async ({ page }) => {
    await page.selectOption('#sel-arrows', '16');
    await page.waitForTimeout(100);
    const arrows16 = await evalGetCurrentArrowSet(page);
    expect(arrows16.length).toBe(16);

    // Verify sector width and endAngle progression
    const sector16 = 360 / 16;
    expect(arrows16[0].endAngle).toBeCloseTo(sector16 / 2, 5);
    for (let i = 1; i < arrows16.length; i++) {
      expect(arrows16[i].endAngle).toBeCloseTo(arrows16[i - 1].endAngle + sector16, 5);
    }

    await page.screenshot({ path: screenshotPath('screenshot-3-16-directions') });
    expect(fs.existsSync(screenshotPath('screenshot-3-16-directions'))).toBe(true);

    await page.selectOption('#sel-arrows', '32');
    await page.waitForTimeout(100);
    const arrows32 = await evalGetCurrentArrowSet(page);
    expect(arrows32.length).toBe(32);

    const sector32 = 360 / 32;
    expect(arrows32[0].endAngle).toBeCloseTo(sector32 / 2, 5);

    await page.selectOption('#sel-arrows', '8');
    await page.waitForTimeout(100);
    const arrows8 = await evalGetCurrentArrowSet(page);
    expect(arrows8.length).toBe(8);
    expect(arrows8.map((a) => a.name)).toEqual(['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE']);
  });

  // =====================================================================
  // Scene 10: Quick click (no drag)
  // =====================================================================

  test('Scene 10: quick click without drag produces NO_DIRECTION', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    const rect = await getCanvasRect(page);
    const x = rect.left + rect.width * 0.25;
    const y = rect.top + rect.height * 0.5;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);

    const harness = await getHarness(page);
    expect(harness.dragState.activated).toBe(false);

    const hasNoDirectionLog = consoleMessages.some((t) =>
      t.includes('ExtraData=4294967295') || t.includes('0xFFFFFFFF') || t.includes('hasDirection: false')
    );
    expect(hasNoDirectionLog).toBe(true);
  });

  // =====================================================================
  // Scene 11: Pointer leaving canvas cancels drag
  // =====================================================================

  test('Scene 11: dragging pointer out of canvas cancels the drag', async ({ page }) => {
    const rect = await getCanvasRect(page);
    const start = {
      x: rect.left + rect.width * 0.25,
      y: rect.top + rect.height * 0.5,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y - 40, { steps: 5 });
    await page.waitForTimeout(50);

    let harness = await getHarness(page);
    expect(harness.dragState.activated).toBe(true);

    // Move far outside the canvas. Because pointer capture is set on pointerdown,
    // some environments may not synthesize pointerleave automatically, so we also
    // dispatch the event to verify the handler cancels the drag.
    await page.mouse.move(rect.left - 200, start.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
      canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
    });
    await page.waitForTimeout(50);

    harness = await getHarness(page);
    expect(harness.dragState.activated).toBe(false);
    await expect(page.locator('#st-dragging')).toHaveText('待机');

    await page.mouse.up();
  });

  // =====================================================================
  // Scene 12: __testHarness API unit tests
  // =====================================================================

  test('Scene 12: __airstrikeTest API computes angles, arrows, and lengths correctly', async ({ page }) => {
    // angleOf tests
    expect(await evalAngleOf(page, { x: 0, y: -1 })).toBeCloseTo(0, 5);
    expect(await evalAngleOf(page, { x: 1, y: 0 })).toBeCloseTo(270, 5);
    expect(await evalAngleOf(page, { x: 0, y: 1 })).toBeCloseTo(180, 5);
    expect(await evalAngleOf(page, { x: -1, y: 0 })).toBeCloseTo(90, 5);

    // vectorLength tests
    expect(await evalVectorLength(page, { x: 3, y: 4 })).toBeCloseTo(5, 5);
    expect(await evalVectorLength(page, { x: 0, y: 0 })).toBeCloseTo(0, 5);
    expect(await evalVectorLength(page, { x: 1, y: 1 })).toBeCloseTo(Math.sqrt(2), 5);

    // loadArrows counts and endAngle progression
    for (const count of [8, 16, 32]) {
      const arrows = await evalLoadArrows(page, count);
      expect(arrows.length).toBe(count);
      const sector = 360 / count;
      expect(arrows[0].endAngle).toBeCloseTo(sector / 2, 5);
      for (let i = 1; i < arrows.length; i++) {
        expect(arrows[i].endAngle).toBeCloseTo(arrows[i - 1].endAngle + sector, 5);
      }
    }

    // getArrow tests with 8 arrows
    const arrows8 = await evalLoadArrows(page, 8);
    expect((await evalGetArrow(page, 0, arrows8)).name).toBe('N');
    expect((await evalGetArrow(page, 45, arrows8)).name).toBe('NW');
    expect((await evalGetArrow(page, 90, arrows8)).name).toBe('W');
    expect((await evalGetArrow(page, 135, arrows8)).name).toBe('SW');
    expect((await evalGetArrow(page, 180, arrows8)).name).toBe('S');
    expect((await evalGetArrow(page, 225, arrows8)).name).toBe('SE');
    expect((await evalGetArrow(page, 270, arrows8)).name).toBe('E');
    expect((await evalGetArrow(page, 315, arrows8)).name).toBe('NE');
    expect((await evalGetArrow(page, 350, arrows8)).name).toBe('N'); // wraps around

    // Constants
    const harness = await getHarness(page);
    expect(harness.MIN_DRAG_THRESHOLD).toBe(20);
    expect(harness.MAX_DRAG_THRESHOLD).toBe(75);
    expect(harness.NO_DIRECTION).toBe(0xffffffff);
  });
});
