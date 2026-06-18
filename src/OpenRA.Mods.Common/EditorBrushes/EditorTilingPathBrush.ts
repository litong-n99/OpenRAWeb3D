/**
 * EditorTilingPathBrush.ts — Mouse-driven path planning brush for tiling paths (roads, rivers)
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.cs (380 lines C#)
 *
 * 核心范式转换:
 * - C# 12-state mouse interaction matrix → TypeScript state machine with AssessCPos closures
 * - C# CellLayerUtils.WPosToCorner → inline CPos conversion (direct cell coords)
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[]
 * - C# CircleAnnotationRenderable / LineAnnotationRenderable → stubbed annotation objects
 * - C# EditorBlit.PreviewBlitSource → stubbed (TODO-21.B.6-DEFER-1/2/3)
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 *
 * This brush implements a complex mouse interaction state machine for editing
 * tiling path plans. It wraps a TilingPathTool and provides:
 * - Click to start a path
 * - Drag to extend/modify the path
 * - Click on existing points to insert/remove/toggle
 * - Direction handle dragging for start/end direction control
 * - Preview of the tiled path result
 *
 * Migration: TODO-21.B.9 — Chapter 21 Phase B Wave 3
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import {
  MouseInputEvent,
  MouseButton,
} from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../Editor/IEditorBrush.js'
import type { IEditorAction } from '../Traits/World/EditorActionManager.js'
import type { EditorActionManager } from '../Traits/World/EditorActionManager.js'
import { Direction, directionToCVec, closestDirectionFromCVec } from './Direction.js'
import { EditorBlit, type MapBlitData, type EditorActorLayerBlitInterface } from './EditorBlit.js'
import { MapBlitFilters } from './types.js'
import type { EditorActorLayer } from '../Traits/World/EditorActorLayer.js'
import type { IResourceLayer } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PathPlan, type TilingPathTool } from '../Traits/World/TilingPathTool.js'

// ---------------------------------------------------------------------------
// Viewport interface for coordinate transforms
// ---------------------------------------------------------------------------

/** Viewport subset needed by the tiling path brush. */
export interface ITilingPathBrushViewport {
  viewToWorld(viewPos: { readonly x: number; readonly y: number }): CPos
  viewToWorldPx(viewPos: { readonly x: number; readonly y: number }): {
    readonly x: number
    readonly y: number
    readonly z: number
  }
  lastMousePos: { readonly x: number; readonly y: number }
}

/** World renderer subset needed by the brush. */
export interface ITilingPathBrushWorldRenderer {
  readonly viewport: ITilingPathBrushViewport
  readonly world: { readonly map: { readonly grid: { readonly type: number } } }
}

// ---------------------------------------------------------------------------
// Assessment result for a cell position relative to the current plan
// ---------------------------------------------------------------------------

interface CellAssessment {
  isInside: boolean
  isRally: boolean
  rallyIndex: number
  isStartDirector: boolean
  isEndDirector: boolean
}

// ---------------------------------------------------------------------------
// EditorTilingPathBrush
// OpenRA 对照: public sealed class EditorTilingPathBrush : IEditorBrush
// ---------------------------------------------------------------------------

/**
 * Editor brush for planning and visualizing tiling paths.
 *
 * OpenRA 对照: EditorTilingPathBrush
 *
 * Manages a mouse-based path editing state machine with the following behaviors:
 * - First click creates a PathPlan with a single rally
 * - Click on empty space appends a rally
 * - Click on existing rally removes it (first rally toggles loop)
 * - Drag from rally moves/replaces it
 * - Drag from non-rally point moves the entire plan
 * - Drag from start/end director circles changes direction
 */
export class EditorTilingPathBrush implements IEditorBrush {
  private readonly tool: TilingPathTool
  private readonly worldRenderer: ITilingPathBrushWorldRenderer
  private readonly editorActionManager: EditorActionManager

  private startingMouseInput: MouseInput | null = null
  private isDragging = false
  private previewPlan: PathPlan | null = null

  // -------------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: EditorTilingPathBrush(TilingPathTool tool)
  // -------------------------------------------------------------------------

  /**
   * Create a tiling path brush wrapping the given tool.
   *
   * @param tool — the TilingPathTool managing path plan and tiling state
   * @param worldRenderer — the world renderer for viewport transforms
   * @param editorActionManager — the action manager for undo/redo
   */
  constructor(
    tool: TilingPathTool,
    worldRenderer: ITilingPathBrushWorldRenderer,
    editorActionManager: EditorActionManager,
  ) {
    this.tool = tool
    this.worldRenderer = worldRenderer
    this.editorActionManager = editorActionManager
  }

