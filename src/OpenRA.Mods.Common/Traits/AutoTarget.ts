/**
 * AutoTarget.ts -- Autonomous target acquisition and stance management
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AutoTarget.cs (485 lines)
 *
 * 核心范式转换:
 * - C# AutoTarget : ConditionalTrait<AutoTargetInfo>, INotifyIdle, INotifyDamage,
 *   ITick, IResolveOrder, ISync, INotifyOwnerChanged → TS interfaces
 * - C# UnitStance enum → TS const object with numeric comparison
 * - C# FindActorsInCircle → TS duck-typed spatial query
 * - C# AutoTargetPriorityInfo → TS IAutoTargetPriorityInfo interface
 * - C# ConditionByStance FrozenDictionary → TS ReadonlyMap<UnitStance, string>
 */

import {
  type IGameActor,
  type ITick,
  type ISync,
  ConditionalTrait,
  type ConditionalTraitInfo,
  PlayerRelationship,
  PlayerRelationshipExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { AttackBase, AttackSource } from './Attack/AttackBase.js'
import {
  UnitStance,
  type UnitStance as UnitStanceType,
  type IOverrideAutoTarget,
  type INotifyStanceChanged,
  type IAutoTargetPriorityInfo,
} from './CombatInterfaces.js'
import {
  isIOverrideAutoTarget,
  isINotifyStanceChanged,
  isIActivityNotifyStanceChanged,
} from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AutoTargetInfo
// OpenRA 对照: AutoTargetInfo (ConditionalTraitInfo, Requires<AttackBaseInfo>)
// ---------------------------------------------------------------------------

/** Configuration for AutoTarget.
 *
 *  OpenRA 对照: AutoTargetInfo
 */
export class AutoTargetInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Allow movement to hunt down enemies (when AttackAnything).
   *
   *  OpenRA 对照: AutoTargetInfo.AllowMovement
   */
  readonly allowMovement: boolean = true

  /** Allow turning to face enemies (when not HoldFire).
   *
   *  OpenRA 对照: AutoTargetInfo.AllowTurning
   */
  readonly allowTurning: boolean = true

  /** Scan for new targets when idle.
   *
   *  OpenRA 对照: AutoTargetInfo.ScanOnIdle
   */
  readonly scanOnIdle: boolean = true

  /** Override weapon max range (>1 to set manually, -1 = use weapon range).
   *
   *  OpenRA 对照: AutoTargetInfo.ScanRadius
   */
  readonly scanRadius: number = -1

  /** Initial stance for AI players.
   *
   *  OpenRA 对照: AutoTargetInfo.InitialStanceAI
   */
  readonly initialStanceAI: UnitStanceType = UnitStance.AttackAnything

  /** Initial stance for human players.
   *
   *  OpenRA 对照: AutoTargetInfo.InitialStance
   */
  readonly initialStance: UnitStanceType = UnitStance.Defend

  /** Condition per stance.
   *
   *  OpenRA 对照: AutoTargetInfo.ConditionByStance
   */
  readonly conditionByStance: ReadonlyMap<UnitStanceType, string> = new Map()

  /** Allow the player to change stance.
   *
   *  OpenRA 对照: AutoTargetInfo.EnableStances
   */
  readonly enableStances: boolean = true

  /** Min ticks between auto-target scans.
   *
   *  OpenRA 对照: AutoTargetInfo.MinimumScanTimeInterval
   */
  readonly minimumScanTimeInterval: number = 3

  /** Max ticks between auto-target scans.
   *
   *  OpenRA 对照: AutoTargetInfo.MaximumScanTimeInterval
   */
  readonly maximumScanTimeInterval: number = 8

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    allowMovement?: boolean
    allowTurning?: boolean
    scanOnIdle?: boolean
    scanRadius?: number
    initialStanceAI?: UnitStanceType
    initialStance?: UnitStanceType
    holdFireCondition?: string | null
    returnFireCondition?: string | null
    defendCondition?: string | null
    attackAnythingCondition?: string | null
    enableStances?: boolean
    minimumScanTimeInterval?: number
    maximumScanTimeInterval?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.allowMovement = params.allowMovement ?? true
    this.allowTurning = params.allowTurning ?? true
    this.scanOnIdle = params.scanOnIdle ?? true
    this.scanRadius = params.scanRadius ?? -1
    this.initialStanceAI = params.initialStanceAI ?? UnitStance.AttackAnything
    this.initialStance = params.initialStance ?? UnitStance.Defend

    // Build conditionByStance map
    const cbs = new Map<UnitStanceType, string>()
    if (params.holdFireCondition) cbs.set(UnitStance.HoldFire, params.holdFireCondition)
    if (params.returnFireCondition) cbs.set(UnitStance.ReturnFire, params.returnFireCondition)
    if (params.defendCondition) cbs.set(UnitStance.Defend, params.defendCondition)
    if (params.attackAnythingCondition) cbs.set(UnitStance.AttackAnything, params.attackAnythingCondition)
    this.conditionByStance = cbs

    this.enableStances = params.enableStances ?? true
    this.minimumScanTimeInterval = params.minimumScanTimeInterval ?? 3
    this.maximumScanTimeInterval = params.maximumScanTimeInterval ?? 8
  }
}

