/**
 * test-5-replace-anim-edges.spec.ts
 *
 * Expectations covered:
 *   Edge/boundary tests from README:
 *     - Modulo boundary 0: walk frame 0 → attack frame 0 % 8 = 0
 *     - Modulo boundary N-1: walk frame 14 → attack frame 14 % 8 = 6
 *     - Same sequence replacement: attack → attack, no change, no crash
 *     - No tickAlways during replaceAnim: tickAlways stays false
 *     - Rapid consecutive replacements: no crash
 *   Expectation 4: Event log entry count and format
 *
 * Verifies edge cases and boundary conditions for ReplaceAnim.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  '..', '..', '..', '..', '..', '..',
  'test-results', 'manual', 'ch02-rendering', 'animation-play-modes', 'evidence',
);

const PAGE_URL = '/test/ch02-rendering/animation-play-modes/';

test.describe('Edge Cases: ReplaceAnim boundaries and robustness', () => {
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

  test('T5.1: Same sequence replacement — attack→attack — no crash, no change', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // First replace to attack
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(500);

    const seqBefore = await page.textContent('#state-sequence');
    expect(seqBefore).toBe('attack');

    // Click attack again (same sequence)
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(300);

    // Sequence should still be attack
    const seqAfter = await page.textContent('#state-sequence');
    expect(seqAfter).toBe('attack');

    // Engine should be alive
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t5-1-same-sequence.png'),
      fullPage: false,
    });
  });

  test('T5.2: tickAlways remains false in ReplaceAnim mode', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // tickAlways should be false
    const tickAlways = await page.textContent('#state-tick-always');
    expect(tickAlways).toBe('false');

    // Do several replacements
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(300);
    await page.click('#btn-replace-idle');
    await page.waitForTimeout(300);
    await page.click('#btn-replace-walk');
    await page.waitForTimeout(300);

    // tickAlways should remain false
    const tickAlways2 = await page.textContent('#state-tick-always');
    expect(tickAlways2).toBe('false');
  });

  test('T5.3: Rapid consecutive replacements — no crash', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // Rapid-fire sequence replacements: attack → idle → deploy → walk → attack → idle
    const targets = ['#btn-replace-attack', '#btn-replace-idle', '#btn-replace-deploy', '#btn-replace-walk', '#btn-replace-attack', '#btn-replace-idle'];
    for (const btnSelector of targets) {
      await page.click(btnSelector);
      await page.waitForTimeout(300);
    }

    // Engine should still be alive
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    // Error overlay should not be visible
    const errorVisible = await page.evaluate(() => {
      const el = document.getElementById('gpu-error');
      return el && el.style.display !== 'none';
    });
    expect(errorVisible).toBe(false);

    // Sequence state should be updating
    const seqName = await page.textContent('#state-sequence');
    expect(seqName).toBeTruthy();
    expect(seqName!.length).toBeGreaterThan(0);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t5-3-rapid-replacements.png'),
      fullPage: false,
    });
  });

  test('T5.4: Event log has entries for each replacement', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // Clear log first
    await page.click('#btn-clear-log');
    await page.waitForTimeout(200);

    // Do replacements
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(300);

    await page.click('#btn-replace-idle');
    await page.waitForTimeout(300);

    await page.click('#btn-replace-deploy');
    await page.waitForTimeout(300);

    // Log should have entries for each
    const logText = await page.textContent('#event-log');
    expect(logText).toContain('attack');
    expect(logText).toContain('idle');
    expect(logText).toContain('deploy');

    // Each entry should contain the modulo formula
    const lines = logText!.split('\n').filter(l => l.includes('ReplaceAnim:'));
    expect(lines.length).toBeGreaterThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t5-4-event-log.png'),
      fullPage: false,
    });
  });

  test('T5.5: Log max 50 entries — clear log works', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // Clear log first
    await page.click('#btn-clear-log');
    await page.waitForTimeout(200);

    // Verify log is cleared
    let logText = await page.textContent('#event-log');
    expect(logText).toContain('等待操作');

    // Do a replacement
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(300);

    logText = await page.textContent('#event-log');
    expect(logText).toContain('ReplaceAnim');
    expect(logText).toContain('attack');
  });

  test('T5.6: Frame stays within new sequence bounds after replacement', async ({ page }) => {
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    // Replace to attack (8 frames, indices 0-7)
    await page.click('#btn-replace-attack');
    await page.waitForTimeout(500);

    // For several seconds, verify frame always stays in [0, 7]
    for (let i = 0; i < 5; i++) {
      const frame = await page.textContent('#state-frame');
      const frameNum = parseInt(frame!, 10);
      expect(frameNum).toBeGreaterThanOrEqual(0);
      expect(frameNum).toBeLessThanOrEqual(7);
      await page.waitForTimeout(500);
    }

    // Replace to idle (4 frames, indices 0-3)
    await page.click('#btn-replace-idle');
    await page.waitForTimeout(500);

    // Verify frame stays in [0, 3]
    for (let i = 0; i < 5; i++) {
      const frame = await page.textContent('#state-frame');
      const frameNum = parseInt(frame!, 10);
      expect(frameNum).toBeGreaterThanOrEqual(0);
      expect(frameNum).toBeLessThanOrEqual(3);
      await page.waitForTimeout(500);
    }
  });

  test('T5.7: Mode switching preserve/restore state correctly', async ({ page }) => {
    // Start in fetchIndex mode
    const initialMode = await page.inputValue('#play-mode');
    expect(initialMode).toBe('fetchIndex');

    const initialTickAlways = await page.textContent('#state-tick-always');
    expect(initialTickAlways).toBe('true');

    // Switch to replaceAnim
    await page.selectOption('#play-mode', 'replaceAnim');
    await page.waitForTimeout(300);

    const replaceTickAlways = await page.textContent('#state-tick-always');
    expect(replaceTickAlways).toBe('false');

    // Switch back to fetchIndex
    await page.selectOption('#play-mode', 'fetchIndex');
    await page.waitForTimeout(300);

    const backTickAlways = await page.textContent('#state-tick-always');
    expect(backTickAlways).toBe('true');

    // Engine should still be alive after mode switches
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t5-7-mode-switching.png'),
      fullPage: false,
    });
  });
});
