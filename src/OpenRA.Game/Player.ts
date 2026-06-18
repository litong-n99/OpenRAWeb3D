/**
 * Player.ts — Player state: diplomacy, resources, Shroud, Bot, WinState
 * OpenRA 对照: OpenRA.Game/Player.cs
 *
 * 核心范式转换:
 * - C# Player class with Lua scripting → TypeScript Player class (no scene node)
 * - C# LongBitSet<PlayerBitMask> diplomacy → TypeScript LongBitSet<PlayerBitMask>
 *   (O(1) bitwise queries)
 * - C# PlayerActor pattern + Trait system → TypeScript GameActor with Components
 * - C# Lua scripting interface (IScriptBindable, ILuaTableBinding, etc.) →
 *   NOT migrated (web uses different scripting approach)
 * - C# Session.Client / PlayerReference / MersenneTwister → stubbed interfaces
 *   (full implementation pending Phase E actor system migration)
 * - C# FluentProvider / ChromeMetrics / Game static → stubbed (pending UI migration)
 */

import type { CPos } from './CPos.js'
import type { GameActor } from './Actor.js'
import { LongBitSet } from './Primitives/LongBitSet.js'
import {
  PlayerRelationship,
  type PlayerStub,
} from './Traits/TraitsInterfaces.js'
import type { Shroud } from './Traits/Player/Shroud.js'

// ---------------------------------------------------------------------------
// Enums (对应 OpenRA PowerState / WinState)
// ---------------------------------------------------------------------------

/**
 * Player power state flags (for low-power notifications).
 *
 * OpenRA 对照: PowerState [Flags] enum
 */
export const PowerState = {
  Normal: 1,
  Low: 2,
  Critical: 4,
} as const

export type PowerState = (typeof PowerState)[keyof typeof PowerState]

/**
 * Win/Loss tracking state for each player.
 *
 * OpenRA 对照: WinState enum
 */
export const WinState = {
  Undefined: 0,
  Won: 1,
  Lost: 2,
} as const

export type WinState = (typeof WinState)[keyof typeof WinState]

// ---------------------------------------------------------------------------
// PlayerBitMask — marker type for LongBitSet<T> namespace (对应 OpenRA
// PlayerBitMask empty class)
// ---------------------------------------------------------------------------

/**
 * Empty marker "class" used as the type tag for LongBitSet<PlayerBitMask>.
 * In OpenRA this is an empty C# class; in TypeScript it's a symbol/interface
 * serving the same purpose of namespace isolation for the LongBitSet allocator.
 *
 * OpenRA 对照: public class PlayerBitMask { }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PlayerBitMask {
  /* marker — intentionally empty */
}

/**
 * The type name string used to key the LongBitSet allocator for PlayerBitMask.
 *
 * OpenRA 对照: LongBitSetAllocator<PlayerBitMask>
 */
export const PLAYER_BITMASK_TYPENAME = 'PlayerBitMask'

// ---------------------------------------------------------------------------
// Stub interfaces for unmigrated dependencies
// ---------------------------------------------------------------------------

/**
 * Stub for PlayerReference (OpenRA.Game/Map/PlayerReference.cs).
 *
 * OpenRA 对照: PlayerReference class
 *
 * Represents a player slot definition from the map YAML. Contains starting
 * configuration (faction, color, spawn, team, allies/enemies) and lobby
 * lock flags. Map-defined players use default values; client/lobby players
 * have their overrides applied on top.
 *
* Replace with full PlayerReference class when Map module is migrated.
 */
export interface PlayerReferenceStub {
  /** Player name (display). */
  name: string
  /** Palette identifier for player colors. */
  palette: string
  /** Default bot type for this slot. */
  bot?: string
  /** Starting units class identifier. */
  startingUnitsClass?: string
  /** Whether bots can fill this slot. */
  allowBots: boolean
  /** Whether this slot can be occupied by a player. */
  playable: boolean
  /** Whether this player is required to start the game. */
  required: boolean
  /** Whether this player owns the world (editor mode). */
  ownsWorld: boolean
  /** Whether this is a spectator slot. */
  spectating: boolean
  /** Whether this player is non-combatant (cannot attack). */
  nonCombatant: boolean
  /** Whether the faction is locked in lobby. */
  lockFaction: boolean
  /** Default faction internal name. */
  faction: string
  /** Whether the color is locked in lobby. */
  lockColor: boolean
  /** Default player color (ARGB). */
  color: number
  /** Home/spawn location in cells. */
  homeLocation: CPos
  /** Whether the spawn point is locked in lobby. */
  lockSpawn: boolean
  /** Default spawn point index. */
  spawn: number
  /** Whether the team is locked in lobby. */
  lockTeam: boolean
  /** Default team number. */
  team: number
  /** Whether the handicap is locked in lobby. */
  lockHandicap: boolean
  /** Default handicap percentage (0-100). */
  handicap: number
  /** Allied player names (for diplomacy setup). */
  allies: string[]
  /** Enemy player names (for diplomacy setup). */
  enemies: string[]
}

