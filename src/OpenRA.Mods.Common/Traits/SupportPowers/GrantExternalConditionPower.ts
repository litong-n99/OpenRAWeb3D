/**
 * GrantExternalConditionPower.ts — 外部条件授予支援能力（区域效果）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/GrantExternalConditionPower.cs (178 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<GrantExternalConditionPowerInfo> → TS 继承 SupportPower
 * - C# footprint char[] filtering (char.IsWhiteSpace) → TS string 处理
 * - C# HashSet<Actor> deduplication → TS Set<IGameActor>
 * - C# ActorMap.GetActorsAt(tile) → TS 桩（actor map 空间查询）
 * - C# TraitsImplementing<ExternalCondition>() LINQ chains → TS 遍历组件数组
 * - C# ISelectionDecorations rendering → TS 桩（红色高亮 deferred）
 * - C# SpriteRenderable footprint overlay → TS 桩（footprint 纹理 deferred）
 * - C# WithSpriteBody.PlayCustomAnimation → TS WithSpriteBody 动画桩
 * - C# Game.Sound.Play(SoundType.World, OnFireSound, ...) → TS 音频桩
 * - C# ValidRelationships.HasRelationship(…) → TS 关系检查
 *
 * GrantExternalConditionPower applies an ExternalCondition to all eligible
 * actors within a configurable footprint area. During targeting, actors
 * inside the footprint are highlighted. On activation, a WithSpriteBody
 * animation is played on the granting actor.
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import {
  SupportPower,
  type SupportPowerInfo,
  type ISupportPowerManager,
  type OrderStub,
} from './SupportPower.js'
import type { SupportPowerManager } from './SupportPowerManager.js'

// ---------------------------------------------------------------------------
// ExternalCondition stub interface
// ---------------------------------------------------------------------------

/** Forward reference to ExternalCondition trait from Ch3.
 *
 * OpenRA 对照: ExternalCondition (ConditionManager system)
 *
 * Only the methods needed by GrantExternalConditionPower are exposed.
 */
export interface IExternalCondition {
  /** The condition configuration. */
  readonly info: { readonly condition: string }
  /** Whether this trait can grant its condition to the given actor. */
  canGrantCondition(self: IGameActor): boolean
  /** Grant the condition to a target actor.
   *
   * OpenRA 对照: ExternalCondition.GrantCondition(Actor, Actor, int)
   */
  grantCondition(
    target: IGameActor,
    source: IGameActor,
    duration: number,
  ): void
}

// ---------------------------------------------------------------------------
// Stub interfaces for WithSpriteBody
// ---------------------------------------------------------------------------

/** Forward reference to WithSpriteBody trait from Ch7 Phase G. */
export interface IWithSpriteBody {
  /** The default animation, used for sequence checking. */
  readonly defaultAnimation?: { hasSequence(sequence: string): boolean } | null
  /** Play a custom animation sequence.
   *
   * OpenRA 对照: WithSpriteBody.PlayCustomAnimation(Actor, string, Action?)
   */
  playCustomAnimation(self: IGameActor, sequence: string): void
}

// ---------------------------------------------------------------------------
// GrantExternalConditionPowerInfo
// OpenRA 对照: GrantExternalConditionPowerInfo : SupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for GrantExternalConditionPower.
 *
 * OpenRA 对照: GrantExternalConditionPowerInfo
 *
 * Defines the condition to apply, footprint dimensions/pattern, visual
 * feedback (animation sequence, on-fire sound, footprint overlay).
 */
export interface GrantExternalConditionPowerInfo extends SupportPowerInfo {
  /** The condition to apply (required). Must be in the target's ExternalConditions list.
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.Condition
   */
  readonly condition: string

  /** Duration of the condition in ticks. 0 = permanent.
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.Duration (default 0)
   */
  readonly duration?: number

  /** Size of the footprint of the affected area (required).
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.Dimensions (CVec)
   */
  readonly dimensions: CVec

