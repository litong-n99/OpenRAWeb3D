/**
 * WithSplitAttackPaletteInfantryBody.ts — 步兵攻击时使用独立调色板渲染叠加动画
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.cs (58 lines)
 *
 * 核心范式转换:
 * - C# WithInfantryBody (base class + virtual Attacking) → TS duck-typed base
 * - C# Animation.PlayThen → TS duck-typed animation playThen
 * - C# RenderSprites.Add / Remove → TS duck-typed renderSprites add/remove
 * - C# RenderSprites.MakeFacingFunc → TS duck-typed facing callback
 *
 * 当步兵攻击时，分离攻击部分使用独立的调色板（如枪口火焰的调色板），
 * 与主步兵身体的调色板不同。通过 PlayThen 自动在动画结束后隐藏叠加层。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal interface for Animation with the methods this trait needs.
 *
 * OpenRA 对照: Animation
 */
export interface ISplitAttackAnimation {
  readonly name: string
  readonly currentSequence: { readonly name: string }
  hasSequence(sequence: string): boolean
  playThen(sequence: string, onComplete: () => void): void
}

/** Minimal interface for AnimationWithOffset.
 *
 * OpenRA 对照: AnimationWithOffset
 */
export interface IAnimationWithOffset {
  // opaque handle
}

/** Minimal interface for RenderSprites.
 *
 * OpenRA 对照: RenderSprites
 */
export interface ISplitAttackRenderSprites {
  add(anim: IAnimationWithOffset, palette?: string | null, isPlayerPalette?: boolean): void
  remove?(anim: IAnimationWithOffset): void
  getImage(self: IGameActor): string
}

/** Minimal interface for Armament (duck-typed).
 *
 * OpenRA 对照: Armament
 */
export interface IArmamentAccess {
  readonly info: { readonly name: string }
}

/** Minimal interface for Barrel.
 *
 * OpenRA 对照: Barrel
 */
export interface IBarrelAccess {
  // opaque
}

/** Animation state enum matching InfantryBody.
 *
 * OpenRA 对照: AnimationState (from WithInfantryBody)
 */
export const InfantryAnimationState = {
  Idle: 0,
  Attacking: 1,
} as const
export type InfantryAnimationState = (typeof InfantryAnimationState)[keyof typeof InfantryAnimationState]

/** Minimal interface for WithInfantryBody base trait.
 *
 * OpenRA 对照: WithInfantryBody
 */
export interface ISplitAttackInfantryBody {
  readonly info: {
    readonly name: string
    readonly enabledByDefault: boolean
    readonly splitAttackPalette?: string | null
    readonly splitAttackSuffix?: string
  }
  readonly defaultAnimation: ISplitAttackAnimation
  // Called by WithInfantryBody when the actor attacks
  attacking(self: IGameActor, armament: IArmamentAccess, barrel: IBarrelAccess): void
  readonly isTraitDisabled: boolean
  readonly state: InfantryAnimationState
}

// ---------------------------------------------------------------------------
// WithSplitAttackPaletteInfantryBodyInfo
// OpenRA 对照: WithSplitAttackPaletteInfantryBodyInfo : WithInfantryBodyInfo
// ---------------------------------------------------------------------------

/** Configuration for WithSplitAttackPaletteInfantryBody.
 *
 * OpenRA 对照: WithSplitAttackPaletteInfantryBodyInfo
 */
