/**
 * MapBuildRadius.test.ts — MapBuildRadius migration unit tests
 *
 * Tests focus on: MapBuildRadiusInfo configuration, default values,
 * ILobbyOptions lobbyOptions generation, MapBuildRadius trait lifecycle,
 * allyBuildRadiusEnabled / buildRadiusEnabled state management.
 */

import { describe, it, expect } from 'vitest'

import {
  MapBuildRadiusInfo,
  MapBuildRadius,
} from './MapBuildRadius.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helper: minimal mock IGameActor
// ---------------------------------------------------------------------------

let nextId = 2000

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: nextId++,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// MapBuildRadiusInfo
// ---------------------------------------------------------------------------

describe('MapBuildRadiusInfo', () => {
  it('has correct default values', () => {
    const info = new MapBuildRadiusInfo()
    expect(info.instanceName).toBeUndefined()

    // Ally build radius defaults
    expect(info.allyBuildRadiusCheckboxLabel).toBe(
      'checkbox-ally-build-radius.label',
    )
    expect(info.allyBuildRadiusCheckboxDescription).toBe(
      'checkbox-ally-build-radius.description',
    )
    expect(info.allyBuildRadiusCheckboxEnabled).toBe(true)
    expect(info.allyBuildRadiusCheckboxLocked).toBe(false)
    expect(info.allyBuildRadiusCheckboxVisible).toBe(true)
    expect(info.allyBuildRadiusCheckboxDisplayOrder).toBe(0)

    // Build radius defaults
    expect(info.buildRadiusCheckboxLabel).toBe('checkbox-build-radius.label')
    expect(info.buildRadiusCheckboxDescription).toBe(
      'checkbox-build-radius.description',
    )
    expect(info.buildRadiusCheckboxEnabled).toBe(true)
    expect(info.buildRadiusCheckboxLocked).toBe(false)
    expect(info.buildRadiusCheckboxVisible).toBe(true)
    expect(info.buildRadiusCheckboxDisplayOrder).toBe(0)
  })

  it('accepts custom ally build radius settings', () => {
    const info = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxLabel: 'Ally Range',
      allyBuildRadiusCheckboxDescription: 'Show ally build range',
      allyBuildRadiusCheckboxEnabled: false,
      allyBuildRadiusCheckboxLocked: true,
      allyBuildRadiusCheckboxVisible: false,
      allyBuildRadiusCheckboxDisplayOrder: 5,
    })

    expect(info.allyBuildRadiusCheckboxLabel).toBe('Ally Range')
    expect(info.allyBuildRadiusCheckboxDescription).toBe(
      'Show ally build range',
    )
    expect(info.allyBuildRadiusCheckboxEnabled).toBe(false)
    expect(info.allyBuildRadiusCheckboxLocked).toBe(true)
    expect(info.allyBuildRadiusCheckboxVisible).toBe(false)
    expect(info.allyBuildRadiusCheckboxDisplayOrder).toBe(5)
  })

  it('accepts custom build radius settings', () => {
    const info = new MapBuildRadiusInfo({
      buildRadiusCheckboxLabel: 'Build Range',
      buildRadiusCheckboxDescription: 'Show build range',
      buildRadiusCheckboxEnabled: false,
      buildRadiusCheckboxLocked: true,
      buildRadiusCheckboxVisible: false,
      buildRadiusCheckboxDisplayOrder: 3,
    })

    expect(info.buildRadiusCheckboxLabel).toBe('Build Range')
    expect(info.buildRadiusCheckboxDescription).toBe('Show build range')
    expect(info.buildRadiusCheckboxEnabled).toBe(false)
    expect(info.buildRadiusCheckboxLocked).toBe(true)
    expect(info.buildRadiusCheckboxVisible).toBe(false)
    expect(info.buildRadiusCheckboxDisplayOrder).toBe(3)
  })

  it('accepts instanceName', () => {
    const info = new MapBuildRadiusInfo({ instanceName: 'radius-ctrl' })
    expect(info.instanceName).toBe('radius-ctrl')
  })
})

// ---------------------------------------------------------------------------
// MapBuildRadiusInfo.lobbyOptions
// ---------------------------------------------------------------------------

