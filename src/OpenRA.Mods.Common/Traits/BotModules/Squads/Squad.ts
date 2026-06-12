/**
 * Squad.ts — unit group and target state for AI squad coordination
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/Squad.cs
 *
 * 核心范式转换:
 * - C# Squad class (182 lines) with HashSet<Actor> Units → TypeScript Squad
 *   with Set<IGameActor> + array cache for iteration
 * - C# Target struct (TargetType, Actor, WPos) → TypeScript Target interface
 * - C# MersenneTwister Random → TypeScript SimplePrng (deterministic, integer-only)
 * - C# StateMachine + IState → TypeScript StateMachine (from StateMachine.ts)
 * - C# WVec.Zero offset check → zero-offset guard
 *
 * SquadType enum for specialized squad behavior:
 * - Assault: main attack force
 * - Air: aircraft squads
 * - Rush: fast attack / early rush
 * - Protection: defensive / guard squads
 * - Naval: water-based unit squads
 */

import { StateMachine, type IState } from './StateMachine.js'

// ---------------------------------------------------------------------------
// SquadManagerLike — interface to avoid circular dependency
// (SquadManagerBotModule imports Squad, Squad needs a subset of its API)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for SquadManagerBotModule used by Squad.
 * Avoids circular dependency.
 */
export interface SquadManagerLike {
  getRandomBaseCenter(): { x: number; y: number }
  isPreferredEnemyUnit(actor: IGameActorLike): boolean
  isValidTargetFor(unit: IGameActorLike, target: IGameActorLike): boolean
  findClosestEnemyForSquad(
    enemies: readonly IGameActorLike[],
    sourceActor: IGameActorLike,
  ): { actor: IGameActorLike | null; offset: { x: number; y: number; z: number } }
  readonly info: {
    dangerScanRadius: number
    attackScanRadius: number
    protectionScanRadius: number
    idleScanRadius: number
  }
}

// ---------------------------------------------------------------------------
// SimplePrng — deterministic integer PRNG (replaces MersenneTwister for AI)
// ---------------------------------------------------------------------------

/**
 * Minimal deterministic PRNG using 32-bit xoshiro128** algorithm.
 *
 * OpenRA 对照: MersenneTwister (OpenRA.Support/MersenneTwister.cs)
 *
 * This is a LIGHTWEIGHT replacement for OpenRA's MersenneTwister.
 * It uses the xoshiro128** algorithm which is fast, deterministic, and
 * has excellent statistical properties for AI decision-making.
 *
 * Constraints:
 * - ALL integer arithmetic (no floating point)
 * - Deterministic given seed
 * - No external dependencies
 */
export class SimplePrng {
  private _state: Uint32Array

  /**
   * Initialize PRNG with a seed.
   *
   * Uses SplitMix32 to initialize state from a single seed value.
   */
  constructor(seed: number) {
    this._state = new Uint32Array(4)
    // SplitMix32 initialization
    let s = seed >>> 0
    for (let i = 0; i < 4; i++) {
      s = Math.imul(s + 0x9E3779B9, 1) | 0
      s = (s ^ (s >>> 16)) >>> 0
      s = Math.imul(s, 0x21F0AAAD) | 0
      s = Math.imul(s ^ (s >>> 15), 0x735A2D97) | 0
      s ^= s >>> 15
      this._state[i] = s >>> 0
    }
  }

  /**
   * Get the next random 32-bit unsigned integer.
   */
  next(): number {
    const s = this._state
    const result = Math.imul(Math.imul(s[1] * 5, 1) | 0, 1) | 0
    const r = ((result << 7) | (result >>> 25)) >>> 0
    const r2 = Math.imul(r * 9, 1) | 0

    const t = s[1] << 9

    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]

    s[2] ^= t
    s[3] = ((s[3] << 11) | (s[3] >>> 21)) >>> 0

