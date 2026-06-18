/**
 * BaseProvider.ts — 基地半径提供者：限制建造范围并显示冷却进度条
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/BaseProvider.cs (135 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<BaseProviderInfo> → TS ConditionalTrait<BaseProviderInfo>
 * - C# Color struct → TS ColorStub { r, g, b, a }
 * - C# WDist Range → TS WDist
 * - C# DeveloperMode trait lookup → TS 桩 (DeveloperMode 未迁移)
 * - C# MapBuildRadius 查找 → TS 桩 (使用 info 默认值)
 * - C# RangeCircleAnnotationRenderable → TS 3D 范围圈桩 (返回空数组)
 * - C# yield return IRenderable → TS 数组返回
 * - 3D 范围圈渲染暂存 (: 实现 LinesMesh 范围圈)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  ITick,
  ISelectionBar,
  IRenderAnnotationsWhenSelected,
  IRenderable,
  WorldRendererStub,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { MapBuildRadius } from '../World/MapBuildRadius.js'

// ---------------------------------------------------------------------------
// BaseProviderInfo
// OpenRA 对照: BaseProviderInfo : PausableConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the BaseProvider trait.
 *
 * OpenRA 对照: BaseProviderInfo
 *
 * Defines the build radius around a base structure, including cooldown
 * mechanics and visualization.
 */
export class BaseProviderInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Maximum build radius around this actor.
   *
   * OpenRA 对照: BaseProviderInfo.Range (WDist)
   *
   * Default: WDist.fromCells(10) = 10240 WDist sub-units.
   */
  readonly range: WDist

  /** Cooldown ticks before base provider is ready again after building.
   *
   * OpenRA 对照: BaseProviderInfo.Cooldown (default 0)
   */
  readonly cooldown: number

  /** Initial delay ticks before base provider becomes ready.
   *
   * OpenRA 对照: BaseProviderInfo.InitialDelay (default 0)
   */
  readonly initialDelay: number

  /** Range circle color when operational.
   *
   * OpenRA 对照: BaseProviderInfo.CircleReadyColor
   *
   * Default: Color.FromArgb(128, Color.White) → { r:255, g:255, b:255, a:128 }.
   */
  readonly circleReadyColor: ColorStub

  /** Range circle color when inactive (cooldown/disabled).
   *
   * OpenRA 对照: BaseProviderInfo.CircleBlockedColor
   *
   * Default: Color.FromArgb(128, Color.Red) → { r:255, g:0, b:0, a:128 }.
   */
  readonly circleBlockedColor: ColorStub

  /** Range circle line width.
   *
   * OpenRA 对照: BaseProviderInfo.CircleWidth (default 1)
   */
  readonly circleWidth: number

  /** Range circle border color.
   *
   * OpenRA 对照: BaseProviderInfo.CircleBorderColor
   *
   * Default: Color.FromArgb(96, Color.Black) → { r:0, g:0, b:0, a:96 }.
   */
  readonly circleBorderColor: ColorStub

  /** Range circle border width.
   *
   * OpenRA 对照: BaseProviderInfo.CircleBorderWidth (default 3)
   */
  readonly circleBorderWidth: number

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    range?: WDist
    cooldown?: number
    initialDelay?: number
    circleReadyColor?: ColorStub
    circleBlockedColor?: ColorStub
    circleWidth?: number
    circleBorderColor?: ColorStub
    circleBorderWidth?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.range = params.range ?? WDist.fromCells(10)
    this.cooldown = params.cooldown ?? 0
    this.initialDelay = params.initialDelay ?? 0
    this.circleReadyColor = params.circleReadyColor ?? {
      r: 255,
      g: 255,
      b: 255,
      a: 128,
    }
    this.circleBlockedColor = params.circleBlockedColor ?? {
      r: 255,
      g: 0,
      b: 0,
      a: 128,
    }
    this.circleWidth = params.circleWidth ?? 1
    this.circleBorderColor = params.circleBorderColor ?? {
      r: 0,
      g: 0,
      b: 0,
      a: 96,
    }
    this.circleBorderWidth = params.circleBorderWidth ?? 3
  }
}

// ---------------------------------------------------------------------------
// BaseProvider
// OpenRA 对照: BaseProvider : PausableConditionalTrait<BaseProviderInfo>,
//   ITick, IRenderAnnotationsWhenSelected, ISelectionBar
// ---------------------------------------------------------------------------

