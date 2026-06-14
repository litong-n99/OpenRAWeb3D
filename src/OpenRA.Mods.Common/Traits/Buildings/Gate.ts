/**
 * Gate.ts — 动画大门：友军通过时打开，自动关闭
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/Gate.cs (147 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<GateInfo> → TS ConditionalTrait<GateInfo>
 *   (ConditionalTrait 已包含 _paused 字段支持暂停状态)
 * - C# Building building = self.Trait<Building>() → TS duck-type trait 查找
 * - C# IEnumerable<CPos> Footprint → TS readonly CPos[]
 * - C# IEnumerable<CPos> blockedPositions → TS CPos[]
 * - C# Game.Sound.Play(SoundType.World, ...) → TS 桩 (TODO-8.F)
 * - C# self.World.ActorMap.AddInfluence/RemoveInfluence → TS world.actorMap 桩
 *   (BuildingInfluence.addInfluence/removeInfluence 已迁移)
 * - C# WDist BlocksProjectilesHeight → TS WDist
 * - C# PlayerRelationship enum flags → TS number bitmask
 * - C# ActorMap.GetActorsAt / IsBlocked → TS 通过 world 的 actorMap 访问
 * - C# AppearsFriendlyTo → TS 辅助函数
 */

import type { WDist } from '../../../OpenRA.Game/WDist.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import {
  ConditionalTrait,
  PlayerRelationship,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  ITick,
  ITemporaryBlocker,
  INotifyBlockingMove,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  ISync,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IBlocksProjectiles } from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// Helper: AppearsFriendlyTo
// OpenRA 对照: ActorExts.AppearsFriendlyTo(this Actor self, Actor toActor)
// ---------------------------------------------------------------------------

/**
 * 检查一个 actor 对另一个 actor 是否显示为友好。
 *
 * OpenRA 对照: ActorExts.AppearsFriendlyTo(this Actor self, Actor toActor)
 *
 * @param self — 被检查的 actor
 * @param toActor — 观察者 actor
 * @returns 如果 self 的拥有者与 toActor 的拥有者结盟，返回 true
 */
function appearsFriendlyTo(self: IGameActor, toActor: IGameActor): boolean {
  const selfOwner = self.owner
  const toOwner = toActor.owner
  if (!selfOwner || !toOwner) return false

  const toPlayer = toOwner as unknown as {
    relationshipWith?(other: unknown): PlayerRelationship
  }

  if (toPlayer.relationshipWith) {
    const stance = toPlayer.relationshipWith(selfOwner)
    return stance === PlayerRelationship.Ally
  }

  return false
}

// ---------------------------------------------------------------------------
// Forward interface: Building trait (duck-typed)
// OpenRA 对照: Building (subset used by Gate)
// ---------------------------------------------------------------------------

/** Minimal Building interface for Gate's footprint queries.
 *
 * OpenRA 对照: Building.Info.Tiles(self.Location)
 */
interface IBuildingForward {
  info: {
    tiles(location: CPos): readonly { cell: CPos; subCell: number }[]
  }
  location: CPos
}

// ---------------------------------------------------------------------------
// Forward interface: ActorMap (duck-typed)
// OpenRA 对照: IActorMap (subset used by Gate)
// ---------------------------------------------------------------------------

/** Minimal ActorMap interface for Gate's blocking checks.
 *
 * OpenRA 对照: ActorMap.GetActorsAt / AddInfluence / RemoveInfluence
 */
interface IActorMapForward {
  getActorsAt(cell: CPos): readonly IGameActor[]
  addInfluence(actor: IGameActor, cells: readonly { cell: CPos; subCell: number }[]): void
  removeInfluence(actor: IGameActor, cells: readonly { cell: CPos; subCell: number }[]): void
}

// ---------------------------------------------------------------------------
// GateInfo
// OpenRA 对照: GateInfo : PausableConditionalTraitInfo, ITemporaryBlockerInfo,
//   IBlocksProjectilesInfo, Requires<BuildingInfo>
// ---------------------------------------------------------------------------

/** Configuration for the Gate trait.
 *
 * OpenRA 对照: GateInfo
 *
 * Defines the opening/closing sounds, timing delays, and projectile
 * blocking height for an animated gate building.
 */