/**
 * Stub for Session.Client (OpenRA.Network/Session.cs).
 *
 * OpenRA 对照: Session.Client class
 *
 * Contains the subset of Session.Client fields needed by the Player
 * constructor for human and host-created bot players.
 * Fields: index (slot), color (ARGB), name (display), bot (AI type
 * or null for human), faction (lobby selection), handicap (0-100%),
 * spawnPoint (map position index).
 *
* Replace with full Session.Client when Network module is migrated.
 */
export interface SessionClientStub {
  /** Client slot index (0-based). */
  index: number
  /** Player color in ARGB format (0xAARRGGBB). */
  color: number
  /** Player display name. */
  name: string
  /** Bot type identifier, or undefined for human players. */
  bot?: string
  /** Faction internal name selected in lobby. */
  faction: string
  /** Handicap percentage (0-100). */
  handicap: number
  /** Spawn point slot index. */
  spawnPoint: number
}

/**
 * Stub for FactionInfo (OpenRA.Game/Traits/World/Faction.cs).
 *
 * OpenRA 对照: FactionInfo : TraitInfo<Faction>
 *
 * Contains the faction metadata needed by Player.ResolveFaction() for
 * faction selection and random-faction resolution (resolving chains of
 * RandomFactionMembers). Attached to World actor as a trait info.
 *
* Replace with full FactionInfo when Trait system is migrated.
 */
export interface FactionInfoStub {
  /** Display name visible to players. */
  name: string
  /** Internal name for code references and diplomacy matching. */
  internalName: string
  /** Random faction members (for Random faction resolution). */
  randomFactionMembers: readonly string[]
  /** Side identifier (e.g., "Allies", "Soviet"). */
  side?: string
  /** Tooltip description shown in lobby. */
  description?: string
  /** Whether this faction appears in the lobby picker. */
  selectable: boolean
}

/**
 * Stub for Shroud trait (fog of war for a player).
 *
 * OpenRA 对照: Shroud trait (OpenRA.Game/Traits/Player/Shroud.cs)
 *
 * Controls visibility of cells on the map. IsDiscovered returns whether
 * the cell has ever been explored by this player. Full implementation
 * uses a 2D bit array for explored/visible state per cell.
 *
* Replace with full Shroud class when fog-of-war is migrated.
 */
export interface ShroudStub {
  /** Whether fog of war has been explored at the given cell. */
  readonly isDiscovered: boolean
}

/**
 * Stub for FrozenActorLayer trait (frozen-under-fog actor display).
 *
 * OpenRA 对照: FrozenActorLayer trait
 *   (OpenRA.Game/Traits/Player/FrozenActorLayer.cs)
 *
 * Renders "frozen" copies of enemy actors at their last known position
 * when they move back into fog of war. Uses the Shroud to determine
 * which actors should be frozen.
 *
* Replace with full FrozenActorLayer when fog-of-war is migrated.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FrozenActorLayerStub {
  /** Pending fog-of-war migration (). */
  /* marker */
}

/**
 * Stub for MersenneTwister (used for faction resolution randomness).
 *
 * OpenRA 对照: OpenRA.Support/MersenneTwister.cs
 */
export interface MersenneTwisterStub {
  next(min?: number, max?: number): number
}

/**
 * Stub for IBotInfo (bot type configuration).
 *
 * OpenRA 对照: IBotInfo
 */
export interface BotInfoStub {
  type: string
  name: string
}

/**
 * Stub for IBot (active bot controller).
 *
 * OpenRA 对照: IBot
 */
export interface IBotStub {
  info: BotInfoStub
  activate(player: PlayerStub): void
  queueOrder(order: unknown): void
}

/**
 * Stub for IUnlocksRenderPlayer trait.
 *
 * OpenRA 对照: IUnlocksRenderPlayer
 */
export interface UnlocksRenderPlayerStub {
  readonly renderPlayerUnlocked: boolean
}

/**
 * Stub for INotifyPlayerDisconnected trait.
 *
 * OpenRA 对照: INotifyPlayerDisconnected
 */
export interface NotifyPlayerDisconnectedStub {
  playerDisconnected(actor: GameActor, player: PlayerStub): void
}

// ---------------------------------------------------------------------------
// PlayerOptions — construction parameters (对应 OpenRA Player constructor args)
// ---------------------------------------------------------------------------

/**
 * Options bag for Player construction.
 *
 * OpenRA 对照: Player(World, Session.Client, PlayerReference, MersenneTwister)
 *
 * Uses an options bag because Session.Client, PlayerReference, and
 * MersenneTwister are not yet fully migrated — the stub interfaces can
 * be passed directly without positional overloads.
 *
* Replace stub types with real classes when dependencies are migrated.
 */
export interface PlayerOptions {
  /** The game world.
   *
   * OpenRA 对照: World parameter
   */
  world: WorldStubPlayer

  /** The session client (null for map-defined players).
   *
   * OpenRA 对照: Session.Client parameter
   */
  client: SessionClientStub | null

