import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../../test-results/manual/ch16-widgets/dropdown-menu/evidence');

const COLORS = {
  defaultBg: '#1a1a2e',
  hoverBg: '#254060',
  selectedBg: '#0f3460',
  selectedColor: '#7ec8e3',
};

declare global {
  interface Window {
    __testHarness: {
      openDropdown(): void;
      selectItem(id: string, idx: number): void;
      getSelectedItem(): number;
      getMenuHeight(): number;
      isMenuOpen(): boolean;
      reset(): void;
    };
  }
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto('/test/ch16-widgets/dropdown-menu/');
  await page.waitForSelector('#dd');
  await page.evaluate(() => window.__testHarness.reset());
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

async function getRotationAngle(page: Page, selector: string): Promise<number> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`Element ${selector} not found`);
    const transform = window.getComputedStyle(el).transform;
    if (!transform || transform === 'none') return 0;
    const matrix = new DOMMatrix(transform);
    // matrix(a, b, c, d, e, f) for pure rotation: a=cosθ, b=sinθ
    return Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
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

// -----------------------------------------------------------------------------
// D1. Open/Close Animation
// -----------------------------------------------------------------------------

test('D1.1: 打开动画 max-height 过渡 ≤200ms', async ({ page }) => {
  const duration = await page.evaluate(() => {
    const menu = document.getElementById('ddMenu');
    if (!menu) throw new Error('Menu not found');
    const s = window.getComputedStyle(menu);
    return s.transitionDuration;
  });

  const match = duration.match(/([\d.]+)s/);
  expect(match).not.toBeNull();
  const durationSeconds = parseFloat(match![1]);
  expect(durationSeconds).toBeCloseTo(0.2, 2);
  expect(durationSeconds).toBeLessThanOrEqual(0.2);
});

test('D1.1: 真实点击 toggle 后菜单在 ≤200ms 内展开', async ({ page }) => {
  const startTime = performance.now();
  await page.click('#ddToggle');

  // 轮询 harness 状态直到菜单打开
  await page.waitForFunction(() => window.__testHarness.isMenuOpen(), { timeout: 250 });
  const elapsed = performance.now() - startTime;

  expect(elapsed).toBeLessThanOrEqual(250); // 200ms transition + buffer
  await page.waitForTimeout(250);
  await screenshot(page, 'd01-open-animation');
});

test('D1.2: 打开时箭头旋转 180°', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);
  await screenshot(page, 'd01-arrow-rotated');

  const angle = await getRotationAngle(page, '#ddToggle .arrow');
  expect(Math.abs(angle)).toBeCloseTo(180, 1);
});

// -----------------------------------------------------------------------------
// D2. Item Selection
// -----------------------------------------------------------------------------

test('D2.1: 点击选中项后 label 立即更新为选中项文本', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  const labelBefore = await page.locator('#ddLabel').textContent();
  expect(labelBefore).toBe('Select Item');

  await page.click('.dropdown-item[data-idx="2"]');

  const labelAfter = await page.locator('#ddLabel').textContent();
  expect(labelAfter).toBe('Option Gamma');

  const selectedIdx = await page.evaluate(() => window.__testHarness.getSelectedItem());
  expect(selectedIdx).toBe(2);
  await screenshot(page, 'd02-selected-label');
});

test('D2.2: 选中项应用 .selected 样式', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  await page.click('.dropdown-item[data-idx="1"]');
  await page.waitForTimeout(100);

  // 通过 harness 重新打开菜单以便检查选中样式
  await page.evaluate(() => window.__testHarness.openDropdown());
  await page.waitForTimeout(300);

  const selected = page.locator('.dropdown-item.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-idx', '1');

  await expectBackground(page, '.dropdown-item.selected', COLORS.selectedBg);
  await expectColor(page, '.dropdown-item.selected', COLORS.selectedColor);
  await screenshot(page, 'd02-selected-style');
});

// -----------------------------------------------------------------------------
// D3. Hover Highlight
// -----------------------------------------------------------------------------

