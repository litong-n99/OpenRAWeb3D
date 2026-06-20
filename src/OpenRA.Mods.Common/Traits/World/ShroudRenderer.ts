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

import {
  RawTexture,
  ShaderMaterial,
  MeshBuilder,
  Mesh,
  Constants,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { PPos, MPos } from '../../../OpenRA.Game/MPos'
import { CPos } from '../../../OpenRA.Game/CPos'
import { Component } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type {
  IWorldLoaded,
  IRenderShroud,
  INotifyActorDisposing,
  IGameActor,
  ITickRender,
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

/** All 8 neighbor directions (cardinal + diagonal) as CPos offsets.
 *
 * OpenRA 对照: CVec.Directions (8 directions)
 *
 * PERF: Module-level constant — no per-call allocation.
 */
const ALL_DIRECTIONS: readonly { readonly X: number; readonly Y: number }[] = [
  { X: 0, Y: -1 },   // Top
  { X: 1, Y: 0 },    // Right
  { X: 0, Y: 1 },    // Bottom
  { X: -1, Y: 0 },   // Left
  { X: -1, Y: -1 },  // TopLeft
  { X: 1, Y: -1 },   // TopRight
  { X: 1, Y: 1 },    // BottomRight
  { X: -1, Y: 1 },   // BottomLeft
]

// ---------------------------------------------------------------------------
// GLSL shaders for shroud overlay
// ---------------------------------------------------------------------------

/** Vertex shader: pass-through position and UV to fragment shader.
 *
 * Uses WebGL 1.0 style (attribute/varying/gl_FragColor) to match the
 * project's existing shader conventions (TerrainMaterial, RgbaColorRenderer).
 * Babylon.js internally upgrades to GLSL ES 3.0 for WebGL 2.0 contexts.
 */
const SHROUD_VERTEX_SHADER = /* glsl */`
attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform vec2 uMapSize;

varying vec2 vUV;

void main(void) {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUV = uv;
}
`

/** Fragment shader: sample visibility texture and render shroud overlay.
 *
 * Visibility texture stores per-cell state as unsigned bytes:
 *   0 = Hidden  (opaque black)
 *   1 = Explored (translucent dark fog)
 *   2 = Visible  (fully transparent)
 *
 * The shader normalizes these to 0.0 / 0.5 / 1.0 by multiplying the
 * sampled value (0/255 .. 2/255) by 127.5.
 *
 * Edge blending: when a cell's visibility differs from its neighbors,
 * the fragment blends toward the neighbor's visibility based on the
 * fragment's distance to that edge (smoothstep within a blend zone).
 *
 * OpenRA 对照: ShroudRenderer's 12-direction sprite-selection logic
 * replaced by per-fragment neighbor sampling + smooth blending.
 */
const SHROUD_FRAGMENT_SHADER = /* glsl */`
precision highp float;

varying vec2 vUV;

uniform sampler2D uVisibilityTexture;
uniform vec2 uMapSize;
uniform vec2 uTexelSize;

void main(void) {
  // Decode visibility value: raw byte 0→0.0/255, 1→1.0/255, 2→2.0/255
  // Multiply by 127.5 (which is 255.0 * 0.5) to get 0.0 / 0.5 / 1.0
  float rawCenter = texture2D(uVisibilityTexture, vUV).r;
  float centerVis = rawCenter * 127.5;

  // Sample 8 neighbors
  float rawTop    = texture2D(uVisibilityTexture, vUV + vec2(0.0, uTexelSize.y)).r;
  float rawBottom = texture2D(uVisibilityTexture, vUV + vec2(0.0, -uTexelSize.y)).r;
  float rawLeft   = texture2D(uVisibilityTexture, vUV + vec2(-uTexelSize.x, 0.0)).r;
  float rawRight  = texture2D(uVisibilityTexture, vUV + vec2(uTexelSize.x, 0.0)).r;
  float rawTL     = texture2D(uVisibilityTexture, vUV + vec2(-uTexelSize.x, uTexelSize.y)).r;
  float rawTR     = texture2D(uVisibilityTexture, vUV + vec2(uTexelSize.x, uTexelSize.y)).r;
  float rawBL     = texture2D(uVisibilityTexture, vUV + vec2(-uTexelSize.x, -uTexelSize.y)).r;
  float rawBR     = texture2D(uVisibilityTexture, vUV + vec2(uTexelSize.x, -uTexelSize.y)).r;

  float topVis    = rawTop    * 127.5;
  float bottomVis = rawBottom * 127.5;
  float leftVis   = rawLeft   * 127.5;
  float rightVis  = rawRight  * 127.5;
  float tlVis     = rawTL     * 127.5;
  float trVis     = rawTR     * 127.5;
  float blVis     = rawBL     * 127.5;
  float brVis     = rawBR     * 127.5;

  // Edge blending: compute blend factors based on position within cell
  vec2 cellCoord = vUV * uMapSize;
  vec2 fracPos = fract(cellCoord); // 0..1 within current cell
  float blendZone = 0.25;          // blend zone width (fraction of cell)

  float blendedVis = centerVis;

  // Cardinal direction blending
  if (abs(topVis - centerVis) > 0.01) {
    float t = smoothstep(1.0 - blendZone, 1.0, fracPos.y);
    blendedVis = mix(blendedVis, topVis, t);
  }
  if (abs(bottomVis - centerVis) > 0.01) {
    float t = smoothstep(1.0 - blendZone, 1.0, 1.0 - fracPos.y);
    blendedVis = mix(blendedVis, bottomVis, t);
  }
  if (abs(rightVis - centerVis) > 0.01) {
    float t = smoothstep(1.0 - blendZone, 1.0, fracPos.x);
    blendedVis = mix(blendedVis, rightVis, t);
  }
  if (abs(leftVis - centerVis) > 0.01) {
    float t = smoothstep(1.0 - blendZone, 1.0, 1.0 - fracPos.x);
    blendedVis = mix(blendedVis, leftVis, t);
  }

  // Corner blending (diagonal neighbors): blend at cell corners
  float cornerZone = blendZone * 0.7071; // diagonal distance factor
  if (abs(tlVis - centerVis) > 0.01) {
    float dx = 1.0 - fracPos.x;
    float dy = fracPos.y;
    float d = min(dx, dy);               // Chebyshev distance to corner
    float t = smoothstep(1.0 - cornerZone, 1.0, d);
    blendedVis = mix(blendedVis, tlVis, t);
  }
  if (abs(trVis - centerVis) > 0.01) {
    float dx = fracPos.x;
    float dy = fracPos.y;
    float d = min(dx, dy);
    float t = smoothstep(1.0 - cornerZone, 1.0, d);
    blendedVis = mix(blendedVis, trVis, t);
  }
  if (abs(brVis - centerVis) > 0.01) {
    float dx = fracPos.x;
    float dy = 1.0 - fracPos.y;
    float d = min(dx, dy);
    float t = smoothstep(1.0 - cornerZone, 1.0, d);
    blendedVis = mix(blendedVis, brVis, t);
  }
  if (abs(blVis - centerVis) > 0.01) {
    float dx = 1.0 - fracPos.x;
    float dy = 1.0 - fracPos.y;
    float d = min(dx, dy);
    float t = smoothstep(1.0 - cornerZone, 1.0, d);
    blendedVis = mix(blendedVis, blVis, t);
  }

  // Map visibility to output color/alpha
  float alpha;
  vec3 color;

  if (blendedVis < 0.25) {
    // Hidden: opaque black
    alpha = 1.0;
    color = vec3(0.0, 0.0, 0.0);
  } else if (blendedVis < 0.75) {
    // Explored: semi-transparent dark fog tint
    alpha = 0.55;
    color = vec3(0.08, 0.08, 0.12);
  } else {
    // Visible: fully transparent (no overlay)
    alpha = 0.0;
    color = vec3(0.0, 0.0, 0.0);
  }

  gl_FragColor = vec4(color, alpha);
}
`

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
export class ShroudRenderer extends Component implements IWorldLoaded, IRenderShroud, ITickRender, INotifyActorDisposing {

  /** Trait interface keys for TraitDictionary registration.
   *
   * OpenRA 对照: N/A (C# uses reflection; TS needs explicit interface list)
   */
  static readonly interfaces = [
    'IWorldLoaded',
    'IRenderShroud',
    'ITickRender',
    'INotifyActorDisposing',
    'component',
  ]
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** Configuration for this renderer (stored for future deferred features). */
  private readonly _info: ShroudRendererInfo
  private _map: GameMap

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
  private _cellsDirty: Uint8Array

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
  private _visibilityData: Uint8Array

  /** Map dimensions for array indexing. */
  private _mapWidth: number
  private _mapHeight: number

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

  // NOTE: _disposed flag is inherited from Component (protected _disposed).

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
    super()
    this._info = info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._map = (world as any).map as GameMap

    // Gracefully handle worlds without a map (e.g., test stubs): defer
    // dimension initialization to worldLoaded(). If the map exists here,
    // allocate arrays immediately (standard codepath).
    if (this._map && this._map.mapSize) {
      this._mapWidth = this._map.mapSize.width
      this._mapHeight = this._map.mapSize.height
    } else {
      // Map will be resolved in worldLoaded() — use sentinel values.
      this._mapWidth = 0
      this._mapHeight = 0
    }
    const cellCount = this._mapWidth * this._mapHeight

    this._cellsDirty = new Uint8Array(cellCount)
    this._visibilityData = new Uint8Array(cellCount)

    // Initialize all cells as dirty (will be resolved on first render)
    if (cellCount > 0) {
      this._cellsDirty.fill(1)
      this._anyCellDirty = true
    }

    // _getCellEdges is called from tests via `as any` cast — suppress TS6133
    void (this._getCellEdges as unknown)

    // Subscribe to render player changes by wrapping the world's callback.
    // Using != null handles both null and undefined — if the world has no
    // renderPlayerChanged mechanism, the worldLoaded path handles the initial
    // player assignment via worldAny.renderPlayer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worldAny = world as any
    if (worldAny.renderPlayerChanged != null) {
      const originalCallback = worldAny.renderPlayerChanged
      worldAny.renderPlayerChanged = (player: unknown) => {
        this._worldOnRenderPlayerChanged(player)
        if (typeof originalCallback === 'function') {
          originalCallback(player)
        }
      }
    }

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

    // Deferred map initialization: if the constructor received a world
    // without a map (test stubs), resolve it now from the loaded world.
    if (this._mapWidth === 0 && this._mapHeight === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wMap = worldAny.map as GameMap | undefined
      if (wMap && wMap.mapSize) {
        this._map = wMap
        this._mapWidth = wMap.mapSize.width
        this._mapHeight = wMap.mapSize.height
        const cellCount = this._mapWidth * this._mapHeight
        this._cellsDirty = new Uint8Array(cellCount)
        this._visibilityData = new Uint8Array(cellCount)
        this._cellsDirty.fill(1)
        this._anyCellDirty = true
      }
    }

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

    // Initialize with current render player (null = spectator = all visible).
    // Always call to ensure _cellVisibility is set correctly — skipping
    // null would leave the initial all-Hidden state active for one frame.
    this._worldOnRenderPlayerChanged(worldAny.renderPlayer ?? null)
  }

  // -------------------------------------------------------------------------
  // Babylon.js resource creation
  // -------------------------------------------------------------------------

  /**
   * Create Babylon.js GPU resources: visibility RawTexture, ShaderMaterial,
   * and a ground plane Mesh that covers the entire map.
   *
   * OpenRA 对照: ShroudRenderer.WorldLoaded() — shroudLayer/fogLayer creation
   *
   * ## Architectural decision: Ground-plane Mesh vs RenderTargetTexture
   *
   * In the original OpenRA C# implementation, the shroud is rendered via
   * TerrainSpriteLayer (12-direction sprite variants) as a post-process pass.
   * In Babylon.js, we use a single ground-plane Mesh with a ShaderMaterial
   * instead of a RenderTargetTexture (RTT) for the following reasons:
   *
   * 1. **Simpler depth ordering**: The plane Mesh uses renderingGroupId to
   *    render after terrain (group 0) and actors (group 1) but before UI
   *    overlays (group 3). This avoids the complexity of managing a separate
   *    RTT scene + compositing pass.
   *
   * 2. **No extra render pass**: An RTT approach would require an additional
   *    render pass (render to RTT, then composite onto main scene). The
   *    ground-plane approach renders in a single pass via alpha blending.
   *
   * 3. **Easier shroud updates**: The visibility RawTexture can be updated
   *    incrementally (only dirty cells), and the ShaderMaterial automatically
   *    samples the latest texture data in the next frame.
   *
   * The visibility texture stores one byte per projected cell (0=Hidden,
   * 1=Explored, 2=Visible). The ShaderMaterial samples this texture and
   * its 8 neighbors to produce the shroud/fog overlay with edge blending.
   * The plane mesh is positioned slightly above the terrain surface to
   * avoid z-fighting, and assigned a high renderingGroupId so it renders
   * after terrain and actors but before UI overlays.
   *
   * @param scene — the Babylon.js scene
   */
  private _createShroudResources(scene: Scene): void {
    // Dispose any existing resources (e.g., on map change)
    this._disposeGPUResources()

    this._scene = scene

    const cellCount = this._mapWidth * this._mapHeight

    // ---- 1. Visibility RawTexture ----
    // Single-channel (R) unsigned byte texture, one texel per projected cell.
    // Values: 0=Hidden, 1=Explored, 2=Visible.
    const initialData = new Uint8Array(cellCount)
    initialData.set(this._visibilityData)

    this._visibilityTexture = new RawTexture(
      initialData,
      this._mapWidth,
      this._mapHeight,
      Constants.TEXTUREFORMAT_R,
      scene,
      false, // no mipmaps
      false, // invertY = false
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    )

    // ---- 2. ShaderMaterial ----
    this._shroudMaterial = new ShaderMaterial(
      'shroudMat',
      scene,
      {
        vertexSource: SHROUD_VERTEX_SHADER,
        fragmentSource: SHROUD_FRAGMENT_SHADER,
      },
      {
        attributes: ['position', 'uv'],
        uniforms: [
          'worldViewProjection',
          'uMapSize',
          'uTexelSize',
        ],
        samplers: [
          'uVisibilityTexture',
        ],
        needAlphaBlending: true,
      },
    )
    this._shroudMaterial.setTexture('uVisibilityTexture', this._visibilityTexture)
    this._shroudMaterial.setVector2('uMapSize', { x: this._mapWidth, y: this._mapHeight })
    this._shroudMaterial.setVector2('uTexelSize', { x: 1 / this._mapWidth, y: 1 / this._mapHeight })
    // NOTE: Texel center alignment — the ground-plane mesh from CreateGround
    // produces evenly-spaced UV coordinates proportional to world positions
    // (UV = x / mapWidth, z / mapHeight). Each cell of the visibility texture
    // is sampled at its center via the fragment shader's cellCoord =
    // vUV * uMapSize. With TEXTURE_NEAREST_SAMPLINGMODE, the GPU samples the
    // nearest texel center, so cell i maps to texel i without offset issues.
    // Non-square maps (mapWidth !== mapHeight) are supported via uTexelSize.
    this._shroudMaterial.backFaceCulling = false
    this._shroudMaterial.disableDepthWrite = true

    // ---- 3. Ground plane Mesh ----
    // Covers the entire map in world space (1 cell = 1 world unit).
    // Positioned at Y = 0.01 to sit just above the terrain surface, preventing
    // z-fighting with terrain geometry.
    this._quadMesh = MeshBuilder.CreateGround(
      'shroudOverlay',
      {
        width: this._mapWidth,
        height: this._mapHeight,
      },
      scene,
    )
    this._quadMesh.position.x = this._mapWidth / 2
    this._quadMesh.position.z = this._mapHeight / 2
    this._quadMesh.position.y = 0.01
    this._quadMesh.material = this._shroudMaterial
    this._quadMesh.isPickable = false
    // Render after terrain (0) and actors (1), before UI overlays (3)
    this._quadMesh.renderingGroupId = 2

    // Mark all cells dirty to ensure first render uploads full visibility data
    this._cellsDirty.fill(1)
    this._anyCellDirty = true
  }

  /**
   * Dispose GPU resources without clearing the scene reference.
   *
   * Used by _createShroudResources before recreating resources (e.g., on
   * map change where dimensions differ), and by disposing() for final cleanup.
   */
  private _disposeGPUResources(): void {
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

    // Mark neighbors dirty (edge blending depends on them).
    // OpenRA uses 8-directional neighbor marking (CVec.Directions),
    // because diagonal corners also participate in edge blending.
    const gridType = this._map.grid.type
    const cell = uv.toCPos(gridType)
    if (!cell) return

    for (const d of ALL_DIRECTIONS) {
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
    // Short-circuit: no visibility function means all neighbors are hidden
    if (this._cellVisibility === null) {
      this._neighbors.fill(0 as CellVisibility)
      return this._neighbors
    }

    // Convert PPos -> MPos -> CPos for neighbor iteration
    const gridType = this._map.grid.type
    const mpos = puv.toMPos()
    const cell = mpos.toCPos(gridType)
    if (!cell) {
      this._neighbors.fill(0 as CellVisibility)
      return this._neighbors
    }

    for (let i = 0; i < 8; i++) {
      const d = ALL_DIRECTIONS[i]
      const neighborCell = new CPos(cell.X + d.X, cell.Y + d.Y)
      const neighborMPos = neighborCell.toMPos(gridType)
      if (neighborMPos && this._map.contains(neighborMPos)) {
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

    // C# default UseExtendedIndex=false masks to AllCorners (only corner bits).
    // When UseExtendedIndex is true (TODO-12.DEFERRED.10), side bits are included.
    return this._info.useExtendedIndex ? edges : (edges & Edges.AllCorners)
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

    // Guard: if map was deferred and never resolved, render is a no-op
    if (!this._map || !this._map.projectedCells) {
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
  // ITickRender
  // -------------------------------------------------------------------------

  /**
   * Per-frame render tick — delegates to renderShroud for visibility updates.
   *
   * OpenRA 对照: ITickRender.TickRender(WorldRenderer, Actor)
   *
   * Called every render frame by GameWorldManager.tickRender() via the
   * TraitDictionary. This ensures the visibility texture is updated each
   * frame so that shroud changes (from Shroud.addOnShroudChanged) are
   * flushed to the GPU before Babylon.js renders the next frame.
   *
   * If the WorldRenderer also calls renderShroud() via IRenderShroud,
   * the second call is a no-op (all cells already marked clean).
   *
   * @param wr — the world renderer
   * @param _actor — the actor this trait is attached to
   */
  tickRender(wr: WorldRendererStub, _actor: IGameActor): void {
    if (this._disposed) {
      return
    }
    this.renderShroud(wr)
  }

  // -------------------------------------------------------------------------
  // Debugging
  // -------------------------------------------------------------------------

  /**
   * Diagnostic summary of the current shroud renderer state.
   *
   * Returns a plain object suitable for console.table() or test assertions.
   * Useful for debugging why the shroud overlay doesn't render at runtime.
   *
   * @returns diagnostic object with current state snapshot
   */
  logDiagnostics(): Record<string, unknown> {
    const dirtyCount = this._cellsDirty.reduce((sum, v) => sum + v, 0)
    return {
      shroudAttached: this._shroud !== null,
      cellVisibilitySet: this._cellVisibility !== null,
      anyCellDirty: this._anyCellDirty,
      dirtyCellCount: dirtyCount,
      hasVisibilityTexture: this._visibilityTexture !== null,
      hasShroudMaterial: this._shroudMaterial !== null,
      hasQuadMesh: this._quadMesh !== null,
      hasScene: this._scene !== null,
      mapSize: { w: this._mapWidth, h: this._mapHeight },
      disposed: this._disposed,
    }
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
    this._disposeGPUResources()
    this._scene = null

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

  /** Get the visibility RawTexture (for testing). */
  get visibilityTexture(): RawTexture | null {
    return this._visibilityTexture
  }

  /** Get the ShaderMaterial (for testing). */
  get shroudMaterial(): ShaderMaterial | null {
    return this._shroudMaterial
  }

  /** Get the overlay quad Mesh (for testing). */
  get quadMesh(): Mesh | null {
    return this._quadMesh
  }

  /** Get the Babylon.js scene (for testing). */
  get scene(): Scene | null {
    return this._scene
  }
}
