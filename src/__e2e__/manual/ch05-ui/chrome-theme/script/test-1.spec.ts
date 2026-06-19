/**
 * chrome-theme.spec.ts — Automated acceptance test for ChromeProvider + ChromeMetrics
 *
 * Test page: http://localhost:5173/test/ch05-ui/chrome-theme/
 * Type: Pure DOM/CSS UI theme test (no Babylon.js dependency)
 *
 * Acceptance criteria covered:
 *   C1. Panel border / header / body colors match theme
 *   C2. Button hover, press and disabled states
 *   C3. Scrollbar thumb proportion and theme colors
 *   C4. Theme switching within one frame
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_URL = '/test/ch05-ui/chrome-theme/';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVIDENCE_DIR = path.join(__dirname, 'evidence', 'chrome-theme');

interface PanelStyle {
  bg: string;
  border: string;
  headerBg: string;
}

interface ButtonStyle {
  bg: string;
  text: string;
}

interface ScrollbarStyle {
  thumbRatio: number;
  trackBg: string;
  thumbBg: string;
}

function ensureEvidenceDir(): void {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
}

async function screenshot(page: Page, name: string): Promise<void> {
  ensureEvidenceDir();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true });
}

function hexChannel(hex: string, index: number): number {
  // Supports #RRGGBB and #RGB
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  return parseInt(normalized.slice(1 + index * 2, 3 + index * 2), 16);
}

// All harness interactions must happen inside page.evaluate because
// function references are not serializable across the page boundary.
async function getPanelStyle(page: Page): Promise<PanelStyle> {
  return page.evaluate(() => (window as any).__testHarness.getPanelStyle());
}

async function getButtonStyle(page: Page, state: 'normal' | 'hover' | 'press' | 'disabled'): Promise<ButtonStyle> {
  return page.evaluate((s) => (window as any).__testHarness.getButtonStyle(s), state);
}

async function getScrollbarStyle(page: Page): Promise<ScrollbarStyle> {
  return page.evaluate(() => (window as any).__testHarness.getScrollbarStyle());
}

async function getCurrentTheme(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__testHarness.getCurrentTheme());
}

async function loadTheme(page: Page, name: 'ra' | 'cnc' | 'd2k'): Promise<void> {
  await page.evaluate((n) => (window as any).__testHarness.loadTheme(n), name);
}

async function resetTheme(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.reset());
}

test.describe('Chrome Theme Acceptance Test (C1-C4)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    // Wait for the harness to be injected by the test page.
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 10000 });
    // Always start from a known baseline.
    await resetTheme(page);
    await page.waitForTimeout(100);
  });

  // ================================================================
  // C1. Panel Border Matches ChromeMetrics
  // ================================================================

  test('C1.1 - RA theme panel border matches ChromeMetrics (#0f3460)', async ({ page }) => {
    const style = await getPanelStyle(page);
    expect(style.border).toBe('#0f3460');
    await screenshot(page, 'c1-1-ra-panel-border');
  });

  test('C1.2 - RA theme panel header background matches theme (#16213e)', async ({ page }) => {
    const style = await getPanelStyle(page);
    expect(style.headerBg).toBe('#16213e');
  });

  test('C1.3 - Panel body background matches theme (RA #2B2B2B, CNC #2B2000)', async ({ page }) => {
    await resetTheme(page);
    const ra = await getPanelStyle(page);
    expect(ra.bg).toBe('#2B2B2B');

    await loadTheme(page, 'cnc');
    const cnc = await getPanelStyle(page);
    expect(cnc.bg).toBe('#2B2000');

    await screenshot(page, 'c1-3-panel-body-themes');
  });

  // ================================================================
  // C2. Button State Colors
  // ================================================================

  test('C2.1 - Button hover state brightens background by ~20%', async ({ page }) => {
    const normal = await getButtonStyle(page, 'normal');
    const hover = await getButtonStyle(page, 'hover');

    const normalR = hexChannel(normal.bg, 0);
    const hoverR = hexChannel(hover.bg, 0);
    const expectedHoverR = Math.min(255, Math.round(normalR * 1.2));

    expect(hoverR).toBe(expectedHoverR);
    expect(hoverR).toBeGreaterThan(normalR);
  });

  test('C2.2 - Button press state darkens background by ~20%', async ({ page }) => {
    const normal = await getButtonStyle(page, 'normal');
    const press = await getButtonStyle(page, 'press');

    const normalR = hexChannel(normal.bg, 0);
    const pressR = hexChannel(press.bg, 0);
    const expectedPressR = Math.max(0, Math.round(normalR * 0.8));

    expect(pressR).toBe(expectedPressR);
    expect(pressR).toBeLessThan(normalR);
  });

  test('C2.3 - Disabled button opacity is 45%', async ({ page }) => {
    const opacity = await page.evaluate(() => {
      const btn = document.getElementById('btnDisabled');
      if (!btn) return null;
      return window.getComputedStyle(btn).opacity;
    });

    expect(opacity).toBeDefined();
    expect(parseFloat(opacity!)).toBeCloseTo(0.45, 1);
    await screenshot(page, 'c2-3-disabled-button');
  });

  // ================================================================
  // C3. Scrollbar Proportional
  // ================================================================

  test('C3.1 - Scrollbar thumb size is proportional to content (clientH / scrollH)', async ({ page }) => {
    const style = await getScrollbarStyle(page);

    const expectedRatio = await page.evaluate(() => {
      const el = document.getElementById('scrollDemo')!;
      return el.clientHeight / (el.scrollHeight || 1);
    });

    expect(style.thumbRatio).toBeGreaterThan(0);
    expect(style.thumbRatio).toBeLessThan(1);
    expect(style.thumbRatio).toBeCloseTo(expectedRatio, 2);
  });

  test('C3.2 - RA scrollbar track (#1a1a2e) and thumb (#0f3460) match theme', async ({ page }) => {
    const style = await getScrollbarStyle(page);

    expect(style.trackBg).toBe('#1a1a2e');
    expect(style.thumbBg).toBe('#0f3460');
    await screenshot(page, 'c3-2-ra-scrollbar');
  });

  // ================================================================
  // C4. Theme Switch Within 1 Frame
  // ================================================================

  test('C4.1 - loadTheme(cnc) synchronously updates panel, button and scrollbar styles', async ({ page }) => {
    await loadTheme(page, 'cnc');

    const theme = await getCurrentTheme(page);
    const panel = await getPanelStyle(page);
    const btn = await getButtonStyle(page, 'normal');
    const scroll = await getScrollbarStyle(page);

    expect(theme).toBe('cnc');
    expect(panel.bg).toBe('#2B2000');
    expect(panel.border).toBe('#8B6914');
    expect(panel.headerBg).toBe('#3D2B00');
    expect(btn.bg).toBe('#4A3500');
    expect(btn.text).toBe('#FFD700');
    expect(scroll.trackBg).toBe('#2B2000');
    expect(scroll.thumbBg).toBe('#8B6914');

    await screenshot(page, 'c4-1-cnc-theme');
  });

  test('C4.2 - D2K desert palette applies border (#8B4513) and text (#DEB887)', async ({ page }) => {
    await loadTheme(page, 'd2k');

    const panel = await getPanelStyle(page);
    const btn = await getButtonStyle(page, 'normal');

    expect(panel.border).toBe('#8B4513');
    expect(btn.text).toBe('#DEB887');
    await screenshot(page, 'c4-2-d2k-theme');
  });

  // ================================================================
  // Diagnostic / regression coverage
  // ================================================================

  test('reset() returns all styles to RA theme', async ({ page }) => {
    await loadTheme(page, 'd2k');
    await resetTheme(page);

    const theme = await getCurrentTheme(page);
    const panel = await getPanelStyle(page);
    const btn = await getButtonStyle(page, 'normal');
    const scroll = await getScrollbarStyle(page);

    expect(theme).toBe('ra');
    expect(panel.bg).toBe('#2B2B2B');
    expect(panel.border).toBe('#0f3460');
    expect(panel.headerBg).toBe('#16213e');
    expect(btn.bg).toBe('#1a1a2e');
    expect(btn.text).toBe('#eee');
    expect(scroll.trackBg).toBe('#1a1a2e');
    expect(scroll.thumbBg).toBe('#0f3460');
  });

  test('rapid theme switching stays consistent', async ({ page }) => {
    const verify = async (expectedTheme: string, expectedBorder: string) => {
      expect(await getCurrentTheme(page)).toBe(expectedTheme);
      expect((await getPanelStyle(page)).border).toBe(expectedBorder);
    };

    await loadTheme(page, 'cnc');
    await verify('cnc', '#8B6914');

    await loadTheme(page, 'd2k');
    await verify('d2k', '#8B4513');

    await loadTheme(page, 'ra');
    await verify('ra', '#0f3460');

    await screenshot(page, 'rapid-theme-switch-ra-final');
  });
});