export class GateInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Sound to play when the gate opens.
   *
   * OpenRA 对照: OpeningSound (default null)
   */
  readonly openingSound: string | null

  /** Sound to play when the gate closes.
   *
   * OpenRA 对照: ClosingSound (default null)
   */
  readonly closingSound: string | null

  /** Ticks until the gate closes after no blockers.
   *
   * OpenRA 对照: CloseDelay (default 150)
   */
  readonly closeDelay: number

  /** Ticks until the gate is considered open.
   *
   * OpenRA 对照: TransitionDelay (default 33)
   */
  readonly transitionDelay: number

  /** Blocks bullets scaled to open value.
   *
   * OpenRA 对照: BlocksProjectilesHeight (default WDist(640))
   */
  readonly blocksProjectilesHeight: WDist

  /** Determines what projectiles to block based on their allegiance to the gate owner.
   *
   * OpenRA 对照: BlocksProjectilesValidRelationships
   *   (default Ally | Neutral | Enemy)
   */
  readonly blocksProjectilesValidRelationships: PlayerRelationship

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    openingSound?: string | null
    closingSound?: string | null
    closeDelay?: number
    transitionDelay?: number
    blocksProjectilesHeight?: WDist
    blocksProjectilesValidRelationships?: PlayerRelationship
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.openingSound = params.openingSound ?? null
    this.closingSound = params.closingSound ?? null
    this.closeDelay = params.closeDelay ?? 150
    this.transitionDelay = params.transitionDelay ?? 33
    this.blocksProjectilesHeight = params.blocksProjectilesHeight ??
      ({ length: 640, _brand: 'WDist' } as unknown as WDist)
    this.blocksProjectilesValidRelationships =
      params.blocksProjectilesValidRelationships ??
      ((PlayerRelationship.Ally |
        PlayerRelationship.Neutral |
        PlayerRelationship.Enemy) as PlayerRelationship)
  }
}

// ---------------------------------------------------------------------------
// Gate
// OpenRA 对照: Gate : PausableConditionalTrait<GateInfo>, ITick,
//   ITemporaryBlocker, IBlocksProjectiles, INotifyAddedToWorld,
//   INotifyRemovedFromWorld, INotifyBlockingMove, ISync
// ---------------------------------------------------------------------------

/**
 * Animated gate that opens/closes for friendly units.
 *
 * OpenRA 对照: Gate
 *
 * The gate animates between Position=0 (closed) and Position=TransitionDelay
 * (fully open). Friendly units trigger opening via INotifyBlockingMove.
 * After no blockers remain for CloseDelay ticks, the gate automatically closes.
 * While opening/closing, it blocks projectiles with height scaled to position.
 */
