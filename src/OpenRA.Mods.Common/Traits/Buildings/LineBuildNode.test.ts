/**
 * LineBuildNode.test.ts — LineBuildNode migration unit tests
 *
 * Tests focus on: LineBuildNodeInfo configuration, default values,
 * Types Set semantics, Connections array configuration.
 */

import { describe, it, expect } from 'vitest'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import { LineBuildNodeInfo, LineBuildNode } from './LineBuildNode.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LineBuildNodeInfo', () => {
  it('has correct default values', () => {
    const info = new LineBuildNodeInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.types).toEqual(new Set(['wall']))
    expect(info.types.has('wall')).toBe(true)
    expect(info.connections).toHaveLength(4)
    expect(info.connections[0]).toEqual(new CVec(1, 0))
    expect(info.connections[1]).toEqual(new CVec(0, 1))
    expect(info.connections[2]).toEqual(new CVec(-1, 0))
    expect(info.connections[3]).toEqual(new CVec(0, -1))
  })

  it('accepts custom types', () => {
    const info = new LineBuildNodeInfo({ types: ['fence', 'hedge'] })
    expect(info.types.has('fence')).toBe(true)
    expect(info.types.has('hedge')).toBe(true)
    expect(info.types.has('wall')).toBe(false)
    expect(info.types.size).toBe(2)
  })

  it('accepts custom connections', () => {
    const customConnections = [
      new CVec(1, 0),
      new CVec(0, 1),
    ]
    const info = new LineBuildNodeInfo({ connections: customConnections })
    expect(info.connections).toHaveLength(2)
    expect(info.connections[0]).toEqual(new CVec(1, 0))
    expect(info.connections[1]).toEqual(new CVec(0, 1))
  })

  it('accepts instanceName', () => {
    const info = new LineBuildNodeInfo({ instanceName: 'node-1' })
    expect(info.instanceName).toBe('node-1')
  })

  it('empty Set for types when no defaults given', () => {
    const info = new LineBuildNodeInfo({ types: [] })
    expect(info.types.size).toBe(0)
  })

  it('types is a Set with has() semantics', () => {
    const info = new LineBuildNodeInfo({ types: ['wall', 'gate'] })
    expect(info.types.has('wall')).toBe(true)
    expect(info.types.has('gate')).toBe(true)
    expect(info.types.has('fence')).toBe(false)
  })

  it('default connections are four cardinal directions', () => {
    const info = new LineBuildNodeInfo()
    const directions = info.connections.map((c) => ({ x: c.X, y: c.Y }))
    expect(directions).toContainEqual({ x: 1, y: 0 })
    expect(directions).toContainEqual({ x: 0, y: 1 })
    expect(directions).toContainEqual({ x: -1, y: 0 })
    expect(directions).toContainEqual({ x: 0, y: -1 })
  })
})

describe('LineBuildNode', () => {
  it('is constructible as empty marker trait', () => {
    const node = new LineBuildNode()
    expect(node).toBeInstanceOf(LineBuildNode)
  })

  it('has no public properties', () => {
    const node = new LineBuildNode()
    const keys = Object.keys(node)
    expect(keys).toEqual([])
  })
})
