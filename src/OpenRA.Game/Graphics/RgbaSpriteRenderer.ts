/**
 * RgbaSpriteRenderer.ts — RGBA 精灵渲染器，对 SpriteRenderer 的薄验证封装
 * OpenRA 对照: OpenRA.Game/Graphics/RgbaSpriteRenderer.cs
 *
 * 核心范式转换:
 * - DrawSprite 重载委托 → 透传至父级 SpriteRenderer，paletteIndex 恒为 0
 * - RGBA 通道验证 → validateRGBA() 在每次调用时检查 s.Channel === TextureChannel.RGBA
 *
 * 设计决策:
 * - 不创建 GPU 资源（所有权归父级 SpriteRenderer），因此无需 dispose()
 * - paletteIndex 恒为 0：RGBA 精灵不依赖调色板纹理查找
 * - 保留与 OpenRA 完全一致的 4 个 DrawSprite 重载签名
 */

import { TextureChannel, type ISprite, type Vec3 } from './SpriteRenderer'

import type { SpriteRenderer } from './SpriteRenderer'

// ---------------------------------------------------------------------------
// RgbaSpriteRenderer
// ---------------------------------------------------------------------------

/**
 * RGBA 精灵渲染器。
 *
 * 此类为 SpriteRenderer 的薄封装，在将调用委托给父级渲染器之前
 * 验证精灵的纹理通道是否为 RGBA。所有方法均将 paletteIndex 设为 0，
 * 因为 RGBA 精灵不使用调色板纹理。
 *
 * OpenRA 对照: OpenRA.Graphics.RgbaSpriteRenderer
 */
export class RgbaSpriteRenderer {
  private readonly parent: SpriteRenderer

  /** 错误消息常量，与 OpenRA 完全一致 */
  static readonly ERROR_NOT_RGBA = 'DrawRGBASprite requires a RGBA sprite.'

  // -------------------------------------------------------------------------
  // 构造函数
  // -------------------------------------------------------------------------

  /**
   * @param parent — 父级 SpriteRenderer 实例，所有调用均委托至此处
   */
  constructor(parent: SpriteRenderer) {
    this.parent = parent
  }

  // -------------------------------------------------------------------------
  // DrawSprite 重载（4 个签名，与 OpenRA 完全一致）
  // -------------------------------------------------------------------------

  /**
   * 绘制 RGBA 精灵（float3 scale 非均匀缩放）。
   * 对应 OpenRA RgbaSpriteRenderer.DrawSprite(Sprite, float3, float3, float)。
   *
   * @param sprite — RGBA 通道精灵
   * @param location — 世界坐标
   * @param scale — 三维非均匀缩放因子
   * @param rotation — 旋转（弧度，默认 0）
   */
  drawSprite(sprite: ISprite, location: Vec3, scale: Vec3, rotation?: number): void
  /**
   * 绘制 RGBA 精灵（float 均匀缩放）。
   * 对应 OpenRA RgbaSpriteRenderer.DrawSprite(Sprite, float3, float, float)。
   *
   * @param sprite — RGBA 通道精灵
   * @param location — 世界坐标
   * @param scale — 均匀缩放（默认 1）
   * @param rotation — 旋转（弧度，默认 0）
   */
  drawSprite(sprite: ISprite, location: Vec3, scale?: number, rotation?: number): void
  /**
   * 绘制 RGBA 精灵（均匀缩放 + 色调 + 透明度）。
   * 对应 OpenRA RgbaSpriteRenderer.DrawSprite(Sprite, float3, float, float3, float, float)。
   *
   * @param sprite — RGBA 通道精灵
   * @param location — 世界坐标
   * @param scale — 均匀缩放
   * @param tint — RGB 色调
   * @param alpha — 透明度 (0-1)
   * @param rotation — 旋转（弧度，默认 0）
   */
  drawSprite(
    sprite: ISprite, location: Vec3, scale: number,
    tint: Vec3, alpha: number, rotation?: number,
  ): void
  /**
   * 绘制 RGBA 精灵（4 角点任意四边形）。
   * 对应 OpenRA RgbaSpriteRenderer.DrawSprite(Sprite, float3, float3, float3, float3, float3, float)。
   *
   * @param sprite — RGBA 通道精灵
   * @param a — 角点 A 世界坐标
   * @param b — 角点 B 世界坐标
   * @param c — 角点 C 世界坐标
   * @param d — 角点 D 世界坐标
   * @param tint — RGB 色调
   * @param alpha — 透明度 (0-1)
   */
  drawSprite(
    sprite: ISprite,
    a: Vec3, b: Vec3, c: Vec3, d: Vec3,
    tint: Vec3, alpha: number,
  ): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drawSprite(
    sprite: ISprite,
    arg2: Vec3,
    arg3?: Vec3 | number,
    arg4?: any,
    arg5?: any,
    arg6?: any,
    arg7?: any,
  ): void {
    this.validateRGBA(sprite)

    // 基于参数计数与类型区分重载：
    // - 7 个参数 → 角点重载: (sprite, a, b, c, d, tint, alpha)
    // - 6 个参数 → 色调重载: (sprite, location, scale, tint, alpha, rotation?)
    // - ≤4 参数 → 简单重载: (sprite, location, scale, rotation?)
    //
    // 判别方法：arg5 为对象（Vec3）→ 角点模式；arg4 为对象（Vec3）→ 色调模式

    if (arg5 !== undefined && typeof arg5 === 'object') {
      // 角点重载 — arg5 为角点 d (Vec3), arg6 为 tint, arg7 为 alpha
      this.parent.drawSpriteCorners(
        sprite, 0,
        arg2, arg3 as Vec3, arg4 as Vec3, arg5 as Vec3,
        arg6 as unknown as Vec3, arg7!,
      )
    } else if (arg4 !== undefined && typeof arg4 === 'object') {
      // 色调重载 — arg4 为 tint (Vec3), arg5 为 alpha, arg6 为 rotation
      this.parent.drawSprite(
        sprite, 0, arg2,
        arg3 as number, arg7 ?? 0,
        arg4 as Vec3, arg5 as number,
      )
    } else {
      // 简单重载 — arg3 为 scale (Vec3 | number), arg4 为 rotation (可选)
      this.parent.drawSprite(sprite, 0, arg2, arg3, arg4 as number ?? 0)
    }
  }

  // -------------------------------------------------------------------------
  // 验证
  // -------------------------------------------------------------------------

  /**
   * 验证精灵使用 RGBA 纹理通道。
   *
   * OpenRA 对照: 各 DrawSprite 重载中的内联 if-check
   *
   * @throws Error — 若 sprite.channel !== TextureChannel.RGBA
   */
  private validateRGBA(sprite: ISprite): void {
    if (sprite.channel !== TextureChannel.RGBA) {
      throw new Error(RgbaSpriteRenderer.ERROR_NOT_RGBA)
    }
  }
}