export class WithSplitAttackPaletteInfantryBodyInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly enabledByDefault: boolean

  /** Palette to use for the split attack rendering.
   *
   * OpenRA 对照: WithSplitAttackPaletteInfantryBodyInfo.SplitAttackPalette
   */
  readonly splitAttackPalette: string | null

  /** Sequence suffix to use (default "muzzle").
   *
   * OpenRA 对照: WithSplitAttackPaletteInfantryBodyInfo.SplitAttackSuffix
   */
  readonly splitAttackSuffix: string

  constructor(params: {
    instanceName?: string
    enabledByDefault?: boolean
    splitAttackPalette?: string | null
    splitAttackSuffix?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.enabledByDefault = params.enabledByDefault ?? true
    this.splitAttackPalette = params.splitAttackPalette ?? null
    this.splitAttackSuffix = params.splitAttackSuffix ?? 'muzzle'
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithSplitAttackPaletteInfantryBodyInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithSplitAttackPaletteInfantryBody {
    return new WithSplitAttackPaletteInfantryBody(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithSplitAttackPaletteInfantryBody
// OpenRA 对照: WithSplitAttackPaletteInfantryBody : WithInfantryBody
// ---------------------------------------------------------------------------

/** Infantry body that renders attack overlay with a separate palette.
 *
 * OpenRA 对照: WithSplitAttackPaletteInfantryBody
 *
 * When the infantry attacks, a secondary animation (e.g., muzzle flash)
 * is rendered using a separate palette. The split animation plays once
 * and hides automatically when complete.
 */
export class WithSplitAttackPaletteInfantryBody {
  readonly info: WithSplitAttackPaletteInfantryBodyInfo
  private readonly _splitAnimation: ISplitAttackAnimation | null
  private readonly _renderSprites: ISplitAttackRenderSprites
  private readonly _body: ISplitAttackInfantryBody

  /** Whether the split animation is currently visible.
   *
   * OpenRA 对照: WithSplitAttackPaletteInfantryBody.visible
   */
  private _visible: boolean = false

  /** Holds the AnimationWithOffset registration token.
   *
   * OpenRA 对照: AnimationWithOffset (added to RenderSprites)
   */
  private _animWithOffset: IAnimationWithOffset | null = null

  constructor(self: IGameActor, info: WithSplitAttackPaletteInfantryBodyInfo) {
    this.info = info

    // Resolve RenderSprites and body
    this._renderSprites = (self as any).trait?.('RenderSprites') as ISplitAttackRenderSprites ?? null as any
    this._body = (self as any) as ISplitAttackInfantryBody

    // Create the split animation — following the C# pattern:
    // splitAnimation = new Animation(init.World, rs.GetImage(init.Self), RenderSprites.MakeFacingFunc(init.Self));
    const image = this._renderSprites?.getImage?.(self) ?? ''
    this._splitAnimation = image ? {
      name: image,
      currentSequence: { name: '' },
      hasSequence(_seq: string): boolean {
        // Duck-typed: assume sequence exists
        return true
      },
      playThen(_seq: string, onComplete: () => void): void {
        // Duck-typed: track playback
        void _seq
        // Real animation timing should use the sequence's
        // Tick * Length to determine duration. setTimeout(100) is a
        // placeholder that does not match OpenRA's tick-synced (40ms/tick)
        // animation system. Full implementation requires the Animation
        // class with tick-based callback dispatch.
        setTimeout(onComplete, 100) // Simulate animation completion
      },
    } : null

    // Register with RenderSprites (matching C#):
    // rs.Add(new AnimationWithOffset(splitAnimation, null, () => IsTraitDisabled || !visible), info.SplitAttackPalette);
    // The visibility function returns true (hidden) when disabled or invisible.
    const animWithOffset = {
      // Duck-typed wrapper
      _visibleFn: () => this._body.isTraitDisabled || !this._visible,
    } as IAnimationWithOffset
    this._animWithOffset = animWithOffset

    if (this._renderSprites?.add) {
      this._renderSprites.add(animWithOffset, info.splitAttackPalette)
    }
  }

  // -------------------------------------------------------------------------
  // Attacking (override of WithInfantryBody.Attacking)
  // 对照: WithSplitAttackPaletteInfantryBody.Attacking(Actor, Armament, Barrel)
  // -------------------------------------------------------------------------

  /** Called when the infantry begins attacking.
   *
   * OpenRA 对照: WithSplitAttackPaletteInfantryBody.Attacking(Actor, Armament, Barrel)
   *
   * Plays the split attack sequence with the configured suffix
   * (e.g., "idle-muzzle") and hides the overlay when the sequence completes.
   *
   * @param _self — the actor
   * @param _armament — the armament firing
   * @param _barrel — the barrel being used
   */
  attacking(_self: IGameActor, _armament: IArmamentAccess, _barrel: IBarrelAccess): void {
    if (!this._splitAnimation) return

    const state = this._body.state
    const defaultSeq = this._body.defaultAnimation.currentSequence.name
    const sequence = defaultSeq + '-' + this.info.splitAttackSuffix

    if (
      state === InfantryAnimationState.Attacking &&
      this._splitAnimation.hasSequence(sequence)
    ) {
      this._visible = true
      this._splitAnimation.playThen(sequence, () => {
        this._visible = false
      })
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether the split animation overlay is currently visible.
   *
   * OpenRA 对照: WithSplitAttackPaletteInfantryBody.visible
   */
  get visible(): boolean {
    return this._visible
  }

  /** Set visibility (for testing).
   */
  setVisible(value: boolean): void {
    this._visible = value
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this._renderSprites?.remove && this._animWithOffset) {
      this._renderSprites.remove(this._animWithOffset)
    }
  }
}
