/**
 * ProductionProperties.ts — Script-exposed Production category properties
 * OpenRA 对照: ProductionProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Production")] → category = 'Production'
 * - C# Requires<ProductionInfo> etc. → requiredTraits
 * - C# Production.Produce(Self, actorInfo, type, inits, 0) → queueActivity
 * - C# ClassicProductionQueueProperties extends ScriptPlayerProperties
 *   → This is a ScriptPlayerProperties subclass co-located here
 * - C# ScriptTriggers integration → cached ScriptTriggers reference
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

type ScriptCallable = (...args: unknown[]) => unknown

// ===========================================================================
// ProductionProperties — actor-scoped production
// ===========================================================================

/**
 * Production properties for actors that can produce other actors.
 *
 * OpenRA 对照: ProductionProperties (ProductionProperties.cs:25-68)
 */
export class ProductionProperties extends ScriptActorProperties {
  static readonly category = 'Production' as const
  static readonly requiredTraits = ['ProductionInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _productionTraits: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._productionTraits = (self as any).traitsImplementing?.('Production') ?? []
  }

  /**
   * Build a unit, ignoring the production queue. The activity will wait if the exit is blocked.
   * @param actorType — the actor type to produce
   * @param factionVariant — optional faction variant
   * @param productionType — optional production type
   */
  Produce(actorType: string, factionVariant?: string, productionType?: string): void {
    const world = this.self.world as any
    const rules = world?.map?.rules?.actors
    if (!rules) throw new Error('Map rules not available')

    const actorInfo = rules[actorType]
    if (!actorInfo) throw new Error(`Unknown actor type '${actorType}'`)

    const bi = (actorInfo as any).traitInfo?.('BuildableInfo') ?? actorInfo.traitInfo?.('Buildable') ?? null

    this.self.queueActivity?.(createActivity('WaitFor', {
      condition: () => {
        for (const p of this._productionTraits) {
          const type = productionType ?? bi?.buildAtProductionType
          if (type && !p.info?.produces?.includes?.(type)) continue

          const inits = {
            Owner: { value: this.self.owner },
            Faction: { value: factionVariant ?? bi?.getInitialFaction?.(actorInfo, p.faction) },
          }

          if (p.produce?.(this.self, actorInfo, type, inits, 0)) return true
        }
        return false
      },
    }))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Produce', returnType: 'nil',
        description: 'Build a unit, ignoring the production queue.',
        parameters: [
          { name: 'actorType', type: 'string', optional: false },
          { name: 'factionVariant', type: 'string', optional: true, defaultValue: undefined },
          { name: 'productionType', type: 'string', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => {
          this.Produce(args[0] as string, args[1] as string | undefined, args[2] as string | undefined)
        },
      },
    ]
  }
}

// ===========================================================================
// RallyPointProperties
// ===========================================================================

/**
 * Rally point properties for production buildings.
 *
 * OpenRA 对照: RallyPointProperties (ProductionProperties.cs:71-97)
 */
export class RallyPointProperties extends ScriptActorProperties {
  static readonly category = 'Production' as const
  static readonly requiredTraits = ['RallyPointInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _rp: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._rp = (self as any).trait?.('RallyPoint') ?? null
  }

  /** Query or set a factory's rally point. */
  get RallyPoint(): unknown {
    if (!this._rp) return (this.self as any).location
    if (this._rp.path?.length > 0) {
      return this._rp.path[this._rp.path.length - 1]
    }
    const exit = (this.self as any).nearestExitOrDefault?.((this.self as any).centerPosition)
    if (exit != null) {
      return { ...(this.self as any).location, offset: exit.info?.exitCell }
    }
    return (this.self as any).location
  }

  set RallyPoint(value: unknown) {
    if (this._rp) {
      this._rp.path = [value]
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'RallyPoint', returnType: 'CPos',
        description: 'Query or set a factory\'s rally point.',
        get: () => this.RallyPoint,
        set: (_, v) => { this.RallyPoint = v },
      },
    ]
  }
}

// ===========================================================================
// PrimaryBuildingProperties
// ===========================================================================

/**
 * Primary building designation properties.
 *
 * OpenRA 对照: PrimaryBuildingProperties (ProductionProperties.cs:100-116)
 */
export class PrimaryBuildingProperties extends ScriptActorProperties {
  static readonly category = 'Production' as const
  static readonly requiredTraits = ['PrimaryBuildingInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _pb: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._pb = (self as any).trait?.('PrimaryBuilding') ?? null
  }

  /** Query or set the factory's primary building status. */
  get IsPrimaryBuilding(): boolean {
    return this._pb?.isPrimary ?? false
  }

  set IsPrimaryBuilding(value: boolean) {
    this._pb?.setPrimaryProducer?.(this.self, value)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'IsPrimaryBuilding', returnType: 'boolean',
        description: 'Query or set the factory\'s primary building status.',
        get: () => this.IsPrimaryBuilding,
        set: (_, v) => { this.IsPrimaryBuilding = v as boolean },
      },
    ]
  }
}

