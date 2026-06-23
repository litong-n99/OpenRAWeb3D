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

test.describe('Boundary Tests - Idle Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await page.waitForTimeout(200);
  });

  test('Rapid IDLE→BUSY toggling 10 times, final state correct', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await pollHarness(page, 'setActorBusy');
      await page.waitForTimeout(50);
      await pollHarness(page, 'setActorIdle');
      await page.waitForTimeout(50);
    }

    const idle = await pollHarness(page, 'isActorIdle');
    expect(idle).toBe(true);

    const phase = await pollHarness(page, 'getCurrentPhase');
    const visible = await pollHarness(page, 'getOverlayVisibility');
    if (phase === 'play') {
      expect(visible).toBe(true);
    } else {
      expect(visible).toBe(false);
    }

    await screenshot(page, 'boundary-rapid-toggle-final-idle.png');
  });

  test('Extreme offset values (max: 2048/2048/4096)', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setOverlayOffset', 2048, 2048, 4096);
    await page.waitForTimeout(200);

    const offset = await pollHarness(page, 'getOverlayOffset');
    expect(offset.x).toBe(2048);
    expect(offset.y).toBe(2048);
    expect(offset.z).toBe(4096);

    await screenshot(page, 'boundary-extreme-positive-offset.png');
  });

  test('Negative offset values (-1024, -512)', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setOverlayOffset', -1024, -1024, -512);
    await page.waitForTimeout(200);

    const offset = await pollHarness(page, 'getOverlayOffset');
    expect(offset.x).toBe(-1024);
    expect(offset.y).toBe(-1024);
    expect(offset.z).toBe(-512);

    const bodyCenter = await pollHarness(page, 'getBodyCenter');
    const overlayPos = await pollHarness(page, 'getOverlayWorldPosition');

    // WVec→Babylon: X/1024, Z(offset.z=height)/512→BabylonY, Y(offset.y=south)/1024→BabylonZ
    const expectedX = bodyCenter.x + offset.x / 1024;
    const expectedY = bodyCenter.y + offset.z / 512;
    const expectedZ = bodyCenter.z + offset.y / 1024;

    expect(overlayPos.x).toBeCloseTo(expectedX, 1);
    expect(overlayPos.y).toBeCloseTo(expectedY, 1);
    expect(overlayPos.z).toBeCloseTo(expectedZ, 1);

    await screenshot(page, 'boundary-negative-offset.png');
  });

  test('Speed extreme 0.25x: cycle still completes (slow)', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setSimSpeed', 0.25);
    await pollHarness(page, 'setCycleDurations', 40, 20);
    // Force play for clean start
    await page.locator('#btn-force-play').click();
    await page.waitForTimeout(100);

    // At 0.25x speed, waiting for phase switch takes longer - wait patiently
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'pause', { timeout: 20000 });

    // Phase completed - verify cycles work even at slow speed
    const phase = await pollHarness(page, 'getCurrentPhase');
    expect(phase).toBe('pause');

    await screenshot(page, 'boundary-speed-0-25x.png');
  });

  test('Speed extreme 4.0x: cycle still completes (fast)', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setSimSpeed', 4.0);
    await pollHarness(page, 'setCycleDurations', 40, 20);
    // Force play for clean start
    await page.locator('#btn-force-play').click();
    await page.waitForTimeout(50);

    // Wait for phase to switch (very fast at 4x)
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'pause', { timeout: 3000 });

    const phase = await pollHarness(page, 'getCurrentPhase');
    expect(phase).toBe('pause');

    await screenshot(page, 'boundary-speed-4-0x.png');
  });

  test('Very short cycle: Play=10, Pause=5 ticks', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await pollHarness(page, 'setSimSpeed', 4.0);
    await pollHarness(page, 'setCycleDurations', 10, 5);
    // Force play for clean measurement
    await page.locator('#btn-force-play').click();
    await page.waitForTimeout(50);

    // Wait for at least 2 full cycles to verify short cycles work
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'pause', { timeout: 2000 });
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'play', { timeout: 2000 });
    await page.waitForFunction(() => (window as any).__testHarness?.getCurrentPhase() === 'pause', { timeout: 2000 });

    // Atomic check - phase and visibility together to avoid race with fast cycles
    const state = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return {
        phase: h.getCurrentPhase(),
        visible: h.getOverlayVisibility(),
        cfg: h.getCycleConfig(),
      };
    });

    expect(state.cfg.playTicks).toBe(10);
    expect(state.cfg.pauseTicks).toBe(5);

    // If phase is pause, overlay MUST be hidden
    if (state.phase === 'pause') {
      expect(state.visible).toBe(false);
    }
    // If phase is play, that's OK (fast cycle may have switched)

    await screenshot(page, 'boundary-short-cycle.png');
  });

  test('Window resize from 1920x1080 to 1280x720', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await page.waitForTimeout(300);

    const visibleBefore = await pollHarness(page, 'getOverlayVisibility');
    expect(visibleBefore).toBe(true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    const visibleAfter = await pollHarness(page, 'getOverlayVisibility');
    expect(visibleAfter).toBe(true);

    await screenshot(page, 'boundary-resize-1280x720.png');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
  });

  test('Keyboard shortcuts: I=IDLE, B=BUSY, P=Play, A=Pause, R=Reset', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    let idle = await pollHarness(page, 'isActorIdle');
    expect(idle).toBe(false);

    await page.keyboard.press('i');
    await page.waitForTimeout(200);
    idle = await pollHarness(page, 'isActorIdle');
    expect(idle).toBe(true);

    await page.keyboard.press('a');
    await page.waitForTimeout(200);
    let phase = await pollHarness(page, 'getCurrentPhase');
    expect(phase).toBe('pause');

    await page.keyboard.press('p');
    await page.waitForTimeout(200);
    phase = await pollHarness(page, 'getCurrentPhase');
    expect(phase).toBe('play');

    await page.keyboard.press('r');
    await page.waitForTimeout(200);
    // Reset restores actorIdle, phase='play', overlay visible
    const state = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return {
        idle: h.isActorIdle(),
        phase: h.getCurrentPhase(),
        visible: h.getOverlayVisibility(),
      };
    });
    expect(state.idle).toBe(true);
    expect(state.phase).toBe('play');
    expect(state.visible).toBe(true);

    await screenshot(page, 'boundary-keyboard-shortcuts.png');
  });
});
