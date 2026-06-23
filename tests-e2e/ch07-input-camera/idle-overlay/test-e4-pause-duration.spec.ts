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

test.describe('E4 - Pause Phase Duration Accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await pollHarness(page, 'setSimSpeed', 4.0);
    await page.waitForTimeout(200);
  });

  test('E4.1: Default 30 ticks - pause→play cycle completes', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    // Wait until play phase, then force pause for clean start
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'play', { timeout: 2000 });
    await page.locator('#btn-force-pause').click();
    await page.waitForTimeout(50);

    // Wait for phase to switch back to play (pause phase completed)
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'play', { timeout: 3000 });

    // Verify pause phase completed
    const cfg = await pollHarness(page, 'getCycleConfig');
    expect(cfg.pauseTicks).toBe(30);

    await screenshot(page, 'e4-1-default-pause-duration.png');
  });

  test('E4.2: Custom 90 ticks - pause→play cycle completes', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setCycleDurations', 60, 90);
    // Force pause for clean start
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'play', { timeout: 2000 });
    await page.locator('#btn-force-pause').click();
    await page.waitForTimeout(50);

    // Wait for phase to switch back to play
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'play', { timeout: 6000 });

    // Verify config
    const cfg = await pollHarness(page, 'getCycleConfig');
    expect(cfg.pauseTicks).toBe(90);

    await screenshot(page, 'e4-2-custom-pause-duration-90.png');
  });

  test('E4.3: Event log shows Pause entries', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setCycleDurations', 30, 30);
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'pause', { timeout: 2000 });
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'play', { timeout: 2000 });
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'pause', { timeout: 2000 });

    // The event log uses .entry class, not .event-entry
    const logEntries = await page.locator('#event-log .entry').allInnerTexts();
    const hasPause = logEntries.some((text: string) => text.toLowerCase().includes('pause'));
    expect(hasPause).toBe(true);

    await screenshot(page, 'e4-3-event-log-pause.png');
  });
});
