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
  return parseInt(text || '0', 10);
}

async function getStatTotal(page: any): Promise<number> {
  const text = await page.locator('#stat-total').textContent();
  return parseInt(text || '0', 10);
}

async function getFps(page: any): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseInt(text || '0', 10);
}

async function getScaleButtonText(page: any): Promise<string> {
  const text = await page.locator('#btn-scale').textContent();
  return text || '';
}

async function expectNoGpuError(page: any): Promise<void> {
  const gpuError = page.locator('#gpu-error');
  await expect(gpuError).toHaveCSS('display', 'none');
}

test.use({ snapshotDir: SNAPSHOT_DIR });

test.describe('Ch03 Actor System - Actor Scene Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForSelector('#info-engine', { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return (
        el &&
        el.textContent?.includes('Babylon.js') === true &&
        el.textContent?.includes('WebGL') === true
      );
    }, { timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  test('test-1: page load shows at least 8 actors and no GPU error', async ({ page }) => {
    await expectNoGpuError(page);

    const count = await getStatCount(page);
    const total = await getStatTotal(page);

    expect(count, 'active actor count should be >= 8').toBeGreaterThanOrEqual(8);
    expect(total, 'total created count should be >= 8').toBeGreaterThanOrEqual(8);

    await page.screenshot({ path: evidenceFile('test-1-page-load.png') });
  });

  test('test-2: spawn, move and dispose operations update stats', async ({ page }) => {
    await expectNoGpuError(page);

    // Click "Spawn 5" three times.
    for (let i = 0; i < 3; i++) {
      await page.click('#btn-spawn');
      await page.waitForTimeout(200);
    }

    let count = await getStatCount(page);
    expect(count, 'after 3 spawns active count should be 15').toBe(15);
    await page.screenshot({ path: evidenceFile('test-2a-after-spawn-15.png') });

    // Click "Move Random" - should not crash and count stays the same.
    await page.click('#btn-move-random');
    await page.waitForTimeout(300);

    count = await getStatCount(page);
    expect(count, 'after move random count should still be 15').toBe(15);
    await expectNoGpuError(page);
    await page.screenshot({ path: evidenceFile('test-2b-after-move-random.png') });

    // Click "Trash All" - active count becomes 0, total created remains.
    await page.click('#btn-dispose-all');
    await page.waitForTimeout(300);

    count = await getStatCount(page);
    const total = await getStatTotal(page);
    expect(count, 'after trash all active count should be 0').toBe(0);
    expect(total, 'total created count should remain > 0').toBeGreaterThan(0);
    await page.screenshot({ path: evidenceFile('test-2c-after-trash-all.png') });
  });

  test('test-3: rotation animation can be paused and resumed', async ({ page }) => {
    await expectNoGpuError(page);

    const chkAnimate = page.locator('#chk-animate');
    await expect(chkAnimate).toBeChecked();

    // Capture visual evidence while animation is running.
    await page.screenshot({ path: evidenceFile('test-3a-animation-on.png') });
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidenceFile('test-3b-animation-on-later.png') });

    // Uncheck animation.
    await chkAnimate.uncheck();
    await page.waitForTimeout(200);
    await expect(chkAnimate).not.toBeChecked();
    await page.screenshot({ path: evidenceFile('test-3c-animation-paused.png') });
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidenceFile('test-3d-animation-paused-later.png') });

    // Re-check animation.
    await chkAnimate.check();
    await page.waitForTimeout(200);
    await expect(chkAnimate).toBeChecked();
    await page.screenshot({ path: evidenceFile('test-3e-animation-resumed.png') });
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidenceFile('test-3f-animation-resumed-later.png') });

    test.info().annotations.push({
      type: 'visual-note',
      description:
        'Rotation animation state is rendered only on the Babylon.js canvas. ' +
        'Compare screenshots test-3a/b (on), test-3c/d (paused), and test-3e/f (resumed) ' +
        'to visually verify actors stop and resume rotating.',
    });
  });

  test('test-4: cycle scale button text cycles through presets', async ({ page }) => {
    await expectNoGpuError(page);

    const expectedCycle = ['(0.5x)', '(1x)', '(2x)', '(3x)', '(0.5x)'];

    for (let i = 0; i < expectedCycle.length; i++) {
      await page.click('#btn-scale');
      await page.waitForTimeout(150);

      const text = await getScaleButtonText(page);
      expect(
        text,
        `scale button text after click ${i + 1} should include ${expectedCycle[i]}`,
      ).toContain(expectedCycle[i]);

      await page.screenshot({ path: evidenceFile(`test-4a-scale-click-${i + 1}.png`) });
    }
  });

  test('test-5: toggle owner button is clickable and does not crash', async ({ page }) => {
    await expectNoGpuError(page);

    const btnOwner = page.locator('#btn-owner-toggle');
    await expect(btnOwner).toBeVisible();
    await expect(btnOwner).toBeEnabled();

    for (let i = 0; i < 3; i++) {
      await btnOwner.click();
      await page.waitForTimeout(200);
    }

    const count = await getStatCount(page);
    expect(count, 'actor count should remain stable after owner toggles').toBeGreaterThanOrEqual(8);
    await expectNoGpuError(page);

    await page.screenshot({ path: evidenceFile('test-5-after-owner-toggle.png') });
  });

  test('test-6: FPS stability with 50+ actors', async ({ page }) => {
    await expectNoGpuError(page);

    // Spawn repeatedly until we have at least 50 active actors.
    // Initial count is 8, each click adds 5.
    let clicks = 0;
    while ((await getStatCount(page)) < 50 && clicks < 20) {
      await page.click('#btn-spawn');
      await page.waitForTimeout(150);
      clicks++;
    }

    const count = await getStatCount(page);
    expect(count, 'should have at least 50 active actors').toBeGreaterThanOrEqual(50);
    await page.screenshot({ path: evidenceFile('test-6a-50-actors.png') });

    // Allow FPS reading to stabilize.
    await page.waitForTimeout(3000);

    const fps = await getFps(page);
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `FPS=${fps}, headless=${headless}, actors=${count}. ` +
        'FPS readings in headless mode can be unreliable due to software rendering; ' +
        'manual verification is recommended.',
    });

    if (headless) {
      expect(fps, `FPS ${fps} should be >= 45 in headless mode`).toBeGreaterThanOrEqual(45);
    } else {
      expect(fps, `FPS ${fps} should be >= 55 in headed mode`).toBeGreaterThanOrEqual(55);
    }

    await page.screenshot({ path: evidenceFile('test-6b-fps-reading.png') });
  });

  test('test-7: edge case - rapid spawn, trash and respawn', async ({ page }) => {
    await expectNoGpuError(page);

    // Rapid-fire spawn clicks without waiting between them.
    for (let i = 0; i < 10; i++) {
      await page.click('#btn-spawn');
    }
    await page.waitForTimeout(500);

    let count = await getStatCount(page);
    expect(count, 'after rapid spawns active count should be 58').toBe(58);
    await page.screenshot({ path: evidenceFile('test-7a-after-rapid-spawn.png') });

    // Trash all then immediately respawn.
    await page.click('#btn-dispose-all');
    await page.waitForTimeout(300);

    count = await getStatCount(page);
    expect(count, 'after trash all active count should be 0').toBe(0);
    await page.screenshot({ path: evidenceFile('test-7b-after-rapid-trash.png') });

    await page.click('#btn-spawn');
    await page.click('#btn-spawn');
    await page.waitForTimeout(300);

    count = await getStatCount(page);
    const total = await getStatTotal(page);
    expect(count, 'after respawn active count should be 10').toBe(10);
    expect(total, 'total created should accumulate across respawns').toBeGreaterThan(58);
    await expectNoGpuError(page);

    await page.screenshot({ path: evidenceFile('test-7c-after-respawn.png') });
  });
});
