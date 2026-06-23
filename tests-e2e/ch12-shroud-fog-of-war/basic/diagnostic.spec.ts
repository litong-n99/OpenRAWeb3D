import { test, expect } from '@playwright/test';

test('Diagnostic: capture console errors during page load', async ({ page }) => {
  const consoleLogs: string[] = [];
  const pageErrors: Error[] = [];

  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err);
  });

  await page.goto('http://localhost:5173/test/ch12-shroud-fog/basic/');
  // Wait a long time to catch all errors
  await page.waitForTimeout(5000);

  console.log('--- Console Logs ---');
  consoleLogs.forEach(l => console.log(l));
  console.log('--- Page Errors ---');
  pageErrors.forEach(e => console.log(e.message));

  // Check if canvas exists
  const canvasExists = await page.locator('#renderCanvas').count();
  console.log(`Canvas count: ${canvasExists}`);

  // Check if __shroudTest exists
  const hasHarness = await page.evaluate(() => {
    return {
      hasHarness: !!(window as any).__shroudTest,
      keys: (window as any).__shroudTest ? Object.keys((window as any).__shroudTest) : [],
    };
  });
  console.log(`Harness exists: ${hasHarness.hasHarness}`);
  if (hasHarness.hasHarness) {
    console.log(`Harness keys: ${hasHarness.keys.join(', ')}`);
  }

  // Also check for BABYLON global
  const hasBabylon = await page.evaluate(() => !!(window as any).BABYLON);
  console.log(`BABYLON global: ${hasBabylon}`);

  // Check WebGL support
  const webglInfo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl ? `Supported: ${gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'}` : 'Not supported';
  });
  console.log(`WebGL: ${webglInfo}`);

  expect(true).toBe(true); // just capturing info
});
