/**
 * WithVoxelBarrel.ts — Voxel barrel rendering trait (barrel limb, child of turret)
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithVoxelBarrel.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<WithVoxelBarrelInfo> pattern → TypeScript conditional
 *   trait that attaches barrel ModelAnimation to RenderVoxels (ADR-19.1)
 * - C# Armament + Turreted → TypeScript interfaces for recoil + turret offset
 * - C# BodyOrientation.LocalToWorld for barrel offset chain →
 *   TypeScript closure computing the full transform chain
 * - C# barrel recoil applied to local offset → recoil value subtracted from X
 *
 * ADR-19.1:
 * - The barrel is a child TransformNode of the turret in the hierarchy.
 * - Barrel offset chain: body.LocalToWorld(turret.Offset + barrel.LocalOffset)
 * - Barrel rotation: barrel.LocalOrientation.Rotate(turret.WorldOrientation)
 * - During firing, recoil is subtracted from the barrel's forward (X) axis.
 */

import { ModelAnimation } from '../../../OpenRA.Game/Graphics/ModelAnimation'
import { WRot } from '../../../OpenRA.Game/WRot'
import { WVec } from '../../../OpenRA.Game/WVec'
import type { IModelCache } from '../../../OpenRA.Game/Graphics/Model'
import { RenderVoxels } from './RenderVoxels'
import type { ITurreted } from './WithVoxelTurret'

// ---------------------------------------------------------------------------
// WithVoxelBarrelInfo
// ---------------------------------------------------------------------------

/** Configuration info for the WithVoxelBarrel trait.
 *
 * OpenRA 对照: WithVoxelBarrelInfo : ConditionalTraitInfo,
 *   IRenderActorPreviewVoxelsInfo, Requires<RenderVoxelsInfo>,
 *   Requires<ArmamentInfo>, Requires<TurretedInfo>
 */
export interface WithVoxelBarrelInfo {
  /** Sequence name to use (default: "barrel").
   *
   * OpenRA 对照: WithVoxelBarrelInfo.Sequence
   */
  readonly sequence: string

  /** Armament name for recoil (default: "primary").
   *
   * OpenRA 对照: WithVoxelBarrelInfo.Armament
   */
  readonly armament: string

  /** Visual offset relative to turret.
   *
   * OpenRA 对照: WithVoxelBarrelInfo.LocalOffset
   */
  readonly localOffset: WVec

  /** Local rotation relative to turret.
   *
   * OpenRA 对照: WithVoxelBarrelInfo.LocalOrientation
   */
  readonly localOrientation: WRot

  /** Whether the barrel casts a shadow.
   *
   * OpenRA 对照: WithVoxelBarrelInfo.ShowShadow
   */
  readonly showShadow: boolean
}

// ---------------------------------------------------------------------------
// IArmament — minimal interface for armament recoil
// ---------------------------------------------------------------------------

/** Interface for an Armament trait providing recoil and turret association.
 *
 * OpenRA 对照: Armament class (trait)
 */
export interface IArmament {
  /** Armament name.
   */
  readonly name: string

  /** Current recoil value (decreases over time after firing).
   */
  readonly recoil: number

  /** Associated turret name.
   */
  readonly turretName: string
}

// ---------------------------------------------------------------------------
// WithVoxelBarrel
// ---------------------------------------------------------------------------

/** Actor trait that attaches a voxel barrel model.
 *
 * OpenRA 对照: WithVoxelBarrel class (ConditionalTrait<WithVoxelBarrelInfo>)
 *
 * The barrel is a child of the turret in the hierarchy. It handles:
 * 1. Loading the barrel model from the ModelCache
 * 2. Creating the barrel ModelAnimation with full transform chain
 * 3. Applying recoil to the barrel's forward offset
 * 4. Registering with RenderVoxels
 */
export class WithVoxelBarrel {
  /** Trait configuration.
   */
  readonly info: WithVoxelBarrelInfo

  /** The barrel ModelAnimation registered with RenderVoxels.
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
   * @param armament — the Armament trait providing recoil and turret association
   * @param turreted — the Turreted trait providing position + orientation
   * @param bodyOrientationFunc — function returning the quantized body WRot
   */
  constructor(
    info: WithVoxelBarrelInfo,
    renderVoxels: RenderVoxels,
    modelCache: IModelCache,
    armament: IArmament,
    turreted: ITurreted,
    bodyOrientationFunc: () => WRot,
  ) {
    this.info = info
    this.renderVoxels = renderVoxels

    const model = modelCache.getModelSequence(renderVoxels.image, info.sequence)

    // Barrel offset closure: mirrors C# BarrelOffset()
    const barrelOffset = (): WVec => {
      // Step 1: Local offset including recoil
      // localOffset = Info.LocalOffset + new WVec(-armament.Recoil, WDist.Zero, WDist.Zero)
      const adjLocal = WVec.add(
        info.localOffset,
        new WVec(-armament.recoil, 0, 0),
      )

      // Step 2: Rotate by turret world orientation and add turret offset (rotated by body)
      const bodyOri = bodyOrientationFunc()
      const adjRotated = adjLocal.rotate(turreted.worldOrientation())
      const turretOffsetRotated = turreted.position().rotate(bodyOri)
      const combined = WVec.add(adjRotated, turretOffsetRotated)

      // Step 3: Convert from body-local to world coordinates
      // body.LocalToWorld(combined) → apply body orientation rotation
      return combined.rotate(bodyOri)
    }

    // Barrel rotation closure: mirrors C# BarrelRotation()
    const barrelRotation = (): WRot => {
      return info.localOrientation.rotate(turreted.worldOrientation())
    }

    this.modelAnimation = new ModelAnimation(
      model,
      barrelOffset,
      barrelRotation,
      () => this._disabled,
      () => 0, // frame 0 for barrel
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
   * OpenRA 对照: WithVoxelBarrelInfo.RenderPreviewVoxels
   *
   * @param modelCache — the world's model cache
   * @param image — model image name
   * @param sequence — sequence name
   * @param barrelOffsetFunc — barrel world offset
   * @param barrelOrientationFunc — barrel world rotation
   * @param showShadow — whether to show shadow in preview
   */
  static renderPreview(
    modelCache: IModelCache,
    image: string,
    sequence: string,
    barrelOffsetFunc: () => WVec,
    barrelOrientationFunc: () => WRot,
    showShadow: boolean,
  ): ModelAnimation[] {
    const model = modelCache.getModelSequence(image, sequence)
    return [
      new ModelAnimation(
        model,
        barrelOffsetFunc,
        barrelOrientationFunc,
        null, // always visible in preview
        () => 0,
        showShadow,
      ),
    ]
  }
}
