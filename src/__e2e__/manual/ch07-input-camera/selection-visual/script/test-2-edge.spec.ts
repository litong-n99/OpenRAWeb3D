import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Manual Acceptance Test: Selection Visual — Edge / Boundary Cases (B1-B12)
// Page: http://localhost:5173/test/ch07-input-camera/selection-visual/
// ---------------------------------------------------------------------------

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/selection-visual/';
const EVIDENCE_DIR = path.resolve('test-results/manual/ch07-input-camera/selection-visual/evidence');

function ensureEvidenceDir(): void {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
}

function evidenceFile(name: string): string {
  ensureEvidenceDir();
  return path.join(EVIDENCE_DIR, name);
}

interface Harness {
  clickActor(id: string): void;
  dragSelect(start: { x: number; y: number }, end: { x: number; y: number }): void;
  getSelectedActors(): string[];
  getSelectionBoxBounds(): { left: number; top: number; right: number; bottom: number } | null;
  getHealthBarVisibility(): Record<string, boolean>;
  reset(): void;
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
  await page.waitForTimeout(500);
}

async function resetState(page: Page): Promise<void> {
  await page.evaluate(() => window.__testHarness.reset());
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForTimeout(500);
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
    // Fallback grid scan.
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

function pageErrors(page: Page): { errors: Error[]; detach: () => void } {
  const errors: Error[] = [];
  const handler = (err: Error) => errors.push(err);
  page.on('pageerror', handler);
  return {
    errors,
    detach: () => page.off('pageerror', handler),
  };
}

function assertNoErrors(errors: { errors: Error[]; detach: () => void }): void {
  errors.detach();
  expect(errors.errors).toHaveLength(0);
}

test.describe.configure({ mode: 'serial' });

test.describe('Selection Visual — Edge / Boundary Cases (B1-B12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForHarness(page);
    await resetState(page);
  });

  test.afterEach(async ({ page }) => {
    await resetState(page);
  });

  // -------------------------------------------------------------------------
  // B1 — Double-click same actor selects all same-type actors, no flicker
  // -------------------------------------------------------------------------

  test('B1.1: 双击 marine_a 选中所有步兵且选区稳定', async ({ page }) => {
    const errors = pageErrors(page);

    const a = await getActorScreenPoint(page, 'marine_a');
    await page.mouse.dblclick(a.screenX, a.screenY);
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected.sort()).toEqual(['marine_a', 'marine_b', 'marine_c', 'marine_d']);
    await expect(page.locator('#stat-count')).toHaveText('4');

    // Stability check: wait another interval and confirm no flicker/reset.
    await page.waitForTimeout(350);
    const selectedAgain = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selectedAgain.sort()).toEqual(['marine_a', 'marine_b', 'marine_c', 'marine_d']);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b1-1-dblclick-all-infantry.png') });
  });

  test('B1.2: 双击 tank_alpha 选中所有车辆', async ({ page }) => {
    const errors = pageErrors(page);

    const t = await getActorScreenPoint(page, 'tank_alpha');
    await page.mouse.dblclick(t.screenX, t.screenY);
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected.sort()).toEqual(['tank_alpha', 'tank_beta']);
    await expect(page.locator('#stat-count')).toHaveText('2');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b1-2-dblclick-all-vehicles.png') });
  });

  // -------------------------------------------------------------------------
  // B2 — Drag rubber-band outside canvas bounds
  // -------------------------------------------------------------------------

  test('B2: 拖拽框选超出画布时选框不越界且选区生效', async ({ page }) => {
    const errors = pageErrors(page);

    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');
    const canvasRect = await page.evaluate(() => window.__testHarness.getCanvasRect());

    const startX = Math.min(b.screenX, c.screenX) - 50;
    const startY = Math.min(b.screenY, c.screenY) - 50;
    const endX = canvasRect.right + 300;
    const endY = canvasRect.bottom + 300;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });

    const rubberBand = page.locator('#rubber-band');
    await expect(rubberBand).toBeVisible();

    // The rubber-band element must stay within the canvas bounds.
    const bandRect = await rubberBand.boundingBox();
    expect(bandRect).not.toBeNull();
    const bandRight = bandRect!.x + bandRect!.width;
    const bandBottom = bandRect!.y + bandRect!.height;
    expect(bandRect!.x).toBeGreaterThanOrEqual(canvasRect.left - 2);
    expect(bandRect!.y).toBeGreaterThanOrEqual(canvasRect.top - 2);
    expect(bandRight).toBeLessThanOrEqual(canvasRect.right + 2);
    expect(bandBottom).toBeLessThanOrEqual(canvasRect.bottom + 2);

    await page.mouse.up();
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_b');
    expect(selected).toContain('marine_c');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b2-drag-outside-canvas.png') });
  });

  // -------------------------------------------------------------------------
  // B3 — Esc key clears selection
  // -------------------------------------------------------------------------

  test('B3: Esc 键清除所有选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__testHarness.getSelectedActors())).toHaveLength(6);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(false);
    expect(await page.evaluate(() => window.__testHarness.isSelected('tank_alpha'))).toBe(false);
    await expect(page.locator('#stat-count')).toHaveText('0');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b3-escape-clears.png') });
  });

  // -------------------------------------------------------------------------
  // B4 — Window resize to 1280x720
  // -------------------------------------------------------------------------

  test('B4: 窗口缩放到 1280x720 后 rubber-band 框选仍正常', async ({ page }) => {
    const errors = pageErrors(page);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(800);

    const canvasRect = await page.evaluate(() => window.__testHarness.getCanvasRect());
    expect(canvasRect.width).toBeGreaterThan(0);
    expect(canvasRect.height).toBeGreaterThan(0);
    expect(canvasRect.width).toBeLessThanOrEqual(1280);
    expect(canvasRect.height).toBeLessThanOrEqual(720);

    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');

    await page.mouse.move(b.screenX - 40, b.screenY - 40);
    await page.mouse.down();
    await page.mouse.move(c.screenX + 40, c.screenY + 40, { steps: 6 });

    const rubberBand = page.locator('#rubber-band');
    await expect(rubberBand).toBeVisible();

    await page.mouse.up();
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_b');
    expect(selected).toContain('marine_c');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b4-resize-1280x720.png') });

    // Restore default viewport for subsequent serial tests.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // B5 — Select All button
  // -------------------------------------------------------------------------

  test('B5: #btn-select-all 选中全部 6 个 actor', async ({ page }) => {
    const errors = pageErrors(page);

    await page.locator('#btn-select-all').click();
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(6);
    expect(selected.sort()).toEqual([
      'marine_a', 'marine_b', 'marine_c', 'marine_d',
      'tank_alpha', 'tank_beta',
    ]);
    await expect(page.locator('#stat-count')).toHaveText('6');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b5-select-all-button.png') });
  });

  // -------------------------------------------------------------------------
  // B6 — Deselect All button
  // -------------------------------------------------------------------------

  test('B6: #btn-deselect-all 清除所有选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__testHarness.getSelectedActors())).toHaveLength(6);

    await page.locator('#btn-deselect-all').click();
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    await expect(page.locator('#stat-count')).toHaveText('0');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b6-deselect-all-button.png') });
  });

  // -------------------------------------------------------------------------
  // B7 — Reset button
  // -------------------------------------------------------------------------

  test('B7: #btn-reset 清除所有选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__testHarness.getSelectedActors())).toHaveLength(6);

    await page.locator('#btn-reset').click();
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    await expect(page.locator('#stat-count')).toHaveText('0');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b7-reset-button.png') });
  });

  // -------------------------------------------------------------------------
  // B8 — Toggle health bars
  // -------------------------------------------------------------------------

  test('B8: #btn-toggle-healthbars 切换血量条可见性', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(300);

    let visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(Object.values(visibility).some((v) => v)).toBe(true);

    await page.locator('#btn-toggle-healthbars').click();
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => window.__testHarness.areHealthBarsVisible())).toBe(false);
    visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(Object.values(visibility).every((v) => !v)).toBe(true);

    await page.screenshot({ path: evidenceFile('b8-healthbars-hidden.png') });

    await page.locator('#btn-toggle-healthbars').click();
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => window.__testHarness.areHealthBarsVisible())).toBe(true);
    visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(Object.values(visibility).every((v) => v)).toBe(true);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b8-healthbars-shown-again.png') });
  });

  // -------------------------------------------------------------------------
  // B9 — Rapid consecutive clicks on different actors
  // -------------------------------------------------------------------------

  test('B9: 快速连续点击不同 actor 仅最后一次被选中', async ({ page }) => {
    const errors = pageErrors(page);

    const a = await getActorScreenPoint(page, 'marine_a');
    const t = await getActorScreenPoint(page, 'tank_alpha');
    const b = await getActorScreenPoint(page, 'marine_b');

    await page.mouse.click(a.screenX, a.screenY);
    await page.waitForTimeout(60);
    await page.mouse.click(t.screenX, t.screenY);
    await page.waitForTimeout(60);
    await page.mouse.click(b.screenX, b.screenY);
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toEqual(['marine_b']);
    expect(selected).toHaveLength(1);
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(false);
    expect(await page.evaluate(() => window.__testHarness.isSelected('tank_alpha'))).toBe(false);
    await expect(page.locator('#stat-count')).toHaveText('1');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b9-rapid-different-actors.png') });
  });

  // -------------------------------------------------------------------------
  // B10 — Shift+click same actor twice toggles on then off
  // -------------------------------------------------------------------------

  test('B10: Shift+同一 actor 两次切换选中状态 on → off', async ({ page }) => {
    const errors = pageErrors(page);

    const a = await getActorScreenPoint(page, 'marine_a');

    await page.keyboard.down('Shift');
    await page.mouse.click(a.screenX, a.screenY);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    let selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_a');

    await page.keyboard.down('Shift');
    await page.mouse.click(a.screenX, a.screenY);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).not.toContain('marine_a');
    expect(selected).toHaveLength(0);
    await expect(page.locator('#stat-count')).toHaveText('0');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b10-shift-toggle-same-actor.png') });
  });

  // -------------------------------------------------------------------------
  // B11 — Drag with no modifier keys held: normal single-selection behavior
  // -------------------------------------------------------------------------

  test('B11: 无 Shift 拖拽框选覆盖旧选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(true);

    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');

    await page.mouse.move(b.screenX - 40, b.screenY - 40);
    await page.mouse.down();
    await page.mouse.move(c.screenX + 40, c.screenY + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_b');
    expect(selected).toContain('marine_c');
    expect(selected).not.toContain('marine_a');
    expect(selected).toHaveLength(2);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b11-drag-no-modifier-clears-old.png') });
  });

  // -------------------------------------------------------------------------
  // B12 — Canvas context menu prevented
  // -------------------------------------------------------------------------

  test('B12: canvas 右键 contextmenu 被阻止且不影响后续交互', async ({ page }) => {
    const errors = pageErrors(page);

    // Verify the contextmenu event is default-prevented.
    const prevented = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const canvas = document.getElementById('renderCanvas')!;
        const handler = (e: Event) => {
          canvas.removeEventListener('contextmenu', handler);
          resolve(e.defaultPrevented);
        };
        canvas.addEventListener('contextmenu', handler);
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + 60,
          clientY: rect.top + 60,
        }));
        setTimeout(() => {
          canvas.removeEventListener('contextmenu', handler);
          resolve(false);
        }, 500);
      });
    });
    expect(prevented).toBe(true);

    // Real right-click on a blank area should not create a selection.
    const blank = await findBlankScreenPoint(page);
    await page.mouse.click(blank.screenX, blank.screenY, { button: 'right' });
    await page.waitForTimeout(200);

    let selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);

    // Subsequent left-click interaction must remain normal.
    const a = await getActorScreenPoint(page, 'marine_a');
    await page.mouse.click(a.screenX, a.screenY);
    await page.waitForTimeout(300);
    selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toEqual(['marine_a']);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('b12-context-menu-prevented.png') });
  });
});