  /** Actual footprint pattern. Cells marked as 'x' will be affected (required).
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.Footprint
   */
  readonly footprint: string

  /** Sound to instantly play at the targeted area.
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.OnFireSound
   */
  readonly onFireSound?: string | null

  /** Player relationships which condition can be applied to (default Ally).
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.ValidRelationships
   */
  readonly validRelationships?: PlayerRelationship

  /** Sequence to play for granting actor when activated.
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.Sequence (default "active")
   */
  readonly sequence?: string

  /** Image for the footprint overlay during targeting.
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.FootprintImage
   */
  readonly footprintImage?: string

  /** Sequence for the footprint overlay during targeting.
   *
   * OpenRA 对照: GrantExternalConditionPowerInfo.FootprintSequence
   */
  readonly footprintSequence?: string
}

// ---------------------------------------------------------------------------
// PlayerRelationship enum
// OpenRA 对照: OpenRA.PlayerRelationship (flags enum)
// ---------------------------------------------------------------------------

/** Player relationship flags for filtering target actors.
 *
 * OpenRA 对照: PlayerRelationship (enum with HasRelationship)
 */
export const PlayerRelationship = {
  None: 0,
  Enemy: 1,
  Neutral: 2,
  Ally: 4,
} as const

export type PlayerRelationship = (typeof PlayerRelationship)[keyof typeof PlayerRelationship]

/** Default valid relationships for GrantExternalConditionPower. */
export const DEFAULT_VALID_RELATIONSHIPS: PlayerRelationship = PlayerRelationship.Ally

// ---------------------------------------------------------------------------
// GrantExternalConditionPower
// OpenRA 对照: GrantExternalConditionPower : SupportPower
// ---------------------------------------------------------------------------

/**
 * Support power that grants an ExternalCondition to actors in a footprint area.
 *
 * OpenRA 对照: GrantExternalConditionPower
 *
 * On activation: plays a WithSpriteBody animation, plays OnFireSound,
 * and applies the condition to all eligible actors within the footprint.
 */
export class GrantExternalConditionPower extends SupportPower {
  /** Typed info reference.
   *
   * OpenRA 对照: GrantExternalConditionPower.info
   */
  get conditionInfo(): GrantExternalConditionPowerInfo {
    return this.info as unknown as GrantExternalConditionPowerInfo
  }

  /** Parsed footprint pattern (non-whitespace characters).
   *
   * OpenRA 对照: GrantExternalConditionPower.footprint (char[])
   */
  readonly footprint: string[]

  constructor(self: IGameActor, info: GrantExternalConditionPowerInfo) {
    super(self, info)
    // Parse footprint: filter out whitespace characters
    this.footprint = info.footprint ? info.footprint.split('').filter((c) => !/\s/.test(c)) : []
  }

  // -----------------------------------------------------------------------
  // Targeting
  // -----------------------------------------------------------------------

  /**
   * Enter targeting mode — creates SelectConditionTarget.
   *
   * OpenRA 对照: GrantExternalConditionPower.SelectTarget(Actor, string, SupportPowerManager)
   */
  override selectTarget(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: In OpenRA:
    //   self.World.OrderGenerator = new SelectConditionTarget(Self.World, order, manager, this);
    this._setConditionOrderGenerator(self, order, manager)
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the condition grant power.
   *
   * OpenRA 对照: GrantExternalConditionPower.Activate(Actor, Order, SupportPowerManager)
   *
   * Plays launch sounds, plays WithSpriteBody animation, plays OnFireSound,
   * and grants the condition to all eligible actors in the footprint.
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)
    this.playLaunchSounds()

    const position = order.target?.centerPosition
    const targetCell = position
      ? this._cellContaining(position)
      : (order.target?.cell ?? null)

    // Play WithSpriteBody animation
    this._playActivationAnimation(self)

