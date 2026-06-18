/**
 * EditorTileBrush.ts — Template-based terrain tile painting brush
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.cs (383 lines C#)
 *
 * 核心范式转换:
 * - C# ITemplatedTerrainInfo + ITiledTerrainRenderer → stub interfaces (TerrainStubs.ts)
 *   (TODO-21.B.2-DEFER-1: full terrain system not migrated)
 * - C# CellLayer<bool> visited tracking → Uint8Array for efficient flood fill
 * - C# Queue<CPos> → Array<CPos> (push/shift matches C# Enqueue/Dequeue)
 * - C# Game.CosmeticRandom → Math.random() (TODO-21.B.1-DEFER-3)
 * - C# FluentProvider.GetMessage → template literals (TODO-21.B.2-DEFER-7)
 * - C# yield break / yield return → empty array / readonly IRenderable[]
 * - C# explicit interface implementation (IEditorBrush.TickRender) → public method
 *
 * EditorTileBrush paints terrain template tiles onto the map. Supports:
 * - Single-click paint: places template at clicked cell
 * - Drag paint: continuous painting while mouse moves
 * - Shift+click flood fill: replaces all connected tiles of the same type
 * - Duplicate avoidance: skips re-painting cells already using the template
 *
 * Migration: TODO-21.B.3 — Chapter 21 Phase B Wave 2
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { MouseInputEvent, MouseButton, Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import type {
  IGameActor,
  IRenderable,
  WorldRendererStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEditorBrush } from '../Editor/IEditorBrush.js'
import type { EditorActionManager, IEditorAction } from '../Traits/World/EditorActionManager.js'
import type { EditorViewportControllerWidget } from '../Widgets/EditorViewportControllerWidget.js'
import type { UndoTile } from './types.js'
import type {
  TerrainTemplateInfoStub,
  ITemplatedTerrainInfoStub,
  ITiledTerrainRendererStub,
  EditorMapStub,
} from './TerrainStubs.js'

// ---------------------------------------------------------------------------
// Clamp utility
// ---------------------------------------------------------------------------

/** Clamp a value between min and max inclusive.
 *
 * OpenRA 对照: Math.Clamp(value, min, max)
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// EditorTileBrush
// ---------------------------------------------------------------------------

/**
 * Brush for painting terrain template tiles onto the map.
 *
 * OpenRA 对照: EditorTileBrush : IEditorBrush
 *
 * Each template is a multi-cell rectangular block of terrain (e.g., 3x3 cliff).
 * The brush supports single-click placement, drag painting, and shift+click
 * flood fill for contiguous regions.
 */
export class EditorTileBrush implements IEditorBrush {
  /** The terrain template this brush paints.
   *
   * OpenRA 对照: EditorTileBrush.TerrainTemplate (public readonly)
   */
  readonly terrainTemplate: TerrainTemplateInfoStub

  /** The template ID (ushort).
   *
   * OpenRA 对照: EditorTileBrush.Template (public readonly)
   */
  readonly template: number

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** World renderer reference. */
  private readonly worldRenderer: WorldRendererStub

  /** Map reference for terrain manipulation. */
  private readonly map: EditorMapStub

  /** Terrain info (template-based). */
  private readonly terrainInfo: ITemplatedTerrainInfoStub

  /** Editor widget that owns this brush. */
  private readonly editorWidget: EditorViewportControllerWidget

  /** Action manager for undo/redo. */
  private readonly editorActionManager: EditorActionManager

  /** Whether the user is currently painting (left button held down). */
  private painting: boolean = false

  /** Terrain renderer for preview. */
  private readonly terrainRenderer: ITiledTerrainRendererStub

  /** Current cursor cell. */
  private cell: CPos

  /** Preview renderables at the cursor position. */
  private readonly preview: IRenderable[] = []

  // -----------------------------------------------------------------------
  // Construction (OpenRA 对照: EditorTileBrush constructor)
  // -----------------------------------------------------------------------

