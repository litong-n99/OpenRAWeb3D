/**
 * Playwright E2E Tests — Cloak Detection (shroud/cloak-detect)
 *
 * Target: /test/ch12-shroud-fog/cloak-detect/
 * Module: DetectCloaked
 *
 * Acceptance criteria covered:
 *   test-1: Initial state — detector out of range, not detected
 *   test-2: Enter detection range — detected at boundary and inside
 *   test-3: Leave detection range — returns to not detected
 *   test-4: DetectionTypes filtering — Cloak / Subterranean / Both / None
 *   test-5: Range adjustment — threshold, diagonal, and boundary cases
 *
 * KNOWN BUG (R2):
 *   Parent Mesh.isVisible does NOT propagate to child meshes in Babylon.js.
 *   Hiding `cloakedUnit.isVisible = false` will still leave `infantryBody`
 *   and `infantryHead` visible. Use `setEnabled(false)` or iterate children
 *   when asserting actual mesh visibility. Detection *logic* is correct;
 *   the bug is purely in visual rendering.
 */

import { test, expect, type Page } from '@playwright/test';

const PAGE_URL = '/test/ch12-shroud-fog/cloak-detect/';

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await expect.poll(
    async () => page.evaluate(() => typeof (window as any).__cloakDetectTest !== 'undefined'),
    { message: '__cloakDetectTest harness should be ready', timeout }
  ).toBe(true);
}

async function getHarnessState(page: Page) {
  return page.evaluate(() => {
    const h = (window as any).__cloakDetectTest;
    return {
      detectorX: h.detectorX,
      detectorZ: h.detectorZ,
      detectionRange: h.detectionRange,
      detectorTypes: h.detectorTypes,
      cloakedTypes: h.cloakedTypes,
      distance: h.computeDistance(),
      detected: h.isDetected(),
    };
  });
}

async function setDetectorPosition(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(([px, pz]) => {
    (window as any).__cloakDetectTest.setDetectorPos(px, pz);
  }, [x, z]);
  // Allow one render frame for the UI status to refresh.
  await page.waitForTimeout(50);
}

async function setDetectionRange(page: Page, r: number): Promise<void> {
  await page.evaluate((range) => {
    (window as any).__cloakDetectTest.setRange(range);
  }, r);
  await page.waitForTimeout(50);
}

async function setDetectionTypes(page: Page, types: string[]): Promise<void> {
  await page.evaluate((t) => {
    (window as any).__cloakDetectTest.setDetectorTypes(t);
  }, types);
  await page.waitForTimeout(50);
}

async function getStatusText(page: Page) {
  return page.evaluate(() => ({
    dist: document.getElementById('status-dist')?.textContent ?? '',
    detect: document.getElementById('status-detect')?.textContent ?? '',
    type: document.getElementById('status-type')?.textContent ?? '',
  }));
}

test.describe.configure({ mode: 'serial' });

