import { test, expect } from '@playwright/test';
import path from 'node:path';

const BASE_URL = 'http://localhost:5173/test/ch07-input-camera/idle-overlay/';
const EVIDENCE_DIR = path.resolve('e:/OpenRAWeb3D/test-results/manual/ch07-input-camera/idle-overlay/evidence');

const screenshot = async (page: any, name: string) => {
  await page.screenshot({ path: path.resolve(EVIDENCE_DIR, name), fullPage: false });
};

const pollHarness = async (page: any, fnName: string, ...args: any[]) => {
  const handle = await page.waitForFunction(
    (obj: { fnName: string; fnArgs: any[] }) => {
      const harness = (window as any).__testHarness;
      if (!harness) return false;
      const targetFn = (harness as any)[obj.fnName];
      if (typeof targetFn !== 'function') return false;
      const result = targetFn.apply(harness, obj.fnArgs);
      return { _r: result, _done: true };
    },
    { fnName, fnArgs: args },
    { timeout: 10000 }
  );
  const value = await handle.jsonValue();
  return (value as any)._r;
};

test.describe.configure({ mode: 'serial' });

test.describe('E5 - BUSY State Overlay Stops', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await page.waitForTimeout(200);
  });

  test('E5.1: IDLE→BUSY hides overlay ≤2 ticks', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    // Force play to guarantee overlay is visible before test
    await page.locator('#btn-force-play').click();
    await page.waitForTimeout(100);

    const beforeVisible = await pollHarness(page, 'getOverlayVisibility');
    expect(beforeVisible).toBe(true);

    await pollHarness(page, 'setActorBusy');
    await page.waitForTimeout(120);

    const latency = await pollHarness(page, 'getOverlayHideLatency');
    expect(latency).not.toBeNull();
    expect(latency).toBeLessThanOrEqual(2);

    const afterVisible = await pollHarness(page, 'getOverlayVisibility');
    expect(afterVisible).toBe(false);

    await screenshot(page, 'e5-1-idle-to-busy-hide-latency.png');
  });

  test('E5.2: BUSY keeps overlay hidden through multiple cycles', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setSimSpeed', 4.0);
    await pollHarness(page, 'setCycleDurations', 20, 20);
    await page.waitForTimeout(200);
    await pollHarness(page, 'setActorBusy');
    await page.waitForTimeout(500);

    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(500);
      const visible = await pollHarness(page, 'getOverlayVisibility');
      expect(visible).toBe(false);
      const idle = await pollHarness(page, 'isActorIdle');
      expect(idle).toBe(false);
    }

    await screenshot(page, 'e5-2-busy-hidden-multiple-cycles.png');
  });

  test('E5.3: BUSY→IDLE restores overlay to current phase', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setSimSpeed', 4.0);
    await pollHarness(page, 'setCycleDurations', 20, 20);
    await page.waitForTimeout(200);
    await pollHarness(page, 'setActorBusy');
    await page.waitForTimeout(300);

    await pollHarness(page, 'setActorIdle');
    await page.waitForTimeout(200);

    // Combine phase + visibility check atomically to avoid race condition
    const result = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return { phase: h.getCurrentPhase(), visible: h.getOverlayVisibility() };
    });

    if (result.phase === 'play') {
      expect(result.visible).toBe(true);
    } else {
      // If phase is pause, visibility should be false
      expect(result.visible).toBe(false);
    }

    await screenshot(page, 'e5-3-busy-to-idle-restores.png');
  });

  test('E5.4: Actor state badge shows red BUSY with class status-busy', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setActorBusy');
    await page.waitForTimeout(200);

    const badge = page.locator('#actor-state-badge');
    await expect(badge).toHaveText('BUSY');
    await expect(badge).toHaveClass(/status-busy/);

    // .status-busy background is #b71c1c = rgb(183, 28, 28)
    const color = await badge.evaluate((el: any) => getComputedStyle(el).backgroundColor);
    expect(color).toContain('183'); // R channel of #b71c1c

    await screenshot(page, 'e5-4-actor-busy-badge.png');
  });
});
