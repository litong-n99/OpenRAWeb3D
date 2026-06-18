/**
 * EditorSelectionAnnotationRenderable.ts — Editor selection box overlay renderer
 * OpenRA 对照: OpenRA.Mods.Common/Graphics/EditorSelectionAnnotationRenderable.cs (79 lines)
 *
 * 核心范式转换:
 * - OpenRA IRenderable + RgbaColorRenderer.DrawLine (screen-space 2D lines)
 *   → Babylon.js LinesMesh (world-space 3D lines at terrain height)
 * - OpenRA per-cell ramp polygon rendering (CPU draw calls)
 *   → Babylon.js bounding-rectangle LinesMesh (GPU line primitives)
 * - OpenRA viewport visibility culling (manual)
 *   → Babylon.js automatic frustum culling
 * - OpenRA Color struct → TypeScript {r,g,b,a} Color interface
 *
 * NOTE: The C# version draws per-cell ramp polygon outlines (for terrain-aware
 * selection visualization). The TypeScript version draws a bounding rectangle
 * at the average terrain height of the selected region.
* Per-cell ramp rendering via GPU instanced-line technique
 *   for faithful terrain-aware selection visualization.
 */

import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import type { Color } from '../../OpenRA.Game/Graphics/PlatformInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Babylon.js types (imported for type annotations — mocked in tests)
// ---------------------------------------------------------------------------

import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'

// ---------------------------------------------------------------------------
// World-space point type (no Babylon.js dependency)
// ---------------------------------------------------------------------------

/** A lightweight 3D point (no Babylon.js Vector3 dependency).
 *
 * Used by computeWorldCorners() so the core logic is unit-testable
 * without mocking @babylonjs/core.
 *
 * @internal — not part of the public editor API; used internally
 *   by computeWorldCorners() and test stubs.
 */
export interface WorldPoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

// ---------------------------------------------------------------------------
// EditorSelectionAnnotationRenderable
// OpenRA 对照: EditorSelectionAnnotationRenderable : IRenderable, IFinalizedRenderable
// ---------------------------------------------------------------------------

/**
 * Renders a semi-transparent colored selection rectangle over the selected
 * cell region in the editor viewport.
 *
 * OpenRA 对照: EditorSelectionAnnotationRenderable
 *
 * In OpenRA this implements IRenderable + IFinalizedRenderable and draws
 * per-cell ramp polygon outlines via RgbaColorRenderer.DrawLine().
 *
 * In Babylon.js, this manages a LinesMesh that outlines the bounding
 * rectangle of the selected region at terrain height. The mesh is created
 * lazily on first render and updated when the selection or color changes.
 */
export class EditorSelectionAnnotationRenderable {
  /** The selected cell region.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.bounds (CellCoordsRegion)
   */
  private _selectionBounds: CellCoordsRegion | null

  /** The selection rectangle color.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.color (Color)
   */
  private _color: Color

  /** Screen-space pixel offset (altitude compensation for isometric views).
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.altPixelOffset (int2)
   *
   * NOTE: This field is vestigial in 3D — the depth buffer handles z-fighting
   * between coplanar geometry. Retained for API compatibility with the OpenRA
   * constructor signature and for potential 2D overlay rendering in the future.
   */
  private _altPixelOffset: { readonly x: number; readonly y: number }

  /** Cell offset applied to all positions.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.offset (CVec)
   */
  private _offset: { readonly x: number; readonly y: number }

  /** The Babylon.js LinesMesh used for rendering.
   * Created lazily and updated when bounds change.
   */
  private _linesMesh: LinesMesh | null = null

  /** Whether this renderable has been disposed. */
  private _disposed: boolean = false

  /** Callback tracking for tests — set by test harness to verify creation. */
  public _onMeshCreated: ((mesh: LinesMesh) => void) | null = null

  /** Callback tracking for tests — set by test harness to verify disposal. */
  public _onDisposed: (() => void) | null = null

