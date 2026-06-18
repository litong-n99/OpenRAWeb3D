/**
 * CustomTerrainDebugOverlay.test.ts — CustomTerrainDebugOverlay unit tests
 *
 * Tests the custom terrain debug overlay's state management, command handling,
 * and interface contract. Pure logic — no @babylonjs/core dependencies.
 */

import { describe, it, expect } from 'vitest'

import {
  CustomTerrainDebugOverlay,
  CustomTerrainDebugOverlayInfo,
  type IChatCommandStub,
} from './CustomTerrainDebugOverlay.js'
import type {
  IWorldLoaded,
  IRenderAnnotations,
  WorldStub,
  WorldRendererStub,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInfo(font?: string): CustomTerrainDebugOverlayInfo {
  return new CustomTerrainDebugOverlayInfo({ font })
}

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlayInfo tests
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlayInfo', () => {
  it('should have default font "TinyBold"', () => {
    const info = new CustomTerrainDebugOverlayInfo()
    expect(info.font).toBe('TinyBold')
  })

  it('should accept custom font', () => {
    const info = new CustomTerrainDebugOverlayInfo({ font: 'Bold' })
    expect(info.font).toBe('Bold')
  })

  it('should accept instanceName', () => {
    const info = new CustomTerrainDebugOverlayInfo({
      instanceName: 'my-debug',
      font: 'Small',
    })
    expect(info.instanceName).toBe('my-debug')
    expect(info.font).toBe('Small')
  })

  it('should have undefined instanceName by default', () => {
    const info = new CustomTerrainDebugOverlayInfo()
    expect(info.instanceName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay — constants
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlay constants', () => {
  it('should have CommandName "custom-terrain"', () => {
    expect(CustomTerrainDebugOverlay.CommandName).toBe('custom-terrain')
  })

  it('should have OrderName "DevCustomTerrain"', () => {
    expect(CustomTerrainDebugOverlay.OrderName).toBe('DevCustomTerrain')
  })
})

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay — construction
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlay construction', () => {
  it('should construct with default font', () => {
    const info = createInfo()
    const overlay = new CustomTerrainDebugOverlay(info)

    expect(overlay.enabled).toBe(false)
    expect(overlay.spatiallyPartitionable).toBe(false)
  })

  it('should construct with custom font name', () => {
    const info = new CustomTerrainDebugOverlayInfo({ font: 'BigBold' })
    const overlay = new CustomTerrainDebugOverlay(info)

    expect(overlay.enabled).toBe(false)
    expect(overlay.spatiallyPartitionable).toBe(false)
  })

  it('should implement IWorldLoaded', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    // Type guard check: the class should satisfy the interface
    expect(typeof (overlay as IWorldLoaded).worldLoaded).toBe('function')
  })

  it('should implement IChatCommandStub', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    expect(typeof (overlay as IChatCommandStub).invokeCommand).toBe('function')
  })

  it('should implement IRenderAnnotations', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    const ra = overlay as IRenderAnnotations
    expect(typeof ra.renderAnnotations).toBe('function')
    expect(ra.spatiallyPartitionable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay — enabled toggle and invokeCommand
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlay invokeCommand', () => {
  it('should start with enabled = false', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    expect(overlay.enabled).toBe(false)
  })

  it('should not toggle for non-matching command name', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    overlay.invokeCommand('other-command', '')
    expect(overlay.enabled).toBe(false)

    overlay.invokeCommand('', '')
    expect(overlay.enabled).toBe(false)
  })

  it('should not toggle when DeveloperMode is missing', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    overlay.invokeCommand('custom-terrain', '')
    expect(overlay.enabled).toBe(false)
  })

  it('should toggle enabled when DeveloperMode is enabled', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    // Simulate worldLoaded with DeveloperMode via internal state bypass
    // We need to test the actual toggle logic directly
    const mockWorld = {
      localPlayer: {
        playerActor: {
          trait: (_name: string) => ({ enabled: true }),
        },
      },
    } as any as WorldStub

    const mockWr = {} as WorldRendererStub
    overlay.worldLoaded(mockWorld, mockWr)

    // Now invokeCommand should succeed because dev mode is available
    overlay.invokeCommand('custom-terrain', '')

    // Verify toggled
    expect(overlay.enabled).toBe(true)
  })

  it('should toggle back to false on second invocation', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    const mockWorld = {
      localPlayer: {
        playerActor: {
          trait: (_name: string) => ({ enabled: true }),
        },
      },
    } as any as WorldStub

    overlay.worldLoaded(mockWorld, {} as WorldRendererStub)

    // First toggle: on
    overlay.invokeCommand('custom-terrain', '')
    expect(overlay.enabled).toBe(true)

    // Second toggle: off
    overlay.invokeCommand('custom-terrain', '')
    expect(overlay.enabled).toBe(false)
  })

  it('should not toggle when dev mode is disabled', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    const mockWorld = {
      localPlayer: {
        playerActor: {
          trait: (_name: string) => ({ enabled: false }),
        },
      },
    } as any as WorldStub

    overlay.worldLoaded(mockWorld, {} as WorldRendererStub)

    overlay.invokeCommand('custom-terrain', '')
    expect(overlay.enabled).toBe(false)
  })

  it('should not throw when invokeCommand called before worldLoaded', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    expect(() => {
      overlay.invokeCommand('custom-terrain', '')
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay — worldLoaded
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlay worldLoaded', () => {
  it('should not throw when worldLoaded is called', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    const mockWorld = {} as WorldStub
    const mockWr = {} as WorldRendererStub

    expect(() => overlay.worldLoaded(mockWorld, mockWr)).not.toThrow()
  })

  it('should handle world without localPlayer gracefully', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    const mockWorld = {} as WorldStub
    const mockWr = {} as WorldRendererStub

    expect(() => overlay.worldLoaded(mockWorld, mockWr)).not.toThrow()

    // Verify invokeCommand works (won't toggle without dev mode)
    overlay.invokeCommand('custom-terrain', '')
    expect(overlay.enabled).toBe(false)
  })

  it('should handle world with null localPlayer', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    const mockWorld = { localPlayer: null } as any as WorldStub
    const mockWr = {} as WorldRendererStub

    expect(() => overlay.worldLoaded(mockWorld, mockWr)).not.toThrow()
  })

  it('should handle world with playerActor that has no trait function', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    const mockWorld = {
      localPlayer: { playerActor: {} },
    } as any as WorldStub

    expect(() => overlay.worldLoaded(mockWorld, {} as WorldRendererStub)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay — renderAnnotations
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlay renderAnnotations', () => {
  it('should return empty array when disabled', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    expect(overlay.enabled).toBe(false)

    const mockActor = {} as IGameActor
    const mockWr = {} as WorldRendererStub

    const result = overlay.renderAnnotations(mockActor, mockWr)
    expect(result).toEqual([])
  })

  it('should return empty array when enabled (no rendering yet)', () => {
    // Set up overlay with dev mode enabled
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    const mockWorld = {
      localPlayer: {
        playerActor: {
          trait: (_name: string) => ({ enabled: true }),
        },
      },
    } as any as WorldStub

    overlay.worldLoaded(mockWorld, {} as WorldRendererStub)
    overlay.invokeCommand('custom-terrain', '')
    expect(overlay.enabled).toBe(true)

    const result = overlay.renderAnnotations({} as IGameActor, {} as WorldRendererStub)
    // Currently returns empty array (TODO: full rendering not yet implemented)
    expect(result).toEqual([])
  })

  it('should be callable without worldLoaded', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    // Even when enabled but no world loaded, should not throw
    expect(() => {
      overlay.renderAnnotations({} as IGameActor, {} as WorldRendererStub)
    }).not.toThrow()
  })

  it('should not throw with null-ish actor/wr', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    expect(() => {
      overlay.renderAnnotations(null as any, null as any)
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay — spatiallyPartitionable
// ---------------------------------------------------------------------------

describe('CustomTerrainDebugOverlay spatiallyPartitionable', () => {
  it('should always return false', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())
    expect(overlay.spatiallyPartitionable).toBe(false)

    // Even after worldLoaded
    const mockWorld = {
      localPlayer: {
        playerActor: { trait: (_n: string) => ({ enabled: true }) },
      },
    } as any as WorldStub

    overlay.worldLoaded(mockWorld, {} as WorldRendererStub)
    expect(overlay.spatiallyPartitionable).toBe(false)
  })

  it('should be readonly (getter)', () => {
    const overlay = new CustomTerrainDebugOverlay(createInfo())

    // The getter should always return the same value
    const val1 = overlay.spatiallyPartitionable
    const val2 = overlay.spatiallyPartitionable
    expect(val1).toBe(val2)
    expect(val1).toBe(false)
  })
})
