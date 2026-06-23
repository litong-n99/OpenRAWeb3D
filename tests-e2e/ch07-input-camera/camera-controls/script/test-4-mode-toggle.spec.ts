import { test, expect, type Page } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/camera-controls/';

async function waitForHarness(page: Page) {
  await page.goto(PAGE_URL);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => (window as any).__cameraTestHarness?.scene?.isReady());
  await page.waitForTimeout(500);
}

interface MarkerScreenPos {
  label: string;
  x: number;
  y: number;
}

async function getNonCornerMarkerPositions(page: Page): Promise<MarkerScreenPos[]> {
  return page.evaluate(() =>
    (window as any).__cameraTestHarness
      .getMarkerPositions()
      .filter((m: any) => !m.label.startsWith('MapCorner'))
      .map((m: any) => ({ label: m.label, x: m.screenPos.x, y: m.screenPos.y }))
  );
}

test.describe('E4 - Camera Mode Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await waitForHarness(page);
  });

  test('E4.1 toggling ortho/perspective keeps main marker screen offset within 350px', async ({ page }) => {
    const before = await getNonCornerMarkerPositions(page);
    expect(before.length, 'there should be non-corner markers to compare').toBeGreaterThan(0);

    // Click the mode toggle button to switch to perspective (or back).
    await page.locator('#btn-toggle-mode').click();
    await page.waitForTimeout(500);

    const after = await getNonCornerMarkerPositions(page);
    expect(after.length, 'markers should still exist after mode toggle').toBe(before.length);

    let maxDistance = 0;
    for (const b of before) {
      const a = after.find((m: any) => m.label === b.label);
      expect(a, `marker ${b.label} should still exist after toggle`).toBeDefined();
      const dx = a!.x - b.x;
      const dy = a!.y - b.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > maxDistance) {
        maxDistance = distance;
      }
    }

    expect(maxDistance, `maximum marker screen offset=${maxDistance}px should be <= 350px`).toBeLessThanOrEqual(350);
  });
});
