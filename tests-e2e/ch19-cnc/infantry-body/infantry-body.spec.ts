/**
 * Playwright E2E Tests — Ch19 CNC Infantry Body Layers
 *
 * Target: http://localhost:5173/test/ch19-cnc/infantry-body/
 * Modules:
 *   - WithDisguisingInfantryBody
 *   - WithSplitAttackPaletteInfantryBody
 *   - WithHarvesterSpriteBody
 *
 * Acceptance criteria covered:
 *   E1. Body layer — default GDI infantry, six sub-mesh body, always visible
 *   E2. Disguise layer — three identity cycle, immediate color/image update
 *   E3. Attack overlay — yellow muzzle-flash plane, ~400ms duration
 *   E4. Idle overlay — blue blink plane, toggle on/off
 *   E5. Harvester fullness — body color gradient 0% → 100%
 *   E6. Display modes — all / body-only / overlay-only / exploded
 *   B1. Boundary — disguise Soviet + attack
 *   B2. Boundary — fullness 100% then disguise Allied
 *
 * Verification strategy:
 *   - DOM state panel (st-*) is the primary source of truth.
 *   - Canvas/WebGL screenshots are captured as visual evidence only.
 *   - No __testHarness API is used; the page does not expose one.
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch19-cnc/infantry-body/';
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch19-cnc/infantry-body/evidence'
);

interface StatePanel {
  disguise: string;
  attack: string;
  idle: string;
  fullness: string;
  image: string;
  mode: string;
}

function evidenceFile(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

async function waitForCanvasReady(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(BASE_URL);
  await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      return el != null && el.textContent?.includes('WebGL') === true;
    },
    { timeout: 15000 }
  );
  // Give Babylon.js a chance to render the first frames.
  await page.waitForTimeout(1500);
}

async function readStatePanel(page: Page): Promise<StatePanel> {
  const [
    disguise,
    attack,
    idle,
    fullness,
    image,
    mode,
  ] = await Promise.all([
    page.locator('#st-disguise').textContent(),
    page.locator('#st-attack').textContent(),
    page.locator('#st-idle').textContent(),
    page.locator('#st-fullness').textContent(),
    page.locator('#st-image').textContent(),
    page.locator('#st-mode').textContent(),
  ]);
  return {
    disguise: disguise ?? '',
    attack: attack ?? '',
    idle: idle ?? '',
    fullness: fullness ?? '',
    image: image ?? '',
    mode: mode ?? '',
  };
}

async function setFullness(page: Page, value: number): Promise<void> {
  await page.evaluate(
    ({ val }) => {
      const slider = document.getElementById('rng-fullness') as HTMLInputElement | null;
      if (!slider) throw new Error('Fullness slider not found');
      slider.value = String(val);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { val: value }
  );
  await page.waitForTimeout(150);
}

async function selectDisplayMode(page: Page, mode: string): Promise<void> {
  await page.locator('#sel-mode').selectOption(mode);
  await page.waitForTimeout(150);
}

async function clickDisguise(page: Page): Promise<void> {
  await page.locator('#btn-disguise').click();
  await page.waitForTimeout(50);
}

async function clickAttack(page: Page): Promise<void> {
  await page.locator('#btn-attack').click();
  await page.waitForTimeout(50);
}

async function toggleIdleOverlay(page: Page): Promise<void> {
  await page.locator('#btn-idle-overlay').click();
  await page.waitForTimeout(50);
}

async function clickReset(page: Page): Promise<void> {
  await page.locator('#btn-reset').click();
  await page.waitForTimeout(200);
}

/**
 * Very light canvas sanity check: the centre pixel must have non-zero alpha.
 * This only guards against a completely blank/failed WebGL context; colors are
 * verified visually via screenshots because lighting and tone-mapping make
 * exact pixel assertions unreliable.
 */
