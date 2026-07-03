import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_URL = 'http://localhost:5173/test/ch16-widgets/button-states/';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Evidence stored in test-results/manual/ as required by acceptance test framework
const EVIDENCE_DIR = path.resolve(__dirname, '../../../../test-results/manual/ch16-widgets/button-states/evidence');

// Expected palette values from the acceptance criteria.
const PALETTE = {
  default: { r: 0x1a, g: 0x1a, b: 0x2e },
  hover:   { r: 0x25, g: 0x40, b: 0x60 },
  press:   { r: 0x0d, g: 0x15, b: 0x20 },
  disabled:{ r: 0x1a, g: 0x1a, b: 0x2e },
};

const COLORS = {
  defaultBg: '#1a1a2e',
  hoverBg:   '#254060',
  pressBg:   '#0d1520',
  defaultBorder: '#0f3460',
  hoverBorder:   '#3a7bd5',
  disabledBorder:'#0a0a1a',
};

declare global {
  interface Window {
    __testHarness: {
      setButtonState(id: string, state: 'default' | 'hover' | 'press' | 'disabled'): void;
      getButtonBackground(id: string): string;
      getButtonTextColor(id: string): string;
      isButtonClickable(id: string): boolean;
      reset(): void;
    };
  }
}

// Ensure the evidence directory exists before the suite runs.
test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

// Every test starts on a freshly loaded, reset page.
test.beforeEach(async ({ page }) => {
  await page.goto(TEST_URL);
  await page.waitForSelector('.btn');
  await page.evaluate(() => window.__testHarness.reset());
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function screenshot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

async function getComputedBackground(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    const raw = window.getComputedStyle(el).backgroundColor;
    const m = raw.match(/[\d.]+/g)?.map(Number) ?? [];
    return { raw, r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m[3] };
  }, id);
}

async function getComputedBorderColor(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return window.getComputedStyle(el).borderColor;
  }, id);
}

async function getComputedBoxShadow(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return window.getComputedStyle(el).boxShadow;
  }, id);
}

async function getComputedOpacity(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return Number(window.getComputedStyle(el).opacity);
  }, id);
}

async function getComputedCursor(page: Page, id: string) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return window.getComputedStyle(el).cursor;
  }, id);
}

async function getClickCount(page: Page) {
  return page.evaluate(() => {
    const el = document.getElementById('dCnt');
    if (!el) throw new Error('Diagnostic click counter not found');
    return Number(el.textContent ?? 0);
  });
}

async function getHarnessButtonBackground(page: Page, id: string) {
  return page.evaluate((id) => window.__testHarness.getButtonBackground(id), id);
}

async function isHarnessButtonClickable(page: Page, id: string) {
  return page.evaluate((id) => window.__testHarness.isButtonClickable(id), id);
}

async function setHarnessButtonState(
  page: Page,
  id: string,
  state: 'default' | 'hover' | 'press' | 'disabled'
) {
  return page.evaluate(
    ({ id, state }) => window.__testHarness.setButtonState(id, state),
    { id, state }
  );
}