  /**
   * Create a new EditorTileBrush.
   *
   * OpenRA 对照: EditorTileBrush(EditorViewportControllerWidget, ushort id, WorldRenderer wr)
   *
   * Validates that the terrain is template-based. Resolves the template by ID
   * and creates the initial preview at the current cursor position.
   *
   * @param editorWidget — the editor viewport controller
   * @param id — the template ID to paint
   * @param wr — the world renderer
   * @throws if terrain info is not template-based or template ID not found
   */
  constructor(
    editorWidget: EditorViewportControllerWidget,
    id: number,
    wr: WorldRendererStub,
  ) {
    this.editorWidget = editorWidget
    this.worldRenderer = wr
    this.template = id

    // Resolve terrain info and validate it's template-based
    // NOTE: WorldRendererStub doesn't expose .world directly; use unknown cast
    const wrUnknown = wr as unknown as {
      world: { map: EditorMapStub; worldActor: unknown }
    }
    const world = wrUnknown.world
    this.map = world.map

    const rules = (world.map as unknown as { rules: { terrainInfo: unknown } }).rules
    const ti = rules?.terrainInfo
    if (!ti || typeof ti !== 'object' || !('templates' in ti)) {
      throw new Error(
        'EditorTileBrush can only be used with template-based tilesets',
      )
    }
    this.terrainInfo = ti as ITemplatedTerrainInfoStub

    // Resolve the template
    const tmpl = this.terrainInfo.templates.get(id)
    if (!tmpl) {
      throw new Error(`Template with ID ${id} not found in terrain info`)
    }
    this.terrainTemplate = tmpl

    // Resolve traits from world actor
    const worldActor = world.worldActor as Record<string, unknown>
    this.editorActionManager = worldActor.editorActionManager as EditorActionManager
    this.terrainRenderer = worldActor.terrainRenderer as ITiledTerrainRendererStub

    // Initial cell from last mouse position
    const viewport = (this.worldRenderer as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
      readonly lastMousePos: { readonly x: number; readonly y: number }
    }
    this.cell = viewport.viewToWorld(
      viewport.worldToViewPx(viewport.lastMousePos),
    )
    this.updatePreview()
  }

  // -----------------------------------------------------------------------
  // IEditorBrush.handleMouseInput
  // OpenRA 对照: EditorTileBrush.HandleMouseInput(MouseInput mi)
  // -----------------------------------------------------------------------

  /**
   * Handle mouse input for tile painting.
   *
   * OpenRA 对照: IEditorBrush.HandleMouseInput(MouseInput mi)
   *
   * Left button: start/stop/continue painting (single cells or drag).
   * Shift+Left: trigger flood fill at the current cell.
   * Right button up: clear the brush.
   *
   * @param mi — the mouse input event
   * @returns true if the brush consumed the event
   */
  handleMouseInput(mi: unknown): boolean {
    const miTyped = mi as MouseInput

    // Exclusively uses left and right mouse buttons
    if (miTyped.button !== MouseButton.Left && miTyped.button !== MouseButton.Right) {
      return false
    }

    if (miTyped.button === MouseButton.Right) {
      if (miTyped.event === MouseInputEvent.Up) {
        this.editorWidget.clearBrush()
        return true
      }
      return false
    }

    if (miTyped.button === MouseButton.Left) {
      if (miTyped.event === MouseInputEvent.Down) {
        this.painting = true
      } else if (miTyped.event === MouseInputEvent.Up) {
        this.painting = false
      }
    }

    if (!this.painting) {
      return true
    }

    if (miTyped.event !== MouseInputEvent.Down && miTyped.event !== MouseInputEvent.Move) {
      return true
    }

    const viewport = (this.worldRenderer as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
    }
    const cell = viewport.viewToWorld(miTyped.location)
    const isMoving = miTyped.event === MouseInputEvent.Move

    if ((miTyped.modifiers & Modifiers.Shift) !== 0) {
      this.floodFillWithBrush(cell)
      this.painting = false
    } else {
      this.paintCell(cell, isMoving)
    }

    return true
  }

  // -----------------------------------------------------------------------
  // paintCell (OpenRA 对照: EditorTileBrush.PaintCell)
  // -----------------------------------------------------------------------

  /**
   * Paint a single template placement at the given cell.
   *
   * OpenRA 对照: EditorTileBrush.PaintCell(CPos cell, bool isMoving)
   *
   * If isMoving and the placement would overlap the same template at the
   * same cell (duplicate avoidance), the paint is skipped.
   *
   * @param cell — the cell to paint the template at
   * @param isMoving — whether this is a drag move (for duplicate avoidance)
   */
  private paintCell(cell: CPos, isMoving: boolean): void {
    const template = this.terrainInfo.templates.get(this.template)
    if (!template) return

    if (isMoving && this.placementOverlapsSameTemplate(template, cell)) {
      return
    }

    this.editorActionManager.Add(
      new PaintTileEditorAction(this.template, this.map, cell),
    )
  }

