/**
 * AnimationWithOffset.ts — 带偏移/禁用回调的动画包装器
 * OpenRA 对照: OpenRA.Game/Graphics/AnimationWithOffset.cs
 *
 * 核心范式转换:
 * - C# Func<WVec> / Func<bool> / Func<WPos, int> 委托 → TypeScript 箭头函数/闭包
 * - C# implicit operator → static fromAnimation() 工厂方法（TS 不支持隐式转换）
 * - C# Actorself.CenterPosition → IHasCenterPosition 接口（WPos）
 * - Animation.Render() / ScreenBounds() 调用 → 直接委托给 Animation 实例
 */

import type { Animation, IRenderable, Rectangle, IPaletteRef, IWorldRenderer } from './Animation.js'
import { WPos } from '../WPos.js'
import { WVec } from '../WVec.js'

// ---------------------------------------------------------------------------
// IHasCenterPosition — 具有 CenterPosition 属性的 actor 最小接口
// ---------------------------------------------------------------------------

/**
 * 具有世界坐标中心位置的 actor 最小接口。
 *
 * OpenRA 对照: Actor.CenterPosition (→ IOccupySpace.CenterPosition)
 */
export interface IHasCenterPosition {
  readonly CenterPosition: WPos
}

// ---------------------------------------------------------------------------
// AnimationWithOffset
// （对应 OpenRA AnimationWithOffset）
// ---------------------------------------------------------------------------

/**
 * 包装 Animation，附加世界空间偏移和可见性控制。
 *
 * OpenRA 对照: AnimationWithOffset class
 *
 * 每个 actor 的每个渲染动画均由此包装。其负责:
 * - 计算世界空间偏移（OffsetFunc）
 * - 检查是否应跳过渲染（DisableFunc）
 * - 计算 Z 排序偏移（ZOffset）
 * - 委托给 Animation 实例进行实际渲染
 */
export class AnimationWithOffset {
  /** 被包装的动画实例。
   *
   * OpenRA 对照: AnimationWithOffset.Animation
   */
  readonly Animation: Animation

  /** 世界空间偏移回调（null = WVec.Zero）。
   *
   * OpenRA 对照: AnimationWithOffset.OffsetFunc
   */
  readonly OffsetFunc: (() => WVec) | null

  /** 禁用检查回调（null = 始终启用）。
   *
   * OpenRA 对照: AnimationWithOffset.DisableFunc
   */
  readonly DisableFunc: (() => boolean) | null

  /** Z 排序偏移回调（null = 0）。
   *
   * OpenRA 对照: AnimationWithOffset.ZOffset
   */
  readonly ZOffset: ((pos: WPos) => number) | null

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA 四个构造重载）
  //
  // OpenRA 对照:
  //   AnimationWithOffset(Animation, Func<WVec>, Func<bool>)
  //   AnimationWithOffset(Animation, Func<WVec>, Func<bool>, int)
  //   AnimationWithOffset(Animation, Func<WVec>, Func<bool>, Func<WPos, int>)
  // -----------------------------------------------------------------------

  /**
   * 构造 AnimationWithOffset。
   *
   * OpenRA 对照: 三个构造重载合并为一个（TS 不支持同名重载，使用可选参数 + 联合类型）
   *
   * @param animation — 被包装的动画
   * @param offset — 偏移回调（null = 零偏移）
   * @param disable — 禁用回调（null = 始终启用）
   * @param zOffset — Z 偏移：number（常量）或 (WPos) => number（动态），null = 0
   */
  constructor(
    animation: Animation,
    offset: (() => WVec) | null,
    disable: (() => boolean) | null,
    zOffset?: number | ((pos: WPos) => number) | null,
  ) {
    this.Animation = animation
    this.OffsetFunc = offset
    this.DisableFunc = disable

    if (zOffset === undefined || zOffset === null) {
      this.ZOffset = null
    } else if (typeof zOffset === 'number') {
      this.ZOffset = () => zOffset as number
    } else {
      this.ZOffset = zOffset
    }
  }

  // -----------------------------------------------------------------------
  // Render（对应 OpenRA AnimationWithOffset.Render）
  //
  // OpenRA 对照: AnimationWithOffset.Render(Actor self, PaletteReference pal)
  // -----------------------------------------------------------------------

  /**
   * 在 actor 当前位置渲染动画。
   *
   * OpenRA 对照: AnimationWithOffset.Render(Actor self, PaletteReference pal)
   *
   * 计算 center + offset，可选 Z 排序偏移，然后委托给 Animation.Render()。
   *
   * @param self — 具有 CenterPosition 的 actor
   * @param pal — 调色板引用
   * @returns 可渲染对象数组
   */
  render(self: IHasCenterPosition, pal: IPaletteRef): IRenderable[] {
    const center = self.CenterPosition
    const offset = this.OffsetFunc?.() ?? WVec.Zero
    const pos = WPos.add(center, offset)
    const z = this.ZOffset?.(pos) ?? 0
    return this.Animation.render(center, offset, z, pal)
  }

  // -----------------------------------------------------------------------
  // ScreenBounds（对应 OpenRA AnimationWithOffset.ScreenBounds）
  //
  // OpenRA 对照: AnimationWithOffset.ScreenBounds(Actor self, WorldRenderer wr)
  // -----------------------------------------------------------------------

  /**
   * 计算动画在屏幕上的包围矩形。
   *
   * OpenRA 对照: AnimationWithOffset.ScreenBounds(Actor self, WorldRenderer wr)
   *
   * @param self — 具有 CenterPosition 的 actor
   * @param wr — 世界渲染器
   * @returns 屏幕空间矩形
   */
  screenBounds(self: IHasCenterPosition, wr: IWorldRenderer): Rectangle {
    const center = self.CenterPosition
    const offset = this.OffsetFunc?.() ?? WVec.Zero
    return this.Animation.screenBounds(wr, center, offset)
  }

  // -----------------------------------------------------------------------
  // fromAnimation — 从 Animation 创建（对应 implicit operator）
  //
  // OpenRA 对照: static implicit operator AnimationWithOffset(Animation a)
  // -----------------------------------------------------------------------

  /**
   * 从 Animation 创建 AnimationWithOffset（零偏移、始终启用、无 Z 偏移）。
   *
   * OpenRA 对照: implicit operator AnimationWithOffset(Animation a)
   *
   * @param anim — 动画实例
   * @returns 包装后的实例
   */
  static fromAnimation(anim: Animation): AnimationWithOffset {
    return new AnimationWithOffset(anim, null, null, null)
  }
}