  // -------------------------------------------------------------------------
  // Cell coordinate conversion
  // -------------------------------------------------------------------------

  /**
   * Convert a viewport pixel position to a cell corner CPos.
   *
   * OpenRA 对照: EditorTilingPathBrush.ViewToWorldCorner(int2 xy) — local function
   *
   * In the C# version, this converts through CellLayerUtils.WPosToCorner() with
   * grid type. For Phase B, we simplify: convert view coords to world coords
   * directly via Viewport.ViewToWorld().
   */
  private viewToWorldCorner(xy: { readonly x: number; readonly y: number }): CPos {
    return this.worldRenderer.viewport.viewToWorld(xy)
  }

  // -------------------------------------------------------------------------
  // AssessCPos — evaluate a cell position relative to the current plan
  // OpenRA 对照: AssessCPos(CPos cpos) — local function returning tuple
  // -------------------------------------------------------------------------

  /**
   * Determine how a given cell relates to the current path plan.
   *
   * OpenRA 对照: AssessCPos(CPos cpos) — returns (isInside, isRally, rallyIndex, isStartDirector, isEndDirector)
   */
  private assessCPos(cpos: CPos, plan: PathPlan): CellAssessment {
    const points = plan.pointsWithRallyIndex()
    const pointCPos = points.map((p) => p.cpos)

    const isInside = pointCPos.some((p) => CPos.equals(p, cpos))
    const isRally = plan.rallies.some((r) => CPos.equals(r, cpos))

    let rallyIndex: number
    if (isRally) {
      rallyIndex = plan.rallies.findIndex((r) => CPos.equals(r, cpos))
    } else {
      // Find the rally index for this cell from pointsWithRallyIndex
      const point = points.find((p) => CPos.equals(p.cpos, cpos))
      rallyIndex = point ? point.rallyIndex : 0
    }

    const autoStart = plan.autoStart(this.tool.autoStartDirectionMask)
    const autoEnd = plan.autoEnd(this.tool.autoEndDirectionMask)

    const isStartDirector =
      autoStart !== Direction.None &&
      CPos.equals(
        cpos,
        CPos.subtractVec(plan.firstPoint, directionToCVec(autoStart)),
      )
    const isEndDirector =
      autoEnd !== Direction.None &&
      CPos.equals(cpos, CPos.add(plan.lastPoint, directionToCVec(autoEnd)))

    return { isInside, isRally, rallyIndex, isStartDirector, isEndDirector }
  }

  // -------------------------------------------------------------------------
  // HandleMouseInput — complex state machine
  // OpenRA 对照: EditorTilingPathBrush.HandleMouseInput(MouseInput mouseInput)
  // -------------------------------------------------------------------------

  handleMouseInput(mi: unknown): boolean {
    const mouseInput = mi as MouseInput

    if (mouseInput.button !== MouseButton.Left) {
      return false
    }

    let isFinal = false
    if (mouseInput.event === MouseInputEvent.Down) {
      this.startingMouseInput = mouseInput
      this.isDragging = false
    } else if (this.startingMouseInput !== null) {
      if (mouseInput.event === MouseInputEvent.Up) {
        isFinal = true
      }
    } else {
      return false
    }

    const from = this.viewToWorldCorner(this.startingMouseInput!.location)
    const to = this.viewToWorldCorner(mouseInput.location)

    /**
     * Update the plan (commit to action manager if final, set preview if not).
     */
    const updatePlan = (
      newPlan: PathPlan | null,
      preview: boolean,
    ): void => {
      if (isFinal) {
        this.editorActionManager.Add(
          new UpdateTilingPathPlanEditorAction(this.tool, newPlan),
        )
      } else if (preview) {
        this.previewPlan = newPlan
      }
    }

    if (isFinal) {
      this.previewPlan = null
      this.startingMouseInput = null
    }

    this.isDragging =
      this.isDragging || !CPos.equals(from, to)

    const plan = this.tool.plan
    if (plan === null) {
      // NOTE: PathPlan single-rally constructor is private; use static factory
      updatePlan(PathPlan.createSingle(to), true)
      return true
    }

    const fromAssess = this.assessCPos(from, plan)
    const toAssess = this.assessCPos(to, plan)

    if (this.isDragging) {
      // ---- DRAG logic ----
      if (fromAssess.isStartDirector) {
        const offset = CPos.subtract(plan.firstPoint, to)
        const direction =
          !CVec.equals(offset, CVec.Zero)
            ? closestDirectionFromCVec(offset)
            : Direction.None
        updatePlan(plan.withStart(direction), true)
      } else if (fromAssess.isEndDirector) {
        const offset = CPos.subtract(to, plan.lastPoint)
        const direction =
          !CVec.equals(offset, CVec.Zero)
            ? closestDirectionFromCVec(offset)
            : Direction.None
        updatePlan(plan.withEnd(direction), true)
      } else if (fromAssess.isInside) {
        if (fromAssess.isRally) {
          if (!toAssess.isRally || CPos.equals(to, from)) {
            updatePlan(
              plan.withRallyReplaced(fromAssess.rallyIndex, to),
              true,
            )
          }
        } else {
          const offset = CPos.subtract(to, from)
          updatePlan(plan.moved(offset), true)
        }
      } else {
        if (!toAssess.isRally) {
          updatePlan(plan.withRallyAppended(to), true)
        }
      }
    } else {
      // ---- CLICK logic ----
      if (toAssess.isInside) {
        if (toAssess.isRally) {
          if (toAssess.rallyIndex === 0) {
            updatePlan(plan.withLoop(!plan.loop), false)
          } else {
            updatePlan(plan.withRallyRemoved(toAssess.rallyIndex), false)
          }
        } else {
          updatePlan(
            plan.withRallyInserted(toAssess.rallyIndex, to),
            false,
          )
        }
      } else {
        updatePlan(plan.withRallyAppended(to), true)
      }
    }

    return true
  }

