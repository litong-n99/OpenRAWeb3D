/**
 * IEditorBrush.ts — 编辑器笔刷共享接口
 * OpenRA 对照: (新文件 — 从 EditorCursorLayer / EditorViewportControllerWidget
 *   中提取的 C# 隐式契约)
 *
 * 核心范式转换:
 * - C# IEditorBrush 隐式契约（无显式 interface）→ TypeScript 显式 interface
 * - C# IEnumerable<IRenderable> yield return → TypeScript readonly IRenderable[]
 * - C# explicit interface implementation (ITickRender.TickRender) → 统一 camelCase
 *
 * Migration:  — Chapter 21 Phase A, shared by EditorCursorLayer + Phase B brushes
 */

import type { WorldRendererStub, IGameActor, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IEditorBrush (OpenRA 对照: 隐式契约由 EditorCursorLayer 使用)
// ---------------------------------------------------------------------------

/**
 * 活动编辑器工具的抽象笔刷接口。
 *
 * OpenRA 对照: IEditorBrush（C# 中的隐式契约 — EditorCursorLayer 通过
 * ITickRender/IRenderAboveShroud/IRenderAnnotations 将调用路由到笔刷）
 *
 * 笔刷实例持有所有编辑器工具的状态和渲染逻辑（选择、瓦片绘制、
 * 资源放置、actor 放置）。EditorCursorLayer 是画笔持有笔刷
 * 并在世界 actor 上的薄委托特征。
 *
 * Phase B 中的具体实现：EditorDefaultBrush、EditorTileBrush、
 * EditorActorBrush、EditorResourceBrush。
 */
export interface IEditorBrush {
  /** 逐 tick 渲染更新（动画推进等）。
   *
   * OpenRA 对照: ITickRender.TickRender(WorldRenderer wr, Actor self)
   */
  tickRender(wr: WorldRendererStub, self: IGameActor): void

  /** 在 shroud 上方渲染（即使有战争迷雾也可见）。
   *
   * OpenRA 对照: IRenderAboveShroud.RenderAboveShroud(Actor self, WorldRenderer wr)
   */
  renderAboveShroud(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[]

  /** 渲染标注（选择框、生命条等）。
   *
   * OpenRA 对照: IRenderAnnotations.RenderAnnotations(Actor self, WorldRenderer wr)
   */
  renderAnnotations(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[]

  /** 处理鼠标输入。
   *
   * OpenRA 对照: IEditorBrush.HandleMouseInput(MouseInput mi)
   *
   * @param mi — 鼠标输入事件（暂使用 unknown，待 MouseInput 迁移）
   * @returns 如果笔刷消费了该事件则返回 true
   */
  handleMouseInput(mi: unknown): boolean

  /** 每 tick 逻辑更新（非渲染）。
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(): void

  /** 释放笔刷持有的 GPU 资源。
   *
   * OpenRA 对照: IDisposable.Dispose()（无显式 IDisposable，但笔刷持有资源）
   */
  dispose(): void
}
