/**
 * WithVoxelTurret.ts — Voxel turret rendering trait (turret limb)
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithVoxelTurret.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<WithVoxelTurretInfo> pattern → TypeScript conditional
 *   trait that attaches turret ModelAnimation to RenderVoxels (ADR-19.1)
 * - C# Turreted trait → TypeScript Turreted interface for position/orientation
 * - C# turret offset + rotation callbacks → closure capturing Turreted instance
 *
 * ADR-19.1:
 * - The turret is a child TransformNode of the body in the hierarchy.
 * - Turret rotation is driven by Turreted.WorldOrientation (WRot).
 * - Turret position offset is from Turreted.Position (WVec).
 * - The turret ModelAnimation is created at construction and registered with
 *   RenderVoxels via add().
 */

import { ModelAnimation } from '../../../OpenRA.Game/Graphics/ModelAnimation'
import { WRot } from '../../../OpenRA.Game/WRot'
import { WVec } from '../../../OpenRA.Game/WVec'
import type { IModelCache } from '../../../OpenRA.Game/Graphics/Model'
import { RenderVoxels } from './RenderVoxels'

// ---------------------------------------------------------------------------
// WithVoxelTurretInfo
// ---------------------------------------------------------------------------

/** Configuration info for the WithVoxelTurret trait.
 *
 * OpenRA 对照: WithVoxelTurretInfo : ConditionalTraitInfo, IRenderActorPreviewVoxelsInfo,
 *   Requires<RenderVoxelsInfo>, Requires<TurretedInfo>
 */
export interface WithVoxelTurretInfo {
  /** Sequence name to use (default: "turret").
   *
   * OpenRA 对照: WithVoxelTurretInfo.Sequence
   */
  readonly sequence: string

  /** Turret key to attach to (default: "primary").
   *
   * OpenRA 对照: WithVoxelTurretInfo.Turret
   */
  readonly turret: string

  /** Whether the turret casts a shadow.
   *
   * OpenRA 对照: WithVoxelTurretInfo.ShowShadow
   */
  readonly showShadow: boolean
}

// ---------------------------------------------------------------------------
// Turreted — minimal interface for turret position/orientation
// ---------------------------------------------------------------------------

/** Interface for a turret trait providing position and orientation.
 *
 * OpenRA 对照: Turreted class (trait)
 */
export interface ITurreted {
  /** Turret name.
   */
  readonly name: string

  /** Turret offset from actor center in body-local coordinates.
   */
  position(): WVec

  /** Turret world orientation (combined body + turret rotation).
   */
  worldOrientation(): WRot
}

// ---------------------------------------------------------------------------
// WithVoxelTurret
// ---------------------------------------------------------------------------

/** Actor trait that attaches a voxel turret model.
 *
 * OpenRA 对照: WithVoxelTurret class (ConditionalTrait<WithVoxelTurretInfo>)
 *
 * The turret is a child of the body in the hierarchy. It handles:
 * 1. Loading the turret model from the ModelCache
 * 2. Creating the turret ModelAnimation with Turreted-driven rotation
 * 3. Registering with RenderVoxels
 */
export class WithVoxelTurret {
  /** Trait configuration.
   */
  readonly info: WithVoxelTurretInfo

  /** The turret ModelAnimation registered with RenderVoxels.
   */
  readonly modelAnimation: ModelAnimation

  /** Reference to the parent RenderVoxels trait.
   */
  readonly renderVoxels: RenderVoxels

  /** Whether this trait is currently disabled by a condition.
   */
  private _disabled = false

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param info — trait configuration
   * @param renderVoxels — the actor's RenderVoxels trait
   * @param modelCache — the world's model cache
   * @param turreted — the Turreted trait providing position + orientation
   */
  constructor(
    info: WithVoxelTurretInfo,
    renderVoxels: RenderVoxels,
    modelCache: IModelCache,
    turreted: ITurreted,
  ) {
    this.info = info
    this.renderVoxels = renderVoxels

    const model = modelCache.getModelSequence(renderVoxels.image, info.sequence)

    this.modelAnimation = new ModelAnimation(
      model,
      () => turreted.position(),
      () => turreted.worldOrientation(),
      () => this._disabled,
      () => 0, // frame 0 for turret
      info.showShadow,
    )

    renderVoxels.add(this.modelAnimation)
  }

  // -----------------------------------------------------------------------
  // Condition control
  // -----------------------------------------------------------------------

  /** Enable or disable this trait by condition.
   */
  set disabled(value: boolean) {
    this._disabled = value
  }

  /** Whether the trait is disabled.
   */
  get disabled(): boolean {
    return this._disabled
  }

  // -----------------------------------------------------------------------
  // Preview helper (static)
  // -----------------------------------------------------------------------

  /** Generate preview model animations for the build queue / sidebar.
   *
   * OpenRA 对照: WithVoxelTurretInfo.RenderPreviewVoxels
   *
   * @param modelCache — the world's model cache
   * @param image — model image name
   * @param sequence — sequence name
   * @param turretOffset — turret offset
   * @param turretOrientationFunc — function returning preview turret rotation
   * @param showShadow — whether to show shadow in preview
   */
  static renderPreview(
    modelCache: IModelCache,
    image: string,
    sequence: string,
    turretOffset: () => WVec,
    turretOrientationFunc: () => WRot,
    showShadow: boolean,
  ): ModelAnimation[] {
    const model = modelCache.getModelSequence(image, sequence)
    return [
      new ModelAnimation(
        model,
        turretOffset,
        turretOrientationFunc,
        null, // always visible in preview
        () => 0,
        showShadow,
      ),
    ]
  }
}
