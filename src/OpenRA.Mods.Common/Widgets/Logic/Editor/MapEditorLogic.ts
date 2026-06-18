/**
 * MapEditorLogic.ts — 编辑器根控制器：坐标显示、资源显示、撤销/重做按钮
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.cs (57 lines)
 *
 * 核心范式转换:
 * - C# Viewport.ViewToWorld(Viewport.LastMousePos) → TypeScript viewport.viewToWorld(lastMousePos)
 * - C# Map.Height.Contains(cell) → TypeScript map.height.contains(cell)
 * - C# Map.Tiles[cell].Type → TypeScript map.tiles.get(cell).type
 * - C# EditorResourceLayer.NetWorth → TypeScript netWorth
 * - C# EditorActionManager.HasUndos/HasRedos → TypeScript HasUndos/HasRedos
 * - C# ButtonWidget.IsDisabled / OnClick 闭包 → TypeScript isDisabled / onClick delegate
 *
 * 根编辑器控制器，连接顶层工具栏：
 * 1. 坐标标签：显示当前鼠标位置单元格坐标、地形高度、瓦片类型
 * 2. 现金标签：显示编辑器中放置的资源总价值
 * 3. 撤销/重做按钮：绑定到 EditorActionManager
 *
 * Migration: TODO-21.C.1 — Chapter 21 Phase C Wave 1
 */

import { ChromeLogic, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { LabelWidget } from '../../../Widgets/LabelWidget.js'
import type { ButtonWidget } from '../../../Widgets/ButtonWidget.js'
import { CPos } from '../../../../OpenRA.Game/CPos.js'
// ---------------------------------------------------------------------------
// Minimal interfaces for editor traits used by MapEditorLogic
// ---------------------------------------------------------------------------

/** Minimal Viewport for coordinate conversion.
 *
 * OpenRA 对照: Viewport { ViewToWorld(int2), LastMousePos }
 */
export interface IMapEditorViewport {
  readonly lastMousePos: { readonly x: number; readonly y: number }
  viewToWorld(viewPos: { readonly x: number; readonly y: number }): CPos
}

/** Minimal WorldRenderer for MapEditorLogic.
 *
 * OpenRA 对照: WorldRenderer { Viewport, World }
 */
export interface IMapEditorWorldRenderer {
  readonly viewport: IMapEditorViewport
  readonly world: IMapEditorWorld
}

/** Minimal Map for MapEditorLogic.
 *
 * OpenRA 对照: Map { Height, Tiles }
 */
export interface IMapEditorMap {
  readonly height: {
    readonly contains: (cell: CPos) => boolean
    readonly get: (cell: CPos) => number
  }
  readonly tiles: {
    readonly get: (cell: CPos) => { readonly type: number; readonly index: number }
  }
}

/** Minimal World for MapEditorLogic.
 *
 * OpenRA 对照: World { Map, WorldActor }
 */
export interface IMapEditorWorld {
  readonly map: IMapEditorMap
  readonly worldActor: {
    traitsImplementing<T>(_traitClass: new () => T): Iterable<T>
  }
}

/** Minimal EditorResourceLayer for net worth display.
 *
 * OpenRA 对照: EditorResourceLayer { NetWorth }
 */
export interface IMapEditorResourceLayer {
  readonly netWorth: number
}

/** Minimal EditorActionManager for undo/redo buttons.
 *
 * OpenRA 对照: EditorActionManager { HasUndos(), HasRedos(), Undo(), Redo() }
 */
export interface IMapEditorActionManager {
  HasUndos(): boolean
  HasRedos(): boolean
  Undo(): void
  Redo(): void
}

/** Placeholder class for EditorResourceLayer trait lookup. */
class EditorResourceLayerPlaceholder {
  netWorth: number = 0
}

/** Placeholder class for EditorActionManager trait lookup. */
class EditorActionManagerPlaceholder {
  HasUndos(): boolean { return false }
  HasRedos(): boolean { return false }
  Undo(): void {}
  Redo(): void {}
}

// ---------------------------------------------------------------------------
// MapEditorLogic
// OpenRA 对照: public class MapEditorLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 编辑器根控制器逻辑。
 *
 * 连接编辑器工具栏的顶层元素：
 * - 坐标标签 (COORDINATE_LABEL)
 * - 现金标签 (CASH_LABEL)
 * - 撤销按钮 (UNDO_BUTTON)
 * - 重做按钮 (REDO_BUTTON)
 *
 * OpenRA 对照: MapEditorLogic
 */
export class MapEditorLogic extends ChromeLogic {
  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: MapEditorLogic(Widget widget, World world, WorldRenderer worldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * 构造 MapEditorLogic。
   *
   * OpenRA 对照: MapEditorLogic(Widget, World, WorldRenderer)
   *
   * @param widget — 父 widget
   * @param _world — 游戏世界（通过 worldRenderer 间接访问）
   * @param worldRenderer — 世界渲染器，提供视口和世界数据
   */
  constructor(
    widget: Widget,
    _world: IMapEditorWorld,
    worldRenderer: IMapEditorWorldRenderer,
  ) {
    super()

    // ---- Coordinate label (对应 OpenRA COORDINATE_LABEL) ----
    const coordinateLabel = widget.getOrNull<LabelWidget>('COORDINATE_LABEL')
    if (coordinateLabel !== null) {
      coordinateLabel.getText = () => {
        const cell = worldRenderer.viewport.viewToWorld(
          worldRenderer.viewport.lastMousePos,
        )
        const map = worldRenderer.world.map
        if (map.height.contains(cell)) {
          const height = map.height.get(cell)
          const tile = map.tiles.get(cell)
          return `${cell.X},${cell.Y},${height} (${tile.type})`
        }
        return ''
      }
    }

    // ---- Cash label (对应 OpenRA CASH_LABEL) ----
    const cashLabel = widget.getOrNull<LabelWidget>('CASH_LABEL')
    if (cashLabel !== null) {
      const resTraits = worldRenderer.world.worldActor.traitsImplementing<IMapEditorResourceLayer>(
        EditorResourceLayerPlaceholder as unknown as new () => IMapEditorResourceLayer,
      )
      const reslayer = [...resTraits][0]
      if (reslayer) {
        cashLabel.getText = () => `$ ${reslayer.netWorth}`
      }
    }

    // ---- Undo / Redo buttons (对应 OpenRA UNDO_BUTTON / REDO_BUTTON) ----
    const undoButton = widget.getOrNull<ButtonWidget>('UNDO_BUTTON')
    const redoButton = widget.getOrNull<ButtonWidget>('REDO_BUTTON')
    if (undoButton !== null && redoButton !== null) {
      const actionManager = _world.worldActor.traitsImplementing<IMapEditorActionManager>(
        EditorActionManagerPlaceholder as unknown as new () => IMapEditorActionManager,
      )
      const am = [...actionManager][0]
      if (am) {
        undoButton.isDisabled = () => !am.HasUndos()
        undoButton.onClick = () => am.Undo()
        redoButton.isDisabled = () => !am.HasRedos()
        redoButton.onClick = () => am.Redo()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新（无需操作 — 所有更新通过闭包延迟求值）。
   */
  tick(): void {
    // All state updates happen lazily through closure delegates
    // (getText, isDisabled, etc.) which are evaluated during widget render.
  }
}