  /**
   * Construct an editor selection annotation renderable.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable(CellCoordsRegion, Color, int2, CVec)
   *
   * @param selectionBounds — the selected cell region (may be null for no selection)
   * @param color — the selection rectangle color (RGBA 0-255)
   * @param altPixelOffset — screen-space altitude offset for isometric views
   * @param offset — cell offset applied to all boundaries
   */
  constructor(
    selectionBounds: CellCoordsRegion | null,
    color: Color,
    altPixelOffset?: { readonly x: number; readonly y: number },
    offset?: { readonly x: number; readonly y: number },
  ) {
    this._selectionBounds = selectionBounds
    this._color = { ...color }
    this._altPixelOffset = altPixelOffset ?? { x: 0, y: 0 }
    this._offset = offset ?? { x: 0, y: 0 }
  }

  // -------------------------------------------------------------------------
  // IRenderable interface methods
  // OpenRA 对照: IRenderable members
  // -------------------------------------------------------------------------

  /** World position of this renderable (always WPos.Zero — annotation has
   * no fixed world position; it follows the selection).
   *
   * OpenRA 对照: IRenderable.Pos
   */
  get Pos(): WPos {
    return WPos.Zero
  }

  /** Z-offset for depth sorting (always 0 — annotations render in their
   * own rendering group, so depth sorting is handled by renderingGroupId).
   *
   * OpenRA 对照: IRenderable.ZOffset
   */
  get ZOffset(): number {
    return 0
  }

  /** Whether this renderable is a decoration (always true — selection box
   * is a visual annotation, not gameplay-relevant geometry).
   *
   * OpenRA 对照: IRenderable.IsDecoration
   */
  get IsDecoration(): boolean {
    return true
  }

  /** Return a copy with adjusted Z-offset (no-op — this renderable is
   * a decoration and does not support Z-ordering).
   *
   * OpenRA 对照: IRenderable.WithZOffset(int)
   */
  WithZOffset(_newOffset: number): this {
    return this
  }

  /** Return a copy offset by a world vector (no-op — annotations are
   * not subject to world-space offset).
   *
   * OpenRA 对照: IRenderable.OffsetBy(in WVec)
   */
  OffsetBy(_vec: { readonly x: number; readonly y: number; readonly z: number }): this {
    return this
  }

  /** Return a copy flagged as a decoration (no-op — already a decoration).
   *
   * OpenRA 对照: IRenderable.AsDecoration()
   */
  AsDecoration(): this {
    return this
  }

  // -------------------------------------------------------------------------
  // IFinalizedRenderable interface methods
  // OpenRA 对照: IFinalizedRenderable members
  // -------------------------------------------------------------------------

  /** Prepare for rendering (no-op — this renderable is already finalized
   * at construction time and requires no per-frame preparation).
   *
   * OpenRA 对照: IFinalizedRenderable.PrepareRender(WorldRenderer)
   */
  PrepareRender(_wr: unknown): this {
    return this
  }

  /** Compute screen-space bounding rectangle (always empty — labels do not
   * participate in mouse hit-testing in 2D screen space; 3D selection uses
   * Babylon.js scene.pick() raycasting).
   *
   * OpenRA 对照: IFinalizedRenderable.ScreenBounds(WorldRenderer)
   */
  ScreenBounds(_wr: unknown): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  /** Render debug geometry overlay (no-op — debug visualization not needed
   * for the selection box; it is already the debug visualization).
   *
   * OpenRA 对照: IFinalizedRenderable.RenderDebugGeometry(WorldRenderer)
   */
  RenderDebugGeometry(_wr: unknown): void {
    // no-op
  }

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  /** The selected cell region.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.bounds
   */
  get selectionBounds(): CellCoordsRegion | null {
    return this._selectionBounds
  }

  set selectionBounds(bounds: CellCoordsRegion | null) {
    if (this._disposed) return
    this._selectionBounds = bounds
    this._invalidateMesh()
  }

  /** The selection rectangle color.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.color
   */
  get color(): Color {
    return { ...this._color }
  }

