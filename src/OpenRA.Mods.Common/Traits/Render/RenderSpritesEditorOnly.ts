/**
 * RenderSpritesEditorOnly.ts — 编辑器专属精灵渲染器
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/RenderSpritesEditorOnly.cs
 *
 * 核心范式转换:
 * - C# sealed class 继承 → TypeScript extends（无 sealed 等效项）
 * - C# override IEnumerable<IRenderable> Render() → TypeScript override render()
 * - C# yield return SpriteRenderable.None → TypeScript return []
 * - 此特质在游戏模式下丢弃所有精灵（返回空数组），仅在编辑器模式下渲染。
 *   编辑器模式判断由编辑器基础设施处理（TODO-21.A.2 EditorActorLayer）
 *
 * RenderSpritesEditorOnly 是 RenderSprites 的微小变体：
 * 在游戏模式（非编辑器）中，重写的 render() 返回空数组，
 * 使所有附加的精灵不可见。在编辑器模式中，基类的 render() 行为被使用。
 *
 * 用途：编辑器专属的视觉辅助元素（如出生点标记、摄像机书签），
 * 这些元素在游戏中不应可见。
 */

import type {
  IRenderable,
  Rectangle,
} from '../../../OpenRA.Game/Graphics/Animation.js'
import {
  RenderSprites,
  RenderSpritesInfo,
  type IRenderActor,
} from './RenderSprites.js'
import type { IWorldRenderer } from '../../../OpenRA.Game/Graphics/Animation.js'

// ---------------------------------------------------------------------------
// RenderSpritesEditorOnlyInfo（对应 OpenRA RenderSpritesEditorOnlyInfo）
// ---------------------------------------------------------------------------

/**
 * RenderSpritesEditorOnly 特质配置。
 *
 * OpenRA 对照: RenderSpritesEditorOnlyInfo : RenderSpritesInfo
 *
 * [Desc("Invisible during games.")]
 *
 * 此 Info 类继承 RenderSpritesInfo 的全部字段（Image、FactionImages、
 * Palette、PlayerPalette），不添加额外配置。在 C# 中使用 sealed 关键字
 * 封禁进一步继承，TypeScript 无等效项。
 */
export class RenderSpritesEditorOnlyInfo extends RenderSpritesInfo {
  constructor(
    image?: string | null,
    factionImages?: Readonly<Record<string, string>> | null,
    palette?: string | null,
    playerPalette?: string,
  ) {
    super(image, factionImages, palette, playerPalette)
  }
}

// ---------------------------------------------------------------------------
// RenderSpritesEditorOnly（对应 OpenRA RenderSpritesEditorOnly）
// ---------------------------------------------------------------------------

/**
 * 编辑器专属精灵渲染器。
 *
 * OpenRA 对照: OpenRA.Mods.Common.Traits.Render.RenderSpritesEditorOnly
 *
 * 在游戏模式下丢弃所有精灵渲染输出。此特质附加到编辑器专属的
 * 视觉辅助元素，这些元素仅在编辑器模式中可见。
 *
 * C# 原始代码:
 *   public override IEnumerable<IRenderable> Render(Actor self, WorldRenderer wr)
 *   {
 *     return SpriteRenderable.None;
 *   }
 */
export class RenderSpritesEditorOnly extends RenderSprites {
  /**
   * 构造 RenderSpritesEditorOnly。
   *
   * OpenRA 对照: RenderSpritesEditorOnly(ActorInitializer init, RenderSpritesEditorOnlyInfo info)
   *
   * @param info — 特质配置
   * @param faction — 阵营内部名称（来自 Owner.Faction.InternalName）
   */
  constructor(info: RenderSpritesEditorOnlyInfo, faction?: string | null) {
    super(info, faction)
  }

  /**
   * 渲染（在游戏模式下返回空数组）。
   *
   * OpenRA 对照: RenderSpritesEditorOnly.Render(Actor self, WorldRenderer wr)
   *
   * 在 C# 中返回 `SpriteRenderable.None`（等同于空枚举）。
   * 在 TypeScript 中返回空数组 `[]`。
   *
   * NOTE: 在编辑器模式中，此方法应调用 super.render() 来使用基类的
   * 正常渲染行为。当前实现始终返回空数组，因为编辑器模式检测
   * 由 TODO-21.A.2（EditorActorLayer）处理。当编辑器基础设施迁移完成后，
   * 应添加 isEditorMode 标志来条件性地调用 super.render()。
   *
   * @param _self — actor 实例
   * @param _wr — 世界渲染器
   * @returns 空数组（游戏模式下不可见）
   */
  override render(_self: IRenderActor, _wr: IWorldRenderer): readonly IRenderable[] {
    // NOTE: 在 C# 中，这始终返回空枚举。编辑器模式由单独的系统加载
    // 来切换——编辑器 Actor 使用不同的 RenderSprites 实例而非此特质。
    return []
  }

  /** @inheritdoc */
  override screenBounds(
    _self: IRenderActor,
    _wr: IWorldRenderer,
  ): readonly Rectangle[] {
    return []
  }
}