  // -----------------------------------------------------------------------
  // floodFillWithBrush (OpenRA 对照: EditorTileBrush.FloodFillWithBrush)
  // -----------------------------------------------------------------------

  /**
   * Flood fill a contiguous region with the current template.
   *
   * OpenRA 对照: EditorTileBrush.FloodFillWithBrush(CPos cell)
   *
   * Guard checks: cell must be within the map, and the existing tile type
   * must differ from the template (to avoid replacing with the same type).
   *
   * @param cell — the starting cell for flood fill
   */
  private floodFillWithBrush(cell: CPos): void {
    if (!this.map.contains(cell)) return

    const mapTiles = this.map.tiles
    const replace = mapTiles.get(cell)

    if (replace.type === this.template) return

    this.editorActionManager.Add(
      new FloodFillEditorAction(this.template, this.map, cell),
    )
  }

  // -----------------------------------------------------------------------
  // placementOverlapsSameTemplate
  // OpenRA 对照: EditorTileBrush.PlacementOverlapsSameTemplate
  // -----------------------------------------------------------------------

  /**
   * Check if placing the template at the given cell would overlap any
   * cells that already have the same template type.
   *
   * OpenRA 对照: EditorTileBrush.PlacementOverlapsSameTemplate(
   *   TerrainTemplateInfo template, CPos cell)
   *
   * This prevents inefficiency during drag painting by skipping placements
   * that would only overwrite cells already using the identical template.
   *
   * @param template — the terrain template being placed
   * @param cell — the top-left cell where the template would be placed
   * @returns true if at least one cell in the footprint already has this template type
   */
  private placementOverlapsSameTemplate(
    template: TerrainTemplateInfoStub,
    cell: CPos,
  ): boolean {
    const mapTiles = this.map.tiles
    let i = 0
    for (let y = 0; y < template.size.y; y++) {
      for (let x = 0; x < template.size.x; x++, i++) {
        if (template.contains(i) && template.tileAt(i) !== null) {
          const c = CPos.add(cell, new CVec(x, y))
          if (mapTiles.contains(c) && mapTiles.get(c).type === template.id) {
            return true
          }
        }
      }
    }
    return false
  }

  // -----------------------------------------------------------------------
  // updatePreview (OpenRA 对照: EditorTileBrush.UpdatePreview)
  // -----------------------------------------------------------------------

  /**
   * Regenerate the preview renderables for the current cursor cell.
   *
   * OpenRA 对照: EditorTileBrush.UpdatePreview()
   *
   * Clears the preview list and refills it with the terrain renderer's
   * RenderPreview output for the current template at the cell's world position.
   */
  private updatePreview(): void {
    const pos = this.map.centerOfCell(this.cell)

    this.preview.length = 0
    const items = this.terrainRenderer.renderPreview(
      this.worldRenderer,
      this.terrainTemplate,
      pos,
    )
    for (const item of items) {
      this.preview.push(item)
    }
  }

  // -----------------------------------------------------------------------
  // IEditorBrush interface implementation
  // -----------------------------------------------------------------------

  /**
   * Per-tick render update — updates preview when the cursor cell changes.
   *
   * OpenRA 对照: IEditorBrush.TickRender(WorldRenderer wr, Actor self)
   */
  tickRender(wr: WorldRendererStub, _self: IGameActor): void {
    const viewport = (wr as Record<string, unknown>).viewport as {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number }
      readonly lastMousePos: { readonly x: number; readonly y: number }
    }
    const currentCell = viewport.viewToWorld(
      viewport.worldToViewPx(viewport.lastMousePos),
    )
    if (this.cell.Bits !== currentCell.Bits) {
      this.cell = currentCell
      this.updatePreview()
    }
  }

  /**
   * Renders above the shroud (preview visible even with fog of war).
   *
   * OpenRA 对照: IEditorBrush.RenderAboveShroud(Actor self, WorldRenderer wr)
   *
   * @returns the preview renderables
   */
  renderAboveShroud(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return this.preview
  }

  /**
   * Renders annotations — always returns empty for tile brush.
   *
   * OpenRA 对照: IEditorBrush.RenderAnnotations(Actor self, WorldRenderer wr)
   *
   * @returns empty array (yield break in C#)
   */
  renderAnnotations(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    return []
  }

  /**
   * Per-tick logic update — no-op for tile brush.
   *
   * OpenRA 对照: EditorTileBrush.Tick()
   */
  tick(): void {
    // No-op
  }

  /**
   * Dispose of brush resources.
   *
   * OpenRA 对照: EditorTileBrush.Dispose()
   */
  dispose(): void {
    this.preview.length = 0
  }
}