// ---------------------------------------------------------------------------
// AutoTarget
// OpenRA 对照: AutoTarget
// ---------------------------------------------------------------------------

/** Autonomous target acquisition and stance management.
 *
 *  OpenRA 对照: AutoTarget (ConditionalTrait, INotifyIdle, INotifyDamage, ITick, IResolveOrder, ISync, INotifyOwnerChanged)
 */
export class AutoTarget
  extends ConditionalTrait<AutoTargetInfo>
  implements ITick, ISync
{
  /** Current stance.
   *
   *  OpenRA 对照: AutoTarget.Stance
   */
  stance: UnitStanceType

  /** Predicted stance (UI-only, not synced).
   *
   *  OpenRA 对照: AutoTarget.PredictedStance
   */
  predictedStance: UnitStanceType

  /** Whether movement is allowed (AttackAnything + AllowMovement + has IMove).
   *
   *  OpenRA 对照: AutoTarget.AllowMove
   */
  get allowMove(): boolean {
    return this.info.allowMovement && this.stance > UnitStance.Defend
  }

  /** The actor that damaged us last (network-synced).
   *
   *  OpenRA 对照: AutoTarget.Aggressor
   */
  aggressor: IGameActor | null = null

  /** Active attack base traits. */
  readonly activeAttackBases: AttackBase[]

  // Internal state
  private nextScanTime: number = 0
  private overrideAutoTarget: IOverrideAutoTarget[] = []
  private notifyStanceChanged: INotifyStanceChanged[] = []
  private activeTargetPriorities: IAutoTargetPriorityInfo[] = []
  private conditionToken: number = -1

  constructor(info: AutoTargetInfo) {
    super(info)

    // Default stance (will be overridden by created())
    this.stance = info.initialStance
    this.predictedStance = info.initialStance

    // ActiveAttackBases will be set in attach
    this.activeAttackBases = []
  }

  /** Called when this trait is attached to an actor.
   *
   *  OpenRA 对照: AutoTarget constructor (finds AttackBases, sets stance)
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)

    // Find all AttackBase traits
    const actorAny = actor as unknown as {
      getTraits?: <T>(name: string) => T[]
    }
    const attackBases = (actorAny.getTraits?.<AttackBase>('attackBase') ?? [])
    ;(this as { activeAttackBases: AttackBase[] }).activeAttackBases =
      attackBases.filter(a => !a.isTraitDisabled)

    // Determine initial stance
    const owner = (actor as unknown as { owner?: { isBot?: boolean; playable?: boolean } }).owner
    const isAI = owner?.isBot || !owner?.playable
    this.stance = isAI ? this.info.initialStanceAI : this.info.initialStance
    this.predictedStance = this.stance
  }

  /** Initialize after actor creation.
   *
   *  OpenRA 对照: AutoTarget.Created()
   */
  created(self: IGameActor): void {
    const actorAny = self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }

    // Active target priorities
    const allTraits = actorAny.getTraits?.<unknown>('') ?? []
    this.overrideAutoTarget = allTraits.filter(isIOverrideAutoTarget) as IOverrideAutoTarget[]
    this.notifyStanceChanged = allTraits.filter(isINotifyStanceChanged) as INotifyStanceChanged[]

    // Build active target priorities from AutoTargetPriority traits
    const priorityTraits = allTraits.filter(
      t => typeof t === 'object' && t !== null && 'priority' in t,
    )
    this.activeTargetPriorities = priorityTraits
      .map(t => (t as unknown as { info: IAutoTargetPriorityInfo; isTraitDisabled?: boolean }))
      .filter(t => !t.isTraitDisabled)
      .map(t => t.info)
      .sort((a, b) => b.priority - a.priority)

    this.applyStanceCondition(self)
  }

  // ---------------------------------------------------------------------------
  // ITick
  // ---------------------------------------------------------------------------

  /** Tick: decrement nextScanTime.
   *
   *  OpenRA 对照: ITick.Tick(Actor)
   */
  tick(_self: IGameActor): void {
    if (this.isTraitDisabled) return

    if (this.nextScanTime > 0) {
      this.nextScanTime--
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyIdle
  // ---------------------------------------------------------------------------

  /** Scan for targets when idle.
   *
   *  OpenRA 对照: INotifyIdle.TickIdle(Actor)
   */
  tickIdle(self: IGameActor): void {
    if (
      this.isTraitDisabled ||
      !this.info.scanOnIdle ||
      this.stance < UnitStance.Defend
    ) {
      return
    }

    const allowTurn = this.info.allowTurning && this.stance > UnitStance.HoldFire
    this.scanAndAttack(self, this.allowMove, allowTurn)
  }

  // ---------------------------------------------------------------------------
  // INotifyDamage
  // ---------------------------------------------------------------------------

  /** Retaliate when damaged.
   *
   *  OpenRA 对照: INotifyDamage.Damaged(Actor, AttackInfo)
   */
  damaged(self: IGameActor, attackInfo: { damage: { value: number }; attacker: IGameActor }): void {
    if (
      this.isTraitDisabled ||
      !self.isIdle ||
      this.stance < UnitStance.ReturnFire
    ) {
      return
    }

    // Don't retaliate against heals
    if (attackInfo.damage.value < 0) return

    // TODO-8.D.DEFER-PASSENGER: If attacker is in transport, attack the transport instead
    // const passenger = attacker.traitOrDefault?.('Passenger') as ...
    // if (passenger?.transport) attacker = passenger.transport
    let attacker = attackInfo.attacker
    if (!attacker || attacker.disposed) return

    // Don't change targets when override auto-target is active
    for (const oat of this.overrideAutoTarget) {
      if (oat.tryGetAutoTargetOverride(self, { target: Target.Invalid })) return
    }

    // Don't fire at invisible enemies when we can't move
    if (!this.allowMove) {
      const attackerViewable = (attacker as unknown as {
        canBeViewedByPlayer?: (p: unknown) => boolean
      })
      const owner = (self as unknown as { owner?: unknown }).owner
      if (attackerViewable.canBeViewedByPlayer && owner) {
        if (!attackerViewable.canBeViewedByPlayer(owner)) return
      }
    }

    // Don't retaliate against units we can't hurt
    const attackerAsTarget = Target.fromActor(attacker as unknown as never)
    const hasValidWeapon = this.activeAttackBases.some(a =>
      a.hasAnyValidWeapons(attackerAsTarget),
    )
    if (!hasValidWeapon) return

    // TODO-8.D.DEFER-FRIENDLYFIRE: Don't retaliate against friendly fire
    // (duck-typed check, always allow retaliation for now)

    // Respect auto attack priorities for higher stances
    if (this.stance > UnitStance.ReturnFire) {
      const autoTarget = this.scanForTarget(self, this.allowMove, true)
      if (autoTarget.type !== TargetType.Invalid) {
        attacker = autoTarget.actor as unknown as IGameActor
      }
    }

    this.aggressor = attacker
    this.attack(self, Target.fromActor(attacker as unknown as never))
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // ---------------------------------------------------------------------------

  /** Handle SetUnitStance order.
   *
   *  OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
   */
  resolveOrder(self: IGameActor, order: { orderName: string; extraData?: unknown }): void {
    if (order.orderName === 'SetUnitStance' && this.info.enableStances) {
      this.setStance(self, order.extraData as UnitStanceType)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyOwnerChanged
  // ---------------------------------------------------------------------------

  /** Reset stance when owner changes.
   *
   *  OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged()
   */
  onOwnerChanged(self: IGameActor): void {
    const owner = (self as unknown as { owner?: { isBot?: boolean; playable?: boolean } }).owner
    const isAI = owner?.isBot || !owner?.playable
    this.setStance(self, isAI ? this.info.initialStanceAI : this.info.initialStance)
  }

  // ---------------------------------------------------------------------------
  // Stance management
  // ---------------------------------------------------------------------------

  /** Change stance and fire notifications.
   *
   *  OpenRA 对照: AutoTarget.SetStance(Actor, UnitStance)
   */
  setStance(self: IGameActor, value: UnitStanceType): void {
    if (this.stance === value) return

    const oldStance = this.stance
    this.stance = value
    this.predictedStance = value
    this.applyStanceCondition(self)

    // Fire INotifyStanceChanged
    for (const nsc of this.notifyStanceChanged) {
      nsc.stanceChanged(self, this, oldStance, this.stance)
    }

    // Walk activity chain for IActivityNotifyStanceChanged
    // (simplified: check actor traits with the interface)
    const actorAny = self as unknown as {
      currentActivity?: unknown
      getTraits?: <T>(name: string) => T[]
    }
    const allTraits = actorAny.getTraits?.<unknown>('') ?? []
    const activityNotifiers = allTraits.filter(isIActivityNotifyStanceChanged) as Array<{
      stanceChanged: (
        self: IGameActor,
        autoTarget: unknown,
        oldStance: UnitStanceType,
        newStance: UnitStanceType,
      ) => void
    }>

    for (const a of activityNotifiers) {
      a.stanceChanged(self, this, oldStance, this.stance)
    }
  }

  // ---------------------------------------------------------------------------
  // Target scanning
  // ---------------------------------------------------------------------------

  /** Scan for viable targets.
   *
   *  OpenRA 对照: AutoTarget.ScanForTarget(Actor, bool, bool, bool)
   */
  scanForTarget(
    self: IGameActor,
    allowMove: boolean,
    allowTurn: boolean,
    ignoreScanInterval: boolean = false,
  ): Target {
    if (
      (ignoreScanInterval || this.nextScanTime <= 0) &&
      this.activeAttackBases.length > 0
    ) {
      // Check override auto-target
      for (const oat of this.overrideAutoTarget) {
        const out = { target: Target.Invalid }
        if (oat.tryGetAutoTargetOverride(self, out)) {
          return out.target
        }
      }

      if (!ignoreScanInterval) {
        this.nextScanTime =
          this.info.minimumScanTimeInterval +
          Math.floor(
            Math.random() *
              (this.info.maximumScanTimeInterval -
                this.info.minimumScanTimeInterval +
                1),
          )
      }

      for (const ab of this.activeAttackBases) {
        const attackStances = ab.unforcedAttackTargetStances()
        if (attackStances !== PlayerRelationship.None) {
          const range =
            this.info.scanRadius > 0
              ? new WDist(this.info.scanRadius * 1024) // WDist.FromCells
              : ab.getMaximumRange()
          const target = this.chooseTarget(
            self,
            ab,
            attackStances,
            range,
            allowMove,
            allowTurn,
          )
          if (target.type !== TargetType.Invalid) return target
        }
      }
    }

    return Target.Invalid
  }

  /** Scan and immediately attack any found target.
   *
   *  OpenRA 对照: AutoTarget.ScanAndAttack(Actor, bool, bool)
   */
  scanAndAttack(
    self: IGameActor,
    allowMove: boolean,
    allowTurn: boolean,
  ): void {
    const target = this.scanForTarget(self, allowMove, allowTurn)
    if (target.type !== TargetType.Invalid) {
      this.attack(self, target)
    }
  }

  // ---------------------------------------------------------------------------
  // Target selection
  // ---------------------------------------------------------------------------

  /** Choose the best target among those in range.
   *
   *  OpenRA 对照: AutoTarget.ChooseTarget()
   */
  chooseTarget(
    self: IGameActor,
    ab: AttackBase,
    _attackStances: number,
    scanRange: WDist,
    allowMove: boolean,
    allowTurn: boolean,
  ): Target {
    const chosenTarget = Target.Invalid
    let chosenTargetPriority = -Infinity
    // NOTE: finalRange tracked implicitly via finalRange variable below
    const activePriorities = this.activeTargetPriorities
    if (activePriorities.length === 0) return chosenTarget

    // Get nearby actors via duck-typed world query
    // TODO-8.D.DEFER-FROZENACTOR: Also scan FrozenActorLayer for frozen-actors-in-circle
    // TODO-8.D.DEFER-AUTOTARGET-PREVENTSAUTO: Check IDisableEnemyAutoTarget per target
    const centerPos =
      (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const worldActors = this.getActorsInRange(self, centerPos, scanRange)

    let finalTarget = Target.Invalid
    let finalPriority = -Infinity
    let finalRange = 0

    for (const target of worldActors) {
      if (target.type !== TargetType.Actor) continue

      const targetActor = target.actor as unknown as IGameActor | null
      if (!targetActor) continue

      // Check target types
      const targetTypes = this.getEnabledTargetTypes(targetActor)
      if (!targetTypes) continue

      // Check relationship
      const owner = (targetActor as unknown as { owner?: unknown }).owner
      if (owner === undefined) continue

      // Filter by valid priorities
      const validPriorities: IAutoTargetPriorityInfo[] = []
      for (const ati of activePriorities) {
        if (ati.priority < chosenTargetPriority) continue

        // Relationship check
        // (simplified: use duck-typed relationship query)
        if (!PlayerRelationshipExts.hasRelationship(ati.validRelationships, 1)) continue

        // Target type overlap check
        let hasOverlap = false
        for (const tt of targetTypes) {
          if (ati.invalidTargets.has(tt)) {
            hasOverlap = false
            break
          }
          if (ati.validTargets.has(tt)) hasOverlap = true
        }
        if (!hasOverlap) continue

        validPriorities.push(ati)
      }

      if (validPriorities.length === 0) continue

      // Check armaments
      const armaments = ab.chooseArmamentsForTarget(target, false)
      if (armaments.length === 0) continue

      // Range check
      if (!allowMove) {
        const inRange = armaments.some(arm => {
          const ctr = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
          return (
            target.isInRange(ctr, arm.maxRange()) &&
            !target.isInRange(
              ctr,
              arm.weapon?.minRange ?? WDist.Zero,
            )
          )
        })
        if (!inRange) continue
      }

      // Firing arc check
      if (!allowTurn && !ab.targetInFiringArc(self, target, ab.info.facingTolerance)) {
        continue
      }

      // Evaluate priority
      const delta = WPos.subtract(
        target.centerPosition,
        (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero,
      )
      const targetRange = delta.horizontalLength

      for (const ati of validPriorities) {
        if (
          finalTarget.type === TargetType.Invalid ||
          finalPriority < ati.priority ||
          (finalPriority === ati.priority && targetRange < finalRange)
        ) {
          finalTarget = target
          finalPriority = ati.priority
          finalRange = targetRange
          chosenTargetPriority = ati.priority
          finalRange = targetRange
        }
      }
    }

    return finalTarget
  }

  // ---------------------------------------------------------------------------
  // Target validation
  // ---------------------------------------------------------------------------

  /** Check if there's a valid target priority for a given owner and target types.
   *
   *  OpenRA 对照: AutoTarget.HasValidTargetPriority()
   */
  hasValidTargetPriority(
    _self: IGameActor,
    owner: unknown,
    targetTypes: ReadonlySet<string>,
  ): boolean {
    if (owner === null || this.stance <= UnitStance.ReturnFire) return false

    return this.activeTargetPriorities.some(ati => {
      if (
        !PlayerRelationshipExts.hasRelationship(
          ati.validRelationships,
          PlayerRelationship.Enemy,
        )
      ) {
        return false
      }

      let hasOverlap = false
      for (const tt of targetTypes) {
        if (ati.invalidTargets.has(tt)) return false
        if (ati.validTargets.has(tt)) hasOverlap = true
      }
      return hasOverlap
    })
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Issue attack orders on all active attack bases.
   *
   *  OpenRA 对照: AutoTarget.Attack(Target, bool)
   */
  private attack(self: IGameActor, target: Target): void {
    for (const ab of this.activeAttackBases) {
      ab.attackTarget(
        self,
        target,
        AttackSource.AutoTarget,
        false, // not queued
        this.allowMove,
      )
    }
  }

  /** Apply the stance condition token.
   *
   *  OpenRA 对照: AutoTarget.ApplyStanceCondition()
   */
  private applyStanceCondition(self: IGameActor): void {
    if (this.conditionToken !== -1) {
      self.revokeCondition?.(this.conditionToken)
      this.conditionToken = -1
    }

    const condition = this.info.conditionByStance.get(this.stance)
    if (condition) {
      this.conditionToken = self.grantCondition?.(condition) ?? -1
    }
  }

  /** Get all actors within range of a position.
   *
   *  Duck-typed access to world.findActorsInCircle.
   *  Falls back to iterating all actors.
   */
  private getActorsInRange(
    self: IGameActor,
    pos: WPos,
    range: WDist,
  ): Target[] {
    // Duck-typed world query
    const world = (self as unknown as { world?: { actors?: Iterable<IGameActor> } }).world
    if (!world?.actors) return []

    // TODO-8.D.PERF: Replace linear scan with spatial index (Ch9 pathfinding grid integration)
    const rangeLenSq = range.length * range.length
    const actors: Target[] = []
    for (const actor of world.actors) {
      // Skip self
      if ((actor as unknown as { actorId?: number }).actorId ===
          (self as unknown as { actorId?: number }).actorId) continue
      // Basic range filtering by WPos distance
      const actorCenter = (actor as unknown as { centerPosition?: WPos }).centerPosition
      if (actorCenter && WPos.subtract(actorCenter, pos).horizontalLengthSquared > rangeLenSq) continue

      actors.push(Target.fromActor(actor as unknown as never))
    }
    return actors
  }

  /** Get enabled target types for an actor.
   *
   *  Duck-typed access.
   */
  private getEnabledTargetTypes(actor: IGameActor): ReadonlySet<string> | null {
    const actorAny = actor as unknown as {
      getEnabledTargetTypes?: () => ReadonlySet<string>
    }
    return actorAny.getEnabledTargetTypes?.() ?? null
  }
}
