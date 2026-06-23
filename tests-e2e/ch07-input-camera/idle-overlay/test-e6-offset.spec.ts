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

test.describe('E6 - Offset Positioning', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__testHarness !== undefined, { timeout: 15000 });
    await pollHarness(page, 'reset');
    await pollHarness(page, 'setActorIdle');
    await page.waitForTimeout(200);
  });

  test('E6.1: Default offset positions overlay correctly relative to body center', async ({ page }) => {
    const offset = await pollHarness(page, 'getOverlayOffset');
    const bodyCenter = await pollHarness(page, 'getBodyCenter');
    const overlayPos = await pollHarness(page, 'getOverlayWorldPosition');

    expect(offset).toHaveProperty('x');
    expect(offset).toHaveProperty('y');
    expect(offset).toHaveProperty('z');

    // WVec→Babylon conversion: X/1024, Z(Y=height)/512, Y(south)/1024
    // bodyCenter = {x:0, y:0.4, z:0}, default offset WVec(0,512,1024)
    // expected overlayPos = {x:0, y:0.4+1024/512=2.4, z:0+512/1024=0.5}
    const expectedX = bodyCenter.x + offset.x / 1024;
    const expectedY = bodyCenter.y + offset.z / 512;   // WVec Z → Babylon Y
    const expectedZ = bodyCenter.z + offset.y / 1024;  // WVec Y → Babylon Z

    expect(overlayPos.x).toBeCloseTo(expectedX, 1);
    expect(overlayPos.y).toBeCloseTo(expectedY, 1);
    expect(overlayPos.z).toBeCloseTo(expectedZ, 1);

    // The overlay should NOT be at body center (confirm offset is applied)
    expect(Math.abs(overlayPos.x - bodyCenter.x) + Math.abs(overlayPos.y - bodyCenter.y) + Math.abs(overlayPos.z - bodyCenter.z)).toBeGreaterThan(0.1);

    await screenshot(page, 'e6-1-default-offset-position.png');
  });

  test('E6.2: Slider X adjustment updates overlay offset in real-time', async ({ page }) => {
    await page.locator('#offset-x').fill('512');
    await page.waitForTimeout(150);

    const offset = await pollHarness(page, 'getOverlayOffset');
    expect(offset.x).toBe(512);

    await screenshot(page, 'e6-2-offset-x-512.png');
  });

  test('E6.3: Slider Y adjustment updates overlay offset in real-time', async ({ page }) => {
    await page.locator('#offset-y').fill('256');
    await page.waitForTimeout(150);

    const offset = await pollHarness(page, 'getOverlayOffset');
    expect(offset.y).toBe(256);

    await screenshot(page, 'e6-3-offset-y-256.png');
  });

  test('E6.4: Slider Z adjustment updates overlay offset in real-time', async ({ page }) => {
    await page.locator('#offset-z').fill('1024');
    await page.waitForTimeout(150);

    const offset = await pollHarness(page, 'getOverlayOffset');
    expect(offset.z).toBe(1024);

    await screenshot(page, 'e6-4-offset-z-1024.png');
  });

  test('E6.5: Combined slider adjustments update overlay world position', async ({ page }) => {
    // Use values that are multiples of step=64 for range inputs
    await page.locator('#offset-x').fill('256');
    await page.locator('#offset-y').fill('320');
    await page.locator('#offset-z').fill('512');
    await page.waitForTimeout(200);

    const offset = await pollHarness(page, 'getOverlayOffset');
    const bodyCenter = await pollHarness(page, 'getBodyCenter');
    const overlayPos = await pollHarness(page, 'getOverlayWorldPosition');

    expect(offset.x).toBe(256);
    expect(offset.y).toBe(320);
    expect(offset.z).toBe(512);

    // Apply WVec→Babylon conversion
    const expectedX = bodyCenter.x + offset.x / 1024;
    const expectedY = bodyCenter.y + offset.z / 512;
    const expectedZ = bodyCenter.z + offset.y / 1024;

    expect(overlayPos.x).toBeCloseTo(expectedX, 1);
    expect(overlayPos.y).toBeCloseTo(expectedY, 1);
    expect(overlayPos.z).toBeCloseTo(expectedZ, 1);

    await screenshot(page, 'e6-5-offset-combined-300-400-500.png');
  });
});
