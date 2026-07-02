/**
 * script-driven-effects Playwright acceptance test
 * URL: http://localhost:5173/test/ch20-scripting/script-driven-effects/
 * Harness: window.__testHarness
 * Verifies: S1 Camera, S2 Animation, S3 Dialogue, S4 Timed Sequence, S5 Error Handling, S6 Boundary
 */
import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch20-scripting/script-driven-effects/';
const EVIDENCE_DIR = 'test-results/manual/ch20-scripting/script-driven-effects/evidence';

// Helper: Euclidean distance between two 3D points
function distance3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

test.describe('Ch20 Script-Driven Effects', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    // Wait for Babylon.js engine to initialize
    await page.waitForSelector('#dRunning', { timeout: 15000 });
    // Ensure initial state is idle
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 10000 });
  });

  // ── S1: Camera Movement ──
  test('S1: Camera Movement — moves to (6,1,6) with tolerance <= 1 wu', async ({ page }) => {
    // Click Camera Move button
    await page.click('#btnCamera');

    // Wait for script to complete
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 5000 });

    // Check camera position
    const pos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });

    const target = { x: 6, y: 1, z: 6 };
    const dist = distance3D(pos, target);

    expect(dist, `Camera distance to target (6,1,6): got (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}), distance=${dist.toFixed(3)}`).toBeLessThanOrEqual(1.0);

    // Verify script is idle
    const status = await page.evaluate(() => {
      return (window as any).__testHarness.getScriptStatus();
    });
    expect(status).toBe('idle');

    // Screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s1-camera-move.png` });
  });

  // ── S2: Actor Animation ──
  test('S2: Actor Animation — animation name "attack" and color turns red', async ({ page }) => {
    await page.click('#btnAnim');

    // Wait for script completion
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 5000 });

    // Check animation name
    const animName = await page.evaluate(() => {
      return (window as any).__testHarness.getActorAnimation();
    });
    expect(animName).toBe('attack');

    // Check actor color is red (r high, g low, b low)
    const color = await page.evaluate(() => {
      // Read from sidebar display for the diffuseColor
      const el = document.getElementById('dColor');
      return el ? el.textContent : '';
    });

    // Color should be "1.00,0.30,0.10" for red
    const parts = color!.split(',').map(Number);
    expect(parts[0], 'Red component').toBeGreaterThan(0.7);
    expect(parts[1], 'Green component').toBeLessThan(0.5);
    expect(parts[2], 'Blue component').toBeLessThan(0.3);

    // Screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s2-actor-animation.png` });
  });

  // ── S3: Dialogue Text ──
  test('S3: Dialogue — visible with text "Hello Commander!"', async ({ page }) => {
    await page.click('#btnDialogue');

    // dialogue sets opacity synchronously; wait a small tick for DOM update
    await page.waitForTimeout(100);

    // Check visibility
    const visible = await page.evaluate(() => {
      return (window as any).__testHarness.isDialogueVisible();
    });
    expect(visible).toBe(true);

    // Check text
    const text = await page.evaluate(() => {
      return (window as any).__testHarness.getDialogueText();
    });
    expect(text).toBe('Hello Commander!');

    // Screenshot (capture dialogue overlay visible)
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s3-dialogue.png` });
  });

  // ── S4: Timed Sequence ──
  test('S4: Timed Sequence — 7 steps execute in order, finishes idle', async ({ page }) => {
    await page.click('#btnSequence');

    // Poll until script finishes (has 500ms + 1000ms delays, need generous timeout)
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 20000, polling: 200 });

    // Verify events count = 7
    const eventsCount = await page.evaluate(() => {
      return (window as any).__testHarness.getEventsCount();
    });
    expect(eventsCount).toBe(7);

    // Verify status idle
    const status = await page.evaluate(() => {
      return (window as any).__testHarness.getScriptStatus();
    });
    expect(status).toBe('idle');

    // Verify camera moved to (6, 1.5, 5)
    const pos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });
    const target = { x: 6, y: 1.5, z: 5 };
    const dist = distance3D(pos, target);
    expect(dist).toBeLessThanOrEqual(1.0);

    // Final animation should be 'idle' (last anim step sets idle)
    const animName = await page.evaluate(() => {
      return (window as any).__testHarness.getActorAnimation();
    });
    expect(animName).toBe('idle');

    // Screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s4-timed-sequence.png` });
  });

  // ── S5: Error Handling ──
  test('S5: Error Handling — unknown step type does not crash, reset clears state', async ({ page }) => {
    // Inject an unknown step type
    await page.evaluate(() => {
      (window as any).__testHarness.runScript([{ type: 'unknown', data: {} }]);
    });

    // Wait for script to return to idle (skipped via default case)
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 5000 });

    // Verify no crash — the canvas and buttons still exist
    const canvasExists = await page.evaluate(() => !!document.getElementById('renderCanvas'));
    expect(canvasExists).toBe(true);

    const btnCameraExists = await page.evaluate(() => !!document.getElementById('btnCamera'));
    expect(btnCameraExists).toBe(true);

    // Now reset
    await page.click('#btnReset');
    await page.waitForTimeout(200);

    // Verify reset state
    const pos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });
    const defaultTarget = { x: 3, y: 2, z: 3 };
    const dist = distance3D(pos, defaultTarget);
    expect(dist, `Camera should be back at (3,2,3), got (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`).toBeLessThanOrEqual(0.5);

    const animName = await page.evaluate(() => {
      return (window as any).__testHarness.getActorAnimation();
    });
    expect(animName).toBe('idle');

    const visible = await page.evaluate(() => {
      return (window as any).__testHarness.isDialogueVisible();
    });
    expect(visible).toBe(false);

    // Screenshot after reset
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s5-reset.png` });
  });

  // ── S6.1: Boundary — Re-entry prevention (scriptRunning guard) ──
  test('S6.1: Boundary — re-entry prevention via scriptRunning guard', async ({ page }) => {
    // Strategy: dispatch TWO scripts in the same JS tick using evaluate.
    // First script has a delay (keeps scriptRunning=true for a while).
    // Second script should be ignored by the re-entry guard.
    await page.evaluate(() => {
      const h = (window as any).__testHarness;
      // First: a script with delay that moves camera to (8, 1, 8)
      h.runScript([
        { type: 'camera', data: { x: 0, y: 1, z: 0 } },
        { type: 'delay', data: { ms: 500 } },
        { type: 'camera', data: { x: 8, y: 1, z: 8 } },
      ]);
      // Second: immediately try to run animation script (should be ignored)
      h.runScript([
        { type: 'anim', data: { name: 'attack', color: '1,0.3,0.1' } },
      ]);
    });

    // Wait for script to complete (500ms delay + processing)
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 10000 });

    // Verify only the first script executed: camera should be at (8,1,8)
    const pos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });
    const target = { x: 8, y: 1, z: 8 };
    const dist = distance3D(pos, target);
    expect(dist, `Camera should be at (8,1,8) from first script, got (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`).toBeLessThanOrEqual(1.0);

    // Second script was ignored → animation should still be 'idle' (not 'attack')
    const animName = await page.evaluate(() => {
      return (window as any).__testHarness.getActorAnimation();
    });
    expect(animName, 'Second script should have been ignored, animation must stay idle').toBe('idle');

    // Screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s6-1-rapid-clicks.png` });
  });

  // ── S6.2: Boundary — Empty Script Queue ──
  test('S6.2: Boundary — empty script queue has no side effects', async ({ page }) => {
    // Get initial state
    const initialPos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });

    // Run empty script
    await page.evaluate(() => {
      (window as any).__testHarness.runScript([]);
    });

    await page.waitForTimeout(300);

    // Verify still idle
    const status = await page.evaluate(() => {
      return (window as any).__testHarness.getScriptStatus();
    });
    expect(status).toBe('idle');

    // Verify camera unchanged
    const pos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });
    const dist = distance3D(pos, initialPos);
    expect(dist).toBeLessThanOrEqual(0.1);

    // Verify animation unchanged
    const animName = await page.evaluate(() => {
      return (window as any).__testHarness.getActorAnimation();
    });
    expect(animName).toBe('idle');

    // Screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s6-2-empty-queue.png` });
  });

  // ── S6.3: Boundary — Reset then Re-execute ──
  test('S6.3: Boundary — reset does not break subsequent script execution', async ({ page }) => {
    // First run a script
    await page.click('#btnCamera');
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 5000 });

    // Reset
    await page.click('#btnReset');
    await page.waitForTimeout(200);

    // Verify reset state
    const posAfterReset = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });
    const defaultTarget = { x: 3, y: 2, z: 3 };
    expect(distance3D(posAfterReset, defaultTarget)).toBeLessThanOrEqual(0.5);

    // Run camera script again
    await page.click('#btnCamera');
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 5000 });

    // Verify camera moved correctly
    const finalPos = await page.evaluate(() => {
      return (window as any).__testHarness.getCameraPosition();
    });
    const target = { x: 6, y: 1, z: 6 };
    expect(distance3D(finalPos, target), 'Camera should move to (6,1,6) after reset and re-execute').toBeLessThanOrEqual(1.0);

    // Screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/screenshot-s6-3-reset-reexecute.png` });
  });

  // ── S6.4: Boundary — Long delay does not block UI ──
  test('S6.4: Boundary — long delay uses setTimeout, UI remains responsive', async ({ page }) => {
    // Run a script with a 2-second delay
    await page.evaluate(() => {
      (window as any).__testHarness.runScript([
        { type: 'camera', data: { x: 6, y: 1, z: 6 } },
        { type: 'delay', data: { ms: 2000 } },
        { type: 'anim', data: { name: 'attack', color: '1,0.3,0.1' } },
      ]);
    });

    // Immediately after dispatch, buttons should still be responsive
    // (scriptRunning=true so clicking a button would be ignored,
    // but the DOM itself is not blocked — we can verify the button exists and is clickable)
    const btnReset = page.locator('#btnReset');
    await expect(btnReset).toBeVisible();
    await expect(btnReset).toBeEnabled();

    // The harness re-entry guard prevents running another script,
    // but we can verify the harness is in running state
    const status = await page.evaluate(() => {
      return (window as any).__testHarness.getScriptStatus();
    });
    expect(status).toBe('running');

    // Wait for completion
    await page.waitForFunction(() => {
      const h = (window as any).__testHarness;
      return h && h.getScriptStatus() === 'idle';
    }, { timeout: 15000 });

    // Verify final state: animation should be 'attack'
    const animName = await page.evaluate(() => {
      return (window as any).__testHarness.getActorAnimation();
    });
    expect(animName).toBe('attack');
  });
});
