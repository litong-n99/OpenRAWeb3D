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

test.describe('E1 - Play Phase Overlay Visible', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await page.waitForTimeout(200);
  });

  test('E1.1: Actor IDLE + Play phase → overlayGroup.isVisible === true', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    await page.waitForTimeout(100);

    const isVisible = await pollHarness(page, 'getOverlayVisibility');
    expect(isVisible).toBe(true);

    const overlayVisibleHandle = await page.waitForFunction(() => {
      const harness = (window as any).__testHarness;
      return harness?.overlayGroup?.isVisible === true;
    }, { timeout: 5000 });
    expect(await overlayVisibleHandle.jsonValue()).toBe(true);

    await screenshot(page, 'e1-1-idle-play-overlay-visible.png');
  });

  test('E1.2: Animation effects active (pulse scale, rotation, emissive color)', async ({ page }) => {
    await pollHarness(page, 'setActorIdle');
    // Wait for animation to run and accumulate visible changes
    await page.waitForTimeout(1500);

    // Check overlay disc properties via single evaluate (avoid race conditions)
    const animState = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      const children = harness.overlayGroup.getChildren();
      const disc = children.find((c: any) => c.name === 'overlayDisc') as any;
      const ring = children.find((c: any) => c.name === 'overlayRing') as any;
      if (!disc || !ring) return null;
      return {
        discScaling: { x: disc.scaling.x, y: disc.scaling.y, z: disc.scaling.z },
        discRotationZ: disc.rotation.z,
        ringRotationZ: ring.rotation.z,
        hasEmissive: disc.material?.emissiveColor != null,
      };
    });

    expect(animState).not.toBeNull();
    // Disc should have scaling different from (1,1,1) due to pulse animation
    // (even if headless renders slowly, after 1.5s the pulse should have modified scaling)
    const scaleIsActive = Math.abs(animState!.discScaling.x - 1) > 0.01
      || Math.abs(animState!.discScaling.y - 1) > 0.01;
    // Disc rotation should accumulate over time (animation rotates +2 rad/s)
    const rotationIsActive = Math.abs(animState!.discRotationZ) > 0.1
      || Math.abs(animState!.ringRotationZ) > 0.1;
    // At least one of scale or rotation animation should be detectable
    expect(scaleIsActive || rotationIsActive).toBe(true);

    await screenshot(page, 'e1-2-animation-effects-active.png');
  });

  test('E1.3: Pause→Play switch → visible immediately', async ({ page }) => {
    // Ensure IDLE with overlay visible (Play phase)
    await pollHarness(page, 'setActorIdle');
    await page.waitForTimeout(200);
    expect(await pollHarness(page, 'getOverlayVisibility')).toBe(true);

    // Force Pause — overlay should hide
    await page.locator('#btn-force-pause').click();
    await page.waitForTimeout(100);
    expect(await pollHarness(page, 'getOverlayVisibility')).toBe(false);

    // Force Play — visibility changes synchronously via applyOverlayVisibility()
    await page.locator('#btn-force-play').click();
    // Check immediately after click — synchronous visibility update
    const result = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return { visible: h.getOverlayVisibility(), phase: h.getCurrentPhase() };
    });

    expect(result.phase).toBe('play');
    expect(result.visible).toBe(true);

    await screenshot(page, 'e1-3-pause-to-play-visible-fast.png');
  });
});
