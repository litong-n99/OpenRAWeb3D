/**
 * Buildable.test.ts — Buildable migration unit tests
 *
 * Tests focus on: BuildableInfo configuration, queue Set semantics,
 * getInitialFaction helper, default values.
 */

import { describe, it, expect } from 'vitest'
import { BuildableInfo, Buildable } from './Buildable.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BuildableInfo', () => {
  it('has correct default values', () => {
    const info = new BuildableInfo()
    expect(info.prerequisites).toEqual([])
    expect(info.queue).toEqual(new Set())
    expect(info.buildAtProductionType).toBeNull()
    expect(info.buildLimit).toBe(0)
    expect(info.forceFaction).toBeNull()
    expect(info.icon).toBe('icon')
    expect(info.iconPalette).toBe('chrome')
    expect(info.iconPaletteIsPlayerPalette).toBe(false)
    expect(info.buildDuration).toBe(-1)
    expect(info.buildDurationModifier).toBe(60)
    expect(info.buildPaletteOrder).toBe(9999)
    expect(info.description).toBeNull()
  })

  it('accepts Set for queue parameter', () => {
    const queue = new Set(['Infantry', 'Vehicle'])
    const info = new BuildableInfo({ queue })
    expect(info.queue).toBe(queue)
    expect(info.queue.has('Infantry')).toBe(true)
    expect(info.queue.has('Vehicle')).toBe(true)
    expect(info.queue.has('Aircraft')).toBe(false)
  })

  it('accepts string array for queue parameter and converts to Set', () => {
    const info = new BuildableInfo({ queue: ['Infantry', 'Vehicle'] })
    expect(info.queue).toBeInstanceOf(Set)
    expect(info.queue.has('Infantry')).toBe(true)
    expect(info.queue.has('Vehicle')).toBe(true)
    expect(info.queue.has('Aircraft')).toBe(false)
  })

  it('accepts all configurable fields', () => {
    const info = new BuildableInfo({
      prerequisites: ['barracks', 'radar'],
      queue: new Set(['Infantry']),
      buildAtProductionType: 'Barracks',
      buildLimit: 5,
      forceFaction: 'soviet',
      icon: 'custom-icon',
      iconPalette: 'player',
      iconPaletteIsPlayerPalette: true,
      buildDuration: 250,
      buildDurationModifier: 80,
      buildPaletteOrder: 100,
      description: 'Test unit description',
    })
    expect(info.prerequisites).toEqual(['barracks', 'radar'])
    expect(info.queue.has('Infantry')).toBe(true)
    expect(info.buildAtProductionType).toBe('Barracks')
    expect(info.buildLimit).toBe(5)
    expect(info.forceFaction).toBe('soviet')
    expect(info.icon).toBe('custom-icon')
    expect(info.iconPalette).toBe('player')
    expect(info.iconPaletteIsPlayerPalette).toBe(true)
    expect(info.buildDuration).toBe(250)
    expect(info.buildDurationModifier).toBe(80)
    expect(info.buildPaletteOrder).toBe(100)
    expect(info.description).toBe('Test unit description')
  })

  it('getInitialFaction returns defaultFaction for stub', () => {
    const actorInfo = { name: 'test-actor' }
    expect(BuildableInfo.getInitialFaction(actorInfo, 'allied')).toBe('allied')
    expect(BuildableInfo.getInitialFaction(actorInfo, 'soviet')).toBe('soviet')
  })

  it('empty queue Set means no production queues can build this', () => {
    const info = new BuildableInfo()
    expect(info.queue.size).toBe(0)
    expect(info.queue.has('Infantry')).toBe(false)
    expect(info.queue.has('Vehicle')).toBe(false)
    expect(info.queue.has('Buildings')).toBe(false)
  })

  it('prerequisites support ! and ~ prefixes', () => {
    const info = new BuildableInfo({
      prerequisites: ['barracks', '!tech-center', '~radar', '!~superweapon'],
    })
    expect(info.prerequisites).toEqual([
      'barracks',
      '!tech-center',
      '~radar',
      '!~superweapon',
    ])
  })

  it('instanceName is optional', () => {
    const infoWithName = new BuildableInfo({ instanceName: 'my-instance' })
    expect(infoWithName.instanceName).toBe('my-instance')

    const infoWithoutName = new BuildableInfo()
    expect(infoWithoutName.instanceName).toBeUndefined()
  })
})

describe('Buildable', () => {
  it('is constructible as empty marker trait', () => {
    const buildable = new Buildable()
    expect(buildable).toBeInstanceOf(Buildable)
  })
})
