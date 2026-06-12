/**
 * FireClusterWarhead.ts -- Fires sub-weapons from the point of impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/FireClusterWarhead.cs
 *
 * 核心范式转换:
 * - C# WeaponInfo projectile creation → ProjectileEffect deferred effect
 * - C# Game.Sound.Play (weapon report) → SoundEffectData deferred
 * - C# Map.CellContaining + CellsMatching footprint → TypeScript cell iteration
 * - C# CVec Dimensions + Footprint string → parsed footprint array
 * - C# IRulesetLoaded<WeaponInfo> → loadWeaponRef() post-construction
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import {
  Warhead,
  type WarheadArgs,
  type WarheadEffect,
  type ProjectileEffect,
  type SoundEffectData,
  type WarheadActorLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Cluster target stub (duck-typed)
// ---------------------------------------------------------------------------

interface ClusterTargetStub {
  centerPosition: WPos
  actor?: IGameActor | null
  type: number
}

// ---------------------------------------------------------------------------
// FireClusterWarhead (对应 OpenRA FireClusterWarhead)
// ---------------------------------------------------------------------------

/**
 * Fires weapons from the point of impact in a cluster pattern.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.FireClusterWarhead
 *
 * Creates a cluster of sub-explosions at cells matching a footprint
 * pattern around the impact cell. Supports random cluster count.
 */
export class FireClusterWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Referenced weapon to fire at cluster cells.
   *
   * OpenRA 对照: FireClusterWarhead.Weapon
   */
  weapon: string = ''

  /** Number of random cells to fire at. Negative = all random cells.
   *
   * OpenRA 对照: FireClusterWarhead.RandomClusterCount
   */
  randomClusterCount: number = -1

  /** Size of the cluster footprint in cells.
   *
   * OpenRA 对照: FireClusterWarhead.Dimensions
   */
  dimensions: CVec = new CVec(0, 0)

  /** Cluster footprint pattern (X = always, x = random).
   *
   * OpenRA 对照: FireClusterWarhead.Footprint
   */
  footprint: string = ''

  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------

  private _weaponRef: Record<string, unknown> | null = null

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Weapon !== undefined) this.weapon = json.Weapon as string
    if (json.RandomClusterCount !== undefined) this.randomClusterCount = json.RandomClusterCount as number
    if (json.Dimensions !== undefined) {
      const arr = json.Dimensions as number[]
      this.dimensions = new CVec(arr[0] ?? 0, arr[1] ?? 0)
    }
    if (json.Footprint !== undefined) this.footprint = json.Footprint as string
  }

  /**
   * Set the weapon reference after construction.
   *
   * OpenRA 对照: IRulesetLoaded.RulesetLoaded(Ruleset, WeaponInfo)
   *
   * @param weapon -- the resolved weapon info object
   */
  setWeaponRef(weapon: Record<string, unknown>): void {
    this._weaponRef = weapon
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Fire cluster weapons at the impact cell footprint.
   *
   * OpenRA 对照: FireClusterWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    args: WarheadArgs,
  ): WarheadEffect[] {
    if (!this._weaponRef) return []

    const world = (firedBy as unknown as WarheadActorLike).world
    if (!world?.map) return []

    const map = world.map
    const targetCell = map.cellContaining(pos)
    const effects: WarheadEffect[] = []

    // Fire at non-random cells (marked 'X')
    const fixedCells = this._cellsMatching(targetCell, false)
    for (const c of fixedCells) {
      effects.push(...this._fireProjectileAtCell(
        map, firedBy, new ClusterTarget(pos), c, args,
      ))
    }

    // Fire at random cells (marked 'x')
    if (this.randomClusterCount !== 0) {
      const randomCells = this._cellsMatching(targetCell, true)
      const clusterCount = this.randomClusterCount < 0
        ? randomCells.length
        : this.randomClusterCount

      if (randomCells.length > 0) {
        for (let i = 0; i < clusterCount; i++) {
          const randomCell = randomCells[Math.floor(Math.random() * randomCells.length)]
          effects.push(...this._fireProjectileAtCell(
            map, firedBy, new ClusterTarget(pos), randomCell, args,
          ))
        }
      }
    }

    return effects
  }

  // -----------------------------------------------------------------------
  // Cell footprint matching
  // -----------------------------------------------------------------------

  /**
   * Get cells matching the footprint pattern.
   *
   * OpenRA 对照: FireClusterWarhead.CellsMatching(CPos location, bool random)
   *
   * @param location -- center cell position
   * @param random -- if true, match 'x' cells; if false, match 'X' cells
   * @returns array of matching cell positions
   */
  private _cellsMatching(location: CPos, random: boolean): CPos[] {
    const cellType = random ? 'x' : 'X'
    const result: CPos[] = []
    const footprint = this.footprint.replace(/\s/g, '').split('')
    let index = 0
    const startX = location.X - Math.floor((this.dimensions.X - 1) / 2)
    const startY = location.Y - Math.floor((this.dimensions.Y - 1) / 2)

    for (let j = 0; j < this.dimensions.Y; j++) {
      for (let i = 0; i < this.dimensions.X; i++) {
        if (index < footprint.length && footprint[index] === cellType) {
          result.push(new CPos(startX + i, startY + j))
        }
        index++
      }
    }

    return result
  }

  /**
   * Fire the configured weapon at a specific cell.
   *
   * OpenRA 对照: FireClusterWarhead.FireProjectileAtCell()
   */
  private _fireProjectileAtCell(
    map: NonNullable<WarheadActorLike['world']>['map'] & {},
    firedBy: IGameActor,
    target: ClusterTargetStub,
    targetCell: CPos,
    args: WarheadArgs,
  ): WarheadEffect[] {
    const effects: (ProjectileEffect | SoundEffectData)[] = []

    if (!map) return effects

    const tc = Target.fromPos(map.centerOfCell(targetCell))

    // Check weapon validity against cell target
    // NOTE: Full WeaponInfo.IsValidAgainst check deferred; stub assumes valid

    const facing = WPos.subtract(
      map.centerOfCell(targetCell),
      target.centerPosition,
    ).yaw

    const projectileEffect: ProjectileEffect = {
      type: 'projectile',
      weapon: this.weapon,
      source: target.centerPosition,
      target: tc,
      facing,
      sourceActor: firedBy,
      damageModifiers: args.damageModifiers,
    }

    effects.push(projectileEffect)

    // Play weapon report sound if configured
    const report = this._weaponRef?.['Report'] as string[] | undefined
    if (report && report.length > 0) {
      effects.push({
        type: 'sound',
        name: report[Math.floor(Math.random() * report.length)],
        pos: target.centerPosition,
      } as SoundEffectData)
    }

    return effects
  }
}

// ---------------------------------------------------------------------------
// ClusterTarget — minimal target stub for cluster use
// ---------------------------------------------------------------------------

class ClusterTarget {
  readonly centerPosition: WPos
  readonly type: number = 2 // TargetType.Terrain
  readonly actor: null = null

  constructor(centerPosition: WPos) {
    this.centerPosition = centerPosition
  }
}
