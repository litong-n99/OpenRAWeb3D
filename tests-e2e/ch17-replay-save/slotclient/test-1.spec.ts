import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch17-replay-save/slotclient/'
const EVIDENCE_DIR = path.resolve('E:/OpenRAWeb3D/test-results/manual/ch17-replay-save/slotclient/evidence')

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

function evidenceFile(name: string): string {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  return path.join(EVIDENCE_DIR, `${name}.png`)
}

async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: evidenceFile(name), fullPage: true })
}

async function takeSectionScreenshot(page: Page, selector: string, name: string): Promise<void> {
  await page.locator(selector).screenshot({ path: evidenceFile(name) })
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function waitForSections(page: Page): Promise<void> {
  await Promise.all([
    page.waitForSelector('#section-default .test-result', { state: 'attached' }),
    page.waitForSelector('#section-client .test-result', { state: 'attached' }),
    page.waitForSelector('#section-serialize .test-result', { state: 'attached' }),
    page.waitForSelector('#section-applyto .test-result', { state: 'attached' }),
    page.waitForSelector('#section-edge .test-result', { state: 'attached' }),
  ])
}

async function expectSectionAllPass(page: Page, sectionSelector: string, label: string): Promise<void> {
  const section = page.locator(sectionSelector)
  const failCount = await section.locator('.test-result .fail').count()
  expect(failCount, `${label} must not contain any FAIL markers`).toBe(0)
  const passCount = await section.locator('.test-result .pass').count()
  expect(passCount, `${label} must contain at least one PASS marker`).toBeGreaterThan(0)
}

async function clickButtonAndWait(page: Page, buttonId: string, sectionSelector: string): Promise<void> {
  await page.locator(buttonId).click()
  await page.waitForSelector(`${sectionSelector} .test-result`, { state: 'attached' })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('CH17 Replay — SlotClient Acceptance', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test.setTimeout(30000)

  test.beforeEach(async ({ page }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await waitForSections(page)
  })

  // =====================================================================
  // Expectation 1: Default constructor
  // =====================================================================

  test('E1 - Default constructor shows only PASS', async ({ page }) => {
    await expectSectionAllPass(page, '#section-default', 'D1 default constructor')
    await takeScreenshot(page, 'auto-run-full-page')
    await takeSectionScreenshot(page, '#section-default', 'section-default')
  })

  // =====================================================================
  // Expectation 2: SessionClient constructor
  // =====================================================================

  test('E2 - SessionClient constructor shows only PASS', async ({ page }) => {
    await expectSectionAllPass(page, '#section-client', 'D2 SessionClient constructor')
    await takeSectionScreenshot(page, '#section-client', 'section-client')
  })

  // =====================================================================
  // Expectation 3: serialize/deserialize round-trip
  // =====================================================================

  test('E3 - serialize/deserialize round-trip shows only PASS', async ({ page }) => {
    await expectSectionAllPass(page, '#section-serialize', 'D3 serialize/deserialize')
    await takeSectionScreenshot(page, '#section-serialize', 'section-serialize')
  })

  // =====================================================================
  // Expectation 4: applyTo property transfer
  // =====================================================================

  test('E4 - applyTo property transfer shows only PASS', async ({ page }) => {
    await expectSectionAllPass(page, '#section-applyto', 'D4 applyTo')
    await takeSectionScreenshot(page, '#section-applyto', 'section-applyto')
  })

  // =====================================================================
  // Expectation 5: Edge cases
  // =====================================================================

  test('E5 - Edge cases show only PASS', async ({ page }) => {
    await expectSectionAllPass(page, '#section-edge', 'D5 edge cases')
    await takeSectionScreenshot(page, '#section-edge', 'section-edge')
  })

  // =====================================================================
  // Control: Run All button
  // =====================================================================

  test('C1 - Run All button re-runs every section with only PASS', async ({ page }) => {
    await page.locator('#btn-run-all').click()
    await waitForSections(page)

    await expectSectionAllPass(page, '#section-default', 'D1 default constructor')
    await expectSectionAllPass(page, '#section-client', 'D2 SessionClient constructor')
    await expectSectionAllPass(page, '#section-serialize', 'D3 serialize/deserialize')
    await expectSectionAllPass(page, '#section-applyto', 'D4 applyTo')
    await expectSectionAllPass(page, '#section-edge', 'D5 edge cases')

    await takeScreenshot(page, 'run-all-full-page')
  })

  // =====================================================================
  // Control: Individual section buttons
  // =====================================================================

  test('C2 - Default constructor button re-runs with only PASS', async ({ page }) => {
    await clickButtonAndWait(page, '#btn-test-default', '#section-default')
    await expectSectionAllPass(page, '#section-default', 'D1 default constructor')
    await takeSectionScreenshot(page, '#section-default', 'btn-default')
  })

  test('C3 - SessionClient constructor button re-runs with only PASS', async ({ page }) => {
    await clickButtonAndWait(page, '#btn-test-client', '#section-client')
    await expectSectionAllPass(page, '#section-client', 'D2 SessionClient constructor')
    await takeSectionScreenshot(page, '#section-client', 'btn-client')
  })

  test('C4 - Serialize button re-runs with only PASS', async ({ page }) => {
    await clickButtonAndWait(page, '#btn-test-serialize', '#section-serialize')
    await expectSectionAllPass(page, '#section-serialize', 'D3 serialize/deserialize')
    await takeSectionScreenshot(page, '#section-serialize', 'btn-serialize')
  })

  test('C5 - applyTo button re-runs with only PASS', async ({ page }) => {
    await clickButtonAndWait(page, '#btn-test-applyto', '#section-applyto')
    await expectSectionAllPass(page, '#section-applyto', 'D4 applyTo')
    await takeSectionScreenshot(page, '#section-applyto', 'btn-applyto')
  })

  test('C6 - Edge cases button re-runs with only PASS', async ({ page }) => {
    await clickButtonAndWait(page, '#btn-test-edge', '#section-edge')
    await expectSectionAllPass(page, '#section-edge', 'D5 edge cases')
    await takeSectionScreenshot(page, '#section-edge', 'btn-edge')
  })

  // =====================================================================
  // Info bar
  // =====================================================================

  test('I1 - Info bar values are populated', async ({ page }) => {
    const ua = page.locator('#info-ua')
    const viewport = page.locator('#info-viewport')
    const time = page.locator('#info-time')

    await expect(ua).not.toHaveText('-')
    expect((await ua.textContent()) ?? '').toBeTruthy()

    const viewportText = (await viewport.textContent()) ?? ''
    expect(viewportText).toMatch(/^\d+x\d+$/)

    await expect(time).not.toHaveText('-')
    const timeText = (await time.textContent()) ?? ''
    expect(timeText).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

    await takeScreenshot(page, 'info-bar')
  })
})
