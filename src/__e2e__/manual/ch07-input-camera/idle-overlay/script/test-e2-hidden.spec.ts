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

test.describe('E2 - Pause Phase Overlay Hidden', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await page.waitForTimeout(200);
  });

  test('E2.1: IDLE + Pause phase → overlay visibility false', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    // Force pause and check visibility in a single synchronous JS execution
    // (click handler sets phase='pause' synchronously, evaluate captures state before RAF runs)
    await page.evaluate(() => {
      const h = (window as any).__testHarness;
      // Click the force-pause button programmatically
      (document.getElementById('btn-force-pause') as HTMLButtonElement)?.click();
      // Return the state immediately (before next render frame)
      return null;
    });

    // Check visibility - phase should still be 'pause' (no ticks processed yet)
    const result = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return {
        phase: h.getCurrentPhase(),
        visible: h.getOverlayVisibility(),
        overlayIsVisible: h.overlayGroup.isVisible,
      };
    });

    // At this point, one RAF may have fired, but elapsed is at most 1 tick
    // With default config, pause lasts 30 ticks, so phase should still be 'pause'
    expect(result.phase).toBe('pause');
    expect(result.visible).toBe(false);
    expect(result.overlayIsVisible).toBe(false);

    await screenshot(page, 'e2-1-idle-pause-overlay-hidden.png');
  });

  test('E2.2: Offset line also hidden', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setCycleDurations', 10, 40);
    await page.waitForTimeout(600);

    const lineHiddenHandle = await page.waitForFunction(() => {
      const harness = (window as any).__testHarness;
      const line = harness?.scene?.getMeshByName?.('offsetLine');
      if (!line) return true;
      return line.isVisible === false || line.visibility === 0;
    }, { timeout: 5000 });
    expect(await lineHiddenHandle.jsonValue()).toBe(true);

    await screenshot(page, 'e2-2-offset-line-hidden.png');
  });

  test('E2.3: DOM #overlay-vis-badge shows HIDDEN with class status-hidden', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setCycleDurations', 10, 40);
    await page.waitForTimeout(600);

    const badge = page.locator('#overlay-vis-badge');
    await expect(badge).toHaveText('HIDDEN');
    await expect(badge).toHaveClass(/status-hidden/);

    await screenshot(page, 'e2-3-overlay-badge-hidden.png');
  });
});