    return r2 >>> 0
  }

  /**
   * Get a random integer in [min, max] (inclusive).
   *
   * OpenRA 对照: MersenneTwister.Next(min, max)
   */
  nextIntRange(min: number, max: number): number {
    if (min >= max) return min
    const range = max - min + 1
    // Rejection sampling for uniformity
    const limit = ((0x100000000 / range) | 0) * range
    let value: number
    do {
      value = this.next()
    } while (value >= limit)
    return min + (value % range)
  }
}

// ---------------------------------------------------------------------------
// SquadType (对应 OpenRA SquadType enum)
// ---------------------------------------------------------------------------

/**
 * Type of squad behavior.
 *
 * OpenRA 对照: SquadType enum
 */
export const SquadType = {
  Assault: 0,
  Air: 1,
  Rush: 2,
  Protection: 3,
  Naval: 4,
} as const

export type SquadType = (typeof SquadType)[keyof typeof SquadType]

// ---------------------------------------------------------------------------
// Target types (对应 OpenRA TargetType enum)
// ---------------------------------------------------------------------------

/**
 * Target type flags.
 *
 * OpenRA 对照: TargetType enum
 */
export const TargetType = {
  Invalid: 0,
  Actor: 1,
  Terrain: 2,
  FrozenActor: 3,
} as const

export type TargetType = (typeof TargetType)[keyof typeof TargetType]

// ---------------------------------------------------------------------------
// Target — position/actor objective (对应 OpenRA Target struct)
// ---------------------------------------------------------------------------

/**
 * A target for squad operations.
 *
 * OpenRA 对照: Target readonly struct
 *
 * Can reference an actor (with optional offset) or a terrain position.
 * Offset represents a position near the target actor, used when units
 * cannot path directly to the target (e.g., naval units targeting inland actors).
 */
export interface SquadTarget {
  /** The type of target. */
  readonly type: TargetType
  /** The targeted actor, if any. */
  readonly actor: IGameActorLike | null
  /** The final target position (actor center + offset, or terrain position). */
  readonly centerPosition: { x: number; y: number; z: number }
  /** Offset from the actor's center position (for ranged attack positioning). */
  readonly offset: { x: number; y: number; z: number }
}

// ---------------------------------------------------------------------------
// IGameActorLike — minimal actor interface for squad operations
// ---------------------------------------------------------------------------

/**
 * Minimal actor interface used by Squad.
 * Avoids circular dependency on GameActor.
 */
interface IGameActorLike {
  readonly actorId: number
  readonly isInWorld: boolean
  readonly isDead: boolean
  readonly centerPosition: { x: number; y: number; z: number }
  readonly location: { x: number; y: number }
  readonly info?: { readonly name: string }
  owner: unknown
  canBeViewedByPlayer?: (player: unknown) => boolean
  getEnabledTargetTypes?: () => { isEmpty: boolean }
}

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------

/**
 * A group of units operating together under AI control.
 *
 * OpenRA 对照: Squad class
 *
 * Each squad has:
 * - A set of member units
 * - A target (actor or position) to attack/defend/move to
 * - A state machine that drives behavior each tick
 * - A reference to the owning IBot for order queuing
 */
export class Squad {
  // -----------------------------------------------------------------------
  // Core state
  // -----------------------------------------------------------------------

  /** Member units of this squad. */
  readonly units = new Set<IGameActorLike>()

  /** The type of squad behavior. */
  type: SquadType

  /** Reference to the owning bot controller. */
  readonly bot: SquadBotLike

  /** Reference to the squad manager that owns this squad. */
  readonly squadManager: SquadManagerLike

  /** Deterministic PRNG for this squad's decisions. */
  readonly random: SimplePrng

  /** The state machine driving per-tick behavior. */
  readonly fuzzyStateMachine: StateMachine

  // -----------------------------------------------------------------------
  // Target state
  // -----------------------------------------------------------------------

  /**
   * Target location to move to / attack.
   * This will be either the targeted actor's position, or a position
   * close to that actor sufficient to get within weapons range.
   */
  private _target: SquadTarget = INVALID_TARGET

