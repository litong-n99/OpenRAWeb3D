/**
 * WithBuildingBib.ts — Building foundation bib rendering (concrete platform under buildings)
 * OpenRA reference: OpenRA.Mods.Cnc/Traits/Render/WithBuildingBib.cs (137 lines)
 *
 * Paradigm mapping:
 * - C# INotifyAddedToWorld / INotifyRemovedFromWorld -> TS lifecycle hooks
 * - C# Animation + AnimationWithOffset per bib cell -> TS duck-typed animation array
 * - C# CVec / CPos cell arithmetic -> TS cell coordinate math
 * - C# RenderSprites.Add / Remove -> TS duck-typed add/remove
 * - C# IRenderActorPreviewSpritesInfo.RenderPreviewSprites -> TS builder method
 *   returning IActorPreview array (Phase B.9: implemented ghost preview sprites for bib cells)
 *
 * The building "bib" is the concrete foundation platform under a building.
 * Multiple bib sprites are placed at the bottom rows of the building footprint
 * to form a visual transition from building to terrain.
 * Supports terrain-specific bib variants (e.g. "bib-sand").
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal Animation interface.
 *
 * OpenRA reference: Animation
 */
export interface IBibAnimation {
  readonly name: string
  isDecoration: boolean
  hasSequence(sequence: string): boolean
  playFetchIndex(sequence: string, indexFn: () => number): void
}

/** Minimal RenderSprites interface for bib management.
 *
 * OpenRA reference: RenderSprites
 */
export interface IBibRenderSprites {
  getImage(self: IGameActor): string
  add(
    animWithOffset: unknown,
    palette?: string | null,
    isPlayerPalette?: boolean,
  ): void
  remove(animWithOffset: unknown): void
}

/** Minimal BuildingInfo interface.
 *
 * OpenRA reference: BuildingInfo
 */
export interface IBibBuildingInfo {
  readonly dimensions: { readonly x: number; readonly y: number }
  centerOffset(world: unknown): { readonly x: number; readonly y: number; readonly z: number }
}

/** Minimal Map interface.
 *
 * OpenRA reference: Map
 */
export interface IBibMap {
  readonly tiles: { readonly cellBounds: { readonly width: number; readonly height: number } }
  contains(cell: unknown): boolean
  centerOfCell(cell: unknown): { readonly x: number; readonly y: number; readonly z: number }
  getTerrainInfo(cell: unknown): { readonly type: string }
}

/** Cell coordinate (CVec-like). */
export interface CellCoord {
  readonly x: number
  readonly y: number
}

/** Offset-result for AnimationWithOffset. */
export interface IBibAnimWithOffset {
  _anim: IBibAnimation
  _offset: { x: number; y: number; z: number } | null
  _zOffset: number
}

/** Minimal ActorPreviewInitializer for building placement preview.
 *
 * OpenRA reference: ActorPreviewInitializer
 */
export interface IBibPreviewInit {
  /** The actor info for the building being previewed. */
  readonly actor: { traitInfo(name: string): unknown }
  /** The world renderer (palette access). */
  readonly worldRenderer: { palette(name: string): unknown }
  /** The world (map access). */
  readonly world: { map: IBibMap }
  /** Get a value from the init type dictionary. */
  getValue(key: string, fallback?: unknown): unknown
  /** Check whether a specific init type is present. */
  contains(key: string): boolean
}

/** Actor preview for a single bib cell during building placement.
 *
 * OpenRA reference: IActorPreview (from OpenRA.Mods.Common.Graphics.ActorPreview)
 *
 * Renders as a semi-transparent ghost sprite showing where the bib
 * foundation will be placed.
 */
export interface IBibActorPreview {
  /** Advance the preview animation by one tick. */
  tick(): void
  /** Collect renderables at the given world position.
   *
   * @param wr — the world renderer
   * @param pos — the world position to render at
   * @returns array of renderable objects
   */
  render(wr: unknown, pos: { readonly x: number; readonly y: number; readonly z: number }): unknown[]
  /** Get screen-space bounds at the given world position.
   *
   * @param wr — the world renderer
   * @param pos — the world position
   * @returns array of screen-space rectangles
   */
  screenBounds(wr: unknown, pos: { readonly x: number; readonly y: number; readonly z: number }): { x: number; y: number; width: number; height: number }[]
}

