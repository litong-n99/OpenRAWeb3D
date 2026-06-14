/**
 * RallyPoint.ts — 集结点：定义单位生产后的移动目标
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/RallyPoint.cs (199 lines)
 *
 * 核心范式转换:
 * - C# List<CPos> Path → TS CPos[] (数组操作)
 * - C# IIssueOrder / IResolveOrder → TS 接口实现
 * - C# OrderTargeter → TS 简化的目标选择器
 * - C# INotifyOwnerChanged → TS onOwnerChanged 方法
 * - C# Game.Sound.PlayNotification → TS 桩 (TODO-8.F)
 *
 * RallyPoint 定义了单位生产完成后应该移动到的位置。
 * 玩家可以通过点击设置集结点。
 */

import type {
  IGameActor,
  PlayerStub,
  INotifyOwnerChanged,
  INotifyCreated,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// RallyPointInfo
// OpenRA 对照: RallyPointInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the RallyPoint trait.
 *
 * OpenRA 对照: RallyPointInfo
 */
export class RallyPointInfo {
  readonly instanceName?: string

  /** Sprite image for the rally point indicator.
   *
   * OpenRA 对照: RallyPointInfo.Image
   */
  readonly image: string = 'rallypoint'

  /** Width (in pixels) of the rally point line.
   *
   * OpenRA 对照: RallyPointInfo.LineWidth
   */
  readonly lineWidth: number = 1

  /** Flag sequence for the indicator sprite.
   *
   * OpenRA 对照: RallyPointInfo.FlagSequence
   */
  readonly flagSequence: string = 'flag'

  /** Circles sequence for the indicator sprite.
   *
   * OpenRA 对照: RallyPointInfo.CirclesSequence
   */
  readonly circlesSequence: string = 'circles'

  /** Cursor to display when rally point can be set.
   *
   * OpenRA 对照: RallyPointInfo.Cursor
   */
  readonly cursor: string = 'ability'

  /** Custom indicator palette name.
   *
   * OpenRA 对照: RallyPointInfo.Palette
   */
  readonly palette: string = 'player'

  /** Whether the custom palette is a player palette (BaseName).
   *
   * OpenRA 对照: RallyPointInfo.IsPlayerPalette
   */
  readonly isPlayerPalette: boolean = true

  /** Initial rally point offsets (relative to building location).
   *
   * OpenRA 对照: RallyPointInfo.Path (ImmutableArray<CVec>)
   */
  readonly path: readonly CVec[]

  /** Audio notification when setting a new rally point.
   *
   * OpenRA 对照: RallyPointInfo.Notification
   */
  readonly notification: string | null = null

  /** Text notification when setting a new rally point.
   *
   * OpenRA 对照: RallyPointInfo.TextNotification
   */
  readonly textNotification: string | null = null

  /** Used to group equivalent actors for force-set (e.g. for Primary production).
   *
   * OpenRA 对照: RallyPointInfo.ForceSetType
   */
  readonly forceSetType: string | null = null

  constructor(params: {
    instanceName?: string
    image?: string
    lineWidth?: number
    flagSequence?: string
    circlesSequence?: string
    cursor?: string
    palette?: string
    isPlayerPalette?: boolean
    path?: readonly CVec[]
    notification?: string | null
    textNotification?: string | null
    forceSetType?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    if (params.image !== undefined) this.image = params.image
    if (params.lineWidth !== undefined) this.lineWidth = params.lineWidth
    if (params.flagSequence !== undefined) this.flagSequence = params.flagSequence
    if (params.circlesSequence !== undefined) this.circlesSequence = params.circlesSequence
    if (params.cursor !== undefined) this.cursor = params.cursor
    if (params.palette !== undefined) this.palette = params.palette
    if (params.isPlayerPalette !== undefined) this.isPlayerPalette = params.isPlayerPalette
    this.path = params.path ?? []
    if (params.notification !== undefined) this.notification = params.notification
    if (params.textNotification !== undefined) this.textNotification = params.textNotification
    if (params.forceSetType !== undefined) this.forceSetType = params.forceSetType
  }
}

// ---------------------------------------------------------------------------
// RallyPoint
// OpenRA 对照: RallyPoint class
// ---------------------------------------------------------------------------

/** Defines a rally point for units produced by a building.
 *
 * OpenRA 对照: RallyPoint
 *
 * Implements INotifyOwnerChanged, INotifyCreated, INotifyAddedToWorld,
 * INotifyRemovedFromWorld. The Path is a list of CPos cells that units
 * will move to after production.
 */
export class RallyPoint implements INotifyOwnerChanged, INotifyCreated, INotifyAddedToWorld, INotifyRemovedFromWorld {
  /** The configuration info for this trait. */
  readonly info: RallyPointInfo

  /** Current rally point path (world cells). */
  path: CPos[] = []

  /** Resolved palette name. */
  paletteName: string

  /** The building's current location (for offset resolution).
   * @deprecated Currently stored but not directly read; used by resetPath.
   */
  // @ts-expect-error: stored for resetPath usage
  private _location: CPos = CPos.Zero

  constructor(info: RallyPointInfo, location: CPos = CPos.Zero, ownerName: string = '') {
    this.info = info
    this._location = location
    this.paletteName = info.isPlayerPalette ? info.palette + ownerName : info.palette
    this.resetPath(location)
  }

  /** Reset the path to the initial offsets.
   *
   * OpenRA 对照: RallyPoint.ResetPath(Actor)
   *
   * @param location — the building's current location
   */
  resetPath(location: CPos): void {
    this._location = location
    this.path = []
    for (const offset of this.info.path) {
      this.path.push(new CPos(location.X + offset.X, location.Y + offset.Y, location.Layer))
    }
  }

  /** Set the rally point to a specific cell.
   *
   * @param cell — the target cell
   * @param append — if true, append to path; if false, replace path
   */
  setRallyPoint(cell: CPos, append: boolean = false): void {
    if (!append) {
      this.path.length = 0
    }
    this.path.push(cell)
  }

  /** Clear the rally point path.
   */
  clearPath(): void {
    this.path.length = 0
  }

  // ---------------------------------------------------------------------------
  // INotifyOwnerChanged
  // ---------------------------------------------------------------------------

  /** Called when the actor's owner changes.
   *
   * OpenRA 对照: RallyPoint.OnOwnerChanged(Actor, Player, Player)
   *
   * NOTE: `newOwner.playerName` is used as a stub for `Player.InternalName`.
   * In the full implementation, Player would have an `internalName` field
   * matching C# `Player.Faction.InternalName`.
   */
  onOwnerChanged(_actor: IGameActor, _oldOwner: PlayerStub, newOwner: PlayerStub): void {
    if (this.info.isPlayerPalette) {
      this.paletteName = this.info.palette + newOwner.playerName
    }
    // Path is reset on owner change in full implementation
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // ---------------------------------------------------------------------------

  /** Called when the actor is fully created.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor)
   */
  created(_actor: IGameActor): void {
    // In full implementation: create RallyPointIndicator effect
  }

  // ---------------------------------------------------------------------------
  // INotifyAddedToWorld / INotifyRemovedFromWorld
  // ---------------------------------------------------------------------------

  /** Called when the actor is added to the world.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor)
   */
  addedToWorld(_actor: IGameActor): void {
    // In full implementation: add effect to world
  }

  /** Called when the actor is removed from the world.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   */
  removedFromWorld(_actor: IGameActor): void {
    // In full implementation: remove effect from world
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /** Check if an order is a force-set rally point order.
   *
   * OpenRA 对照: RallyPoint.IsForceSet(Order)
   *
   * @param orderName — the order name to check
   * @param extraData — the order extra data
   * @returns true if this is a force-set order
   */
  static isForceSet(orderName: string, extraData: number): boolean {
    return orderName === 'SetRallyPoint' && extraData === 1
  }
}
