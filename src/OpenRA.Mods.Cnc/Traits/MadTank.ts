/**
 * MadTank.ts — MAD坦克自爆攻击序列
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/MadTank.cs (255 lines)
 *
 * 核心范式转换:
 * - C# IIssueOrder/IResolveOrder → TypeScript order interfaces
 * - C# Activity (DetonationSequence inner class) → TypeScript activity class
 * - C# GrantCondition/PlayCustomAnimation → TypeScript stubs
 * - C# FireWarheadsOnDeath.EjectDriver() → TypeScript driver spawn stub
 * - C# WeaponInfo.Impact → TypeScript weapon impact stub
 * - C# TargetLineNode yield return → TypeScript array
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// MadTankInfo
// OpenRA 对照: MadTankInfo : TraitInfo, IRulesetLoaded, Requires<FireWarheadsOnDeathInfo>, Requires<WithFacingSpriteBodyInfo>
// ---------------------------------------------------------------------------

/** Configuration for the MAD Tank detonation trait.
 *
 * OpenRA 对照: MadTankInfo
 */
export class MadTankInfo implements ITraitInfo {
  /** Thump animation sequence.
   *
   * OpenRA 对照: MadTankInfo.ThumpSequence
   */
  readonly thumpSequence: string | null

  /** Interval between thump damage ticks.
   *
   * OpenRA 对照: MadTankInfo.ThumpInterval
   */
  readonly thumpInterval: number

  /** Weapon used for thump damage during charge-up.
   *
   * OpenRA 对照: MadTankInfo.ThumpDamageWeapon
   */
  readonly thumpDamageWeapon: string | null

  /** Charge delay before detonation (ticks).
   *
   * OpenRA 对照: MadTankInfo.ChargeDelay
   */
  readonly chargeDelay: number

  /** Charge sound.
   *
   * OpenRA 对照: MadTankInfo.ChargeSound
   */
  readonly chargeSound: string | null

  /** Detonation delay after charge (ticks).
   *
   * OpenRA 对照: MadTankInfo.DetonationDelay
   */
  readonly detonationDelay: number

  /** Detonation sound.
   *
   * OpenRA 对照: MadTankInfo.DetonationSound
   */
  readonly detonationSound: string | null

  /** Weapon used for final detonation.
   *
   * OpenRA 对照: MadTankInfo.DetonationWeapon
   */
  readonly detonationWeapon: string | null

  /** Driver actor to eject before detonation.
   *
   * OpenRA 对照: MadTankInfo.DriverActor
   */
  readonly driverActor: string | null

  /** Voice line for detonate commands.
   *
   * OpenRA 对照: MadTankInfo.Voice
   */
  readonly voice: string | null

  /** Condition granted while deployed.
   *
   * OpenRA 对照: MadTankInfo.DeployedCondition
   */
  readonly deployedCondition: string | null

  /** Damage types for self-destruction.
   *
   * OpenRA 对照: MadTankInfo.DamageTypes (BitSet<DamageType>)
   */
  readonly damageTypes: ReadonlySet<string>

  /** Cursor displayed when targeting.
   *
   * OpenRA 对照: MadTankInfo.AttackCursor
   */
  readonly attackCursor: string

  /** Cursor displayed when able to deploy.
   *
   * OpenRA 对照: MadTankInfo.DeployCursor
   */
  readonly deployCursor: string

  /** Weapon info references (loaded at ruleset time). */
  thumpDamageWeaponInfo: unknown = null
  detonationWeaponInfo: unknown = null