async function centerPixelHasAlpha(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return false;
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel
    );
    return pixel[3] > 0;
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('Ch19 CNC Infantry Body Layers', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvasReady(page);
  });

  // -------------------------------------------------------------------------
  // E1. Body Layer
  // -------------------------------------------------------------------------
  test('E1: Body Layer — default GDI infantry is visible', async ({ page }) => {
    const state = await readStatePanel(page);

    expect(state.disguise).toContain('无伪装');
    expect(state.image).toBe('e1');
    expect(state.mode).toBe('all');
    expect(state.attack).toBe('false');
    expect(state.idle).toBe('true');
    expect(state.fullness).toBe('30');

    const engineInfo = await page.locator('#info-engine').textContent();
    expect(engineInfo).toContain('WebGL');

    expect(await centerPixelHasAlpha(page)).toBe(true);

    await page.screenshot({
      path: evidenceFile('e1-default-gdi-body.png'),
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // E2. Disguise Layer
  // -------------------------------------------------------------------------
  test('E2: Disguise Layer — cycles through 3 identities and updates image', async ({ page }) => {
    // 1st click: none -> Allied
    await clickDisguise(page);
    let state = await readStatePanel(page);
    expect(state.disguise).toContain('盟军');
    expect(state.image).toBe('e1-disguised-allied');
    await page.screenshot({ path: evidenceFile('e2-disguise-allied.png') });

    // 2nd click: Allied -> Soviet
    await clickDisguise(page);
    state = await readStatePanel(page);
    expect(state.disguise).toContain('苏联');
    expect(state.image).toBe('e1-disguised-soviet');
    await page.screenshot({ path: evidenceFile('e2-disguise-soviet.png') });

    // 3rd click: Soviet -> none
    await clickDisguise(page);
    state = await readStatePanel(page);
    expect(state.disguise).toContain('无伪装');
    expect(state.image).toBe('e1');
    await page.screenshot({ path: evidenceFile('e2-disguise-reset.png') });
  });

  // -------------------------------------------------------------------------
  // E3. Attack Overlay
  // -------------------------------------------------------------------------
  test('E3: Attack Overlay — visible immediately and hides after ~400ms', async ({ page }) => {
    let state = await readStatePanel(page);
    expect(state.attack).toBe('false');

    await clickAttack(page);
    state = await readStatePanel(page);
    expect(state.attack).toBe('true');
    await page.screenshot({ path: evidenceFile('e3-attack-visible.png') });

    // Wait slightly longer than the 400ms attack duration.
    await page.waitForTimeout(550);
    state = await readStatePanel(page);
    expect(state.attack).toBe('false');
    await page.screenshot({ path: evidenceFile('e3-attack-hidden.png') });
  });

  // -------------------------------------------------------------------------
  // E4. Idle Overlay
  // -------------------------------------------------------------------------
  test('E4: Idle Overlay — can be toggled on and off', async ({ page }) => {
    let state = await readStatePanel(page);
    expect(state.idle).toBe('true');

    await toggleIdleOverlay(page);
    state = await readStatePanel(page);
    expect(state.idle).toBe('false');
    await page.screenshot({ path: evidenceFile('e4-idle-off.png') });

    await toggleIdleOverlay(page);
    state = await readStatePanel(page);
    expect(state.idle).toBe('true');
    await page.screenshot({ path: evidenceFile('e4-idle-on.png') });

    test.info().annotations.push({
      type: 'visual-note',
      description:
        'Idle overlay blink (alpha 0.5 ↔ 0.15, ~1s period) is rendered only on the canvas. ' +
        'The DOM state panel confirms the overlay is enabled; compare e4-idle-off.png and e4-idle-on.png visually.',
    });
  });

  // -------------------------------------------------------------------------
  // E5. Harvester Fullness
  // -------------------------------------------------------------------------
  test('E5: Harvester Fullness — slider updates fullness state from 0% to 100%', async ({ page }) => {
    await setFullness(page, 0);
    let state = await readStatePanel(page);
    expect(state.fullness).toBe('0');
    expect(state.image).toBe('e1');
    await page.screenshot({ path: evidenceFile('e5-fullness-0.png') });

    await setFullness(page, 50);
    state = await readStatePanel(page);
    expect(state.fullness).toBe('50');
    await page.screenshot({ path: evidenceFile('e5-fullness-50.png') });

    await setFullness(page, 100);
    state = await readStatePanel(page);
    expect(state.fullness).toBe('100');
    await page.screenshot({ path: evidenceFile('e5-fullness-100.png') });

    test.info().annotations.push({
      type: 'visual-note',
      description:
        'Body color gradient (empty green → full gold) is rendered on the canvas. ' +
        'Compare e5-fullness-0.png, e5-fullness-50.png and e5-fullness-100.png visually.',
    });
  });

  // -------------------------------------------------------------------------
  // E6. Display Modes
  // -------------------------------------------------------------------------
  test('E6: Display Modes — all / body-only / overlay-only / exploded', async ({ page }) => {
    // Default "all"
    let state = await readStatePanel(page);
    expect(state.mode).toBe('all');
    await page.screenshot({ path: evidenceFile('e6-mode-all.png') });

    // Body only
    await selectDisplayMode(page, 'body-only');
    state = await readStatePanel(page);
    expect(state.mode).toBe('body-only');
    await page.screenshot({ path: evidenceFile('e6-mode-body-only.png') });

    // Overlay only
    await selectDisplayMode(page, 'overlay-only');
    state = await readStatePanel(page);
    expect(state.mode).toBe('overlay-only');
    await page.screenshot({ path: evidenceFile('e6-mode-overlay-only.png') });

    // Exploded
    await selectDisplayMode(page, 'exploded');
    state = await readStatePanel(page);
    expect(state.mode).toBe('exploded');
    await page.screenshot({ path: evidenceFile('e6-mode-exploded.png') });

    // Restore default for subsequent tests
    await selectDisplayMode(page, 'all');
    state = await readStatePanel(page);
    expect(state.mode).toBe('all');

    test.info().annotations.push({
      type: 'visual-note',
      description:
        'Mode correctness (body-only, overlay-only, exploded offsets) is rendered on the canvas. ' +
        'Compare the four e6-mode-*.png screenshots visually.',
    });
  });

  // -------------------------------------------------------------------------
  // B1. Boundary — disguise Soviet + attack
  // -------------------------------------------------------------------------
  test('B1: Boundary — Soviet disguise then attack keeps red body and shows yellow overlay', async ({ page }) => {
    // Reach Soviet disguise from default: click twice.
    await clickDisguise(page);
    await clickDisguise(page);
    let state = await readStatePanel(page);
    expect(state.disguise).toContain('苏联');
    expect(state.image).toBe('e1-disguised-soviet');

    await clickAttack(page);
    state = await readStatePanel(page);
    expect(state.attack).toBe('true');
    expect(state.disguise).toContain('苏联');
    expect(state.image).toBe('e1-disguised-soviet');
    await page.screenshot({ path: evidenceFile('b1-soviet-attack-visible.png') });

    await page.waitForTimeout(550);
    state = await readStatePanel(page);
    expect(state.attack).toBe('false');
    expect(state.disguise).toContain('苏联');
    await page.screenshot({ path: evidenceFile('b1-soviet-attack-hidden.png') });
  });

  // -------------------------------------------------------------------------
  // B2. Boundary — fullness 100% then Allied disguise
  // -------------------------------------------------------------------------
  test('B2: Boundary — fullness 100% then Allied disguise overrides body color', async ({ page }) => {
    await setFullness(page, 100);
    let state = await readStatePanel(page);
    expect(state.fullness).toBe('100');

    await clickDisguise(page);
    state = await readStatePanel(page);
    expect(state.disguise).toContain('盟军');
    expect(state.image).toBe('e1-disguised-allied');
    expect(state.fullness).toBe('100');
    await page.screenshot({ path: evidenceFile('b2-fullness-100-allied.png') });

    test.info().annotations.push({
      type: 'visual-note',
      description:
        'Disguise color should override the harvester fullness gold tint. ' +
        'Verify in b2-fullness-100-allied.png that the body appears Allied blue rather than gold.',
    });
  });

  // -------------------------------------------------------------------------
  // Reset sanity
  // -------------------------------------------------------------------------
  test('Reset: restores default state after all interactions', async ({ page }) => {
    await clickDisguise(page);
    await setFullness(page, 100);
    await toggleIdleOverlay(page);
    await selectDisplayMode(page, 'exploded');

    await clickReset(page);
    const state = await readStatePanel(page);

    expect(state.disguise).toContain('无伪装');
    expect(state.image).toBe('e1');
    expect(state.attack).toBe('false');
    expect(state.idle).toBe('true');
    expect(state.fullness).toBe('30');
    expect(state.mode).toBe('all');
    await page.screenshot({ path: evidenceFile('reset-restored-default.png') });
  });
});
