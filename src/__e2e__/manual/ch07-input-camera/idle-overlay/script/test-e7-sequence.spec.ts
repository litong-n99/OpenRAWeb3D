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

test.describe('E7 - Sequence Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await page.waitForTimeout(200);
  });

  test('E7.1: getOverlaySequence() always returns "idle-overlay" in all states', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    const seqIdle = await pollHarness(page, 'getOverlaySequence');
    expect(seqIdle).toBe('idle-overlay');

    await pollHarness(page, 'setActorBusy');
    const seqBusy = await pollHarness(page, 'getOverlaySequence');
    expect(seqBusy).toBe('idle-overlay');

    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setCycleDurations', 10, 40);
    await page.waitForTimeout(600);
    const seqPause = await pollHarness(page, 'getOverlaySequence');
    expect(seqPause).toBe('idle-overlay');

    await screenshot(page, 'e7-1-sequence-idle-overlay-all-states.png');
  });

  test('E7.2: DOM #stat-sequence displays "idle-overlay"', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    const seqLocator = page.locator('#stat-sequence');
    await expect(seqLocator).toContainText('idle-overlay');

    await pollHarness(page, 'setActorBusy');
    await expect(seqLocator).toContainText('idle-overlay');

    await screenshot(page, 'e7-2-dom-sequence-idle-overlay.png');
  });
});
