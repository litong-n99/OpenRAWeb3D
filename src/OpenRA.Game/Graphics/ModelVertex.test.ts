/**
 * ModelVertex.test.ts — ModelVertex structure and vertex layout tests
 */

import { describe, it, expect } from 'vitest'
import {
  MODEL_VERTEX_SIZE,
  MODEL_VERTEX_FLOATS,
  MODEL_VERTEX_ATTRIBUTES,
  type ModelVertex,
} from './ModelVertex'

describe('ModelVertex', () => {
  describe('type shape', () => {
    it('allows creating a ModelVertex structurally', () => {
      const v: ModelVertex = {
        x: 1, y: 2, z: 3,
        s: 0, t: 0.5, u: 0, v: 0.5,
        p: 0.75, c: -0.25,
      }
      expect(v.x).toBe(1)
      expect(v.y).toBe(2)
      expect(v.z).toBe(3)
      expect(v.s).toBe(0)
      expect(v.t).toBe(0.5)
      expect(v.p).toBe(0.75)
    })
  })

  describe('constants', () => {
    it('MODEL_VERTEX_SIZE is 36 bytes', () => {
      expect(MODEL_VERTEX_SIZE).toBe(36)
    })

    it('MODEL_VERTEX_FLOATS is 9', () => {
      expect(MODEL_VERTEX_FLOATS).toBe(9)
    })

    it('MODEL_VERTEX_SIZE equals FLOATS * 4', () => {
      expect(MODEL_VERTEX_SIZE).toBe(MODEL_VERTEX_FLOATS * 4)
    })
  })

  describe('vertex attributes', () => {
    it('has 3 attribute descriptors', () => {
      expect(MODEL_VERTEX_ATTRIBUTES).toHaveLength(3)
    })

    it('position attribute has size 3 and offset 0', () => {
      expect(MODEL_VERTEX_ATTRIBUTES[0].name).toBe('position')
      expect(MODEL_VERTEX_ATTRIBUTES[0].size).toBe(3)
      expect(MODEL_VERTEX_ATTRIBUTES[0].offset).toBe(0)
    })

    it('uv attribute has size 4 and offset 12', () => {
      expect(MODEL_VERTEX_ATTRIBUTES[1].name).toBe('uv')
      expect(MODEL_VERTEX_ATTRIBUTES[1].size).toBe(4)
      expect(MODEL_VERTEX_ATTRIBUTES[1].offset).toBe(12)
    })

    it('uv2 attribute has size 2 and offset 28', () => {
      expect(MODEL_VERTEX_ATTRIBUTES[2].name).toBe('uv2')
      expect(MODEL_VERTEX_ATTRIBUTES[2].size).toBe(2)
      expect(MODEL_VERTEX_ATTRIBUTES[2].offset).toBe(28)
    })

    it('all attributes have valid offsets within 36 bytes', () => {
      for (const attr of MODEL_VERTEX_ATTRIBUTES) {
        const attrSize = attr.size * 4 // float = 4 bytes
        expect(attr.offset + attrSize).toBeLessThanOrEqual(MODEL_VERTEX_SIZE)
      }
    })

    it('attributes do not overlap', () => {
      const ranges = MODEL_VERTEX_ATTRIBUTES.map(attr => ({
        start: attr.offset,
        end: attr.offset + attr.size * 4,
      }))
      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          expect(ranges[i].end <= ranges[j].start || ranges[j].end <= ranges[i].start).toBe(true)
        }
      }
    })
  })
})