  set color(c: Color) {
    if (this._disposed) return
    this._color = { ...c }
    // Mutate existing Color3 properties on the mesh (avoids needing to
    // construct a new Color3 instance, which would require a Babylon.js import)
    if (this._linesMesh) {
      const meshColor = this._linesMesh.color
      meshColor.r = c.r / 255
      meshColor.g = c.g / 255
      meshColor.b = c.b / 255
      this._linesMesh.alpha = c.a / 255
    }
  }

  /** Screen-space pixel offset for altitude compensation.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.altPixelOffset
   */
  get altPixelOffset(): { readonly x: number; readonly y: number } {
    return this._altPixelOffset
  }

  /** Cell offset applied to boundary calculations.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.offset
   */
  get offset(): { readonly x: number; readonly y: number } {
    return this._offset
  }

  /** Whether this renderable has been disposed. */
  get disposed(): boolean {
    return this._disposed
  }

  /** The Babylon.js LinesMesh (null if not yet created or disposed).
   *
   * NOTE: Exposed for test verification only.
   */
  get linesMesh(): LinesMesh | null {
    return this._linesMesh
  }

  // -------------------------------------------------------------------------
  // Shared corner cell computation
  // OpenRA 对照: (extracted from duplicated code in computeWorldCorners
  //   and createOrUpdateMesh — MAJOR-3 review fix)
  // -------------------------------------------------------------------------

  /**
   * Compute the four corner cell positions of the selection bounding rectangle.
   *
   * The rectangle is the selection bounds extended outward by 1 cell for visual
   * clarity, with the cell offset applied. Returns [topLeft, topRight,
   * bottomRight, bottomLeft] in that order.
   *
   * @returns array of 4 CPos corner cells, or null if no selection
   */
  private _computeCornerCells(): CPos[] | null {
    if (!this._selectionBounds) return null

    const topLeft = this._selectionBounds.TopLeft
    const bottomRight = this._selectionBounds.BottomRight
    const ox = this._offset.x
    const oy = this._offset.y

    return [
      new CPos(topLeft.X + ox - 1, topLeft.Y + oy - 1),       // top-left
      new CPos(bottomRight.X + ox + 1, topLeft.Y + oy - 1),   // top-right
      new CPos(bottomRight.X + ox + 1, bottomRight.Y + oy + 1), // bottom-right
      new CPos(topLeft.X + ox - 1, bottomRight.Y + oy + 1),   // bottom-left
    ]
  }

  // -------------------------------------------------------------------------
  // World-space vertex computation (pure function — no Babylon.js dependency)
  // -------------------------------------------------------------------------

  /**
   * Compute the world-space corner vertices of the selection bounding rectangle.
   *
   * Uses a cell-to-world conversion function to map cell coordinates to
   * WorldPoint positions. The rectangle is computed from the selection bounds'
   * TopLeft and BottomRight corners, extended outward by 1 cell for visual
   * clarity.
   *
   * @param cellToWorld — function mapping CPos and height to a WorldPoint
   *   (typically CoordinateTransformer.cellToVector3 or a test stub)
   * @param _tileScale — the map tile scale in world units (default 1024).
   *   Reserved for future terrain-height-aware selection.
   * @returns array of 4 corner WorldPoint positions (top-left, top-right,
   *   bottom-right, bottom-left), plus a copy of top-left for closing the
   *   loop (5 points total). Returns null if there is no selection.
   */
  computeWorldCorners(
    cellToWorld: (cpos: CPos, height: number) => WorldPoint,
    _tileScale: number = 1024,
  ): WorldPoint[] | null {
    const cornerCells = this._computeCornerCells()
    if (!cornerCells) return null

    // All corners share the same terrain height (0 by default; caller
    // can inject a height-aware conversion function).
    const height = 0

    return [
      cellToWorld(cornerCells[0]!, height),
      cellToWorld(cornerCells[1]!, height),
      cellToWorld(cornerCells[2]!, height),
      cellToWorld(cornerCells[3]!, height),
      cellToWorld(cornerCells[0]!, height), // Close the loop (5th point)
    ]
  }

