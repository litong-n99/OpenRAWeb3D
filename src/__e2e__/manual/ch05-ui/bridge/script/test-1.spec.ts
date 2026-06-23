/**
 * WorldInteractionControllerWidget — pointer event bridge acceptance tests
 *
 * URL: http://localhost:5173/test/ch05-ui/bridge/
 *
 * Verifies canvas-based Babylon.js pointer interactions:
 *   - context-menu suppression
 *   - single-click / modifier-click selection
 *   - double-click select-by-class
 *   - drag-box selection
 *   - hover rollover
 *   - right-click order dispatch
 *
 * Headless caveats:
 *   * Frame pacing can be slower in headless Chromium/SwiftShader, so all
 *     timing-sensitive assertions use generous waits (>= 80ms) rather than
 *     relying on a strict 16ms frame budget.
 *   * UI overlays are given pointer-events:none before interactions so that
 *     clicks always reach the canvas regardless of the 1920x1080 layout.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PAGE_URL = '/test/ch05-ui/bridge/'
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || path.resolve('test-results', 'manual/ch05-ui/bridge'),
  'evidence'
)

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }
  return path.join(EVIDENCE_DIR, name)
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForHarnessReady(page: Page): Promise<void> {
  await page.goto(PAGE_URL)

  await page.waitForSelector('#renderCanvas', { timeout: 20000 })
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness
      return !!(h && h.controller && h.scene && h.entityInstances && h.entityInstances.length === 8)
    },
    { timeout: 20000 }
  )
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine')
      return el !== null && el.textContent !== null && el.textContent.includes('WebGL')
    },
    { timeout: 20000 }
  )

  // Let the first frames render and the camera settle.
  await page.waitForTimeout(600)

  // Reset camera to the documented default so every test starts from the same view.
  await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.camera.alpha = -Math.PI / 4
    h.camera.beta = Math.PI / 3.3
    h.camera.radius = 14
    h.camera.target.x = 4.5
    h.camera.target.y = 0.3
    h.camera.target.z = 4.5
  })
  await page.waitForTimeout(300)

  // Make UI overlays pass pointer events through to the canvas.  The status
  // panel text is still readable for assertions.
  await page.evaluate(() => {
    const ids = ['header', 'expected-panel', 'entity-legend', 'controls', 'status-panel', 'info-bar']
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) el.style.pointerEvents = 'none'
    }
  })
}

async function resetHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as any).__testHarness
    if (h && typeof h.resetState === 'function') h.resetState()

    // Release any stuck modifier keys from a previously interrupted test.
    ;['Shift', 'Control', 'Alt'].forEach((key) => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey: false, ctrlKey: false, altKey: false }))
    })
    ;['mod-shift', 'mod-ctrl', 'mod-alt'].forEach((id) => {
      document.getElementById(id)?.classList.remove('active')
    })
  })
  await page.waitForTimeout(80)
}

async function getEntityScreenPos(page: Page, entityId: string): Promise<{ x: number; y: number }> {
  const pos = await page.evaluate((id) => {
    const h = (window as any).__testHarness
    const inst = h.entityInstances.find((e: any) => e.def.id === id)
    if (!inst) throw new Error(`entity ${id} not found`)
    const screen = (h.controller as any)._worldToScreen(inst.mesh.absolutePosition)
    if (!screen) throw new Error(`could not project entity ${id} to screen`)
    return { x: Math.round(screen.x), y: Math.round(screen.y) }
  }, entityId)
  return pos
}

async function worldToScreen(page: Page, worldPos: { x: number; y: number; z: number }): Promise<{ x: number; y: number }> {
  const pos = await page.evaluate((w) => {
    const h = (window as any).__testHarness
    const screen = (h.controller as any)._worldToScreen(w)
    if (!screen) throw new Error(`could not project world position to screen`)
    return { x: Math.round(screen.x), y: Math.round(screen.y) }
  }, worldPos)
  return pos
}

async function getSelectionText(page: Page): Promise<string> {
  return (await page.locator('#st-selection').textContent()) ?? ''
}

async function getRolloverText(page: Page): Promise<string> {
  return (await page.locator('#st-rollover').textContent()) ?? ''
}

async function getActionText(page: Page): Promise<string> {
  return (await page.locator('#st-last-action').textContent()) ?? ''
}

async function getOrderText(page: Page): Promise<string> {
  return (await page.locator('#st-last-order').textContent()) ?? ''
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const p = evidencePath(name)
  await page.screenshot({ path: p, fullPage: false })
  await testInfo.attach(name, { path: p })
}

async function clickEntity(page: Page, entityId: string): Promise<void> {
  const pos = await getEntityScreenPos(page, entityId)
  await page.mouse.click(pos.x, pos.y)
}

async function rightClickEntity(page: Page, entityId: string): Promise<void> {
  const pos = await getEntityScreenPos(page, entityId)
  await page.mouse.click(pos.x, pos.y, { button: 'right' })
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe('WorldInteractionControllerWidget — pointer event bridge', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page }) => {
    await waitForHarnessReady(page)
    await resetHarness(page)
  })

  // ===========================================================================
  // 1. Right-click context menu suppression
  // ===========================================================================

  test('1.1 - contextmenu event is prevented on the canvas', async ({ page }, testInfo) => {
    const canvas = page.locator('#renderCanvas')
    const prevented = await canvas.evaluate((el) => {
      let dp = false
      const handler = (e: Event) => {
        dp = e.defaultPrevented
      }
      el.addEventListener('contextmenu', handler)
      el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 })
      )
      el.removeEventListener('contextmenu', handler)
      return dp
    })

    expect(prevented, 'controller should call preventDefault on the canvas contextmenu event').toBe(true)
    await attachScreenshot(page, testInfo, 'bridge-01-contextmenu-prevented.png')
  })

  test('1.2 - right-click on entity issues Attack order', async ({ page }, testInfo) => {
    await rightClickEntity(page, 'inf-1')
    await page.waitForTimeout(100)

    await expect(page.locator('#st-last-order'), 'order should target inf-1 with Attack').toContainText('Attack → 实体 inf-1')
    await expect(page.locator('#st-last-action')).toContainText('右键命令: Attack')
    await attachScreenshot(page, testInfo, 'bridge-02-rightclick-entity.png')
  })

  test('1.3 - right-click on empty ground issues Move order', async ({ page }, testInfo) => {
    const pos = await worldToScreen(page, { x: 5, y: -0.05, z: 5 })
    await page.mouse.click(pos.x, pos.y, { button: 'right' })
    await page.waitForTimeout(100)

    const order = await getOrderText(page)
    expect(order, 'order should be a Move command to ground coordinates').toMatch(/Move → 地面 \([\d.-]+, [\d.-]+\)/)
    await attachScreenshot(page, testInfo, 'bridge-03-rightclick-ground.png')
  })

  test('1.4 - Shift+right-click on ground queues the Move order', async ({ page }, testInfo) => {
    const pos = await worldToScreen(page, { x: 5, y: -0.05, z: 5 })
    await page.keyboard.down('Shift')
    await page.mouse.click(pos.x, pos.y, { button: 'right' })
    await page.keyboard.up('Shift')
    await page.waitForTimeout(100)

    const order = await getOrderText(page)
    expect(order, 'queued Move order should contain the queue suffix').toMatch(/Move → 地面 \([\d.-]+, [\d.-]+\)/)
    expect(order).toContain('[排队]')
    await attachScreenshot(page, testInfo, 'bridge-04-shift-rightclick-ground.png')
  })

  // ===========================================================================
  // 2. Single-click selection
  // ===========================================================================

  test('2.1 - single-click selects the clicked entity', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'selection should show inf-1').toHaveText('inf-1')
    await expect(page.locator('#st-last-action')).toContainText('单击: inf-1')
    await attachScreenshot(page, testInfo, 'bridge-05-single-click.png')
  })

  test('2.2 - clicking another entity replaces the selection', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)
    await clickEntity(page, 'veh-1')
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'selection should be replaced by veh-1').toHaveText('veh-1')
    await attachScreenshot(page, testInfo, 'bridge-06-replace-selection.png')
  })

  test('2.3 - clicking empty ground clears the selection', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    const empty = await worldToScreen(page, { x: 5, y: -0.05, z: 5 })
    await page.mouse.click(empty.x, empty.y)
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'selection should be cleared').toHaveText('(无)')
    await expect(page.locator('#st-last-action')).toContainText('清除选择 (点击空地)')
    await attachScreenshot(page, testInfo, 'bridge-07-clear-selection.png')
  })

  // ===========================================================================
  // 3. Modifier key combinations
  // ===========================================================================

  test('3.1 - Shift+click adds entity to existing selection', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    const pos = await getEntityScreenPos(page, 'veh-1')
    await page.keyboard.down('Shift')
    await page.mouse.click(pos.x, pos.y)
    await page.keyboard.up('Shift')
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'Shift+click should add veh-1 to inf-1').toHaveText('inf-1, veh-1')
    await expect(page.locator('#st-last-action')).toContainText('+Shift添加')
    await attachScreenshot(page, testInfo, 'bridge-08-shift-add.png')
  })

  test('3.2 - Ctrl+click toggles a selected entity off', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    const pos2 = await getEntityScreenPos(page, 'veh-1')
    await page.keyboard.down('Shift')
    await page.mouse.click(pos2.x, pos2.y)
    await page.keyboard.up('Shift')
    await page.waitForTimeout(80)

    const pos1 = await getEntityScreenPos(page, 'inf-1')
    await page.keyboard.down('Control')
    await page.mouse.click(pos1.x, pos1.y)
    await page.keyboard.up('Control')
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'Ctrl+click should remove inf-1').toHaveText('veh-1')
    await expect(page.locator('#st-last-action')).toContainText('+Ctrl切换')
    await attachScreenshot(page, testInfo, 'bridge-09-ctrl-toggle-off.png')
  })

  test('3.3 - Ctrl+click toggles an unselected entity on', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    const pos = await getEntityScreenPos(page, 'str-1')
    await page.keyboard.down('Control')
    await page.mouse.click(pos.x, pos.y)
    await page.keyboard.up('Control')
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'Ctrl+click should add str-1').toHaveText('inf-1, str-1')
    await attachScreenshot(page, testInfo, 'bridge-10-ctrl-toggle-on.png')
  })

  test('3.4 - modifier key indicators light up while keys are held', async ({ page }, testInfo) => {
    const ids = [
      { key: 'Shift', id: 'mod-shift' },
      { key: 'Control', id: 'mod-ctrl' },
      { key: 'Alt', id: 'mod-alt' },
    ] as const

    for (const { key, id } of ids) {
      await page.keyboard.down(key)
      await page.waitForTimeout(50)
      const active = await page.locator(`#${id}`).evaluate((el) => el.classList.contains('active'))
      expect(active, `${id} should have class active while ${key} is held`).toBe(true)
      await page.keyboard.up(key)
      await page.waitForTimeout(50)
      const inactive = await page.locator(`#${id}`).evaluate((el) => !el.classList.contains('active'))
      expect(inactive, `${id} should lose class active after ${key} release`).toBe(true)
    }

    await attachScreenshot(page, testInfo, 'bridge-11-modifier-leds.png')
  })

  // ===========================================================================
  // 4. Double-click select-by-class
  // ===========================================================================

  test('4.1 - double-click Infantry selects all player Infantry', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'inf-1')
    await page.mouse.dblclick(pos.x, pos.y)
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'both player infantry should be selected').toHaveText('inf-1, inf-2')
    await expect(page.locator('#st-last-action')).toContainText('框选/双击: inf-1, inf-2')
    await attachScreenshot(page, testInfo, 'bridge-12-dblclick-infantry.png')
  })

  test('4.2 - double-click Vehicle selects all player Vehicles', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'veh-1')
    await page.mouse.dblclick(pos.x, pos.y)
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'both player vehicles should be selected').toHaveText('veh-1, veh-2')
    await attachScreenshot(page, testInfo, 'bridge-13-dblclick-vehicle.png')
  })

  test('4.3 - double-click enemy entity clears selection', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'enm-i')
    await page.mouse.dblclick(pos.x, pos.y)
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'enemy entities are not eligible for selection').toHaveText('(无)')
    await attachScreenshot(page, testInfo, 'bridge-14-dblclick-enemy.png')
  })

  test('4.4 - two clicks more than 300ms apart are independent', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'inf-1')
    await page.mouse.click(pos.x, pos.y)
    await page.waitForTimeout(400)
    await page.mouse.click(pos.x, pos.y)
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'slow clicks should not trigger double-click class selection').toHaveText('inf-1')
    await expect(page.locator('#st-last-action')).toContainText('单击: inf-1')
    await attachScreenshot(page, testInfo, 'bridge-15-slow-clicks.png')
  })

  test('4.5 - double-click beyond 5px radius is treated as two single clicks', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'inf-1')
    await page.mouse.click(pos.x, pos.y)
    await page.mouse.click(pos.x + 8, pos.y)
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'offset double-click should remain a single inf-1 selection').toHaveText('inf-1')
    await attachScreenshot(page, testInfo, 'bridge-16-offset-dblclick.png')
  })

  // ===========================================================================
  // 5. Drag-box selection
  // ===========================================================================

  test('5.1 - drag box selects all player entities inside the rectangle', async ({ page }, testInfo) => {
    const p1 = await getEntityScreenPos(page, 'inf-1')
    const p2 = await getEntityScreenPos(page, 'inf-2')
    const start = { x: Math.min(p1.x, p2.x) - 20, y: Math.min(p1.y, p2.y) - 20 }
    const end = { x: Math.max(p1.x, p2.x) + 20, y: Math.max(p1.y, p2.y) + 20 }

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })

    await expect(page.locator('#drag-box'), 'green dashed drag box should be visible during drag').toBeVisible()
    await expect(page.locator('#st-state')).toHaveText('dragging')

    await page.mouse.up()
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'drag box should select both infantry').toHaveText('inf-1, inf-2')
    await expect(page.locator('#st-last-action')).toContainText('框选/双击: inf-1, inf-2')
    await attachScreenshot(page, testInfo, 'bridge-17-drag-box.png')
  })

  test('5.2 - drag under the deadzone is treated as a single click', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'inf-2')
    await page.mouse.move(pos.x, pos.y)
    await page.mouse.down()
    await page.mouse.move(pos.x + 2, pos.y + 2)

    await expect(page.locator('#drag-box'), 'drag box should not appear below deadzone').toHaveCSS('display', 'none')

    await page.mouse.up()
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'sub-deadzone drag should select the entity under the cursor').toHaveText('inf-2')
    await attachScreenshot(page, testInfo, 'bridge-18-sub-deadzone-drag.png')
  })

  test('5.3 - drag over empty area clears the selection', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    const center = await worldToScreen(page, { x: 5, y: -0.05, z: 5 })
    await page.mouse.move(center.x - 25, center.y - 25)
    await page.mouse.down()
    await page.mouse.move(center.x + 25, center.y + 25, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'empty drag box should clear selection').toHaveText('(无)')
    await attachScreenshot(page, testInfo, 'bridge-19-empty-drag.png')
  })

  test('5.4 - Shift+drag box adds to existing selection', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    const v1 = await getEntityScreenPos(page, 'veh-1')
    const v2 = await getEntityScreenPos(page, 'veh-2')
    const start = { x: Math.min(v1.x, v2.x) - 20, y: Math.min(v1.y, v2.y) - 20 }
    const end = { x: Math.max(v1.x, v2.x) + 20, y: Math.max(v1.y, v2.y) + 20 }

    await page.keyboard.down('Shift')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(100)

    await expect(page.locator('#st-selection'), 'Shift+drag should add both vehicles to inf-1').toHaveText('inf-1, veh-1, veh-2')
    await attachScreenshot(page, testInfo, 'bridge-20-shift-drag.png')
  })

  // ===========================================================================
  // 6. Hover rollover
  // ===========================================================================

  test('6.1 - hovering over entity updates rollover to entity ID', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'veh-1')
    await page.mouse.move(pos.x, pos.y)
    await page.waitForTimeout(80)

    await expect(page.locator('#st-rollover'), 'rollover should show veh-1').toHaveText('veh-1')
    await attachScreenshot(page, testInfo, 'bridge-21-hover-entity.png')
  })

  test('6.2 - moving off entity clears rollover', async ({ page }, testInfo) => {
    const pos = await getEntityScreenPos(page, 'veh-2')
    await page.mouse.move(pos.x, pos.y)
    await page.waitForTimeout(80)
    await expect(page.locator('#st-rollover')).toHaveText('veh-2')

    const empty = await worldToScreen(page, { x: 5, y: -0.05, z: 5 })
    await page.mouse.move(empty.x, empty.y)
    await page.waitForTimeout(80)

    await expect(page.locator('#st-rollover'), 'rollover should clear when moving to empty ground').toHaveText('(无)')
    await attachScreenshot(page, testInfo, 'bridge-22-hover-clear.png')
  })

  test('6.3 - rapid movement between entities follows without delay', async ({ page }, testInfo) => {
    const p1 = await getEntityScreenPos(page, 'inf-1')
    const p2 = await getEntityScreenPos(page, 'veh-1')

    await page.mouse.move(p1.x, p1.y)
    await page.waitForTimeout(50)
    expect(await getRolloverText(page), 'first rollover should be inf-1').toBe('inf-1')

    await page.mouse.move(p2.x, p2.y)
    await page.waitForTimeout(50)
    expect(await getRolloverText(page), 'rollover should switch to veh-1').toBe('veh-1')

    await page.mouse.move(p1.x, p1.y)
    await page.waitForTimeout(50)
    expect(await getRolloverText(page), 'rollover should switch back to inf-1').toBe('inf-1')

    await attachScreenshot(page, testInfo, 'bridge-23-rapid-hover.png')
  })

  // ===========================================================================
  // 7. Right-click order dispatch (classification)
  // ===========================================================================

  test('7.1 - right-click on enemy entity issues Attack order', async ({ page }, testInfo) => {
    await rightClickEntity(page, 'enm-i')
    await page.waitForTimeout(100)

    await expect(page.locator('#st-last-order'), 'enemy entity should still be a valid Attack target').toContainText('Attack → 实体 enm-i')
    await attachScreenshot(page, testInfo, 'bridge-24-attack-enemy.png')
  })

  test('7.2 - right-click on player entity issues Attack order', async ({ page }, testInfo) => {
    await rightClickEntity(page, 'veh-2')
    await page.waitForTimeout(100)

    await expect(page.locator('#st-last-order')).toContainText('Attack → 实体 veh-2')
    await attachScreenshot(page, testInfo, 'bridge-25-attack-friendly.png')
  })

  // ===========================================================================
  // 8. Boundary / regression cases
  // ===========================================================================

  test('8.1 - rapid sequential clicks replace selection correctly', async ({ page }, testInfo) => {
    for (const id of ['inf-1', 'veh-1', 'inf-2', 'veh-2']) {
      await clickEntity(page, id)
      await page.waitForTimeout(100)
    }

    await expect(page.locator('#st-selection'), 'last clicked entity should remain selected').toHaveText('veh-2')
    await expect(page.locator('#st-state'), 'state machine should return to idle').toHaveText('idle')
    await attachScreenshot(page, testInfo, 'bridge-26-rapid-clicks.png')
  })

  test('8.2 - right-click order does not interfere with following left-click selection', async ({ page }, testInfo) => {
    const empty = await worldToScreen(page, { x: 5, y: -0.05, z: 5 })
    await page.mouse.click(empty.x, empty.y, { button: 'right' })
    await page.waitForTimeout(80)
    await expect(page.locator('#st-last-order')).toContainText('Move → 地面')

    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'left-click after right-click should still select').toHaveText('inf-1')
    await attachScreenshot(page, testInfo, 'bridge-27-order-then-select.png')
  })

  test('8.3 - single-click enemy entity is not selectable', async ({ page }, testInfo) => {
    await clickEntity(page, 'inf-1')
    await page.waitForTimeout(80)
    await clickEntity(page, 'enm-i')
    await page.waitForTimeout(80)

    await expect(page.locator('#st-selection'), 'clicking enemy should clear the player selection').toHaveText('(无)')
    await attachScreenshot(page, testInfo, 'bridge-28-enemy-unselectable.png')
  })
})
