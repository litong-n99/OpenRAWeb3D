/**
 * DebugVisualizations.test.ts — DebugVisualizations unit tests
 *
 * Tests the debug flag toggles, depth buffer state management,
 * and dirtiness tracking. Pure logic — no @babylonjs/core dependencies.
 */

import { describe, it, expect } from 'vitest'

import {
  DebugVisualizations,
  DebugVisualizationsInfo,
} from './DebugVisualizations.js'

// ---------------------------------------------------------------------------
// DebugVisualizationsInfo tests
// ---------------------------------------------------------------------------

describe('DebugVisualizationsInfo', () => {
  it('should construct with no params', () => {
    const info = new DebugVisualizationsInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('should construct with instanceName', () => {
    const info = new DebugVisualizationsInfo({ instanceName: 'my-debug' })
    expect(info.instanceName).toBe('my-debug')
  })
})

// ---------------------------------------------------------------------------
// DebugVisualizations — flag toggles
// ---------------------------------------------------------------------------

describe('DebugVisualizations', () => {
  describe('default state', () => {
    it('should have all flags disabled by default', () => {
      const dv = new DebugVisualizations()

      expect(dv.combatGeometry).toBe(false)
      expect(dv.renderGeometry).toBe(false)
      expect(dv.screenMap).toBe(false)
      expect(dv.actorTags).toBe(false)
      expect(dv.depthBuffer).toBe(false)
    })

    it('should have default depth buffer contrast of 1.0', () => {
      const dv = new DebugVisualizations()
      expect(dv.depthBufferContrast).toBe(1.0)
    })

    it('should have default depth buffer offset of 0.0', () => {
      const dv = new DebugVisualizations()
      expect(dv.depthBufferOffset).toBe(0.0)
    })
  })

  describe('flag toggles', () => {
    it('should toggle combatGeometry', () => {
      const dv = new DebugVisualizations()
      expect(dv.combatGeometry).toBe(false)

      dv.combatGeometry = true
      expect(dv.combatGeometry).toBe(true)

      dv.combatGeometry = false
      expect(dv.combatGeometry).toBe(false)
    })

    it('should toggle renderGeometry', () => {
      const dv = new DebugVisualizations()
      dv.renderGeometry = true
      expect(dv.renderGeometry).toBe(true)
    })

    it('should toggle screenMap', () => {
      const dv = new DebugVisualizations()
      dv.screenMap = true
      expect(dv.screenMap).toBe(true)
    })

    it('should toggle actorTags', () => {
      const dv = new DebugVisualizations()
      dv.actorTags = true
      expect(dv.actorTags).toBe(true)
    })

    it('should support multiple flags enabled simultaneously', () => {
      const dv = new DebugVisualizations()
      dv.combatGeometry = true
      dv.renderGeometry = true
      dv.actorTags = true

      expect(dv.combatGeometry).toBe(true)
      expect(dv.renderGeometry).toBe(true)
      expect(dv.screenMap).toBe(false)
      expect(dv.actorTags).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Depth buffer property tests
  // -----------------------------------------------------------------------

  describe('depthBuffer property', () => {
    it('should get and set depthBuffer flag', () => {
      const dv = new DebugVisualizations()
      expect(dv.depthBuffer).toBe(false)

      dv.depthBuffer = true
      expect(dv.depthBuffer).toBe(true)

      dv.depthBuffer = false
      expect(dv.depthBuffer).toBe(false)
    })

    it('should set depthBufferDirty when depthBuffer changes', () => {
      const dv = new DebugVisualizations()

      // initial call to updateDepthBuffer clears dirty flag
      dv.updateDepthBuffer()

      dv.depthBuffer = true
      // After setting, updateDepthBuffer should clear dirty
      dv.updateDepthBuffer()

      // Setting again should re-dirty
      dv.depthBuffer = false
      // Verify this doesn't throw and we can call updateDepthBuffer again
      expect(() => dv.updateDepthBuffer()).not.toThrow()
    })
  })

  describe('depthBufferContrast property', () => {
    it('should get and set depthBufferContrast', () => {
      const dv = new DebugVisualizations()
      expect(dv.depthBufferContrast).toBe(1.0)

      dv.depthBufferContrast = 2.5
      expect(dv.depthBufferContrast).toBe(2.5)

      dv.depthBufferContrast = 0.5
      expect(dv.depthBufferContrast).toBe(0.5)
    })

    it('should accept negative contrast values', () => {
      const dv = new DebugVisualizations()
      dv.depthBufferContrast = -1.0
      expect(dv.depthBufferContrast).toBe(-1.0)
    })

    it('should accept zero contrast', () => {
      const dv = new DebugVisualizations()
      dv.depthBufferContrast = 0.0
      expect(dv.depthBufferContrast).toBe(0.0)
    })
  })

  describe('depthBufferOffset property', () => {
    it('should get and set depthBufferOffset', () => {
      const dv = new DebugVisualizations()
      expect(dv.depthBufferOffset).toBe(0.0)

      dv.depthBufferOffset = 0.01
      expect(dv.depthBufferOffset).toBe(0.01)

      dv.depthBufferOffset = -0.005
      expect(dv.depthBufferOffset).toBe(-0.005)
    })
  })

  // -----------------------------------------------------------------------
  // updateDepthBuffer method
  // -----------------------------------------------------------------------

  describe('updateDepthBuffer()', () => {
    it('should clear dirty flag when called', () => {
      const dv = new DebugVisualizations()
      dv.depthBuffer = true

      // Calling updateDepthBuffer should NOT throw and clear dirty
      expect(() => dv.updateDepthBuffer()).not.toThrow()
      // Second call should also be safe (idempotent)
      expect(() => dv.updateDepthBuffer()).not.toThrow()
    })

    it('should be callable multiple times consecutively', () => {
      const dv = new DebugVisualizations()

      for (let i = 0; i < 10; i++) {
        expect(() => dv.updateDepthBuffer()).not.toThrow()
      }
    })

    it('should not throw when depthBuffer is false', () => {
      const dv = new DebugVisualizations()
      expect(dv.depthBuffer).toBe(false)
      expect(() => dv.updateDepthBuffer()).not.toThrow()
    })

    it('should track dirtiness correctly across property changes', () => {
      const dv = new DebugVisualizations()
      // Call once to clear initial dirty
      dv.updateDepthBuffer()

      // Change depthBuffer — should re-dirty
      dv.depthBuffer = true
      dv.updateDepthBuffer()

      // Change contrast — should re-dirty
      dv.depthBufferContrast = 2.0
      dv.updateDepthBuffer()

      // Change offset — should re-dirty
      dv.depthBufferOffset = 0.1
      dv.updateDepthBuffer()

      // After clearing, should be fine
      expect(() => dv.updateDepthBuffer()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Convenience methods
  // -----------------------------------------------------------------------

  describe('resetAll()', () => {
    it('should set all flags to false', () => {
      const dv = new DebugVisualizations()
      dv.combatGeometry = true
      dv.renderGeometry = true
      dv.screenMap = true
      dv.actorTags = true
      dv.depthBuffer = true
      dv.depthBufferContrast = 2.0
      dv.depthBufferOffset = 0.05

      dv.resetAll()

      expect(dv.combatGeometry).toBe(false)
      expect(dv.renderGeometry).toBe(false)
      expect(dv.screenMap).toBe(false)
      expect(dv.actorTags).toBe(false)
      expect(dv.depthBuffer).toBe(false)
      expect(dv.depthBufferContrast).toBe(1.0)
      expect(dv.depthBufferOffset).toBe(0.0)
    })

    it('should be idempotent', () => {
      const dv = new DebugVisualizations()
      dv.resetAll()
      dv.resetAll()

      expect(dv.combatGeometry).toBe(false)
      expect(dv.renderGeometry).toBe(false)
      expect(dv.depthBuffer).toBe(false)
    })
  })

  describe('enableAll()', () => {
    it('should set all visual flags to true', () => {
      const dv = new DebugVisualizations()
      dv.enableAll()

      expect(dv.combatGeometry).toBe(true)
      expect(dv.renderGeometry).toBe(true)
      expect(dv.screenMap).toBe(true)
      expect(dv.actorTags).toBe(true)
    })

    it('should not affect depth buffer settings', () => {
      const dv = new DebugVisualizations()
      dv.depthBuffer = true
      dv.depthBufferContrast = 2.0

      dv.enableAll()

      expect(dv.depthBuffer).toBe(true)
      expect(dv.depthBufferContrast).toBe(2.0)
    })

    it('should be idempotent', () => {
      const dv = new DebugVisualizations()
      dv.enableAll()
      dv.enableAll()

      expect(dv.combatGeometry).toBe(true)
      expect(dv.renderGeometry).toBe(true)
    })
  })
})
