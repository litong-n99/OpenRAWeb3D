import { test, expect, type Page } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/camera-controls/';

// Canvas dimensions (viewport minus info bar): 1540 x 1052
const LEFT_PANEL = 380;
const CANVAS_CX = Math.round((1920 - LEFT_PANEL) / 2); // 770
const CANVAS_CY = Math.round((1080 - 28) / 2);         // 526

async function waitForHarness(page: Page) {
  await page.goto(PAGE_URL);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => (window as any).__cameraTestHarness?.scene?.isReady());
  await page.waitForTimeout(500);
}

test.describe('E2 - Zoom-to-Cursor Accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await waitForHarness(page);
  });

  test('E2.1 zoom at screen center keeps WPos drift within 2 su for 3x and 0.5x', async ({ page }) => {
    // Use direct pickTerrainAt with canvas coordinates (not page coordinates).
    // Center is (CANVAS_CX, CANVAS_CY).

    // Reset to 1x zoom.
    await page.evaluate(() => (window as any).__cameraTestHarness.setZoom(1.0));
    await page.waitForTimeout(300);

    // --- 1x → 3x ---
    // Pick WPos at canvas center before zoom.
    const wposBefore3x = await page.evaluate(({ sx, sy }) => {
      const h = (window as any).__cameraTestHarness;
      const hit = h.pickTerrainAt(sx, sy);
      return hit ? h.vector3ToWPos(hit) : null;
    }, { sx: CANVAS_CX, sy: CANVAS_CY });
    expect(wposBefore3x, 'should pick terrain at center before 3x zoom').not.toBeNull();

    // Zoom at center with correction.
    await page.evaluate(({ sx, sy }) => {
      (window as any).__cameraTestHarness.zoomAtCursor(3.0, sx, sy);
    }, { sx: CANVAS_CX, sy: CANVAS_CY });
    await page.waitForTimeout(500);

    // Pick WPos at same canvas position after zoom.
    const wposAfter3x = await page.evaluate(({ sx, sy }) => {
      const h = (window as any).__cameraTestHarness;
      const hit = h.pickTerrainAt(sx, sy);
      return hit ? h.vector3ToWPos(hit) : null;
    }, { sx: CANVAS_CX, sy: CANVAS_CY });
    expect(wposAfter3x, 'should pick terrain at center after 3x zoom').not.toBeNull();

    const dx3 = Math.abs(wposAfter3x!.x - wposBefore3x!.x);
    const dy3 = Math.abs(wposAfter3x!.y - wposBefore3x!.y);
    expect(dx3, `3x drift x=${dx3}`).toBeLessThanOrEqual(2);
    expect(dy3, `3x drift y=${dy3}`).toBeLessThanOrEqual(2);

    // --- 3x → 0.5x ---
    const wposBefore05x = await page.evaluate(({ sx, sy }) => {
      const h = (window as any).__cameraTestHarness;
      const hit = h.pickTerrainAt(sx, sy);
      return hit ? h.vector3ToWPos(hit) : null;
    }, { sx: CANVAS_CX, sy: CANVAS_CY });
    expect(wposBefore05x, 'should pick terrain at center before 0.5x zoom').not.toBeNull();

    await page.evaluate(({ sx, sy }) => {
      (window as any).__cameraTestHarness.zoomAtCursor(0.5, sx, sy);
    }, { sx: CANVAS_CX, sy: CANVAS_CY });
    await page.waitForTimeout(500);

    const wposAfter05x = await page.evaluate(({ sx, sy }) => {
      const h = (window as any).__cameraTestHarness;
      const hit = h.pickTerrainAt(sx, sy);
      return hit ? h.vector3ToWPos(hit) : null;
    }, { sx: CANVAS_CX, sy: CANVAS_CY });
    expect(wposAfter05x, 'should pick terrain at center after 0.5x zoom').not.toBeNull();

    const dx05 = Math.abs(wposAfter05x!.x - wposBefore05x!.x);
    const dy05 = Math.abs(wposAfter05x!.y - wposBefore05x!.y);
    expect(dx05, `0.5x drift x=${dx05}`).toBeLessThanOrEqual(2);
    expect(dy05, `0.5x drift y=${dy05}`).toBeLessThanOrEqual(2);
  });

  test('E2.2 zoomAtCursor near a marker keeps WPos drift within 3 su', async ({ page }) => {
    // Get +X_Right marker screenPos (canvas coordinates).
    const marker = await page.evaluate(() => {
      const m = (window as any).__cameraTestHarness.getMarkerPositions().find((p: any) => p.label === '+X_Right');
      return m ? { sx: m.screenPos.x, sy: m.screenPos.y } : null;
    });
    expect(marker, '+X_Right marker should exist').not.toBeNull();

    // Reset to 1x.
    await page.evaluate(() => (window as any).__cameraTestHarness.setZoom(1.0));
    await page.waitForTimeout(300);

    // Pick WPos at marker screen position before zoom.
    const wposBefore = await page.evaluate(({ sx, sy }) => {
      const h = (window as any).__cameraTestHarness;
      const hit = h.pickTerrainAt(sx, sy);
      return hit ? h.vector3ToWPos(hit) : null;
    }, { sx: marker!.sx, sy: marker!.sy });
    expect(wposBefore, 'should pick terrain at marker before zoom').not.toBeNull();

    // Zoom at marker position.
    await page.evaluate(({ sx, sy }) => {
      (window as any).__cameraTestHarness.zoomAtCursor(3.0, sx, sy);
    }, { sx: marker!.sx, sy: marker!.sy });
    await page.waitForTimeout(500);

    // Pick WPos at same screen position after zoom.
    const wposAfter = await page.evaluate(({ sx, sy }) => {
      const h = (window as any).__cameraTestHarness;
      const hit = h.pickTerrainAt(sx, sy);
      return hit ? h.vector3ToWPos(hit) : null;
    }, { sx: marker!.sx, sy: marker!.sy });
    expect(wposAfter, 'should pick terrain at marker after zoom').not.toBeNull();

    const dx = Math.abs(wposAfter!.x - wposBefore!.x);
    const dy = Math.abs(wposAfter!.y - wposBefore!.y);
    expect(dx, `marker zoom drift x=${dx}`).toBeLessThanOrEqual(3);
    expect(dy, `marker zoom drift y=${dy}`).toBeLessThanOrEqual(3);
  });

  test('E2.3 zoomAtCursor at boundary keeps camera target clamped to [0,10]x[0,10]', async ({ page }) => {
    // Start from default zoom.
    await page.evaluate(() => (window as any).__cameraTestHarness.setZoom(1.0));
    await page.waitForTimeout(300);

    // Push camera target beyond bounds.
    await page.evaluate(() => {
      const cam = (window as any).__cameraTestHarness.camera;
      cam.target.x = 12;
      cam.target.z = 12;
      cam.update();
    });
    await page.waitForTimeout(200);

    // Zoom at canvas center — clamping should apply.
    await page.evaluate(({ sxf, syf }) => {
      (window as any).__cameraTestHarness.zoomAtCursor(3.0, sxf, syf);
    }, { sxf: CANVAS_CX, syf: CANVAS_CY });
    await page.waitForTimeout(500);

    const target = await page.evaluate(() => {
      const t = (window as any).__cameraTestHarness.camera.target;
      return { x: t.x, z: t.z };
    });

    expect(target.x, `camera.target.x=${target.x} should be clamped to [0,10]`).toBeGreaterThanOrEqual(0);
    expect(target.x, `camera.target.x=${target.x} should be clamped to [0,10]`).toBeLessThanOrEqual(10);
    expect(target.z, `camera.target.z=${target.z} should be clamped to [0,10]`).toBeGreaterThanOrEqual(0);
    expect(target.z, `camera.target.z=${target.z} should be clamped to [0,10]`).toBeLessThanOrEqual(10);
  });
});
