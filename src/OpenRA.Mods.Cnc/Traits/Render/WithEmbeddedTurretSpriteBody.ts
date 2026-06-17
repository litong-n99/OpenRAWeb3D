/**
 * WithEmbeddedTurretSpriteBody.ts — 炮塔朝向直接嵌入精灵的渲染（非分离炮塔）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithEmbeddedTurretSpriteBody.cs (78 lines)
 *
 * 核心范式转换:
 * - C# WithSpriteBody (base class, facing func passed to constructor) → TS duck-typed base
 * - C# Turreted (first turret, QuantizedFacings) → TS duck-typed Turreted
 * - C# Func<WAngle> makeTurretFacingFunc → TS closure pattern
 * - C# override DamageStateChanged / TraitEnabled → TS override methods
 *
 * 与原版 C&C 不同, WithEmbeddedTurretSpriteBody 将炮塔角度直接编码进精灵帧,
 * 而不是通过旋转 TransformNode 实现。这适用于炮塔艺术已预先渲染到精灵中的情况。
 * 只取第一个 Turreted trait 的朝向作为精灵帧索引。
 */

import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal Animation interface.
 *
 * OpenRA 对照: Animation
 */
export interface IEmbeddedAnimation {
  readonly name: string
  readonly currentSequence: {
    readonly name: string
    readonly facings: number
  }
  playFetchIndex(sequence: string, indexFn: () => number): void
  playRepeating(sequence: string): void
}

/** Minimal Turreted trait interface.
 *
 * OpenRA 对照: Turreted
 */
export interface IEmbeddedTurreted {
  readonly worldOrientation: { readonly yaw: WAngle }
  quantizedFacings: number
}

/** Minimal WithSpriteBody base trait.
 *
 * OpenRA 对照: WithSpriteBody
 */
export interface IEmbeddedSpriteBody {
  readonly info: { readonly name: string; readonly enabledByDefault: boolean }
  readonly defaultAnimation: IEmbeddedAnimation
}

// ---------------------------------------------------------------------------
// WithEmbeddedTurretSpriteBodyInfo
// OpenRA 对照: WithEmbeddedTurretSpriteBodyInfo : WithSpriteBodyInfo, Requires<TurretedInfo>, Requires<BodyOrientationInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithEmbeddedTurretSpriteBody.
 *
 * OpenRA 对照: WithEmbeddedTurretSpriteBodyInfo
 */
export class WithEmbeddedTurretSpriteBodyInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly enabledByDefault: boolean

  /** Number of facings for gameplay calculations.
   * -1 indicates auto-detection from the sequence.
   *
   * OpenRA 对照: WithEmbeddedTurretSpriteBodyInfo.QuantizedFacings
   */
  readonly quantizedFacings: number

  /** Sequence name (default "idle").
   *
   * OpenRA 对照: WithSpriteBodyInfo.Sequence
   */
  readonly sequence: string

  constructor(params: {
    instanceName?: string
    enabledByDefault?: boolean
    quantizedFacings?: number
    sequence?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.enabledByDefault = params.enabledByDefault ?? true
    this.quantizedFacings = params.quantizedFacings ?? -1
    this.sequence = params.sequence ?? 'idle'
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithEmbeddedTurretSpriteBodyInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithEmbeddedTurretSpriteBody {
    return new WithEmbeddedTurretSpriteBody(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithEmbeddedTurretSpriteBody
// OpenRA 对照: WithEmbeddedTurretSpriteBody : WithSpriteBody
// ---------------------------------------------------------------------------

/** Sprite body where turret facing is baked into the sprite frames.
 *
 * OpenRA 对照: WithEmbeddedTurretSpriteBody
 *
 * Instead of rendering a separate turret mesh, this trait selects
 * the sprite frame based on the first Turreted trait's world yaw.
 * Auto-detects facings from the current animation sequence.
 */
export class WithEmbeddedTurretSpriteBody {
  readonly info: WithEmbeddedTurretSpriteBodyInfo
  private readonly _turreted: IEmbeddedTurreted
  private readonly _body: IEmbeddedSpriteBody

  constructor(self: IGameActor, info: WithEmbeddedTurretSpriteBodyInfo) {
    this.info = info

    // C#: turreted = init.Self.TraitsImplementing<Turreted>().First();
    const turrets = (self as any).traitsImplementing?.('Turreted') as IEmbeddedTurreted[] | undefined
    const firstTurret = turrets?.[0]
    if (!firstTurret) {
      throw new Error(
        'WithEmbeddedTurretSpriteBody requires at least one Turreted trait',
      )
    }
    this._turreted = firstTurret
    this._body = (self as any) as IEmbeddedSpriteBody
  }

  // -------------------------------------------------------------------------
  // MakeTurretFacingFunc (C# static method)
  // 对照: static Func<WAngle> MakeTurretFacingFunc(Actor self)
  // -------------------------------------------------------------------------

  /** Create a function that returns the first turret's yaw.
   *
   * OpenRA 对照: WithEmbeddedTurretSpriteBody.MakeTurretFacingFunc(Actor)
   */
  makeTurretFacingFunc(): () => WAngle {
    return () => this._turreted.worldOrientation.yaw
  }

  // -------------------------------------------------------------------------
  // TraitEnabled (overrides base)
  // 对照: TraitEnabled(Actor self)
  // -------------------------------------------------------------------------

  /** Update quantized facings when trait is enabled.
   *
   * OpenRA 对照: WithEmbeddedTurretSpriteBody.TraitEnabled(Actor)
   */
  traitEnabled(_self: IGameActor): void {
    if (this.info.quantizedFacings >= 0) {
      this._turreted.quantizedFacings = this.info.quantizedFacings
    } else {
      this._turreted.quantizedFacings =
        this._body.defaultAnimation.currentSequence.facings
    }
  }

  // -------------------------------------------------------------------------
  // DamageStateChanged (overrides base)
  // 对照: DamageStateChanged(Actor self)
  // -------------------------------------------------------------------------

  /** Update quantized facings when damage state changes.
   *
   * OpenRA 对照: WithEmbeddedTurretSpriteBody.DamageStateChanged(Actor)
   */
  damageStateChanged(_self: IGameActor): void {
    if (this.info.quantizedFacings >= 0) {
      this._turreted.quantizedFacings = this.info.quantizedFacings
    } else {
      this._turreted.quantizedFacings =
        this._body.defaultAnimation.currentSequence.facings
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The turreted trait being driven. */
  get turreted(): IEmbeddedTurreted {
    return this._turreted
  }

  /** The sprite body for frame access. */
  get body(): IEmbeddedSpriteBody {
    return this._body
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
