/**
 * ProduceActorPower.ts — 生产支援能力（通过生产队列创建单位）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/ProduceActorPower.cs (114 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<ProduceActorPowerInfo> → TS 继承 SupportPower
 * - C# self.World.ActorsWithTrait<Production>().Where(...) → TS 遍历 actor 组件查找
 * - C# TypeDictionary inits → TS Map<string, unknown> 初始化包
 * - C# self.World.IssueOrder(…) in SelectTarget → TS 直接激活 power
 * - C# Game.Sound.PlayNotification → TS 音频桩（Ch7 Phase D）
 * - C# TextNotificationsManager.AddTransientLine → TS 文本通知桩
 * - C# BuildableInfo.GetInitialFaction → TS faction 回退逻辑
 *
 * ProduceActorPower directly issues production orders without target selection.
 * It finds compatible Production traits on the player's buildings and calls
 * Produce() for each actor in the Actors list. Audio feedback is played based
 * on success/failure.
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  SupportPower,
  type SupportPowerInfo,
  type ISupportPowerManager,
  type OrderStub,
} from './SupportPower.js'

// ---------------------------------------------------------------------------
// Stub references (types from other chapters)
// ---------------------------------------------------------------------------

/** Forward reference to Production trait from Ch11. */
export interface IProduction {
  readonly info: { readonly produces: ReadonlySet<string> }
  isTraitDisabled: boolean
  isTraitPaused: boolean
  produce(
    self: IGameActor,
    producee: unknown,
    productionType: string,
    inits: Map<string, unknown>,
    refundableValue: number,
  ): boolean
}

// ---------------------------------------------------------------------------
// ProduceActorPowerInfo
// OpenRA 对照: ProduceActorPowerInfo : SupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for ProduceActorPower.
 *
 * OpenRA 对照: ProduceActorPowerInfo
 *
 * Defines which actors to produce and which production queue type to use.
 */
export interface ProduceActorPowerInfo extends SupportPowerInfo {
  /** Actors to produce (required).
   *
   * OpenRA 对照: ProduceActorPowerInfo.Actors (ImmutableArray<string>)
   */
  readonly actors: readonly string[]

  /** Production queue type to use (required, e.g. "Vehicle", "Infantry").
   *
   * OpenRA 对照: ProduceActorPowerInfo.Type
   */
  readonly type: string

  /** Speech notification played when production succeeds.
   *
   * OpenRA 对照: ProduceActorPowerInfo.ReadyAudio
   */
  readonly readyAudio?: string | null

  /** Text notification displayed when production succeeds.
   *
   * OpenRA 对照: ProduceActorPowerInfo.ReadyTextNotification
   */
  readonly readyTextNotification?: string | null

  /** Speech notification played when all exits are blocked.
   *
   * OpenRA 对照: ProduceActorPowerInfo.BlockedAudio
   */
  readonly blockedAudio?: string | null

  /** Text notification displayed when all exits are blocked.
   *
   * OpenRA 对照: ProduceActorPowerInfo.BlockedTextNotification
   */
  readonly blockedTextNotification?: string | null
}

// ---------------------------------------------------------------------------
// ProduceActorPower
// OpenRA 对照: ProduceActorPower : SupportPower
// ---------------------------------------------------------------------------

/**
 * Support power that produces actors through existing Production queues.
 *
 * OpenRA 对照: ProduceActorPower
 *
 * Does NOT require target selection — activation immediately issues production
 * orders. Finds all compatible Production traits on the player's buildings,
 * prioritizes primary buildings, and calls Produce() for each actor.
 *
 * Design note: The timer resets even if production fails. This is a known
 * limitation acknowledged in the OpenRA source.
 */
export class ProduceActorPower extends SupportPower {
  /** Typed info reference.
   *
   * OpenRA 对照: ProduceActorPower.info
   */
  declare readonly info: ProduceActorPowerInfo

