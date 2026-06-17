/**
 * GrantPrerequisiteChargeDrainPower.ts — 可消耗的先决条件授予支援能力
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/SupportPowers/GrantPrerequisiteChargeDrainPower.cs (197 lines)
 *
 * 核心范式转换:
 * - C# SupportPower (extends) → TypeScript SupportPower abstract class
 * - C# ITechTreePrerequisite dynamic prerequisite → TypeScript prerequisite provider
 * - C# DischargeableSupportPowerInstance (inner class) → TypeScript inner class
 * - C# TechTree.ActorChanged() → TypeScript tech tree notification stub
 * - C# INotifyOwnerChanged → TypeScript owner change notification
 * - C# remainingSubTicks sub-tick charge tracking → TypeScript number counter
 */

import {
  SupportPower,
  type SupportPowerInfo,
  type ISupportPowerManager,
  type ISupportPowerInstance,
  type ISupportPower,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// GrantPrerequisiteChargeDrainPowerInfo
// OpenRA 对照: GrantPrerequisiteChargeDrainPowerInfo : SupportPowerInfo, ITechTreePrerequisiteInfo
// ---------------------------------------------------------------------------

/** Configuration for the prerequisite-granting drain power.
 *
 * OpenRA 对照: GrantPrerequisiteChargeDrainPowerInfo
 */
export class GrantPrerequisiteChargeDrainPowerInfo implements ITraitInfo {
  /** Rate at which the power discharges compared to charging.
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPowerInfo.DischargeModifier
   */
  readonly dischargeModifier: number

  /** The prerequisite type that this provides when active.
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPowerInfo.Prerequisite
   */
  readonly prerequisite: string

  /** Label displayed while the power is active.
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPowerInfo.ActiveText
   */
  readonly activeText: string

  /** Label displayed while the power is available but not active.
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPowerInfo.AvailableText
   */
  readonly availableText: string

  /** Support power base fields. */
  readonly orderName: string = 'GrantPrerequisiteChargeDrainPowerInfoOrder'
  readonly chargeInterval: number = 0
  readonly cursor: string = 'power'
  readonly allowMultiple: boolean = false

  constructor(params?: {
    dischargeModifier?: number
    prerequisite?: string
    activeText?: string
    availableText?: string
    orderName?: string
    chargeInterval?: number
  }) {
    this.dischargeModifier = params?.dischargeModifier ?? 300
    this.prerequisite = params?.prerequisite ?? ''
    this.activeText = params?.activeText ?? 'ACTIVE'
    this.availableText = params?.availableText ?? 'READY'
    if (params?.orderName) this.orderName = params.orderName
    if (params?.chargeInterval !== undefined) this.chargeInterval = params.chargeInterval
  }

  create(init: IGameActor): GrantPrerequisiteChargeDrainPower {
    return new GrantPrerequisiteChargeDrainPower(init, this)
  }
}

// ---------------------------------------------------------------------------
// GrantPrerequisiteChargeDrainPower
// OpenRA 对照: GrantPrerequisiteChargeDrainPower : SupportPower, ITechTreePrerequisite, INotifyOwnerChanged
// ---------------------------------------------------------------------------

/** Grants a prerequisite while discharging at a configurable rate.
 *
 * OpenRA 对照: GrantPrerequisiteChargeDrainPower
 *
 * When active, the power continuously drains its charge while providing
 * a tech tree prerequisite (unlocking buildings/units). The power can be
 * toggled on/off via the support power activation UI.
 */
export class GrantPrerequisiteChargeDrainPower extends SupportPower {
  declare readonly info: GrantPrerequisiteChargeDrainPowerInfo

  /** TechTree reference for prerequisite management.
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPower.techTree
   */
  private _techTree: unknown = null

  /** Whether this power is currently active (draining).
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPower.active
   */
  private _active: boolean = false

  /** Prerequisite names provided by this power.
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPower.prerequisites
   */
  private readonly _prerequisites: readonly string[]

  constructor(self: IGameActor, info: GrantPrerequisiteChargeDrainPowerInfo) {
    const spInfo: SupportPowerInfo = {
      orderName: info.orderName,
      chargeInterval: info.chargeInterval,
      cursor: info.cursor,
      allowMultiple: info.allowMultiple,
    }
    super(self, spInfo)
    ;(this as any).info = info
    this._prerequisites = [info.prerequisite]
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Resolve TechTree reference after creation.
   *
   * OpenRA 对照: Created(Actor)
   */
  protected override onCreated(self: IGameActor): void {
    const playerActor = (self as any).owner?.playerActor
    if (playerActor) {
      this._techTree =
        (playerActor as any).traitsImplementing?.('TechTree')?.[0] ?? null
    }
  }

  // -------------------------------------------------------------------------
  // INotifyOwnerChanged
  // -------------------------------------------------------------------------

  /** Handle owner change.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(self: IGameActor, _oldOwner: unknown, newOwner: unknown): void {
    const playerActor = (newOwner as any)?.playerActor
    if (playerActor) {
      this._techTree =
        (playerActor as any).traitsImplementing?.('TechTree')?.[0] ?? null
    }
    this._active = false
    void self
  }

  // -------------------------------------------------------------------------
  // CreateInstance — returns DischargeableSupportPowerInstance
  // -------------------------------------------------------------------------

  /** Create a DischargeableSupportPowerInstance for this power.
   *
   * OpenRA 对照: CreateInstance(string, SupportPowerManager)
   */
  override createInstance(
    key: string,
    manager: ISupportPowerManager,
  ): ISupportPowerInstance {
    return new DischargeableSupportPowerInstance(
      key,
      this.info,
      manager,
      this,
    )
  }

  // -------------------------------------------------------------------------
  // Activate / Deactivate
  // -------------------------------------------------------------------------

  /** Activate the power (start draining and granting prerequisite).
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPower.Activate(Actor)
   */
  activatePower(self: IGameActor): void {
    this._active = true
    if (this._techTree && typeof (this._techTree as any).actorChanged === 'function') {
      ;(this._techTree as any).actorChanged(self)
    }
  }

  /** Deactivate the power (stop draining and revoke prerequisite).
   *
   * OpenRA 对照: GrantPrerequisiteChargeDrainPower.Deactivate(Actor)
   */
  deactivatePower(self: IGameActor): void {
    this._active = false
    if (this._techTree && typeof (this._techTree as any).actorChanged === 'function') {
      ;(this._techTree as any).actorChanged(self)
    }
  }

  // -------------------------------------------------------------------------
  // ITechTreePrerequisite
  // -------------------------------------------------------------------------

  /** Prerequisites provided by this power (empty when inactive).
   *
   * OpenRA 对照: ITechTreePrerequisite.ProvidesPrerequisites
   */
  get providesPrerequisites(): readonly string[] {
    return this._active ? this._prerequisites : []
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether the power is currently active.
   */
  get active(): boolean {
    return this._active
  }
}

// ---------------------------------------------------------------------------
// DischargeableSupportPowerInstance
// OpenRA 对照: GrantPrerequisiteChargeDrainPower.DischargeableSupportPowerInstance : SupportPowerInstance
// ---------------------------------------------------------------------------

/** Support power instance that can be toggled on/off and drains over time.
 *
 * OpenRA 对照: DischargeableSupportPowerInstance
 *
 * When active, the power discharges at a configurable rate (faster than it
 * charges). When fully depleted, it deactivates and cannot be reactivated
 * until fully charged again.
 */
export class DischargeableSupportPowerInstance implements ISupportPowerInstance {
  readonly key: string
  readonly info: GrantPrerequisiteChargeDrainPowerInfo
  readonly instances: ISupportPower[] = []
  readonly totalTicks: number

  private readonly _manager: ISupportPowerManager
  private readonly _power: GrantPrerequisiteChargeDrainPower

  /** Whether the power is available to activate (even if not fully charged).
   *
   * OpenRA 对照: DischargeableSupportPowerInstance.available
   */
  private _available: boolean = false

  /** Whether the power is active right now.
   *
   * OpenRA 对照: DischargeableSupportPowerInstance.active
   */
  private _active: boolean = false

  /** Remaining sub-ticks of charge (100 sub-ticks per tick).
   *
   * OpenRA 对照: SupportPowerInstance.remainingSubTicks
   */
  private _remainingSubTicks: number = 0

  /** Whether the charging notification has been sent.
   *
   * OpenRA 对照: SupportPowerInstance.notifiedCharging
   */
  private _notifiedCharging: boolean = false

  /** Additional discharge sub-ticks accrued from damage.
   *
   * OpenRA 对照: DischargeableSupportPowerInstance.additionalDischargeSubTicks
   */
  private _additionalDischargeSubTicks: number = 0

  constructor(
    key: string,
    info: GrantPrerequisiteChargeDrainPowerInfo,
    manager: ISupportPowerManager,
    power: GrantPrerequisiteChargeDrainPower,
  ) {
    this.key = key
    this.info = info
    this._manager = manager
    this._power = power
    this.totalTicks = info.chargeInterval
    this._remainingSubTicks = this.totalTicks * 100
    this.instances = [power as unknown as ISupportPower]
  }

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  /** Base-level Active: true when at least one instance is not trait-paused.
   *
   * OpenRA 对照: SupportPowerInstance.Active (base property)
   */
  private get _baseActive(): boolean {
    return this.instances.some((i) => !i.isTraitPaused)
  }

  get remainingTicks(): number {
    return Math.floor(this._remainingSubTicks / 100)
  }

  get active(): boolean {
    return this._active || this._available
  }

  get ready(): boolean {
    return this._remainingSubTicks <= 0
  }

  get disabled(): boolean {
    return !this._available && !this._active && !this.ready
  }

  // -------------------------------------------------------------------------
  // Deactivation
  // -------------------------------------------------------------------------

  /** Deactivate the power.
   *
   * OpenRA 对照: Deactivate()
   */
  private _deactivate(): void {
    this._active = false
    this._notifiedCharging = false

    // Fully depleting the charge disables the power until recharged
    // C#: if (!Active || ...) — Active is base property checking Instances
    if (!this._baseActive || this._remainingSubTicks >= this.totalTicks * 100) {
      this._available = false
    }

    for (const p of this.instances) {
      ;(p as unknown as GrantPrerequisiteChargeDrainPower).deactivatePower(
        (p as any).self,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  /** Tick the dischargeable power.
   *
   * OpenRA 对照: Tick()
   */
  tick(): void {
    const orig = this._remainingSubTicks

    // Base tick logic: charge toward zero
    if (this._remainingSubTicks > 0 && !this._active) {
      this._remainingSubTicks -= 100 // Charge 1 tick per tick
      if (this._remainingSubTicks < 0) this._remainingSubTicks = 0
    }

    if (this.ready) {
      this._available = true
    }

    // C#: if (active && !Active) — Active is base property
    if (this._active && !this._baseActive) {
      this._deactivate()
    }

    if (this._active) {
      this._remainingSubTicks =
        orig + this.info.dischargeModifier + this._additionalDischargeSubTicks
      this._additionalDischargeSubTicks = 0

      if (this._remainingSubTicks > this.totalTicks * 100) {
        this._remainingSubTicks = this.totalTicks * 100
        this._deactivate()
      }
    }
  }

  // -------------------------------------------------------------------------
  // Discharge (from damage)
  // -------------------------------------------------------------------------

  /** Add discharge from external sources (e.g., damage).
   *
   * OpenRA 对照: Discharge(subTicks)
   */
  discharge(subTicks: number): void {
    this._additionalDischargeSubTicks += subTicks
  }

  // -------------------------------------------------------------------------
  // Target (UI activation)
  // -------------------------------------------------------------------------

  /** Toggle activation when the power is targeted in UI.
   *
   * OpenRA 对照: Target()
   */
  target(): void {
    // C#: if (available && Active) — Active is base property
    if (this._available && this._baseActive) {
      const world = (this._manager.self as any).world
      if (world?.issueOrder) {
        world.issueOrder({
          orderName: this.key,
          subject: this._manager.self,
          extraData: this._active ? 0 : 1,
          queued: false,
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // Activate
  // -------------------------------------------------------------------------

  /** Activate or deactivate the power based on order extra data.
   *
   * OpenRA 对照: Activate(Order)
   */
  activate(order: { extraData?: number }): void {
    // Deactivate if currently active and order says to (extraData == 0)
    if (this._active && (order.extraData ?? 1) === 0) {
      this._deactivate()
      return
    }

    // Activate if available and order says to (extraData == 1)
    if (!this._available || (order.extraData ?? 0) !== 1) return

    const power = this.instances.find((i) => !i.isTraitPaused)
    if (!power) return

    this._active = true

    // Play activation sound once
    ;(power as unknown as GrantPrerequisiteChargeDrainPower).playLaunchSounds()

    for (const p of this.instances) {
      ;(p as unknown as GrantPrerequisiteChargeDrainPower).activatePower(
        (p as any).self,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Icon/Tooltip text overrides
  // -------------------------------------------------------------------------

  /** Get the text overlay for the icon.
   *
   * OpenRA 对照: IconOverlayTextOverride()
   */
  iconOverlayTextOverride(): string | null {
    return this._getTextOverride()
  }

  /** Get the tooltip time text.
   *
   * OpenRA 对照: TooltipTimeTextOverride()
   */
  tooltipTimeTextOverride(): string | null {
    return this._getTextOverride()
  }

  private _getTextOverride(): string | null {
    // C#: if (!Active || ...) — Active is base property
    if (!this._baseActive) return null
    return this._active
      ? this.info.activeText
      : this._available
        ? this.info.availableText
        : null
  }

  // -------------------------------------------------------------------------
  // Queries (for testing)
  // -------------------------------------------------------------------------

  get available(): boolean {
    return this._available
  }

  get isActive(): boolean {
    return this._active
  }

  get remainingSubTicks(): number {
    return this._remainingSubTicks
  }
}