// ---------------------------------------------------------------------------
// PaintTileEditorAction
// OpenRA 对照: sealed class PaintTileEditorAction : IEditorAction
// ---------------------------------------------------------------------------

/**
 * Paints a single terrain template placement onto the map.
 *
 * OpenRA 对照: PaintTileEditorAction (inner class in EditorTileBrush.cs)
 *
 * Iterates the template grid (size.X x size.Y), setting each contained
 * tile's terrain tile and height. Stores undo data (original tiles/heights)
 * in a queue for restoration on undo.
 *
 * Supports PickAny mode: randomly selects tile variants using Math.random().
 */
export class PaintTileEditorAction implements IEditorAction {
  /** Human-readable action description.
   *
   * OpenRA 对照: PaintTileEditorAction.Text
   */
  readonly text: string

  private readonly template: number
  private readonly map: EditorMapStub
  private readonly cell: CPos

  /** Queue of undo tiles (FIFO, matching C# Queue<UndoTile> semantics). */
  private readonly undoTiles: UndoTile[] = []

  /** The terrain template info. */
  private readonly terrainTemplate: TerrainTemplateInfoStub

  /**
   * Create a new PaintTileEditorAction.
   *
   * OpenRA 对照: PaintTileEditorAction(ushort template, Map map, CPos cell)
   *
   * @param template — the template ID to paint
   * @param map — the map to paint onto
   * @param cell — the top-left cell where the template is placed
   */
  constructor(template: number, map: EditorMapStub, cell: CPos) {
    this.template = template
    this.map = map
    this.cell = cell

    // Resolve terrain template info
    const rules = (map as unknown as { rules: { terrainInfo: ITemplatedTerrainInfoStub } }).rules
    const terrainInfo = rules.terrainInfo
    const tmpl = terrainInfo.templates.get(template)
    if (!tmpl) {
      throw new Error(`Template with ID ${template} not found`)
    }
    this.terrainTemplate = tmpl

    // NOTE: C# uses FluentProvider.GetMessage(AddedTile, "id", t.Id)
    // FluentProvider is not yet migrated. Use template literal.
    this.text = `Added tile template: ${this.terrainTemplate.id}`
  }

  /**
   * Execute the action (first-time paint).
   *
   * OpenRA 对照: PaintTileEditorAction.Execute() → calls Do()
   */
  execute(): void {
    this.redo()
  }

  /**
   * Apply (or re-apply) the paint operation.
   *
   * OpenRA 对照: PaintTileEditorAction.Do()
   *
   * Iterates the template grid, stores undo tiles, and sets new terrain
   * tiles and heights for all contained, non-null cells.
   */
  redo(): void {
    const mapTiles = this.map.tiles
    const mapHeight = this.map.height
    const baseHeight = mapHeight.contains(this.cell) ? mapHeight.get(this.cell) : 0

    let i = 0
    for (let y = 0; y < this.terrainTemplate.size.y; y++) {
      for (let x = 0; x < this.terrainTemplate.size.x; x++, i++) {
        if (
          !this.terrainTemplate.contains(i) ||
          this.terrainTemplate.tileAt(i) === null
        ) {
          continue
        }

        const tileInfo = this.terrainTemplate.tileAt(i)!
        const index = this.terrainTemplate.pickAny
          ? Math.floor(Math.random() * this.terrainTemplate.tilesCount)
          : i

        const c = CPos.add(this.cell, new CVec(x, y))
        if (!mapTiles.contains(c)) continue

        // Store undo data
        this.undoTiles.push({
          cell: c,
          mapTile: { type: mapTiles.get(c).type, index: mapTiles.get(c).index },
          height: mapHeight.get(c),
        })

        // Apply new tile
        mapTiles.set(c, { type: this.template, index })
        mapHeight.set(
          c,
          clamp(
            baseHeight + tileInfo.height,
            0,
            this.map.grid.maximumTerrainHeight,
          ),
        )
      }
    }
  }

