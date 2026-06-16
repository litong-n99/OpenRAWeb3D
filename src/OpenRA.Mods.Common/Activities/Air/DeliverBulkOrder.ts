/**
 * DeliverBulkOrder.ts — 批量空投订单交付活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/DeliverBulkOrder.cs
 *
 * 核心范式转换:
 * - C# Cargo / ProductionBulkAirdrop traits → TypeScript duck-typed interfaces
 * - C# TypeDictionary inits → TypeScript Record<string, unknown>
 * - C# producer.World.AddFrameEndTask → actor.world.addFrameEndAction
 * - C# queue.DeliverFinished → queue.deliverFinished()
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { Wait } from '../Wait.js'
import { RemoveSelf } from '../RemoveSelf.js'
import { Land } from './Land.js'
import { FlyOffMap } from './FlyOffMap.js'

// ---------------------------------------------------------------------------
// Duck-typed dependencies
// ---------------------------------------------------------------------------

/** Minimal Cargo trait interface used by DeliverBulkOrder. */
interface CargoLike {
  readonly info: {
    readonly beforeUnloadDelay: number
    readonly betweenUnloadDelay: number
    readonly afterUnloadDelay: number
  }
}

/** Minimal production queue interface. */
interface BulkProductionQueueLike {
  deliverFinished(): void
}

/** Ordered actor entry. */
interface OrderedActorEntry {
  readonly actorInfo: unknown
  readonly resources: number
  readonly cash: number
}

/** Minimal ProductionBulkAirdrop trait interface. */
interface ProductionBulkAirdropLike {
  readonly faction: string
  publicExit(producer: GameActor, actorInfo: unknown, productionType: string): unknown
  doProduction(
    producer: GameActor,
    actorInfo: unknown,
    exitInfo: unknown,
    productionType: string,
    inits: Record<string, unknown>,
  ): void
}

/** Minimal notification interface. */
interface INotifyDelivery {
  delivered(producer: GameActor): void
}

// ---------------------------------------------------------------------------
// DeliverBulkOrder
// ---------------------------------------------------------------------------

/**
 * Deliver a bulk production order by landing at a producer, unloading actors,
 * and then flying off the map.
 *
 * OpenRA 对照: DeliverBulkOrder activity
 */