  constructor(params?: {
    thumpSequence?: string | null
    thumpInterval?: number
    thumpDamageWeapon?: string | null
    chargeDelay?: number
    chargeSound?: string | null
    detonationDelay?: number
    detonationSound?: string | null
    detonationWeapon?: string | null
    driverActor?: string | null
    voice?: string | null
    deployedCondition?: string | null
    damageTypes?: ReadonlySet<string>
    attackCursor?: string
    deployCursor?: string
  }) {
    this.thumpSequence = params?.thumpSequence ?? 'piston'
    this.thumpInterval = params?.thumpInterval ?? 8
    this.thumpDamageWeapon = params?.thumpDamageWeapon ?? 'MADTankThump'
    this.chargeDelay = params?.chargeDelay ?? 96
    this.chargeSound = params?.chargeSound ?? 'madchrg2.aud'
    this.detonationDelay = params?.detonationDelay ?? 42
    this.detonationSound = params?.detonationSound ?? 'madexplo.aud'
    this.detonationWeapon = params?.detonationWeapon ?? 'MADTankDetonate'
    this.driverActor = params?.driverActor ?? 'e1'
    this.voice = params?.voice ?? 'Action'
    this.deployedCondition = params?.deployedCondition ?? null
    this.damageTypes = params?.damageTypes ?? new Set()
    this.attackCursor = params?.attackCursor ?? 'attack'
    this.deployCursor = params?.deployCursor ?? 'deploy'
  }

  create(_init: IGameActor): MadTank {
    return new MadTank(this)
  }
}

// ---------------------------------------------------------------------------
// MadTank
// OpenRA 对照: MadTank : IIssueOrder, IResolveOrder, IOrderVoice, IIssueDeployOrder
// ---------------------------------------------------------------------------

/** MAD Tank detonation sequence trait.
 *
 * OpenRA 对照: MadTank
 *
 * Allows the MAD Tank to initiate a self-destruct sequence. During the
 * countdown, the tank plays a thump animation and deals AoE damage every
 * few ticks. At the end, it detonates dealing massive AoE damage and
 * self-destructs. A driver actor is ejected before the sequence begins.
 */
export class MadTank {
  readonly info: MadTankInfo

  /** Whether the detonation sequence has been initiated.
   *
   * OpenRA 对照: MadTank.initiated
   */
  initiated: boolean = false

