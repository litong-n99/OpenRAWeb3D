/**
 * SquadManagerBotModule.ts — AI squad coordination hub
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/SquadManagerBotModule.cs
 *
 * 核心范式转换:
 * - C# SquadManagerBotModule : ConditionalTrait<SquadManagerBotModuleInfo>
 *   → TypeScript SquadManagerBotModule extending ConditionalTrait
 * - C# imperative AssignRolesToIdleUnits() with 6-phase tick counting
 *   → TypeScript behavior tree root (Selector) with Sequence branches
 * - C# HashSet<Actor> activeUnits → TypeScript Set<IGameActorLike>
 * - C# List<Squad> Squads → TypeScript Squad[] with CleanSquads()
 * - C# stack-based squad update spreading → TypeScript interleaved updates
 * - C# MersenneTwister → SimplePrng (deterministic, integer-only)
 * - C# AttackOrFleeFuzzy → TypeScript AttackOrFleeFuzzy (weighted scoring)
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ConditionalTraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBotTick,
  IBotEnabled,
  IBotRespondToAttack,
  IBotPositionsUpdated,
  IBot,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import { AttackOrFleeFuzzy } from './Squads/AttackOrFleeFuzzy.js'
import { Squad, SquadType, SimplePrng } from './Squads/Squad.js'
import type { SquadManagerLike, SquadBotLike } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// SquadManagerBotModuleInfo (对应 OpenRA SquadManagerBotModuleInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for SquadManagerBotModule.
 *
 * OpenRA 对照: SquadManagerBotModuleInfo : ConditionalTraitInfo
 */
export interface SquadManagerBotModuleInfo extends ConditionalTraitInfo {
  // Actor type sets
  readonly navalUnitsTypes: ReadonlySet<string>
  readonly airUnitsTypes: ReadonlySet<string>
  readonly excludeFromSquadsTypes: ReadonlySet<string>
  readonly constructionYardTypes: ReadonlySet<string>
  readonly navalProductionTypes: ReadonlySet<string>
  readonly protectionTypes: ReadonlySet<string>

  // Timing
  readonly assignRolesInterval: number
  readonly rushInterval: number
  readonly attackForceInterval: number
  readonly minimumAttackForceDelay: number

  // Sizing
  readonly squadSize: number
  readonly squadSizeRandomBonus: number

  // Radii (in cells)
  readonly rushAttackScanRadius: number
  readonly protectUnitScanRadius: number
  readonly maxBaseRadius: number
  readonly idleScanRadius: number
  readonly dangerScanRadius: number
  readonly attackScanRadius: number
  readonly protectionScanRadius: number

  // Target filtering
  readonly aircraftTargetType: { contains: (v: number) => boolean }
  readonly ignoredEnemyTargetTypes: { isEmpty: boolean; overlaps?: (other: unknown) => boolean }
}

// ---------------------------------------------------------------------------
// SquadManagerBotModule
// ---------------------------------------------------------------------------

/**
 * AI squad coordination hub — manages squad lifecycle, unit assignment,
 * rush attacks, and defensive responses.
 *
 * OpenRA 对照: SquadManagerBotModule class
 *
 * Implements multiple AI interfaces:
 * - IBotEnabled: receives IBot reference
 * - IBotTick: main tick loop
 * - IBotRespondToAttack: defensive reaction to damage
 * - IBotPositionsUpdated: base/defense center updates
 * - SquadManagerLike: API for Squad operations
 */
