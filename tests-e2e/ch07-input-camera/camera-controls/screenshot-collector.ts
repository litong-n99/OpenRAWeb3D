import { chromium } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/camera-controls/';
const EVIDENCE_DIR = 'e:/OpenRAWeb3D/test-results/manual/ch07-input-camera/camera-controls/evidence';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.goto(PAGE_URL);
  await page.waitForFunction(() => (window as any).__cameraTestHarness?.scene?.isReady());
  await page.waitForTimeout(1000);

  // Screenshot 1: Initial state - coordinate system
  await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-1-initial-state.png`, fullPage: false });
  console.log('screenshot-1: initial state');

  // Screenshot 2: After toggling to perspective mode
  await page.click('#btn-toggle-mode');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-2-perspective-mode.png`, fullPage: false });
  console.log('screenshot-2: perspective mode');

  // Toggle back to ortho
  await page.click('#btn-toggle-mode');
  await page.waitForTimeout(500);

  // Screenshot 3: Top edge zone active (mouse near top)
  await page.mouse.move(1150, 7);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-3-edge-top-active.png`, fullPage: false });
  console.log('screenshot-3: top edge active');

  // Screenshot 4: Right edge zone active (mouse near right)
  await page.mouse.move(1915, 540);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-4-edge-right-active.png`, fullPage: false });
  console.log('screenshot-4: right edge active');

  // Screenshot 5: After zooming to 3x with correction at center
  await page.mouse.move(1150, 526);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const h = (window as any).__cameraTestHarness;
    h.zoomAtCursor(3.0, 770, 526);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-5-zoom-3x.png`, fullPage: false });
  console.log('screenshot-5: zoom 3x');

  // Screenshot 6: Map boundary visualization + edge zones
  await page.evaluate(() => {
    const h = (window as any).__cameraTestHarness;
    h.setZoom(1.0);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-6-boundary-grid.png`, fullPage: false });
  console.log('screenshot-6: boundary grid');

  // Get marker info for report
  const markerInfo = await page.evaluate(() => {
    const h = (window as any).__cameraTestHarness;
    const markers = h.getMarkerPositions().map((m: any) => ({
      label: m.label,
      wpos: m.wpos,
      screenPos: m.screenPos,
    }));
    return markers;
  });
  console.log('Marker positions:', JSON.stringify(markerInfo, null, 2));

  // Get camera state
  const camState = await page.evaluate(() => {
    const h = (window as any).__cameraTestHarness;
    return {
      mode: h.getCameraMode(),
      zoom: h.getCurrentZoom(),
      target: h.getCameraTarget(),
    };
  });
  console.log('Camera state:', JSON.stringify(camState, null, 2));

  await browser.close();
  console.log('All screenshots saved.');
})();