  /**
   * The actor that is targeted (for actor-based checks).
   * Use `target` for the actual position to path to.
   */
  private _targetActor: IGameActorLike | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new squad.
   *
   * OpenRA 对照: Squad(IBot, SquadManagerBotModule, SquadType, (Actor, WVec))
   *
   * @param bot — the bot controller
   * @param squadManager — the owning squad manager
   * @param type — the type of squad
   * @param target — initial target (actor + offset), or default for none
   * @param random — deterministic PRNG (shared across squads)
   * @param initialState — initial state for the state machine
   */
  constructor(
    bot: SquadBotLike,
    squadManager: SquadManagerLike,
    type: SquadType,
    target: { actor: IGameActorLike | null; offset: { x: number; y: number; z: number } } | null = null,
    random: SimplePrng | null = null,
    initialState: IState | null = null,
  ) {
    this.bot = bot
    this.squadManager = squadManager
    this.type = type
    this.random = random ?? new SimplePrng(0)
    this.fuzzyStateMachine = new StateMachine()

    if (target && target.actor) {
      this.setActorToTarget(target)
    }

    if (initialState) {
      this.fuzzyStateMachine.changeState(this, initialState)
    }
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  /**
   * Update the squad for one tick.
   *
   * OpenRA 对照: Squad.Update()
   *
   * Delegates to the state machine if the squad is valid.
   */
  update(): void {
    if (this.isValid) {
      this.fuzzyStateMachine.update(this)
    }
  }

  // -----------------------------------------------------------------------
  // Validity
  // -----------------------------------------------------------------------

  /**
   * Whether this squad is still valid (has at least one member).
   *
   * OpenRA 对照: Squad.IsValid
   */
  get isValid(): boolean {
    return this.units.size > 0
  }

  // -----------------------------------------------------------------------
  // Target management
  // -----------------------------------------------------------------------

  /**
   * Get the current target.
   */
  get target(): SquadTarget {
    return this._target
  }

  /**
   * Get the current target actor (null if targeting terrain).
   */
  get targetActor(): IGameActorLike | null {
    return this._targetActor
  }

  /**
   * Set the squad's target to a specific actor with optional offset.
   *
   * OpenRA 对照: Squad.SetActorToTarget((Actor, WVec))
   *
   * If offset is zero, targets the actor directly.
   * Otherwise, targets a position near the actor (for naval/ranged units).
   */
  setActorToTarget(target: { actor: IGameActorLike | null; offset: { x: number; y: number; z: number } } | null): void {
    this._targetActor = target?.actor ?? null

    if (!this._targetActor) {
      this._target = INVALID_TARGET
      return
    }

    const cp = this._targetActor.centerPosition
    const off = target!.offset
    const isZeroOffset = off.x === 0 && off.y === 0 && off.z === 0

    this._target = {
      type: TargetType.Actor,
      actor: this._targetActor,
      centerPosition: isZeroOffset
        ? cp
        : { x: cp.x + off.x, y: cp.y + off.y, z: cp.z + off.z },
      offset: off,
    }
  }

  /**
   * Check if the target is still valid and refresh target position if so.
   *
   * OpenRA 对照: Squad.IsTargetValid(Actor)
   *
   * Invalid if: target actor is dead, not in world, or target position
   * is no longer reachable.
   *
   * @param squadUnit — a representative squad unit for range checks
   */
  isTargetValid(squadUnit: IGameActorLike): boolean {
    if (!this._targetActor) return false
    if (!this._targetActor.isInWorld) return false
    if (this._targetActor.isDead) return false

    // Check if any squad unit can target
    let canTarget = false
    for (const unit of this.units) {
      if (this.squadManager.isValidTargetFor(unit, this._targetActor)) {
        canTarget = true
        break
      }
    }
    if (!canTarget) return false

    // Refresh target location (via closest enemy check)
    const refreshed = this.squadManager.findClosestEnemyForSquad(
      [this._targetActor],
      squadUnit,
    )
    this.setActorToTarget(refreshed)
    return refreshed.actor !== null
  }

  /**
   * Check if the target is currently visible.
   *
   * OpenRA 对照: Squad.IsTargetVisible
   */
  get isTargetVisible(): boolean {
    if (!this._targetActor) return false
    if (typeof this._targetActor.canBeViewedByPlayer === 'function') {
      return this._targetActor.canBeViewedByPlayer(this.bot.player)
    }
    return true
  }

  // -----------------------------------------------------------------------
  // Position helpers
  // -----------------------------------------------------------------------

  /**
   * Calculate the center position of the squad (average of all unit positions).
   *
   * OpenRA 对照: Squad.CenterPosition()
   *
   * Uses integer arithmetic.
   */
  centerPosition(): { x: number; y: number; z: number } {
    if (this.units.size === 0) return { x: 0, y: 0, z: 0 }

    let sumX = 0
    let sumY = 0
    let sumZ = 0
    for (const unit of this.units) {
      const cp = unit.centerPosition
      sumX += cp.x
      sumY += cp.y
      sumZ += cp.z
    }
    const n = this.units.size
    return {
      x: (sumX / n) | 0,
      y: (sumY / n) | 0,
      z: (sumZ / n) | 0,
    }
  }

  /**
   * Get the unit closest to the squad center.
   *
   * OpenRA 对照: Squad.CenterUnit()
   */
  centerUnit(): IGameActorLike | null {
    if (this.units.size === 0) return null
    const center = this.centerPosition()
    let bestUnit: IGameActorLike | null = null
    let bestDistSq = 2147483647 // INT32_MAX
    for (const unit of this.units) {
      const cp = unit.centerPosition
      const dx = cp.x - center.x
      const dy = cp.y - center.y
      const dz = cp.z - center.z
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestUnit = unit
      }
    }
    return bestUnit
  }

