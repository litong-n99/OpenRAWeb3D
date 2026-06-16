/**
 * GameSaveViewportManager.ts — 视口摄像机位置存档/恢复 Player 特性
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/GameSaveViewportManager.cs (65 lines)
 *
 * 核心范式转换:
 * - C# MiniYamlNode / FieldSaver.FormatValue → JSON Record<string, any>
 *   (ADR-17.5: JSON replaces MiniYaml for trait data)
 * - C# FieldLoader.GetValue<WPos>("Viewport", ...) → WPos.fromString(str)
 *   (TODO: add WPos.fromString() static factory if not yet present)
 * - C# worldRenderer.Viewport.Center(wPos) → viewport.center(wPos)
 * - C# worldRenderer.World.RenderPlayer = actor.Owner → world.renderPlayer = actor.owner
 * - C# HACK comment preserved: stores observer viewport on first bot's trait
 *
 * GameSaveViewportManager implements IGameSaveTraitData to save the current
 * viewport center position (and the observed render player for spectator mode)
 * when a game save is created, and to restore them when a save is loaded.
 */

import type {
  ITraitInfo,
  IWorldLoaded,
  IGameSaveTraitData,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import { WPos as WPosClass } from '../../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Minimal stubs for WorldRenderer, Viewport, World (avoid heavy imports)
// ---------------------------------------------------------------------------

/**
 * Minimal Viewport view for GameSaveViewportManager.
 *
 * OpenRA 对照: Viewport.CenterPosition + Viewport.Center(WPos)
 */
export interface GameSaveViewport {
  /** Current camera center in world coordinates.
   *
   * OpenRA 对照: Viewport.CenterPosition
   */
  readonly centerPosition: WPos

  /** Set the camera center to a world position.
   *
   * OpenRA 对照: Viewport.Center(WPos)
   */
  center(pos: WPos): void
}

/**
 * Minimal player stub for GameSaveViewportManager.
 *
 * OpenRA 对照: Player (subset: owner, playerActor, isBot)
 *
 * NOTE: playerName is required to satisfy the PlayerStub interface
 * used by IGameActor.owner.
 */
export interface GameSavePlayerStub {
  /** The actor representing this player. */
  readonly playerActor: IGameActor
  /** Whether this player is a bot. */
  readonly isBot: boolean
  /** Display name of the player.
   *
   * OpenRA 对照: Player.PlayerName
   */
  readonly playerName: string
}

/**
 * Minimal World view for GameSaveViewportManager.
 *
 * OpenRA 对照: World reference fields used by this trait
 */
export interface GameSaveViewportWorld {
  /** The local human player, or undefined if observing. */
  readonly localPlayer: GameSavePlayerStub | undefined

  /** The player whose perspective is being rendered. */
  renderPlayer: GameSavePlayerStub | undefined

  /** All players in the game. */
  readonly players: readonly GameSavePlayerStub[]

  /** Look up an actor by its unique ID.
   *
   * OpenRA 对照: World.GetActorById(uint actorID)
   */
  getActorById(actorId: number): IGameActor | undefined
}

/**
 * Minimal WorldRenderer view for GameSaveViewportManager.
 *
 * OpenRA 对照: WorldRenderer
 */
export interface GameSaveViewportWorldRenderer {
  /** The game world being rendered. */
  readonly world: GameSaveViewportWorld

  /** The camera viewport. */
  readonly viewport: GameSaveViewport
}

// ---------------------------------------------------------------------------
// Extended IGameActor for Owner and World access
// ---------------------------------------------------------------------------

/**
 * Actor with non-null owner and world (checked at runtime before cast).
 *
 * NOTE: We use a standalone interface (no extends IGameActor) to avoid
 * type incompatibility with PlayerStub.owner. At runtime, issueTraitData
 * and resolveTraitData verify that owner/world exist before accessing them.
 */
interface ViewportManagerActor {
  readonly actorId: number
  readonly owner: GameSavePlayerStub
  readonly world: GameSaveViewportWorld
}

// ---------------------------------------------------------------------------
// WPos serialization helpers (matching OpenRA FieldSaver / FieldLoader)
// ---------------------------------------------------------------------------

/**
 * Serialize a WPos to a string for save data.
 *
 * OpenRA 对照: FieldSaver.FormatValue(WPos)
 *
 * Format: "X,Y,Z" (same as WPos.toString())
 *
 * @param wpos — the world position to serialize
 * @returns comma-separated coordinate string
 */
function wPosToString(wpos: WPos): string {
  return wpos.toString()
}

/**
 * Parse a WPos from a serialized string.
 *
 * OpenRA 对照: FieldLoader.GetValue<WPos>("Viewport", value)
 *
 * Format: "X,Y,Z"
 *
 * @param str — comma-separated coordinate string
 * @returns parsed WPos, or undefined if format is invalid
 */
function wPosFromString(str: string): WPos | undefined {
  const parts = str.split(',')
  if (parts.length !== 3) return undefined

  const x = parseInt(parts[0]!, 10)
  const y = parseInt(parts[1]!, 10)
  const z = parseInt(parts[2]!, 10)

  if (isNaN(x) || isNaN(y) || isNaN(z)) return undefined

  return new WPosClass(x, y, z)
}

// ---------------------------------------------------------------------------
// GameSaveViewportManagerInfo (对应 OpenRA GameSaveViewportManagerInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for the GameSaveViewportManager player trait.
 *
 * OpenRA 对照: GameSaveViewportManagerInfo : TraitInfo
 *
 * @TraitLocation SystemActors.Player
 */
export class GameSaveViewportManagerInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Create the trait instance.
   *
   * OpenRA 对照: GameSaveViewportManagerInfo.Create(ActorInitializer init)
   *
   * @param _init — actor initializer (unused, trait has no config)
   * @returns a new GameSaveViewportManager instance
   */
  create(_init: { self: IGameActor }): GameSaveViewportManager {
    return new GameSaveViewportManager()
  }
}