export class SquadManagerBotModule
  extends ConditionalTrait<SquadManagerBotModuleInfo>
  implements
    IBotTick,
    IBotEnabled,
    IBotRespondToAttack,
    IBotPositionsUpdated,
    SquadManagerLike
{
  // -----------------------------------------------------------------------
  // Core references
  // -----------------------------------------------------------------------

  /** Cached world reference. */
  readonly world: WorldLike

  /** Cached player reference. */
  readonly player: PlayerLike

  /** All squads managed by this module. */
  squads: Squad[] = []

  /** Stack of squads pending update (spread across ticks). */
  private readonly _squadsPendingUpdate: Squad[] = []

  /** All units known to the bot (including those already assigned to squads). */
  private readonly _activeUnits = new Set<ActorLike>()

  /** Units loitering around the base (not yet assigned to a squad). */
  private _unitsHangingAroundTheBase: ActorLike[] = []

  /** Bot controller reference (set via IBotEnabled). */
  private _bot: IBot | null = null

  /** Notify idle base units handlers. */
  private _notifyIdleBaseUnits: {
    updatedIdleBaseUnits(units: IGameActor[]): void
  }[] = []

  /** Notify positions updated handlers. */
  private _notifyPositionsUpdated: {
    updatedDefenseCenter(loc: { x: number; y: number }): void
  }[] = []

  // -----------------------------------------------------------------------
  // Position state
  // -----------------------------------------------------------------------

  /** Initial base center (set by base builder or spawn). */
  private _initialBaseCenter: { x: number; y: number } = { x: 0, y: 0 }

  /** Actor to protect from (set by attack response). */
  private _protectFrom: ActorLike | null = null

  // -----------------------------------------------------------------------
  // Tick counters (randomized initial values to desync AI players)
  // -----------------------------------------------------------------------

  private _rushTicks: number = 0
  private _assignRolesTicks: number = 0
  private _attackForceTicks: number = 0
  private _minAttackForceDelayTicks: number = 0
  private _respondToAttackCooldown: number = 0

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  static readonly MAX_RESPOND_TO_ATTACK_COOLDOWN = 30

  // -----------------------------------------------------------------------
  // ConstructionYardBuilding tracker (duck-typed ActorIndex)
  // -----------------------------------------------------------------------

  /** Construction yard buildings index (owned by player). */
  private readonly _constructionYardBuildings: {
    actors: ActorLike[]
    dispose(): void
  }

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    world: WorldLike,
    player: PlayerLike,
    info: SquadManagerBotModuleInfo,
    random: SimplePrng,
  ) {
    super(info)
    this.world = world
    this.player = player
    this._constructionYardBuildings = this.buildConstructionYardIndex()

    // Randomize initial tick counters (OpenRA: randomize in TraitEnabled)
    const smallRushFraction = (info.rushInterval / 20) | 0
    this._rushTicks = random.nextIntRange(
      info.rushInterval - smallRushFraction,
      info.rushInterval + smallRushFraction,
    )
    this._assignRolesTicks = random.nextIntRange(0, info.assignRolesInterval)
    this._attackForceTicks = random.nextIntRange(0, info.attackForceInterval)
    this._minAttackForceDelayTicks = random.nextIntRange(0, info.minimumAttackForceDelay)
    this._respondToAttackCooldown = SquadManagerBotModule.MAX_RESPOND_TO_ATTACK_COOLDOWN
  }

  private buildConstructionYardIndex(): { actors: ActorLike[]; dispose(): void } {
    const actors: ActorLike[] = []
    for (const a of this.world.actors) {
      if (
        a.owner === this.player &&
        typeof a.info?.name === 'string' &&
        this.info.constructionYardTypes.has(a.info.name)
      ) {
        actors.push(a)
      }
    }
    return {
      actors,
      dispose: () => { actors.length = 0 },
    }
  }

  // -----------------------------------------------------------------------
  // IBotEnabled (对应 OpenRA IBotEnabled.BotEnabled)
  // -----------------------------------------------------------------------

  botEnabled(bot: IBot): void {
    this._bot = bot

    // Cache dependent traits from PlayerActor
    const playerActor = (bot.player as unknown as { playerActor?: ActorLike }).playerActor
    if (playerActor) {
      this._notifyIdleBaseUnits =
        (playerActor as unknown as { traitsImplementing?: (name: string) => unknown[] })
          .traitsImplementing?.('IBotNotifyIdleBaseUnits') as typeof this._notifyIdleBaseUnits || []
      this._notifyPositionsUpdated =
        (playerActor as unknown as { traitsImplementing?: (name: string) => unknown[] })
          .traitsImplementing?.('IBotPositionsUpdated') as typeof this._notifyPositionsUpdated || []
    }
  }

  // -----------------------------------------------------------------------
  // IBotTick (对应 OpenRA IBotTick.BotTick)
  // -----------------------------------------------------------------------

  botTick(_bot: IBot): void {
    this.assignRolesToIdleUnits()
  }

  // -----------------------------------------------------------------------
  // IBotRespondToAttack (对应 OpenRA IBotRespondToAttack.RespondToAttack)
  // -----------------------------------------------------------------------

  respondToAttack(_bot: IBot, self: IGameActor, e: AttackInfo): void {
    if (this._respondToAttackCooldown > 0) return

    const selfActor = self as unknown as ActorLike
    if (!this.info.protectionTypes.has(selfActor.info?.name ?? '')) return
    if (!this.isPreferredEnemyUnit(e.attacker as unknown as ActorLike)) return

    this._respondToAttackCooldown = SquadManagerBotModule.MAX_RESPOND_TO_ATTACK_COOLDOWN

    const attackerLoc = (e.attacker as unknown as { location?: { x: number; y: number } }).location
      ?? { x: 0, y: 0 }

    for (const n of this._notifyPositionsUpdated) {
      n.updatedDefenseCenter(attackerLoc)
    }

    this._protectFrom = e.attacker as unknown as ActorLike
  }

  // -----------------------------------------------------------------------
  // IBotPositionsUpdated
  // -----------------------------------------------------------------------

  updatedBaseCenter(newLocation: CPos): void {
    this._initialBaseCenter = { x: newLocation.X, y: newLocation.Y }
  }

  updatedDefenseCenter(_newLocation: CPos): void {
    // Used by other modules via notifyPositionsUpdated
  }

  // -----------------------------------------------------------------------
  // SquadManagerLike implementation
  // -----------------------------------------------------------------------

  /**
   * Get a random construction yard location as base center.
   *
   * OpenRA 对照: SquadManagerBotModule.GetRandomBaseCenter()
   */
  getRandomBaseCenter(): { x: number; y: number } {
    const yards = this._constructionYardBuildings.actors.filter(
      a => a.owner === this.player,
    )
    if (yards.length > 0) {
      return yards[(yards.length > 1 ? this.randomIndex(yards.length) : 0)].location
    }
    return this._initialBaseCenter
  }

  /**
   * Check if an actor is a preferred enemy target.
   *
   * OpenRA 对照: SquadManagerBotModule.IsPreferredEnemyUnit(Actor)
   */
  isPreferredEnemyUnit(a: ActorLike): boolean {
    if (!a || a.isDead) return false

    const rel = String(this.player.relationshipWith(a.owner))
    if (rel !== 'Enemy') return false

    if (a.info && a.info.name === 'Husk') return false

    const targetTypes = a.getEnabledTargetTypes?.()
    if (!targetTypes || targetTypes.isEmpty) return false

    if (!this.info.ignoredEnemyTargetTypes.isEmpty &&
      targetTypes.overlaps?.(this.info.ignoredEnemyTargetTypes)) {
      return false
    }

    return this.isNotHiddenUnit(a)
  }

  private isNotHiddenUnit(a: ActorLike): boolean {
    let hasModifier = false
    const visModifiers = a.traitsImplementing?.('IVisibilityModifier') ?? []
    for (const v of visModifiers) {
      const vm = v as { isVisible?: (actor: ActorLike, player: PlayerLike) => boolean }
      if (vm.isVisible?.(a, this.player)) return true
      hasModifier = true
    }
    return !hasModifier
  }

  /**
   * Check if a unit can target another unit (has valid weapons in range).
   */
  isValidTargetFor(_unit: ActorLike, _target: ActorLike): boolean {
    // Duck-type: Target.IsValidFor equivalent
    if (!_target.isInWorld || _target.isDead) return false
    return true
  }

  /**
   * Find the closest enemy for a squad unit.
   *
   * OpenRA 对照: SquadManagerBotModule.FindClosestEnemy(Actor, WDist)
   */
  findClosestEnemyForSquad(
    enemies: readonly ActorLike[],
    sourceActor: ActorLike,
  ): { actor: ActorLike | null; offset: { x: number; y: number; z: number } } {
    // Find enemies with valid weapons range from source
    let bestEnemy: ActorLike | null = null
    let bestDistSq = 2147483647

    for (const enemy of enemies) {
      const cp = enemy.centerPosition
      const sp = sourceActor.centerPosition
      const dx = cp.x - sp.x
      const dy = cp.y - sp.y
      const dz = cp.z - sp.z
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestEnemy = enemy
      }
    }

    return {
      actor: bestEnemy,
      offset: { x: 0, y: 0, z: 0 },
    }
  }

  // -----------------------------------------------------------------------
  // Squad management
  // -----------------------------------------------------------------------

  /**
   * Remove dead/unowned units from all squads and delete invalid squads.
   *
   * OpenRA 对照: SquadManagerBotModule.CleanSquads()
   */
  private cleanSquads(): void {
    for (const s of this.squads) {
      for (const unit of s.units) {
        if (this.unitCannotBeOrdered(unit as unknown as ActorLike)) {
          s.units.delete(unit)
        }
      }
    }
    this.squads = this.squads.filter(s => s.isValid)
  }

  /**
   * Predicate: check if a unit cannot be ordered (dead, wrong owner, not in world).
   */
  private unitCannotBeOrdered(a: ActorLike): boolean {
    return !a || a.owner !== this.player || a.isDead || !a.isInWorld
  }

  /**
   * Get the first squad of a given type.
   *
   * OpenRA 对照: SquadManagerBotModule.GetSquadOfType(SquadType)
   *
   * HACK: Assumes at most one squad of each type.
   */
  private getSquadOfType(type: SquadType): Squad | undefined {
    for (const s of this.squads) {
      if (s.type === type) return s
    }
    return undefined
  }

  /**
   * Register a new squad.
   *
   * OpenRA 对照: SquadManagerBotModule.RegisterNewSquad(IBot, SquadType, target)
   */
  private registerNewSquad(type: SquadType, target: { actor: ActorLike | null; offset: { x: number; y: number; z: number } } | null = null, random: SimplePrng): Squad {
    const bot = this._bot
    if (!bot) throw new Error('SquadManagerBotModule: bot not initialized')

    const squad = new Squad(
      bot as unknown as SquadBotLike,
      this,
      type,
      target,
      random,
      null, // Initial state set by Squad constructor based on type
    )
    this.squads.push(squad)
    return squad
  }

  /**
   * Unregister a squad (called from Squad when it becomes invalid).
   *
   * OpenRA 对照: SquadManagerBotModule.UnregisterSquad(Squad)
   */
  unregisterSquad(squad: Squad): void {
    for (const unit of squad.units) {
      this._activeUnits.delete(unit as unknown as ActorLike)
    }
    squad.units.clear()
    // cleanSquads() will remove it from the list
  }

  // -----------------------------------------------------------------------
  // Main tick logic (对应 OpenRA AssignRolesToIdleUnits)
  // -----------------------------------------------------------------------

  /**
   * Main tick method — orchestrates squad management.
   *
   * OpenRA 对照: SquadManagerBotModule.AssignRolesToIdleUnits(IBot)
   *
   * Phases (executed in sequence, gated by tick counters):
   * 1. Clean dead units from squads
   * 2. Clean dead units from hanging-around list
   * 3. Try rush attack (every RushInterval ticks)
   * 4. Update squads (spread across AttackForceInterval ticks)
   * 5. Find new units (every AssignRolesInterval ticks)
   * 6. Create attack force (every MinimumAttackForceDelay ticks)
   * 7. Protect own units (cooldown-based)
   */
  private assignRolesToIdleUnits(): void {
    if (!this._bot) return

    this.cleanSquads()

    // Remove dead/unowned units from active units and hanging-around list
    for (const unit of this._activeUnits) {
      if (this.unitCannotBeOrdered(unit)) {
        this._activeUnits.delete(unit)
      }
    }
    this._unitsHangingAroundTheBase = this._unitsHangingAroundTheBase.filter(
      u => !this.unitCannotBeOrdered(u),
    )
    for (const n of this._notifyIdleBaseUnits) {
      n.updatedIdleBaseUnits(this._unitsHangingAroundTheBase as unknown as IGameActor[])
    }

    // Phase 1: Rush attack
    if (--this._rushTicks <= 0) {
      this._rushTicks = this.info.rushInterval
      this.tryToRushAttack()
    }

    // Phase 2: Squad updates (spread across ticks)
    if (--this._attackForceTicks <= 0) {
      this._attackForceTicks = this.info.attackForceInterval
      for (const s of this.squads) {
        this._squadsPendingUpdate.push(s)
      }
    }

    const pendingCount = this._squadsPendingUpdate.length
    const updateCount = pendingCount > 0
      ? ((pendingCount + this._attackForceTicks - 1) / Math.max(this._attackForceTicks, 1)) | 0
      : 0

    for (let i = 0; i < updateCount; i++) {
      const squad = this._squadsPendingUpdate.pop()
      if (squad && squad.isValid) {
        squad.update()
      }
    }

    // Phase 3: Find new units
    if (--this._assignRolesTicks <= 0) {
      this._assignRolesTicks = this.info.assignRolesInterval
      this.findNewUnits()
    }

    // Phase 4: Create attack force
    if (--this._minAttackForceDelayTicks <= 0) {
      this._minAttackForceDelayTicks = this.info.minimumAttackForceDelay
      this.createAttackForce()
    }

    // Phase 5: Protect own (cooldown-based)
    this._respondToAttackCooldown--
    if (this._respondToAttackCooldown === SquadManagerBotModule.MAX_RESPOND_TO_ATTACK_COOLDOWN) {
      this.protectOwn()
    }
  }

  // -----------------------------------------------------------------------
  // Find new units (对应 OpenRA FindNewUnits)
  // -----------------------------------------------------------------------

  private findNewUnits(): void {
    const newUnits: ActorLike[] = []

    for (const a of this.world.actors) {
      if (a.owner !== this.player) continue
      if (!a.info?.name) continue
      if (this.info.excludeFromSquadsTypes.has(a.info.name)) continue
      if (this._activeUnits.has(a)) continue

      // Check if has IPositionable trait
      const hasPosition = a.traitsImplementing?.('IPositionable')?.length ?? 0 > 0
      if (!hasPosition) continue

      newUnits.push(a)
    }

    for (const a of newUnits) {
      const name = a.info?.name ?? ''

      if (this.info.airUnitsTypes.has(name)) {
        let air = this.getSquadOfType(SquadType.Air)
        if (!air) {
          air = this.registerNewSquad(SquadType.Air, null, this.worldRandom())
        }
        air.units.add(a)
      } else if (this.info.navalUnitsTypes.has(name)) {
        let ships = this.getSquadOfType(SquadType.Naval)
        if (!ships) {
          ships = this.registerNewSquad(SquadType.Naval, null, this.worldRandom())
        }
        ships.units.add(a)
      } else {
        this._unitsHangingAroundTheBase.push(a)
      }

      this._activeUnits.add(a)
    }

    for (const n of this._notifyIdleBaseUnits) {
      n.updatedIdleBaseUnits(this._unitsHangingAroundTheBase as unknown as IGameActor[])
    }
  }

  // -----------------------------------------------------------------------
  // Create attack force (对应 OpenRA CreateAttackForce)
  // -----------------------------------------------------------------------

  private createAttackForce(): void {
    if (!this._bot) return

    const rng = this.worldRandom()
    const randomizedSize = this.info.squadSize + rng.nextIntRange(0, this.info.squadSizeRandomBonus)

    if (this._unitsHangingAroundTheBase.length >= randomizedSize) {
      const attackForce = this.registerNewSquad(SquadType.Assault, null, rng)

      for (const unit of this._unitsHangingAroundTheBase) {
        attackForce.units.add(unit)
      }

      this._unitsHangingAroundTheBase = []
      for (const n of this._notifyIdleBaseUnits) {
        n.updatedIdleBaseUnits([] as unknown as IGameActor[])
      }
    }
  }

  // -----------------------------------------------------------------------
  // Rush attack (对应 OpenRA TryToRushAttack)
  // -----------------------------------------------------------------------

  private tryToRushAttack(): void {
    if (!this._bot) return

    // Count total ground troops
    let groundTroopNum = this._unitsHangingAroundTheBase.length
    for (const s of this.squads) {
      if (s.isValid && s.type !== SquadType.Air && s.type !== SquadType.Naval) {
        groundTroopNum += s.units.size
      }
    }

    if (groundTroopNum < this.info.squadSize) return

    // Pick a random attack-capable unit from hanging-around
    const attackableUnits = this._unitsHangingAroundTheBase.filter(
      a => a.info?.hasTraitInfo?.('AttackBase') ?? false,
    )
    if (attackableUnits.length === 0) return

    const rng = this.worldRandom()
    const randomUnit = attackableUnits[rng.nextIntRange(0, attackableUnits.length - 1)]

    // Find enemy base builders
    const allEnemyBaseBuilder = this.findEnemies(
      this._constructionYardBuildings.actors.filter(
        a => {
          try { return String(this.player.relationshipWith(a.owner)) === 'Enemy' }
          catch { return false }
        },
      ),
      randomUnit,
    )
    if (allEnemyBaseBuilder.length === 0) return

    for (const enemyBaseBuilder of allEnemyBaseBuilder) {
      // Find enemies around enemy base builder
      const scanCenter = enemyBaseBuilder.actor.centerPosition
      const scanRadius = this.info.rushAttackScanRadius * 1024
      const nearbyActors = this.world.findActorsInCircle?.(
        scanCenter,
        { length: scanRadius },
      ) ?? []

      const enemies = this.findEnemies(
        nearbyActors.filter(
          a =>
            typeof a.info?.name === 'string' &&
            !this.info.airUnitsTypes.has(a.info.name) &&
            !this.info.navalUnitsTypes.has(a.info.name) &&
            (a.info?.hasTraitInfo?.('AttackBase') ?? false) &&
            this.isPreferredEnemyUnit(a),
        ),
        randomUnit,
      )

      const enemyActorList = enemies.map(x => x.actor)
      if (AttackOrFleeFuzzy.rush.canAttack(
        this._unitsHangingAroundTheBase as unknown as Parameters<typeof AttackOrFleeFuzzy.rush.canAttack>[0],
        enemyActorList as unknown as Parameters<typeof AttackOrFleeFuzzy.rush.canAttack>[0],
      )) {
        const target = enemies.length > 0
          ? enemies[rng.nextIntRange(0, enemies.length - 1)]
          : enemyBaseBuilder

        // Redirect all existing squads
        for (const s of this.squads) {
          if (s.isValid) {
            s.setActorToTarget(target)
          }
        }

        // Create rush squad
        let rush = this.getSquadOfType(SquadType.Rush)
        if (!rush) {
          rush = this.registerNewSquad(SquadType.Rush, target, rng)
        }

        for (const unit of this._unitsHangingAroundTheBase) {
          rush.units.add(unit)
        }
        this._unitsHangingAroundTheBase = []
        for (const n of this._notifyIdleBaseUnits) {
          n.updatedIdleBaseUnits([] as unknown as IGameActor[])
        }

        return
      }
    }
  }

  // -----------------------------------------------------------------------
  // Protect own (对应 OpenRA ProtectOwn)
  // -----------------------------------------------------------------------

  private protectOwn(): void {
    if (!this._bot) return
    if (!this._protectFrom) return
    if (!this.isPreferredEnemyUnit(this._protectFrom)) return

    // Redirect existing squads to protect
    for (const s of this.squads) {
      if (!s.isValid) continue
      const firstUnit = s.units.values().next().value as ActorLike | undefined
      if (!firstUnit) continue

      const canAttack = this.findEnemies([this._protectFrom], firstUnit).length > 0
      if (!canAttack) continue

      const dx = firstUnit.location.x - this._protectFrom.location.x
      const dy = firstUnit.location.y - this._protectFrom.location.y
      if (dx * dx + dy * dy > this.info.protectUnitScanRadius * this.info.protectUnitScanRadius) continue

      s.setActorToTarget({ actor: this._protectFrom, offset: { x: 0, y: 0, z: 0 } })
    }

    let protectSq = this.getSquadOfType(SquadType.Protection)
    if (!protectSq) {
      protectSq = this.registerNewSquad(
        SquadType.Protection,
        { actor: this._protectFrom, offset: { x: 0, y: 0, z: 0 } },
        this.worldRandom(),
      )
    }

    const unusedUnits: ActorLike[] = []
    for (const a of this._unitsHangingAroundTheBase) {
      if (a.info?.hasTraitInfo?.('Aircraft') && !this.info.airUnitsTypes.has(a.info.name ?? '')) {
        protectSq.units.add(a)
        continue
      }

      const mobile = a.traitsImplementing?.('Mobile')
      if (!mobile || mobile.length === 0) {
        unusedUnits.push(a)
        continue
      }

      if (this.findEnemies([this._protectFrom], a).length > 0) {
        protectSq.units.add(a)
      } else {
        unusedUnits.push(a)
      }
    }

    this._unitsHangingAroundTheBase = unusedUnits
    for (const n of this._notifyIdleBaseUnits) {
      n.updatedIdleBaseUnits(this._unitsHangingAroundTheBase as unknown as IGameActor[])
    }

    if (protectSq.isValid && !protectSq.isTargetValid(protectSq.centerUnit()!)) {
      protectSq.setActorToTarget({ actor: this._protectFrom, offset: { x: 0, y: 0, z: 0 } })
    }
  }

  // -----------------------------------------------------------------------
  // Enemy finding helpers (对应 OpenRA FindEnemies / FindClosestEnemy)
  // -----------------------------------------------------------------------

  /**
   * Find enemies that the source actor can attack.
   *
   * OpenRA 对照: SquadManagerBotModule.FindEnemies(List<Actor>, Actor)
   */
  findEnemies(actors: readonly ActorLike[], sourceActor: ActorLike): { actor: ActorLike; offset: { x: number; y: number; z: number } }[] {
    const results: { actor: ActorLike; offset: { x: number; y: number; z: number } }[] = []

    for (const a of actors) {
      if (!this.isPreferredEnemyUnit(a)) continue

      // Duck-type: check if source has AttackBase that can target this enemy
      const attackBases = sourceActor.traitsImplementing?.('AttackBase') ?? []
      const enabledAttacks = attackBases.filter(
        (ab: unknown) => {
          const trab = ab as { isTraitDisabled?: boolean; hasAnyValidWeapons?: (target: unknown) => boolean }
          return !trab.isTraitDisabled && trab.hasAnyValidWeapons?.({ actor: a }) === true
        },
      )

      if (enabledAttacks.length > 0) {
        results.push({
          actor: a,
          offset: { x: 0, y: 0, z: 0 },
        })
      }
    }

    return results
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Get a world-local random generator.
   * Uses SimplePrng seeded from world tick (deterministic).
   */
  private worldRandom(): SimplePrng {
    const tick = (this.world as unknown as { worldTick?: number }).worldTick ?? 0
    return new SimplePrng(tick + this.squads.length * 7919)
  }

  /**
   * Get a pseudo-random index (no Math.random()).
   */
  private randomIndex(max: number): number {
    if (max <= 0) return 0
    return this.worldRandom().nextIntRange(0, max - 1)
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    this._constructionYardBuildings.dispose()
    this._activeUnits.clear()
    this._unitsHangingAroundTheBase = []
    this.squads = []
    this._squadsPendingUpdate.length = 0
    super.dispose()
  }
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

interface ActorLike {
  owner: PlayerLike
  location: { x: number; y: number }
  centerPosition: { x: number; y: number; z: number }
  isDead: boolean
  isInWorld: boolean
  actorId: number
  info?: {
    name: string
    hasTraitInfo?: (trait: string) => boolean
  }
  traitsImplementing?: <T>(name: string) => T[]
  getEnabledTargetTypes?: () => {
    isEmpty: boolean
    overlaps?: (other: unknown) => boolean
  }
}

interface PlayerLike {
  playerName: string
  relationshipWith(other: PlayerLike): unknown
}

interface WorldLike {
  actors: Iterable<ActorLike>
  findActorsInCircle?: (center: { x: number; y: number; z: number }, radius: { length: number }) => ActorLike[]
}
