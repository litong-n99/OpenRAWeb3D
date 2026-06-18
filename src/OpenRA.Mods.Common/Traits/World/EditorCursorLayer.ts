/**
 * EditorCursorLayer.ts — 编辑器光标网格叠加层
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/EditorCursorLayer.cs (53 lines C#)
 *
 * 核心范式转换:
 * - C# trait on world actor (ITickRender, IRenderAboveShroud, IRenderAnnotations)
 *   → TypeScript 类实现相同接口，委托给活跃的 IEditorBrush
 * - C# explicit interface implementation → 所有方法均为 public（TS 无显式接口实现）
 * - C# IEnumerable<IRenderable> yield return → TypeScript readonly IRenderable[] 数组
 * - C# 2D 网格光标（隐式在笔刷中）→ Babylon.js Plane 四边形 Mesh
 *   + CoordinateTransformer.cellToVector3() 用于 3D 定位
 * - 光标颜色根据笔刷模式变化（绿=瓦片，蓝=actor，黄=资源）
 *
 * Migration: TODO-21.A.4 — Chapter 21 Phase A
 */

import { Constants } from '@babylonjs/core/Engines/constants'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { CPos } from '../../../OpenRA.Game/CPos.js'
import {
  WORLD_SCALE,
  cellToVector3,
} from '../../../OpenRA.Game/CoordinateTransformer.js'
import type { MapGrid } from '../../../OpenRA.Game/Map/MapGrid.js'
import type {
  ITraitInfo,
  ITickRender,
  IRenderAboveShroud,
  IRenderAnnotations,
  IGameActor,
  WorldRendererStub,
  IRenderable,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../../Editor/IEditorBrush.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Small Z-axis offset for the cursor quad above terrain to prevent z-fighting.
 * Applied as a Babylon.js world-unit offset (1 unit = 1024 OpenRA units).
 */
const CURSOR_Z_OFFSET = 0.02

// ---------------------------------------------------------------------------
// CursorColorPreset (光标颜色预设——按笔刷模式)
// ---------------------------------------------------------------------------

/**
 * 不同编辑器笔刷模式下的光标颜色。
 *
 * OpenRA 对照: (无直接对应——3D 光标可视化的 TS 专属)
 *
 * NOTE: 这些颜色与 OpenRA editor 的笔刷模式语义匹配：
 *   - 瓦片笔刷 → 绿色（地形操作）
 *   - Actor笔刷 → 蓝色（actor 放置）
 *   - 资源笔刷 → 黄色（资源绘制）
 */
export const CursorColor = {
  /** 默认 / 选择：白色。 */
  Default: new Color3(1.0, 1.0, 1.0),
  /** 瓦片笔刷：绿色。 */
  Tile: new Color3(0.4, 0.9, 0.4),
  /** Actor笔刷：蓝色。 */
  Actor: new Color3(0.4, 0.6, 1.0),
  /** 资源笔刷：黄色。 */
  Resource: new Color3(0.9, 0.85, 0.3),
  /** 错误 / 不可放置：红色。 */
  Invalid: new Color3(1.0, 0.3, 0.3),
} as const

// ---------------------------------------------------------------------------
// EditorCursorLayerInfo (对应 OpenRA EditorCursorLayerInfo : TraitInfo<EditorCursorLayer>)
// ---------------------------------------------------------------------------

/**
 * Trait info for EditorCursorLayer.
 *
 * OpenRA 对照: EditorCursorLayerInfo : TraitInfo<EditorCursorLayer>,
 *   Requires<EditorActorLayerInfo>, Requires<ITiledTerrainRendererInfo>
 *
 * @TraitLocation SystemActors.EditorWorld
 *
 * NOTE: C# Requires<ITiledTerrainRendererInfo> is removed — terrain renderer
 *   is not yet migrated. The brush will access terrain via Map data directly.
 *   TODO-21.A.4-DEFER-1: Restore ITiledTerrainRenderer dependency.
 */
export class EditorCursorLayerInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Create the EditorCursorLayer trait instance.
   *
   * OpenRA 对照: TraitInfo<EditorCursorLayer>.Create(ActorInitializer)
   *
   * @param _init — actor initializer (unused by this trait)
   * @returns a new EditorCursorLayer instance
   */
  create(_init: { self: IGameActor }): EditorCursorLayer {
    return new EditorCursorLayer()
  }
}