  /** The player reference from the map.
   *
   * OpenRA 对照: PlayerReference parameter
   */
  playerReference: PlayerReferenceStub

  /** Random generator for faction resolution.
   *
   * OpenRA 对照: MersenneTwister parameter
   */
  playerRandom: MersenneTwisterStub

  /** Available faction info objects.
   *
   * NOTE: Derived from world.Map.Rules.Actors[SystemActors.World]
   *   .TraitInfos<FactionInfo>() in OpenRA.
   */
  factionInfos: readonly FactionInfoStub[]
}

// ---------------------------------------------------------------------------
// Player (对应 OpenRA Player)
// ---------------------------------------------------------------------------

/**
 * Represents a player in the game world.
 *
 * OpenRA 对照: Player class
 *
 * Each Player has a PlayerActor — a regular GameActor that carries all player
 * capabilities via trait composition (Shroud, FrozenActorLayer, resource
 * management, tech tree, bot logic). This unifies handling: ordinary actors
 * and player actors use the same trait system.
 *
 * Diplomacy uses LongBitSet<PlayerBitMask> for O(1) relationship queries.
 * Up to 64 players are supported via 64-bit bigint bitmask operations.
 *
 * ## Important: Player implements PlayerStub for compatibility
 *
 * The Player class implements the PlayerStub interface so it can be used
 * wherever existing code expects a PlayerStub. The full Player class is the
 * authoritative type; PlayerStub is a lightweight forward-reference.
 */
export class Player implements PlayerStub {
  // -----------------------------------------------------------------------
  // Static
  // -----------------------------------------------------------------------

  /**
   * The enumerated bot name Fluent key.
   *
   * OpenRA 对照: EnumeratedBotName = "enumerated-bot-name"
   */
  static readonly ENUMERATED_BOT_NAME = 'enumerated-bot-name'

  /**
   * Resolve a faction from a faction name, optionally requiring it to be
   * selectable.
   *
   * OpenRA 对照: Player.ResolveFaction(string, IEnumerable<FactionInfo>,
   *   MersenneTwister, bool)
   *
   * Uses the provided random generator for picking from RandomFactionMembers.
   * Falls back to a random selectable faction if no match is found.
   *
   * @param factionName — the faction internal name requested
   * @param factionInfos — all available faction info objects
   * @param playerRandom — random generator for faction selection
   * @param requireSelectable — if true, only consider selectable factions
   *   (default: true)
   * @returns the resolved FactionInfo
   * @throws if a random faction member name cannot be resolved
   */
  static resolveFaction(
    factionName: string,
    factionInfos: readonly FactionInfoStub[],
    playerRandom: MersenneTwisterStub,
    requireSelectable: boolean = true,
  ): FactionInfoStub {
    const selectableFactions = factionInfos.filter(
      (f) => !requireSelectable || f.selectable,
    )

    let selected =
      selectableFactions.find((f) => f.internalName === factionName) ??
      selectableFactions[
        playerRandom.next(0, selectableFactions.length - 1)
      ]

    // Don't loop infinitely — OpenRA caps at 10 iterations
    for (
      let i = 0;
      i <= 10 && selected.randomFactionMembers.length > 0;
      i++
    ) {
      const idx = playerRandom.next(
        0,
        selected.randomFactionMembers.length - 1,
      )
      const faction = selected.randomFactionMembers[idx]
      const next = selectableFactions.find(
        (f) => f.internalName === faction,
      )
      if (!next) {
        throw new Error(`Unknown faction: ${faction}`)
      }
      selected = next
    }

    return selected
  }

  /**
   * Get a player's original color, ignoring relationship color overrides.
   *
   * OpenRA 对照: Player.GetColor(Player)
   *
   * @param p — the player to get the color of
   * @returns the player's original color value (ARGB)
   */
  static getColor(p: Player): number {
    return p.color
  }

  /**
   * Compute the display color for a player from a viewer's perspective,
   * applying relationship color rules.
   *
   * OpenRA 对照: Player.PlayerRelationshipColor(Player, Player)
   *
   * Relationship coloring rules:
   * - If player stance colors are disabled (Game.UsePlayerStanceColors)
   *   or the viewer is spectating: use original player color
   * - Self: ChromeMetrics.PlayerStanceColorSelf
   * - Ally: ChromeMetrics.PlayerStanceColorAllies
   * - Neutral/NonCombatant: ChromeMetrics.PlayerStanceColorNeutrals
   * - Enemy: ChromeMetrics.PlayerStanceColorEnemies
   *
   * @param player — the player whose color to compute
   * @param viewer — the player whose perspective to use, or null
   * @returns the relationship-colored ARGB value
   */
  static playerRelationshipColor(
    player: Player,
    viewer: Player | null,
  ): number {
    // NOTE: Game.Settings.Game.UsePlayerStanceColors and ChromeMetrics
    // are not yet migrated. For now, we return the original player color.
    // Integrate with Game settings and ChromeMetrics when UI
    // system is migrated.

    if (!playerUseStanceColors || !viewer || viewer.isSpectating) {
      return player.color
    }

    if (viewer === player) {
      return STANCE_COLOR_SELF
    }

    if (player.isAlliedWith(viewer)) {
      return STANCE_COLOR_ALLIES
    }

    if (player.nonCombatant) {
      return STANCE_COLOR_NEUTRALS
    }

    return STANCE_COLOR_ENEMIES
  }