// ===========================================================================
// ProductionQueueProperties — per-building queue
// ===========================================================================

/**
 * Per-building production queue properties.
 *
 * OpenRA 对照: ProductionQueueProperties (ProductionProperties.cs:119-203)
 */
export class ProductionQueueProperties extends ScriptActorProperties {
  static readonly category = 'Production' as const
  static readonly requiredTraits = ['ProductionQueueInfo', 'ScriptTriggersInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _queues: any[]
  private readonly _triggers: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._queues = ((self as any).traitsImplementing?.('ProductionQueue') ?? [])
      .filter((q: any) => q.enabled)
    this._triggers = (self as any).getScriptTriggers?.('TriggerGlobal') ?? null
  }

  /**
   * Build the specified set of actors using a TD-style (per building) production queue.
   * @param actorTypes — array of actor type names
   * @param actionFunc — optional callback called as func(actors: Actor[]) on completion
   */
  Build(actorTypes: string[], actionFunc?: ScriptCallable): boolean {
    if (this._triggers?.hasAnyCallbacksFor?.('OnProduction')) return false

    const queue = this._queues
      .filter((q: any) => {
        return actorTypes.every((t: string) => {
          const bi = this._getBuildableInfo(t)
          return bi.queue?.includes?.(q.info?.type)
        })
      })
      .find((q: any) => !(q.allQueued?.() ?? []).length)

    if (!queue) return false

    if (actionFunc) {
      const player = this.self.owner
      const squadSize = actorTypes.length
      const squad: IGameActor[] = []

      const productionHandler = (_factory: any, unit: IGameActor) => {
        if (player !== (unit as any).owner) {
          // Factory changed owner — abort
          if (this._triggers) {
            this._triggers.onProducedInternal = undefined
          }
          return
        }
        squad.push(unit)
        if (squad.length >= squadSize) {
          const alive = squad.filter(u => !u.isDead)
          actionFunc(alive)
          if (this._triggers) {
            this._triggers.onProducedInternal = undefined
          }
        }
      }

      if (this._triggers) {
        this._triggers.onProducedInternal = productionHandler
      }
    }

    for (const actorType of actorTypes) {
      queue.resolveOrder?.(this.self, {
        orderName: 'StartProduction',
        target: this.self,
        extraData: actorType,
        extraData2: 1,
      })
    }

    return true
  }

  /**
   * Check whether the factory's production queue is currently busy.
   */
  IsProducing(actorType: string): boolean {
    if (this._triggers?.hasAnyCallbacksFor?.('OnProduction')) return true

    return this._queues.some((q: any) => {
      const bi = this._getBuildableInfo(actorType)
      return bi.queue?.includes?.(q.info?.type) && (q.allQueued?.() ?? []).length > 0
    })
  }

  private _getBuildableInfo(actorType: string): any {
    const rules = (this.self.world as any)?.map?.rules?.actors
    if (!rules) throw new Error('Map rules not available')

    const ri = rules[actorType]
    if (!ri) throw new Error(`Unknown actor type '${actorType}'`)

    const bi = (ri as any).traitInfo?.('BuildableInfo') ?? (ri as any).traitInfo?.('Buildable') ?? null
    if (!bi) throw new Error(`Actor of type ${actorType} cannot be produced`)
    return bi
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Build', returnType: 'boolean',
        description: 'Build the specified set of actors using a TD-style (per building) production queue.',
        parameters: [
          { name: 'actorTypes', type: 'string[]', optional: false },
          { name: 'actionFunc', type: 'function', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => this.Build(args[0] as string[], args[1] as ScriptCallable | undefined),
      },
      {
        memberType: 'method', name: 'IsProducing', returnType: 'boolean',
        description: 'Check whether the factory\'s production queue that builds this type of actor is currently busy.',
        parameters: [{ name: 'actorType', type: 'string', optional: false }],
        invoke: (_, args) => this.IsProducing(args[0] as string),
      },
    ]
  }
}

// ===========================================================================
// ClassicProductionQueueProperties — PLAYER-scoped (co-located Phase E class)
// ===========================================================================

/**
 * Classic (RA-style) production queue properties — PLAYER-scoped.
 *
 * OpenRA 对照: ClassicProductionQueueProperties (ProductionProperties.cs:206-310)
 *
 * This extends ScriptPlayerProperties (not ScriptActorProperties).
 * It operates on the PlayerActor's ClassicProductionQueue traits.
 */
