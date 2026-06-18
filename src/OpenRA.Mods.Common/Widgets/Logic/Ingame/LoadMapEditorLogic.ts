/**
 * LoadMapEditorLogic.ts — 编辑器启动引导：加载编辑器 widget 树根
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Ingame/LoadMapEditorLogic.cs (26 lines)
 *
 * 核心范式转换:
 * - Game.LoadWidget(world, name, parent, []) → loadWidget(world, name, parent, {})
 * - C# [ObjectCreator.UseCtor] → TypeScript 构造函数参数注入
 *
 * 编辑器入口 ChromeLogic。构造时加载两个 widget 子树：
 * 1. EDITOR_WORLD_ROOT — 主编辑器面板层级
 * 2. TRANSIENTS_PANEL — 浮动对话框容器
 *
 * Migration: TODO-21.C.17 — Chapter 21 Phase C Wave 1
 */

import { ChromeLogic, type Widget, type WidgetArgs } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { WorldStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Widget tree loader function type (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Load a named widget subtree into a parent widget.
 *
 * OpenRA 对照: Game.LoadWidget(World, string, Widget, WidgetArgs)
 */
export type EditorWidgetLoader = (
  world: WorldStub,
  name: string,
  parent: Widget,
  args: WidgetArgs,
) => void

// ---------------------------------------------------------------------------
// LoadMapEditorLogic
// OpenRA 对照: public class LoadMapEditorLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 编辑器启动引导逻辑。
 *
 * 在进入编辑器模式时被加载，负责初始化整个编辑器 widget 树。
 * 将所有后续编辑面板（Tab 栏、工具、选择器）加载到 EDITOR_WORLD_ROOT，
 * 将对话框（保存、新建地图）加载到 TRANSIENTS_PANEL。
 *
 * OpenRA 对照: LoadMapEditorLogic
 */
export class LoadMapEditorLogic extends ChromeLogic {
  /**
   * 构造编辑器 Bootstrap 逻辑。
   *
   * OpenRA 对照: LoadMapEditorLogic(Widget widget, World world)
   *
   * @param widget — 父 widget（包含 WORLD_ROOT 子 widget）
   * @param world — 游戏世界引用
   * @param loadWidget — 可选的 widget 加载函数（用于测试注入）
   */
  constructor(
    widget: Widget,
    world: WorldStub,
    loadWidget?: EditorWidgetLoader,
  ) {
    super()
    const editorRoot = widget.get('WORLD_ROOT')
    const loader = loadWidget ?? LoadMapEditorLogic.defaultLoader

    loader(world, 'EDITOR_WORLD_ROOT', editorRoot, {})
    loader(world, 'TRANSIENTS_PANEL', editorRoot, {})
  }

  /**
   * 每帧更新（无需操作）。
   */
  tick(): void {
    // No-op: this logic has no per-frame behavior
  }

  /** 默认的 widget 加载器（no-op，由 WidgetLoader 在运行时注入）。 */
  static defaultLoader: EditorWidgetLoader = () => {
    /* No-op: replace with actual WidgetLoader.loadWidgetById in production */
  }
}
