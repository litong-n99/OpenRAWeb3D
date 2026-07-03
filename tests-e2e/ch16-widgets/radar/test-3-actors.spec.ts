import { test, expect } from '@playwright/test';
import {
  gotoRadar,
  screenshot,
  getPixel,
  expectColor,
  getHarness,
  VIS_NONE,
} from './radar-helpers.ts';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('RadarWidget — Actor position dots', () => {
  test.beforeEach(async ({ page }) => {
    await gotoRadar(page);
  });

  test('A1: Exactly 10 mock actors are registered in the test harness', async ({ page }) => {
    const harness = await getHarness(page);
    expect(harness.mockActors).toHaveLength(10);
  });

  test('A2: Actors in visible or fog cells render with their expected color', async ({ page }) => {
    const harness = await getHarness(page);
    const visibleOrFogActors = harness.mockActors.filter((actor) => {
      const idx = actor.y * 64 + actor.x;
      return harness.visibilityGrid[idx] !== VIS_NONE;
    });

    expect(visibleOrFogActors.length).toBeGreaterThanOrEqual(4);

    for (const actor of visibleOrFogActors) {
      const px = actor.x * 4 + 2;
      const py = actor.y * 4 + 2;
      const color = await getPixel(page, px, py);
      expectColor(color, [...actor.color, 255], 20, `Actor at (${actor.x},${actor.y})`);
    }

    await screenshot(page, 'a2-visible-actors');
  });

  test('A3: Actors in fully shrouded cells are hidden', async ({ page }) => {
    const harness = await getHarness(page);
    const hiddenActors = harness.mockActors.filter((actor) => {
      const idx = actor.y * 64 + actor.x;
      return harness.visibilityGrid[idx] === VIS_NONE;
    });

    expect(hiddenActors.length).toBeGreaterThanOrEqual(3);

    for (const actor of hiddenActors) {
      const px = actor.x * 4 + 2;
      const py = actor.y * 4 + 2;
      const color = await getPixel(page, px, py);
      // Must not match the actor's bright color (hidden means black/dimmed terrain).
      const isActorColor =
        Math.abs(color[0] - actor.color[0]) <= 10 &&
        Math.abs(color[1] - actor.color[1]) <= 10 &&
        Math.abs(color[2] - actor.color[2]) <= 10;
      expect(isActorColor, `Actor at (${actor.x},${actor.y}) should be hidden`).toBe(false);
    }

    await screenshot(page, 'a3-hidden-actors');
  });

  test('A4: Structure dot at (30, 30) is larger than infantry dots', async ({ page }) => {
    const harness = await getHarness(page);
    const structure = harness.mockActors.find((a) => a.x === 30 && a.y === 30);
    expect(structure).toBeDefined();
    expect(structure!.size).toBe(3);

    const infantry = harness.mockActors.filter((a) => a.size === 1.5);
    expect(infantry.length).toBeGreaterThanOrEqual(2);

    // Verify the structure is rendered (it sits in the fog ring, so it is drawn).
    const color = await getPixel(page, 30 * 4 + 2, 30 * 4 + 2);
    expectColor(color, [100, 200, 200, 255], 8, 'Structure at (30,30)');

    await screenshot(page, 'a4-structure-dot-size');
  });
});
