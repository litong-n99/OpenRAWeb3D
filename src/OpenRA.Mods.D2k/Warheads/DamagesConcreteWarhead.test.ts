/**
 * DamagesConcreteWarhead.test.ts — DamagesConcreteWarhead migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Warhead } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { DamagesConcreteWarhead, type IBuildableTerrainLayerAccess } from './DamagesConcreteWarhead.js'

function createMockActor(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false, generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: {
      worldActor: { trait: vi.fn() },
      map: { cellContaining: vi.fn() },
    } as unknown as IGameActor['world'],
    centerPosition: WPos.Zero,
  } as unknown as IGameActor
}

describe('DamagesConcreteWarhead', () => {
  let warhead: DamagesConcreteWarhead

  beforeEach(() => {
    warhead = new DamagesConcreteWarhead()
  })

  it('extends Warhead base class', () => {
    expect(warhead).toBeInstanceOf(Warhead)
  })

  it('has default damage of 0', () => {
    expect(warhead.damage).toBe(0)
  })

  it('loads damage from JSON', () => {
    warhead.loadFromJSON({ Damage: 500, ValidTargets: ['Ground'] })
    expect(warhead.damage).toBe(500)
  })

  it('loads base warhead fields', () => {
    warhead.loadFromJSON({ Damage: 300, ValidTargets: ['Ground', 'Water'], InvalidTargets: ['Air'] })
    expect(warhead.damage).toBe(300)
    expect(warhead.validTargets.has('Ground')).toBe(true)
  })

  it('doImpactInWorld returns empty when no layer', () => {
    const actor = createMockActor()
    ;((actor.world as unknown as { worldActor: { trait: ReturnType<typeof vi.fn> } }).worldActor.trait).mockReturnValue(null)
    const effects = warhead.doImpactInWorld(WPos.Zero, actor, {
      sourceActor: actor, damageModifiers: [],
      impactPosition: WPos.Zero,
      impactOrientation: new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero),
    })
    expect(effects).toEqual([])
  })

  it('calls layer.hitTile with correct params', () => {
    const actor = createMockActor()
    const mockLayer: IBuildableTerrainLayerAccess = { hitTile: vi.fn() }
    ;((actor.world as unknown as { worldActor: { trait: ReturnType<typeof vi.fn> } }).worldActor.trait).mockReturnValue(mockLayer)
    ;((actor.world as unknown as { map: { cellContaining: ReturnType<typeof vi.fn> } }).map.cellContaining).mockReturnValue({ X: 5, Y: 10 })
    warhead.damage = 200
    const effects = warhead.doImpactInWorld(new WPos(5120, 10240, 0), actor, {
      sourceActor: actor, damageModifiers: [],
      impactPosition: new WPos(5120, 10240, 0),
      impactOrientation: new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero),
    })
    expect(effects).toEqual([])
    expect(mockLayer.hitTile).toHaveBeenCalledWith({ X: 5, Y: 10 }, 200)
  })

  it('loadFromJSON preserves unset fields', () => {
    warhead.damage = 100
    warhead.loadFromJSON({ ValidTargets: ['Ground'] })
    expect(warhead.damage).toBe(100)
  })

  it('accepts delay from base Warhead', () => {
    warhead.loadFromJSON({ Damage: 10, Delay: 5 })
    expect(warhead.delay).toBe(5)
  })

  describe('regression: TargetType.Invalid guard (MAJOR #8)', () => {
    it('returns empty when firedBy is dead', () => {
      warhead.damage = 200
      const deadActor = createMockActor()
      ;(deadActor as unknown as Record<string, unknown>).isDead = true
      ;((deadActor.world as unknown as { worldActor: { trait: ReturnType<typeof vi.fn> } }).worldActor.trait).mockReturnValue({ hitTile: vi.fn() })

      const effects = warhead.doImpactInWorld(WPos.Zero, deadActor, {
        sourceActor: deadActor, damageModifiers: [],
        impactPosition: WPos.Zero,
        impactOrientation: new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero),
      })
      expect(effects).toEqual([])
    })

    it('returns empty when firedBy is disposed', () => {
      warhead.damage = 200
      const disposedActor = createMockActor()
      ;(disposedActor as unknown as Record<string, unknown>).disposed = true

      const effects = warhead.doImpactInWorld(WPos.Zero, disposedActor, {
        sourceActor: disposedActor, damageModifiers: [],
        impactPosition: WPos.Zero,
        impactOrientation: new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero),
      })
      expect(effects).toEqual([])
    })
  })
})