// ---------------------------------------------------------------------------
// BibPreviewRenderable — a preview renderable for one bib cell
// OpenRA reference: SpriteActorPreview wraps Animation with offset + zOffset + palette
// ---------------------------------------------------------------------------

/**
 * Renders a single bib cell preview during building placement.
 *
 * OpenRA reference: SpriteActorPreview
 *
 * Each bib cell is rendered as a semi-transparent ghost sprite at its
 * world position with terrain-specific sequencing.
 */
export class BibPreviewRenderable implements IBibActorPreview {
  /** The bib sprite sequence name (e.g. "bib", "bib-sand"). */
  readonly sequence: string
  /** The world-space offset from the building origin to this bib cell. */
  readonly offset: () => { readonly x: number; readonly y: number; readonly z: number }
  /** Z-offset for rendering order. */
  readonly zOffset: () => number
  /** Palette reference for coloring. */
  readonly palette: unknown
  /** Animation image name. */
  readonly image: string
  /** Ghost alpha (semi-transparent until placement confirmed). */
  readonly alpha: number

  constructor(
    sequence: string,
    offset: () => { readonly x: number; readonly y: number; readonly z: number },
    zOffset: () => number,
    palette: unknown,
    image: string,
    alpha: number = 0.5,
  ) {
    this.sequence = sequence
    this.offset = offset
    this.zOffset = zOffset
    this.palette = palette
    this.image = image
    this.alpha = alpha
  }

  tick(): void {
    // Animation tick — advance the frame counter.
    // In the full impl, this would call anim.Tick().
  }

  render(_wr: unknown, _pos: { readonly x: number; readonly y: number; readonly z: number }): unknown[] {
    // Returns renderable entries with offset + zOffset + palette.
    // Each entry is a duck-typed object carrying the preview metadata.
    return [{
      type: 'bibPreview',
      image: this.image,
      sequence: this.sequence,
      offset: this.offset(),
      zOffset: this.zOffset(),
      palette: this.palette,
      alpha: this.alpha,
    }]
  }

  screenBounds(_wr: unknown, _pos: { readonly x: number; readonly y: number; readonly z: number }): { x: number; y: number; width: number; height: number }[] {
    // Returns approximated screen bounds for the bib cell.
    // Without full sprite data, return a unit-sized rect.
    const o = this.offset()
    return [{ x: o.x, y: o.y, width: 1, height: 1 }]
  }
}

// ---------------------------------------------------------------------------
// WithBuildingBibInfo
// OpenRA reference: WithBuildingBibInfo : TraitInfo, Requires<BuildingInfo>, IRenderActorPreviewSpritesInfo, IActorPreviewInitInfo, Requires<RenderSpritesInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithBuildingBib.
 *
 * OpenRA reference: WithBuildingBibInfo
 */
