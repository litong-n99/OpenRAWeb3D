/**
 * BlockedByActor.ts — Actor blocking level enumeration for pathfinding
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (BlockedByActor enum)
 *
 * 核心范式转换:
 * - C# enum → TypeScript const object + union type
 * - Exact numeric values preserved for protocol compatibility
 *
 * STUB: This is a minimal stub for Phase G pathfinding.
 * Full Locomotor implementation will be expanded in Chapter 5.
 */

// ---------------------------------------------------------------------------
// BlockedByActor enum
// ---------------------------------------------------------------------------

/**
 * Determines how actors on the map affect pathfinding and movement.
 *
 * OpenRA 对照: BlockedByActor enum
 *
 * - None: Actors are ignored; only impassable terrain blocks.
 * - Immovable: Moving actors and allied movable actors are ignored.
 * - Stationary: Only moving actors are ignored.
 * - All: All actors can block movement.
 */
export const BlockedByActor = {
  /** Actors on the map are ignored. Only impassable terrain blocks. */
  None: 0,
  /** Moving actors and allied movable actors are ignored. */
  Immovable: 1,
  /** Only moving actors are ignored. */
  Stationary: 2,
  /** All actors can block movement. */
  All: 3,
} as const

/** Type for BlockedByActor values. */
export type BlockedByActor = (typeof BlockedByActor)[keyof typeof BlockedByActor]