    // Play OnFireSound at target position
    if (this.conditionInfo.onFireSound) {
      // NOTE: Game.Sound.Play(SoundType.World, info.OnFireSound, order.Target.CenterPosition)
      this.playPowerSoundLocal(this.conditionInfo.onFireSound)
    }

    // Grant condition to all eligible actors in range
    if (targetCell) {
      const units = this.unitsInRange(self, targetCell)
      for (const a of units) {
        this._grantConditionToActor(self, a)
      }
    }
  }

  // -----------------------------------------------------------------------
  // UnitsInRange — spatial query
  // -----------------------------------------------------------------------

  /**
   * Find all eligible actors within the footprint centered at xy.
   *
   * OpenRA 对照: GrantExternalConditionPower.UnitsInRange(CPos)
   *
   * Resolves footprint cells, queries ActorMap, deduplicates, and filters
   * by ValidRelationships and condition eligibility.
   *
   * @param self — the granting actor
   * @param xy — the center cell position
   * @returns array of eligible actors
   */
  unitsInRange(self: IGameActor, xy: CPos): IGameActor[] {
    // Resolve footprint cells
    const tiles = SupportPower.cellsMatching(xy, this.footprint, this.conditionInfo.dimensions)

    // Query actors at each tile (deduplicate via Set)
    const units = new Set<IGameActor>()
    for (const t of tiles) {
      const actorsAtTile = this._getActorsAtTile(self, t)
      for (const a of actorsAtTile) {
        units.add(a)
      }
    }

    // Filter by ValidRelationships and condition eligibility
    const relationship = this.conditionInfo.validRelationships ?? DEFAULT_VALID_RELATIONSHIPS

    return Array.from(units).filter((a) => {
      if (!a.owner) return false
      if (!self.owner) return false

      // Check player relationship
      const rel = this._relationshipWith(self.owner, a.owner)
      if ((relationship & rel) === 0) return false

      // Check condition eligibility
      return this._canGrantCondition(self, a)
    })
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Play the WithSpriteBody activation animation on the granting actor.
   */
  protected _playActivationAnimation(self: IGameActor): void {
    // Find WithSpriteBody trait
    const wsb = this._getWithSpriteBody(self)
    if (!wsb) return

    // Check if the sequence exists in the default animation
    const sequence = this.conditionInfo.sequence ?? 'active'
    if (wsb.defaultAnimation && wsb.defaultAnimation.hasSequence(sequence)) {
      wsb.playCustomAnimation(self, sequence)
    }
  }

  /**
   * Get the WithSpriteBody trait from the actor.
   */
  protected _getWithSpriteBody(_self: IGameActor): IWithSpriteBody | null {
    // NOTE: self.TraitOrDefault<WithSpriteBody>()
    // Stubbed — real implementation requires trait lookup from Ch7 Phase G.
    return null
  }

  /**
   * Convert world position to a map cell.
   */
  protected _cellContaining(
    _position: { readonly X: number; readonly Y: number; readonly Z: number },
  ): CPos | null {
    // NOTE: Map.CellContaining(position) — deferred
    return new CPos(512, 512)
  }

  /**
   * Get actors at a specific tile (ActorMap spatial query).
   */
  protected _getActorsAtTile(_self: IGameActor, _tile: CPos): IGameActor[] {
    // NOTE: self.World.ActorMap.GetActorsAt(tile)
    // Stubbed — real ActorMap deferred.
    return []
  }

  /**
   * Determine the relationship between two players as a bitmask.
   */
  protected _relationshipWith(
    _owner: PlayerStub,
    _other: PlayerStub,
  ): PlayerRelationship {
    // NOTE: owner.RelationshipWith(other)
    // Stubbed — returns Ally by default.
    return PlayerRelationship.Ally
  }

  /**
   * Check if the condition can be granted to a target actor.
   */
  protected _canGrantCondition(_self: IGameActor, target: IGameActor): boolean {
    if (!target.traitsImplementing) return false
    const traits = target.traitsImplementing('ExternalCondition') as IExternalCondition[]
    return traits.some(
      (t) =>
        t.info.condition === this.conditionInfo.condition &&
        t.canGrantCondition(_self),
    )
  }

  /**
   * Grant the condition to a specific target actor.
   */
  protected _grantConditionToActor(self: IGameActor, target: IGameActor): void {
    if (!target.traitsImplementing) return
    const traits = target.traitsImplementing('ExternalCondition') as IExternalCondition[]
    const trait = traits.find(
      (t) =>
        t.info.condition === this.conditionInfo.condition &&
        t.canGrantCondition(self),
    )
    if (trait) {
      const duration = this.conditionInfo.duration ?? 0
      trait.grantCondition(target, self, duration)
    }
  }

  /**
   * Set the condition-specific OrderGenerator.
   */
  protected _setConditionOrderGenerator(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: Creates SelectConditionTarget(self.World, order, manager, this)
    this.setOrderGenerator(self, order, manager, this.conditionInfo)
  }
}