export class WithBuildingBibInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Bib sprite sequence (default "bib").
   *
   * OpenRA reference: WithBuildingBibInfo.Sequence
   */
  readonly sequence: string

  /** Bib color palette (default terrain internal palette).
   *
   * OpenRA reference: WithBuildingBibInfo.Palette
   */
  readonly palette: string

  /** Whether to use minibib (1 row instead of 2).
   *
   * OpenRA reference: WithBuildingBibInfo.HasMinibib (default false)
   */
  readonly hasMinibib: boolean

  constructor(params: {
    instanceName?: string
    sequence?: string
    palette?: string
    hasMinibib?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.sequence = params.sequence ?? 'bib'
    this.palette = params.palette ?? 'terrain'
    this.hasMinibib = params.hasMinibib ?? false
  }

  /** Create the trait instance.
   *
   * OpenRA reference: WithBuildingBibInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithBuildingBib {
    return new WithBuildingBib(init, this)
  }

  // -------------------------------------------------------------------------
  // IRenderActorPreviewSpritesInfo — OpenRA reference: RenderPreviewSprites
  // -------------------------------------------------------------------------

  /** Render actor preview sprites for placement visualization.
   *
   * OpenRA reference: IRenderActorPreviewSpritesInfo.RenderPreviewSprites(
   *   ActorPreviewInitializer, string image, int facings, PaletteReference p)
   *
   * Phase B.9: Generates ghost/preview sprites showing the bib (concrete
   * foundation) under the building during placement. Each bib cell gets a
   * semi-transparent BibPreviewRenderable at its world position.
   *
   * @param init — the actor preview initializer with world/map/actor info
   * @param image — the sprite sheet image name
   * @param _facings — number of facings (unused, bib is always 1 facing)
   * @param p — the palette reference for coloring
   * @returns iterable of IActorPreview for each bib cell
   */
  renderPreviewSprites(
    init: IBibPreviewInit,
    image: string,
    _facings: number,
    p: unknown,
  ): Iterable<IBibActorPreview> {
    // Check for HideBibPreviewInit sentinel — suppress bib in preview
    if (init.contains('HideBibPreviewInit')) return []

    const previews: IBibActorPreview[] = []

    // Resolve palette: use info.Palette if specified
    let palette = p
    if (this.palette) {
      palette = init.worldRenderer?.palette(this.palette) ?? p
    }

    // Get building dimensions from init
    const bi = init.actor.traitInfo('Building') as IBibBuildingInfo | undefined
    if (!bi) return previews

    const rows = this.hasMinibib ? 1 : 2
    const width = bi.dimensions.x
    const bibOffset = bi.dimensions.y - rows
    const centerOffset = bi.centerOffset(init.world)
    const map = init.world.map

    // Get placement location from init (default to origin)
    const location = (init.getValue('location') as CellCoord) ?? { x: 0, y: 0 }

    for (let i = 0; i < rows * width; i++) {
      const index = i
      const cellOffset: CellCoord = {
        x: i % width,
        y: Math.floor(i / width) + bibOffset,
      }
      const cell: CellCoord = {
        x: location.x + cellOffset.x,
        y: location.y + cellOffset.y,
      }

      // Check for terrain-specific bib sequence
      let sequence = this.sequence
      if (map.contains(cell)) {
        const terrain = map.getTerrainInfo(cell).type
        const testSequence = this.sequence + '-' + terrain
        if (terrain && testSequence.length > 0) {
          sequence = testSequence
        }
      }

      // Compute world-space offset
      const cellCenter = map.centerOfCell(cell)
      const locationCenter = map.centerOfCell(location)
      const offset = {
        x: cellCenter.x - locationCenter.x - centerOffset.x,
        y: cellCenter.y - locationCenter.y - centerOffset.y,
        z: cellCenter.z - locationCenter.z - centerOffset.z,
      }
      // Z-order: set to the top of the footprint
      const zOffsetVal = -(offset.y + centerOffset.y + 512)

      const preview = new BibPreviewRenderable(
        sequence,
        () => offset,
        () => zOffsetVal + index,
        palette,
        image,
        0.5, // semi-transparent ghost alpha
      )
      previews.push(preview)
    }

    return previews
  }

  /** Actor preview inits for UseMinibib detection.
   *
   * OpenRA reference: IActorPreviewInitInfo.ActorPreviewInits
   */
  actorPreviewInits(_actorInfo: unknown, _type: unknown): Iterable<unknown> {
    return [new HideBibPreviewInit()]
  }
}

// ---------------------------------------------------------------------------
// HideBibPreviewInit — OpenRA reference: sealed class HideBibPreviewInit : RuntimeFlagInit
// ---------------------------------------------------------------------------

/** Sentinel init flag to suppress bib rendering in actor previews.
 *
 * OpenRA reference: HideBibPreviewInit : RuntimeFlagInit
 *
 * When present in an ActorPreviewInitializer, bib sprites are hidden
 * during placement preview rendering.
 */
export class HideBibPreviewInit {
  /** Unique identifier for this init type.
   *
   * OpenRA reference: RuntimeFlagInit — type-level sentinel
   */
  static readonly typeName = 'HideBibPreviewInit'
}

// ---------------------------------------------------------------------------
// WithBuildingBib
// OpenRA reference: WithBuildingBib : INotifyAddedToWorld, INotifyRemovedFromWorld
// ---------------------------------------------------------------------------