export class DeliverBulkOrder extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly producer: GameActor
  private readonly orderedActors: OrderedActorEntry[]
  private readonly productionType: string
  private readonly productionQueue: BulkProductionQueueLike
  private readonly cargo: CargoLike
  private delayBetweenUnloads: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a DeliverBulkOrder activity.
   *
   * OpenRA 对照: DeliverBulkOrder(Actor transport, Actor producer, List<(ActorInfo, int, int)> orderedActors, string productionType, BulkProductionQueue queue)
   *
   * @param transport — the transport aircraft
   * @param producer — the production building
   * @param orderedActors — actors to deliver
   * @param productionType — production type string
   * @param queue — production queue managing the order
   */
  constructor(
    transport: GameActor,
    producer: GameActor,
    orderedActors: OrderedActorEntry[],
    productionType: string,
    queue: BulkProductionQueueLike,
  ) {
    super()
    this.producer = producer
    this.orderedActors = orderedActors
    this.productionType = productionType
    this.productionQueue = queue

    const transportAny = transport as unknown as { traits?: Map<string, unknown> }
    const cargo = transportAny.traits?.get('Cargo') as CargoLike | undefined
    if (!cargo) {
      throw new Error('DeliverBulkOrder requires a Cargo trait on the transport')
    }
    this.cargo = cargo
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * On first run: land at producer and wait before unloading.
   *
   * OpenRA 对照: DeliverBulkOrder.OnFirstRun(Actor)
   */
  protected override onFirstRun(self: GameActor): void {
    const producerAny = this.producer as unknown as {
      info?: { traitInfo?: <T>(name: string) => T | null }
    }
    const traitInfoFn = producerAny.info?.traitInfo
    const airdropInfo = traitInfoFn
      ? (traitInfoFn<{ landOffset: WVec }>('ProductionBulkAirdrop') as { landOffset: WVec } | null)
      : null
    const landingOffset = airdropInfo?.landOffset ?? WVec.Zero

    this.queueChild(new Land(self, Target.fromActor(this.producer as never), WDist.Zero, landingOffset))
    if (this.cargo.info.beforeUnloadDelay > 0) {
      this.queueChild(new Wait(this.cargo.info.beforeUnloadDelay))
    }
  }

  /**
   * On last run: notify delivery, queue post-unload wait, fly off map, remove self.
   *
   * OpenRA 对照: DeliverBulkOrder.OnLastRun(Actor)
   */
  protected override onLastRun(self: GameActor): void {
    const producerAny = this.producer as unknown as { isDead?: boolean; isInWorld?: boolean; traits?: Map<string, unknown> }
    if (!producerAny.isDead && producerAny.isInWorld) {
      if (producerAny.traits) {
        for (const [, trait] of producerAny.traits) {
          const notify = trait as Partial<INotifyDelivery>
          if (typeof notify.delivered === 'function') {
            notify.delivered(this.producer)
          }
        }
      }
    }

    if (this.cargo.info.afterUnloadDelay > 0) {
      this.queue(new Wait(this.cargo.info.afterUnloadDelay))
    }

    const actorAny = self as unknown as {
      world?: { map?: { chooseClosestEdgeCell?: (cell: CPos) => CPos } }
      location?: CPos
    }
    const edgeCell = actorAny.world?.map?.chooseClosestEdgeCell?.(actorAny.location ?? CPos.Zero)
    this.queue(new FlyOffMap(self, Target.fromCell(edgeCell ?? CPos.Zero)))
    this.queue(new RemoveSelf())
  }

  /**
   * Notify queue when this activity's actor is disposed.
   *
   * OpenRA 对照: DeliverBulkOrder.OnActorDispose(Actor)
   */
  override onActorDisposeOuter(_self: GameActor): void {
    this.productionQueue.deliverFinished()
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Unload one actor per tick with between-unload delays.
   *
   * OpenRA 对照: DeliverBulkOrder.Tick(Actor)
   *
   * @param self — the transport aircraft
   * @returns true when done
   */
  override tick(self: GameActor): boolean {
    const producerAny = this.producer as unknown as { isInWorld?: boolean; isDead?: boolean }
    if (!producerAny.isInWorld || producerAny.isDead) {
      // Try to find another ProductionBulkAirDrop
      const actorAny = self as unknown as {
        owner?: unknown
        world?: { actors?: readonly GameActor[] }
      }
      const newProducer = _findAlternativeProducer(self, actorAny.owner, actorAny.world?.actors)

      if (newProducer !== null) {
        this.cancel(self)
        this.queue(
          new DeliverBulkOrder(self, newProducer, this.orderedActors, this.productionType, this.productionQueue),
        )
        return true
      } else {
        this.productionQueue.deliverFinished()
        return true
      }
    }

    if (this.orderedActors.length === 0) {
      this.productionQueue.deliverFinished()
      return true
    }

    const entry = this.orderedActors[this.orderedActors.length - 1]
    const productionTrait = (this.producer as unknown as { traits?: Map<string, unknown> }).traits?.get(
      'ProductionBulkAirdrop',
    ) as ProductionBulkAirdropLike | undefined
    if (!productionTrait) {
      return false
    }

    const exit = productionTrait.publicExit(this.producer, entry.actorInfo, this.productionType)
    if (exit === null || exit === undefined) {
      return false
    }

    if (this.delayBetweenUnloads > 0) {
      this.delayBetweenUnloads--
      return false
    }

    this.delayBetweenUnloads = this.cargo.info.betweenUnloadDelay

    const worldAny = (self as unknown as { world?: { addFrameEndAction?: (fn: () => void) => void } }).world
    if (worldAny?.addFrameEndAction) {
      const producer = this.producer
      const orderedActors = this.orderedActors
      const productionType = this.productionType
      const productionQueue = this.productionQueue
      worldAny.addFrameEndAction(() => {
        const owner = (self as unknown as { owner?: unknown }).owner
        const inits: Record<string, unknown> = {
          OwnerInit: owner,
          FactionInit: productionTrait.faction,
        }
        productionTrait.doProduction(producer, entry.actorInfo, (exit as unknown as { info?: unknown }).info, productionType, inits)
        orderedActors.pop()
        if (orderedActors.length === 0) {
          productionQueue.deliverFinished()
        }
      })
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// Static helper (namespaced to avoid extra file)
// ---------------------------------------------------------------------------

/**
 * Find an alternative ProductionBulkAirdrop producer owned by the same player.
 *
 * OpenRA 对照: self.World.ActorsHavingTrait<ProductionBulkAirdrop>().ClosestToIgnoringPath(self)
 */
function _findAlternativeProducer(self: GameActor, owner: unknown, actors: readonly GameActor[] | undefined): GameActor | null {
  if (!actors) return null
  const selfPos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
  let nearest: GameActor | null = null
  let nearestDist = Number.MAX_SAFE_INTEGER

  for (const a of actors) {
    const aAny = a as unknown as {
      isDead?: boolean
      owner?: unknown
      traits?: Map<string, unknown>
      centerPosition?: WPos
    }
    if (aAny.isDead || aAny.owner !== owner) continue
    if (!aAny.traits?.has('ProductionBulkAirdrop')) continue
    const dist = WVec.subtract((aAny.centerPosition ?? WPos.Zero).toWVec(), selfPos.toWVec()).lengthSquared
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = a
    }
  }

  return nearest
}
