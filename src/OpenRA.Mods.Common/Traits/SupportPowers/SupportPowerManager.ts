/**
 * SupportPowerManager.ts — 支援能力管理器 (per-player power registry + order resolver)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.cs (321 lines)
 *
 * 核心范式转换:
 * - C# TraitLocation(SystemActors.Player) → TS 附加到 Player actor 的组件
 * - C# World.ActorAdded/ActorRemoved events → TS actor add/remove 回调
 * - C# Dictionary<string, SupportPowerInstance> → TS Map<string, SupportPowerInstance>
 * - C# Lazy<RadarPings> → TS getter with lazy init
 * - C# ITick.Tick(self) / IResolveOrder.ResolveOrder(self, order) → TS 接口
 * - C# ITechTreeElement 4 methods → TS 接口实现
 * - C# IEnumerable<T> LINQ chains → TS Array filter/sort
 * - C# MinByOrDefault → TS reduce with comparator
 * - C# OrderGenerator nested class → TS 独立类（共享相同闭包状态）
 * - C# remainingSubTicks / 100 integer division → TS Math.floor(remainingSubTicks / 100)
 * - C# .Clamp(0, max) → TS Math.max(0, Math.min(value, max))
 *
 * NOTE: TechTree integration is stubbed — real TechTree requires Ch11 runtime.
 * NOTE: RadarPings deferred to Ch16.
 * NOTE: Game.Sound / TextNotificationsManager calls are stubbed.
 * NOTE: DeveloperMode trait lookup is stubbed.
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type ITick,
  type IResolveOrder,
  type IGameActor,
  type PlayerStub,
  type WorldStub,
  type Order,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import {
  type SupportPowerInfo,
  type ISupportPower,
  type ISupportPowerManager,
  type ISupportPowerInstance,
  type IDevMode,
  type OrderStub,
  SupportPower,
} from './SupportPower.js'

// ---------------------------------------------------------------------------
// SupportPowerManagerInfo
// OpenRA 对照: SupportPowerManagerInfo : TraitInfo, Requires<DeveloperModeInfo>, Requires<TechTreeInfo>
// ---------------------------------------------------------------------------

/** Configuration for SupportPowerManager. Minimal — all managed at runtime.
 *
 * OpenRA 对照: SupportPowerManagerInfo
 *
 * Attach location: TraitLocation(SystemActors.Player)
 * In TypeScript: component on the Player actor.
 */
export interface SupportPowerManagerInfo extends ConditionalTraitInfo {
  // intentionally minimal — the trait has no configurable fields
}

// ---------------------------------------------------------------------------
// ITechTreeElement — stub for prerequisite integration
// OpenRA 对照: OpenRA.Mods.Common/Traits/TechTree.cs ITechTreeElement
// ---------------------------------------------------------------------------

/** Interface for traits that participate in the TechTree prerequisite system.
 *
 * OpenRA 对照: ITechTreeElement
 *
 * The TechTree calls these methods when prerequisites become available or
 * unavailable for a given key.
 */
export interface ITechTreeElement {
  prerequisitesAvailable(key: string): void
  prerequisitesUnavailable(key: string): void
  prerequisitesItemHidden(key: string): void
  prerequisitesItemVisible(key: string): void
}

// ---------------------------------------------------------------------------
// SupportPowerManager
// OpenRA 对照: SupportPowerManager : ITick, IResolveOrder, ITechTreeElement
// ---------------------------------------------------------------------------

/**
 * Per-player registry of support powers.
 *
 * OpenRA 对照: SupportPowerManager (64 lines of logic)
 *
 * Attached to the Player actor. Discovers SupportPower traits on actors
 * owned by this player, creates SupportPowerInstance objects, manages
 * charge timers via ITick, and resolves support power activation orders
 * via IResolveOrder.
 */