export class ClassicProductionQueueProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['ClassicProductionQueueInfo', 'ScriptTriggersInfo'] as const

  private readonly _queues = new Map<string, any>()
  private readonly _productionHandlers = new Map<string, (...args: any[]) => void>()

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)

    const playerActor = (player as any).playerActor ?? (player as any).PlayerActor
    if (!playerActor) return

    const allQueues = (playerActor as any).traitsImplementing?.('ClassicProductionQueue') ?? []
    for (const q of allQueues.filter((q: any) => q.enabled)) {
      this._queues.set(q.info?.type ?? '', q)
    }

    const triggers = (playerActor as any).getScriptTriggers?.('TriggerGlobal')
    if (triggers) {
      triggers.onOtherProducedInternal = (factory: any, unit: IGameActor) => {
        if (factory?.owner !== player) return

        const bi = this._getBuildableInfo(unit.info?.name ?? '')
        const queueName = bi?.queue?.[0]
        if (queueName) {
          const handler = this._productionHandlers.get(queueName)
          handler?.(factory, unit)
        }
      }
    }
  }

  /**
   * Build the specified set of actors using classic (RA-style) production queues.
   */
  Build(actorTypes: string[], actionFunc?: ScriptCallable): boolean {
    const typeToQueueMap = new Map<string, string>()
    for (const actorType of [...new Set(actorTypes)]) {
      typeToQueueMap.set(actorType, this._getBuildableInfo(actorType).queue?.[0])
    }

    const queueTypes = [...new Set(typeToQueueMap.values())]
    if (queueTypes.some(t => !this._queues.has(t) || this._productionHandlers.has(t))) {
      return false
    }
    if (queueTypes.some(t => (this._queues.get(t)?.allQueued?.() ?? []).length > 0)) {
      return false
    }

    if (actionFunc) {
      const squadSize = actorTypes.length
      const squad: IGameActor[] = []

      const productionHandler = (_factory: any, unit: IGameActor) => {
        squad.push(unit)
        if (squad.length >= squadSize) {
          const alive = squad.filter(u => !u.isDead)
          actionFunc!(alive)
          for (const q of queueTypes) {
            this._productionHandlers.delete(q)
          }
        }
      }

      for (const q of queueTypes) {
        this._productionHandlers.set(q, productionHandler)
      }
    }

    for (const actorType of actorTypes) {
      const queue = this._queues.get(typeToQueueMap.get(actorType)!)
      if (queue) {
        queue.resolveOrder?.(queue.actor, {
          orderName: 'StartProduction',
          target: queue.actor,
          extraData: actorType,
          extraData2: 1,
        })
      }
    }

    return true
  }

  /**
   * Check whether the production queue is currently busy.
   */
  IsProducing(actorType: string): boolean {
    const queue = this._getBuildableInfo(actorType).queue?.[0]
    if (!queue || !this._queues.has(queue)) return true

    return this._productionHandlers.has(queue) ||
      (this._queues.get(queue)?.allQueued?.() ?? []).length > 0
  }

  private _getBuildableInfo(actorType: string): any {
    const rules = (this.player as any).world?.map?.rules?.actors
    if (!rules) throw new Error('Map rules not available')

    const ri = rules[actorType]
    if (!ri) throw new Error(`Unknown actor type '${actorType}'`)

    const bi = (ri as any).traitInfo?.('BuildableInfo') ?? (ri as any).traitInfo?.('Buildable') ?? null
    if (!bi) throw new Error(`Actor of type ${actorType} cannot be produced`)
    return bi
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Build', returnType: 'boolean',
        description: 'Build the specified set of actors using classic (RA-style) production queues.',
        parameters: [
          { name: 'actorTypes', type: 'string[]', optional: false },
          { name: 'actionFunc', type: 'function', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => this.Build(args[0] as string[], args[1] as ScriptCallable | undefined),
      },
      {
        memberType: 'method', name: 'IsProducing', returnType: 'boolean',
        description: 'Check whether the production queue that builds this type of actor is currently busy.',
        parameters: [{ name: 'actorType', type: 'string', optional: false }],
        invoke: (_, args) => this.IsProducing(args[0] as string),
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'Production',
  ctor: ProductionProperties,
  requiredTraits: ['ProductionInfo'],
  exposedForDestroyedActors: false,
  description: 'Direct actor production: Produce (ignores queue)',
})

ScriptRegistry.registerActorProperty({
  category: 'Production',
  ctor: RallyPointProperties,
  requiredTraits: ['RallyPointInfo'],
  exposedForDestroyedActors: false,
  description: 'Factory rally point: RallyPoint (query/set)',
})

ScriptRegistry.registerActorProperty({
  category: 'Production',
  ctor: PrimaryBuildingProperties,
  requiredTraits: ['PrimaryBuildingInfo'],
  exposedForDestroyedActors: false,
  description: 'Primary building status: IsPrimaryBuilding (query/set)',
})

ScriptRegistry.registerActorProperty({
  category: 'Production',
  ctor: ProductionQueueProperties,
  requiredTraits: ['ProductionQueueInfo', 'ScriptTriggersInfo'],
  exposedForDestroyedActors: false,
  description: 'Per-building production queue: Build, IsProducing (TD-style)',
})

ScriptRegistry.registerPlayerProperty({
  category: 'Production',
  ctor: ClassicProductionQueueProperties,
  requiredTraits: ['ClassicProductionQueueInfo', 'ScriptTriggersInfo'],
  description: 'Classic production queue: Build, IsProducing (RA-style, player-scoped)',
})