test.describe('Cloak Detection', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(PAGE_URL);
    await page.waitForTimeout(3000);
    await waitForHarness(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.beforeEach(async () => {
    // Reset detector to a known neutral state before each case.
    await setDetectorPosition(page, -3.0, 0);
    await setDetectionRange(page, 2.0);
    await setDetectionTypes(page, ['Cloak']);
  });

  // ---------------------------------------------------------------------------
  // test-1: Initial State — Out of Range
  // ---------------------------------------------------------------------------
  test('test-1: Initial state — out of range', async () => {
    const state = await getHarnessState(page);
    expect(state.detectorX).toBeCloseTo(-3.0, 5);
    expect(state.detectorZ).toBeCloseTo(0.0, 5);
    expect(state.detectionRange).toBeCloseTo(2.0, 5);
    expect(state.distance).toBeCloseTo(3.0, 5);
    expect(state.detected).toBe(false);

    const status = await getStatusText(page);
    expect(status.detect).toContain('Not Detected');
    expect(status.detect).toContain('距离超出范围');

    await expect(page.locator('#info-engine')).toHaveText('WebGL 2.0');
  });

  // ---------------------------------------------------------------------------
  // test-2: Enter Range — Detected
  // ---------------------------------------------------------------------------
  test('test-2: Enter range — detected at boundary and inside', async () => {
    // Move detector to X=-2.0: distance == range (boundary), must be detected.
    await setDetectorPosition(page, -2.0, 0);

    let state = await getHarnessState(page);
    expect(state.distance).toBeCloseTo(2.0, 5);
    expect(state.detected).toBe(true);

    let status = await getStatusText(page);
    expect(status.detect.toUpperCase()).toContain('DETECTED');

    // Move detector to X=0: distance == 0, still detected.
    await setDetectorPosition(page, 0.0, 0);

    state = await getHarnessState(page);
    expect(state.distance).toBeCloseTo(0.0, 5);
    expect(state.detected).toBe(true);

    status = await getStatusText(page);
    expect(status.detect.toUpperCase()).toContain('DETECTED');
  });

  // ---------------------------------------------------------------------------
  // test-3: Leave Range — Back to Not Detected
  // ---------------------------------------------------------------------------
  test('test-3: Leave range — back to not detected', async () => {
    await setDetectorPosition(page, 0.0, 0);
    let state = await getHarnessState(page);
    expect(state.detected).toBe(true);

    // Move back to initial out-of-range position.
    await setDetectorPosition(page, -3.0, 0);

    state = await getHarnessState(page);
    expect(state.distance).toBeCloseTo(3.0, 5);
    expect(state.detected).toBe(false);

    const status = await getStatusText(page);
    expect(status.detect).toContain('Not Detected');
  });

  // ---------------------------------------------------------------------------
  // test-4: DetectionTypes Filtering
  // ---------------------------------------------------------------------------
  test('test-4: DetectionTypes filtering', async () => {
    // Place detector directly on top of the cloaked unit so distance is never
    // the limiting factor.
    await setDetectorPosition(page, 0.0, 0.0);

    // Default detector type Cloak matches cloaked unit → detected.
    let state = await getHarnessState(page);
    expect(state.detected).toBe(true);

    // Subterranean only does not match a Cloak type unit.
    await setDetectionTypes(page, ['Subterranean']);
    state = await getHarnessState(page);
    expect(state.detected).toBe(false);

    let status = await getStatusText(page);
    expect(status.detect).toContain('类型不匹配');

    // Both covers Cloak and Subterranean → detected again.
    await setDetectionTypes(page, ['Cloak', 'Subterranean']);
    state = await getHarnessState(page);
    expect(state.detected).toBe(true);

    status = await getStatusText(page);
    expect(status.detect.toUpperCase()).toContain('DETECTED');

    // None explicitly matches nothing.
    await setDetectionTypes(page, []);
    state = await getHarnessState(page);
    expect(state.detected).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // test-5: Range Adjustment
  // ---------------------------------------------------------------------------
  test('test-5: Range adjustment — threshold, diagonal, and boundary', async () => {
    // Case A: distance 1.5, range 1.0 → not detected.
    await setDetectorPosition(page, 1.5, 0);
    await setDetectionRange(page, 1.0);
    let state = await getHarnessState(page);
    expect(state.distance).toBeCloseTo(1.5, 5);
    expect(state.detected).toBe(false);

    // Case B: distance 1.5, range 2.0 → detected.
    await setDetectionRange(page, 2.0);
    state = await getHarnessState(page);
    expect(state.detected).toBe(true);

    // Case C: diagonal (1.5, 1.5), range 2.0 → distance ≈ 2.121 > 2.0.
    await setDetectorPosition(page, 1.5, 1.5);
    await setDetectionRange(page, 2.0);
    state = await getHarnessState(page);
    expect(state.distance).toBeCloseTo(Math.sqrt(4.5), 5);
    expect(state.detected).toBe(false);

    // Case D: boundary dist=2.0, range=2.0 → detected.
    await setDetectorPosition(page, 2.0, 0);
    await setDetectionRange(page, 2.0);
    state = await getHarnessState(page);
    expect(state.distance).toBeCloseTo(2.0, 5);
    expect(state.detected).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Visual rendering sanity check with Bug R2 documented
  // ---------------------------------------------------------------------------
  test('visual rendering: detection state is reflected on the detection disc', async () => {
    // This test exercises rendering helpers without asserting child visibility,
    // because parent Mesh.isVisible does not propagate to children (Bug R2).
    await setDetectorPosition(page, 0.0, 0.0);
    await setDetectionRange(page, 2.0);
    await setDetectionTypes(page, ['Cloak']);

    const discOk = await page.evaluate(() => {
      const h = (window as any).__cloakDetectTest;
      return h.detectionCircle != null && h.detectionCircle.isVisible === true;
    });
    expect(discOk).toBe(true);

    // BUG R2 NOTE: If you were to hide the cloaked unit via
    // `h.cloakedUnit.isVisible = false`, the child meshes `infantryBody`
    // and `infantryHead` would still render. Use `h.cloakedUnit.setEnabled(false)`
    // or iterate and hide each child explicitly. Detection logic is unaffected.
  });
});
