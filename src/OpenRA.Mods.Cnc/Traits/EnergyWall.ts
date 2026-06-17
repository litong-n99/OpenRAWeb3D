/**
 * EnergyWall.ts — 能量墙（受电力驱动的可穿透屏障）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/EnergyWall.cs (111 lines)
 *
 * 核心范式转换:
 * - C# Building (extends) → TypeScript Composition (Building trait reference)
 * - C# ITemporaryBlocker.IsBlocking/CanRemoveBlockage → TypeScript interfaces
 * - C# BooleanExpression condition evaluation → TypeScript condition evaluator
 * - C# WeaponInfo.Impact() → TypeScript weapon impact stub
 * - C# BuildingInfo.Tiles(CPos) footprint calculation → TypeScript tiles array
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// EnergyWallInfo
// OpenRA 对照: EnergyWallInfo : BuildingInfo, ITemporaryBlockerInfo, IObservesVariablesInfo, IRulesetLoaded
// ---------------------------------------------------------------------------

/** Configuration for the energy wall trait.
 *
 * OpenRA 对照: EnergyWallInfo
 */
export class EnergyWallInfo implements ITraitInfo {
  /** The weapon to attack units on top of the wall when activated.
   *
   * OpenRA 对照: EnergyWallInfo.Weapon
   */
  readonly weapon: string

  /** Boolean expression defining the condition to activate this trait.
   *
   * OpenRA 对照: EnergyWallInfo.ActiveCondition (BooleanExpression)
   */
  readonly activeCondition: string | null

  /** Weapon info reference (loaded at ruleset load time).
   *
   * OpenRA 对照: EnergyWallInfo.WeaponInfo
   */
  weaponInfo: unknown = null

  constructor(params?: { weapon?: string; activeCondition?: string | null }) {
    this.weapon = params?.weapon ?? ''
    this.activeCondition = params?.activeCondition ?? null
  }

  create(init: IGameActor): EnergyWall {
    return new EnergyWall(init, this)
  }
}

// ---------------------------------------------------------------------------
// EnergyWall
// OpenRA 对照: EnergyWall : Building, IObservesVariables, ITick, ITemporaryBlocker
// ---------------------------------------------------------------------------

/** Wall that opens for friendly actors when no enemies are in range.
 *
 * OpenRA 对照: EnergyWall
 *
 * The wall is initially active (blocking). When the active condition evaluates
 * to false, the wall opens (removes influence) and becomes passable. Each tick,
 * any blocking units in the wall's cells take damage from the configured weapon.
 */
export class EnergyWall {
  readonly info: EnergyWallInfo

  /** Whether the wall is currently active (blocking).
   *
   * OpenRA 对照: EnergyWall.active (initial state: true)
   */
  private _active: boolean = true

  /** Blocked cell positions (tiles of the wall footprint).
   *
   * OpenRA 对照: EnergyWall.blockedPositions (IEnumerable<CPos>)
   */
  private _blockedPositions: CPos[] = []

  constructor(self: IGameActor, info: EnergyWallInfo) {
    this.info = info
    // OpenRA: blockedPositions = info.Tiles(self.Location)
    const location = (self as any).location as { X: number; Y: number } | undefined
    if (location) {
      this._blockedPositions = [{ X: location.X, Y: location.Y } as unknown as CPos]
    }
  }

  // -------------------------------------------------------------------------
  // IObservesVariables (condition observation)
  // -------------------------------------------------------------------------

