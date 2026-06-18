/**
 * WithIdleOverlay.ts — 空闲装饰动画覆盖特质
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.cs
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<WithIdleOverlayInfo> → ConditionalTrait<WithIdleOverlayInfo>
 * - C# INotifyDamageStateChanged.DamageStateChanged → damageStateChanged()
 * - C# BodyOrientation / IFacing trait 查询 → 接口（stub 直至完整迁移）
 * - C# RenderUtils.ZOffsetFromCenter → 内联静态方法
 * - C# Actor self → IRenderActor（RenderSprites 中定义）
 * - C# self.World → IWorldWithSequences 接口（序列集引用）
 *
 * 装饰动画覆盖在 actor 上（如建筑物旗帜、单位帽徽）。
 * 支持初始 StartSequence（播放一次后切换到 Sequence 循环）。
 * 损伤状态变化时自动切换到带前缀的序列变体。
 */

import { Animation } from '../../../OpenRA.Game/Graphics/Animation.js'
import { AnimationWithOffset } from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { ISequenceSet } from '../../../OpenRA.Game/Graphics/Animation.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyDamageStateChanged,
  type AttackInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { RenderSprites } from './RenderSprites.js'
import type { IRenderActor } from './RenderSprites.js'

// ---------------------------------------------------------------------------
// BodyOrientation 前向声明（完整迁移前的最小接口）
// ---------------------------------------------------------------------------

/**
 * BodyOrientation 特质前向声明。
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BodyOrientation.cs
 *
* 替换为完整 BodyOrientation 特质（包含 QuantizedFacings 等）
 */
export interface IBodyOrientation {
  /** 将本地偏移转换为世界空间。
   *
   * OpenRA 对照: BodyOrientation.LocalToWorld(WVec)
   */
  localToWorld(offset: WVec): WVec

  /** 量化朝向（适配动画朝向数）。
   *
   * OpenRA 对照: BodyOrientation.QuantizeOrientation(WRot, int)
   */
  quantizeOrientation(orientation: WRot, facings?: number): WRot

  /** 量化面朝角。
   *
   * OpenRA 对照: BodyOrientation.QuantizeFacing(WAngle)
   */
  quantizeFacing(facing: WAngle): WAngle
}

// ---------------------------------------------------------------------------
// IWorldWithSequences — 具有序列集的 World 接口
// ---------------------------------------------------------------------------

/** 具有序列集的 World 最小接口。
 *
 * OpenRA 对照: World.Map.Sequences
 */
export interface IWorldWithSequences {
  readonly Sequences: ISequenceSet
}

// ---------------------------------------------------------------------------
// 静态: ZOffsetFromCenter（对应 OpenRA RenderUtils.ZOffsetFromCenter）
// ---------------------------------------------------------------------------

/**
 * 计算从 actor 中心到指定位置的 Z 排序偏移。
 *
 * OpenRA 对照: RenderUtils.ZOffsetFromCenter(Actor self, WPos pos, int offset)
 *
 * @param center — actor 中心位置
 * @param pos — overlay 世界位置
 * @param offset — 基础偏移
 * @returns delta.Y + delta.Z + offset
 */
function zOffsetFromCenter(center: WPos, pos: WPos, offset: number): number {
  const deltaY = pos.Y - center.Y
  const deltaZ = pos.Z - center.Z
  return deltaY + deltaZ + offset
}

// ---------------------------------------------------------------------------
// WithIdleOverlayInfo（对应 OpenRA WithIdleOverlayInfo）
// ---------------------------------------------------------------------------

/**
 * WithIdleOverlay 特质配置。
 *
 * OpenRA 对照: WithIdleOverlayInfo : PausableConditionalTraitInfo, IRenderActorPreviewSpritesInfo
 */
export interface WithIdleOverlayInfo extends ConditionalTraitInfo {
  /** 覆盖图像（null = 使用 actor 类型名称）。
   *
   * OpenRA 对照: WithIdleOverlayInfo.Image
   */
  readonly Image: string | null

  /** 初始动画序列（创建时播放一次，然后切换到 Sequence）。
   *
   * OpenRA 对照: WithIdleOverlayInfo.StartSequence
   */
  readonly StartSequence: string | null

  /** 主循环序列名称。
   *
   * OpenRA 对照: WithIdleOverlayInfo.Sequence (default "idle-overlay")
   */
  readonly Sequence: string