// ---------------------------------------------------------------------------
// GameSaveViewportManager (对应 OpenRA GameSaveViewportManager)
// ---------------------------------------------------------------------------

/**
 * Player trait that saves and restores the viewport camera position
 * across game save/load cycles.
 *
 * OpenRA 对照: GameSaveViewportManager : IWorldLoaded, IGameSaveTraitData
 *
 * On save (issueTraitData): records the current viewport center position
 *   as a WPos string. For spectator mode, also records the RenderPlayer.
 *   Uses a HACK: stores observer viewport on the first bot's trait.
 *
 * On load (resolveTraitData): restores the viewport center position and
 *   the observed render player (if applicable).
 */
export class GameSaveViewportManager
  implements IWorldLoaded, IGameSaveTraitData
{
  /** Reference to the world renderer (set in worldLoaded).
   *
   * OpenRA 对照: WorldRenderer worldRenderer (private field)
   */
  private _worldRenderer: GameSaveViewportWorldRenderer | null = null

  // ---------------------------------------------------------------------------
  // IWorldLoaded (对应 OpenRA IWorldLoaded.WorldLoaded)
  // ---------------------------------------------------------------------------

  /**
   * Called when the world is fully loaded and the renderer is available.
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World w, WorldRenderer wr)
   *
   * @param _w — the game world (unused)
   * @param wr — the world renderer
   */
  worldLoaded(
    _w: unknown,
    wr: GameSaveViewportWorldRenderer,
  ): void {
    this._worldRenderer = wr
  }

  // ---------------------------------------------------------------------------
  // IGameSaveTraitData.issueTraitData
  // (对应 OpenRA IGameSaveTraitData.IssueTraitData)
  // ---------------------------------------------------------------------------

  /**
   * Collect viewport state for serialization into a game save.
   *
   * OpenRA 对照: IGameSaveTraitData.IssueTraitData(Actor self)
   *
   * HACK: Store the viewport state for the skirmish observer on the
   * first bot's trait.
   * TODO: This won't make sense for MP saves.
   *
   * @param self — the player actor this trait is attached to
   * @returns trait data Record, or null if this actor shouldn't save data
   */
  issueTraitData(self: IGameActor): Record<string, any> | null {
    const worldRenderer = this._worldRenderer
    if (!worldRenderer) return null

    const world = worldRenderer.world
    const localPlayer = world.localPlayer
    // Use unknown cast: at runtime, self.owner exists for Player-attached traits
    const actor = self as unknown as ViewportManagerActor

    // HACK: Store the viewport state for the skirmish observer on the
    // first bot's trait.
    // If there's a local human player and this isn't their actor → skip
    if (localPlayer != null && localPlayer.playerActor !== self) {
      return null
    }

    // If observer (no local player) and this owner is not the first bot → skip
    if (localPlayer == null) {
      const firstBot = world.players.find((p) => p.isBot)
      if (firstBot === undefined || actor.owner !== firstBot) {
        return null
      }
    }

    const viewportPos = worldRenderer.viewport.centerPosition
    const data: Record<string, any> = {
      Viewport: wPosToString(viewportPos),
    }

    // For observer mode, save which player is being rendered
    const renderPlayer = world.renderPlayer
    if (localPlayer == null && renderPlayer != null) {
      data.RenderPlayer = renderPlayer.playerActor.actorId
    }

    return data
  }

  // ---------------------------------------------------------------------------
  // IGameSaveTraitData.resolveTraitData
  // (对应 OpenRA IGameSaveTraitData.ResolveTraitData)
  // ---------------------------------------------------------------------------

  /**
   * Restore viewport state from a loaded game save.
   *
   * OpenRA 对照: IGameSaveTraitData.ResolveTraitData(Actor self, MiniYaml data)
   *
   * Parses the Viewport WPos string and centers the camera there.
   * If RenderPlayer is present, switches the render perspective to
   * that player's owner.
   *
   * @param _self — the player actor (unused)
   * @param data — trait data from the save file
   */
  resolveTraitData(
    _self: IGameActor,
    data: Record<string, any>,
  ): void {
    const worldRenderer = this._worldRenderer
    if (!worldRenderer) return

    const world = worldRenderer.world

    // Restore viewport position
    const viewportValue = data.Viewport as string | undefined
    if (viewportValue) {
      const wpos = wPosFromString(viewportValue)
      if (wpos) {
        worldRenderer.viewport.center(wpos)
      }
    }

    // Restore render player (observer mode)
    const renderPlayerId = data.RenderPlayer as number | undefined
    if (renderPlayerId != null) {
      const renderPlayerActor = world.getActorById(renderPlayerId)
      if (renderPlayerActor) {
        const actor = renderPlayerActor as unknown as ViewportManagerActor
        if (actor.owner) {
          world.renderPlayer = actor.owner
        }
      }
    }
  }
}