/** Provides a build radius around a base structure.
 *
 * OpenRA 对照: BaseProvider
 *
 * Tracks cooldown after building, generates range circle renderables
 * for visualization (3D: LinesMesh/TorusMesh — stubbed currently),
 * and provides a selection bar for cooldown progress display.
 */
export class BaseProvider
  extends ConditionalTrait<BaseProviderInfo>
  implements ITick, IRenderAnnotationsWhenSelected, ISelectionBar
{
  /** Whether fast build mode is enabled (from DeveloperMode).
   *
   * OpenRA 对照: BaseProvider.devMode.FastBuild
   *
   * NOTE: DeveloperMode is not yet migrated. Stubbed to false.
   * TODO-11.B.X: Integrate with DeveloperMode when migrated.
   */
  private readonly _fastBuild: boolean = false

  /** Whether ally build radius is enabled.
   *
   * OpenRA 对照: BaseProvider.allyBuildEnabled
   */
  private readonly _allyBuildEnabled: boolean

  /** Whether build radius display is enabled.
   *
   * OpenRA 对照: BaseProvider.buildRadiusEnabled
   */
  private readonly _buildRadiusEnabled: boolean

  /** Total cooldown ticks. */
  private _total: number

  /** Remaining cooldown ticks (counts down to 0).
   *
   * OpenRA 对照: BaseProvider.progress
   */
  private _progress: number

  /** Construct a BaseProvider trait.
   *
   * OpenRA 对照: BaseProvider(Actor self, BaseProviderInfo info)
   *
   * @param info — configuration for this trait
   * @param mapBuildRadius — optional MapBuildRadius from the world actor;
   *   if not provided, defaults are used from info
   */
  constructor(
    info: BaseProviderInfo,
    mapBuildRadius?: MapBuildRadius | null,
  ) {
    super(info)

    // Read build radius settings from MapBuildRadius (world trait)
    // or fall back to defaults
    if (mapBuildRadius) {
      this._allyBuildEnabled = mapBuildRadius.allyBuildRadiusEnabled
      this._buildRadiusEnabled = mapBuildRadius.buildRadiusEnabled
    } else {
      // OpenRA 对照: allyBuildEnabled = mapBuildRadius != null && ...
      //   When mapBuildRadius is null, both are set to false.
      this._allyBuildEnabled = false
      this._buildRadiusEnabled = false
    }

    // Initialize cooldown tracking
    this._progress = info.initialDelay
    this._total = info.initialDelay
  }

  // -----------------------------------------------------------------------
  // ITick
  // OpenRA 对照: ITick.Tick(Actor self)
  // -----------------------------------------------------------------------

  /** Tick the cooldown counter.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * @param _self — the actor this trait is attached to
   */
  tick(_self: IGameActor): void {
    if (this._progress > 0) {
      this._progress--
    }
  }

  // -----------------------------------------------------------------------
  // Cooldown management
  // -----------------------------------------------------------------------

  /** Start the cooldown timer.
   *
   * OpenRA 对照: BaseProvider.BeginCooldown()
   *
   * Called after a building is placed within this provider's radius.
   * Sets the cooldown to the configured value.
   */
  beginCooldown(): void {
    this._progress = this.info.cooldown
    this._total = this.info.cooldown
  }

  /** Check if the base provider is ready (can be used for placement).
   *
   * OpenRA 对照: BaseProvider.Ready()
   *
   * Ready when: not disabled, not paused, and either in fast-build mode
   * or cooldown has completed.
   *
   * @returns true if the base provider is operational
   */
  ready(): boolean {
    if (this.isTraitDisabled || this.isTraitPaused) {
      return false
    }

    return this._fastBuild || this._progress === 0
  }

  // -----------------------------------------------------------------------
  // Visual helpers
  // -----------------------------------------------------------------------

  /** Get the remaining cooldown progress.
   *
   * OpenRA 对照: BaseProvider.progress
   *
   * @returns current progress ticks remaining
   */
  get progress(): number {
    return this._progress
  }

  /** Get the total cooldown duration.
   *
   * OpenRA 对照: BaseProvider.total
   *
   * @returns total cooldown ticks
   */
  get total(): number {
    return this._total
  }

  // -----------------------------------------------------------------------
  // Render validation (private helper in OpenRA)
  // OpenRA 对照: BaseProvider.ValidRenderPlayer()
  // -----------------------------------------------------------------------

  /** Check whether this base provider should render for the current player.
   *
   * OpenRA 对照: BaseProvider.ValidRenderPlayer()
   *
   * Renders when build radius is enabled and either:
   * - The current render player is the owner, OR
   * - Ally build radius is enabled and the owner is allied with the render player.
   *
   * @param owner — the owner of this base provider
   * @param renderPlayer — the player currently viewing the world
   * @returns true if range circles should be shown
   */
  private _validRenderPlayer(
    owner: PlayerStub,
    renderPlayer: PlayerStub,
  ): boolean {
    if (!this._buildRadiusEnabled) {
      return false
    }

    if (owner === renderPlayer) {
      return true
    }

    if (this._allyBuildEnabled) {
      // Duck-typed check: renderPlayer has relationshipWith() from Player.ts Ch3
      const rp = renderPlayer as unknown as {
        relationshipWith?(other: unknown): PlayerRelationship
      }
      if (rp.relationshipWith) {
        const stance = rp.relationshipWith(owner)
        if (stance === PlayerRelationship.Ally) return true
      }
    }

    return false
  }


  // -----------------------------------------------------------------------
  // Range circle renderables
  // OpenRA 对照: BaseProvider.RangeCircleRenderables()
  // -----------------------------------------------------------------------

  /** Generate range circle renderables for visualization.
   *
   * OpenRA 对照: BaseProvider.RangeCircleRenderables()
   *
   * In OpenRA, this generates a RangeCircleAnnotationRenderable.
   * In 3D, this should generate a LinesMesh circle or TorusMesh at the
   * provider's world position.
   *
   * For now, returns an empty array. 3D circle rendering will be
   * implemented when the 3D annotation rendering pipeline is built out.
   *
* Implement 3D range circle using LinesMesh/TorusMesh
   *   at the provider's world position, colored by readiness state.
   *
   * @returns empty array (stub)
   */
  rangeCircleRenderables(): readonly IRenderable[] {
    if (this.isTraitDisabled) {
      return []
    }

    // NOTE: ValidRenderPlayer check requires renderPlayer which is not
    // available without the full WorldRenderer pipeline. For now,
    // always return empty (stub). Method kept for future 3D annotation use.
    // Wire _validRenderPlayer into actual visual range circles.
    void this._validRenderPlayer
    return []
  }

  // -----------------------------------------------------------------------
  // IRenderAnnotationsWhenSelected
  // OpenRA 对照: IRenderAnnotationsWhenSelected.RenderAnnotations()
  // -----------------------------------------------------------------------

  /** Render annotations when this actor is selected.
   *
   * OpenRA 对照: IRenderAnnotationsWhenSelected.RenderAnnotations()
   *
   * @param _actor — the selected actor
   * @param _wr — the world renderer
   * @returns range circle renderables (stub: empty array)
   */
  renderAnnotations(
    _actor: IGameActor,
    _wr: WorldRendererStub,
  ): readonly IRenderable[] {
    return this.rangeCircleRenderables()
  }

  /** Whether annotations are spatially partitionable.
   *
   * OpenRA 对照: IRenderAnnotationsWhenSelected.SpatiallyPartitionable → false
   */
  get spatiallyPartitionable(): boolean {
    return false
  }

  // -----------------------------------------------------------------------
  // ISelectionBar
  // OpenRA 对照: ISelectionBar.GetValue(), GetColor(), DisplayWhenEmpty
  // -----------------------------------------------------------------------

  /** Get the selection bar value (cooldown progress).
   *
   * OpenRA 对照: ISelectionBar.GetValue()
   *
   * Returns the fraction of remaining cooldown (0 = ready, 1 = full cooldown).
   * Returns 0 when: trait disabled, not renderable to player, fast build,
   * or zero cooldown.
   *
   * @returns progress fraction between 0 and 1
   */
  getValue(): number {
    if (this.isTraitDisabled) {
      return 0
    }

    // NOTE: ValidRenderPlayer check skipped here since we don't have
    // renderPlayer access in the ISelectionBar interface.
    // The cooldown bar is only shown when the unit is selected, which
    // means the owner is the render player.

    // Ready or delay disabled
    if (this._progress === 0 || this._total === 0 || this._fastBuild) {
      return 0
    }

    return this._progress / this._total
  }

  /** Get the selection bar color.
   *
   * OpenRA 对照: ISelectionBar.GetColor() → Color.Purple
   *
   * @returns purple color for the cooldown progress bar
   */
  getColor(): ColorStub {
    return { r: 128, g: 0, b: 128, a: 255 }
  }

  /** Whether to display the bar when empty.
   *
   * OpenRA 对照: ISelectionBar.DisplayWhenEmpty → false
   */
  get displayWhenEmpty(): boolean {
    return false
  }
}