  // -------------------------------------------------------------------------
  // TickRender / RenderAboveShroud / RenderAnnotations / Tick / Dispose
  // -------------------------------------------------------------------------

  tickRender(): void {
    // No per-frame render update needed
  }

  /**
   * Render the tiling path preview as terrain/actor blit preview.
   *
   * OpenRA 对照: RenderAboveShroud — uses EditorBlit.PreviewBlitSource for terrain/actor preview
   */
  renderAboveShroud(): readonly IRenderable[] {
    if (this.tool.editorBlitSource === null) {
      return []
    }

    const stickToGround = this.tool.editorBlitSource.tiles.size === 0
    // TODO-21.B.6-DEFER-1/2/3: Full preview pipeline
    const preview = EditorBlit.previewBlitSource(
      this.tool.editorBlitSource,
      MapBlitFilters.Terrain | MapBlitFilters.Actors,
      CVec.Zero,
      this.worldRenderer,
      stickToGround,
    )
    return preview as readonly IRenderable[]
  }

  /**
   * Render path plan annotations: waypoints, lines, direction indicators.
   *
   * OpenRA 对照: RenderAnnotations — draws circles and lines for the path plan
   */
  renderAnnotations(): readonly IRenderable[] {
    const plan = this.previewPlan ?? this.tool.plan
    if (plan === null) return []

    const mainColor =
      this.tool.editorBlitSource !== null
        ? { r: 0, g: 255, b: 255, a: 255 } // Cyan
        : { r: 255, g: 0, b: 0, a: 255 } // Red

    const renderables: IRenderable[] = []

    // Helper for corner-of-cell position (stubbed — returns CPos as-is)
    const cornerOfCell = (cpos: CPos): CPos => cpos

    // Draw waypoint circles and connecting lines
    const points = plan.points()
    for (let i = 1; i < points.length; i++) {
      // Circle at each waypoint (except first)
      renderables.push({
        center: cornerOfCell(points[i]),
        radius: 128,
        width: 1,
        color: { r: 255, g: 255, b: 0, a: 255 },
        filled: false,
      } as unknown as IRenderable)

      // Line between consecutive waypoints
      renderables.push({
        start: cornerOfCell(points[i - 1]),
        end: cornerOfCell(points[i]),
        width: 1,
        color: { r: 255, g: 255, b: 0, a: 255 },
        endColor: { r: 255, g: 255, b: 0, a: 255 },
      } as unknown as IRenderable)
    }

    // Draw rally circles and connecting lines
    const rallies = plan.rallies
    for (let i = 1; i < rallies.length; i++) {
      renderables.push({
        center: cornerOfCell(rallies[i]),
        radius: 512,
        width: 1,
        color: mainColor,
        filled: false,
      } as unknown as IRenderable)

      renderables.push({
        start: cornerOfCell(rallies[i - 1]),
        end: cornerOfCell(rallies[i]),
        width: 1,
        color: mainColor,
        endColor: mainColor,
      } as unknown as IRenderable)
    }

    // Draw direction indicators
    const autoEnd = plan.autoEnd(this.tool.autoEndDirectionMask)
    if (autoEnd !== Direction.None) {
      const endCVec = directionToCVec(autoEnd)
      const endPos = CPos.add(plan.lastPoint, CVec.multiplyScalar(768, endCVec))
      renderables.push({
        center: cornerOfCell(endPos),
        radius: 256,
        width: 2,
        color:
          plan.end !== Direction.None
            ? { r: 255, g: 0, b: 255, a: 255 } // Magenta
            : { r: 128, g: 128, b: 128, a: 255 }, // Gray
        filled: false,
      } as unknown as IRenderable)
    }

    const autoStart = plan.autoStart(this.tool.autoStartDirectionMask)
    if (autoStart !== Direction.None) {
      const startCVec = directionToCVec(autoStart)
      const startPos = CPos.subtractVec(
        plan.firstPoint,
        CVec.multiplyScalar(768, startCVec),
      )
      renderables.push({
        center: cornerOfCell(startPos),
        radius: 256,
        width: 2,
        color:
          plan.start !== Direction.None
            ? { r: 255, g: 0, b: 255, a: 255 } // Magenta
            : { r: 128, g: 128, b: 128, a: 255 }, // Gray
        filled: true,
      } as unknown as IRenderable)
    }

    // First rally point: filled circle
    renderables.push({
      center: cornerOfCell(rallies[0]),
      radius: 512,
      width: 1,
      color: mainColor,
      filled: true,
    } as unknown as IRenderable)

    return renderables
  }