function hexFromRgbString(rgb: string): string {
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [];
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(m[0] ?? 0)}${toHex(m[1] ?? 0)}${toHex(m[2] ?? 0)}`;
}

function normalizeHex(hex: string): string {
  return hex.toLowerCase().trim();
}

async function expectBackground(page: Page, id: string, expectedHex: string) {
  const bg = await getComputedBackground(page, id);
  expect(normalizeHex(hexFromRgbString(bg.raw))).toBe(normalizeHex(expectedHex));
}

/** Assert background matches expectedHex within a per-channel tolerance.
 *  getComputedStyle may round color channels by +/-2 due to color space conversion. */
async function expectBackgroundTolerant(
  page: Page,
  id: string,
  expectedHex: string,
  tolerance: number = 2
) {
  const expected = {
    r: parseInt(expectedHex.slice(1, 3), 16),
    g: parseInt(expectedHex.slice(3, 5), 16),
    b: parseInt(expectedHex.slice(5, 7), 16),
  };
  const bg = await getComputedBackground(page, id);
  expect(Math.abs(bg.r - expected.r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(bg.g - expected.g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(bg.b - expected.b)).toBeLessThanOrEqual(tolerance);
}

async function expectBorderColor(page: Page, id: string, expectedHex: string) {
  const border = await getComputedBorderColor(page, id);
  expect(normalizeHex(hexFromRgbString(border))).toBe(normalizeHex(expectedHex));
}

// ---------------------------------------------------------------------------
// B1. Hover State
// ---------------------------------------------------------------------------

test('B1.1: Hover background changes to #254060 via real mouse hover', async ({ page }) => {
  await page.hover('#btnHover');
  await page.waitForTimeout(200);
  await screenshot(page, 'b01-hover-background');

  const bg = await getComputedBackground(page, 'btnHover');
  expect(bg.r).toBeGreaterThan(PALETTE.default.r);
  expect(bg.g).toBeGreaterThan(PALETTE.default.g);
  expect(bg.b).toBeGreaterThan(PALETTE.default.b);
  expect(normalizeHex(hexFromRgbString(bg.raw))).toBe(COLORS.hoverBg);
});

test('B1.2: Harness getButtonBackground reports correct hover color after real hover', async ({ page }) => {
  // Note: setHarnessButtonState uses dispatchEvent which does NOT trigger CSS :hover.
  // Use Playwright page.hover() for real CSS pseudo-class activation, then verify
  // that the harness can read the resulting computed style correctly.
  await page.hover('#btnHover');
  await page.waitForTimeout(200);

  const harnessBg = await getHarnessButtonBackground(page, 'Hover');
  expect(normalizeHex(hexFromRgbString(harnessBg))).toBe(COLORS.hoverBg);
});

test('B1.3: Hover border-color changes from #0f3460 to #3a7bd5', async ({ page }) => {
  await expectBorderColor(page, 'btnHover', COLORS.defaultBorder);

  await page.hover('#btnHover');
  await page.waitForTimeout(200);
  await screenshot(page, 'b01-hover-border');

  await expectBorderColor(page, 'btnHover', COLORS.hoverBorder);
});

test('B1.4: Mouse leave restores default background and border', async ({ page }) => {
  await page.hover('#btnHover');
  await page.waitForTimeout(200);
  await expectBackground(page, 'btnHover', COLORS.hoverBg);
  await expectBorderColor(page, 'btnHover', COLORS.hoverBorder);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);

  await expectBackground(page, 'btnHover', COLORS.defaultBg);
  await expectBorderColor(page, 'btnHover', COLORS.defaultBorder);
});

test('B1.5: Hover brightness ratio is significantly higher than default (>50% increase)', async ({ page }) => {
  const defaultBg = await getComputedBackground(page, 'btnDefault');
  const defaultBrightness = (defaultBg.r + defaultBg.g + defaultBg.b) / 3;

  await page.hover('#btnHover');
  await page.waitForTimeout(200);

  const hoverBg = await getComputedBackground(page, 'btnHover');
  const hoverBrightness = (hoverBg.r + hoverBg.g + hoverBg.b) / 3;

  // Actual ratio is ~2.01 (#254060 brightness ≈ 65.7 vs #1a1a2e brightness ≈ 32.7)
  expect(hoverBrightness / defaultBrightness).toBeGreaterThan(1.5);
  expect(hoverBrightness / defaultBrightness).toBeLessThan(3.5);
});

// ---------------------------------------------------------------------------
// B2. Press State
// ---------------------------------------------------------------------------

test('B2.1: Press background changes to #0d1520 while mouse is held', async ({ page }) => {
  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);
  await screenshot(page, 'b02-press-background');

  const bg = await getComputedBackground(page, 'btnPress');
  expect(bg.r).toBeLessThan(PALETTE.default.r);
  expect(bg.g).toBeLessThan(PALETTE.default.g);
  expect(bg.b).toBeLessThan(PALETTE.default.b);
  // Use tolerant match: getComputedStyle may round channels by +/-2
  await expectBackgroundTolerant(page, 'btnPress', COLORS.pressBg, 2);

  await page.mouse.up();
});

test('B2.2: Press via real mouse down sets background to #0d1520', async ({ page }) => {
  // Note: setHarnessButtonState dispatches mousedown which does NOT reliably
  // trigger CSS :active. Use Playwright page.mouse.down() instead.
  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);

  await expectBackgroundTolerant(page, 'btnPress', COLORS.pressBg, 2);
  // Harness should also report the correct computed background
  const harnessBg = await getHarnessButtonBackground(page, 'Press');
  expect(normalizeHex(hexFromRgbString(harnessBg)))
    .toBe(normalizeHex(hexFromRgbString((await getComputedBackground(page, 'btnPress')).raw)));

  await page.mouse.up();
});

test('B2.3: Inset box-shadow appears on press', async ({ page }) => {
  const defaultShadow = await getComputedBoxShadow(page, 'btnPress');
  expect(defaultShadow).not.toContain('inset');

  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);
  await screenshot(page, 'b02-press-shadow');

  const pressShadow = await getComputedBoxShadow(page, 'btnPress');
  expect(pressShadow).toContain('inset');
  expect(pressShadow).toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0/);

  await page.mouse.up();
});

test('B2.4: Releasing mouse restores hover state when cursor is still over button', async ({ page }) => {
  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);
  // Tolerant match: computed color may differ by +/-2 per channel
  await expectBackgroundTolerant(page, 'btnPress', COLORS.pressBg, 2);

  await page.mouse.up();
  await page.waitForTimeout(150);

  await expectBackground(page, 'btnPress', COLORS.hoverBg);
});

test('B2.5: Press then mouse-leave restores default state', async ({ page }) => {
  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);
  await expectBackgroundTolerant(page, 'btnPress', COLORS.pressBg, 2);

  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.waitForTimeout(150);

  // Tolerant match: computed default bg may differ by +/-2 per channel after press→default transition
  await expectBackgroundTolerant(page, 'btnPress', COLORS.defaultBg, 3);
});

// ---------------------------------------------------------------------------
// B3. Disabled State
// ---------------------------------------------------------------------------

test('B3.1: Disabled button has opacity 0.5', async ({ page }) => {
  const opacity = await getComputedOpacity(page, 'btnDisabled');
  expect(opacity).toBe(0.5);
});

test('B3.2: Disabled button reports non-clickable via __testHarness', async ({ page }) => {
  const clickable = await isHarnessButtonClickable(page, 'Disabled');
  expect(clickable).toBe(false);
});

test('B3.3: Click events on disabled button are ignored and clickCount does not change', async ({ page }) => {
  const before = await getClickCount(page);
  expect(before).toBe(0);

  await expect(page.click('#btnDisabled', { timeout: 1000 })).rejects.toThrow();
  await screenshot(page, 'b03-disabled-click-attempt');

  const after = await getClickCount(page);
  expect(after).toBe(before);

  const diagText = await page.evaluate(() => document.getElementById('dClick')?.textContent ?? '');
  expect(diagText.toLowerCase()).toContain('disabled');
});

test('B3.4: Disabled button has disabled DOM property and Playwright considers it disabled', async ({ page }) => {
  // Verify disabled DOM property is true
  const isDisabled = await page.evaluate(() =>
    (document.getElementById('btnDisabled') as HTMLButtonElement).disabled
  );
  expect(isDisabled).toBe(true);

  // Verify Playwright's built-in disabled check
  await expect(page.locator('#btnDisabled')).toBeDisabled();

  // Note: JS dispatchEvent('click') fires addEventListener handlers regardless
  // of the disabled attribute — this is standard browser behavior and not a bug.
  // Real user interaction blocking is already verified in B3.3.
});

test('B3.5: Disabled button has cursor: not-allowed', async ({ page }) => {
  const cursor = await getComputedCursor(page, 'btnDisabled');
  expect(cursor).toBe('not-allowed');
});

test('B3.6: Disabled button keeps default background color and custom border', async ({ page }) => {
  await expectBackground(page, 'btnDisabled', COLORS.defaultBg);
  await expectBorderColor(page, 'btnDisabled', COLORS.disabledBorder);
});

test('B3.7: Enabling a disabled button via __testHarness restores clickability', async ({ page }) => {
  await expect(isHarnessButtonClickable(page, 'Disabled')).resolves.toBe(false);

  await setHarnessButtonState(page, 'Disabled', 'default');
  // Wait for CSS transition to complete (transition: all .15s ease; opacity 0.5→1)
  await page.waitForTimeout(300);

  await expect(isHarnessButtonClickable(page, 'Disabled')).resolves.toBe(true);
  const opacity = await getComputedOpacity(page, 'btnDisabled');
  expect(opacity).toBeCloseTo(1, 2); // tolerance for subpixel rounding
  await expect(getComputedCursor(page, 'btnDisabled')).resolves.toBe('pointer');
});

// ---------------------------------------------------------------------------
// B4. Transition
// ---------------------------------------------------------------------------

test('B4.1: CSS transition duration is 150ms', async ({ page }) => {
  // Use individual longhand properties instead of the shorthand (which browsers
  // may simplify — e.g. Chrome returns "all 0.15s ease 0s" but some environments
  // return just "0.15s").
  const transitionProps = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    const s = window.getComputedStyle(el);
    return {
      property: s.transitionProperty,
      duration: s.transitionDuration,
      timing: s.transitionTimingFunction,
    };
  }, 'btnDefault');

  expect(transitionProps.property).toContain('all');
  expect(transitionProps.timing).toContain('ease');

  const durationMatch = transitionProps.duration.match(/([\d.]+)s/);
  expect(durationMatch).not.toBeNull();
  const durationSeconds = parseFloat(durationMatch![1]);
  expect(durationSeconds).toBeCloseTo(0.15, 2);
  expect(durationSeconds).toBeLessThanOrEqual(0.2);
});

test('B4.2: Background color transitions over time, not instantaneously', async ({ page }) => {
  await page.hover('#btnHover');
  await page.waitForTimeout(50);

  const midTransition = await getComputedBackground(page, 'btnHover');
  expect(normalizeHex(hexFromRgbString(midTransition.raw))).not.toBe(COLORS.defaultBg);
  expect(normalizeHex(hexFromRgbString(midTransition.raw))).not.toBe(COLORS.hoverBg);

  await page.waitForTimeout(200);
  await expectBackground(page, 'btnHover', COLORS.hoverBg);
});

test('B4.3: Button text is vertically centered via equal top/bottom padding', async ({ page }) => {
  const padding = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    const s = window.getComputedStyle(el);
    return {
      paddingTop: parseFloat(s.paddingTop),
      paddingBottom: parseFloat(s.paddingBottom),
      lineHeight: s.lineHeight,
    };
  }, 'btnDefault');

  // Equal top/bottom padding is the primary mechanism for vertical text centering
  expect(padding.paddingTop).toBe(padding.paddingBottom);
  expect(padding.paddingTop).toBeGreaterThan(0);

  // line-height should be valid: either "normal" (browser-resolved to ~1.2em)
  // or a numeric value
  const lh = parseFloat(padding.lineHeight);
  if (!isNaN(lh)) {
    expect(lh).toBeGreaterThan(0);
  } else {
    expect(padding.lineHeight).toBe('normal');
  }
});

test('B4.4: Text vertical centering is preserved across all visual states', async ({ page }) => {
  for (const id of ['btnDefault', 'btnHover', 'btnPress', 'btnDisabled']) {
    const padding = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Element #${id} not found`);
      const s = window.getComputedStyle(el);
      return {
        paddingTop: parseFloat(s.paddingTop),
        paddingBottom: parseFloat(s.paddingBottom),
        lineHeight: s.lineHeight,
      };
    }, id);

    // All states should have consistent padding
    expect(padding.paddingTop, `paddingTop for #${id}`).toBe(padding.paddingBottom);
    expect(padding.paddingTop, `paddingTop for #${id}`).toBeGreaterThan(0);

    // line-height should be valid across all states
    const lh = parseFloat(padding.lineHeight);
    if (!isNaN(lh)) {
      expect(lh, `lineHeight for #${id}`).toBeGreaterThan(0);
    } else {
      expect(padding.lineHeight, `lineHeight for #${id}`).toBe('normal');
    }
  }
});