test('D3.1: Hover item 背景变为 #254060 且与默认项不同', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  // 菜单容器背景为 #1a1a2e
  await expectBackground(page, '#ddMenu', COLORS.defaultBg);

  const item = page.locator('.dropdown-item[data-idx="0"]');
  const defaultItemBg = await getComputedBackground(page, '.dropdown-item[data-idx="0"]');

  await item.hover();
  await page.waitForTimeout(150);
  await screenshot(page, 'd03-hover-highlight');

  const hoverItemBg = await getComputedBackground(page, '.dropdown-item[data-idx="0"]');
  await expectBackground(page, '.dropdown-item[data-idx="0"]', COLORS.hoverBg);
  expect(hoverItemBg).not.toBe(defaultItemBg);
});

test('D3.2: Hover 后移出 item 背景恢复透明/默认', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  const item = page.locator('.dropdown-item[data-idx="0"]');
  const defaultItemBg = await getComputedBackground(page, '.dropdown-item[data-idx="0"]');

  await item.hover();
  await page.waitForTimeout(150);
  await expectBackground(page, '.dropdown-item[data-idx="0"]', COLORS.hoverBg);

  // 移出菜单区域
  await page.mouse.move(0, 0);
  await page.waitForTimeout(150);
  await screenshot(page, 'd03-hover-leave');

  const restoredBg = await getComputedBackground(page, '.dropdown-item[data-idx="0"]');
  expect(restoredBg).toBe(defaultItemBg);
});

// -----------------------------------------------------------------------------
// D4. Outside Click Close
// -----------------------------------------------------------------------------

test('D4.1: 点击 dropdown 外部后菜单关闭', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__testHarness.isMenuOpen())).toBe(true);

  // 点击页面空白区域（header 区域）
  await page.click('#header');
  await page.waitForTimeout(200);
  await screenshot(page, 'd04-outside-click-close');

  expect(await page.evaluate(() => window.__testHarness.isMenuOpen())).toBe(false);
  await expect(page.locator('#dd')).not.toHaveClass(/open/);
});

test('D4.2: 点击 toggle 不触发 document click (stopPropagation 正确)', async ({ page }) => {
  // 注入 document click 计数器
  const docClickCount = await page.evaluate(() => {
    (window as any).__docClickCount = 0;
    const counter = () => {
      (window as any).__docClickCount++;
    };
    document.addEventListener('click', counter);
    return (window as any).__docClickCount;
  });
  expect(docClickCount).toBe(0);

  // 用真实鼠标点击 toggle
  await page.click('#ddToggle');
  await page.waitForTimeout(200);
  await screenshot(page, 'd04-toggle-stop-propagation');

  const afterToggleClick = await page.evaluate(() => (window as any).__docClickCount);
  expect(afterToggleClick).toBe(0); // stopPropagation 阻止了 document click

  // 点击外部应触发 document click 并关闭菜单
  await page.click('#header');
  await page.waitForTimeout(200);
  const afterOutsideClick = await page.evaluate(() => (window as any).__docClickCount);
  expect(afterOutsideClick).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__testHarness.isMenuOpen())).toBe(false);

  // 清理计数器
  await page.evaluate(() => delete (window as any).__docClickCount);
});

// -----------------------------------------------------------------------------
// D5. Scroll on Overflow
// -----------------------------------------------------------------------------

test('D5.1: 8 项菜单展开后 overflow-y:auto 激活', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  const overflowY = await page.evaluate(() => {
    const menu = document.getElementById('ddMenu');
    if (!menu) throw new Error('Menu not found');
    return window.getComputedStyle(menu).overflowY;
  });

  expect(overflowY).toBe('auto');
  await screenshot(page, 'd05-overflow-auto');
});

test('D5.2: 8 项菜单 scrollHeight > 200px', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  const menuHeight = await page.evaluate(() => window.__testHarness.getMenuHeight());
  expect(menuHeight).toBeGreaterThan(200);

  const maxHeight = await page.evaluate(() => {
    const menu = document.getElementById('ddMenu');
    if (!menu) throw new Error('Menu not found');
    return parseFloat(window.getComputedStyle(menu).maxHeight);
  });
  expect(maxHeight).toBe(200);
  await screenshot(page, 'd05-scroll-height');
});

test('D5: 菜单可滚动到最后一项 Option Theta', async ({ page }) => {
  await page.click('#ddToggle');
  await page.waitForTimeout(300);

  const lastItem = page.locator('.dropdown-item[data-idx="7"]');
  await lastItem.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await screenshot(page, 'd05-scroll-to-last');

  await expect(lastItem).toBeVisible();
  expect(await lastItem.textContent()).toBe('Option Theta');
});
