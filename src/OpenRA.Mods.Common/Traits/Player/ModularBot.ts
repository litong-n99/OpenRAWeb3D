/**
 * ModularBot.ts — Bot that uses BotModules (thin middleware bridging BotModules to tick system)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/ModularBot.cs
 *
 * 核心范式转换:
 * - C# ITick.Tick(Actor self) → TypeScript ITick.tick(actor: IGameActor)
 * - C# IBot.QueueOrder(Order) → TypeScript IBot.queueOrder(order: Order)
 * - C# INotifyDamage.Damaged(Actor, AttackInfo) → TypeScript INotifyDamage.damaged(actor, e)
 * - C# Sync.RunUnsynced() for bot tick → TypeScript direct synchronous call (JS single-threaded)
 * - C# TraitInfo.Create(ActorInitializer) → TypeScript constructor(info) with world from PlayerActor
 * - C# Reflection: TraitsImplementing<IBotTick>() → TypeScript traitDict.traitsImplementing()
 *
 * ModularBot is NOT a full AI — it is thin middleware that:
 * 1. Discovers all IBotTick + IBotRespondToAttack traits on the PlayerActor
 * 2. Dispatches tick() to each IBotTick module (rate-limited in shellmap mode per ADR-26.3)
 * 3. Dispatches damaged() to each IBotRespondToAttack module
 * 4. Manages an order queue with MinOrderQuotient-based batching per tick
 * 5. Activates all IBotEnabled modules when the bot is enabled
 *
 * ADR-26.3: In shellmap mode, AI ITick fires every 10 game ticks instead of every tick.
 * This is configurable via the static SHELLMAP_TICK_INTERVAL constant.
 */