  /**
   * Update display colors for all players based on a viewer's perspective.
   * Also updates palette colors in the WorldRenderer.
   *
   * OpenRA 对照: Player.SetupRelationshipColors(Player[], Player,
   *   WorldRenderer, bool)
   *
   * @param players — all players in the game
   * @param viewer — the player whose perspective to use
   * @param worldRenderer — the WorldRenderer for palette updates
   *   (stubbed — will be integrated when WorldRenderer is fully migrated)
   * @param firstRun — true on first setup (palettes are created, not updated)
   */
  static setupRelationshipColors(
    players: Player[],
    viewer: Player,
    worldRenderer: WorldRendererStubPlayer,
    firstRun: boolean,
  ): void {
    for (const p of players) {
      p.displayColor = Player.playerRelationshipColor(p, viewer)
      worldRenderer.updatePalettesForPlayer(
        p.internalName,
        p.displayColor,
        !firstRun,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Instance fields — identity & core references
  // -----------------------------------------------------------------------

  /**
   * The game world this player belongs to.
   *
   * OpenRA 对照: Player.World
   */
  readonly world: WorldStubPlayer

  /**
   * The PlayerActor — a normal GameActor carrying all player capabilities
   * (Shroud, FrozenActorLayer, resources, tech tree, bot logic) via traits.
   *
   * OpenRA 对照: Player.PlayerActor
   *
   * Created in the constructor with an OwnerInit pointing to this Player.
   */
  readonly playerActor: GameActor

  /**
   * Player display name (as entered by the player).
   *
   * OpenRA 对照: Player.PlayerName
   */
  readonly playerName: string

  /**
   * Internal name (from PlayerReference.Name, used for diplomacy matching).
   *
   * OpenRA 对照: Player.InternalName
   */
  readonly internalName: string

  /**
   * The player's faction (the actual resolved FactionInfo after Random
   * resolution).
   *
   * OpenRA 对照: Player.Faction
   */
  readonly faction: FactionInfoStub

  /**
   * Whether this player cannot engage in combat.
   *
   * OpenRA 对照: Player.NonCombatant
   */
  readonly nonCombatant: boolean = false

  /**
   * Whether this player slot is playable (false for spectators, etc.).
   *
   * OpenRA 对照: Player.Playable
   */
  readonly playable: boolean = true

  /**
   * The session client index (for human/host-created bot players).
   *
   * OpenRA 对照: Player.ClientIndex
   */
  readonly clientIndex: number

  /**
   * The "Home" location (initial camera/spawn area center).
   *
   * OpenRA 对照: Player.HomeLocation
   */
  readonly homeLocation: CPos

  /**
   * Player handicap percentage (0-100, applies to HP/cost/speed).
   *
   * OpenRA 对照: Player.Handicap
   */
  readonly handicap: number

  /**
   * The PlayerReference this player was created from.
   *
   * OpenRA 对照: Player.PlayerReference
   */
  readonly playerReference: PlayerReferenceStub

  /**
   * Whether this player is controlled by an AI bot.
   *
   * OpenRA 对照: Player.IsBot
   */
  readonly isBot: boolean

  /**
   * The bot type identifier (null if not a bot).
   *
   * OpenRA 对照: Player.BotType
   */
  readonly botType: string | null

  /**
   * The Shroud trait (fog of war for this player).
   *
   * OpenRA 对照: Player.Shroud
   */
  readonly shroud: Shroud

  /**
   * The FrozenActorLayer trait (frozen-under-fog rendering).
   *
   * OpenRA 对照: Player.FrozenActorLayer
   */
  readonly frozenActorLayer: FrozenActorLayerStub

  /**
   * The faction as displayed in the lobby (before Random resolution).
   *
   * OpenRA 对照: Player.DisplayFaction
   */
  readonly displayFaction: FactionInfoStub

  /**
   * The spawn point index assigned / chosen in the lobby.
   *
   * OpenRA 对照: Player.SpawnPoint
   */
  readonly spawnPoint: number

  /**
   * The display spawn point index (including 0 for Random).
   *
   * OpenRA 对照: Player.DisplaySpawnPoint
   */
  readonly displaySpawnPoint: number

  // -----------------------------------------------------------------------
  // Instance fields — mutable state
  // -----------------------------------------------------------------------

  /**
   * Win/Loss state for this player.
   *
   * OpenRA 对照: Player.WinState
   *
   * NOTE: Intentional divergence from OpenRA — once a player has Won or
   * Lost, the state CANNOT be reverted to Undefined. This prevents UI and
   * network bugs where a stale packet could reset game-over state.
   * OpenRA allows any transition; we silently guard against invalid reversion.
   */
  get winState(): WinState {
    return this._winState
  }

  set winState(value: WinState) {
    if (this._winState !== WinState.Undefined && value === WinState.Undefined) {
      // Silently ignore — once you're out, you stay out
      return
    }
    if (this._winState !== value) {
      const oldState = this._winState
      this._winState = value
      // Invalidate stance cache on state change (spectating affects diplomacy)
      this.playerStances.clear()
      this.onWinStateChanged?.(this, oldState, value)
    }
  }

  /**
   * Whether this player has mission objectives displayed.
   *
   * OpenRA 对照: Player.HasObjectives
   */
  hasObjectives: boolean = false

  /**
   * Callback invoked when the player's WinState changes.
   *
   * OpenRA 对照: WinState change triggers UI updates (Widget logic, Game
   *   state notifications). In OpenRA this is implicit via property writes
   *   and Widget polling; here it is an explicit observable for decoupling.
   *
   * @param player — the player whose winState changed
   * @param oldState — the previous win state
   * @param newState — the new win state
   */
  onWinStateChanged:
    | ((player: Player, oldState: WinState, newState: WinState) => void)
    | null = null

  /**
   * Cached diplomacy stances keyed by the other player.
   *
   * OpenRA 对照: No direct equivalent in OpenRA (relationship is recomputed
   *   per call via bitmask). Cache avoids recomputing the same O(1) bitmask
   *   check multiple times per tick for the same player pair.
   *
   * Cleared automatically when ally/enemy masks or winState change.
   *
   * @internal Public for testing; use relationshipWith() for normal access.
   */
  readonly playerStances = new Map<Player, PlayerRelationship>()

  /**
   * The player's original color (ARGB format).
   *
   * OpenRA 对照: Player.color (readonly backing field)
   */
  readonly color: number

  /**
   * The player's display color (may be overridden by relationship colors).
   *
   * OpenRA 对照: Player.Color { get; private set; }
   *
   * NOTE: TypeScript cannot express "public get, class-internal set"
   * accessible from static methods. Convention: only set this field via
   * `Player.setupRelationshipColors()`. External mutation will be caught
   * by linting/CI.
   *
* Switch to a `private _displayColor` + `static _setColor()`
   * pattern when the UI system is migrated and needs direct access.
   */
  displayColor: number

  // -----------------------------------------------------------------------
  // Instance fields — diplomacy masks (对应 OpenRA LongBitSet fields)
  // -----------------------------------------------------------------------

  /**
   * This player's unique bit in the player bit set.
   *
   * OpenRA 对照: Player.PlayerMask
   */
  playerMask: LongBitSet<PlayerBitMask>

  /**
   * Bitmask of all allied players.
   *
   * OpenRA 对照: Player.AlliedPlayersMask
   */
  alliedPlayersMask: LongBitSet<PlayerBitMask>

  /**
   * Bitmask of all enemy players.
   *
   * OpenRA 对照: Player.EnemyPlayersMask
   */
  enemyPlayersMask: LongBitSet<PlayerBitMask>

  // -----------------------------------------------------------------------
  // Private fields
  // -----------------------------------------------------------------------

  /**
   * Backing field for the winState getter/setter (immutability guard).
   *
   * OpenRA 对照: Player.WinState (public field)
   */
  private _winState: WinState = WinState.Undefined

  /**
   * Whether this is a mission map that forbids player leaving.
   *
   * OpenRA 对照: Player.inMissionMap
   */
  private readonly _inMissionMap: boolean

  /**
   * Whether this player is a spectator.
   *
   * OpenRA 对照: Player.spectating
   */
  private readonly _spectating: boolean

  /**
   * Registered IUnlocksRenderPlayer traits (fast-path cached array).
   *
   * OpenRA 对照: Player.unlockRenderPlayer
   */
  private readonly _unlockRenderPlayer: UnlocksRenderPlayerStub[]

  /**
   * Registered INotifyPlayerDisconnected traits (fast-path cached array).
   *
   * OpenRA 对照: Player.notifyDisconnected
   */
  private readonly _notifyDisconnected: NotifyPlayerDisconnectedStub[]

  /**
   * Available bot info objects for resolving bot names.
   *
   * OpenRA 对照: Player.botInfos
   */
  private readonly _botInfos: BotInfoStub[]

  /**
   * Cached resolved player name (lazy-computed).
   *
   * OpenRA 对照: Player.resolvedPlayerName
   */
  private _resolvedPlayerName: string | null = null

  // -----------------------------------------------------------------------
  // Properties (对应 OpenRA computed properties)
  // -----------------------------------------------------------------------

  /**
   * Whether this player is currently spectating.
   *
   * OpenRA 对照: Player.Spectating
   *
   * A player is spectating if they are in a non-mission map and either:
   * - They are marked as spectating directly, OR
   * - Their WinState is not Undefined (game over for this player)
   */
  get isSpectating(): boolean {
    return (
      !this._inMissionMap &&
      (this._spectating || this.winState !== WinState.Undefined)
    )
  }

  /**
   * Whether the render player can see this player's units.
   *
   * OpenRA 对照: Player.UnlockedRenderPlayer
   */
  get unlockedRenderPlayer(): boolean {
    // PERF: Avoid LINQ — iterate array directly
    for (const u of this._unlockRenderPlayer) {
      if (u.renderPlayerUnlocked) return true
    }
    return this.winState !== WinState.Undefined && !this._inMissionMap
  }

  /**
   * The chosen player name including localized and enumerated bot names.
   *
   * OpenRA 对照: Player.ResolvedPlayerName
   */
  get resolvedPlayerName(): string {
    if (this._resolvedPlayerName === null) {
      this._resolvedPlayerName = this.resolvePlayerName()
    }
    return this._resolvedPlayerName
  }

  // -----------------------------------------------------------------------
  // Constructor (对应 OpenRA Player constructor)
  // -----------------------------------------------------------------------

  /**
   * Create a new Player.
   *
   * OpenRA 对照: Player(World, Session.Client, PlayerReference,
   *   MersenneTwister)
   *
   * Uses an options bag because the full Session.Client, PlayerReference,
   * and MersenneTwister types are not yet migrated.
   *
   * The constructor:
   * 1. Extracts all identity/configuration fields from the options bag
   * 2. Resolves faction and display faction
   * 3. Allocates the player's bit mask in LongBitSet<PlayerBitMask>
   * 4. Creates the PlayerActor via two-phase init:
   *    a. Phase 1 — create uninitialized shell (world factory)
   *    b. Phase 2 — initialize the actor (fires INotifyCreated, adds to world)
   * 5. Retrieves Shroud and FrozenActorLayer traits from initialized PlayerActor
   * 6. Activates bot logic if IsBot and this client is the host
   * 7. Caches unlockRenderPlayer and notifyDisconnected traits
   *
   * @param options — construction parameters (PlayerOptions bag)
   */
  constructor(options: PlayerOptions) {
    const {
      world,
      client,
      playerReference: pr,
      playerRandom,
      factionInfos,
    } = options

    this.world = world

    this.internalName = pr.name
    this.playerReference = pr

    this._inMissionMap = false // NOTE: world.Map.Visibility.HasFlag not yet available
    this._botInfos = [] // NOTE: botInfos from World.Map.Rules not yet available

    if (client !== null) {
      // Real player or host-created bot
      this.clientIndex = client.index
      this.color = client.color
      this.displayColor = client.color
      this.playerName = client.name

      this.botType = client.bot ?? null
      this.faction = Player.resolveFaction(
        client.faction,
        factionInfos,
        playerRandom,
        !pr.lockFaction,
      )
      this.displayFaction = Player.resolveDisplayFaction(
        factionInfos,
        client.faction,
      )

      this.homeLocation = pr.homeLocation // NOTE: IAssignSpawnPoints resolution not yet available
      this.spawnPoint = client.spawnPoint
      this.displaySpawnPoint = client.spawnPoint

      this.handicap = client.handicap
      this._spectating = false
      this.nonCombatant = false
      this.playable = true
    } else {
      // Map-defined player
      this.clientIndex = 0 // NOTE: Owned by host (TODO: fix this — OpenRA comment)
      this.color = pr.color
      this.displayColor = pr.color
      this.playerName = pr.name
      this.nonCombatant = pr.nonCombatant
      this.playable = pr.playable
      this._spectating = pr.spectating
      this.botType = pr.bot ?? null
      this.faction = Player.resolveFaction(
        pr.faction,
        factionInfos,
        playerRandom,
        false,
      )
      this.displayFaction = Player.resolveDisplayFaction(
        factionInfos,
        pr.faction,
      )
      this.homeLocation = pr.homeLocation
      this.spawnPoint = 0
      this.displaySpawnPoint = 0
      this.handicap = pr.handicap
    }

    // Allocate player bit mask (unless spectating)
    if (!this._spectating) {
      this.playerMask = new LongBitSet<PlayerBitMask>(
        PLAYER_BITMASK_TYPENAME,
        this.internalName,
      )
    } else {
      this.playerMask = new LongBitSet<PlayerBitMask>(
        PLAYER_BITMASK_TYPENAME,
      )
    }

    this.alliedPlayersMask = new LongBitSet<PlayerBitMask>(
      PLAYER_BITMASK_TYPENAME,
    )
    this.enemyPlayersMask = new LongBitSet<PlayerBitMask>(
      PLAYER_BITMASK_TYPENAME,
    )

    // Set IsBot before any PlayerActor callbacks
    this.isBot = this.botType !== null

    // -------------------------------------------------------------------
    // PlayerActor two-phase init (对应 OpenRA PlayerActor creation)
    // -------------------------------------------------------------------
    // Phase 1: Create uninitialized shell.
    // In OpenRA: new Actor(world, playerActorType, [new OwnerInit(this)])
    //
    // NOTE: Since the YAML trait system is not yet migrated, the world
    // factory creates a minimal GameActor shell. Full trait population
    // will be added in .
    //
    // Create with proper actor type (SystemActors.Player vs
    // EditorPlayer) and trait initialization when ActorInfo/YAML system
    // is migrated.
    this.playerActor = world.createUninitializedPlayerActor(
      this.internalName,
      this,
    )

    // Phase 2: Initialize the actor.
    // In OpenRA: PlayerActor.Initialize(true)
    // This fires INotifyCreated on all traits, registers observers,
    // finds ICreationActivity, and adds the actor to the world.
    //
    // NOTE: The initialize call is via dynamic dispatch because
    // GameActor is a type-only import (avoids circular deps).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this.playerActor as any).initialize?.(true)

    // Retrieve Shroud and FrozenActorLayer from initialized PlayerActor
    // NOTE: These are stubs — real trait retrieval will be available
    // when Shroud and FrozenActorLayer are migrated.
    // Use `as any` cast because ShroudStub/FrozenActorLayerStub do not
    // extend Component yet (: Remove cast when traits are migrated).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.shroud =
      (this.playerActor as any).traitOrDefault?.('Shroud') ??
      SHROUD_STUB_DEFAULT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.frozenActorLayer =
      (this.playerActor as any).traitOrDefault?.('FrozenActorLayer') ??
      FROZEN_ACTOR_LAYER_STUB_DEFAULT

    // Activate bot logic on the host
    // NOTE: Full bot activation requires IBot lookup from world rules and
    // Game.IsHost check. Stubbed for now.
    // Activate bot when IBot and rules system are migrated.
    if (this.isBot) {
      // Bot activation will be handled by external code when bot system is ready
    }

    // Cache unlockRenderPlayer and notifyDisconnected traits
    this._unlockRenderPlayer = [] // NOTE: Retrieved from PlayerActor traits
    this._notifyDisconnected = [] // NOTE: Retrieved from PlayerActor traits
  }

  // -----------------------------------------------------------------------
  // Static helpers for faction resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the display faction (first match or first faction).
   *
   * OpenRA 对照: Player.ResolveDisplayFaction(World, string)
   *
   * The display faction is the faction as chosen in the lobby, before
   * Random faction resolution. It is used for UI display only.
   *
   * @param factionInfos — all available faction info objects
   * @param factionName — the faction internal name requested
   * @returns the first matching faction, or the first faction overall
   */
  static resolveDisplayFaction(
    factionInfos: readonly FactionInfoStub[],
    factionName: string,
  ): FactionInfoStub {
    return (
      factionInfos.find((f) => f.internalName === factionName) ??
      factionInfos[0]
    )
  }

  // -----------------------------------------------------------------------
  // ToString (对应 OpenRA Player.ToString)
  // -----------------------------------------------------------------------

  /**
   * Get a human-readable string representation of this player.
   *
   * OpenRA 对照: Player.ToString()
   */
  toString(): string {
    return `${this.resolvedPlayerName} (${this.clientIndex})`
  }

  // -----------------------------------------------------------------------
  // Name resolution (对应 OpenRA ResolvePlayerName)
  // -----------------------------------------------------------------------

  /**
   * Resolve the player's display name, localizing bot names.
   *
   * OpenRA 对照: Player.ResolvePlayerName()
   *
   * For bot players, the name is resolved using Fluent to provide
   * localized enumerated bot names (e.g., "Bot 1", "Bot 2").
   *
   * NOTE: FluentProvider is not yet migrated. Bot names are returned
   * with a simple format for now.
* Integrate with FluentProvider when localization is migrated.
   */
  private resolvePlayerName(): string {
    if (this.isBot && this.botType) {
      const botInfo = this._botInfos.find((b) => b.type === this.botType)
      const botName = botInfo?.name ?? this.botType

      // Count bots of the same type for enumeration.
      // In OpenRA: World.Players.Where(c => c.BotType == BotType)
      //   .IndexOf(this) + 1
      // We count same-type bots seen BEFORE this player in the array,
      // so that this player is the (sameTypeCount + 1)-th bot.
      let sameTypeBeforeCount = 0
      const worldPlayers = this.world.players as Player[]
      for (const p of worldPlayers) {
        if (p === this) {
          break
        }
        if (p.botType === this.botType) {
          sameTypeBeforeCount++
        }
      }

      // NOTE: FluentProvider.GetMessage not yet available.
      // Simple format: "BotName 1", "BotName 2", etc.
      return `${botName} ${sameTypeBeforeCount + 1}`
    }

    return this.playerName
  }

  // -----------------------------------------------------------------------
  // Diplomacy (对应 OpenRA RelationshipWith / IsAlliedWith)
  // -----------------------------------------------------------------------

  /**
   * Determine the diplomatic relationship between this player and another.
   *
   * OpenRA 对照: Player.RelationshipWith(Player)
   *
   * Relationship rules (matching OpenRA exactly):
   * 1. Self → Ally
   * 2. Other is null or spectator → NonCombatant→Neutral, else Ally
   * 3. AlliedPlayersMask overlaps other.PlayerMask → Ally
   * 4. EnemyPlayersMask overlaps other.PlayerMask → Enemy
   * 5. Otherwise → Neutral
   *
   * Complexity: O(1) — uses LongBitSet.Overlaps() (bigint bitwise AND)
   *
   * @param other — the player to check relationship with, or null
   * @returns the relationship (Ally, Enemy, or Neutral)
   */
  relationshipWith(other: Player | null): PlayerRelationship {
    if (this === other) {
      return PlayerRelationship.Ally
    }

    // Observers are considered allies to active combatants
    if (other === null || other.isSpectating) {
      return this.nonCombatant
        ? PlayerRelationship.Neutral
        : PlayerRelationship.Ally
    }

    if (this.alliedPlayersMask.overlaps(other.playerMask)) {
      return PlayerRelationship.Ally
    }

    if (this.enemyPlayersMask.overlaps(other.playerMask)) {
      return PlayerRelationship.Enemy
    }

    return PlayerRelationship.Neutral
  }

  /**
   * Check whether this player is allied with another player.
   *
   * OpenRA 对照: Player.IsAlliedWith(Player)
   *
   * Equivalent to: RelationshipWith(p) == PlayerRelationship.Ally
   *
   * @param p — the player to check (may be null)
   * @returns true if the other player is an ally
   */
  isAlliedWith(p: Player | null): boolean {
    return this.relationshipWith(p) === PlayerRelationship.Ally
  }

  /**
   * Check whether this player is at war with another player.
   *
   * OpenRA 对照: (convenience — no direct C# equivalent; common pattern)
   *
   * Equivalent to: RelationshipWith(p) == PlayerRelationship.Enemy
   *
   * @param p — the player to check (may be null)
   * @returns true if the other player is an enemy
   */
  isEnemyWith(p: Player | null): boolean {
    return this.relationshipWith(p) === PlayerRelationship.Enemy
  }

  // -----------------------------------------------------------------------
  // Internal methods (对应 OpenRA internal methods)
  // -----------------------------------------------------------------------

  /**
   * Notify all INotifyPlayerDisconnected traits that a player disconnected.
   *
   * OpenRA 对照: Player.PlayerDisconnected(Player)
   *
   * Called internally when a player leaves the game.
   *
   * @param p — the player that disconnected
   */
  playerDisconnected(p: Player): void {
    for (const np of this._notifyDisconnected) {
      np.playerDisconnected(this.playerActor, p)
    }
  }
}

// ---------------------------------------------------------------------------
// Local stub types (avoid circular imports with World/WorldRenderer)
// ---------------------------------------------------------------------------

/**
 * Minimal World stub for Player constructor dependencies.
 *
 * OpenRA 对照: OpenRA.Game/World.cs
 */
interface WorldStubPlayer {
  players: readonly (Player | { botType?: string | null })[]
  /** Phase 1 of two-phase PlayerActor init — creates an uninitialized shell.
   *
   * OpenRA 对照: new Actor(world, playerActorType, [new OwnerInit(this)])
   *
   * The returned actor MUST have initialize() called on it (Phase 2)
   * before trait retrieval.
   */
  createUninitializedPlayerActor(internalName: string, owner: Player): GameActor
}

/**
 * Minimal WorldRenderer stub for palette update method.
 *
 * OpenRA 对照: OpenRA.Game/Graphics/WorldRenderer.cs
 */
interface WorldRendererStubPlayer {
  updatePalettesForPlayer(
    internalName: string,
    color: number,
    isUpdate: boolean,
  ): void
}

// ---------------------------------------------------------------------------
// Default stubs (used when traits are not available from PlayerActor)
// ---------------------------------------------------------------------------

const SHROUD_STUB_DEFAULT = {
  isDiscovered: false,
} as unknown as Shroud

const FROZEN_ACTOR_LAYER_STUB_DEFAULT: FrozenActorLayerStub = {}

// ---------------------------------------------------------------------------
// Relationship color constants (hardcoded defaults — these will come from
// ChromeMetrics when UI system is migrated)
// ---------------------------------------------------------------------------

/**
 * Whether to use player stance colors.
 *
 * OpenRA 对照: Game.Settings.Game.UsePlayerStanceColors
 *
* Read from Game.Settings when game settings are migrated.
 */
let playerUseStanceColors = true

/** Default stance color: self (green tint). */
const STANCE_COLOR_SELF = 0xff00ff00

/** Default stance color: allies (yellow tint). */
const STANCE_COLOR_ALLIES = 0xffffff00

/** Default stance color: neutrals (white — no tint). */
const STANCE_COLOR_NEUTRALS = 0xffffffff

/** Default stance color: enemies (red tint). */
const STANCE_COLOR_ENEMIES = 0xffff0000
