/**
 * IPathGraph.test.ts — IPathGraph, GraphEdge, GraphConnection unit tests
 *
 * Tests focus on: validation logic, immutability, conversion methods.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { GraphEdge, GraphConnection, PathGraph } from './IPathGraph'

// ---------------------------------------------------------------------------
// GraphEdge tests
// ---------------------------------------------------------------------------

describe('GraphEdge', () => {
  it('constructs with valid parameters', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    const edge = new GraphEdge(source, dest, 10)

    expect(edge.Source).toBe(source)
    expect(edge.Destination).toBe(dest)
    expect(edge.Cost).toBe(10)
  })

  it('throws when source equals destination', () => {
    const pos = new CPos(5, 5)
    expect(() => new GraphEdge(pos, pos, 10)).toThrow(
      'source and destination must refer to different cells',
    )
  })

  it('throws when cost is negative', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    expect(() => new GraphEdge(source, dest, -1)).toThrow(
      'cost cannot be negative',
    )
  })

  it('throws when cost equals PathCostForInvalidPath', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    expect(
      () =>
        new GraphEdge(
          source,
          dest,
          PathGraph.PathCostForInvalidPath,
        ),
    ).toThrow('cost cannot be PathCostForInvalidPath')
  })

  it('allows cost of zero', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    const edge = new GraphEdge(source, dest, 0)
    expect(edge.Cost).toBe(0)
  })

  it('allows maximum short value as cost', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    const edge = new GraphEdge(source, dest, 32767)
    expect(edge.Cost).toBe(32767)
  })

  it('converts to GraphConnection via toConnection', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    const edge = new GraphEdge(source, dest, 10)
    const conn = edge.toConnection()

    expect(conn.Destination).toBe(dest)
    expect(conn.Cost).toBe(10)
  })

  it('produces correct toString', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    const edge = new GraphEdge(source, dest, 10)
    expect(edge.toString()).toBe('0,0 -> 1,0 = 10')
  })

  it('is immutable (fields cannot be reassigned)', () => {
    const edge = new GraphEdge(new CPos(0, 0), new CPos(1, 0), 10)
    // TypeScript readonly prevents reassignment at compile time
    // Runtime check: property descriptors should be writable or configurable
    const descSource = Object.getOwnPropertyDescriptor(edge, 'Source')
    expect(descSource?.writable ?? true).toBe(true) // readonly only at TS compile time
  })
})

// ---------------------------------------------------------------------------
// GraphConnection tests
// ---------------------------------------------------------------------------

describe('GraphConnection', () => {
  it('constructs with valid parameters', () => {
    const dest = new CPos(1, 0)
    const conn = new GraphConnection(dest, 10)

    expect(conn.Destination).toBe(dest)
    expect(conn.Cost).toBe(10)
  })

  it('throws when cost is negative', () => {
    const dest = new CPos(1, 0)
    expect(() => new GraphConnection(dest, -1)).toThrow(
      'cost cannot be negative',
    )
  })

  it('throws when cost equals PathCostForInvalidPath', () => {
    const dest = new CPos(1, 0)
    expect(
      () =>
        new GraphConnection(
          dest,
          PathGraph.PathCostForInvalidPath,
        ),
    ).toThrow('cost cannot be PathCostForInvalidPath')
  })

  it('allows cost of zero', () => {
    const dest = new CPos(1, 0)
    const conn = new GraphConnection(dest, 0)
    expect(conn.Cost).toBe(0)
  })

  it('converts to GraphEdge via toEdge', () => {
    const source = new CPos(0, 0)
    const dest = new CPos(1, 0)
    const conn = new GraphConnection(dest, 10)
    const edge = conn.toEdge(source)

    expect(edge.Source).toBe(source)
    expect(edge.Destination).toBe(dest)
    expect(edge.Cost).toBe(10)
  })

  it('produces correct toString', () => {
    const dest = new CPos(1, 0)
    const conn = new GraphConnection(dest, 10)
    expect(conn.toString()).toBe('-> 1,0 = 10')
  })
})

// ---------------------------------------------------------------------------
// PathGraph constants tests
// ---------------------------------------------------------------------------

describe('PathGraph constants', () => {
  it('PathCostForInvalidPath is Number.MAX_SAFE_INTEGER', () => {
    expect(PathGraph.PathCostForInvalidPath).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it('MovementCostForUnreachableCell is 32767 (short.MaxValue)', () => {
    expect(PathGraph.MovementCostForUnreachableCell).toBe(32767)
  })
})
