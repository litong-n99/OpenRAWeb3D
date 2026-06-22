import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch03-actor-system/actor-scene-rendering/';
const SNAPSHOT_DIR = 'test-results/manual/ch03-actor-system/actor-scene-rendering';
const EVIDENCE_DIR = `${SNAPSHOT_DIR}/evidence`;

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

async function getStatCount(page: any): Promise<number> {
  const text = await page.locator('#stat-count').textContent();
  return parseInt((text || '0').trim(), 10);
}

async function getStatTotal(page: any): Promise<number> {
  const text = await page.locator('#stat-total').textContent();
  return parseInt((text || '0').trim(), 10);
}

async function getDisplayedFPS(page: any): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseInt((text || '0').trim(), 10);
}

async function waitForNumericFPS(page: any, timeout = 5000): Promise<void> {
  await page.waitForFunction(() => {
    const text = document.getElementById('info-fps')?.textContent;
    return text !== null && text !== undefined && /^\d+$/.test(text.trim());
  }, { timeout });
}

async function getScaleButtonText(page: any): Promise<string> {
  const text = await page.locator('#btn-scale').textContent();
  return (text || '').trim();
}

test.use({ snapshotDir: SNAPSHOT_DIR });

test.describe('Ch03 Actor System - Actor Scene Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);

    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForSelector('#info-engine', { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      const text = el?.textContent || '';
      return text.includes('Babylon.js') && text.includes('WebGL');
    }, { timeout: 10000 });

    const gpuError = page.locator('#gpu-error');
    await expect(gpuError).toHaveCSS('display', 'none');

    // Allow the initial 8 actors and the FPS counter to stabilise.
    await page.waitForTimeout(1000);
  });

  test('test-1: at least 8 actors visible after load', async ({ page }) => {
    const count = await getStatCount(page);
    const total = await getStatTotal(page);

    expect(count, 'active actor count should be >= 8 after load').toBeGreaterThanOrEqual(8);
    expect(total, 'total created count should be >= 8 after load').toBeGreaterThanOrEqual(8);

    const gpuError = page.locator('#gpu-error');
    await expect(gpuError).toHaveCSS('display', 'none');

    await page.screenshot({ path: evidenceFile('test-1-load.png') });
  });

  test('test-2: spawn, move and dispose operations update counts correctly', async ({ page }) => {
    // Start from a clean slate so three "Spawn 5" clicks give an active count of 15.
    await page.click('#btn-dispose-all');
    await page.waitForTimeout(200);
    expect(await getStatCount(page), 'count should be 0 after trash').toBe(0);
    const initialTotal = await getStatTotal(page);

    for (let i = 0; i < 3; i++) {
      await page.click('#btn-spawn');
      await page.waitForTimeout(200);
    }

    expect(await getStatCount(page), 'count should be 15 after 3 spawns').toBe(15);
    expect(await getStatTotal(page), 'total should accumulate after spawns').toBe(initialTotal + 15);

    await page.screenshot({ path: evidenceFile('test-2a-after-spawn.png') });

    await page.click('#btn-move-random');
    await page.waitForTimeout(300);
    expect(await getStatCount(page), 'count should remain 15 after move').toBe(15);

    await page.screenshot({ path: evidenceFile('test-2b-after-move.png') });

    await page.click('#btn-dispose-all');
    await page.waitForTimeout(300);
    expect(await getStatCount(page), 'count should be 0 after trash').toBe(0);
    expect(await getStatTotal(page), 'total should be > 0 after trash').toBeGreaterThan(0);

    await page.screenshot({ path: evidenceFile('test-2c-after-trash.png') });
  });

  test('test-3: rotation animation can be paused and resumed', async ({ page }) => {
    const chk = page.locator('#chk-animate');
    await expect(chk).toBeChecked();

    const canvas = page.locator('#sandbox canvas');

    // While checked, two canvas screenshots taken a moment apart should differ.
    const moving1 = await canvas.screenshot();
    await page.waitForTimeout(300);
    const moving2 = await canvas.screenshot();
    expect(
      !moving1.equals(moving2),
      'canvas should change while rotation animation is enabled'
    ).toBe(true);

    // Uncheck the animation checkbox.
    await chk.uncheck();
    await page.waitForTimeout(300);
    await expect(chk).not.toBeChecked();

    // While unchecked, successive canvas screenshots should be identical.
    const still1 = await canvas.screenshot();
    await page.waitForTimeout(300);
    const still2 = await canvas.screenshot();
    expect(
      still1.equals(still2),
      'canvas should stay still after disabling rotation animation'
    ).toBe(true);

    // Re-enable animation.
    await chk.check();
    await page.waitForTimeout(300);
    await expect(chk).toBeChecked();

    const resumed1 = await canvas.screenshot();
    await page.waitForTimeout(300);
    const resumed2 = await canvas.screenshot();
    expect(
      !resumed1.equals(resumed2),
      'canvas should change again after re-enabling rotation animation'
    ).toBe(true);

    await page.screenshot({ path: evidenceFile('test-3-animation-toggle.png') });
  });

  test('test-4: cycle scale button text cycles through presets', async ({ page }) => {
    const expectedLabels = [
      'Cycle Scale (0.5x)',
      'Cycle Scale (1x)',
      'Cycle Scale (2x)',
      'Cycle Scale (3x)',
    ];

    const countBefore = await getStatCount(page);

    for (const label of expectedLabels) {
      await page.click('#btn-scale');
      await page.waitForTimeout(150);
      expect(await getScaleButtonText(page), `button should read "${label}"`).toBe(label);
    }

    // One more click should loop back to the first preset.
    await page.click('#btn-scale');
    await page.waitForTimeout(150);
    expect(await getScaleButtonText(page), 'scale button should loop back to 0.5x').toBe(
      expectedLabels[0]
    );

    expect(await getStatCount(page), 'actor count should not change during scaling').toBe(
      countBefore
    );

    await page.screenshot({ path: evidenceFile('test-4-scale-cycle.png') });
  });

  test('test-5: toggle owner button is clickable and does not crash', async ({ page }) => {
    const btn = page.locator('#btn-owner-toggle');
    await expect(btn).toBeVisible();

    const countBefore = await getStatCount(page);

    for (let i = 0; i < 3; i++) {
      await btn.click();
      await page.waitForTimeout(150);
    }

    expect(await getStatCount(page), 'actor count should not change after owner toggles').toBe(
      countBefore
    );

    const gpuError = page.locator('#gpu-error');
    await expect(gpuError).toHaveCSS('display', 'none');

    test.info().annotations.push({
      type: 'visual-note',
      description:
        'Owner color changes are rendered on the Babylon.js canvas; verify Neutral -> PlayerA -> PlayerB cycling via screenshot/evidence.',
    });

    await page.screenshot({ path: evidenceFile('test-5-owner-toggle.png') });
  });

  test('test-6: FPS remains stable with 50+ actors', async ({ page }) => {
    const headless = await isHeadless(page);

    // Build up to at least 50 active actors.
    let clicks = 0;
    while ((await getStatCount(page)) < 50 && clicks < 20) {
      await page.click('#btn-spawn');
      await page.waitForTimeout(100);
      clicks++;
    }

    const count = await getStatCount(page);
    expect(count, 'actor count should be >= 50').toBeGreaterThanOrEqual(50);

    // Wait for the FPS counter to refresh a few times.
    await page.waitForTimeout(1500);
    await waitForNumericFPS(page);

    const fps = await getDisplayedFPS(page);
    expect(fps, 'FPS should be a positive integer').toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'fps-note',
      description: `FPS=${fps}, headless=${headless}, actors=${count}. ` +
        'FPS readings in headless mode can be unreliable due to software rendering and throttling.',
    });

    if (headless) {
      expect(fps, `FPS ${fps} should be >= 45 in headless mode`).toBeGreaterThanOrEqual(45);
    } else {
      expect(fps, `FPS ${fps} should be >= 55 in headed mode`).toBeGreaterThanOrEqual(55);
    }

    await page.screenshot({ path: evidenceFile('test-6-fps-50-actors.png') });
  });

  test('test-7: rapid consecutive operations do not corrupt state', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.click('#btn-spawn');
      await page.click('#btn-move-random');
      await page.click('#btn-scale');
    }

    await page.waitForTimeout(500);

    // Initial 8 actors + 5 batches of 5 = 33.
    expect(await getStatCount(page), 'actor count should be 33 after rapid operations').toBe(33);
    expect(await getStatTotal(page), 'total created should be >= 33').toBeGreaterThanOrEqual(33);

    const scaleText = await getScaleButtonText(page);
    expect(scaleText, 'scale button should show a valid preset').toMatch(
      /^Cycle Scale \((0\.5|1|2|3)x\)$/
    );

    const gpuError = page.locator('#gpu-error');
    await expect(gpuError).toHaveCSS('display', 'none');

    await page.screenshot({ path: evidenceFile('test-7-rapid-operations.png') });
  });

  test('test-8: trash all then respawn restores the scene', async ({ page }) => {
    await page.click('#btn-dispose-all');
    await page.waitForTimeout(300);

    expect(await getStatCount(page), 'count should be 0 after trash').toBe(0);
    const totalBefore = await getStatTotal(page);
    expect(totalBefore, 'total created should still be tracked after trash').toBeGreaterThan(0);

    await page.screenshot({ path: evidenceFile('test-8a-after-trash.png') });

    await page.click('#btn-spawn');
    await page.waitForTimeout(300);

    expect(await getStatCount(page), 'count should be 5 after respawn').toBe(5);
    expect(await getStatTotal(page), 'total created should increase after respawn').toBeGreaterThan(
      totalBefore
    );

    await page.screenshot({ path: evidenceFile('test-8b-after-respawn.png') });
  });
});