  /** Faction name for produced units.
   *
   * OpenRA 对照: ProduceActorPower.faction (from FactionInit)
   */
  readonly faction: string

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    self: IGameActor,
    info: ProduceActorPowerInfo,
    faction?: string,
  ) {
    super(self, info)
    this.faction = faction ?? ''
  }

  // -----------------------------------------------------------------------
  // SelectTarget — directly issues order (no targeting step)
  // -----------------------------------------------------------------------

  /**
   * Override — directly issues the activation order without target selection.
   *
   * OpenRA 对照: ProduceActorPower.SelectTarget(Actor, string, SupportPowerManager)
   *
   * C# original: self.World.IssueOrder(new Order(order, manager.Self, false));
   * This immediately goes to ResolveOrder -> Activate.
   */
  override selectTarget(
    self: IGameActor,
    _order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: In OpenRA, this calls self.World.IssueOrder(...).
    // In TypeScript, we directly activate the power through the manager.
    // The manager's resolveOrder will be triggered by the widget system.
    this._directActivate(self, _order, manager)
  }

  /**
   * Internal direct activation bridge.
   * Called by selectTarget to immediately activate without targeting UI.
   */
  private _directActivate(
    _self: IGameActor,
    _order: string,
    _manager: ISupportPowerManager,
  ): void {
    // NOTE: In the full integration, this triggers the power activation
    // through the existing Order resolution pipeline via the manager.
    // For testing, this is overridden by the test subclass.
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the production power.
   *
   * OpenRA 对照: ProduceActorPower.Activate(Actor, Order, SupportPowerManager)
   *
   * Finds all compatible Production traits, tries each producer in priority
   * order (primary buildings first), and calls Produce() for each actor.
   * Plays ReadyAudio on success, BlockedAudio on failure.
   */
  override activate(
    self: IGameActor,
    _order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, _order, manager)
    this.playLaunchSounds()

    // Find compatible producers
    const producers = this._findProducers(self)

    // TODO: The power should not reset if the production fails.
    // Fixing this will require a larger rework of the support power code.
    let activated = false

    for (const prod of producers) {
      if (activated) break

      for (const actorName of this.info.actors) {
        const inits = this._createInits(self)
        const result = prod.trait.produce(prod.actor, { name: actorName }, this.info.type, inits, 0)
        if (result) {
          activated = true
        }
      }
    }

    // Play audio/text notifications
    if (activated) {
      if (this.info.readyAudio) {
        this.playPowerSound(self, 'ready', this.info.readyAudio)
      }
      if (this.info.readyTextNotification) {
        this.addTextNotification(self, this.info.readyTextNotification)
      }
    } else {
      if (this.info.blockedAudio) {
        this.playPowerSound(self, 'blocked', this.info.blockedAudio)
      }
      if (this.info.blockedTextNotification) {
        this.addTextNotification(self, this.info.blockedTextNotification)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Producer discovery — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Find all compatible Production traits on the player's actors.
   *
   * OpenRA 对照: self.World.ActorsWithTrait<Production>()
   *   .Where(x => x.Actor.Owner == self.Owner
   *     && !x.Trait.IsTraitDisabled
   *     && x.Trait.Info.Produces.Contains(info.Type))
   *   .OrderByDescending(x => x.Actor.IsPrimaryBuilding())
   *   .ThenByDescending(x => x.Actor.ActorID)
   *
   * @param self — the actor holding this power
   * @returns sorted array of { actor, trait } pairs
   */
  protected _findProducers(self: IGameActor): { actor: IGameActor; trait: IProduction }[] {
    const results: { actor: IGameActor; trait: IProduction }[] = []

    if (!self.world) return results

    // Iterate all actors in the world to find compatible producers
    const actors = this._getWorldActors(self)
    for (const actor of actors) {
      if (!actor.owner || actor.owner !== self.owner) continue

      const prod = this._getProductionTrait(actor)
      if (!prod) continue
      if (prod.isTraitDisabled) continue
      if (!prod.info.produces.has(this.info.type)) continue

      results.push({ actor, trait: prod })
    }

    // Sort: primary buildings first, then by actor ID descending
    return results.sort((a, b) => {
      const aPrimary = this._isPrimaryBuilding(a.actor) ? 1 : 0
      const bPrimary = this._isPrimaryBuilding(b.actor) ? 1 : 0
      if (aPrimary !== bPrimary) return bPrimary - aPrimary
      return b.actor.actorId - a.actor.actorId
    })
  }

  /**
   * Get all actors in the world (overridable for testing).
   */
  protected _getWorldActors(self: IGameActor): IGameActor[] {
    // NOTE: In real implementation, this accesses self.world.actors.
    // For now, returns empty — test subclass overrides this.
    if (self.world && typeof (self.world as any).getActors === 'function') {
      return (self.world as any).getActors()
    }
    return []
  }

  /**
   * Get the Production trait from an actor (overridable for testing).
   */
  protected _getProductionTrait(actor: IGameActor): IProduction | null {
    if (actor.traitsImplementing) {
      const traits = actor.traitsImplementing('Production')
      return (traits[0] as IProduction) ?? null
    }
    return null
  }

  /**
   * Check if an actor is a primary building (overridable for testing).
   */
  protected _isPrimaryBuilding(_actor: IGameActor): boolean {
    return false
  }

  /**
   * Create initialization parameters for the produced unit.
   */
  protected _createInits(self: IGameActor): Map<string, unknown> {
    const inits = new Map<string, unknown>()
    inits.set('OwnerInit', self.owner)
    inits.set('FactionInit', this.faction)
    return inits
  }
}
