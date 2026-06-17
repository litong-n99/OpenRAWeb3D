/**
 * WithHarvesterSpriteBody.ts — 采集车精灵主体，根据满载率切换图像
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithHarvesterSpriteBody.cs (50 lines)
 *
 * 核心范式转换:
 * - C# WithFacingSpriteBody (base class with ITick) → TS duck-typed IFacingSpriteBody
 * - C# ImageByFullness 不可变数组 → TS readonly string[]
 * - C# Harvester.Fullness → TS duck-typed Harvester trait
 * - C# Animation.ChangeImage → TS duck-typed animation changeImage
 *
 * 采集车的 Fullness 范围为 0-100。通过 imageByFullness 数组的索引映射，
 * 在不同满载阶段切换精灵图像，实现采集车"装满"的视觉效果。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces for base classes not yet fully migrated
// ---------------------------------------------------------------------------

/** Minimal interface for WithFacingSpriteBody base trait.
 *
 * OpenRA 对照: WithFacingSpriteBody : WithSpriteBody
 */
export interface IFacingSpriteBody {
  readonly info: { readonly name: string; readonly enabledByDefault: boolean }
  readonly defaultAnimation: {
    changeImage(image: string, sequence: string): void
    readonly currentSequence: { readonly name: string }
  }
}

/** Minimal interface for Harvester trait.
 *
 * OpenRA 对照: Harvester
 */
export interface IHarvesterAccess {
  readonly fullness: number
}

// ---------------------------------------------------------------------------
// WithHarvesterSpriteBodyInfo
// OpenRA 对照: WithHarvesterSpriteBodyInfo : WithFacingSpriteBodyInfo, Requires<HarvesterInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithHarvesterSpriteBody.
 *
 * OpenRA 对照: WithHarvesterSpriteBodyInfo
 */
export class WithHarvesterSpriteBodyInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly enabledByDefault: boolean

  /** Images switched between depending on fullness of harvester.
   * Overrides RenderSprites.Image.
   *
   * OpenRA 对照: WithHarvesterSpriteBodyInfo.ImageByFullness (ImmutableArray<string>)
   */
  readonly imageByFullness: readonly string[]

  constructor(params: {
    instanceName?: string
    enabledByDefault?: boolean
    imageByFullness?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.enabledByDefault = params.enabledByDefault ?? true
    this.imageByFullness = params.imageByFullness ?? []
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithHarvesterSpriteBodyInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithHarvesterSpriteBody {
    return new WithHarvesterSpriteBody(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithHarvesterSpriteBody
// OpenRA 对照: WithHarvesterSpriteBody : WithFacingSpriteBody, ITick
// ---------------------------------------------------------------------------

/** Harvester sprite body that changes image based on cargo fullness.
 *
 * OpenRA 对照: WithHarvesterSpriteBody
 *
 * On each tick, the current harvester fullness (0-100) is mapped to an index
 * in imageByFullness, and the animation's image is updated accordingly.
 */
export class WithHarvesterSpriteBody {
  readonly info: WithHarvesterSpriteBodyInfo
  private readonly _harvester: IHarvesterAccess | null
  private readonly _body: IFacingSpriteBody

  constructor(self: IGameActor, info: WithHarvesterSpriteBodyInfo) {
    this.info = info
    this._harvester = (self as any).trait?.('Harvester') as IHarvesterAccess | null ?? null
    this._body = (self as any) as IFacingSpriteBody
  }

  // -------------------------------------------------------------------------
  // ITick
  // 对照: ITick.Tick(Actor self)
  // -------------------------------------------------------------------------

  /** Update the sprite image based on current harvester fullness.
   *
   * OpenRA 对照: WithHarvesterSpriteBody.ITick.Tick(Actor self)
   *
   * The desired image index is calculated as:
   *   fullness * (imageByFullness.length - 1) / 100
   *
   * @param _self — the actor (unused, body reference stored at construction)
   */
  tick(_self: IGameActor): void {
    if (!this._harvester || this.info.imageByFullness.length === 0) return

    const fullness = this._harvester.fullness
    const desiredState =
      (fullness * (this.info.imageByFullness.length - 1)) / 100
    const desiredImage = this.info.imageByFullness[Math.round(desiredState)]!

    const currentSeq = this._body.defaultAnimation.currentSequence
    this._body.defaultAnimation.changeImage(desiredImage, currentSeq.name)
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
