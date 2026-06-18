/**
 * DebugChromeRegions.test.ts — DebugChromeRegions unit tests
 *
 * Tests: IUtilityCommand contract, buildChromeDebugPage HTML generation,
 * generatePanelSides region calculation, ChromeRegion interface.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DebugChromeRegions,
  generatePanelSides,
  buildChromeDebugPage,
  type ChromeRegion,
} from './DebugChromeRegions.js'
import { ChromeProvider, PanelSides } from '../../OpenRA.Game/Graphics/ChromeProvider.js'
import type { IUtilityCommand } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// IUtilityCommand contract
// ---------------------------------------------------------------------------

describe('DebugChromeRegions — IUtilityCommand contract', () => {
  const command = new DebugChromeRegions()

  it('should have correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--debug-chrome-regions')
  })

  it('should validate exactly 3 arguments', () => {
    expect(command.validateArguments(['--debug-chrome-regions', 'image.png', '2'])).toBe(true)
  })

  it('should reject fewer than 3 arguments', () => {
    expect(command.validateArguments(['--debug-chrome-regions', 'image.png'])).toBe(false)
    expect(command.validateArguments(['--debug-chrome-regions'])).toBe(false)
  })

  it('should reject more than 3 arguments', () => {
    expect(
      command.validateArguments([
        '--debug-chrome-regions',
        'image.png',
        '2',
        'extra',
      ]),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generatePanelSides
// ---------------------------------------------------------------------------

describe('generatePanelSides', () => {
  it('should return empty for invalid panel region', () => {
    const result = generatePanelSides('test', [0, 0, 10], PanelSides.All)
    expect(result).toEqual([])
  })

  it('should return empty for null-like panel region', () => {
    const result = generatePanelSides('test', [], PanelSides.All)
    expect(result).toEqual([])
  })

  it('should generate 9 sides when PanelSides.All', () => {
    const pr = [0, 0, 10, 10, 80, 80, 10, 10] // Simple 9-slice
    const result = generatePanelSides('dialog', pr, PanelSides.All)

    expect(result).toHaveLength(9)
    // Verify some specific sides
    const names = result.map((r) => r.name)
    expect(names).toContain('dialog.<Top, Left>')
    expect(names).toContain('dialog.<Top>')
    expect(names).toContain('dialog.<Top, Right>')
    expect(names).toContain('dialog.<Left>')
    expect(names).toContain('dialog.<Center>')
    expect(names).toContain('dialog.<Right>')
    expect(names).toContain('dialog.<Bottom, Left>')
    expect(names).toContain('dialog.<Bottom>')
    expect(names).toContain('dialog.<Bottom, Right>')
  })

  it('should only include sides matching the bitmask', () => {
    const pr = [0, 0, 10, 10, 80, 80, 10, 10]
    // hasSide checks if (collectionSides & entrySides) === entrySides
    // With Top|Bottom: Top entry matches, Bottom entry matches,
    // but Top|Left does NOT match because Top|Bottom doesn't include Left.
    const result = generatePanelSides(
      'p',
      pr,
      PanelSides.Top | PanelSides.Bottom,
    )

    // Only pure Top and pure Bottom sides match (no Left, Right combinations)
    const names = result.map((r) => r.name)
    expect(names).toContain('p.<Top>')
    expect(names).toContain('p.<Bottom>')
    // Combinations require both sides to be in the mask, so these are excluded
    expect(names).not.toContain('p.<Top, Left>')
    expect(names).not.toContain('p.<Top, Right>')
    expect(names).not.toContain('p.<Bottom, Left>')
    expect(names).not.toContain('p.<Bottom, Right>')
    expect(names).not.toContain('p.<Left>')
    expect(names).not.toContain('p.<Center>')
    expect(names).not.toContain('p.<Right>')
  })

  it('should calculate correct coordinates for regions', () => {
    // PanelRegion: [x=5, y=10, wTL=20, hTop=15, wC=100, hC=80, wBR=20, hBottom=15]
    const pr = [5, 10, 20, 15, 100, 80, 20, 15]
    const result = generatePanelSides('chrome', pr, PanelSides.Center)

    expect(result).toHaveLength(1) // Only Center
    const center = result[0]
    expect(center.name).toBe('chrome.<Center>')
    // x = pr[0] + pr[2] = 5 + 20 = 25
    expect(center.x).toBe(25)
    // y = pr[1] + pr[3] = 10 + 15 = 25
    expect(center.y).toBe(25)
    expect(center.width).toBe(100)
    expect(center.height).toBe(80)
  })

  it('should calculate Top-Left corner correctly', () => {
    const pr = [5, 10, 20, 15, 100, 80, 20, 15]
    const result = generatePanelSides('chrome', pr, PanelSides.Top | PanelSides.Left)

    const tl = result.find((r) => r.name === 'chrome.<Top, Left>')
    expect(tl).toBeDefined()
    expect(tl!.x).toBe(5)
    expect(tl!.y).toBe(10)
    expect(tl!.width).toBe(20)
    expect(tl!.height).toBe(15)
  })

  it('should calculate Bottom-Right corner correctly', () => {
    const pr = [5, 10, 20, 15, 100, 80, 20, 15]
    const result = generatePanelSides('chrome', pr, PanelSides.Bottom | PanelSides.Right)

    const br = result.find((r) => r.name === 'chrome.<Bottom, Right>')
    expect(br).toBeDefined()
    // x = pr[0] + pr[2] + pr[4] = 5 + 20 + 100 = 125
    expect(br!.x).toBe(125)
    // y = pr[1] + pr[3] + pr[5] = 10 + 15 + 80 = 105
    expect(br!.y).toBe(105)
    expect(br!.width).toBe(20)
    expect(br!.height).toBe(15)
  })

  it('should handle edges-only mask', () => {
    const pr = [0, 0, 10, 10, 80, 80, 10, 10]
    const result = generatePanelSides('frame', pr, PanelSides.Edges)

    // Edges = Left | Top | Right | Bottom (no Center)
    expect(result).toHaveLength(8) // 9 total minus Center = 8
    const names = result.map((r) => r.name)
    expect(names).not.toContain('frame.<Center>')
    expect(names).toContain('frame.<Left>')
    expect(names).toContain('frame.<Top>')
    expect(names).toContain('frame.<Right>')
    expect(names).toContain('frame.<Bottom>')
  })

  it('should return empty when no sides match', () => {
    const pr = [0, 0, 10, 10, 80, 80, 10, 10]
    // Check with a mask that has no overlap — all sides are 0-15 but let's test with 0
    const result = generatePanelSides('empty', pr, 0)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildChromeDebugPage
// ---------------------------------------------------------------------------

describe('buildChromeDebugPage', () => {
  it('should generate valid HTML', () => {
    const regions: ChromeRegion[] = [
      { name: 'button.default', x: 0, y: 0, width: 64, height: 32 },
      { name: 'button.hover', x: 64, y: 0, width: 64, height: 32 },
    ]
    const html = buildChromeDebugPage(2, 'ABC123', regions)

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html>')
    expect(html).toContain('</html>')
    expect(html).toContain('<canvas id="canvas"')
  })

  it('should embed zoom value', () => {
    const html = buildChromeDebugPage(3, 'test', [])
    expect(html).toContain('var zoom = 3;')
  })

  it('should embed base64 image data', () => {
    const html = buildChromeDebugPage(1, 'iVBORw0KGgo=', [])
    expect(html).toContain('iVBORw0KGgo=')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
  })

  it('should embed regions as JSON array', () => {
    const regions: ChromeRegion[] = [
      { name: 'btn.a', x: 10, y: 20, width: 30, height: 40 },
    ]
    const html = buildChromeDebugPage(1, 'd', regions)

    // Should contain the JSON array format: [name, x, y, width, height]
    expect(html).toContain('"btn.a"')
    expect(html).toContain(',10,20,30,40')
  })

  it('should handle empty regions', () => {
    const html = buildChromeDebugPage(2, 'img', [])
    expect(html).toContain('var chromeRegions = []')
  })

  it('should include event listener for mousemove', () => {
    const html = buildChromeDebugPage(1, 'img', [])
    expect(html).toContain("addEventListener('mousemove'")
    expect(html).toContain('console.log(mouseover)')
  })

  it('should include checkerboard background pattern', () => {
    const html = buildChromeDebugPage(1, 'img', [])
    expect(html).toContain('fillStyle = "#dddddd"')
    expect(html).toContain('fillRect(4 * i, 4 * j, 4, 4)')
  })

  it('should end with setup call on window.onload', () => {
    const html = buildChromeDebugPage(1, 'img', [])
    expect(html).toContain('window.onload = setup;')
  })
})

// ---------------------------------------------------------------------------
// generatePage — end-to-end with ChromeProvider
// ---------------------------------------------------------------------------

describe('DebugChromeRegions — generatePage', () => {
  const command = new DebugChromeRegions()

  beforeEach(() => {
    // Reset ChromeProvider state
    ChromeProvider.deinitialize()
    // Populate with mock data
    ChromeProvider['_collections'].set('button', {
      image: 'chrome.png',
      image2x: null,
      image3x: null,
      panelRegion: null,
      panelSides: PanelSides.All,
      regions: new Map([
        ['default', { x: 0, y: 0, width: 64, height: 32 }],
        ['hover', { x: 64, y: 0, width: 64, height: 32 }],
      ]),
    } as any)
    ChromeProvider['_initialized'] = true
  })

  it('should generate page with regions from matching image', () => {
    const html = command.generatePage('chrome.png', 2, 'fakebase64')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('var zoom = 2;')
    expect(html).toContain('fakebase64')
    // Should contain both region names
    expect(html).toContain('button.default')
    expect(html).toContain('button.hover')
  })

  it('should return empty regions for non-matching image', () => {
    const html = command.generatePage('other.png', 1, 'img')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('var chromeRegions = []')
  })

  it('should include panel sides for matching collections with PanelRegion', () => {
    // Add a collection with PanelRegion
    ChromeProvider['_collections'].set('dialog', {
      image: 'chrome.png',
      image2x: null,
      image3x: null,
      panelRegion: { region: [0, 0, 10, 10, 80, 80, 10, 10], sides: PanelSides.All },
      panelSides: PanelSides.All,
      regions: new Map(),
    } as any)

    const html = command.generatePage('chrome.png', 1, 'img')

    // Should include all 9 panel sides
    expect(html).toContain('dialog.<Center>')
    expect(html).toContain('dialog.<Top, Left>')
    expect(html).toContain('dialog.<Bottom, Right>')
  })
})

// ---------------------------------------------------------------------------
// ChromeRegion interface
// ---------------------------------------------------------------------------

describe('ChromeRegion interface', () => {
  it('should support constructing region objects', () => {
    const region: ChromeRegion = {
      name: 'dialog2.close',
      x: 128,
      y: 0,
      width: 32,
      height: 32,
    }
    expect(region.name).toBe('dialog2.close')
    expect(region.x).toBe(128)
    expect(region.width).toBe(32)
  })
})