export class Gate
  extends ConditionalTrait<GateInfo>
  implements
    ITick,
    ITemporaryBlocker,
    IBlocksProjectiles,
    INotifyBlockingMove,
    INotifyAddedToWorld,
    INotifyRemovedFromWorld,
    ISync
{
  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  /** Current open position (0 = closed, transitionDelay = fully open).
   *
   * OpenRA 对照: Position (public int, [VerifySync])
   */
  position: number

  /** Target open position (0 = closed, transitionDelay = fully open).
   *
   * OpenRA 对照: desiredPosition (int)
   */
  private _desiredPosition: number = 0

  /** Ticks remaining before auto-close.
   *
   * OpenRA 对照: remainingOpenTime (int)
   */
  private _remainingOpenTime: number = 0

  /** The building's footprint cells (resolved from Building trait).
   *
   * OpenRA 对照: Footprint (public readonly IEnumerable<CPos>)
   */
  private _footprint: readonly CPos[] = []

  /** The current blocked positions (empty after RemovedFromWorld).
   *
   * OpenRA 对照: blockedPositions (IEnumerable<CPos>)
   */
  private _blockedPositions: CPos[] = []

  /** Duck-typed Building trait reference. */
  private _building: IBuildingForward | null = null

  /** The fully open position value (= transitionDelay). */
  private readonly _openPosition: number

  constructor(info: GateInfo) {
    super(info)
    this._openPosition = info.transitionDelay
    this.position = this._openPosition
  }

  // -----------------------------------------------------------------------
  // Lifecycle (Component overrides)
  // OpenRA 对照: Gate constructor (ActorInitializer init, GateInfo info)
  // -----------------------------------------------------------------------

  /** Called when the trait is attached to an actor.
   *
   * OpenRA 对照: constructor: building = self.Trait<Building>()
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)

    // Resolve Building trait
    this._building = (actor as unknown as {
      trait?: (name: string) => unknown
    }).trait?.('Building') as IBuildingForward | null

    if (this._building) {
      const location = this._building.location
      this._footprint = this._building.info.tiles(location).map((t) => t.cell)
    }
  }

  /** Called when the trait is detached from its actor. */
  override detach(actor: IGameActor): void {
    super.detach(actor)
    this._building = null
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld
  // OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor self)
  // -----------------------------------------------------------------------

  /** When added to the world, initialize blocked positions from footprint.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor self)
   */
  addedToWorld(self: IGameActor): void {
    // self parameter required by INotifyAddedToWorld interface; not used here
    // because footprint is pre-computed at construction.
    void self
    this._blockedPositions = [...this._footprint]
  }

  // -----------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
  // -----------------------------------------------------------------------

  /** When removed from the world, clear blocked positions.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
   */
  removedFromWorld(_self: IGameActor): void {
    this._blockedPositions = []
  }

  // -----------------------------------------------------------------------
  // ITick.Tick — animate open/close
  // OpenRA 对照: ITick.Tick(Actor self)
  // -----------------------------------------------------------------------

  /**
   * Execute one tick of gate animation.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * Moves Position toward desiredPosition by one unit per tick.
   * Plays sounds when transitions start (opening or closing).
   * Manages the auto-close timer when fully open.
   *
   * @param self — the actor this trait is attached to
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled || this.isTraitPaused) return

    if (this._desiredPosition < this.position) {
      // Gate was fully open → start closing
      if (this.position === this._openPosition) {
        // NOTE: Sound.Play is stubbed.
        // OpenRA C# does:
        //   Game.Sound.Play(SoundType.World, Info.ClosingSound,
        //     self.CenterPosition);
        //
        // TODO-8.F: Wire up to Sound.Play.

        // Add influence when gate starts closing
        const world = self.world as unknown as {
          actorMap?: IActorMapForward
        } | undefined
        if (world?.actorMap && this._building) {
          const cells = this._building.info.tiles(this._building.location)
          world.actorMap.addInfluence(self, cells)
        }
      }

      this.position--
    } else if (this._desiredPosition > this.position) {
      // Gate was fully closed → start opening
      if (this.position === 0) {
        // NOTE: Sound.Play is stubbed.
        // OpenRA C# does:
        //   Game.Sound.Play(SoundType.World, Info.OpeningSound,
        //     self.CenterPosition);
        //
        // TODO-8.F: Wire up to Sound.Play.
      }

      this.position++

      // Gate is now fully open
      if (this.position === this._openPosition) {
        // Remove influence when fully open
        const world = self.world as unknown as {
          actorMap?: IActorMapForward
        } | undefined
        if (world?.actorMap && this._building) {
          const cells = this._building.info.tiles(this._building.location)
          world.actorMap.removeInfluence(self, cells)
        }
        this._remainingOpenTime = this.info.closeDelay
      }
    }

    if (this.position === this._openPosition) {
      if (this._isBlocked(self)) {
        this._remainingOpenTime = this.info.closeDelay
      } else if (--this._remainingOpenTime <= 0) {
        this._desiredPosition = 0
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITemporaryBlocker
  // OpenRA 对照: ITemporaryBlocker.IsBlocking(Actor, CPos)
  // -----------------------------------------------------------------------

  /** Check whether the gate is blocking a specific cell.
   *
   * OpenRA 对照: ITemporaryBlocker.IsBlocking(Actor self, CPos cell)
   *
   * @param _self — the actor this trait is attached to
   * @param cell — the cell to check
   * @returns true if the gate is not fully open and this cell is in the footprint
   */
  isBlocking(self: IGameActor, cell: CPos): boolean {
    // self passed for ITemporaryBlocker conformance (OpenRA: self is used for
    // INotifyBlockingMove in full implementation; not needed for blocking check)
    void self
    return (
      this.position !== this._openPosition &&
      this._blockedPositions.some(
        (c) => c.X === cell.X && c.Y === cell.Y,
      )
    )
  }

  /** Check whether the gate can remove blockage for a specific blocking actor.
   *
   * OpenRA 对照: ITemporaryBlocker.CanRemoveBlockage(Actor self, Actor blocking)
   *
   * @param self — the actor this trait is attached to
   * @param blocking — the blocked actor
   * @returns true if the blockage can be removed
   */
  canRemoveBlockage(self: IGameActor, blocking: IGameActor): boolean {
    return this._canRemoveBlockage(self, blocking)
  }

  // -----------------------------------------------------------------------
  // INotifyBlockingMove
  // OpenRA 对照: INotifyBlockingMove.OnNotifyBlockingMove(Actor self, Actor blocking)
  // -----------------------------------------------------------------------

  /** Notified when another actor is blocked by this gate.
   *
   * OpenRA 对照: INotifyBlockingMove.OnNotifyBlockingMove(Actor self, Actor blocking)
   *
   * If the gate is not fully open and the blocking actor is friendly,
   * the gate begins opening.
   *
   * @param self — the actor this trait is attached to
   * @param blocking — the actor being blocked
   */
  onNotifyBlockingMove(self: IGameActor, blocking: IGameActor): void {
    if (
      this.position !== this._openPosition &&
      this._canRemoveBlockage(self, blocking)
    ) {
      this._desiredPosition = this._openPosition
    }
  }

  // -----------------------------------------------------------------------
  // IBlocksProjectiles
  // OpenRA 对照: IBlocksProjectiles.BlockingHeight, ValidRelationships
  // -----------------------------------------------------------------------

  /** The height at which the gate blocks projectiles, scaled by open position.
   *
   * OpenRA 对照: IBlocksProjectiles.BlockingHeight
   *   → new WDist(Info.BlocksProjectilesHeight.Length * (OpenPosition - Position) / OpenPosition)
   *
   * When fully open (Position === OpenPosition), blocking height is 0.
   * When fully closed (Position === 0), blocking height is full.
   */
  get blockingHeight(): WDist {
    const fullLength = this.info.blocksProjectilesHeight.length
    const openPos = this._openPosition
    if (openPos === 0) return this.info.blocksProjectilesHeight
    const scaledLength = Math.round(
      (fullLength * (openPos - this.position)) / openPos,
    )
    return { length: scaledLength, _brand: 'WDist' } as unknown as WDist
  }

  /** Valid player relationships for projectile blocking.
   *
   * OpenRA 对照: IBlocksProjectiles.ValidRelationships
   */
  get validRelationships(): PlayerRelationship {
    return this.info.blocksProjectilesValidRelationships
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // OpenRA 对照: CanRemoveBlockage, IsBlocked
  // -----------------------------------------------------------------------

  /**
   * Check whether a blockage can be removed for a blocking actor.
   *
   * OpenRA 对照: CanRemoveBlockage(Actor self, Actor blocking)
   *
   * Can remove when: not disabled, not paused, and blocking actor
   * appears friendly to the gate.
   *
   * @param self — the actor this trait is attached to
   * @param blocking — the blocked actor
   * @returns true if the gate can open for this actor
   */
  private _canRemoveBlockage(
    self: IGameActor,
    blocking: IGameActor,
  ): boolean {
    return (
      !this.isTraitDisabled &&
      !this.isTraitPaused &&
      appearsFriendlyTo(blocking, self)
    )
  }

  /**
   * Check whether any other actors are currently in the gate's footprint.
   *
   * OpenRA 对照: IsBlocked()
   *
   * Iterates over all blocked positions and checks if any actor
   * other than self occupies them.
   *
   * @param self — the actor this trait is attached to
   * @returns true if any other actor occupies the gate's cells
   */
  private _isBlocked(self: IGameActor): boolean {
    const world = self.world as unknown as {
      actorMap?: IActorMapForward
    } | undefined

    const actorMap = world?.actorMap
    if (!actorMap) return false

    for (const loc of this._blockedPositions) {
      const actors = actorMap.getActorsAt(loc)
      for (const a of actors) {
        if (a !== self) return true
      }
    }

    return false
  }
}
