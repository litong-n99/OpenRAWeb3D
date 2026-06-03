/**
 * SubCell.ts — Sub-cell position enumeration for fine-grained targeting
 * OpenRA 对照: OpenRA.Game/Traits/TraitsInterfaces.cs (SubCell enum)
 *
 * 核心范式转换:
 * - C# enum : byte → TypeScript const enum-like object
 * - Exact numeric values preserved for protocol compatibility
 */

// ---------------------------------------------------------------------------
// SubCell
// ---------------------------------------------------------------------------

/**
 * Sub-cell position for fine-grained unit targeting within a cell.
 *
 * OpenRA 对照: SubCell enum
 *
 * Values:
 * - Invalid (255): no valid sub-cell position
 * - Any (254): wildcard matching any sub-cell
 * - FullCell (0): the entire cell (center)
 * - First (1): the first distinct sub-cell position
 */
export const SubCell = {
  /** No valid sub-cell position. */
  Invalid: 255,
  /** Wildcard matching any sub-cell position. */
  Any: 254,
  /** The entire cell (center position). */
  FullCell: 0,
  /** The first distinct sub-cell position. */
  First: 1,
} as const

export type SubCell = (typeof SubCell)[keyof typeof SubCell]
