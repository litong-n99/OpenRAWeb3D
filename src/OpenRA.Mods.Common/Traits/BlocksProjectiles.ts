/**
 * BlocksProjectiles.ts -- Trait that blocks bullets and missiles with 'Blockable' property
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BlocksProjectiles.cs (74 lines)
 *
 * 核心范式转换:
 * - C# BlocksProjectilesInfo : ConditionalTraitInfo, IBlocksProjectilesInfo →
 *   TS ConditionalTraitInfo
 * - C# WDist Height → TS WDist
 * - C# PlayerRelationship flag enum → TS number bitmask
 * - C# static methods (AnyBlockingActorAt, AnyBlockingActorsBetween) →
 *   TS static methods with duck-typed world contracts
 */

import type { WDist } from '../../OpenRA.Game/WDist.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  PlayerRelationship,
  PlayerRelationshipExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IBlocksProjectiles } from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// BlocksProjectilesInfo
// OpenRA 对照: BlocksProjectilesInfo (ConditionalTraitInfo, IBlocksProjectilesInfo)
// ---------------------------------------------------------------------------

/** Configuration for BlocksProjectiles trait.
 *
 *  OpenRA 对照: BlocksProjectilesInfo
 */
export class BlocksProjectilesInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Height of blocking area above map terrain (WDist).
   *
   *  OpenRA 对照: BlocksProjectilesInfo.Height (default WDist.FromCells(1))
   */
  readonly height: WDist

  /** Relationships determining which projectiles to block.
   *
   *  OpenRA 对照: BlocksProjectilesInfo.ValidRelationships
   *  (default PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy)
   */
  readonly validRelationships: PlayerRelationship

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    height?: WDist
    validRelationships?: PlayerRelationship
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    // Default: 1 cell height, block all relationships
    this.height = params.height ?? ({ length: 1024, _brand: 'WDist' } as unknown as WDist)
    this.validRelationships = params.validRelationships ?? (
      (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
    )
  }
}

// ---------------------------------------------------------------------------
// BlocksProjectiles
// OpenRA 对照: BlocksProjectiles (ConditionalTrait<BlocksProjectilesInfo>, IBlocksProjectiles)
// ---------------------------------------------------------------------------

/** This actor blocks bullets and missiles with 'Blockable' property.
 *
 *  OpenRA 对照: BlocksProjectiles
 */
export class BlocksProjectiles
  extends ConditionalTrait<BlocksProjectilesInfo>
  implements IBlocksProjectiles
{
  constructor(info: BlocksProjectilesInfo) {
    super(info)
  }

  /** The maximum height at which projectiles become blocked.
   *
   *  OpenRA 对照: IBlocksProjectiles.BlockingHeight
   */
  get blockingHeight(): WDist {
    return this.info.height
  }

  /** Valid player relationships for blocking.
   *
   *  OpenRA 对照: IBlocksProjectiles.ValidRelationships
   */
  get validRelationships(): PlayerRelationship {
    return this.info.validRelationships
  }

  // -----------------------------------------------------------------------
  // Static helpers — projectile-block checks
  // -----------------------------------------------------------------------

  /**
   * Contract for world/map/actorMap needed by AnyBlockingActorAt.
   *
   *  OpenRA 对照: World (subset)
   */
  static readonly BlockingWorldContract = null as unknown as {
    readonly map: {
      distanceAboveTerrain(pos: unknown): WDist
      cellContaining(pos: unknown): unknown
    }
    readonly actorMap: {
      getActorsAt(cell: unknown): readonly IGameActor[]
    }
  }

  /**
   * Check if any actor at a world position blocks projectiles at the given height.
   *
   * OpenRA 对照: BlocksProjectiles.AnyBlockingActorAt(World, WPos)
   *
   * @param world — game world (duck-typed, needs map and actorMap)
   * @param pos — world position to check
   * @returns true if a blocking actor exists at this position with sufficient height
   */
  static anyBlockingActorAt(
    world: {
      readonly map: {
        distanceAboveTerrain(pos: unknown): WDist
        cellContaining(pos: unknown): unknown
      }
      readonly actorMap: {
        getActorsAt(cell: unknown): readonly IGameActor[]
      }
    },
    pos: unknown,
  ): boolean {
    const dat = world.map.distanceAboveTerrain(pos)
    const cell = world.map.cellContaining(pos)
    const actors = world.actorMap.getActorsAt(cell)

    for (const a of actors) {
      const blockers = (a as unknown as {
        traitsImplementing?: <T>(_tag: string) => readonly T[]
      }).traitsImplementing?.<{
        blockingHeight: WDist
        isTraitDisabled?: boolean
      }>('IBlocksProjectiles') ?? []

      for (const t of blockers) {
        if (t.isTraitDisabled !== true && t.blockingHeight.length > dat.length) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Check if any blocking actors exist between two world positions.
   *
   * OpenRA 对照: BlocksProjectiles.AnyBlockingActorsBetween(World, Player, WPos, WPos, WDist, out WPos)
   *
   * @param world — game world
   * @param owner — the projectile owner (player)
   * @param start — projectile start position
   * @param end — projectile end position
   * @param width — projectile width for line query
   * @param outHit — output parameter (object with hit property to set)
   * @returns true if a blocking actor is found between start and end
   */
  static anyBlockingActorsBetween(
    world: {
      readonly map: {
        distanceAboveTerrain(pos: unknown): WDist
      }
      findBlockingActorsOnLine?(start: unknown, end: unknown, width: WDist): readonly IGameActor[]
    },
    owner: {
      relationshipWith(other: unknown): PlayerRelationship
    },
    start: unknown,
    end: unknown,
    _width: WDist,
    outHit: { hit: unknown },
  ): boolean {
    // TODO-8.D.BLOCKING-LINE: Requires world.FindBlockingActorsOnLine() and
    // WPos.MinimumPointLineProjection(). Deferred until projectile system and
    // spatial line-queries are fully migrated.
    if (world.findBlockingActorsOnLine) {
      const actors = world.findBlockingActorsOnLine(start, end, _width)

      for (const a of actors) {
        const blockers = (a as unknown as {
          traitsImplementing?: <T>(_tag: string) => readonly T[]
        }).traitsImplementing?.<{
          isTraitDisabled?: boolean
          blockingHeight: WDist
          validRelationships: PlayerRelationship
        }>('IBlocksProjectiles') ?? []

        if (blockers.length === 0) continue

        for (const t of blockers) {
          if (t.isTraitDisabled === true) continue
          if (!PlayerRelationshipExts.hasRelationship(
            t.validRelationships,
            (a as unknown as { owner?: typeof owner }).owner?.relationshipWith(owner)
              ?? PlayerRelationship.None,
          )) {
            continue
          }

          const dat = world.map.distanceAboveTerrain(start)
          if (t.blockingHeight.length > dat.length) {
            outHit.hit = start
            return true
          }
        }
      }
    }

    outHit.hit = null
    return false
  }
}