  /**
   * Undo the paint operation — restores original tiles and heights in FIFO order.
   *
   * OpenRA 对照: PaintTileEditorAction.Undo()
   */
  undo(): void {
    const mapTiles = this.map.tiles
    const mapHeight = this.map.height

    while (this.undoTiles.length > 0) {
      const undoTile = this.undoTiles.shift()!
      mapTiles.set(undoTile.cell, undoTile.mapTile)
      mapHeight.set(undoTile.cell, undoTile.height)
    }
  }
}

// ---------------------------------------------------------------------------
// FloodFillEditorAction
// OpenRA 对照: sealed class FloodFillEditorAction : IEditorAction
// ---------------------------------------------------------------------------

/**
 * Flood fill a contiguous region of same-type terrain tiles with the brush
 * template.
 *
 * OpenRA 对照: FloodFillEditorAction (inner class in EditorTileBrush.cs)
 *
 * Uses a BFS algorithm with a Uint8Array visited tracker (replacing C# CellLayer<bool>).
 * The algorithm scans horizontally to find the left and right extent of
 * matching cells at each BFS step, then paints the whole horizontal span
 * and enqueues vertical neighbors for further expansion.
 *
 * PERF: Uint8Array replaces C# CellLayer<bool> for efficient memory usage.
 * The CellLayer in C# allocates one bool per cell; Uint8Array similarly uses
 * one byte per cell but with much less overhead.
 */
export class FloodFillEditorAction implements IEditorAction {
  /** Human-readable action description.
   *
   * OpenRA 对照: FloodFillEditorAction.Text
   */
  readonly text: string

  private readonly template: number
  private readonly map: EditorMapStub
  private readonly cell: CPos

  /** Queue of undo tiles (FIFO). */
  private readonly undoTiles: UndoTile[] = []

  /** The terrain template info. */
  private readonly terrainTemplate: TerrainTemplateInfoStub

  /** Grid dimensions for visited tracking. */
  private readonly gridWidth: number
  private readonly gridHeight: number

  /**
   * Create a new FloodFillEditorAction.
   *
   * OpenRA 对照: FloodFillEditorAction(ushort template, Map map, CPos cell)
   *
   * @param template — the template ID to flood fill with
   * @param map — the map to operate on
   * @param cell — the starting cell for flood fill
   */
  constructor(template: number, map: EditorMapStub, cell: CPos) {
    this.template = template
    this.map = map
    this.cell = cell

    // Resolve terrain template info
    const rules = (map as unknown as { rules: { terrainInfo: ITemplatedTerrainInfoStub } }).rules
    const terrainInfo = rules.terrainInfo
    const tmpl = terrainInfo.templates.get(template)
    if (!tmpl) {
      throw new Error(`Template with ID ${template} not found`)
    }
    this.terrainTemplate = tmpl

    // Map dimensions for visited array (estimate from allCells if available)
    const mapExt = map as unknown as {
      allCells?: CPos[]
    }
    if (mapExt.allCells?.length) {
      let maxX = 0
      let maxY = 0
      for (const c of mapExt.allCells) {
        if (c.X > maxX) maxX = c.X
        if (c.Y > maxY) maxY = c.Y
      }
      this.gridWidth = maxX + 1
      this.gridHeight = maxY + 1
    } else {
      this.gridWidth = 256
      this.gridHeight = 256
    }

    // NOTE: C# uses FluentProvider.GetMessage(FilledTile, "id", t.Id)
    this.text = `Flood filled tile: ${this.terrainTemplate.id}`
  }

  /**
   * Execute the action (first-time fill).
   *
   * OpenRA 对照: FloodFillEditorAction.Execute()
   */
  execute(): void {
    this.redo()
  }

