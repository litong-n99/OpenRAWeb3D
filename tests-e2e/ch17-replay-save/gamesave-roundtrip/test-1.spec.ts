import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results',
  'manual',
  'ch17-replay-save',
  'gamesave-roundtrip',
  'evidence'
)

test.describe('GameSave Binary Format Round-Trip Acceptance', () => {
  test.beforeEach(async ({ page }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

    await page.goto('/test/ch17-replay-save/gamesave-roundtrip/', {
      waitUntil: 'domcontentloaded',
    })

    // Wait for the auto-run tests to populate the sections.
    await Promise.all([
      page.waitForSelector('#section-empty .test-result', { state: 'attached' }),
      page.waitForSelector('#section-startgame .test-result', { state: 'attached' }),
      page.waitForSelector('#section-dispatch .test-result', { state: 'attached' }),
      page.waitForSelector('#section-serialize .test-result', { state: 'attached' }),
      page.waitForSelector('#section-roundtrip .test-result', { state: 'attached' }),
      page.waitForSelector('#section-traits .test-result', { state: 'attached' }),
      page.waitForSelector('#section-hex .hex-dump', { state: 'attached' }),
    ])
  })

  async function expectSectionAllPass(
    page: Page,
    sectionSelector: string,
    label: string,
  ): Promise<void> {
    const section = page.locator(sectionSelector)
    const failCount = await section.locator('.test-result .fail').count()
    expect(failCount, `${label} must not contain any FAIL markers`).toBe(0)

    const passCount = await section.locator('.test-result .pass').count()
    expect(passCount, `${label} must contain at least one PASS marker`).toBeGreaterThan(0)
  }

  test('page loads and auto-run completes', async ({ page }) => {
    await expect(page.locator('#section-empty')).toBeVisible()
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-1-autorun-full-page.png'),
      fullPage: true,
    })
  })

  test('E1: Empty GameSave initial state passes', async ({ page }) => {
    await expectSectionAllPass(page, '#section-empty', 'D1 Empty GameSave')
  })

  test('E2: startGame configuration snapshot passes', async ({ page }) => {
    await expectSectionAllPass(page, '#section-startgame', 'D2 startGame snapshot')
  })

  test('E3: dispatchOrders recording passes', async ({ page }) => {
    await expectSectionAllPass(page, '#section-dispatch', 'D3 dispatchOrders')
  })

  test('E4: save() binary output format passes', async ({ page }) => {
    await expectSectionAllPass(page, '#section-serialize', 'D4 save() binary format')
  })

  test('E5: Load round-trip field comparison passes', async ({ page }) => {
    await expectSectionAllPass(page, '#section-roundtrip', 'D5 load round-trip')
  })

  test('D6: addTraitData + parseOrders verification passes', async ({ page }) => {
    await expectSectionAllPass(page, '#section-traits', 'D6 trait data / parseOrders')
  })

  test('D7: .orasav tail hex dump is present and non-empty', async ({ page }) => {
    const hexDump = page.locator('#section-hex .hex-dump')
    await expect(hexDump, 'D7 hex dump element should be visible').toBeVisible()

    const text = await hexDump.textContent()
    expect(text?.trim().length ?? 0, 'D7 hex dump should contain data').toBeGreaterThan(0)

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-2-hex-dump.png'),
      fullPage: true,
    })
  })

  test.describe('Individual button clicks', () => {
    async function expectAllSectionsPass(page: Page): Promise<void> {
      await expectSectionAllPass(page, '#section-empty', 'D1 Empty GameSave')
      await expectSectionAllPass(page, '#section-startgame', 'D2 startGame snapshot')
      await expectSectionAllPass(page, '#section-dispatch', 'D3 dispatchOrders')
      await expectSectionAllPass(page, '#section-serialize', 'D4 save() binary format')
      await expectSectionAllPass(page, '#section-roundtrip', 'D5 load round-trip')
      await expectSectionAllPass(page, '#section-traits', 'D6 trait data / parseOrders')
    }

    test('Run All button re-runs all tests successfully', async ({ page }) => {
      await page.locator('#btn-run-all').click()
      await expectAllSectionsPass(page)
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'screenshot-3-after-run-all.png'),
        fullPage: true,
      })
    })

    test('Empty GameSave button re-runs D1 successfully', async ({ page }) => {
      await page.locator('#btn-test-empty').click()
      await expectSectionAllPass(page, '#section-empty', 'D1 Empty GameSave')
    })

    test('startGame button re-runs D2 successfully', async ({ page }) => {
      await page.locator('#btn-test-startgame').click()
      await expectSectionAllPass(page, '#section-startgame', 'D2 startGame snapshot')
    })

    test('dispatchOrders button re-runs D3 successfully', async ({ page }) => {
      await page.locator('#btn-test-dispatch').click()
      await page.waitForSelector('#section-dispatch .test-result .pass', { state: 'attached' })
      await expectSectionAllPass(page, '#section-dispatch', 'D3 dispatchOrders')
    })

    test('serialize button re-runs D4 and D5 successfully', async ({ page }) => {
      await page.locator('#btn-test-serialize').click()
      await page.waitForSelector('#section-serialize .test-result .pass', { state: 'attached' })
      await page.waitForSelector('#section-roundtrip .test-result .pass', { state: 'attached' })
      await expectSectionAllPass(page, '#section-serialize', 'D4 save() binary format')
      await expectSectionAllPass(page, '#section-roundtrip', 'D5 load round-trip')
    })
  })

  test('info bar captures UA, viewport and timestamp', async ({ page }) => {
    const ua = await page.locator('#info-ua').textContent()
    const viewport = await page.locator('#info-viewport').textContent()
    const time = await page.locator('#info-time').textContent()

    expect(ua, 'User-Agent should be populated').not.toBe('-')
    expect(ua, 'User-Agent should be non-empty').toBeTruthy()
    expect(viewport, 'Viewport should be in WIDTHxHEIGHT format').toMatch(/^\d+x\d+$/)
    expect(time, 'Timestamp should be an ISO-8601 string').toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const info = { ua: ua ?? '', viewport: viewport ?? '', time: time ?? '' }
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'ch17-gamesave-roundtrip-info-bar.json'),
      JSON.stringify(info, null, 2),
    )
  })

  test('invalid URL returns a 404 or error response', async ({ page }) => {
    const response = await page.goto('/test/ch17-replay-save/gamesave-roundtrip-invalid/', {
      waitUntil: 'domcontentloaded',
    })

    const status = response?.status() ?? 0
    const testSectionCount = await page.locator('#section-empty').count()

    // The dev server may return a 404 or fall back to the SPA root.
    expect(
      status === 404 || testSectionCount === 0,
      'Invalid URL should return 404 or fail to render the test page',
    ).toBe(true)

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-4-invalid-url.png'),
      fullPage: true,
    })
  })
})
