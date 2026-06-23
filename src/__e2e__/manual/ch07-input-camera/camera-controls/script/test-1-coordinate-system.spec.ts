import { test, expect, type Page } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/camera-controls/';

async function waitForHarness(page: Page) {
  await page.goto(PAGE_URL);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => (window as any).__cameraTestHarness?.scene?.isReady());
  await page.waitForTimeout(500);
}

test.describe('E1 - Coordinate System Orientation', () => {
  test.beforeEach(async ({ page }) => {
    await waitForHarness(page);
  });

  test('E1.1 +X_Right marker is to the right of origin on screen', async ({ page }) => {
    const markers = await page.evaluate(() => (window as any).__cameraTestHarness.getMarkerPositions());
    const origin = markers.find((m: any) => m.label === 'Origin');
    const xRight = markers.find((m: any) => m.label === '+X_Right');

    expect(origin, 'Origin marker should exist').toBeDefined();
    expect(xRight, '+X_Right marker should exist').toBeDefined();

    const dx = xRight!.screenPos.x - origin!.screenPos.x;
    expect(dx, `+X_Right should be right of origin (dx=${dx})`).toBeGreaterThan(20);
  });

  test('E1.2 +Z_South marker is above origin on screen', async ({ page }) => {
    const markers = await page.evaluate(() => (window as any).__cameraTestHarness.getMarkerPositions());
    const origin = markers.find((m: any) => m.label === 'Origin');
    const zSouth = markers.find((m: any) => m.label === '+Z_South');

    expect(origin, 'Origin marker should exist').toBeDefined();
    expect(zSouth, '+Z_South marker should exist').toBeDefined();

    // +Z is away from the camera, which projects higher on the screen (smaller y).
    const dy = origin!.screenPos.y - zSouth!.screenPos.y;
    expect(dy, `+Z_South should be above origin (dy=${dy})`).toBeGreaterThan(20);
  });

  test('E1.3 -X_Left marker is to the left of origin on screen', async ({ page }) => {
    const markers = await page.evaluate(() => (window as any).__cameraTestHarness.getMarkerPositions());
    const origin = markers.find((m: any) => m.label === 'Origin');
    const xLeft = markers.find((m: any) => m.label === '-X_Left');

    expect(origin, 'Origin marker should exist').toBeDefined();
    expect(xLeft, '-X_Left marker should exist').toBeDefined();

    const dx = xLeft!.screenPos.x - origin!.screenPos.x;
    expect(dx, `-X_Left should be left of origin (dx=${dx})`).toBeLessThan(-10);
  });

  test('E1.4 -Z_North marker is below origin on screen', async ({ page }) => {
    const markers = await page.evaluate(() => (window as any).__cameraTestHarness.getMarkerPositions());
    const origin = markers.find((m: any) => m.label === 'Origin');
    const zNorth = markers.find((m: any) => m.label === '-Z_North');

    expect(origin, 'Origin marker should exist').toBeDefined();
    expect(zNorth, '-Z_North marker should exist').toBeDefined();

    // -Z is toward the camera, which projects lower on the screen (larger y).
    const dy = zNorth!.screenPos.y - origin!.screenPos.y;
    expect(dy, `-Z_North should be below origin (dy=${dy})`).toBeGreaterThan(20);
  });

  test('E1.5 +Height marker vec3.y is 2.0 and ground projection is zero', async ({ page }) => {
    const harness = await page.evaluate(() => {
      const h = (window as any).__cameraTestHarness;
      const markers = h.getMarkerPositions();
      const height = markers.find((m: any) => m.label === '+Height');
      // Extract numeric values from Vector3 to avoid serialization issues.
      const hv = height?.vec3;
      const hx = hv ? hv.x : undefined;
      const hy = hv ? hv.y : undefined;
      const hz = hv ? hv.z : undefined;
      const groundVec3 = h.wPosToVector3(0, 0, 0);
      return {
        heightVec3Exists: !!height,
        heightVec3: { x: hx, y: hy, z: hz },
        groundVec3: { x: groundVec3.x, y: groundVec3.y, z: groundVec3.z },
      };
    });

    expect(harness.heightVec3Exists, '+Height marker should exist').toBe(true);
    expect(harness.heightVec3.y, '+Height vec3.y should be 2.0').toBeCloseTo(2.0, 5);
    expect(harness.groundVec3.x, 'ground projection x should be 0').toBeCloseTo(0, 5);
    expect(harness.groundVec3.y, 'ground projection y should be 0').toBeCloseTo(0, 5);
    expect(harness.groundVec3.z, 'ground projection z should be 0').toBeCloseTo(0, 5);
  });
});