import {
  Component,
  type IGameActor,
  type ITick,
  type INotifyDamage,
  type IBot,
  type IBotInfo,
  type IBotTick,
  type IBotEnabled,
  type IBotRespondToAttack,
  type PlayerStub,
  type AttackInfo,
  type Order,
  type WorldStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { TraitDictionary } from '../../../OpenRA.Game/TraitDictionary.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Interval for shellmap AI tick rate limiting (ADR-26.3).
 *
 * In shellmap mode, the AI ticks every 10 game ticks instead of every tick.
 * Reduces CPU/GPU load for the decorative menu background.
 *
 * OpenRA 对照: N/A (OpenRA does not rate-limit shellmap AI — this is a
 * migration optimization for Web platform)
 */
const SHELLMAP_TICK_INTERVAL = 10

// ---------------------------------------------------------------------------
// ModularBotInfo — configuration for ModularBot (对应 OpenRA ModularBotInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for ModularBot, read from PlayerActor ruleset YAML/JSON.
 *
 * OpenRA 对照: ModularBotInfo : TraitInfo, IBotInfo
 *
 * Roles:
 * - type: internal bot identifier (e.g., "harvester", "rush")
 * - name: human-readable bot display name
 * - minOrderQuotientPerTick: minimum fraction of pending orders to issue per tick
 *   (e.g., 5 means at least 1/5th of pending orders are issued each tick)
 */
export interface ModularBotInfo extends IBotInfo {
  /** Internal identifier for this bot type.
   *
   * OpenRA 对照: ModularBotInfo.Type
   */
  readonly type: string

  /** Human-readable display name for this bot.
   *
   * OpenRA 对照: ModularBotInfo.Name
   */
  readonly name: string

  /** Minimum portion of pending orders to issue each tick.
   *
   * OpenRA 对照: ModularBotInfo.MinOrderQuotientPerTick
   *
   * Defaults to 5 (at least 1/5th of pending orders issued per tick).
   * Excess orders remain queued for subsequent ticks.
   */
  readonly minOrderQuotientPerTick: number
}

// ---------------------------------------------------------------------------
// GameWorldManager stub — the subset of World used by ModularBot
// ---------------------------------------------------------------------------

/**
 * Minimal world interface consumed by ModularBot.
 *
 * The world reference is obtained from the PlayerActor's `.world` property,
 * which is set during World._createPlayers(). The world provides:
 * - type: used for shellmap rate-limiting check (ADR-26.3)
 * - traitDict: used for discovering BotModule traits on PlayerActor
 * - issueOrder(order): used for issuing queued orders
 */
interface ModularBotWorld {
  readonly type: string
  readonly traitDict: TraitDictionary
  issueOrder(order: Order): void
}

// ---------------------------------------------------------------------------
// ModularBot — Bot that uses BotModules (对应 OpenRA ModularBot)
// ---------------------------------------------------------------------------

/**
 * Thin middleware trait that bridges BotModules (IBotTick, IBotRespondToAttack)
 * to the game tick system. Attached to a PlayerActor.
 *
 * OpenRA 对照: ModularBot : ITick, IBot, INotifyDamage
 *
 * ## Lifecycle
 *
 * 1. Created via TraitFactory.create() during actor construction
 * 2. Attached to the PlayerActor via attach()
 * 3. activate(player) discovers BotModules via traitDict + activates IBotEnabled
 * 4. Each ITick.tick(): dispatch to IBotTick modules, then issue queued orders
 * 5. Each INotifyDamage.damaged(): dispatch to IBotRespondToAttack modules
 *
 * ## Shellmap Rate Limiting (ADR-26.3)
 *
 * In Shellmap mode, tick() dispatches to IBotTick modules only every
 * SHELLMAP_TICK_INTERVAL game ticks. Attack response always fires immediately
 * (attack response is rare and should not be delayed).
 *
 * ## Order Queue Batching
 *
 * Each tick, a fraction of pending orders is issued (1/minOrderQuotientPerTick).
 * This prevents AI from flooding the order system in a single tick while
 * ensuring orders are eventually issued (the queue drains over several ticks).
 */
export class ModularBot extends Component implements ITick, IBot, INotifyDamage {
  /** Interfaces implemented by this component for TraitDictionary lookups.
   *
   * OpenRA 对照: N/A (C# uses reflection to find implemented interfaces)
   */
  static readonly interfaces: string[] = [
    'ITick',
    'IBot',
    'INotifyDamage',
    'component',
  ]

  // -----------------------------------------------------------------------
  // Public state
  // -----------------------------------------------------------------------

  /** Whether the bot has been activated. Set by activate().
   *
   * OpenRA 对照: ModularBot.IsEnabled
   */
  isEnabled: boolean = false

  // -----------------------------------------------------------------------
  // IBot accessors
  // -----------------------------------------------------------------------

  /** Bot configuration info (IBot.Info).
   *
   * OpenRA 对照: IBot.Info -> ModularBotInfo (implements IBotInfo)
   */
  get info(): IBotInfo {
    return this._info
  }

  /** The player this bot controls (IBot.Player).
   *
   * OpenRA 对照: IBot.Player -> Player
   */
  get player(): PlayerStub {
    return this._player
  }

  // -----------------------------------------------------------------------
  // Private fields
  // -----------------------------------------------------------------------

  /** Bot configuration. */
  private readonly _info: ModularBotInfo

  /** The game world (for TraitDictionary access, order issuing, etc.).
   *
   * Set during activate() from the PlayerActor's world property.
   * Null until the bot is activated.
   */
  private _world: ModularBotWorld | null = null

  /** The player this bot controls. Set by activate(). */
  private _player!: PlayerStub

  /** Pending order queue. Orders are issued in batches each tick. */
  private readonly _orders: Order[] = []

  /** IBotTick modules discovered on the PlayerActor during activate(). */
  private _tickModules: IBotTick[] = []

  /** IBotRespondToAttack modules discovered on the PlayerActor. */
  private _attackResponseModules: IBotRespondToAttack[] = []

  /** Internal tick counter for shellmap rate limiting (ADR-26.3). */
  private _shellmapTickCounter: number = 0

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new ModularBot instance.
   *
   * OpenRA 对照: ModularBot(ModularBotInfo info, ActorInitializer init)
   *
   * NOTE: Unlike OpenRA which receives World via init.World, the TypeScript
   * version obtains the world reference from the PlayerActor during activate().
   * The PlayerActor's `.world` property is set during World._createPlayers().
   *
   * @param info — bot configuration (type, name, minOrderQuotient)
   */
  constructor(info: ModularBotInfo) {
    super()
    this._info = info
  }

  // -----------------------------------------------------------------------
  // activate — enable the bot (对应 OpenRA ModularBot.Activate)
  // -----------------------------------------------------------------------

  /**
   * Activate the bot for the given player.
   *
   * OpenRA 对照: ModularBot.Activate(Player p)
   *
   * Called by the host's player creation code (shellmap or skirmish startup).
   * Discovers all IBotTick, IBotRespondToAttack, and IBotEnabled traits
   * on the PlayerActor and activates them.
   *
   * The world reference is obtained from the PlayerActor's `.world` property
   * (set by World._createPlayers() during player setup).
   *
   * @param p — the player this bot controls
   */
  activate(p: PlayerStub): void {
    // Get reference to the PlayerActor from the player
    // OpenRA: p.PlayerActor
    const playerActor = (p as PlayerStub & { playerActor?: IGameActor }).playerActor
    if (!playerActor) {
      console.warn('[ModularBot] activate: Player has no playerActor — bot cannot be activated.')
      return
    }

    // Get world reference from the PlayerActor (set during World._createPlayers())
    const actorWorld = (playerActor as unknown as { world?: WorldStub }).world
    if (!actorWorld) {
      console.warn('[ModularBot] activate: PlayerActor has no world reference — bot cannot be activated.')
      return
    }
    this._world = actorWorld as unknown as ModularBotWorld

    this.isEnabled = true
    this._player = p

    // Discover IBotTick modules on the PlayerActor
    // OpenRA: tickModules = p.PlayerActor.TraitsImplementing<IBotTick>().ToArray()
    this._tickModules = this._world.traitDict.traitsImplementing<IBotTick & Component>(
      playerActor,
      'IBotTick',
    )

    // Discover IBotRespondToAttack modules on the PlayerActor
    // OpenRA: attackResponseModules = p.PlayerActor.TraitsImplementing<IBotRespondToAttack>().ToArray()
    this._attackResponseModules = this._world.traitDict.traitsImplementing<IBotRespondToAttack & Component>(
      playerActor,
      'IBotRespondToAttack',
    )

    // Activate all IBotEnabled modules
    // OpenRA: foreach (var ibe in p.PlayerActor.TraitsImplementing<IBotEnabled>()) ibe.BotEnabled(this)
    const enabledModules = this._world.traitDict.traitsImplementing<IBotEnabled & Component>(
      playerActor,
      'IBotEnabled',
    )
    for (const ibe of enabledModules) {
      ibe.botEnabled(this)
    }
  }

  // -----------------------------------------------------------------------
  // ITick.tick — per-logic-tick AI dispatch (对应 OpenRA ITick.Tick)
  // -----------------------------------------------------------------------

  /**
   * Execute one logic tick of AI processing.
   *
   * OpenRA 对照: ModularBot.ITick.Tick(Actor self)
   *
   * Dispatches to all IBotTick.botTick(this) modules. In shellmap mode,
   * dispatch is rate-limited to every SHELLMAP_TICK_INTERVAL ticks (ADR-26.3).
   *
   * After bot tick dispatch, issues a batch of queued orders
   * (size = ceil(total / minOrderQuotientPerTick)).
   *
   * @param actor — the actor this trait is attached to (the PlayerActor)
   */
  tick(actor: IGameActor): void {
    if (!this.isEnabled || !this._world) return

    // ---- Phase 1: Dispatch to IBotTick modules (rate-limited for shellmap) ----
    const isShellmap = this._world.type === 'Shellmap'

    let shouldTickBot = true
    if (isShellmap) {
      this._shellmapTickCounter++
      if (this._shellmapTickCounter < SHELLMAP_TICK_INTERVAL) {
        shouldTickBot = false
      } else {
        this._shellmapTickCounter = 0
      }
    }

    if (shouldTickBot) {
      // OpenRA: foreach (var t in tickModules) if (t.IsTraitEnabled()) t.BotTick(this)
      for (const t of this._tickModules) {
        const comp = t as unknown as Component
        if (comp.enabled) {
          t.botTick(this)
        }
      }
    }

    // ---- Phase 2: Issue queued orders ----
    //
    // OpenRA: var ordersToIssueThisTick = Math.Min(
    //   (orders.Count + minOrderQuotient - 1) / minOrderQuotient,
    //   orders.Count)
    const quotient = this._info.minOrderQuotientPerTick
    if (quotient > 0 && this._orders.length > 0) {
      const ordersToIssue = Math.min(
        Math.ceil(this._orders.length / quotient),
        this._orders.length,
      )
      for (let i = 0; i < ordersToIssue; i++) {
        const order = this._orders.shift()!
        this._world.issueOrder(order)
      }
    }

    // NOTE: actor is the PlayerActor, used in future extensions
    // (e.g., direct TraitDictionary lookup via actor)
    void actor
  }

  // -----------------------------------------------------------------------
  // IBot.queueOrder — enqueue an order for deferred issuing (对应 OpenRA IBot.QueueOrder)
  // -----------------------------------------------------------------------

  /**
   * Enqueue an order to be issued by the bot.
   *
   * OpenRA 对照: IBot.QueueOrder(Order order)
   *
   * Orders are NOT issued immediately. They are batched and issued
   * over subsequent ticks via the MinOrderQuotient mechanism.
   *
   * @param order — the order to enqueue
   */
  queueOrder(order: Order): void {
    this._orders.push(order)
  }

  // -----------------------------------------------------------------------
  // INotifyDamage.damaged — respond to attacks (对应 OpenRA INotifyDamage.Damaged)
  // -----------------------------------------------------------------------

  /**
   * Called when an owned actor is damaged. Dispatches to all
   * IBotRespondToAttack modules for tactical response.
   *
   * OpenRA 对照: ModularBot.INotifyDamage.Damaged(Actor self, AttackInfo e)
   *
   * Attack response always fires immediately (not rate-limited in shellmap
   * mode) because attacks are rare events that demand timely AI reaction.
   *
   * @param actor — the damaged actor (owned by this bot's player)
   * @param attackInfo — information about the attack
   */
  damaged(actor: IGameActor, attackInfo: AttackInfo): void {
    if (!this.isEnabled) return

    // OpenRA: foreach (var t in attackResponseModules)
    //   if (t.IsTraitEnabled()) t.RespondToAttack(this, self, e)
    for (const t of this._attackResponseModules) {
      const comp = t as unknown as Component
      if (comp.enabled) {
        t.respondToAttack(this, actor, attackInfo)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * Dispose the bot, releasing all references and clearing the order queue.
   *
   * OpenRA 对照: N/A (C# uses IDisposable on the trait; implicit via Actor.Dispose)
   */
  override dispose(): void {
    this.isEnabled = false
    this._orders.length = 0
    this._tickModules = []
    this._attackResponseModules = []
    this._world = null
    super.dispose()
  }
}