  constructor(info: MadTankInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // IIssueOrder
  // -------------------------------------------------------------------------

  /** Resolve order targeting for MAD Tank deployment.
   *
   * OpenRA 对照: IIssueOrder.IssueOrder(Actor, IOrderTargeter, Target, bool)
   */
  issueOrder(
    _self: IGameActor,
    orderTargeter: { orderID: string },
    _target: unknown,
    queued: boolean,
  ): { orderName: string; subject: IGameActor; target: unknown; queued: boolean } | null {
    const orderID = orderTargeter.orderID
    if (orderID !== 'DetonateAttack' && orderID !== 'Detonate') return null

    return {
      orderName: orderID,
      subject: _self,
      target: _target,
      queued,
    }
  }

  // -------------------------------------------------------------------------
  // IIssueDeployOrder
  // -------------------------------------------------------------------------

  /** Issue a deploy order.
   *
   * OpenRA 对照: IIssueDeployOrder.IssueDeployOrder(Actor, bool)
   */
  issueDeployOrder(
    self: IGameActor,
    queued: boolean,
  ): { orderName: string; subject: IGameActor; queued: boolean } {
    return { orderName: 'Detonate', subject: self, queued }
  }

  /** Whether the deploy order can be issued.
   *
   * OpenRA 对照: IIssueDeployOrder.CanIssueDeployOrder(Actor, bool)
   */
  canIssueDeployOrder(): boolean {
    return true
  }

  // -------------------------------------------------------------------------
  // IOrderVoice
  // -------------------------------------------------------------------------

  /** Get the voice phrase for an order.
   *
   * OpenRA 对照: IOrderVoice.VoicePhraseForOrder(Actor, Order)
   */
  voicePhraseForOrder(_self: IGameActor, order: { orderName: string }): string | null {
    if (order.orderName !== 'DetonateAttack' && order.orderName !== 'Detonate') {
      return null
    }
    return this.info.voice
  }

  // -------------------------------------------------------------------------
  // IResolveOrder
  // -------------------------------------------------------------------------

  /** Resolve detonation orders.
   *
   * OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
   */
  resolveOrder(
    self: IGameActor,
    order: { orderName: string; queued: boolean; target?: unknown },
  ): void {
    if (order.orderName === 'DetonateAttack') {
      // C#: self.QueueActivity(order.Queued, new DetonationSequence(self, this, order.Target))
      const activity = new DetonationSequence(
        self,
        this,
        order.target ?? DetonationSequence.INVALID_TARGET,
      )
      this._queueActivity(self, order.queued, activity)
    } else if (order.orderName === 'Detonate') {
      // C#: self.QueueActivity(order.Queued, new DetonationSequence(self, this))
      const activity = new DetonationSequence(self, this)
      this._queueActivity(self, order.queued, activity)
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _queueActivity(
    self: IGameActor,
    queued: boolean,
    activity: DetonationSequence,
  ): void {
    const queueFn = (self as any).queueActivity as
      | ((queued: boolean, activity: unknown) => void)
      | undefined
    if (queueFn) queueFn(queued, activity)
  }

  /** Eject the driver actor.
   *
   * OpenRA 对照: EjectDriver() in DetonationSequence
   */
  ejectDriver(self: IGameActor): void {
    const world = (self as any).world
    if (!world) return

    const driverName = this.info.driverActor?.toLowerCase() ?? 'e1'

    // C#: var driver = self.World.CreateActor(...)
    // NOTE: Actor creation deferred — requires full Actor creation pipeline.
    // The driver spawns at the MAD Tank's location with the same owner.
  }
}

// ---------------------------------------------------------------------------
// DetonationSequence Activity
// OpenRA 对照: MadTank.DetonationSequence : Activity (inner class)
// ---------------------------------------------------------------------------

/** Activity that performs the MAD Tank detonation sequence.
 *
 * OpenRA 对照: DetonationSequence
 *
 * Phases:
 * 1. Move adjacent to target (if targeting a specific location)
 * 2. Initiate detonation (grant condition, eject driver, start thump animation)
 * 3. Charge phase (deal thump damage periodically, play charge sound)
 * 4. Detonate (deal massive AoE damage, kill self)
 */
export class DetonationSequence {
  /** Sentinel value for invalid/unset target.
   *
   * OpenRA 对照: Target.Invalid
   */
  static readonly INVALID_TARGET = Symbol('invalid-target')

  /** Type constant for invalid target. */
  static readonly TARGET_TYPE_INVALID = -1

  /** The MAD Tank actor. */
  readonly self: IGameActor

  /** The MAD Tank trait. */
  readonly mad: MadTank

  /** The attack target (or INVALID_TARGET if no specific target). */
  target: unknown

  /** Whether to assign target on first run. */
  private readonly _assignTargetOnFirstRun: boolean

  /** Tick counter since initiation. */
  private _ticks: number = 0

  /** Whether the detonation is being cancelled. */
  private _isCancelling: boolean = false

  /** Whether the sequence is interruptible. */
  private _isInterruptible: boolean = true

  /** Whether the sequence has been initiated. */
  private _initiated: boolean = false

  constructor(
    self: IGameActor,
    mad: MadTank,
    target?: unknown,
  ) {
    this.self = self
    this.mad = mad
    this.target = target
    this._assignTargetOnFirstRun = !target || target === DetonationSequence.INVALID_TARGET
  }

  // -------------------------------------------------------------------------
  // Activity lifecycle
  // -------------------------------------------------------------------------

  /** Called on first tick run.
   *
   * OpenRA 对照: OnFirstRun(Actor)
   */
  onFirstRun(): void {
    if (this._assignTargetOnFirstRun) {
      // C#: target = Target.FromCell(self.World, self.Location)
      const location = (this.self as any).location
      this.target = {
        type: 'cell',
        cell: location,
        centerPosition: (this.self as any).world?.map?.centerOfCell?.(location),
      }
    }
  }

  /** Tick the detonation sequence.
   *
   * OpenRA 对照: Tick(Actor) → returns boolean (true = done, false = continue)
   *
   * @returns true when the sequence is complete
   */
  tick(): boolean {
    if (this._isCancelling) return true

    // Check if target is still valid
    if (!this._initiated) {
      // If the target is invalid, abort
      if (!this.target || this.target === DetonationSequence.INVALID_TARGET) {
        return true
      }
    }

    if (!this._initiated) {
      // Initiate detonation
      this._initiate()

      if (this._isCancelling) return true
    }

    this._ticks++

    // Thump damage every thumpInterval ticks
    if (
      this._ticks % this.mad.info.thumpInterval === 0 &&
      this.mad.info.thumpDamageWeaponInfo
    ) {
      // C#: info.ThumpDamageWeaponInfo.Impact(Target.FromPos(self.CenterPosition), self)
      ;(this.mad.info.thumpDamageWeaponInfo as any)?.impact?.(
        { type: 'pos', position: (this.self as any).centerPosition },
        this.self,
      )
    }

    // Play charge sound at charge delay
    if (this._ticks === this.mad.info.chargeDelay && this.mad.info.chargeSound) {
      // NOTE: Game.Sound.Play(SoundType.World, info.ChargeSound, self.CenterPosition)
      // Audio stubbed — see Ch7 Phase D
    }

    // Complete after charge + detonation delay
    return this._ticks >= this.mad.info.chargeDelay + this.mad.info.detonationDelay
  }

  /** Called on the last tick.
   *
   * OpenRA 对照: OnLastRun(Actor)
   */
  onLastRun(): void {
    if (!this._initiated) return

    // Play detonation sound
    if (this.mad.info.detonationSound) {
      // NOTE: Game.Sound.Play(SoundType.World, info.DetonationSound, self.CenterPosition)
      // Audio stubbed
    }

    // Deal detonation damage and kill self
    // C#: self.World.AddFrameEndTask(w => { ... })
    const detonationWeapon = this.mad.info.detonationWeaponInfo
    if (detonationWeapon) {
      ;(detonationWeapon as any)?.impact?.(
        { type: 'pos', position: (this.self as any).centerPosition },
        this.self,
      )
    }

    // Kill self
    const killFn = (this.self as any).kill as
      | ((self: IGameActor, damageTypes: ReadonlySet<string>) => void)
      | undefined
    if (killFn) {
      killFn(this.self, this.mad.info.damageTypes)
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Initiate detonation
  // -------------------------------------------------------------------------

  /** Start the detonation sequence.
   */
  private _initiate(): void {
    // Grant deployed condition
    if (this.mad.info.deployedCondition) {
      const grantFn = (this.self as any).grantCondition as
        | ((condition: string) => number)
        | undefined
      if (grantFn) grantFn(this.mad.info.deployedCondition)
    }

    // Eject driver
    this.mad.ejectDriver(this.self)

    // Play thump animation
    if (this.mad.info.thumpSequence) {
      const wfsb = (this.self as any).traitsImplementing?.('WithFacingSpriteBody')?.[0]
      if (wfsb && typeof (wfsb as any).playCustomAnimationRepeating === 'function') {
        ;(wfsb as any).playCustomAnimationRepeating(
          this.self,
          this.mad.info.thumpSequence,
        )
      }
    }

    this._isInterruptible = false
    this.mad.initiated = true
    this._initiated = true
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether the activity is being cancelled.
   */
  get isCancelling(): boolean {
    return this._isCancelling
  }

  /** Cancel the sequence.
   */
  cancel(): void {
    this._isCancelling = true
  }

  /** Whether the activity can be interrupted.
   */
  get isInterruptible(): boolean {
    return this._isInterruptible
  }

  /** Set interruptible state.
   */
  set isInterruptible(value: boolean) {
    this._isInterruptible = value
  }

  /** Current tick count.
   */
  get ticks(): number {
    return this._ticks
  }

  /** Whether detonation has been initiated.
   */
  get initiated(): boolean {
    return this._initiated
  }
}