// ---------------------------------------------------------------------------
// EditorCursorLayer (对应 OpenRA EditorCursorLayer : ITickRender,
//   IRenderAboveShroud, IRenderAnnotations)
// ---------------------------------------------------------------------------

/**
 * Editor cursor grid overlay that shows the current mouse cell position.
 *
 * OpenRA 对照: EditorCursorLayer : ITickRender, IRenderAboveShroud, IRenderAnnotations
 *
 * This trait is attached to the editor world actor. It holds a reference to
 * the active IEditorBrush and delegates all tick/render calls to it. This
 * indirection allows the editor viewport widget to swap brushes at runtime
 * without modifying the world actor's trait composition.
 *
 * In 3D/Babylon.js, the cursor layer additionally manages a visible cursor
 * quad (semi-transparent Plane mesh) positioned at the terrain height of the
 * current cursor cell, colored by the active brush mode.
 */
export class EditorCursorLayer implements ITickRender, IRenderAboveShroud, IRenderAnnotations {
  // ---------------------------------------------------------------------------
  // Brush reference (OpenRA 对照: IEditorBrush brush 字段)
  // ---------------------------------------------------------------------------

  /** The active editor brush, or null if no brush is active.
   *
   * OpenRA 对照: EditorCursorLayer.brush
   */
  private brush: IEditorBrush | null = null

  // ---------------------------------------------------------------------------
  // Cursor state (3D visual cursor — TS 专属)
  // ---------------------------------------------------------------------------

  /**
   * The current cursor cell position on the map grid.
   *
   * OpenRA 对照: (无直接对应——笔刷内部管理光标位置。在 3D 中，我们在此管理
   *   光标网格位置，以便所有笔刷共享一个光标四边形。)
   */
  private _cursorPosition: CPos = CPos.Zero

  /**
   * The Babylon.js Plane mesh for the cursor quad.
   * Created lazily on first use; re-positioned each frame.
   */
  private _cursorMesh: Mesh | null = null

  /**
   * The Babylon.js material for the cursor quad.
   */
  private _cursorMaterial: StandardMaterial | null = null

  /**
   * The Babylon.js Scene reference for mesh/material creation.
   * Set via setScene() before the cursor is shown.
   */
  private _scene: Scene | null = null

  /**
   * Current cursor color, controlled by brush mode.
   */
  private _cursorColor: Color3 = CursorColor.Default

  /**
   * Whether the cursor is currently visible.
   */
  private _cursorVisible: boolean = false

  /**
   * Terrain height at the last cursor position update (in cell-height units).
   */
  private _cursorHeight: number = 0

  /**
   * The MapGrid for coordinate conversion.
   */
  private _grid: MapGrid | null = null

  // ---------------------------------------------------------------------------
  // Empty renderable array (避免每帧分配)
  // ---------------------------------------------------------------------------

  /** Empty renderable array for the null-brush case.
   *
   * OpenRA 对照: static readonly IEnumerable<IRenderable> NoRenderables = []
   */
  private static readonly NoRenderables: readonly IRenderable[] = Object.freeze([])

  // ---------------------------------------------------------------------------
  // SetBrush (OpenRA 对照: EditorCursorLayer.SetBrush(IEditorBrush))
  // ---------------------------------------------------------------------------

  /**
   * Swap the active editor brush.
   *
   * OpenRA 对照: EditorCursorLayer.SetBrush(IEditorBrush brush)
   *
   * This is called by EditorViewportControllerWidget when the user selects a
   * different editor tool. The new brush takes over rendering and input handling.
   *
   * @param brush — the new brush, or null to clear
   */
  setBrush(brush: IEditorBrush | null): void {
    this.brush = brush
  }