  tick(): void {
    // No per-frame logic needed
  }

  dispose(): void {
    // No GPU resources to dispose
  }
}

// ---------------------------------------------------------------------------
// UpdateTilingPathPlanEditorAction
// OpenRA 对照: sealed class UpdateTilingPathPlanEditorAction : IEditorAction (lines 283-329)
// ---------------------------------------------------------------------------

/**
 * Undoable action for updating (or creating/removing) a tiling path plan.
 *
 * OpenRA 对照: UpdateTilingPathPlanEditorAction
 */
export class UpdateTilingPathPlanEditorAction implements IEditorAction {
  text: string

  private readonly tool: TilingPathTool
  private readonly oldPlan: PathPlan | null
  private readonly newPlan: PathPlan | null

  /**
   * Create an action to swap the tool's plan.
   *
   * @throws if both oldPlan and newPlan are null
   */
  constructor(tool: TilingPathTool, newPlan: PathPlan | null) {
    this.tool = tool
    this.oldPlan = tool.plan
    this.newPlan = newPlan

    if (this.oldPlan === null && this.newPlan === null) {
      throw new Error('oldPlan and newPlan cannot both be null')
    } else if (this.oldPlan === null) {
      // TODO-21.B.2-DEFER-7: FluentProvider
      this.text = 'Started tiling path'
    } else if (this.newPlan === null) {
      this.text = 'Reset tiling path'
    } else {
      this.text = 'Updated tiling path'
    }
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.tool.setPlan(this.newPlan)
  }

  undo(): void {
    this.tool.setPlan(this.oldPlan)
  }
}

// ---------------------------------------------------------------------------
// PaintTilingPathEditorAction
// OpenRA 对照: sealed class PaintTilingPathEditorAction : IEditorAction (lines 331-379)
// ---------------------------------------------------------------------------

/**
 * Undoable action for painting the tiling path onto the map.
 *
 * OpenRA 对照: PaintTilingPathEditorAction
 */
export class PaintTilingPathEditorAction implements IEditorAction {
  text: string

  private readonly tool: TilingPathTool
  private readonly plan: PathPlan | null
  private readonly editorBlit: EditorBlit | null

  /**
   * Create a paint action for the current tiling path.
   *
   * @param tool — the TilingPathTool
   * @param resourceLayer — resource layer (null for terrain-only)
   * @param editorActorLayer — editor actor layer
   * @param mapData — map data for terrain/height/resource access
   */
  constructor(
    tool: TilingPathTool,
    resourceLayer: IResourceLayer | null,
    editorActorLayer: EditorActorLayer & EditorActorLayerBlitInterface,
    mapData: MapBlitData,
  ) {
    this.tool = tool
    this.plan = tool.plan

    // TODO-21.B.2-DEFER-7: FluentProvider
    this.text = 'Painted tiling path'

    const blitSource = tool.editorBlitSource
    if (blitSource) {
      this.editorBlit = new EditorBlit(
        MapBlitFilters.Terrain | MapBlitFilters.Actors,
        resourceLayer!,
        blitSource.cellCoords.TopLeft,
        mapData,
        blitSource,
        editorActorLayer,
        false, // respectBounds = false for tiling path paint
      )
    } else {
      this.editorBlit = null
    }
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.tool.setPlan(null)
    if (this.editorBlit) {
      this.editorBlit.commit()
    }
  }

  undo(): void {
    if (this.editorBlit) {
      this.editorBlit.revert()
    }
    this.tool.setPlan(this.plan)
  }
}