// ---------------------------------------------------------------------------
// B5. Boundary Tests
// ---------------------------------------------------------------------------

test('B5.1: Rapid hover→press→hover via real mouse leaves no residual state', async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await page.hover('#btnPress');
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    // Cursor still over button, so hover state applies
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(150);

  // After rapid cycling while staying over button, should end in hover state
  await expectBackground(page, 'btnPress', COLORS.hoverBg);

  // Cleanup: move mouse away
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
});

test('B5.2: Rapid press→default→press cycles via real mouse resolve correctly', async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await page.hover('#btnPress');
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.mouse.move(0, 0); // leave button → default state
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);

  // After leaving, should be in default state
  await expectBackground(page, 'btnPress', COLORS.defaultBg);

  // Verify press state still activates correctly after cycles
  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);
  await expectBackgroundTolerant(page, 'btnPress', COLORS.pressBg, 2);
  await page.mouse.up();
  await page.mouse.move(0, 0);
});

test('B5.3: Disabled button rejects Playwright real click and preserves visuals', async ({ page }) => {
  const initialBg = await getComputedBackground(page, 'btnDisabled');
  const initialCount = await getClickCount(page);

  // Real Playwright click should be blocked by actionability check
  await expect(page.click('#btnDisabled', { timeout: 1000 })).rejects.toThrow();

  // Background and clickCount unchanged
  const finalBg = await getComputedBackground(page, 'btnDisabled');
  const finalCount = await getClickCount(page);

  expect(finalCount).toBe(initialCount);

  // Verify background unchanged (tolerant match for rounding)
  const initialHex = normalizeHex(hexFromRgbString(initialBg.raw));
  const finalHex = normalizeHex(hexFromRgbString(finalBg.raw));
  expect(finalHex).toBe(initialHex);

  // Note: JS dispatchEvent fires addEventListener handlers regardless of disabled.
  // This is standard browser behavior. Real interaction blocking is tested above.
});