  /**
   * Get the current active brush, or null.
   */
  getBrush(): IEditorBrush | null {
    return this.brush
  }

  // ---------------------------------------------------------------------------
  // ITickRender (OpenRA 对照: ITickRender.TickRender)
  // ---------------------------------------------------------------------------

  /**
   * Per-tick render update — delegates to the active brush.
   *
   * OpenRA 对照: ITickRender.TickRender(WorldRenderer wr, Actor self)
   *
   * In C# this is an explicit interface implementation. TypeScript cannot do
   * explicit interface implementation, so all trait methods are public.
   *
   * @param wr — world renderer
   * @param self — the world actor this trait is attached to
   */
  tickRender(wr: WorldRendererStub, self: IGameActor): void {
    this.brush?.tickRender(wr, self)
  }

  // ---------------------------------------------------------------------------
  // IRenderAboveShroud (OpenRA 对照: IRenderAboveShroud explicit impl)
  // ---------------------------------------------------------------------------

  /**
   * Render above the shroud layer — delegates to the active brush.
   *
   * OpenRA 对照: IRenderAboveShroud.RenderAboveShroud(Actor self, WorldRenderer wr)
   *
   * Returns the brush's renderables, or an empty array if no brush is active.
   *
   * @param self — the world actor
   * @param wr — world renderer
   * @returns array of renderables (may be empty)
   */
  renderAboveShroud(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[] {
    return this.brush?.renderAboveShroud(self, wr) ?? EditorCursorLayer.NoRenderables
  }

  /**
   * Whether renderables from this source are spatially partitionable.
   *
   * OpenRA 对照: IRenderAboveShroud.SpatiallyPartitionable => false
   *
   * Editor brush renderables are always full-pass — never spatially partitioned.
   */
  get spatiallyPartitionable(): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // IRenderAnnotations (OpenRA 对照: IRenderAnnotations explicit impl)
  // ---------------------------------------------------------------------------

  /**
   * Render annotations (selection boxes, etc.) — delegates to the active brush.
   *
   * OpenRA 对照: IRenderAnnotations.RenderAnnotations(Actor self, WorldRenderer wr)
   *
   * @param self — the world actor
   * @param wr — world renderer
   * @returns array of annotation renderables (may be empty)
   */
  renderAnnotations(self: IGameActor, wr: WorldRendererStub): readonly IRenderable[] {
    return this.brush?.renderAnnotations(self, wr) ?? EditorCursorLayer.NoRenderables
  }

  // ---------------------------------------------------------------------------
  // Cursor position management (TS 专属 3D 光标可视化)
  // ---------------------------------------------------------------------------

  /**
   * Get the current cursor cell position.
   *
   * @returns the current cursor cell coordinates
   */
  getCursor(): CPos {
    return this._cursorPosition
  }

  /**
   * Update the cursor cell position and reposition the visual cursor mesh.
   *
   * This recalculates the 3D world position from the cell position via
   * cellToVector3() and moves the cursor quad.
   *
   * @param cell — the new cursor cell position
   * @param height — terrain height at this cell (in cell-height units)
   */
  setCursor(cell: CPos, height: number = 0): void {
    this._cursorPosition = cell
    this._cursorHeight = height
    this._updateCursorMeshPosition()
  }

  /**
   * Set the cursor color, typically based on the active brush mode.
   *
   * @param color — the new cursor color
   */
  setCursorColor(color: Color3): void {
    this._cursorColor = color
    if (this._cursorMaterial) {
      this._cursorMaterial.diffuseColor = color
    }
  }

  /**
   * Set whether the cursor quad is visible.
   *
   * @param visible — true to show the cursor
   */
  setCursorVisible(visible: boolean): void {
    this._cursorVisible = visible
    if (this._cursorMesh) {
      this._cursorMesh.isVisible = visible
    }
  }

  /**
   * Set the cursor height for 3D positioning.
   *
   * @param height — terrain height in cell-height units
   */
  setCursorHeight(height: number): void {
    this._cursorHeight = height
    this._updateCursorMeshPosition()
  }

  /**
   * Set the scene reference for creating Babylon.js resources.
   *
   * @param scene — the Babylon.js Scene
   */
  setScene(scene: Scene): void {
    this._scene = scene
  }

  /**
   * Set the MapGrid for coordinate conversion.
   *
   * @param grid — the MapGrid configuration
   */
  setGrid(grid: MapGrid): void {
    this._grid = grid
  }

  /**
   * Get the cursor mesh (for external positioning or disposal).
   *
   * @returns the cursor Plane mesh, or null if not yet created
   */
  getCursorMesh(): Mesh | null {
    return this._cursorMesh
  }

  // ---------------------------------------------------------------------------
  // Internal: cursor mesh position update
  // ---------------------------------------------------------------------------

  /**
   * Recalculate and update the 3D position of the cursor mesh.
   *
   * Uses cellToVector3() to convert cell position to a Babylon.js Vector3.
   * The cursor quad is placed at terrain height of the cell with a small
   * Y offset to avoid z-fighting.
   */
  private _updateCursorMeshPosition(): void {
    if (!this._cursorMesh || !this._grid) {
      return
    }
    const pos = cellToVector3(
      this._cursorPosition,
      this._cursorHeight,
      this._grid,
    )
    // Small offset above terrain to avoid z-fighting
    this._cursorMesh.position = new Vector3(pos.x, pos.y + CURSOR_Z_OFFSET, pos.z)
  }

  // ---------------------------------------------------------------------------
  // Lazy creation of cursor mesh (TS 专属)
  // ---------------------------------------------------------------------------

  /**
   * Lazily create or return the cursor Plane mesh.
   *
   * This avoids creating GPU resources until the cursor is actually needed.
   * The mesh is a small semi-transparent quad at the cursor cell position.
   *
   * @returns the cursor mesh
   * @throws Error if scene has not been set via setScene()
   */
  ensureCursorMesh(): Mesh {
    if (this._cursorMesh) {
      return this._cursorMesh
    }

    if (!this._scene) {
      throw new Error('EditorCursorLayer: scene must be set before creating cursor mesh')
    }

    // Create a small quad (1x1 world unit = ~1024 OpenRA units, approx 1 cell)
    const mesh = MeshBuilder.CreatePlane('editorCursorQuad', {
      width: WORLD_SCALE * 1024,
      height: WORLD_SCALE * 1024,
    }, this._scene)

    const material = new StandardMaterial('editorCursorMat', this._scene)
    material.diffuseColor = this._cursorColor
    material.alpha = 0.5
    material.backFaceCulling = false
    // Ensure cursor renders above terrain
    material.alphaMode = Constants.ALPHA_COMBINE

    mesh.material = material
    mesh.isVisible = this._cursorVisible
    mesh.isPickable = false
    // Rotate to be horizontal (XZ plane) since CreatePlane defaults to XY
    mesh.rotation.x = -Math.PI / 2

    this._cursorMaterial = material
    this._cursorMesh = mesh
    this._updateCursorMeshPosition()

    return mesh
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Dispose all Babylon.js resources held by this layer.
   *
   * NOTE: The brush.dispose() is NOT called here — the brush lifecycle
   *   is managed by EditorViewportControllerWidget. This only cleans up
   *   the cursor mesh/material owned by this layer.
   */
  dispose(): void {
    this.brush = null
    if (this._cursorMaterial) {
      this._cursorMaterial.dispose()
      this._cursorMaterial = null
    }
    if (this._cursorMesh) {
      this._cursorMesh.dispose()
      this._cursorMesh = null
    }
    this._scene = null
    this._grid = null
  }
}
