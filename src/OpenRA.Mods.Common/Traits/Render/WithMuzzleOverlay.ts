/**
 * WithMuzzleOverlay.ts -- Muzzle flash rendering for weapon barrels
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.cs (118 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<Info>, INotifyAttack, IRender, ITick → TS ConditionalTrait<Info>
 * - C# AnimationWithOffset per barrel → TS duck-typed AnimationWithOffset
 * - C# RenderUtils.ZOffsetFromCenter → TS inline calculation
 * - C# Turreted.WorldOrientation.Yaw → TS duck-typed turreted
 * - C# Armament.MuzzleOffset() → TS duck-typed armament.muzzleOffset
 *
 * TODO-8.E.BILLBOARD-3D: Billboard sprite at weapon hardpoint world position.
 *   Currently the state management and animation logic is implemented,
 *   but actual Babylon.js Billboard creation is deferred.
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type INotifyAttack,
  type Barrel,
} from '../CombatInterfaces.js'
import type { Target } from '../../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// WithMuzzleOverlayInfo
// OpenRA 对照: WithMuzzleOverlayInfo (ConditionalTraitInfo, Requires<RenderSpritesInfo>, Requires<AttackBaseInfo>, Requires<ArmamentInfo>)
// ---------------------------------------------------------------------------

/** Configuration for WithMuzzleOverlay trait.
 *
 *  OpenRA 对照: WithMuzzleOverlayInfo
 */
export class WithMuzzleOverlayInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Ignore the weapon position, and always draw relative to the center of the actor.
   *
   *  OpenRA 对照: WithMuzzleOverlayInfo.IgnoreOffset (default false)
   */
  readonly ignoreOffset: boolean = false

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    ignoreOffset?: boolean
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.ignoreOffset = params.ignoreOffset ?? false
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// BarrelEntry — per-barrel state
// OpenRA 对照: visible/anim dictionaries in WithMuzzleOverlay
// ---------------------------------------------------------------------------

/** Per-barrel muzzle flash state.
 *
 *  OpenRA 对照: Dictionary<Barrel, bool> visible + Dictionary<Barrel, AnimationWithOffset> anims
 */
export interface BarrelEntry {
  barrel: Barrel
  visible: boolean
  animation: unknown // AnimationWithOffset
  getFacing: () => number // WAngle.angle
}

// ---------------------------------------------------------------------------
// WithMuzzleOverlay
// OpenRA 对照: WithMuzzleOverlay (ConditionalTrait<Info>, INotifyAttack, IRender, ITick)
// ---------------------------------------------------------------------------

/** Renders the MuzzleSequence from the Armament trait as a muzzle flash.
 *
 *  OpenRA 对照: WithMuzzleOverlay
 *
 *  TODO-8.E.BILLBOARD-3D: Billboard sprite at muzzle world position.
 */
export class WithMuzzleOverlay
  extends ConditionalTrait<WithMuzzleOverlayInfo>
  implements INotifyAttack, ITick
{
  /** Per-barrel muzzle flash entries.
   *
   *  OpenRA 对照: Dictionary<Barrel, bool> visible + Dictionary<Barrel, AnimationWithOffset> anims
   */
  readonly barrels: BarrelEntry[] = []

  /** Armaments with non-null MuzzleSequence.
   *
   *  OpenRA 对照: WithMuzzleOverlay.armaments
   */
  readonly armaments: unknown[] = []

  constructor(info: WithMuzzleOverlayInfo) {
    super(info)
  }

  /** Initialize barrel entries from armaments.
   *
   *  OpenRA 对照: WithMuzzleOverlay constructor body
   *
   *  @param armaments — armaments with MuzzleSequence
   *  @param turreteds — available Turreted traits
   *  @param facing — IFacing trait (or null)
   *  @param _renderSprites — RenderSprites trait (used in TODO-8.E.BILLBOARD-3D)
   */
  init(
    armaments: unknown[],
    turreteds: unknown[],
    facing: IFacing | null,
    _renderSprites: unknown,
  ): void {
    // Store armaments that have MuzzleSequence
    for (const arm of armaments) {
      const armInfo = (arm as { info?: { muzzleSequence?: string | null; turret?: string } }).info
      if (armInfo?.muzzleSequence) {
        this.armaments.push(arm)
      }
    }

    // Build barrel entries
    for (const arm of armaments) {
      const armInfo = (arm as { info?: { muzzleSequence?: string | null; turret?: string; muzzlePalette?: string } }).info
      if (!armInfo?.muzzleSequence) continue

      const turretName = armInfo.turret ?? 'primary'
      const armBarrels = (arm as { barrels?: Barrel[] }).barrels ?? []

      for (const barrel of armBarrels) {
        // Find matching Turreted
        let getFacing: () => number = () => 0
        const turreted = turreteds.find(
          (t) => (t as { name?: string }).name === turretName,
        )
        if (turreted) {
          const t = turreted as { worldOrientation?: { yaw: { angle: number } } }
          getFacing = () => t.worldOrientation?.yaw.angle ?? 0
        } else if (facing) {
          getFacing = () => facing.facing.angle
        }

        // Build muzzle animation entry
        const entry: BarrelEntry = {
          barrel,
          visible: false,
          animation: null, // TODO-8.E.BILLBOARD-3D: Create Animation + AnimationWithOffset
          getFacing,
        }
        this.barrels.push(entry)
      }
    }
  }

  // -----------------------------------------------------------------------
  // INotifyAttack
  // -----------------------------------------------------------------------

  /** Called before attack preparation (no-op for muzzle flash).
   *
   *  OpenRA 对照: INotifyAttack.PreparingAttack() — empty
   */
  preparingAttack(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    // No-op
  }

  /** Called when the actual attack fires: show muzzle flash.
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    _self: IGameActor,
    _target: Target,
    a: unknown,
    barrel: Barrel,
  ): void {
    if (a === null || barrel === null || !this.armaments.includes(a)) return

    const entry = this.barrels.find((e) => e.barrel === barrel)
    if (!entry) return

    const armInfo = (a as { info?: { muzzleSequence?: string } }).info
    const sequence = armInfo?.muzzleSequence
    if (!sequence) return

    entry.visible = true

    // Duck-typed Animation.playThen(sequence, callback)
    if (entry.animation) {
      const animWithOffset = entry.animation as Record<string, Record<string, (seq: string, cb: () => void) => void>>
      const innerAnim = animWithOffset.animation
      if (innerAnim?.playThen) {
        innerAnim.playThen(sequence, () => {
          entry.visible = false
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick: update all muzzle flash animations.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(_self: IGameActor): void {
    for (const entry of this.barrels) {
      if (entry.animation) {
        const animWithOffset = entry.animation as Record<string, Record<string, () => void>>
        const innerAnim = animWithOffset.animation
        if (innerAnim?.tick) {
          innerAnim.tick()
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  /** Check if a specific barrel's muzzle flash is currently visible.
   *
   *  OpenRA 对照: WithMuzzleOverlay.visible[barrel]
   */
  isBarrelVisible(barrel: Barrel): boolean {
    return this.barrels.find((e) => e.barrel === barrel)?.visible ?? false
  }

  /** Get the animation entry for a specific barrel.
   *
   *  OpenRA 对照: WithMuzzleOverlay.anims[barrel]
   */
  getBarrelAnimation(barrel: Barrel): unknown | null {
    return this.barrels.find((e) => e.barrel === barrel)?.animation ?? null
  }
}