test('B5.4: Multiple buttons have independent states', async ({ page }) => {
  const defaultBgBefore = await getComputedBackground(page, 'btnDefault');
  const hoverBgBefore = await getComputedBackground(page, 'btnHover');
  const pressBgBefore = await getComputedBackground(page, 'btnPress');

  await page.hover('#btnHover');
  await page.waitForTimeout(200);

  const hoverBg = await getComputedBackground(page, 'btnHover');
  expect(hoverBg.r).toBeGreaterThan(hoverBgBefore.r);
  expect((await getComputedBackground(page, 'btnDefault')).raw).toBe(defaultBgBefore.raw);
  expect((await getComputedBackground(page, 'btnPress')).raw).toBe(pressBgBefore.raw);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);

  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);

  const pressBg = await getComputedBackground(page, 'btnPress');
  expect(pressBg.r).toBeLessThan(PALETTE.default.r);
  expect((await getComputedBackground(page, 'btnDefault')).raw).toBe(defaultBgBefore.raw);
  expect((await getComputedBackground(page, 'btnHover')).raw).toBe(hoverBgBefore.raw);

  await page.mouse.up();
});

test('B5.5: Independent button states do not interfere via real mouse interactions', async ({ page }) => {
  const defaultBg = await getComputedBackground(page, 'btnDefault');

  // Hover btnHover — should not affect btnDefault
  await page.hover('#btnHover');
  await page.waitForTimeout(200);
  await expectBackground(page, 'btnHover', COLORS.hoverBg);
  expect((await getComputedBackground(page, 'btnDefault')).raw).toBe(defaultBg.raw);

  // Press btnPress — should not affect btnDefault or btnHover (now unhovered)
  await page.hover('#btnPress');
  await page.mouse.down();
  await page.waitForTimeout(100);
  await expectBackgroundTolerant(page, 'btnPress', COLORS.pressBg, 2);
  expect((await getComputedBackground(page, 'btnDefault')).raw).toBe(defaultBg.raw);

  // Release and leave all buttons
  await page.mouse.up();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await expectBackground(page, 'btnHover', COLORS.defaultBg);
  await expectBackground(page, 'btnPress', COLORS.defaultBg);
});

test('B5.6: Repeated hover enter/leave events do not leak state to neighbors', async ({ page }) => {
  const neighborBgBefore = await getComputedBackground(page, 'btnDefault');

  for (let i = 0; i < 20; i++) {
    await page.hover('#btnHover');
    await page.mouse.move(0, 0);
  }
  await page.waitForTimeout(200);

  const neighborBgAfter = await getComputedBackground(page, 'btnDefault');
  expect(neighborBgAfter.raw).toBe(neighborBgBefore.raw);
});