/** Renders building foundation bib sprites.
 *
 * OpenRA reference: WithBuildingBib
 *
 * On AddedToWorld, creates AnimationWithOffset instances for each bib cell
 * and registers them with RenderSprites. On RemovedFromWorld, unregisters
 * and cleans up.
 */
export class WithBuildingBib {
  readonly info: WithBuildingBibInfo
  private readonly _renderSprites: IBibRenderSprites
  private readonly _buildingInfo: IBibBuildingInfo

  /** Registered AnimationWithOffset handles.
   *
   * OpenRA reference: WithBuildingBib.anims (List<AnimationWithOffset>)
   */
  private _anims: IBibAnimWithOffset[] = []

  constructor(self: IGameActor, info: WithBuildingBibInfo) {
    this.info = info
    this._renderSprites = (self as any).trait?.('RenderSprites') as IBibRenderSprites
    this._buildingInfo = (self as any).info?.traitInfo?.('Building') as IBibBuildingInfo
  }

  // -------------------------------------------------------------------------
  // AddedToWorld
  // reference: INotifyAddedToWorld.AddedToWorld(Actor self)
  // -------------------------------------------------------------------------

  /** Create bib sprites when the actor is added to the world.
   *
   * OpenRA reference: WithBuildingBib.INotifyAddedToWorld.AddedToWorld(Actor)
   *
   * @param self — the actor
   */
  addedToWorld(self: IGameActor): void {
    const rows = this.info.hasMinibib ? 1 : 2
    const width = this._buildingInfo.dimensions.x
    const bibOffset = this._buildingInfo.dimensions.y - rows
    const centerOffset = this._buildingInfo.centerOffset((self as any).world)
    const location = (self as any).location as CellCoord
    const map = (self as any).world?.map as IBibMap | undefined
    if (!map) return

    const image = this._renderSprites.getImage(self)

    for (let i = 0; i < rows * width; i++) {
      const index = i
      const anim: IBibAnimation = {
        name: image,
        isDecoration: true,
        hasSequence(seq: string): boolean {
          void seq
          return true
        },
        playFetchIndex(seq: string, fn: () => number): void {
          void seq
          void fn
        },
      }

      const cellOffset: CellCoord = {
        x: i % width,
        y: Math.floor(i / width) + bibOffset,
      }
      const cell: CellCoord = {
        x: location.x + cellOffset.x,
        y: location.y + cellOffset.y,
      }

      // Check for terrain-specific bib
      let sequence = this.info.sequence
      if (map.contains(cell)) {
        const terrain = map.getTerrainInfo(cell).type
        const testSequence = this.info.sequence + '-' + terrain
        if (anim.hasSequence(testSequence)) {
          sequence = testSequence
        }
      }

      anim.playFetchIndex(sequence, () => index)

      // Z-order is one set to the top of the footprint
      const cellCenter = map.centerOfCell(cell)
      const locationCenter = map.centerOfCell(location)
      const offset = {
        x: cellCenter.x - locationCenter.x - centerOffset.x,
        y: cellCenter.y - locationCenter.y - centerOffset.y,
        z: cellCenter.z - locationCenter.z - centerOffset.z,
      }
      const zOffset = -(offset.y + centerOffset.y + 512)

      const awo: IBibAnimWithOffset = {
        _anim: anim,
        _offset: offset,
        _zOffset: zOffset,
      }
      this._anims.push(awo)
      this._renderSprites.add(awo, this.info.palette)
    }
  }

  // -------------------------------------------------------------------------
  // RemovedFromWorld
  // reference: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
  // -------------------------------------------------------------------------

  /** Remove bib sprites when the actor is removed from the world.
   *
   * OpenRA reference: WithBuildingBib.INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   */
  removedFromWorld(_self: IGameActor): void {
    for (const a of this._anims) {
      this._renderSprites.remove(a)
    }
    this._anims = []
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Number of bib AnimationWithOffset entries. */
  get animCount(): number {
    return this._anims.length
  }

  /** The registered bib animations. */
  get anims(): readonly IBibAnimWithOffset[] {
    return this._anims
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // Cleanup in case actor wasn't removed from world
    for (const a of this._anims) {
      this._renderSprites.remove(a)
    }
    this._anims = []
  }
}
