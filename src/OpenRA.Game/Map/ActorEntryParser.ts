/**
 * ActorEntryParser.ts — Parses raw map JSON actor entries into ActorInitializer
 * OpenRA 对照: OpenRA.Game/Map/ActorReference.cs + World.LoadComplete (actor spawning)
 *
 * 核心范式转换:
 * - C# ActorReference(Type, InitDict) with TypeDictionary from MiniYaml
 *   → TypeScript parseActorEntry(json) producing ActorInitializer
 * - C# MiniYaml-based actor serialization with FieldLoader
 *   → TypeScript JSON-based parsing with explicit init type resolution
 * - C# case-insensitive type matching in TypeDictionary
 *   → TypeScript string-based typeName matching (explicit)
 *
 * Map JSON format for actor entries:
 *   {
 *     "type": "e1",
 *     "location": { "x": 42, "y": 17 },
 *     "owner": "Multi0",
 *     "facing": 128
 *   }
 */

import { CPos } from '../CPos.js'
import {
  ActorInitializer,
  LocationInit,
  OwnerNameInit,
  FacingInit,
  type ActorInit,
} from '../Traits/ActorInitializer.js'

// ---------------------------------------------------------------------------
// ActorEntry — raw JSON shape for a single map actor entry
// ---------------------------------------------------------------------------

/**
 * Raw JSON shape for a single actor entry in map data.
 *
 * OpenRA 对照: ActorReference.Type + InitDict (MiniYaml)
 *
 * The map JSON contains an array of these entries under the "Actors" key.
 * Each entry describes one actor to be spawned: its type, location, owner,
 * and optional extra properties.
 */
export interface ActorEntry {
  /** Actor type name (e.g., "e1", "harv", "mcv").
   *
   * OpenRA 对照: ActorReference.Type
   */
  type: string

  /** Cell location on the map.
   *
   * OpenRA 对照: LocationInit (CPos value)
   */
  location?: { x: number; y: number } | null

  /** Owner player internal name (e.g., "Multi0", "Neutral").
   *
   * OpenRA 对照: OwnerInit(string InternalName)
   */
  owner?: string | null

  /** Initial facing direction in WAngle units (0-1023).
   *
   * OpenRA 对照: FacingInit(WAngle)
   */
  facing?: number | null

  /** Additional properties (unrecognized, stored as-is).
   *
   * OpenRA 对照: arbitrary MiniYaml nodes
   */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw actor entry into an ActorInitializer.
 *
 * OpenRA 对照: ActorReference constructor — splits type + initDict
 *
 * Resolves common init types from the raw JSON:
 * - `location` → LocationInit
 * - `owner` → OwnerNameInit (string form, resolved later)
 * - `facing` → FacingInit
 *
 * Unknown keys are silently ignored (they may be used by custom traits).
 *
 * @param entry — raw JSON actor entry from map data
 * @returns an ActorInitializer with the parsed inits
 * @throws if entry.type is missing or empty
 */
export function parseActorEntry(entry: ActorEntry): ActorInitializer {
  if (!entry.type || typeof entry.type !== 'string' || entry.type.trim().length === 0) {
    throw new Error('ActorEntryParser: entry is missing required field "type"')
  }

  const inits: ActorInit[] = []

  // Resolve location
  if (entry.location && typeof entry.location.x === 'number' && typeof entry.location.y === 'number') {
    const { x, y } = entry.location
    // Create a CPos from x, y coordinates. Import CPos here to avoid
    // the circular dependency with CPos.ts (CPos imports from Map/).
    const cpos = createCPos(x, y)
    inits.push(new LocationInit(cpos))
  }

  // Resolve owner (as string name — resolved to PlayerStub later)
  if (typeof entry.owner === 'string' && entry.owner.length > 0) {
    inits.push(new OwnerNameInit(entry.owner))
  }

  // Resolve facing
  if (typeof entry.facing === 'number') {
    inits.push(new FacingInit(entry.facing))
  }

  return new ActorInitializer(inits)
}

/**
 * Parse an array of raw actor entries into ActorInitializers.
 *
 * OpenRA 对照: iterating Map.Actors section and calling CreateActor for each
 *
 * @param entries — array of raw JSON actor entries
 * @returns array of { type, initializer } for actor creation
 */
export function parseActorEntries(
  entries: readonly ActorEntry[],
): readonly ActorEntryResult[] {
  const results: ActorEntryResult[] = []

  for (const entry of entries) {
    try {
      const initializer = parseActorEntry(entry)
      results.push({ type: entry.type, initializer })
    } catch (e) {
      console.warn(
        `[ActorEntryParser] Skipping invalid actor entry: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// ActorEntryResult — parsed result type
// ---------------------------------------------------------------------------

/**
 * Result of parsing a single actor entry.
 */
export interface ActorEntryResult {
  /** The actor type name (e.g., "e1", "mcv"). */
  readonly type: string

  /** The parsed initializer with resolved inits. */
  readonly initializer: ActorInitializer
}

// ---------------------------------------------------------------------------
// Internal: CPos factory
// ---------------------------------------------------------------------------

/**
 * Create a CPos from x, y coordinates (layer 0).
 *
 * CPos is directly imported above — no circular dependency because
 * CPos.ts imports from MapGridType, not from ActorEntryParser.
 */
function createCPos(x: number, y: number): CPos {
  return new CPos(x, y)
}