  // -----------------------------------------------------------------------
  // Serialization (对应 OpenRA Squad.Serialize() / Deserialize())
  // -----------------------------------------------------------------------

  /**
   * Serialize squad state for game saves.
   *
   * OpenRA 对照: Squad.Serialize()
   */
  serialize(): Record<string, unknown> {
    const unitIds: number[] = []
    for (const unit of this.units) {
      unitIds.push(unit.actorId)
    }

    const data: Record<string, unknown> = {
      type: this.type,
      units: unitIds,
    }

    if (this._target.type !== TargetType.Invalid && this._targetActor) {
      data.targetActorId = this._targetActor.actorId
      data.targetOffset = {
        x: this._target.offset.x,
        y: this._target.offset.y,
        z: this._target.offset.z,
      }
    }

    return data
  }

  /**
   * Deserialize a squad from game save data.
   *
   * OpenRA 对照: Squad.Deserialize(IBot, SquadManagerBotModule, MiniYaml)
   */
  static deserialize(
    bot: SquadBotLike,
    squadManager: SquadManagerLike,
    data: Record<string, unknown>,
    getActorById: (id: number) => IGameActorLike | undefined,
    random: SimplePrng,
  ): Squad {
    const type = (data.type as SquadType) ?? SquadType.Assault
    const targetActorId = data.targetActorId as number | undefined
    const targetOffset = (data.targetOffset as { x: number; y: number; z: number } | undefined)
      ?? { x: 0, y: 0, z: 0 }

    let target: { actor: IGameActorLike | null; offset: { x: number; y: number; z: number } } | null = null
    if (targetActorId !== undefined) {
      const actor = getActorById(targetActorId)
      if (actor) {
        target = { actor, offset: targetOffset }
      }
    }

    const squad = new Squad(bot, squadManager, type, target, random)
    return squad
  }
}

// ---------------------------------------------------------------------------
// SquadBotLike — minimal IBot interface for Squad order queuing
// ---------------------------------------------------------------------------

/**
 * Minimal bot interface for Squad.
 * Avoids circular dependency on ModularBot.
 */
export interface SquadBotLike {
  readonly player: unknown
  queueOrder(order: unknown): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel invalid target. */
const INVALID_TARGET: SquadTarget = {
  type: TargetType.Invalid,
  actor: null,
  centerPosition: { x: 0, y: 0, z: 0 },
  offset: { x: 0, y: 0, z: 0 },
}
