import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch02-rendering/world-layer-ordering/';
const EVIDENCE_DIR = 'test-results/manual/ch02-rendering/world-layer-ordering/evidence';

const LAYER_NAMES: Record<number, string> = {
  0: 'Terrain',
  1: 'Actor',
  2: 'Overlay',
  3: 'Annotation',
};

const EXPECTED_Z: Record<number, number> = {
  0: 0.1,
  1: 0.05,
  2: 0.0,
  3: -0.05,
};

function evidenceFile(name: string): string {
  const dir = path.resolve(EVIDENCE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, name);
}

async function isHeadless(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function getSceneLayerState(page: any) {
  return page.evaluate(() => {
    const scene = (window as any).__scene__;
    if (!scene) throw new Error('Babylon.js scene is not exposed on window.__scene__');
    const meshes = scene.meshes.filter((m: any) => m.name.startsWith('circle_'));
    const groups = [0, 1, 2, 3].map((groupId) => {
      const groupMeshes = meshes.filter((m: any) => m.renderingGroupId === groupId);
      return {
        groupId,
        count: groupMeshes.length,
        allVisible: groupMeshes.every((m: any) => m.isVisible),
        zValues: groupMeshes.map((m: any) => m.position.z),
      };
    });
    return { groups, totalCircleMeshes: meshes.length };
  });
}

test.describe('Ch02 World Layer Ordering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el && el.textContent?.includes('Babylon.js');
    }, { timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  test('test-1: layer ordering by renderingGroupId', async ({ page }) => {
    const state = await getSceneLayerState(page);
    expect(state.totalCircleMeshes, 'should have 12 circle planes (4 layers × 3 circles)').toBe(12);

    for (const group of state.groups) {
      const name = LAYER_NAMES[group.groupId];
      expect(group.count, `${name} should have 3 circles`).toBe(3);
      expect(group.allVisible, `${name} should be visible initially`).toBe(true);
      const expectedZ = EXPECTED_Z[group.groupId];
      for (const z of group.zValues) {
        expect(z, `${name} Z should be ${expectedZ}`).toBeCloseTo(expectedZ, 3);
      }
    }

    const groupIds = state.groups.map((g: any) => g.groupId);
    expect(groupIds).toEqual([0, 1, 2, 3]);

    expect(state.groups[0].groupId, 'Terrain should be group 0 (bottom)').toBe(0);
    expect(state.groups[3].groupId, 'Annotation should be group 3 (top)').toBe(3);

    await page.locator('#sandbox').screenshot({ path: evidenceFile('test-1-layer-ordering.png') });
  });

  test('test-2: independent visibility toggle', async ({ page }) => {
    for (let groupId = 0; groupId <= 3; groupId++) {
      const cb = page.locator(`.layer-cb[data-group="${groupId}"]`);
      const stateEl = page.locator(`#state-${LAYER_NAMES[groupId].toLowerCase()}`);
      await expect(cb).toBeChecked();
      await expect(stateEl).toContainText('可见');

      // Measure hide response time inside the browser to avoid Playwright round-trip overhead.
      const offMs = await page.evaluate((gid: number) => {
        return new Promise<number>((resolve, reject) => {
          const checkbox = document.querySelector(`.layer-cb[data-group="${gid}"]`) as HTMLInputElement | null;
          if (!checkbox) {
            reject(new Error(`Checkbox for group ${gid} not found`));
            return;
          }
          const scene = (window as any).__scene__;
          if (!scene) {
            reject(new Error('Babylon.js scene is not exposed on window.__scene__'));
            return;
          }
          const getGroupMeshes = () =>
            scene.meshes.filter((m: any) => m.name.startsWith('circle_') && m.renderingGroupId === gid);

          const start = performance.now();
          checkbox.checked = false;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));

          const check = () => {
            const meshes = getGroupMeshes();
            const allHidden = meshes.length > 0 && meshes.every((m: any) => m.isVisible === false);
            if (allHidden) {
              resolve(performance.now() - start);
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
      }, groupId);
      expect(offMs, `${LAYER_NAMES[groupId]} hide took ${offMs}ms, should be <= 50ms`).toBeLessThanOrEqual(50);
      await expect(stateEl).toContainText('隐藏');

      const onMs = await page.evaluate((gid: number) => {
        return new Promise<number>((resolve, reject) => {
          const checkbox = document.querySelector(`.layer-cb[data-group="${gid}"]`) as HTMLInputElement | null;
          if (!checkbox) {
            reject(new Error(`Checkbox for group ${gid} not found`));
            return;
          }
          const scene = (window as any).__scene__;
          if (!scene) {
            reject(new Error('Babylon.js scene is not exposed on window.__scene__'));
            return;
          }
          const getGroupMeshes = () =>
            scene.meshes.filter((m: any) => m.name.startsWith('circle_') && m.renderingGroupId === gid);

          const start = performance.now();
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));

          const check = () => {
            const meshes = getGroupMeshes();
            const allVisible = meshes.length > 0 && meshes.every((m: any) => m.isVisible === true);
            if (allVisible) {
              resolve(performance.now() - start);
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
      }, groupId);
      expect(onMs, `${LAYER_NAMES[groupId]} show took ${onMs}ms, should be <= 50ms`).toBeLessThanOrEqual(50);
      await expect(stateEl).toContainText('可见');
    }

    await page.locator('#sandbox').screenshot({ path: evidenceFile('test-2-visibility-toggles.png') });
  });

  test('test-3: offset slider maintains layer order', async ({ page }) => {
    await page.evaluate(() => {
      const slider = document.getElementById('offset-slider') as HTMLInputElement | null;
      if (!slider) throw new Error('offset-slider not found');
      slider.value = '1.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(100);

    const offsetText = await page.locator('#offset-val').textContent();
    const displayedOffset = parseFloat((offsetText || '0').replace('−', '-'));
    expect(displayedOffset).toBeCloseTo(1.5, 2);

    const state = await getSceneLayerState(page);
    expect(state.groups.map((g: any) => g.groupId)).toEqual([0, 1, 2, 3]);
    for (const group of state.groups) {
      expect(group.count).toBe(3);
    }

    await page.locator('#sandbox').screenshot({ path: evidenceFile('test-3-offset-1.5.png') });
  });

  test('test-4: FPS >= 55 (headless >= 45)', async ({ page }) => {
    await page.waitForTimeout(2000);

    const fpsText = await page.locator('#info-fps').textContent();
    const fps = parseInt(fpsText || '0', 10);
    expect(fps, 'FPS display should be a positive number').toBeGreaterThan(0);

    const headless = await isHeadless(page);
    if (headless) {
      expect(fps, `FPS ${fps} should be >= 45 in headless mode`).toBeGreaterThanOrEqual(45);
    } else {
      expect(fps, `FPS ${fps} should be >= 55 in headed mode`).toBeGreaterThanOrEqual(55);
    }
  });
});