  /**
   * Apply the flood fill. Uses BFS with horizontal span scanning.
   *
   * OpenRA 对照: FloodFillEditorAction.Do()
   */
  redo(): void {
    const mapTiles = this.map.tiles
    const replace = mapTiles.get(this.cell)

    // Uint8Array as a boolean visited tracker (0 = untouched, 1 = visited)
    const touched = new Uint8Array(this.gridWidth * this.gridHeight)
    const getIndex = (c: CPos): number => c.Y * this.gridWidth + c.X

    // BFS queue
    const queue: CPos[] = []

    // Helper: enqueue a cell if within bounds and not yet visited
    const maybeEnqueue = (newCell: CPos): void => {
      if (this.map.contains(newCell) && touched[getIndex(newCell)] === 0) {
        queue.push(newCell)
        touched[getIndex(newCell)] = 1
      }
    }

    // Helper: check if all cells in template footprint at cellToCheck match the replace type
    const shouldPaint = (cellToCheck: CPos): boolean => {
      for (let y = 0; y < this.terrainTemplate.size.y; y++) {
        for (let x = 0; x < this.terrainTemplate.size.x; x++) {
          const c = CPos.add(cellToCheck, new CVec(x, y))
          if (!this.map.contains(c) || mapTiles.get(c).type !== replace.type) {
            return false
          }
        }
      }
      return true
    }

    // Helper: scan left/right along X to find the extent of contiguous matching cells
    const findEdge = (refCell: CPos, direction: CVec): CPos => {
      let current = refCell
      while (true) {
        const newCell = CPos.add(current, direction)
        if (!shouldPaint(newCell)) return current
        current = newCell
      }
    }

    // Helper: paint a single cell's template footprint
    const paintSingleCell = (cellToPaint: CPos): void => {
      const baseHeight = this.map.height.contains(cellToPaint)
        ? this.map.height.get(cellToPaint)
        : 0

      let i = 0
      for (let y = 0; y < this.terrainTemplate.size.y; y++) {
        for (let x = 0; x < this.terrainTemplate.size.x; x++, i++) {
          if (
            !this.terrainTemplate.contains(i) ||
            this.terrainTemplate.tileAt(i) === null
          ) {
            continue
          }

          const tileInfo = this.terrainTemplate.tileAt(i)!
          const index = this.terrainTemplate.pickAny
            ? Math.floor(Math.random() * this.terrainTemplate.tilesCount)
            : i

          const c = CPos.add(cellToPaint, new CVec(x, y))
          if (!mapTiles.contains(c)) continue

          this.undoTiles.push({
            cell: c,
            mapTile: { type: mapTiles.get(c).type, index: mapTiles.get(c).index },
            height: this.map.height.get(c),
          })

          mapTiles.set(c, { type: this.template, index })
          this.map.height.set(
            c,
            clamp(
              baseHeight + tileInfo.height,
              0,
              this.map.grid.maximumTerrainHeight,
            ),
          )
        }
      }
    }

    // Start BFS
    queue.push(this.cell)
    touched[getIndex(this.cell)] = 1

    while (queue.length > 0) {
      const queuedCell = queue.shift()!
      if (!shouldPaint(queuedCell)) continue

      const previousCell = findEdge(
        queuedCell,
        new CVec(-1 * this.terrainTemplate.size.x, 0),
      )
      const nextCell = findEdge(
        queuedCell,
        new CVec(1 * this.terrainTemplate.size.x, 0),
      )

      for (let x = previousCell.X; x <= nextCell.X; x += this.terrainTemplate.size.x) {
        paintSingleCell(new CPos(x, queuedCell.Y))

        const upperCell = new CPos(
          x,
          queuedCell.Y - 1 * this.terrainTemplate.size.y,
        )
        const lowerCell = new CPos(
          x,
          queuedCell.Y + 1 * this.terrainTemplate.size.y,
        )

        if (shouldPaint(upperCell)) maybeEnqueue(upperCell)
        if (shouldPaint(lowerCell)) maybeEnqueue(lowerCell)
      }
    }
  }

  /**
   * Undo the flood fill — restores all original tiles and heights.
   *
   * OpenRA 对照: FloodFillEditorAction.Undo()
   */
  undo(): void {
    const mapTiles = this.map.tiles
    const mapHeight = this.map.height

    while (this.undoTiles.length > 0) {
      const undoTile = this.undoTiles.shift()!
      mapTiles.set(undoTile.cell, undoTile.mapTile)
      mapHeight.set(undoTile.cell, undoTile.height)
    }
  }
}
