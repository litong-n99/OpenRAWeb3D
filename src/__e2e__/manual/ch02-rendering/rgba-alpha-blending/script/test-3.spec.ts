/**
 * Playwright E2E Tests — RgbaColorRenderer Color Switch Response Time (Expect 3)
 *
 * Target: http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/
 *
 * Validates that changing color pickers and clicking "Apply Colors" updates
 * the overlap reference values within 50ms.
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/';
const EVIDENCE_DIR = path.resolve(
  'test-results/manual/ch02-rendering/rgba-alpha-blending/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

test('color switch updates within 50ms', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Capture the initial reference value to detect change
  const initialRefRg = await page.locator('#ref-rg').textContent();
  expect(initialRefRg).not.toBe('-');

  // Change all three color pickers to distinctly different colors
  await page.locator('#color-left').fill('#ff9900');
  await page.locator('#color-mid').fill('#00ff99');
  await page.locator('#color-right').fill('#9900ff');

  // Measure the actual DOM update latency inside the browser using a
  // MutationObserver. This avoids Playwright round-trip overhead so the
  // measurement reflects real rendering update time.
  const elapsed = await page.evaluate((initial: string | null) => {
    return new Promise<number>((resolve) => {
      const rgEl = document.getElementById('ref-rg')!;
      const start = performance.now();
      let resolved = false;

      const observer = new MutationObserver(() => {
        if (resolved) return;
        const current = rgEl.textContent ?? '';
        if (current !== initial && current !== '-') {
          resolved = true;
          observer.disconnect();
          resolve(performance.now() - start);
        }
      });
      observer.observe(rgEl, { childList: true, subtree: true, characterData: true });

      document.getElementById('apply-colors')!.click();

      // Fallback: if the mutation already happened synchronously
      requestAnimationFrame(() => {
        if (!resolved) {
          const current = rgEl.textContent ?? '';
          if (current !== initial && current !== '-') {
            resolved = true;
            observer.disconnect();
            resolve(performance.now() - start);
          }
        }
      });
    });
  }, initialRefRg);

  // Also verify the change via page.waitForFunction as the detection mechanism.
  await page.waitForFunction(
    (initial: string | null) => {
      const current = document.getElementById('ref-rg')?.textContent ?? '';
      return current !== initial && current !== '-';
    },
    initialRefRg,
    { timeout: 200 }
  );

  expect(elapsed, `color update took ${elapsed.toFixed(2)}ms`).toBeLessThan(50);

  // Evidence screenshot
  await page.screenshot({
    path: evidenceFile('screenshot-color-switch-after.png'),
    fullPage: true,
  });
});
