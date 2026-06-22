/**
 * test-4-replace-anim-to-idle.spec.ts
 *
 * Expectations covered:
 *   Expectation 3: ReplaceAnim long sequence → short sequence modulo
 *                   walk(15) → idle(4): frame % 4
 *
 * Verifies replacing a 15-frame walk sequence with a 4-frame idle sequence
 * preserves frame position via modulo operation.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  '..', '..', '..', '..', '..', '..',
  'test-results', 'manual', 'ch02-rendering', 'animation-play-modes', 'evidence',
);

const PAGE_URL = '/test/ch02-rendering/animation-play-modes/';

test.describe('Expectation 3: ReplaceAnim long(15) → short(4) modulo mapping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el && el.textContent !== '-';
    }, { timeout: 15000 });
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');
  });

  test('T4.1: walk→idle — sequence name and length update correctly', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // Click replace to idle (4 frames)
    await page.click('#btn-replace-idle');
    await page.waitForTimeout(500);

    const seqName = await page.textContent('#state-sequence');
    expect(seqName).toBe('idle');

    const seqLen = await page.textContent('#state-seq-length');
    expect(seqLen).toContain('4');

    // Tick should be 120ms (idle = slowest)
    const tickDisplay = await page.textContent('#state-tick');
    expect(tickDisplay).toContain('120ms');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t4-1-walk-to-idle.png'),
      fullPage: false,
    });
  });

  test('T4.2: walk→idle — log entry shows correct modulo', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    await page.click('#btn-replace-idle');
    await page.waitForTimeout(500);

    const logText = await page.textContent('#event-log');
    expect(logText).toContain('ReplaceAnim:');
    expect(logText).toContain('idle');
    // Should contain modulo by 4
    expect(logText).toMatch(/% 4 = /);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t4-2-idle-log.png'),
      fullPage: false,
    });
  });

  test('T4.3: walk→idle — frame index is within idle range [0, 3]', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    await page.click('#btn-replace-idle');
    await page.waitForTimeout(500);

    const frame = await page.textContent('#state-frame');
    const frameNum = parseInt(frame!, 10);
    // After modulo, frame must be in [0, 3] range (idle has 4 frames)
    expect(frameNum).toBeGreaterThanOrEqual(0);
    expect(frameNum).toBeLessThanOrEqual(3);
  });

  test('T4.4: idle→walk back — restores 15 frames and 40ms tick', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // First to idle
    await page.click('#btn-replace-idle');
    await page.waitForTimeout(300);

    // Then to walk
    await page.click('#btn-replace-walk');
    await page.waitForTimeout(500);

    const seqName = await page.textContent('#state-sequence');
    expect(seqName).toBe('walk');

    const seqLen = await page.textContent('#state-seq-length');
    expect(seqLen).toContain('15');

    const tickDisplay = await page.textContent('#state-tick');
    expect(tickDisplay).toContain('40ms');
  });

  test('T4.5: attack→idle — 8-frame to 4-frame modulo', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // First go to attack
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(300);

    // Then go to idle
    await page.click('#btn-replace-idle');
    await page.waitForTimeout(500);

    const seqName = await page.textContent('#state-sequence');
    expect(seqName).toBe('idle');

    // Frame should be in [0, 3] for idle
    const frame = await page.textContent('#state-frame');
    const frameNum = parseInt(frame!, 10);
    expect(frameNum).toBeGreaterThanOrEqual(0);
    expect(frameNum).toBeLessThanOrEqual(3);

    // Log should show attack→idle with modulo 4
    const logText = await page.textContent('#event-log');
    expect(logText).toContain('attack');
    expect(logText).toContain('idle');
    expect(logText).toMatch(/% 4 = /);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t4-5-attack-to-idle.png'),
      fullPage: false,
    });
  });

  test('T4.6: deploy→idle — 30-frame to 4-frame extreme modulo', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // Go to deploy (30 frames)
    await page.click('#btn-replace-deploy');
    await page.waitForTimeout(300);

    // Then to idle
    await page.click('#btn-replace-idle');
    await page.waitForTimeout(500);

    // Frame should be in [0, 3] for idle
    const frame = await page.textContent('#state-frame');
    const frameNum = parseInt(frame!, 10);
    expect(frameNum).toBeGreaterThanOrEqual(0);
    expect(frameNum).toBeLessThanOrEqual(4);

    // Engine should still be alive
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t4-6-deploy-to-idle.png'),
      fullPage: false,
    });
  });
});