describe('MapBuildRadiusInfo.lobbyOptions', () => {
  it('returns two lobby options', () => {
    const info = new MapBuildRadiusInfo()
    const mapPreview = { uid: 'test-map' }

    const options = info.lobbyOptions(mapPreview)
    expect(options).toHaveLength(2)
  })

  it('first option is ally build radius', () => {
    const info = new MapBuildRadiusInfo()
    const mapPreview = { uid: 'test-map' }

    const options = info.lobbyOptions(mapPreview)
    const allyOption = options[0]

    expect(allyOption.id).toBe('allybuild')
    expect(allyOption.name).toBe('checkbox-ally-build-radius.label')
    expect(allyOption.description).toBe(
      'checkbox-ally-build-radius.description',
    )
    expect(allyOption.defaultValue).toBe('true')
    expect(allyOption.isLocked).toBe(false)
    expect(allyOption.isVisible).toBe(true)
    expect(allyOption.displayOrder).toBe(0)
    expect(allyOption.values.get('true')).toBe('True')
    expect(allyOption.values.get('false')).toBe('False')
  })

  it('second option is build radius', () => {
    const info = new MapBuildRadiusInfo()
    const mapPreview = { uid: 'test-map' }

    const options = info.lobbyOptions(mapPreview)
    const buildOption = options[1]

    expect(buildOption.id).toBe('buildradius')
    expect(buildOption.name).toBe('checkbox-build-radius.label')
    expect(buildOption.description).toBe('checkbox-build-radius.description')
    expect(buildOption.defaultValue).toBe('true')
    expect(buildOption.isLocked).toBe(false)
    expect(buildOption.isVisible).toBe(true)
    expect(buildOption.displayOrder).toBe(0)
  })

  it('ally option reflects disabled state', () => {
    const info = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxEnabled: false,
      allyBuildRadiusCheckboxLocked: true,
      allyBuildRadiusCheckboxVisible: false,
    })
    const mapPreview = { uid: 'test-map' }

    const options = info.lobbyOptions(mapPreview)
    const allyOption = options[0]

    expect(allyOption.defaultValue).toBe('false')
    expect(allyOption.isLocked).toBe(true)
    expect(allyOption.isVisible).toBe(false)
  })

  it('build option reflects disabled state', () => {
    const info = new MapBuildRadiusInfo({
      buildRadiusCheckboxEnabled: false,
      buildRadiusCheckboxLocked: true,
      buildRadiusCheckboxVisible: false,
    })
    const mapPreview = { uid: 'test-map' }

    const options = info.lobbyOptions(mapPreview)
    const buildOption = options[1]

    expect(buildOption.defaultValue).toBe('false')
    expect(buildOption.isLocked).toBe(true)
    expect(buildOption.isVisible).toBe(false)
  })

  it('custom labels appear in lobby options', () => {
    const info = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxLabel: 'Custom Ally Label',
      buildRadiusCheckboxLabel: 'Custom Build Label',
    })
    const mapPreview = { uid: 'test-map' }

    const options = info.lobbyOptions(mapPreview)
    expect(options[0].name).toBe('Custom Ally Label')
    expect(options[1].name).toBe('Custom Build Label')
  })
})

// ---------------------------------------------------------------------------
// MapBuildRadius
// ---------------------------------------------------------------------------

describe('MapBuildRadius', () => {
  it('constructs with info defaults', () => {
    const info = new MapBuildRadiusInfo()
    const trait = new MapBuildRadius(info)

    expect(trait.info).toBe(info)
    expect(trait.allyBuildRadiusEnabled).toBe(true)
    expect(trait.buildRadiusEnabled).toBe(true)
  })

  it('constructs with disabled default from info', () => {
    const info = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxEnabled: false,
      buildRadiusCheckboxEnabled: false,
    })
    const trait = new MapBuildRadius(info)

    expect(trait.allyBuildRadiusEnabled).toBe(false)
    expect(trait.buildRadiusEnabled).toBe(false)
  })

  it('ally and build radius independently configurable', () => {
    const info = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxEnabled: true,
      buildRadiusCheckboxEnabled: false,
    })
    const trait = new MapBuildRadius(info)

    expect(trait.allyBuildRadiusEnabled).toBe(true)
    expect(trait.buildRadiusEnabled).toBe(false)
  })

  it('created() is callable and does not throw', () => {
    const info = new MapBuildRadiusInfo()
    const trait = new MapBuildRadius(info)
    const worldActor = makeActor()

    expect(() => trait.created(worldActor)).not.toThrow()
  })

  it('values are preserved after created()', () => {
    // Since lobby integration is stubbed, created() does not change values
    const info = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxEnabled: true,
      buildRadiusCheckboxEnabled: true,
    })
    const trait = new MapBuildRadius(info)
    const worldActor = makeActor()

    trait.created(worldActor)

    expect(trait.allyBuildRadiusEnabled).toBe(true)
    expect(trait.buildRadiusEnabled).toBe(true)
  })

  it('implements INotifyCreated', () => {
    const info = new MapBuildRadiusInfo()
    const trait = new MapBuildRadius(info)

    // Direct check: created() is a public method from INotifyCreated
    expect(typeof trait.created).toBe('function')
  })
})
