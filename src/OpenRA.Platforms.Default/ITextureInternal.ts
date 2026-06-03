/**
 * ITextureInternal.ts — 内部纹理接口定义
 * OpenRA 对照: OpenRA.Platforms.Default/ITextureInternal.cs
 *
 * 核心范式转换:
 * - ITextureInternal extends ITexture（C# 接口继承 → TypeScript 接口继承）
 * - uint ID（OpenGL 纹理名称）→ readonly id: number（Babylon.js uniqueId）
 * - SetEmpty(int, int) 保留（通过 RawTexture 构造空纹理实现）
 */

import type { ITexture } from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// ITextureInternal 接口
// ---------------------------------------------------------------------------

/**
 * 内部纹理接口，扩展 ITexture 以包含 OpenRA 引擎内部使用的额外操作。
 *
 * OpenRA 对照: ITextureInternal (ITextureInternal.cs:14-19)
 *
 * 在 OpenRA 中，ITextureInternal 通过 `uint ID` 暴露原始 OpenGL 纹理名称，
 * 用于 FrameBuffer 等需要直接操作纹理对象的底层组件。
 * 迁移版使用 Babylon.js 内部管理的纹理唯一标识符（uniqueId），
 * 避免直接暴露 WebGL 纹理名称。
 *
 * 迁移方案：由 Texture.ts 类实现此接口。
 */
export interface ITextureInternal extends ITexture {
  /**
   * 纹理标识符。
   *
   * 对应 OpenRA ITextureInternal.ID（OpenGL glGenTextures 返回的 uint 纹理名称）。
   * 迁移版使用 Babylon.js 纹理的 uniqueId，仅用于调试/日志目的。
   */
  readonly id: number

  /**
   * 分配未初始化的纹理存储空间。
   *
   * 对应 OpenRA ITextureInternal.SetEmpty(int width, int height)。
   * 在 OpenRA 中通过 glTexImage2D(data=IntPtr.Zero) 分配空纹理，
   * 迁移版通过重新创建 RawTexture（data=null）实现等效行为。
   *
   * @param width — 纹理宽度（像素）
   * @param height — 纹理高度（像素）
   */
  setEmpty(width: number, height: number): void
}