// ---------------------------------------------------------------------------
// SelectConditionTarget
// OpenRA 对照: SelectConditionTarget : OrderGenerator (nested in GrantExternalConditionPower)
// ---------------------------------------------------------------------------

/**
 * OrderGenerator for condition grant power targeting.
 *
 * OpenRA 对照: SelectConditionTarget
 *
 * Renders footprint overlay tiles at mouse position, highlights targetable
 * actors in red, and validates cursor based on UnitsInRange result.
 */
export class SelectConditionTarget {
  /** The power key for order generation. */
  readonly orderKey: string

  private readonly manager: SupportPowerManager
  private readonly power: GrantExternalConditionPower

  constructor(
    order: string,
    manager: SupportPowerManager,
    power: GrantExternalConditionPower,
  ) {
    this.orderKey = order
    this.manager = manager
    this.power = power
  }

  /**
   * Generate an order for a cell click.
   *
   * OpenRA 对照: SelectConditionTarget.OrderInner(World, CPos, int2, MouseInput)
   *
   * Yields an Order if any eligible unit is within the footprint.
   *
   * @param self — the granting actor (needed for UnitsInRange)
   * @param cell — the map cell under the cursor
   * @returns an Order, or null if the cell is invalid
   */
  generateOrder(self: IGameActor, cell: CPos): OrderStub | null {
    const units = this.power.unitsInRange(self, cell)
    if (units.length === 0) return null

    return {
      orderName: this.orderKey,
      targetString: null,
      target: {
        cell,
        type: 2, // TargetType.Terrain
        centerPosition: null,
      },
    }
  }

  /**
   * Tick — cancel targeting if power becomes unavailable.
   *
   * OpenRA 对照: SelectConditionTarget.Tick(World)
   *
   * @returns true if targeting is still valid
   */
  tick(): boolean {
    const instance = this.manager.powers.get(this.orderKey)
    if (!instance || !instance.active || !instance.ready) {
      return false
    }
    return true
  }

  /**
   * Get cursor string for a cell.
   *
   * OpenRA 对照: SelectConditionTarget.GetCursor(World, CPos, int2, MouseInput)
   *
   * @param self — the granting actor
   * @param cell — the map cell under the cursor
   * @returns cursor name string
   */
  getCursor(self: IGameActor, cell: CPos): string {
    const units = this.power.unitsInRange(self, cell)
    const info = this.power.conditionInfo
    return units.length > 0
      ? (info.cursor ?? 'ability')
      : (info.blockedCursor ?? 'ability-blocked')
  }

  /**
   * Get the footprint cells at a given center position (for rendering).
   *
   * @param xy — the center cell position
   * @returns array of cell positions within the footprint
   */
  getFootprintCells(xy: CPos): CPos[] {
    const info = this.power.conditionInfo
    return SupportPower.cellsMatching(
      xy,
      this.power.footprint,
      info.dimensions,
    )
  }
}
