import { test, expect, type Page } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/camera-controls/';

// Layout offsets: left panel = 380px, viewport height = 1080 - 28 (info bar) = 1052px
const LEFT_PANEL_WIDTH = 380;
const INFO_BAR_HEIGHT = 28;
const VIEWPORT_WIDTH = 1920 - LEFT_PANEL_WIDTH; // 1540
const VIEWPORT_HEIGHT = 1080 - INFO_BAR_HEIGHT; // 1052

async function waitForHarness(page: Page) {
  await page.goto(PAGE_URL);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => (window as any).__cameraTestHarness?.scene?.isReady());
  await page.waitForTimeout(500);
}

test.describe('E3 - Edge Scroll Detection', () => {
  test.beforeEach(async ({ page }) => {
    await waitForHarness(page);
  });

  test('E3.1 moving cursor near top edge activates #edge-top', async ({ page }) => {
    // Center x within viewport, 5px from top of viewport.
    await page.mouse.move(LEFT_PANEL_WIDTH + VIEWPORT_WIDTH / 2, 7);
    await page.waitForTimeout(200);
    const edge = page.locator('#edge-top');
    await expect(edge, 'top edge element should have active class').toHaveClass(/active/);
  });

  test('E3.2 moving cursor near bottom edge activates #edge-bottom', async ({ page }) => {
    // Center x within viewport, 5px from bottom of viewport (above info bar).
    // Viewport bottom y = VIEWPORT_HEIGHT = 1052. 5px above = 1047.
    await page.mouse.move(LEFT_PANEL_WIDTH + VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT - 5);
    await page.waitForTimeout(200);
    const edge = page.locator('#edge-bottom');
    await expect(edge, 'bottom edge element should have active class').toHaveClass(/active/);
  });

  test('E3.3 moving cursor near left edge activates #edge-left', async ({ page }) => {
    // 5px from left edge of viewport, vertically centered.
    await page.mouse.move(LEFT_PANEL_WIDTH + 5, VIEWPORT_HEIGHT / 2);
    await page.waitForTimeout(200);
    const edge = page.locator('#edge-left');
    await expect(edge, 'left edge element should have active class').toHaveClass(/active/);
  });

  test('E3.4 moving cursor near right edge activates #edge-right', async ({ page }) => {
    // 5px from right edge of viewport, vertically centered.
    // Right edge of viewport = LEFT_PANEL + VIEWPORT_WIDTH = 1920.
    await page.mouse.move(1920 - 5, VIEWPORT_HEIGHT / 2);
    await page.waitForTimeout(200);
    const edge = page.locator('#edge-right');
    await expect(edge, 'right edge element should have active class').toHaveClass(/active/);
  });

  test('E3.5 shift-dragging camera to boundary clamps target to [0,10]x[0,10]', async ({ page }) => {
    // Center the cursor within the viewport first.
    await page.mouse.move(LEFT_PANEL_WIDTH + VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    await page.waitForTimeout(100);

    // Hold Shift and drag toward top-left to push the target toward (0,0).
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(LEFT_PANEL_WIDTH + 200, 200, { steps: 30 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
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
