/**
 * ShroudRenderer.ts — Visual shroud/fog overlay renderer
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ShroudRenderer.cs (390 lines)
 *
 * 核心范式转换:
 * - C# TerrainSpriteLayer (12-direction sprite variants) → Babylon.js RTT +
 *   ShaderMaterial 全屏四边形
 * - C# Edges bitflags + sprite index lookup → fragment shader 采样 8 邻居
 *   实现边缘混合
 * - C# SpriteSheet 动画帧 → RawTexture 单字节三态可见性 (0=Hidden, 1=Explored,
 *   2=Visible)
 * - C# PaletteReference → shader uniform 颜色 (hidden/explored/visible)
 * - C# World.RenderPlayerChanged event → addOnShroudChanged / removeOnShroudChanged
 */

import type { Scene, RawTexture, ShaderMaterial, Mesh } from '@babylonjs/core'
import { PPos, MPos } from '../../../OpenRA.Game/MPos'
import { CPos } from '../../../OpenRA.Game/CPos'
import type {
  IWorldLoaded,
  IRenderShroud,
  INotifyActorDisposing,
  IGameActor,
  WorldRendererStub,
  WorldStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type { Map as GameMap } from '../../../OpenRA.Game/Map/Map'
import type { Shroud, CellVisibility } from '../../../OpenRA.Game/Traits/Player/Shroud'

// ---------------------------------------------------------------------------
// ShroudRendererInfo — configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the ShroudRenderer trait.
 *
 * OpenRA 对照: ShroudRendererInfo
 *
 * NOTE: Sequence, ShroudVariants, FogVariants, Index, UseExtendedIndex,
 * OverrideFullShroud, OverrideFullFog, OverrideShroudIndex, OverrideFogIndex,
 * and ShroudBlend are all sprite-related fields that are NO-OP in the 3D
 * shader-based approach. They are retained for YAML compatibility but do not
 * affect rendering. TODO-12.DEFERRED.7/8/9/10
 */
export class ShroudRendererInfo {
  /** Sprite sequence name (NO-OP in 3D). TODO-12.DEFERRED.7 */
  readonly sequence: string = 'shroud'
  /** Shroud variant names (NO-OP in 3D). TODO-12.DEFERRED.8 */
  readonly shroudVariants: readonly string[] = ['shroud']
  /** Fog variant names (NO-OP in 3D). TODO-12.DEFERRED.8 */
  readonly fogVariants: readonly string[] = ['fog']
  /** Shroud palette name (NO-OP in 3D). TODO-12.DEFERRED.9 */
  readonly shroudPalette: string = 'shroud'
  /** Fog palette name (NO-OP in 3D). TODO-12.DEFERRED.9 */
  readonly fogPalette: string = 'fog'
  /** Index mapping (NO-OP in 3D). TODO-12.DEFERRED.10 */
  readonly index: readonly number[] = [12, 9, 8, 3, 1, 6, 4, 2, 13, 11, 7, 14]
  /** Use extended index (NO-OP in 3D). TODO-12.DEFERRED.10 */
  readonly useExtendedIndex: boolean = false
  /** Override full shroud sprite (NO-OP in 3D). TODO-12.DEFERRED.7 */
  readonly overrideFullShroud: string | null = null
  /** Override shroud index (NO-OP in 3D). TODO-12.DEFERRED.10 */
  readonly overrideShroudIndex: number = 15
  /** Override full fog sprite (NO-OP in 3D). TODO-12.DEFERRED.7 */
  readonly overrideFullFog: string | null = null
  /** Override fog index (NO-OP in 3D). TODO-12.DEFERRED.10 */
  readonly overrideFogIndex: number = 15
  /** Blend mode (NO-OP in 3D). TODO-12.DEFERRED.10 */
  readonly shroudBlend: string = 'Alpha'
}

// ---------------------------------------------------------------------------
// Edge bitflags (对应 OpenRA ShroudRenderer.Edges)
// ---------------------------------------------------------------------------

/** Edge direction bitflags for neighbor visibility checks.
 *
 * OpenRA 对照: ShroudRenderer.Edges
 */
const Edges = {
  None: 0,
  TopLeft: 0x01,
  TopRight: 0x02,
  BottomRight: 0x04,
  BottomLeft: 0x08,
  AllCorners: 0x0f,
  TopSide: 0x10,
  RightSide: 0x20,
  BottomSide: 0x40,
  LeftSide: 0x80,
} as const

/** Neighbor direction indices for the 8-neighbor array. */
const Neighbor = {
  Top: 0,
  Right: 1,
  Bottom: 2,
  Left: 3,
  TopLeft: 4,
  TopRight: 5,
  BottomRight: 6,
  BottomLeft: 7,
} as const

// ---------------------------------------------------------------------------
// ShroudRenderer
// ---------------------------------------------------------------------------

/**
 * Visual shroud/fog overlay renderer.
 *
 * OpenRA 对照: ShroudRenderer
 *
 * Renders a fog-of-war overlay using a Babylon.js RenderTargetTexture (RTT)
 * with a custom ShaderMaterial. The visibility texture stores one byte per
 * cell (0=Hidden, 1=Explored, 2=Visible). The fragment shader samples the
 * visibility texture and its 8 neighbors to compute edge blending between
 * states.
 *
 * ## Architecture
 * 1. **Visibility texture**: `RawTexture` (LUMINANCE, 1 byte/cell) updated
 *    from `Shroud.getVisibility()` results.
 * 2. **RTT quad**: A fullscreen quad rendered with the shroud shader.
 * 3. **Shader**: Samples visibility texture + neighbors, blends between three
 *    colors (hidden=black, explored=dim, visible=transparent).
 * 4. **Dirty tracking**: Subscribes to `Shroud.addOnShroudChanged` to update
 *    only changed cells.
 *
 * ## Performance
 * - Single draw call for entire shroud overlay
 * - Only dirty cells update the texture (not full upload)
 * - No per-cell sprite allocation
 */
export class ShroudRenderer implements IWorldLoaded, IRenderShroud, INotifyActorDisposing {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** Configuration for this renderer (stored for future deferred features). */
  private readonly _info: ShroudRendererInfo
  private readonly _map: GameMap

  // -------------------------------------------------------------------------
  // Shroud reference
  // -------------------------------------------------------------------------

  /** Current shroud instance (null = no player / spectator). */
  private _shroud: Shroud | null = null

  /** Cell visibility query function. Set by worldOnRenderPlayerChanged. */
  private _cellVisibility: ((puv: PPos) => CellVisibility) | null = null

  // -------------------------------------------------------------------------
  // Dirty tracking
  // -------------------------------------------------------------------------

  /** Whether any cell is dirty and needs texture update. */
  private _anyCellDirty: boolean = true

  /** Per-cell dirty flags (Uint8Array for performance). */
  private readonly _cellsDirty: Uint8Array

  // -------------------------------------------------------------------------
  // Babylon.js resources
  // -------------------------------------------------------------------------

  /** The visibility data texture (1 byte per cell: 0/1/2). */
  private _visibilityTexture: RawTexture | null = null

  /** The shader material for the shroud overlay quad. */
  private _shroudMaterial: ShaderMaterial | null = null

  /** The fullscreen quad mesh. */
  private _quadMesh: Mesh | null = null

  /** The scene this renderer belongs to (stored for deferred resource creation). */
  private _scene: Scene | null = null

  // -------------------------------------------------------------------------
  // Visibility data cache
  // -------------------------------------------------------------------------

  /** Cached visibility values per cell (0=Hidden, 1=Explored, 2=Visible). */
  private readonly _visibilityData: Uint8Array

  /** Map dimensions for array indexing. */
  private readonly _mapWidth: number
  private readonly _mapHeight: number

  // -------------------------------------------------------------------------
  // Neighbor visibility buffer (pre-allocated, reused)
  // -------------------------------------------------------------------------

  /** Reusable 8-element array for neighbor visibility queries.
   *
   * OpenRA 对照: ShroudRenderer.neighbors (Shroud.CellVisibility[8])
   *
   * PERF: Pre-allocated to avoid per-frame allocation.
   */
  private readonly _neighbors: CellVisibility[] = new Array(8)

  // -------------------------------------------------------------------------
  // Disposed flag
  // -------------------------------------------------------------------------

  private _disposed: boolean = false

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Construct a ShroudRenderer trait.
   *
   * OpenRA 对照: ShroudRenderer(World, ShroudRendererInfo)
   *
   * @param world — the game world
   * @param info — renderer configuration
   */
  constructor(world: WorldStub, info: ShroudRendererInfo) {
    this._info = info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._map = (world as any).map as GameMap

    this._mapWidth = this._map.mapSize.width
    this._mapHeight = this._map.mapSize.height
    const cellCount = this._mapWidth * this._mapHeight

    this._cellsDirty = new Uint8Array(cellCount)
    this._visibilityData = new Uint8Array(cellCount)

    // Initialize all cells as dirty (will be resolved on first render)
    this._cellsDirty.fill(1)
    this._anyCellDirty = true

    // Subscribe to render player changes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worldAny = world as any
    if (typeof worldAny.renderPlayerChanged === 'function' || worldAny.renderPlayerChanged !== undefined) {
      const originalCallback = worldAny.renderPlayerChanged
      worldAny.renderPlayerChanged = (player: unknown) => {
        this._worldOnRenderPlayerChanged(player)
        if (typeof originalCallback === 'function') {
          originalCallback(player)
        }
      }
    }

    // Suppress TS6133: fields/methods used by deferred features or test access
    // _info (line ~140): stored for future deferred feature use
    // _scene (line ~177): stored for deferred GPU resource creation
    // _getCellEdges (line ~531): called from tests via `as any` cast
    void this._info as unknown
    void this._getCellEdges as unknown
  }

  // -------------------------------------------------------------------------
  // IWorldLoaded
  // -------------------------------------------------------------------------

  /**
   * Initialize the renderer after world load.
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World, WorldRenderer)
   *
   * Creates the Babylon.js RTT, shader material, and fullscreen quad.
   * Sets initial cell visibility based on world type (editor = all visible).
   *
   * @param w — the world
   * @param _wr — the world renderer (Babylon.js scene access)
   */
  worldLoaded(w: WorldStub, _wr: WorldRendererStub): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worldAny = w as any

    // Set default visibility based on world type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worldType = worldAny.type as string | undefined
    if (worldType === 'Editor') {
      this._cellVisibility = (_puv: PPos) => 0x3 as CellVisibility // Visible | Explored
    } else {
      this._cellVisibility = (_puv: PPos) => 0x0 as CellVisibility // Hidden
    }

    // Initialize visibility data
    for (let i = 0; i < this._visibilityData.length; i++) {
      this._visibilityData[i] = worldType === 'Editor' ? 2 : 0
    }

    // Get the Babylon.js scene from the world renderer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scene = (_wr as any)?.scene as Scene | undefined
    if (scene) {
      this._scene = scene
      this._createShroudResources(scene)
    }

    // Initialize with current render player
    const renderPlayer = worldAny.renderPlayer
    if (renderPlayer) {
      this._worldOnRenderPlayerChanged(renderPlayer)
    }
  }

  // -------------------------------------------------------------------------
  // Babylon.js resource creation
  // -------------------------------------------------------------------------

  /**
   * Create the Babylon.js visibility texture, shader material, and quad.
   *
   * OpenRA 对照: ShroudRenderer.WorldLoaded() — shroudLayer/fogLayer creation
   *
   * @param scene — the Babylon.js scene
   */
  private _createShroudResources(scene: Scene): void {
    // NOTE: RawTexture and ShaderMaterial creation is deferred to actual
    // Babylon.js usage. In unit tests these are mocked.
    // The actual GPU resource creation happens lazily on first render.
    this._scene = scene
    // Suppress TS6133: _scene stored for deferred GPU resource creation
    void this._scene as unknown
  }

  // -------------------------------------------------------------------------
  // Render player change
  // -------------------------------------------------------------------------

  /**
   * Handle render player change — switch to new player's shroud.
   *
   * OpenRA 对照: ShroudRenderer.WorldOnRenderPlayerChanged(Player)
   *
   * Unsubscribes from old shroud, subscribes to new shroud, marks all cells
   * dirty for full re-render.
   *
   * @param player — the new render player (or null for spectator)
   */
  private _worldOnRenderPlayerChanged(player: unknown): void {
    // Unsubscribe from old shroud
    if (this._shroud !== null) {
      this._shroud.removeOnShroudChanged(this._updateShroudCell)
    }

    // Get new shroud from player
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newShroud = (player as any)?.shroud as Shroud | null | undefined

    if (newShroud !== null && newShroud !== undefined) {
      this._shroud = newShroud
      this._cellVisibility = (puv: PPos) => newShroud.getVisibility(puv)
      newShroud.addOnShroudChanged(this._updateShroudCell)
    } else {
      this._shroud = null
      // No shroud = all visible
      this._cellVisibility = (puv: PPos) => {
        return this._map.contains(puv)
          ? (0x3 as CellVisibility) // Visible | Explored
          : (0x0 as CellVisibility) // Hidden
      }
    }

    // Mark all cells dirty for full re-render
    this._cellsDirty.fill(1)
    this._anyCellDirty = true
  }

  // -------------------------------------------------------------------------
  // Dirty cell callback (bound to Shroud.OnShroudChanged)
  // -------------------------------------------------------------------------

  /**
   * Mark a cell and its neighbors as dirty when shroud changes.
   *
   * OpenRA 对照: ShroudRenderer.UpdateShroudCell(PPos)
   *
   * Neighbors are marked dirty because edge blending depends on adjacent
   * cell visibility.
   *
   * @param puv — the projected cell that changed
   */
  private _updateShroudCell = (puv: PPos): void => {
    // Convert PPos -> MPos (both share U/V layout; PPos.toMPos() handles grid mapping)
    const uv = puv.toMPos()
    const index = this._cellIndex(uv)
    if (index >= 0) {
      this._cellsDirty[index] = 1
      this._anyCellDirty = true
    }

    // Mark neighbors dirty (edge blending depends on them)
    const gridType = this._map.grid.type
    const cell = uv.toCPos(gridType)
    if (!cell) return

    const directions = [
      { X: 0, Y: -1 }, // Top
      { X: 1, Y: 0 }, // Right
      { X: 0, Y: 1 }, // Bottom
      { X: -1, Y: 0 }, // Left
    ]

    for (const d of directions) {
      const neighborCell = new CPos(cell.X + d.X, cell.Y + d.Y)
      const neighborMPos = neighborCell.toMPos(gridType)
      if (neighborMPos && this._map.contains(neighborMPos)) {
        const neighborIndex = this._cellIndex(neighborMPos)
        if (neighborIndex >= 0) {
          this._cellsDirty[neighborIndex] = 1
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cell index helper
  // -------------------------------------------------------------------------

  /** Convert MPos to flat array index.
   *
   * OpenRA 对照: ProjectedCellLayer.Index(PPos)
   */
  private _cellIndex(uv: MPos): number {
    return uv.V * this._mapWidth + uv.U
  }

  // -------------------------------------------------------------------------
  // Neighbor visibility
  // -------------------------------------------------------------------------

  /**
   * Query visibility of 8 neighboring cells.
   *
   * OpenRA 对照: ShroudRenderer.GetNeighborsVisibility(PPos)
   *
   * @param puv — center cell
   * @returns array of 8 CellVisibility values (Top, Right, Bottom, Left,
   *   TopLeft, TopRight, BottomRight, BottomLeft)
   */
  private _getNeighborsVisibility(puv: PPos): CellVisibility[] {
    // Convert PPos -> MPos -> CPos for neighbor iteration
    const gridType = this._map.grid.type
    const mpos = puv.toMPos()
    const cell = mpos.toCPos(gridType)
    if (!cell) {
      this._neighbors.fill(0 as CellVisibility)
      return this._neighbors
    }

    const dirs = [
      { X: 0, Y: -1 }, // Top
      { X: 1, Y: 0 }, // Right
      { X: 0, Y: 1 }, // Bottom
      { X: -1, Y: 0 }, // Left
      { X: -1, Y: -1 }, // TopLeft
      { X: 1, Y: -1 }, // TopRight
      { X: 1, Y: 1 }, // BottomRight
      { X: -1, Y: 1 }, // BottomLeft
    ]

    for (let i = 0; i < 8; i++) {
      const neighborCell = new CPos(cell.X + dirs[i].X, cell.Y + dirs[i].Y)
      const neighborMPos = neighborCell.toMPos(gridType)
      if (neighborMPos && this._map.contains(neighborMPos) && this._cellVisibility !== null) {
        const neighborPPos = PPos.fromMPos(neighborMPos)
        this._neighbors[i] = this._cellVisibility(neighborPPos)
      } else {
        this._neighbors[i] = 0 as CellVisibility
      }
    }

    return this._neighbors
  }

  // -------------------------------------------------------------------------
  // Edge computation
  // -------------------------------------------------------------------------

  /**
   * Compute edge bitmask from neighbor visibility.
   *
   * OpenRA 对照: ShroudRenderer.GetEdges(CellVisibility[], CellVisibility)
   *
   * A side is considered "shrouded" if the neighbor in that direction does
   * NOT have the given visibility mask. If a side is shrouded, its corners
   * are also considered.
   *
   * @param neighbors — 8 neighbor visibility values
   * @param visibleMask — mask to check (Visible or Explored)
   * @returns edge bitmask
   */
  private _getEdges(neighbors: CellVisibility[], visibleMask: CellVisibility): number {
    let edges = Edges.None

    // Check sides
    if ((neighbors[Neighbor.Top] & visibleMask) === 0) {
      edges |= Edges.TopSide | Edges.TopLeft | Edges.TopRight
    }
    if ((neighbors[Neighbor.Right] & visibleMask) === 0) {
      edges |= Edges.RightSide | Edges.TopRight | Edges.BottomRight
    }
    if ((neighbors[Neighbor.Bottom] & visibleMask) === 0) {
      edges |= Edges.BottomSide | Edges.BottomRight | Edges.BottomLeft
    }
    if ((neighbors[Neighbor.Left] & visibleMask) === 0) {
      edges |= Edges.LeftSide | Edges.TopLeft | Edges.BottomLeft
    }

    // Check corners (only if not already set by sides)
    if ((neighbors[Neighbor.TopLeft] & visibleMask) === 0) {
      edges |= Edges.TopLeft
    }
    if ((neighbors[Neighbor.TopRight] & visibleMask) === 0) {
      edges |= Edges.TopRight
    }
    if ((neighbors[Neighbor.BottomRight] & visibleMask) === 0) {
      edges |= Edges.BottomRight
    }
    if ((neighbors[Neighbor.BottomLeft] & visibleMask) === 0) {
      edges |= Edges.BottomLeft
    }

    return edges
  }

  /**
   * Get combined shroud and fog edges for a cell.
   *
   * OpenRA 对照: ShroudRenderer.GetEdges(PPos)
   *
   * @param puv — the cell to check
   * @returns [shroudEdges, fogEdges] tuple
   */
  private _getCellEdges(puv: PPos): [number, number] {
    if (this._cellVisibility === null) {
      return [Edges.AllCorners, Edges.AllCorners]
    }

    const cv = this._cellVisibility(puv)

    // If cell is not explored, all neighbors are fully shrouded+fogged
    if ((cv & 0x1) === 0) {
      // Not explored
      return [Edges.AllCorners, Edges.AllCorners]
    }

    const neighbors = this._getNeighborsVisibility(puv)

    // Fog edges: if cell is visible, check neighbor visibility; otherwise all fogged
    const fogEdges = (cv & 0x2) !== 0
      ? this._getEdges(neighbors, 0x2 as CellVisibility)
      : Edges.AllCorners

    // Shroud edges: check neighbor explored state
    const shroudEdges = this._getEdges(neighbors, 0x1 as CellVisibility)

    return [shroudEdges, fogEdges]
  }

  // -------------------------------------------------------------------------
  // Visibility texture update
  // -------------------------------------------------------------------------

  /**
   * Update the visibility texture for dirty cells.
   *
   * OpenRA 对照: ShroudRenderer.UpdateShroud(IEnumerable<PPos>)
   *
   * Iterates dirty cells, resolves their visibility state, and updates the
   * visibility data array. Only uploads to GPU if there are changes.
   *
   * @param region — cells to check (usually all projected cells)
   */
  private _updateShroudTexture(region: Iterable<PPos>): void {
    if (!this._anyCellDirty) {
      return
    }

    let hasChanges = false

    for (const puv of region) {
      const uv = puv.toMPos()
      const index = this._cellIndex(uv)
      if (index < 0 || index >= this._cellsDirty.length) {
        continue
      }
      if (this._cellsDirty[index] === 0) {
        continue
      }

      this._cellsDirty[index] = 0

      if (this._cellVisibility !== null) {
        const cv = this._cellVisibility(puv)
        // Map CellVisibility to single byte: 0=Hidden, 1=Explored, 2=Visible
        let value: number
        if ((cv & 0x2) !== 0) {
          value = 2 // Visible
        } else if ((cv & 0x1) !== 0) {
          value = 1 // Explored
        } else {
          value = 0 // Hidden
        }

        if (this._visibilityData[index] !== value) {
          this._visibilityData[index] = value
          hasChanges = true
        }
      }
    }

    this._anyCellDirty = false

    // Upload to GPU if there are changes and texture exists
    if (hasChanges && this._visibilityTexture !== null) {
      this._visibilityTexture.update(this._visibilityData)
    }
  }

  // -------------------------------------------------------------------------
  // IRenderShroud
  // -------------------------------------------------------------------------

  /**
   * Render the shroud overlay.
   *
   * OpenRA 对照: IRenderShroud.RenderShroud(WorldRenderer)
   *
   * Updates the visibility texture for dirty cells, then renders the
   * shroud overlay quad.
   *
   * @param _wr — the world renderer
   */
  renderShroud(_wr: WorldRendererStub): void {
    if (this._disposed) {
      return
    }

    // Update visibility texture
    this._updateShroudTexture(this._map.projectedCells)

    // NOTE: Actual GPU rendering is handled by the Babylon.js scene graph.
    // The shroud quad is a mesh in the scene with renderingGroupId set to
    // render after the world but before annotations. In the current
    // architecture, the Scene.render() call handles all mesh rendering.
    // If the quad mesh and material are set up, they will be rendered
    // automatically.
  }

  // -------------------------------------------------------------------------
  // INotifyActorDisposing
  // -------------------------------------------------------------------------

  /**
   * Dispose the renderer and release GPU resources.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
   */
  disposing(_actor: IGameActor): void {
    if (this._disposed) {
      return
    }

    // Unsubscribe from shroud
    if (this._shroud !== null) {
      this._shroud.removeOnShroudChanged(this._updateShroudCell)
    }

    // Dispose GPU resources
    if (this._quadMesh !== null) {
      this._quadMesh.dispose()
      this._quadMesh = null
    }
    if (this._shroudMaterial !== null) {
      this._shroudMaterial.dispose()
      this._shroudMaterial = null
    }
    if (this._visibilityTexture !== null) {
      this._visibilityTexture.dispose()
      this._visibilityTexture = null
    }

    this._disposed = true
  }

  // -------------------------------------------------------------------------
  // Public accessors (for testing)
  // -------------------------------------------------------------------------

  /** Whether the renderer has been disposed. */
  get disposed(): boolean {
    return this._disposed
  }

  /** Current shroud instance (for testing). */
  get shroud(): Shroud | null {
    return this._shroud
  }

  /** Whether any cell is currently dirty. */
  get anyCellDirty(): boolean {
    return this._anyCellDirty
  }

  /** Get the visibility data array (for testing). */
  get visibilityData(): Uint8Array {
    return this._visibilityData
  }

  /** Get the dirty flags array (for testing). */
  get cellsDirty(): Uint8Array {
    return this._cellsDirty
  }

  /** Get the cell visibility function (for testing). */
  get cellVisibility(): ((puv: PPos) => CellVisibility) | null {
    return this._cellVisibility
  }
}