  /** 相对于 body 的位置偏移。
   *
   * OpenRA 对照: WithIdleOverlayInfo.Offset (default WVec.Zero)
   */
  readonly Offset: WVec

  /** 自定义调色板名称。
   *
   * OpenRA 对照: WithIdleOverlayInfo.Palette
   */
  readonly Palette: string | null

  /** 是否为玩家颜色调色板。
   *
   * OpenRA 对照: WithIdleOverlayInfo.IsPlayerPalette (default false)
   */
  readonly IsPlayerPalette: boolean

  /** 是否为装饰物。
   *
   * OpenRA 对照: WithIdleOverlayInfo.IsDecoration (default false)
   */
  readonly IsDecoration: boolean
}

/**
 * WithIdleOverlayInfo 默认值。
 */
export const DEFAULT_IDLE_OVERLAY_INFO: WithIdleOverlayInfo = {
  requiresCondition: undefined,
  Image: null,
  StartSequence: null,
  Sequence: 'idle-overlay',
  Offset: WVec.Zero,
  Palette: null,
  IsPlayerPalette: false,
  IsDecoration: false,
}

// ---------------------------------------------------------------------------
// WithIdleOverlay（对应 OpenRA WithIdleOverlay）
// ---------------------------------------------------------------------------

/**
 * 空闲装饰动画覆盖 — 在 actor 上渲染额外动画。
 *
 * OpenRA 对照: WithIdleOverlay : PausableConditionalTrait<WithIdleOverlayInfo>, INotifyDamageStateChanged
 *
 * 创建一个 AnimationWithOffset 并注册到 RenderSprites。
 * 覆盖动画相对于 body 的位置由 Offset 和 BodyOrientation 决定。
 * 损伤状态变化时自动切换到带前缀（如 "critical-"）的序列变体。
 *
 * 使用方式:
 * ```
 * const info: WithIdleOverlayInfo = { ...DEFAULT_IDLE_OVERLAY_INFO, Image: 'myflag' }
 * const overlay = new WithIdleOverlay(info, actor, renderSprites, body, facing, sequences)
 * ```
 */
