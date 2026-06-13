/**
 * AcceptsDeliveredCash.ts — 接收现金交付的 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AcceptsDeliveredCash.cs (50 lines)
 *
 * 核心范式转换:
 * - C# INotifyCashTransfer.OnAcceptingCash/OnDeliveringCash → TS acceptsDelivery() 查询方法
 *   (C# 使用事件通知模式，TS 适配为布尔查询接口，由 DeliversCash 调用)
 * - C# FrozenSet<string> ValidTypes → TS Set<string> (空 = 接受所有类型)
 * - C# ImmutableArray<string> Sounds → TS readonly string[] (声音播放延迟至音频系统集成)
 * - C# PlayerRelationship 枚举 → TS PlayerRelationship + PlayerRelationshipExts
 * - C# Game.Sound.Play() → TODO-10.B.9-SOUND (音频系统集成)
 */

import {
  Component,
  PlayerRelationship,
  PlayerRelationshipExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ITraitInfo,
  IGameActor,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// AcceptsDeliveredCashInfo
// OpenRA 对照: AcceptsDeliveredCashInfo : TraitInfo
// ---------------------------------------------------------------------------

/** 接收现金交付的配置。
 *
 *  OpenRA 对照: AcceptsDeliveredCashInfo
 */
export class AcceptsDeliveredCashInfo implements ITraitInfo {
  readonly instanceName?: string

  /** 接受的交付类型集合。空集 = 接受所有类型。
   *
   *  OpenRA 对照: AcceptsDeliveredCashInfo.ValidTypes (FrozenSet<string>, empty = accept all)
   */
  readonly validTypes: ReadonlySet<string> = new Set()

  /** 交付者需要对接收者拥有的外交关系。
   *
   *  OpenRA 对照: AcceptsDeliveredCashInfo.ValidRelationships (PlayerRelationship, default Ally)
   */
  readonly validRelationships: PlayerRelationship = PlayerRelationship.Ally

  /** 接收现金时播放的音效列表（随机选一个）。
   *
   *  OpenRA 对照: AcceptsDeliveredCashInfo.Sounds (ImmutableArray<string>)
   *
   *  TODO-10.B.9-SOUND: 集成音频系统播放音效
   */
  readonly sounds: readonly string[] = []

  constructor(params: {
    instanceName?: string
    validTypes?: ReadonlySet<string>
    validRelationships?: PlayerRelationship
    sounds?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.validTypes = params.validTypes ?? new Set()
    this.validRelationships = params.validRelationships ?? PlayerRelationship.Ally
    this.sounds = params.sounds ?? []
  }
}

// ---------------------------------------------------------------------------
// AcceptsDeliveredCash
// OpenRA 对照: AcceptsDeliveredCash : INotifyCashTransfer
// ---------------------------------------------------------------------------

/** 接收现金交付的 trait。
 *
 *  OpenRA 对照: AcceptsDeliveredCash
 *
 *  该 trait 标记一个 actor 可以接收 DeliversCash 的现金交付。
 *  通过 acceptsDelivery() 查询方法验证交付类型与外交关系。
 *  与 DeliversCash trait 配合使用（DeliversCash 在交付前调用此查询）。
 */
export class AcceptsDeliveredCash extends Component {
  /** 该 trait 的配置信息。 */
  readonly info: AcceptsDeliveredCashInfo

  constructor(info: AcceptsDeliveredCashInfo) {
    super()
    this.info = info
  }

  // -----------------------------------------------------------------------
  // AcceptsDeliveredCash API
  // -----------------------------------------------------------------------

  /**
   * 检查是否接受来自指定 actor 的现金交付。
   *
   * OpenRA 对照: DeliversCash 中的类型与关系检查逻辑
   *
   * 验证条件:
   * 1. 如果 ValidTypes 非空，type 必须在集合中
   * 2. 交付者与接收者的外交关系必须匹配 ValidRelationships
   *
   * @param type — 交付类型标识（如 "Cash"）
   * @param fromActor — 发起交付的 actor
   * @returns 是否接受该交付
   */
  acceptsDelivery(type: string, fromActor: IGameActor): boolean {
    // 1. Type filter: empty set = accept all types
    if (this.info.validTypes.size > 0 && !this.info.validTypes.has(type)) {
      return false
    }

    // 2. Relationship check
    const self = this._actor
    if (!self || !self.owner || !fromActor.owner) return false

    const relFn = (fromActor.owner as { relationshipWith?: (other: unknown) => number }).relationshipWith
    const relationship: PlayerRelationship = relFn
      ? (relFn(self.owner) as PlayerRelationship)
      : PlayerRelationship.Neutral

    return PlayerRelationshipExts.hasRelationship(
      this.info.validRelationships,
      relationship,
    )
  }

  /**
   * 收到现金交付时触发的回调（替代 C# INotifyCashTransfer.OnAcceptingCash）。
   *
   * OpenRA 对照: INotifyCashTransfer.OnAcceptingCash(Actor, Actor)
   *
   * 在此方法中播放音效。声音播放延迟至音频系统集成。
   *
   * @param _self — 接收现金的 actor（此 trait 所在的 actor）
   * @param _donor — 交付现金的 actor
   *
   * TODO-10.B.9-SOUND: 集成音频系统播放 info.Sounds 中的随机音效
   */
  onAcceptingCash(_self: IGameActor, _donor: IGameActor): void {
    // C#: if (info.Sounds.Length > 0)
    //        Game.Sound.Play(SoundType.World, info.Sounds, self.World, self.CenterPosition);
    //
    // Sound playback deferred to audio system integration.
    // The sound files are available in info.sounds (readonly string[]).
    void this.info.sounds.length // mark as used for future integration
  }
}
