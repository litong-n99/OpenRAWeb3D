import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Manual Acceptance Test: Selection Visual — Core Expectations (E1-E5)
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

test.describe('Selection Visual — Core Expectations (E1-E5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForHarness(page);
    await resetState(page);
  });

  test.afterEach(async ({ page }) => {
    await resetState(page);
  });

  // -------------------------------------------------------------------------
  // E1 — Single-click selection highlight
  // -------------------------------------------------------------------------

  test('E1.1: 单击 marine_a 后高亮并出现在选区列表', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_a');
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(true);
    await expect(page.locator('#stat-count')).toHaveText('1');
    await expect(page.locator('#selection-list')).toContainText('marine_a');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e1-1-select-marine-a.png') });
  });

  test('E1.2: 单击 tank_alpha 后旧高亮消失，仅 tank_alpha 被选中', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidenceFile('e1-2-before-tank-alpha.png') });

    await page.evaluate(() => window.__testHarness.clickActor('tank_alpha'));
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(false);
    expect(await page.evaluate(() => window.__testHarness.isSelected('tank_alpha'))).toBe(true);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toEqual(['tank_alpha']);
    await expect(page.locator('#stat-count')).toHaveText('1');
    await expect(page.locator('#selection-list')).toContainText('tank_alpha');
    await expect(page.locator('#selection-list')).not.toContainText('marine_a');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e1-2-switch-to-tank-alpha.png') });
  });

  // -------------------------------------------------------------------------
  // E2 — Rubber-band box selection
  // -------------------------------------------------------------------------

  test('E2.1: 拖拽真实鼠标生成框选框并选中 marine_b 和 marine_c', async ({ page }) => {
    const errors = pageErrors(page);

    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');

    const left = Math.min(b.screenX, c.screenX) - 50;
    const top = Math.min(b.screenY, c.screenY) - 50;
    const right = Math.max(b.screenX, c.screenX) + 50;
    const bottom = Math.max(b.screenY, c.screenY) + 50;

    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 6 });

    // Verify rubber-band is visible during drag.
    const rubberBand = page.locator('#rubber-band');
    await expect(rubberBand).toBeVisible();
    const displayDuringDrag = await page.evaluate(() => {
      const el = document.getElementById('rubber-band');
      return el ? window.getComputedStyle(el).display : 'none';
    });
    expect(displayDuringDrag).not.toBe('none');

    await page.mouse.up();
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_b');
    expect(selected).toContain('marine_c');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e2-1-box-select-b-and-c.png') });
  });

  test('E2.2: 拖拽 ≤4px 退化为单击（无 rubber-band，视为点击）', async ({ page }) => {
    const errors = pageErrors(page);

    const a = await getActorScreenPoint(page, 'marine_a');

    await page.mouse.move(a.screenX, a.screenY);
    await page.mouse.down();
    await page.mouse.move(a.screenX + 2, a.screenY + 2);
    await page.waitForTimeout(100);

    const displayDuringDrag = await page.evaluate(() => {
      const el = document.getElementById('rubber-band');
      return el ? window.getComputedStyle(el).display : 'block';
    });
    expect(displayDuringDrag).toBe('none');

    await page.mouse.up();
    await page.waitForTimeout(500);

    const boxBounds = await page.evaluate(() => window.__testHarness.getSelectionBoxBounds());
    expect(boxBounds).toBeNull();

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_a');
    expect(selected).toHaveLength(1);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e2-2-deadzone-click.png') });
  });

  test('E2.3: 松手后框选矩形立即消失', async ({ page }) => {
    const errors = pageErrors(page);

    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');

    await page.mouse.move(b.screenX - 30, b.screenY - 30);
    await page.mouse.down();
    await page.mouse.move(c.screenX + 30, c.screenY + 30, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const boxBounds = await page.evaluate(() => window.__testHarness.getSelectionBoxBounds());
    const display = await page.evaluate(() => {
      const el = document.getElementById('rubber-band');
      return el ? el.style.display : 'block';
    });
    expect(boxBounds).toBeNull();
    expect(display).toBe('none');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e2-3-rubber-band-hidden.png') });
  });

  // -------------------------------------------------------------------------
  // E3 — Shift modifier operations
  // -------------------------------------------------------------------------

  test('E3.1: Shift+单击追加并保留已有选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);

    const b = await getActorScreenPoint(page, 'marine_b');
    await page.keyboard.down('Shift');
    await page.mouse.click(b.screenX, b.screenY);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected.sort()).toEqual(['marine_a', 'marine_b']);
    await expect(page.locator('#stat-count')).toHaveText('2');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e3-1-shift-add-marine-b.png') });
  });

  test('E3.2: Shift+单击已选中 actor 将其从选区移除', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);

    const b = await getActorScreenPoint(page, 'marine_b');
    await page.keyboard.down('Shift');
    await page.mouse.click(b.screenX, b.screenY);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(500);

    let selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected.sort()).toEqual(['marine_a', 'marine_b']);

    const a = await getActorScreenPoint(page, 'marine_a');
    await page.keyboard.down('Shift');
    await page.mouse.click(a.screenX, a.screenY);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(500);

    selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toEqual(['marine_b']);
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(false);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e3-2-shift-toggle-off-marine-a.png') });
  });

  test('E3.3: Shift+拖拽追加 marine_d 到已有选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);

    const d = await getActorScreenPoint(page, 'marine_d');

    await page.keyboard.down('Shift');
    await page.mouse.move(d.screenX - 40, d.screenY - 40);
    await page.mouse.down();
    await page.mouse.move(d.screenX + 40, d.screenY + 40, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_a');
    expect(selected).toContain('marine_d');
    expect(selected).toHaveLength(2);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e3-3-shift-drag-add-marine-d.png') });
  });

  // -------------------------------------------------------------------------
  // E4 — Health bars
  // -------------------------------------------------------------------------

  test('E4.1: 选中 tank_alpha(100% HP) 显示血条', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('tank_alpha'));
    await page.waitForTimeout(500);

    const visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(visibility['tank_alpha']).toBe(true);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e4-1-tank-alpha-100hp.png') });
  });

  test('E4.2: 选中 tank_beta(50% HP) 显示血条', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('tank_beta'));
    await page.waitForTimeout(500);

    const visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(visibility['tank_beta']).toBe(true);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e4-2-tank-beta-50hp.png') });
  });

  test('E4.3: 选中 marine_d(25% HP) 显示血条', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_d'));
    await page.waitForTimeout(500);

    const visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(visibility['marine_d']).toBe(true);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e4-3-marine-d-25hp.png') });
  });

  test('E4.4: 多选时每个 actor 血条可见', async ({ page }) => {
    const errors = pageErrors(page);

    const b = await getActorScreenPoint(page, 'marine_b');
    const c = await getActorScreenPoint(page, 'marine_c');

    await page.mouse.move(b.screenX - 50, b.screenY - 50);
    await page.mouse.down();
    await page.mouse.move(c.screenX + 50, c.screenY + 50, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_b');
    expect(selected).toContain('marine_c');

    const visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(visibility['marine_b']).toBe(true);
    expect(visibility['marine_c']).toBe(true);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e4-4-multi-health-bars.png') });
  });

  test('E4.5: 清空选区后所有血条隐藏', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.selectAll());
    await page.waitForTimeout(500);

    let visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(Object.values(visibility).some((v) => v)).toBe(true);

    await page.evaluate(() => window.__testHarness.clearSelection());
    await page.waitForTimeout(500);

    visibility = await page.evaluate(() => window.__testHarness.getHealthBarVisibility());
    expect(Object.values(visibility).every((v) => !v)).toBe(true);
    expect(await page.evaluate(() => window.__testHarness.getSelectedActors())).toHaveLength(0);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e4-5-health-bars-cleared.png') });
  });

  // -------------------------------------------------------------------------
  // E5 — Empty click clears
  // -------------------------------------------------------------------------

  test('E5.1: 点击空地清除普通选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);

    let selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toContain('marine_a');

    const blank = await findBlankScreenPoint(page);
    await page.mouse.click(blank.screenX, blank.screenY);
    await page.waitForTimeout(500);

    selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(false);
    await expect(page.locator('#stat-count')).toHaveText('0');

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e5-1-empty-click-clears.png') });
  });

  test('E5.2: Shift+点击空地同样清除选区', async ({ page }) => {
    const errors = pageErrors(page);

    await page.evaluate(() => window.__testHarness.clickActor('marine_a'));
    await page.waitForTimeout(500);

    const blank = await findBlankScreenPoint(page);
    await page.keyboard.down('Shift');
    await page.mouse.click(blank.screenX, blank.screenY);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(500);

    const selected = await page.evaluate(() => window.__testHarness.getSelectedActors());
    expect(selected).toHaveLength(0);
    expect(await page.evaluate(() => window.__testHarness.isSelected('marine_a'))).toBe(false);

    assertNoErrors(errors);
    await page.screenshot({ path: evidenceFile('e5-2-shift-empty-click-clears.png') });
  });
});
