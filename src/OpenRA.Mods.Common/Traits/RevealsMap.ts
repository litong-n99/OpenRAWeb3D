/**
 * RevealsMap.ts — 全图揭示/地图探测 trait（条件满足时揭示整个地图的迷雾和战争迷雾）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/RevealsMap.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<RevealsMapInfo> → TS ConditionalTrait<RevealsMapInfo>
 * - C# explicit interface implementations (INotifyKilled, INotifyActorDisposing,
 *   INotifyOwnerChanged) → TS implements 子句
 * - C# self.World.Map.ProjectedCells → TS (self.world as any).map.projectedCells
 * - C# player.Shroud.AddSource/RemoveSource → TS player.shroud.addSource/removeSource
 * - C# Shroud.SourceType enum → TS SourceType const object
 * - C# ValidRelationships.HasRelationship() → TS PlayerRelationshipExts.hasRelationship()
 *
 * NOTE: RevealsMap 不继承 AffectsShroud，而是直接继承 ConditionalTrait。
 *       这是一个独立的 trait，仅通过条件系统切换全图可见性。
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyKilled,
  type INotifyActorDisposing,
  type INotifyOwnerChanged,
  type AttackInfo,
  type PlayerStub,
  PlayerRelationship,
  PlayerRelationshipExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PPos } from '../../OpenRA.Game/MPos.js'
import { SourceType } from '../../OpenRA.Game/Traits/Player/Shroud.js'
import type { Player } from '../../OpenRA.Game/Player.js'
import type { Map as GameMap } from '../../OpenRA.Game/Map/Map.js'

// ---------------------------------------------------------------------------
// RevealsMapInfo（对应 OpenRA RevealsMapInfo）
// ---------------------------------------------------------------------------

/**
 * 全图揭示 trait 的配置。
 *
 * OpenRA 对照: RevealsMapInfo : ConditionalTraitInfo
 *
 * 当满足条件表达式时，为所有满足外交关系的玩家揭示整张地图。
 */
export class RevealsMapInfo implements ConditionalTraitInfo {
  /** Optional instance name for trait disambiguation. */
  readonly instanceName?: string

  /** Optional condition expression that must be satisfied for the trait to be active. */
  readonly requiresCondition?: string

  /**
   * 谁可以看到此番揭示（关系掩码，按位检查）。
   *
   * OpenRA 对照: ValidRelationships（默认 PlayerRelationship.Ally）
   */
  readonly validRelationships: PlayerRelationship = PlayerRelationship.Ally

  /**
   * 是否可以揭示由 CreatesShroud trait 生成的迷雾。
   *
   * OpenRA 对照: RevealGeneratedShroud（默认 true）
   */
  readonly revealGeneratedShroud: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    validRelationships?: PlayerRelationship
    revealGeneratedShroud?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    if (params.validRelationships !== undefined) this.validRelationships = params.validRelationships
    if (params.revealGeneratedShroud !== undefined) this.revealGeneratedShroud = params.revealGeneratedShroud
  }
}

// ---------------------------------------------------------------------------
// RevealsMap（对应 OpenRA RevealsMap）
// ---------------------------------------------------------------------------

/**
 * 条件满足时揭示整张地图。
 *
 * OpenRA 对照: RevealsMap : ConditionalTrait<RevealsMapInfo>
 *
 * 当条件表达式满足（trait 启用）时，将地图上所有投射单元格作为可见性源
 * 添加到每个满足外交关系的玩家的迷雾中。当条件不再满足或 actor 死亡、
 * 所有者变更时，移除可见性源。
 *
 * SourceType 由 revealGeneratedShroud 决定：
 * - true → SourceType.Visibility（可见性 + CreatesShroud 生成的迷雾）
 * - false → SourceType.PassiveVisibility（仅正常可见区域）
 */
