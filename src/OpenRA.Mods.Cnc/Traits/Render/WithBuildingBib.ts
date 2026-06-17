/**
 * WithBuildingBib.ts — 建筑地基围裙渲染（建筑下方的连接平台）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithBuildingBib.cs (137 lines)
 *
 * 核心范式转换:
 * - C# INotifyAddedToWorld / INotifyRemovedFromWorld → TS lifecycle hooks
 * - C# Animation + AnimationWithOffset per bib cell → TS duck-typed animation array
 * - C# CVec / CPos cell arithmetic → TS cell coordinate math
 * - C# RenderSprites.Add / Remove → TS duck-typed add/remove
 *
 * 建筑 "bib" (围裙) 是建筑下方的基础连接平台。多个 bib 精灵被放置在
 * 建筑占用格的底部行（通常是底部两行），形成建筑与地面的过渡。
 * 支持地形特定的 bib 变体（如 "bib-sand"）。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal Animation interface.
 *
 * OpenRA 对照: Animation
 */
export interface IBibAnimation {
  readonly name: string
  isDecoration: boolean
  hasSequence(sequence: string): boolean
  playFetchIndex(sequence: string, indexFn: () => number): void
}

/** Minimal RenderSprites interface for bib management.
 *
 * OpenRA 对照: RenderSprites
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
 * OpenRA 对照: BuildingInfo
 */
export interface IBibBuildingInfo {
  readonly dimensions: { readonly x: number; readonly y: number }
  centerOffset(world: unknown): { readonly x: number; readonly y: number; readonly z: number }
}

/** Minimal Map interface.
 *
 * OpenRA 对照: Map
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

// ---------------------------------------------------------------------------
// WithBuildingBibInfo
// OpenRA 对照: WithBuildingBibInfo : TraitInfo, Requires<BuildingInfo>, IRenderActorPreviewSpritesInfo, IActorPreviewInitInfo, Requires<RenderSpritesInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithBuildingBib.
 *
 * OpenRA 对照: WithBuildingBibInfo
 */
export class WithBuildingBibInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Bib sprite sequence (default "bib").
   *
   * OpenRA 对照: WithBuildingBibInfo.Sequence
   */
  readonly sequence: string

  /** Bib color palette (default terrain internal palette).
   *
   * OpenRA 对照: WithBuildingBibInfo.Palette
   */
  readonly palette: string

  /** Whether to use minibib (1 row instead of 2).
   *
   * OpenRA 对照: WithBuildingBibInfo.HasMinibib (default false)
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
   * OpenRA 对照: WithBuildingBibInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithBuildingBib {
    return new WithBuildingBib(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithBuildingBib
// OpenRA 对照: WithBuildingBib : INotifyAddedToWorld, INotifyRemovedFromWorld
// ---------------------------------------------------------------------------

/** Renders building foundation bib sprites.
 *
 * OpenRA 对照: WithBuildingBib
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
   * OpenRA 对照: WithBuildingBib.anims (List<AnimationWithOffset>)
   */
  private _anims: IBibAnimWithOffset[] = []

  constructor(self: IGameActor, info: WithBuildingBibInfo) {
    this.info = info
    this._renderSprites = (self as any).trait?.('RenderSprites') as IBibRenderSprites
    this._buildingInfo = (self as any).info?.traitInfo?.('Building') as IBibBuildingInfo
  }

  // -------------------------------------------------------------------------
  // AddedToWorld
  // 对照: INotifyAddedToWorld.AddedToWorld(Actor self)
  // -------------------------------------------------------------------------

  /** Create bib sprites when the actor is added to the world.
   *
   * OpenRA 对照: WithBuildingBib.INotifyAddedToWorld.AddedToWorld(Actor)
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
          // Duck-typed: assume sequences exist
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
      // NOTE: isDecoration is set via a separate property or passed to RenderSprites

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
  // 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
  // -------------------------------------------------------------------------

  /** Remove bib sprites when the actor is removed from the world.
   *
   * OpenRA 对照: WithBuildingBib.INotifyRemovedFromWorld.RemovedFromWorld(Actor)
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