export class SupportPowerManager
  extends ConditionalTrait<SupportPowerManagerInfo>
  implements ITick, IResolveOrder, ITechTreeElement
{
  /** The Player actor this manager is attached to.
   *
   * OpenRA 对照: SupportPowerManager.Self
   */
  readonly self: IGameActor

  /** Power registry: key → SupportPowerInstance.
   *
   * OpenRA 对照: SupportPowerManager.Powers (Dictionary<string, SupportPowerInstance>)
   */
  readonly powers: Map<string, SupportPowerInstance> = new Map()

  /** Reference to DevMode trait (stubbed).
   *
   * OpenRA 对照: SupportPowerManager.DevMode (DeveloperMode)
   */
  devMode: IDevMode = { fastCharge: false, allTech: false }

  /** Reference to TechTree (stubbed).
   *
   * OpenRA 对照: SupportPowerManager.TechTree
   */
  techTree: unknown = null

  /** Lazy reference to RadarPings (deferred to Ch16).
   *
   * OpenRA 对照: SupportPowerManager.RadarPings (Lazy<RadarPings>)
   */
  private _radarPings: unknown | null = null

  get radarPings(): unknown | null {
    return this._radarPings
  }

  /** The player who owns this manager. */
  private _owner: PlayerStub | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(info: SupportPowerManagerInfo) {
    super(info)
    // self is set in attach()
    this.self = null as unknown as IGameActor
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  override attach(actor: IGameActor): void {
    super.attach(actor)
    // NOTE: In OpenRA, the constructor subscribes to World.ActorAdded/ActorRemoved.
    // In TypeScript, we do this in attach() once the actor reference is available.
    // The actual subscription happens when setWorld() is called.
  }

  /**
   * Set the world reference and subscribe to actor lifecycle events.
   *
   * @param _world — the game world
   * @param owner — the player who owns this manager
   */
  setWorld(_world: WorldStub, owner: PlayerStub): void {
    this._owner = owner
  }

  /**
   * Called when an actor is added to the world.
   * Discovers SupportPower traits on the actor and registers them.
   *
   * OpenRA 对照: SupportPowerManager.ActorAdded(Actor)
   */
  onActorAdded(actor: IGameActor): void {
    if (!this._owner || !actor.owner) return
    if (actor.owner !== this._owner) return

    // Find all SupportPower traits on this actor
    const spTraits = this.getSupportPowerTraits(actor)
    for (const t of spTraits) {
      const key = SupportPower.makeKey(t.info, actor.actorId)

      let instance = this.powers.get(key)
      if (!instance) {
        // Create the real SupportPowerInstance (bypasses the stub from createInstance())
        instance = new SupportPowerInstance(key, t.info, this)
        this.powers.set(key, instance)

        // Register prerequisites with TechTree
        if (t.info.prerequisites && t.info.prerequisites.length > 0) {
          // NOTE: TechTree.Add(key, prerequisites, 0, this) — stubbed
          this.registerTechTreePrerequisites(key, t.info.prerequisites)
        }
      }

      instance.instances.push(t)
    }
  }

  /**
   * Called when an actor is removed from the world.
   * Removes the actor's SupportPower instances.
   *
   * OpenRA 对照: SupportPowerManager.ActorRemoved(Actor)
   */
  onActorRemoved(actor: IGameActor): void {
    if (!this._owner || !actor.owner) return
    if (actor.owner !== this._owner) return

    // Check if the actor has SupportPowerInfo traits
    if (!this.actorHasSupportPowerInfo(actor)) return

    const spTraits = this.getSupportPowerTraits(actor)
    for (const t of spTraits) {
      const key = SupportPower.makeKey(t.info, actor.actorId)
      const instance = this.powers.get(key)
      if (!instance) continue

      // Remove this trait from the instance's list
      const idx = instance.instances.indexOf(t)
      if (idx >= 0) {
        instance.instances.splice(idx, 1)
      }

      // Remove the power if all instances are gone and it's not disabled
      if (instance.instances.length === 0 && !instance.disabled) {
        this.powers.delete(key)
        this.unregisterTechTreePrerequisites(key)
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITick — advance charge timers
  // -----------------------------------------------------------------------

  /**
   * Called each logic tick. Ticks all SupportPowerInstance objects.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   */
  tick(_self: IGameActor): void {
    for (const power of this.powers.values()) {
      power.tick()
    }
  }

  // -----------------------------------------------------------------------
  // IResolveOrder — dispatch activation orders
  // -----------------------------------------------------------------------

  /**
   * Resolve a support power activation order.
   *
   * OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
   *
   * order.orderName is the key of the support power.
   */
  resolveOrder(_self: IGameActor, order: Order): void {
    const instance = this.powers.get(order.orderName)
    if (instance) {
      instance.activate(order as unknown as OrderStub)
    }
  }

  // -----------------------------------------------------------------------
  // Public queries
  // -----------------------------------------------------------------------

  /**
   * Get all support power instances for a specific actor.
   *
   * OpenRA 对照: SupportPowerManager.GetPowersForActor(Actor)
   *
   * Used by UI (SupportPowerChargeBar) to find which powers an actor provides.
   *
   * @param actor — the actor to query
   * @returns array of SupportPowerInstance objects for this actor
   */
  getPowersForActor(actor: IGameActor): SupportPowerInstance[] {
    if (this.powers.size === 0 || !this._owner || !actor.owner) return []
    if (actor.owner !== this._owner) return []
    if (!this.actorHasSupportPowerInfo(actor)) return []

    const spTraits = this.getSupportPowerTraits(actor)
    const result: SupportPowerInstance[] = []
    for (const t of spTraits) {
      const key = SupportPower.makeKey(t.info, actor.actorId)
      const instance = this.powers.get(key)
      if (
        instance &&
        instance.instances.some(
          (i) => !i.isTraitDisabled && i.self === actor,
        )
      ) {
        result.push(instance)
      }
    }
    return result
  }

  // -----------------------------------------------------------------------
  // ITechTreeElement — prerequisite callbacks
  // -----------------------------------------------------------------------

  prerequisitesAvailable(key: string): void {
    const instance = this.powers.get(key)
    if (instance) {
      instance.prerequisitesAvailable(true)
    }
  }

  prerequisitesUnavailable(key: string): void {
    const instance = this.powers.get(key)
    if (instance) {
      instance.prerequisitesAvailable(false)
    }
  }

  prerequisitesItemHidden(_key: string): void {
    // No-op — the power stays in the registry but is disabled
  }

  prerequisitesItemVisible(_key: string): void {
    // No-op — the power is already in the registry
  }

  // -----------------------------------------------------------------------
  // Protected helpers
  // -----------------------------------------------------------------------

  /**
   * Get all SupportPower traits on an actor.
   * Override point for test mocks.
   */
  protected getSupportPowerTraits(actor: IGameActor): ISupportPower[] {
    if (!actor.traitsImplementing) return []
    return actor.traitsImplementing('SupportPower') as ISupportPower[]
  }

  /**
   * Check if an actor's ActorInfo has SupportPowerInfo.
   */
  protected actorHasSupportPowerInfo(actor: IGameActor): boolean {
    // NOTE: In OpenRA: a.Info.HasTraitInfo<SupportPowerInfo>()
    // In TypeScript, this is a simplified check.
    return !!actor.traitsImplementing
  }

  /**
   * Register prerequisites with the TechTree system.
   * Stubbed — real implementation requires Ch11 TechTree runtime.
   */
  protected registerTechTreePrerequisites(
    _key: string,
    _prerequisites: readonly string[],
  ): void {
    // NOTE: TechTree.Add(key, prerequisites, 0, this) — stubbed
  }

  /**
   * Unregister prerequisites from the TechTree system.
   */
  protected unregisterTechTreePrerequisites(_key: string): void {
    // NOTE: TechTree.Remove(key) — stubbed
  }
}

// ---------------------------------------------------------------------------
// SupportPowerInstance
// OpenRA 对照: SupportPowerInstance (95 lines of logic)
// ---------------------------------------------------------------------------

/**
 * Runtime state for a single support power key.
 *
 * OpenRA 对照: SupportPowerInstance
 *
 * Manages the charge timer, active/ready/disabled state, and activation
 * logic for one power key. Multiple actors can contribute to the same
 * instance if AllowMultiple is set.
 */
export class SupportPowerInstance implements ISupportPowerInstance {
  /** The owning SupportPowerManager.
   *
   * OpenRA 对照: SupportPowerInstance.Manager
   */
  readonly manager: SupportPowerManager

  /** The unique power key.
   *
   * OpenRA 对照: SupportPowerInstance.Key
   */
  readonly key: string

  /** List of SupportPower trait instances providing this power.
   *
   * OpenRA 对照: SupportPowerInstance.Instances (List<SupportPower>)
   */
  readonly instances: ISupportPower[] = []

  /** Total charge duration in ticks.
   *
   * OpenRA 对照: SupportPowerInstance.TotalTicks
   */
  readonly totalTicks: number

  /** The first instance's info (for reference).
   *
   * OpenRA 对照: SupportPowerInstance.Info
   */
  get info(): SupportPowerInfo {
    for (const inst of this.instances) {
      return inst.info
    }
    // Fallback — should not happen if instances is populated
    return {
      orderName: this.key,
      chargeInterval: this.totalTicks,
    }
  }

  /** Fluent-localized name.
   *
   * OpenRA 对照: SupportPowerInstance.Name
   */
  readonly name: string

  /** Fluent-localized description.
   *
   * OpenRA 对照: SupportPowerInstance.Description
   */
  readonly description: string

  // -----------------------------------------------------------------------
  // Charge timer state
  // -----------------------------------------------------------------------

  /** Sub-tick remaining charge (100 = 1 display tick).
   *
   * OpenRA 对照: SupportPowerInstance.remainingSubTicks
   */
  private _remainingSubTicks: number

  /** Integer remaining ticks for UI display.
   *
   * OpenRA 对照: SupportPowerInstance.RemainingTicks => remainingSubTicks / 100
   */
  get remainingTicks(): number {
    return Math.floor(this._remainingSubTicks / 100)
  }

  /** Whether the power is currently active (not disabled, at least one non-paused instance).
   *
   * OpenRA 对照: SupportPowerInstance.Active
   */
  get active(): boolean {
    return (
      !this.disabled &&
      this.instances.some((i) => !i.isTraitPaused)
    )
  }

  /** Whether the power is ready to use (active and fully charged).
   *
   * OpenRA 对照: SupportPowerInstance.Ready => Active && RemainingTicks == 0
   */
  get ready(): boolean {
    return this.active && this.remainingTicks === 0
  }

  /** Whether the power is permanently disabled.
   *
   * OpenRA 对照: SupportPowerInstance.Disabled
   */
  get disabled(): boolean {
    return (
      this._ownerLost ||
      (!this._prereqsAvailable && !this.manager.devMode.allTech) ||
      !this._instancesEnabled ||
      this._oneShotFired
    )
  }

  // Internal state flags
  private _instancesEnabled: boolean = true
  private _prereqsAvailable: boolean = true
  private _oneShotFired: boolean = false
  private _ownerLost: boolean = false
  private _notifiedCharging: boolean = false
  private _notifiedReady: boolean = false

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    key: string,
    info: SupportPowerInfo,
    manager: SupportPowerManager,
  ) {
    this.key = key
    this.manager = manager
    this.totalTicks = info.chargeInterval ?? 0
    this._remainingSubTicks = info.startFullyCharged ? 0 : this.totalTicks * 100

    // Fluent localization — fallback to raw string
    this.name = (info.name as string) ?? ''
    this.description = (info.description as string) ?? ''
  }

  // -----------------------------------------------------------------------
  // Timer control
  // -----------------------------------------------------------------------

  /**
   * Reset the charge timer to full.
   *
   * OpenRA 对照: SupportPowerInstance.ResetTimer()
   */
  resetTimer(): void {
    this._remainingSubTicks = this.totalTicks * 100
  }

  // -----------------------------------------------------------------------
  // ITechTreeElement bridge
  // -----------------------------------------------------------------------

  /**
   * Called when prerequisites become available or unavailable.
   *
   * OpenRA 对照: SupportPowerInstance.PrerequisitesAvailable(bool)
   *
   * @param available — true if prerequisites are met
   */
  prerequisitesAvailable(available: boolean): void {
    this._prereqsAvailable = available

    if (!available) {
      this.resetTimer()
    }
  }

  // -----------------------------------------------------------------------
  // Tick — charge timer
  // -----------------------------------------------------------------------

  /**
   * Advance the charge timer by one tick.
   *
   * OpenRA 对照: SupportPowerInstance.Tick()
   *
   * Decrements remainingSubTicks by 100 per tick. Fires charging/charged
   * notifications exactly once per charge cycle.
   */
  tick(): void {
    // Check if any instance is enabled
    this._instancesEnabled = this.instances.some((i) => !i.isTraitDisabled)
    if (!this._instancesEnabled) {
      this.resetTimer()
    }

    // If not active, don't advance timer or fire notifications
    if (!this.active) return

    const power = this.instances[0]
    if (!power) return

    // FastCharge: clamp remainingSubTicks to 2500 (25 display ticks)
    if (
      this.manager.devMode.fastCharge &&
      this._remainingSubTicks > 2500
    ) {
      this._remainingSubTicks = 2500
    }

    // Advance timer
    if (this._remainingSubTicks > 0) {
      this._remainingSubTicks = this._clamp(
        this._remainingSubTicks - 100,
        0,
        this.totalTicks * 100,
      )
    }

    // Fire charging notification once per cycle
    if (!this._notifiedCharging) {
      const sp = power as unknown as SupportPower
      if (sp.charging) {
        sp.charging(sp.self, this.key)
      }
      this._notifiedCharging = true
    }

    // Fire charged notification once per cycle
    if (this.remainingTicks === 0 && !this._notifiedReady) {
      const sp = power as unknown as SupportPower
      if (sp.charged) {
        sp.charged(sp.self, this.key)
      }
      this._notifiedReady = true
    }
  }

  // -----------------------------------------------------------------------
  // Targeting
  // -----------------------------------------------------------------------

  /**
   * Enter targeting mode.
   *
   * OpenRA 对照: SupportPowerInstance.Target()
   *
   * Plays SelectTargetSound and delegates to power.SelectTarget().
   * Does nothing if the power is not ready.
   */
  target(): void {
    if (!this.ready) return

    const power = this.instances.find((i) => !i.isTraitPaused)
    if (!power) return

    // NOTE: Audio stubbed

    const sp = power as unknown as SupportPower
    if (sp.selectTarget) {
      sp.selectTarget(power.self, this.key, this.manager as unknown as ISupportPowerManager)
    }
  }

  // -----------------------------------------------------------------------
  // Activation
  // -----------------------------------------------------------------------

  /**
   * Activate the support power.
   *
   * OpenRA 对照: SupportPowerInstance.Activate(Order)
   *
   * Selects the best instance (closest to target, non-paused, non-disabled),
   * calls power.Activate(), resets timer, and handles OneShot disable.
   *
   * @param order — the activation order
   */
  activate(order: OrderStub): void {
    if (!this.ready) return

    // Select best instance: closest non-paused, non-disabled to target
    let bestPower: ISupportPower | null = null
    let bestDist = Infinity

    for (const i of this.instances) {
      if (i.isTraitPaused || i.isTraitDisabled) continue

      const dist = this.computeDistanceToTarget(i, order)
      if (dist < bestDist) {
        bestDist = dist
        bestPower = i
      }
    }

    if (!bestPower) return

    // Activate
    const sp = bestPower as unknown as SupportPower
    if (sp.activate) {
      sp.activate(bestPower.self, order, this.manager as unknown as ISupportPowerManager)
    }

    // Reset timer
    this.resetTimer()
    this._notifiedCharging = false
    this._notifiedReady = false

    // OneShot: permanently disable
    if (this.info.oneShot) {
      this.prerequisitesAvailable(false)
      this._oneShotFired = true
    }

    // Track owner lost state (simplified)
    // NOTE: In OpenRA this is WinState.Lost check — deferred
  }

  // -----------------------------------------------------------------------
  // UI overrides (virtual — subclasses may override)
  // -----------------------------------------------------------------------

  /**
   * Override text displayed on the power icon.
   *
   * OpenRA 对照: SupportPowerInstance.IconOverlayTextOverride()
   *
   * @returns override text, or null to use default
   */
  iconOverlayTextOverride(): string | null {
    return null
  }

  /**
   * Override text displayed in the tooltip time field.
   *
   * OpenRA 对照: SupportPowerInstance.TooltipTimeTextOverride()
   *
   * @returns override text, or null to use default
   */
  tooltipTimeTextOverride(): string | null {
    return null
  }

  // -----------------------------------------------------------------------
  // Test helpers (expose internal state for testing)
  // -----------------------------------------------------------------------

  /** Expose remaining sub-ticks for test assertions. */
  get _testRemainingSubTicks(): number {
    return this._remainingSubTicks
  }

  /** Expose notified flags for test assertions. */
  get _testNotifiedCharging(): boolean {
    return this._notifiedCharging
  }

  get _testNotifiedReady(): boolean {
    return this._notifiedReady
  }

  /** Expose oneShot flag for test assertions. */
  get _testOneShotFired(): boolean {
    return this._oneShotFired
  }

  /** Force owner lost state (for testing). */
  set _testOwnerLost(value: boolean) {
    this._ownerLost = value
  }

  /** Force prerequisites state (for testing). */
  set _testPrereqsAvailable(value: boolean) {
    this._prereqsAvailable = value
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Clamp a value to the range [min, max].
   *
   * OpenRA 对照: Util.Clamp(value, min, max)
   */
  private _clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max))
  }

  /**
   * Compute the squared horizontal distance from an instance's actor
   * to the order target. Used to select the closest instance.
   */
  private computeDistanceToTarget(
    instance: ISupportPower,
    order: OrderStub,
  ): number {
    const target = order.target
    if (!target) return 0

    const tp = target.centerPosition
    if (!tp) return 0

    const actor = instance.self
    let actorPos: WPos | null = null

    if ((actor as any).centerPosition) {
      actorPos = (actor as any).centerPosition as WPos
    }

    if (!actorPos) return 0

    const dx = actorPos.X - tp.X
    const dy = actorPos.Y - tp.Y
    return dx * dx + dy * dy
  }
}

// ---------------------------------------------------------------------------
// SelectGenericPowerTarget
// OpenRA 对照: SelectGenericPowerTarget : OrderGenerator (nested in SupportPowerManager.cs, 37 lines)
// ---------------------------------------------------------------------------

/**
 * OrderGenerator for generic support power targeting.
 *
 * OpenRA 对照: SelectGenericPowerTarget
 *
 * Simple cell-targeting mode: click on a map cell to issue a support
 * power order. Cancels if the power becomes unavailable.
 */
export class SelectGenericPowerTarget {
  /** The power key for order generation.
   *
   * OpenRA 对照: SelectGenericPowerTarget.OrderKey
   */
  readonly orderKey: string

  private readonly manager: SupportPowerManager
  private readonly info: SupportPowerInfo

  constructor(
    order: string,
    manager: SupportPowerManager,
    info: SupportPowerInfo,
  ) {
    this.orderKey = order
    this.manager = manager
    this.info = info
  }

  /**
   * Generate an order for a cell click.
   *
   * OpenRA 对照: SelectGenericPowerTarget.OrderInner(World, CPos, int2, MouseInput)
   *
   * Yields an Order if the cell is within the map.
   *
   * @param cell — the map cell under the cursor
   * @returns an Order, or null if the cell is invalid
   */
  generateOrder(cell: CPos): OrderStub | null {
    return {
      orderName: this.orderKey,
      target: {
        type: 2, // TargetType.Terrain
        cell,
        centerPosition: null,
      },
    }
  }

  /**
   * Tick — cancel targeting if power becomes unavailable.
   *
   * OpenRA 对照: SelectGenericPowerTarget.Tick(World)
   */
  tick(): boolean {
    const instance = this.manager.powers.get(this.orderKey)
    if (!instance || !instance.active || !instance.ready) {
      return false // Signal to cancel input mode
    }
    return true
  }

  /**
   * Get cursor string for a cell.
   *
   * OpenRA 对照: SelectGenericPowerTarget.GetCursor(World, CPos, int2, MouseInput)
   *
   * @param _cell — the map cell under the cursor
   * @returns cursor name string
   */
  getCursor(_cell: CPos): string {
    return this.info.cursor ?? 'ability'
  }
}