  // -------------------------------------------------------------------------
  // Babylon.js mesh management (WebGL-dependent — not unit-testable)
  // -------------------------------------------------------------------------

  /**
   * Create or update the LinesMesh for rendering.
   *
   * Must be called with a valid Babylon.js Scene and a MeshBuilder factory
   * function. In production, pass `BABYLON.MeshBuilder.CreateLines`. In unit
   * tests, this method should NOT be called (only computeWorldCorners() is
   * tested).
   *
   * @param scene — the Babylon.js scene to add the mesh to
   * @param cellToWorld — cell-to-Babylon.js-Vector3 conversion function
   *   (typically CoordinateTransformer.cellToVector3)
   * @param createLines — factory to create a LinesMesh
   *   (typically BABYLON.MeshBuilder.CreateLines)
   * @param _tileScale — map tile scale in world units (reserved)
   */
  createOrUpdateMesh(
    scene: Scene,
    cellToWorld: (cpos: CPos, height: number) => import('@babylonjs/core/Maths/math.vector').Vector3,
    createLines: (
      name: string,
      options: { points: import('@babylonjs/core/Maths/math.vector').Vector3[] },
      scene: Scene,
    ) => LinesMesh,
    _tileScale: number = 1024,
  ): void {
    if (this._disposed) return

    // Dispose existing mesh if present
    if (this._linesMesh) {
      this._linesMesh.dispose()
      this._linesMesh = null
    }

    const cornerCells = this._computeCornerCells()
    if (!cornerCells) return

    // Convert corner cells to Vector3 positions
    const height = 0
    const points = [
      cellToWorld(cornerCells[0]!, height),
      cellToWorld(cornerCells[1]!, height),
      cellToWorld(cornerCells[2]!, height),
      cellToWorld(cornerCells[3]!, height),
      cellToWorld(cornerCells[0]!, height), // Close the loop
    ]

    // Create rectangular lines mesh
    this._linesMesh = createLines(
      'editorSelectionBox',
      { points },
      scene,
    )

    // Set color and rendering properties
    if (this._linesMesh) {
      // Mutate the existing Color3 instance (no need to construct a new one)
      const meshColor = this._linesMesh.color
      meshColor.r = this._color.r / 255
      meshColor.g = this._color.g / 255
      meshColor.b = this._color.b / 255
      this._linesMesh.alpha = this._color.a / 255
      this._linesMesh.isPickable = false
      this._linesMesh.renderingGroupId = 3 // Above annotations layer

      if (this._onMeshCreated) {
        this._onMeshCreated(this._linesMesh)
      }
    }
  }

  /**
   * Render the selection box. This is a compatibility method for the
   * OpenRA IRenderable pattern. In Babylon.js, rendering is automatic —
   * the LinesMesh is already in the scene graph.
   *
   * OpenRA 对照: EditorSelectionAnnotationRenderable.Render(WorldRenderer)
   *
   * @param _wr — world renderer (unused in Babylon.js — mesh auto-renders)
   */
  render(_wr: unknown): void {
    // NOTE: In Babylon.js, the LinesMesh auto-renders as part of the scene.
    // This method exists for API compatibility with OpenRA's IRenderable.
    // If the mesh hasn't been created yet, it will be created lazily on
    // the next call to createOrUpdateMesh().
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /**
   * Dispose this renderable, cleaning up all GPU resources.
   *
   * OpenRA 对照: (no explicit Dispose on IRenderable; IDisposable on traits)
   */
  dispose(): void {
    if (this._disposed) return

    if (this._linesMesh) {
      this._linesMesh.dispose()
      this._linesMesh = null
    }

    if (this._onDisposed) {
      this._onDisposed()
    }

    this._disposed = true
    this._selectionBounds = null
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Mark the current LinesMesh as stale. The next call to createOrUpdateMesh()
   * will dispose the old mesh and create a new one.
   */
  private _invalidateMesh(): void {
    if (this._linesMesh) {
      this._linesMesh.dispose()
      this._linesMesh = null
    }
  }
}

export default EditorSelectionAnnotationRenderable
