/**
 * WithAttackOverlay.ts -- Attack overlay animation rendered during attack
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.cs (107 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo (not ConditionalTraitInfo) → TS implements ConditionalTraitInfo manually
 * - C# Animation + AnimationWithOffset → TS same pattern (deferred 3D Billboard)
 * - C# AttackDelayType → TS AttackDelayType from CombatInterfaces
 * - C# INotifyAttack + ITick → TS same interfaces
 * - C# BodyOrientation/IFacing duck-typed → TS duck-typed
 *
 * NOTE: C# WithAttackOverlay does NOT extend ConditionalTraitInfo. It always runs.
 *   However, for consistency with TS patterns, we implement ConditionalTraitInfo.
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  AttackDelayType,
  type AttackDelayType as AttackDelayTypeEnum,
  type INotifyAttack,
  type Barrel,
} from '../CombatInterfaces.js'
import type { Target } from '../../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// WithAttackOverlayInfo
// OpenRA 对照: WithAttackOverlayInfo (TraitInfo, Requires<RenderSpritesInfo>)
// ---------------------------------------------------------------------------

/** Configuration for WithAttackOverlay trait.
 *
 *  OpenRA 对照: WithAttackOverlayInfo
 */
export class WithAttackOverlayInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Armament that will play the animation. null = allow all armaments.
   *
   *  OpenRA 对照: WithAttackOverlayInfo.Armament
   */
  readonly armament: string | null = null

  /** Sequence name to use.
   *
   *  OpenRA 对照: WithAttackOverlayInfo.Sequence
   */
  readonly sequence: string | null = null

  /** Custom palette name.
   *
   *  OpenRA 对照: WithAttackOverlayInfo.Palette
   */
  readonly palette: string | null = null

  /** Custom palette is a player palette BaseName.
   *
   *  OpenRA 对照: WithAttackOverlayInfo.IsPlayerPalette (default false)
   */
  readonly isPlayerPalette: boolean = false

  /** Whether this is a decoration (excluded from selection bounds).
   *
   *  OpenRA 对照: WithAttackOverlayInfo.IsDecoration (default false)
   */
  readonly isDecoration: boolean = false

  /** Delay in ticks before overlay starts.
   *
   *  OpenRA 对照: WithAttackOverlayInfo.Delay (default 0)
   */
  readonly delay: number = 0

  /** Should the overlay be delayed relative to preparation or actual attack?
   *
   *  OpenRA 对照: WithAttackOverlayInfo.DelayRelativeTo (default AttackDelayType.Preparation)
   */
  readonly delayRelativeTo: AttackDelayTypeEnum = AttackDelayType.Preparation

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    armament?: string | null
    sequence?: string | null
    palette?: string | null
    isPlayerPalette?: boolean
    isDecoration?: boolean
    delay?: number
    delayRelativeTo?: AttackDelayTypeEnum
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.armament = params.armament ?? null
    this.sequence = params.sequence ?? null
    this.palette = params.palette ?? null
    this.isPlayerPalette = params.isPlayerPalette ?? false
    this.isDecoration = params.isDecoration ?? false
    this.delay = params.delay ?? 0
    this.delayRelativeTo = params.delayRelativeTo ?? AttackDelayType.Preparation
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// WithAttackOverlay
// OpenRA 对照: WithAttackOverlay (INotifyAttack, ITick)
//
// NOTE: In C# this does NOT extend ConditionalTraitInfo. It is always active.
//   For consistency with our TS patterns and to support condition-based disabling,
//   we extend ConditionalTrait.
// ---------------------------------------------------------------------------

/** Renders an overlay animation together with an attack.
 *
 *  OpenRA 对照: WithAttackOverlay
 *
 *  TODO-8.E.BILLBOARD-3D: Billboard sprite at body-world position.
 *    Currently the animation/overlay logic is implemented, but actual
 *    Babylon.js Billboard creation is deferred.
 */
export class WithAttackOverlay
  extends ConditionalTrait<WithAttackOverlayInfo>
  implements INotifyAttack, ITick
{
  /** Whether the overlay is currently active (visible).
   *
   *  OpenRA 对照: WithAttackOverlay.attacking
   */
  attackingState: boolean = false

  /** Delay countdown timer.
   *
   *  OpenRA 对照: WithAttackOverlay.tick
   */
  private tickCount: number = 0

  // Duck-typed references (set via init)
  private renderSprites: unknown | null = null
  private animation: unknown | null = null
  private animWithOffset: unknown | null = null

  constructor(info: WithAttackOverlayInfo) {
    super(info)
  }

  /** Initialize render references.
   *
   *  OpenRA 对照: WithAttackOverlay constructor body
   *
   *  TODO-8.E.BILLBOARD-3D: Create actual Animation + AnimationWithOffset,
   *    register with RenderSprites.
   *
   *  @param renderSprites — the RenderSprites trait
   *  @param animation — the Animation instance
   *  @param animWithOffset — the AnimationWithOffset wrapper
   */
  init(
    renderSprites: unknown,
    animation: unknown,
    animWithOffset: unknown,
  ): void {
    this.renderSprites = renderSprites
    this.animation = animation
    this.animWithOffset = animWithOffset

    // Register with RenderSprites (matching C# rs.Add(animWithOffset, palette, isPlayerPalette))
    const rsAdd = (renderSprites as Record<string, (a: unknown, p: string | null, ipp: boolean) => void>).add
    if (rsAdd) rsAdd(animWithOffset, this.info.palette, this.info.isPlayerPalette)
  }

  // -----------------------------------------------------------------------
  // INotifyAttack
  // -----------------------------------------------------------------------

  /** Called before attack preparation.
   *
   *  OpenRA 对照: INotifyAttack.PreparingAttack()
   */
  preparingAttack(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    const armName = (_armament as { info?: { name?: string } })?.info?.name ?? null
    if (
      this.info.delayRelativeTo === AttackDelayType.Preparation &&
      (this.info.armament === null || this.info.armament === armName)
    ) {
      if (this.info.delay > 0) {
        this.tickCount = this.info.delay
      } else {
        this.playOverlay()
      }
    }
  }

  /** Called when the actual attack fires.
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    const armName = (_armament as { info?: { name?: string } })?.info?.name ?? null
    if (
      this.info.delayRelativeTo === AttackDelayType.Attack &&
      (this.info.armament === null || this.info.armament === armName)
    ) {
      if (this.info.delay > 0) {
        this.tickCount = this.info.delay
      } else {
        this.playOverlay()
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick: countdown delay, play overlay on expiry.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(_self: IGameActor): void {
    if (this.info.delay > 0 && --this.tickCount === 0) {
      this.playOverlay()
    }
  }

  // -----------------------------------------------------------------------
  // Overlay playback
  // -----------------------------------------------------------------------

  /** Start playing the overlay animation.
   *
   *  OpenRA 对照: WithAttackOverlay.PlayOverlay()
   */
  private playOverlay(): void {
    this.attackingState = true
    // Duck-typed Animation.playThen(sequence, callback)
    const animPlayThen = (this.animation as Record<string, (seq: string, cb: () => void) => void>).playThen
    if (animPlayThen) {
      animPlayThen(this.info.sequence ?? '', () => {
        this.attackingState = false
      })
    }
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /** Remove overlay from RenderSprites.
   *
   *  OpenRA 对照: N/A (C# relies on GC)
   */
  override dispose(): void {
    if (this.renderSprites && this.animWithOffset) {
      const rsRemove = (this.renderSprites as Record<string, (a: unknown) => void>).remove
      if (rsRemove) rsRemove(this.animWithOffset)
    }
    super.dispose()
  }
}