export class WithIdleOverlay
  extends ConditionalTrait<WithIdleOverlayInfo>
  implements INotifyDamageStateChanged {
  /** 静态接口注册（供 TypeDictionary 使用）。 */
  static readonly interfaces = [
    'INotifyDamageStateChanged',
    'WithIdleOverlay',
    'component',
  ]

  /** 底层装饰动画实例。 */
  private readonly _overlay: Animation

  /** 被包装的 AnimationWithOffset（注册到 RenderSprites 中）。 */
  private readonly _anim: AnimationWithOffset

  /** RenderSprites 引用（用于 Remove）。 */
  private readonly _renderSprites: RenderSprites

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA WithIdleOverlay 构造函数）
  // -----------------------------------------------------------------------

  /**
   * 构造 WithIdleOverlay。
   *
   * OpenRA 对照: WithIdleOverlay(Actor self, WithIdleOverlayInfo info)
   *
   * @param info — 特质配置
   * @param self — actor 实例
   * @param rs — RenderSprites 特质实例
   * @param body — BodyOrientation 特质（可为 null）
   * @param facing — IFacing 特质（可为 null）
   * @param world — 具有 Sequences 的 World
   */
  constructor(
    info: WithIdleOverlayInfo,
    self: IRenderActor,
    rs: RenderSprites,
    body: IBodyOrientation | null,
    facing: IFacing | null,
    world: IWorldWithSequences,
  ) {
    super(info)

    this._renderSprites = rs

    // 解析图像名称
    const image = info.Image ?? rs.getImage(self)

    // 构建 facing 回调
    const facingFunc = WithIdleOverlay._makeFacingFunc(facing, body)

    // 创建底层动画
    this._overlay = new Animation(
      world.Sequences,
      image,
      facingFunc,
      () => this.isTraitDisabled,
    )
    this._overlay.isDecoration = info.IsDecoration

    // 播放初始序列
    const damageState = self.getDamageState()
    if (info.StartSequence) {
      const startSeq = RenderSprites.normalizeSequence(
        this._overlay,
        damageState,
        info.StartSequence,
      )
      const mainSeq = RenderSprites.normalizeSequence(
        this._overlay,
        damageState,
        info.Sequence,
      )
      this._overlay.playThen(startSeq, () => {
        this._overlay.playRepeating(mainSeq)
      })
    } else {
      const mainSeq = RenderSprites.normalizeSequence(
        this._overlay,
        damageState,
        info.Sequence,
      )
      this._overlay.playRepeating(mainSeq)
    }

    // 构建偏移回调
    const offsetFn = body
      ? () => body.localToWorld(WithIdleOverlay._computeLocalOffset(info.Offset, body, facing))
      : () => info.Offset

    // 构建 Z 偏移回调
    const zOffsetFn = (p: WPos) => zOffsetFromCenter(self.CenterPosition, p, 1)

    // 创建包装动画并注册
    this._anim = new AnimationWithOffset(
      this._overlay,
      offsetFn,
      () => this.isTraitDisabled,
      zOffsetFn,
    )

    rs.add(this._anim, info.Palette, info.IsPlayerPalette)
  }

  // -----------------------------------------------------------------------
  // INotifyDamageStateChanged（对应 OpenRA DamageStateChanged）
  // -----------------------------------------------------------------------

  /**
   * 损伤状态变化时切换动画序列。
   *
   * OpenRA 对照: INotifyDamageStateChanged.DamageStateChanged(Actor self, AttackInfo e)
   *
   * @param _actor — actor 实例
   * @param attackInfo — 攻击信息（包含新 DamageState）
   */
  damageStateChanged(_actor: IGameActor, attackInfo: AttackInfo): void {
    const currentSeq = this._overlay.currentSequence
    if (!currentSeq) return

    const newSeq = RenderSprites.normalizeSequence(
      this._overlay,
      attackInfo.damageState,
      currentSeq.name,
    )
    this._overlay.replaceAnim(newSeq)
  }

  // -----------------------------------------------------------------------
  // 公共访问器
  // -----------------------------------------------------------------------

  /** 底层覆盖动画实例。
   *
   * OpenRA 对照: WithIdleOverlay.overlay (private, exposed for tests)
   */
  get overlay(): Animation {
    return this._overlay
  }

  /** 已注册的 AnimationWithOffset 包装器。
   *
   * OpenRA 对照: 隐式（rs.Add 传入的 anim）
   */
  get animation(): AnimationWithOffset {
    return this._anim
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * 释放资源并从 RenderSprites 中移除动画。
   *
   * OpenRA 对照: N/A（C# 依赖 GC，TS 需要显式清理）
   */
  override dispose(): void {
    this._renderSprites.remove(this._anim)
    super.dispose()
  }

  // -----------------------------------------------------------------------
  // 静态: _makeFacingFunc（对应 OpenRA 构造函数内的 lambda）
  // -----------------------------------------------------------------------

  /**
   * 构建面向方向回调。
   *
   * OpenRA 对照:
   *   facing == null ? () => WAngle.Zero
   *     : (body == null ? () => facing.Facing
   *       : () => body.QuantizeFacing(facing.Facing))
   *
   * @param facing — IFacing 特质（可为 null）
   * @param body — BodyOrientation 特质（可为 null）
   * @returns 面向方向回调
   */
  private static _makeFacingFunc(
    facing: IFacing | null,
    body: IBodyOrientation | null,
  ): () => number {
    if (!facing) {
      return () => 0
    }
    if (!body) {
      // facing.facing is WAngle class instance, convert to number
      return () => facing.facing.angle
    }
    return () => body.quantizeFacing(facing.facing).angle
  }

  // -----------------------------------------------------------------------
  // 静态: _computeLocalOffset（计算本地空间偏移）
  // -----------------------------------------------------------------------

  /**
   * 计算装饰物在本地空间的 WVec 偏移。
   *
   * OpenRA 对照: body.QuantizeOrientation(self.Orientation) 应用于 info.Offset
   *
   * 等价于: info.Offset.Rotate(body.QuantizeOrientation(self.Orientation))
   *
   * @param offsetRaw — 原始偏移（来自 info.Offset）
   * @param body — BodyOrientation 特质
   * @param facing — IFacing 特质
   * @param self — actor 实例
   * @returns 旋转后的世界空间偏移
   */
  private static _computeLocalOffset(
    offsetRaw: WVec,
    body: IBodyOrientation,
    facing: IFacing | null,
  ): WVec {
    const orientation = facing?.orientation ?? WRot.None
    const quantized = body.quantizeOrientation(orientation)
    return offsetRaw.rotate(quantized)
  }
}
