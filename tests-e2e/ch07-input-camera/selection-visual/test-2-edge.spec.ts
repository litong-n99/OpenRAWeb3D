import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Acceptance Test: SelectionUtils edge / abnormal cases
// Page: http://localhost:5173/test/ch07-input-camera/selection-visual/
// ---------------------------------------------------------------------------

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/selection-visual/';
const EVIDENCE_DIR = path.resolve('test-results/manual/ch07-input-camera/selection-visual/evidence');

function evidenceFile(name: string): string {
  const dir = path.resolve(EVIDENCE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface Harness {
  clickActor(id: string): void;
  dragSelect(start: { x: number; y: number }, end: { x: number; y: number }): void;
  getSelectedActors(): string[];
  getSelectionBoxBounds(): { left: number; top: number; right: number; bottom: number } | null;
  getHealthBarVisibility(): Record<string, boolean>;
  reset(): void;
  scene: any;
  camera: any;
  engine: any;
  getActors(): Array<{ id: string; label: string; position: any; hpPct: number; priority: number; selected: boolean; bodyColor: any }>;
  getCanvasRect(): DOMRect;
  getActorsAtPoint(screenX: number, screenY: number): Array<{ id: string }>;
  getActorsInRect(left: number, top: number, right: number, bottom: number): Array<{ id: string }>;
  isShiftHeld(): boolean;
  isCtrlHeld(): boolean;
  areHealthBarsVisible(): boolean;
  selectAll(): void;
  clearSelection(): void;
  isSelected(id: string): boolean;
}

declare global {
  interface Window {
    __testHarness: Harness;
  }
}

async function waitForHarness(page: Page, timeout = 15000): Promise<void> {
  await page.goto(PAGE_URL);
  await page.waitForSelector('#renderCanvas', { timeout });
  await page.waitForFunction(() => !!(window as any).__testHarness, { timeout });
  await page.waitForFunction(() => {
    const engineText = document.getElementById('info-engine')?.textContent ?? '';
    return engineText.includes('WebGL');
  }, { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function resetState(page: Page): Promise<void> {
  await page.evaluate(() => window.__testHarness.reset());
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
}

async function getActorScreenPoint(
  page: Page,
  id: string,
): Promise<{ screenX: number; screenY: number; relX: number; relY: number }> {
  const point = await page.evaluate(
    ({ actorId }) => {
      const h = (window as any).__testHarness as Harness;
      const rect = h.getCanvasRect();
      const stepX = Math.max(6, Math.floor(rect.width / 36));
      const stepY = Math.max(6, Math.floor(rect.height / 36));
      for (let x = 12; x < rect.width - 12; x += stepX) {
        for (let y = 12; y < rect.height - 12; y += stepY) {
          const hits = h.getActorsAtPoint(x, y).map((a) => a.id);
          if (hits.includes(actorId)) {
            return { relX: x, relY: y };
          }
        }
      }
      return null;
    },
    { actorId: id },
  );
  if (!point) throw new Error(`Could not locate screen point for actor ${id}`);
  const rect = await page.evaluate(() => window.__testHarness.getCanvasRect());
  return { screenX: rect.left + point.relX, screenY: rect.top + point.relY, ...point };
}

async function findBlankScreenPoint(
  page: Page,
): Promise<{ screenX: number; screenY: number; relX: number; relY: number }> {
  const point = await page.evaluate(() => {
    const h = (window as any).__testHarness as Harness;
    const rect = h.getCanvasRect();
    const candidates = [
      { x: rect.width * 0.12, y: rect.height * 0.12 },
      { x: rect.width * 0.88, y: rect.height * 0.12 },
      { x: rect.width * 0.12, y: rect.height * 0.88 },
      { x: rect.width * 0.88, y: rect.height * 0.88 },
      { x: rect.width * 0.5, y: rect.height * 0.2 },
      { x: rect.width * 0.5, y: rect.height * 0.8 },
    ];
    for (const c of candidates) {
      if (h.getActorsAtPoint(c.x, c.y).length === 0) {
        return { relX: c.x, relY: c.y };
      }
    }
    const step = 30;
    for (let x = step; x < rect.width - step; x += step) {
      for (let y = step; y < rect.height - step; y += step) {
        if (h.getActorsAtPoint(x, y).length === 0) {
          return { relX: x, relY: y };
        }
      }
    }
    return null;
  });
  if (!point) throw new Error('Could not find a blank point on the canvas');
  const rect = await page.evaluate(() => window.__testHarness.getCanvasRect());
  return { screenX: rect.left + point.relX, screenY: rect.top + point.relY, ...point };
}

interface MeshState {
  ringVisible: boolean;
  healthBarVisible: boolean;
}

async function getActorMeshState(page: Page, id: string): Promise<MeshState> {
  return page.evaluate(
    ({ actorId }) => {
      const h = (window as any).__testHarness as Harness;
      const scene = h.scene;
      const ring = scene.getMeshByName(`ring_${actorId}`);
      const hpBg = scene.getMeshByName(`hpBg_${actorId}`);
      return {
        ringVisible: ring.isVisible,
        healthBarVisible: hpBg.isVisible,
      };
    },
    { actorId: id },
  );
}

function pageErrors(page: Page): { errors: Error[]; detach: () => void } {
  const errors: Error[] = [];
  const handler = (err: Error) => errors.push(err);
  page.on('pageerror', handler);
  return {
    errors,
    detach: () => page.off('pageerror', handler),
  };
}

// ---------------------------------------------------------------------------
// Headless limitations:
// - Events outside the viewport may not be delivered to the canvas element by
//   Playwright's mouse; for the "drag outside" test we therefore dispatch
//   pointer events directly on the canvas element.
// - Window resize in headless can produce a different backing-store size than
//   the requested viewport; we verify the actor is still selectable.
// - Double-click timing is emulated; the implementation uses a 300ms window.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.describe('Selection Visual — Edge & Abnormal Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForHarness(page);
    await resetState(page);
  });

  test.afterEach(async ({ page }) => {
    await resetState(page);
  });

  test('B1: 快速双击同一 actor 不重复高亮且状态稳定', async ({ page }) => {
    const errors = pageErrors(page);
    const a = await getActorScreenPoint(page, 'marine_a');

    await page.mouse.click(a.screenX, a.screenY);
    await page.mouse.click(a.screenX, a.screenY, { delay: 50 });
    await page.waitForTimeout(350);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    // The implementation selects all actors of the same class on double-click.
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(new Set(selected).size).toBe(selected.length);

    // No duplicate rings: each selected actor has exactly one visible ring.
    for (const id of selected) {
      expect((await getActorMeshState(page, id)).ringVisible).toBe(true);
    }

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: `B1: double-click selected ${selected.length} unique actors, no duplicate rings.`,
    });
    await page.screenshot({ path: evidenceFile('b1-double-click-stable.png') });
  });

  test('B2: 拖拽到画布外并松手无异常', async ({ page }) => {
    const errors = pageErrors(page);
    const rect = await page.evaluate(() => window.__testHarness.getCanvasRect());

    const start = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    const end = { x: rect.left + rect.width + 120, y: rect.top + rect.height + 120 };

    const canvas = page.locator('#renderCanvas');
    // Dispatch pointer events directly so the canvas receives them even when
    // the coordinates are outside its own bounds.
    await canvas.dispatchEvent('pointerdown', {
      pointerType: 'mouse',
      button: 0,
      clientX: start.x,
      clientY: start.y,
      bubbles: true,
    });
    await canvas.dispatchEvent('pointermove', {
      pointerType: 'mouse',
      clientX: end.x,
      clientY: end.y,
      bubbles: true,
    });
    await canvas.dispatchEvent('pointerup', {
      pointerType: 'mouse',
      button: 0,
      clientX: end.x,
      clientY: end.y,
      bubbles: true,
    });

    await page.waitForTimeout(200);

    const boxBounds = await page.evaluate(() => window.__testHarness.getSelectionBoxBounds());
    expect(boxBounds).toBeNull();

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: 'B2: dragging outside the canvas and releasing does not throw; rubber-band is cleaned up.',
    });
    await page.screenshot({ path: evidenceFile('b2-drag-outside-canvas.png') });
  });

  test('B3: Esc 键清除所有选区', async ({ page }) => {
    const errors = pageErrors(page);
    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__testHarness.getSelectedActors()).then((s) => s.length)).toBe(6);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);

    const visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(Object.values(visibility).every((v) => !v)).toBe(true);

    await expect(page.locator('#selection-list')).toContainText('(无)');

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: 'B3: Escape clears the selection, health bars and UI list.',
    });
    await page.screenshot({ path: evidenceFile('b3-escape-clear.png') });
  });

  test('B4: 窗口调整到 1280×720 后选择/高亮/血条仍正常', async ({ page }) => {
    const errors = pageErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    const a = await getActorScreenPoint(page, 'marine_a');
    await page.mouse.click(a.screenX, a.screenY);
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(true);
    const state = await getActorMeshState(page, 'marine_a');
    expect(state.ringVisible).toBe(true);
    expect(state.healthBarVisible).toBe(true);

    await expect(page.locator('#stat-count')).toHaveText('1');

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: 'B4: after viewport resize to 1280×720 the actor is still selectable and visuals update.',
    });
    await page.screenshot({ path: evidenceFile('b4-resize-1280x720.png') });
  });

  test('B5: 全选 / 取消所有按钮', async ({ page }) => {
    const errors = pageErrors(page);

    await page.locator('#btn-select-all').click();
    await page.waitForTimeout(150);
    let selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(6);
    await expect(page.locator('#stat-count')).toHaveText('6');

    await page.locator('#btn-deselect-all').click();
    await page.waitForTimeout(150);
    selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    await expect(page.locator('#selection-list')).toContainText('(无)');

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: 'B5: select-all selects 6 actors; deselect-all clears the selection.',
    });
    await page.screenshot({ path: evidenceFile('b5-select-deselect-all.png') });
  });

  test('B6: 血量条显示切换按钮不影响选区', async ({ page }) => {
    const errors = pageErrors(page);
    await page.evaluate(() => window.__testHarness.clickActor('tank_alpha'));
    await page.waitForTimeout(100);

    expect((await getActorMeshState(page, 'tank_alpha')).healthBarVisible).toBe(true);

    await page.locator('#btn-toggle-healthbars').click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__testHarness.areHealthBarsVisible())).toBe(false);
    expect((await getActorMeshState(page, 'tank_alpha')).healthBarVisible).toBe(false);
    expect(await page.evaluate(() => window.__testHarness.isSelected('tank_alpha'))).toBe(true);

    await page.locator('#btn-toggle-healthbars').click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__testHarness.areHealthBarsVisible())).toBe(true);
    expect((await getActorMeshState(page, 'tank_alpha')).healthBarVisible).toBe(true);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: 'B6: toggling health bars hides/shows them while keeping the selection unchanged.',
    });
    await page.screenshot({ path: evidenceFile('b6-toggle-healthbars.png') });
  });

  test('B7: 重置按钮清除所有选区', async ({ page }) => {
    const errors = pageErrors(page);
    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(100);

    await page.locator('#btn-reset').click();
    await page.waitForTimeout(150);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    await expect(page.locator('#selection-list')).toContainText('(无)');

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: 'B7: reset button clears all selections and UI state.',
    });
    await page.screenshot({ path: evidenceFile('b7-reset-button.png') });
  });

  test('B8: 程序框选与真实鼠标框选结果一致', async ({ page }) => {
    const errors = pageErrors(page);
    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');
    const canvasRect = await page.evaluate(() => window.__testHarness.getCanvasRect());

    const left = Math.min(b.screenX, c.screenX) - 60;
    const top = Math.min(b.screenY, c.screenY) - 60;
    const right = Math.max(b.screenX, c.screenX) + 60;
    const bottom = Math.max(b.screenY, c.screenY) + 60;

    // Programmatic dragSelect expects canvas-relative coordinates.
    await page.evaluate(
      ({ start, end }) => {
        window.__testHarness.dragSelect(
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        );
      },
      {
        start: { x: left - canvasRect.left, y: top - canvasRect.top },
        end: { x: right - canvasRect.left, y: bottom - canvasRect.top },
      },
    );
    await page.waitForTimeout(100);
    const programmatic = await page.evaluate(() => window.__testHarness.getSelectedActors());

    await resetState(page);

    // Real mouse drag uses viewport coordinates.
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const mouse = await page.evaluate(() => window.__testHarness.getSelectedActors());

    expect(programmatic.sort()).toEqual(mouse.sort());

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'edge-case',
      description: `B8: programmatic and mouse box selection produced the same set (${mouse.length} actors).`,
    });
    await page.screenshot({ path: evidenceFile('b8-programmatic-vs-mouse.png') });
  });
});