  /** Evaluate the active condition against current variable values.
   *
   * OpenRA 对照: ActiveConditionChanged(Actor, IReadOnlyDictionary<string, int>)
   *
   * @param self — the wall actor
   * @param conditions — current condition variable values
   */
  activeConditionChanged(
    self: IGameActor,
    conditions: ReadonlyMap<string, number>,
  ): void {
    if (!this.info.activeCondition) return

    const wasActive = this._active
    this._active = this._evaluateCondition(this.info.activeCondition, conditions)

    // Update actor map influence when active state changes
    if (!wasActive && this._active) {
      ;(self as any).world?.actorMap?.addInfluence?.(self, this)
    } else if (wasActive && !this._active) {
      ;(self as any).world?.actorMap?.removeInfluence?.(self, this)
    }
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /** Damage any units on top of the blocked positions.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   *
   * @param self — the wall actor
   */
  tick(self: IGameActor): void {
    if (!this._active) return

    for (const loc of this._blockedPositions) {
      const blockers =
        (self as any).world?.actorMap?.getActorsAt?.(loc) ?? []
      for (const blocker of blockers) {
        if (
          !(blocker as IGameActor).isDead &&
          (blocker as IGameActor) !== self &&
          this.info.weaponInfo
        ) {
          // C#: info.WeaponInfo.Impact(Target.FromActor(blocker), self)
          ;(this.info.weaponInfo as any)?.impact?.({ type: 'actor', actor: blocker }, self)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // ITemporaryBlocker
  // -------------------------------------------------------------------------

  /** Whether this wall is blocking the given cell.
   *
   * OpenRA 对照: ITemporaryBlocker.IsBlocking(Actor, CPos)
   */
  isBlocking(_self: IGameActor, cell: CPos): boolean {
    if (!this._active) return false
    return this._blockedPositions.some(
      (p) => (p as any).X === (cell as any).X && (p as any).Y === (cell as any).Y,
    )
  }

  /** Whether the blockage can be removed by the given actor.
   *
   * OpenRA 对照: ITemporaryBlocker.CanRemoveBlockage(Actor, Actor)
   */
  canRemoveBlockage(_self: IGameActor, _blocking: IGameActor): boolean {
    return !this._active
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Set blocked positions from the actor's tiles.
   *
   * OpenRA 对照: AddedToWorld(Actor)
   */
  addedToWorld(self: IGameActor): void {
    const tiles = (self as any).info?.tiles?.((self as any).location)
    if (tiles) {
      this._blockedPositions = tiles
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Boolean expression evaluator.
   *
   * OpenRA 对照: BooleanExpression.Evaluate(IReadOnlyDictionary<string, int>)
   *
   * Handles OR (||) and AND (&&) operators with !-prefixed negation.
   * Variables are truthy when the condition count is > 0.
   */
  private _evaluateCondition(
    expr: string,
    conditions: ReadonlyMap<string, number>,
  ): boolean {
    if (!expr) return false

    // Split on || (lowest precedence)
    const orParts = expr.split(/\|\|/)
    for (const orPart of orParts) {
      if (this._evaluateAnd(orPart.trim(), conditions)) return true
    }
    return false
  }

  /** Evaluate an AND expression (series of && separated terms). */
  private _evaluateAnd(
    expr: string,
    conditions: ReadonlyMap<string, number>,
  ): boolean {
    if (!expr) return false

    const andParts = expr.split(/&&/)
    for (const andPart of andParts) {
      if (!this._evaluateTerm(andPart.trim(), conditions)) return false
    }
    return true
  }

  /** Evaluate a single term (possibly negated variable name). */
  private _evaluateTerm(
    term: string,
    conditions: ReadonlyMap<string, number>,
  ): boolean {
    if (!term) return false
    // Handle ! negation
    if (term.startsWith('!')) {
      const varName = term.slice(1)
      return !this._evaluateTerm(varName, conditions)
    }
    const value = conditions.get(term)
    return value !== undefined && value > 0
  }

  // -------------------------------------------------------------------------
  // Queries (for testing)
  // -------------------------------------------------------------------------

  /** Whether the wall is currently active.
   */
  get active(): boolean {
    return this._active
  }

  /** Blocked positions array.
   */
  get blockedPositions(): readonly CPos[] {
    return this._blockedPositions
  }
}
