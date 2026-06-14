/**
 * Buildable.ts -- 可建造标记：定义哪些生产队列可以建造此 Actor，及其前提条件与限制
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildable.cs (69 lines)
 *
 * 核心范式转换:
 * - C# ImmutableArray<string> Prerequisites → TS readonly string[]
 * - C# FrozenSet<string> Queue → TS ReadonlySet<string>
 * - C# static GetInitialFaction() → TS static getInitialFaction()
 * - C# null string defaults → TS null (保留 C# 语义)
 *
 * BuildableInfo 是配置类，Buildable 是空标记 trait。ProductionQueue 通过
 * BuildableInfo.Queue 的 Set 成员关系检查来决定 Actor 是否可加入队列。
 */

import type { ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// BuildableInfo
// OpenRA 对照: BuildableInfo (TraitInfo<Buildable>)
// ---------------------------------------------------------------------------

/** Configuration for the Buildable trait.
 *
 * OpenRA 对照: BuildableInfo
 *
 * Defines which production queues can build this actor, prerequisites,
 * build limits, faction overrides, and production UI metadata.
 */
export class BuildableInfo implements ITraitInfo {
  readonly instanceName?: string

  /** The prerequisite names that must be available before this can be built.
   *
   * This can be prefixed with `!` to invert the prerequisite (disabling
   * production if the prerequisite is available) and/or `~` to hide the
   * actor from the production palette if the prerequisite is not available.
   *
   * OpenRA 对照: BuildableInfo.Prerequisites (ImmutableArray<string>)
   */
  readonly prerequisites: readonly string[] = []

  /** Production queue(s) that can produce this actor.
   *
   * OpenRA 对照: BuildableInfo.Queue (FrozenSet<string>)
   *
   * NOTE: 使用 ReadonlySet<string> 确保 ProductionQueue 的 `has()` 检查
   * 语义与 C# FrozenSet 一致。
   */
  readonly queue: ReadonlySet<string>

  /** Override the production structure type (from the Production Produces list)
   * that this unit should be built at.
   *
   * OpenRA 对照: BuildableInfo.BuildAtProductionType
   */
  readonly buildAtProductionType: string | null = null

  /** Disable production when there are more than this many of this actor
   * on the battlefield. Set to 0 to disable the limit.
   *
   * OpenRA 对照: BuildableInfo.BuildLimit
   */
  readonly buildLimit: number = 0

  /** Force a specific faction variant, overriding the faction of the
   * producing actor.
   *
   * OpenRA 对照: BuildableInfo.ForceFaction
   */
  readonly forceFaction: string | null = null

  /** Sequence of the actor that contains the production icon.
   *
   * OpenRA 对照: BuildableInfo.Icon
   */
  readonly icon: string = 'icon'

  /** Palette used for the production icon.
   *
   * OpenRA 对照: BuildableInfo.IconPalette
   */
  readonly iconPalette: string = 'chrome'

  /** Whether the custom icon palette is a player palette (BaseName).
   *
   * OpenRA 对照: BuildableInfo.IconPaletteIsPlayerPalette
   */
  readonly iconPaletteIsPlayerPalette: boolean = false

  /** Base build time in frames. -1 indicates to use the unit's Value.
   *
   * OpenRA 对照: BuildableInfo.BuildDuration
   */
  readonly buildDuration: number = -1

  /** Percentage modifier to apply to the build duration.
   *
   * OpenRA 对照: BuildableInfo.BuildDurationModifier
   */
  readonly buildDurationModifier: number = 60

  /** Sort order for the production palette. Smaller numbers are presented earlier.
   *
   * OpenRA 对照: BuildableInfo.BuildPaletteOrder
   */
  readonly buildPaletteOrder: number = 9999

  /** Text shown in the production tooltip.
   *
   * OpenRA 对照: BuildableInfo.Description
   */
  readonly description: string | null = null

  constructor(params: {
    instanceName?: string
    prerequisites?: readonly string[]
    queue?: ReadonlySet<string> | readonly string[]
    buildAtProductionType?: string | null
    buildLimit?: number
    forceFaction?: string | null
    icon?: string
    iconPalette?: string
    iconPaletteIsPlayerPalette?: boolean
    buildDuration?: number
    buildDurationModifier?: number
    buildPaletteOrder?: number
    description?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    this.prerequisites = params.prerequisites ?? []

    // Accept either ReadonlySet<string> or string[] for queue
    if (params.queue instanceof Set || (params.queue && 'has' in params.queue)) {
      this.queue = params.queue as ReadonlySet<string>
    } else if (params.queue && Array.isArray(params.queue)) {
      this.queue = new Set(params.queue)
    } else {
      this.queue = new Set()
    }

    this.buildAtProductionType = params.buildAtProductionType ?? null
    this.buildLimit = params.buildLimit ?? 0
    this.forceFaction = params.forceFaction ?? null
    this.icon = params.icon ?? 'icon'
    this.iconPalette = params.iconPalette ?? 'chrome'
    this.iconPaletteIsPlayerPalette = params.iconPaletteIsPlayerPalette ?? false
    this.buildDuration = params.buildDuration ?? -1
    this.buildDurationModifier = params.buildDurationModifier ?? 60
    this.buildPaletteOrder = params.buildPaletteOrder ?? 9999
    this.description = params.description ?? null
  }

  /** Get the initial faction for an actor, using its BuildableInfo.ForceFaction
   * if available, otherwise falling back to the default faction.
   *
   * OpenRA 对照: BuildableInfo.GetInitialFaction(ActorInfo, string)
   *
   * @param actorInfo — the actor's metadata
   * @param defaultFaction — fallback faction if no ForceFaction is set
   * @returns the resolved faction string
   */
  static getInitialFaction(_actorInfo: ActorInfoStub, defaultFaction: string): string {
    // NOTE: In the full implementation, actorInfo would have traitInfo lookup.
    // For now, we return defaultFaction since ActorInfoStub doesn't expose
    // trait configuration. This will be resolved when ActorInfo is fully migrated.
    return defaultFaction
  }
}

// ---------------------------------------------------------------------------
// Buildable
// OpenRA 对照: Buildable (empty marker trait)
// ---------------------------------------------------------------------------

/** Empty marker trait indicating this actor can be built in production queues.
 *
 * OpenRA 对照: Buildable
 *
 * The actual build configuration is in BuildableInfo. This class has no
 * runtime logic.
 */
export class Buildable {
  // intentionally empty — marker trait
}