export class RevealsMap
  extends ConditionalTrait<RevealsMapInfo>
  implements INotifyKilled, INotifyActorDisposing, INotifyOwnerChanged
{
  /** 基于 revealGeneratedShroud 配置预设的可见性源类型。*/
  private readonly _sourceType: SourceType

  constructor(info: RevealsMapInfo) {
    super(info)
    this._sourceType = info.revealGeneratedShroud
      ? SourceType.Visibility
      : SourceType.PassiveVisibility
  }

  // -------------------------------------------------------------------------
  // Protected helpers（对应 OpenRA protected 方法）
  // -------------------------------------------------------------------------

  /**
   * 获取整张地图的投射单元格数组。
   *
   * OpenRA 对照: RevealsMap.ProjectedCells(Actor)
   *
   * @param self — 此 trait 挂载到的 actor
   * @returns 所有投射单元格的只读数组，如果地图不可用则返回空数组
   */
  protected _projectedCells(self: IGameActor): readonly PPos[] {
    const map = this._getMap(self)
    if (!map) return RevealsMap._EMPTY_CELLS
    return map.projectedCells
  }

  /**
   * 为指定玩家添加可见性源。
   *
   * OpenRA 对照: RevealsMap.AddCellsToPlayerShroud(Actor, Player, PPos[])
   *
   * 仅当 actor 所有者与 target 玩家之间有有效关系时才添加源。
   *
   * @param self — 此 trait 挂载到的 actor
   * @param player — 要修改其迷雾的玩家
   * @param cells — 作为可见性区域添加的投射单元格
   */
  protected _addCellsToPlayerShroud(
    self: IGameActor,
    player: Player,
    cells: readonly PPos[],
  ): void {
    const owner = self.owner as Player | null | undefined
    if (!owner) return

    const relationship = owner.relationshipWith(player)
    if (!PlayerRelationshipExts.hasRelationship(this.info.validRelationships, relationship)) {
      return
    }

    player.shroud.addSource(this, this._sourceType, cells)
  }

  /**
   * 为指定玩家移除此 actor 的可见性贡献。
   *
   * OpenRA 对照: RevealsMap.RemoveCellsFromPlayerShroud(Player)
   *
   * @param player — 要修改其迷雾的玩家
   */
  protected _removeCellsFromPlayerShroud(player: Player): void {
    player.shroud.removeSource(this)
  }

  // -------------------------------------------------------------------------
  // Source management（对应 OpenRA source 批量管理）
  // -------------------------------------------------------------------------

  /**
   * 为所有玩家添加可见性源。
   *
   * OpenRA 对照: TraitEnabled(Actor) 中的逻辑
   *
   * @param self — 此 trait 挂载到的 actor
   */
  private _addSourceToAllPlayers(self: IGameActor): void {
    const cells = this._projectedCells(self)
    const players = this._getPlayers(self)
    if (!players) return

    for (const p of players) {
      this._addCellsToPlayerShroud(self, p, cells)
    }
  }

  /**
   * 为所有玩家移除可见性源。
   *
   * OpenRA 对照: TraitDisabled(Actor) 中的逻辑
   */
  private _removeSourceFromAllPlayers(self: IGameActor): void {
    const players = this._getPlayers(self)
    if (!players) return

    for (const p of players) {
      this._removeCellsFromPlayerShroud(p)
    }
  }

  // -------------------------------------------------------------------------
  // ConditionalTrait 重写（对应 OpenRA override TraitEnabled / TraitDisabled）
  // -------------------------------------------------------------------------

  /**
   * trait 启用时调用 —— 揭示整张地图。
   *
   * OpenRA 对照: TraitEnabled(Actor)
   */
  protected override traitEnabled(self: IGameActor): void {
    super.traitEnabled(self)
    this._addSourceToAllPlayers(self)
  }

  /**
   * trait 禁用时调用 —— 移除地图揭示。
   *
   * OpenRA 对照: TraitDisabled(Actor)
   */
  protected override traitDisabled(self: IGameActor): void {
    this._removeSourceFromAllPlayers(self)
    super.traitDisabled(self)
  }

  // -------------------------------------------------------------------------
  // INotifyOwnerChanged（对应 OpenRA OnOwnerChanged）
  // -------------------------------------------------------------------------

  /**
   * actor 所有者变更时调用。
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   *
   * 如果 trait 未禁用，则为所有玩家移除并重新添加源（所有者可能影响
   * 关系检查）。
   */
  onOwnerChanged(self: IGameActor, _oldOwner: PlayerStub, _newOwner: PlayerStub): void {
    if (this.isTraitDisabled) return

    const cells = this._projectedCells(self)
    const players = this._getPlayers(self)
    if (!players) return

    for (const p of players) {
      this._removeCellsFromPlayerShroud(p)
      this._addCellsToPlayerShroud(self, p, cells)
    }
  }

  // -------------------------------------------------------------------------
  // INotifyActorDisposing（对应 OpenRA Disposing）
  // -------------------------------------------------------------------------

  /**
   * actor 正在被销毁时调用。
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
   */
  disposing(self: IGameActor): void {
    this._removeSourceFromAllPlayers(self)
  }

  // -------------------------------------------------------------------------
  // INotifyKilled（对应 OpenRA Killed）
  // -------------------------------------------------------------------------

  /**
   * actor 被击杀时调用。
   *
   * OpenRA 对照: INotifyKilled.Killed(Actor, AttackInfo)
   */
  killed(self: IGameActor, _attackInfo: AttackInfo): void {
    this._removeSourceFromAllPlayers(self)
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /** 释放资源。*/
  override dispose(): void {
    super.dispose()
  }

  // -------------------------------------------------------------------------
  // Internal helpers（对应 OpenRA 世界/玩家访问）
  // -------------------------------------------------------------------------

  /** 从 actor 的世界获取游戏地图。
   *
   * 如果世界或地图尚不可用（例如在测试中）则返回 null。
   */
  private _getMap(self: IGameActor): GameMap | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    if (!world || !world.map) return null
    return world.map as GameMap
  }

  /** 获取世界中的所有玩家。
   *
   * 如果世界尚不可用则返回 null。
   */
  private _getPlayers(self: IGameActor): readonly Player[] | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    if (!world || !world.players) return null
    return world.players as readonly Player[]
  }

  /** 预分配的用于地图不可用时的空数组。*/
  private static readonly _EMPTY_CELLS: readonly PPos[] = Object.freeze([])
}
