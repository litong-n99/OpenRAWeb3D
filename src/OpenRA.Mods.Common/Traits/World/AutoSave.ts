/**
 * AutoSave.ts — 自动存档世界特性（含 AutoSaveSettings 设置模块）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/AutoSave.cs (106 lines)
 *
 * 核心范式转换:
 * - C# [YamlNode("AutoSave", shared: true)] SettingsModule → TypeScript
 *   AutoSaveSettings 纯数据类（设置通过 JSON 或 World.getSettings 加载）
 * - C# FileSystemInfo / DirectoryInfo.EnumerateFiles → IndexedDB 游标遍历
 *   （浏览器无传统文件系统；通过 IStorageProvider 抽象）
 * - C# File.Delete() → IndexedDB objectStore.delete(key)
 * - C# DateTime.UtcNow → new Date().toISOString()
 * - C# World.RequestGameSave(filename, true) → self.world.requestGameSave()
 *   TODO-17.D.2a: requestGameSave() not yet implemented on World — uses
 *   callback pattern as interim solution.
 * - C# Game.ModData.Manifest → TODO: use ModData reference for save path
 *
 * AutoSave 在每个游戏 tick 检查是否应触发自动存档。当倒计时归零时，
 * 执行文件轮替（删除超出限制的旧存档），生成 ISO 日期时间文件名，
 * 并调用 World.requestGameSave() 触发存档。
 */

import type {
  ITraitInfo,
  ITick,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Constants (对应 OpenRA AutoSave const)
// ---------------------------------------------------------------------------

/** Filename prefix for auto-save files.
 *
 * OpenRA 对照: AutoSavePattern = "autosave-"
 */
const AUTO_SAVE_PATTERN = 'autosave-'

/** File extension for save files.
 *
 * OpenRA 对照: SaveFileExtension = ".orasav"
 */
const SAVE_FILE_EXTENSION = '.orasav'

/** Minimum allowed value for AutoSaveMaxFileCount.
 *
 * OpenRA 对照: Math.Max(autoSaveMaxFileCount, 3)
 */
const MIN_AUTO_SAVE_FILES = 3

/** Default game timestep in milliseconds (25 TPS = 40ms per tick).
 *
 * OpenRA 对照: Game.Timestep (default 25 TPS)
 */
const DEFAULT_TIMESTEP = 40

// ---------------------------------------------------------------------------
// AutoSaveSettings (对应 OpenRA AutoSaveSettings : SettingsModule)
// ---------------------------------------------------------------------------

/**
 * Shared settings module for auto-save configuration.
 *
 * OpenRA 对照: AutoSaveSettings (shared settings, YAML-loaded)
 *
 * These settings are typically loaded from game settings JSON/YAML and
 * persisted. The World.getSettings<AutoSaveSettings>() method returns
 * a reference to the active settings object.
 */
export class AutoSaveSettings {
  /** Auto-save frequency in seconds. 0 disables auto-save.
   *
   * OpenRA 对照: AutoSaveInterval (default 0)
   */
  AutoSaveInterval: number = 0

  /** Maximum number of auto-save files to keep on storage.
   *
   * OpenRA 对照: AutoSaveMaxFileCount (default 10, minimum 3)
   */
  AutoSaveMaxFileCount: number = 10
}

// ---------------------------------------------------------------------------
// Minimal world view for AutoSave
// ---------------------------------------------------------------------------

/**
 * Information about an auto-save file on disk.
 *
 * OpenRA 对照: FileSystemInfo (CreationTime, Delete())
 */
export interface AutoSaveFileEntry {
  /** The file name (e.g., "autosave-2024-01-01T120000Z.orasav"). */
  name: string
  /** File creation timestamp.
   *
   * OpenRA 对照: FileInfo.CreationTime
   */
  createdTime: Date
}

/**
 * Minimal lobby info for AutoSave's disabled-state check.
 *
 * OpenRA 对照: World.LobbyInfo.GlobalSettings.Dedicated +
 * LobbyInfo.NonBotClients.Count() > 1
 */
export interface AutoSaveLobbyInfo {
  readonly globalSettings: {
    readonly dedicated?: boolean
  }
  /** All non-bot human clients. */
  readonly nonBotClients: readonly unknown[]
}

/**
 * Minimal world view needed by AutoSave.
 *
 * OpenRA 对照: World reference fields used by AutoSave
 */
export interface AutoSaveWorld {
  readonly timestep: number
  readonly isReplay: boolean
  readonly isLoadingGameSave: boolean
  readonly lobbyInfo: AutoSaveLobbyInfo

  /**
   * Get settings instance by type.
   *
   * OpenRA 对照: World.GetSettings<T>()
   */
  getSettings<T>(settingsType: new () => T): T

  /**
   * Request a game save for the current world state.
   *
   * OpenRA 对照: World.RequestGameSave(string filename, bool isAutosave)
   *
   * TODO-17.D.2a: Implement requestGameSave on GameWorldManager.
   */
  requestGameSave(filename: string, isAutosave: boolean): void

  /**
   * Enumerate all auto-save files in the save directory.
   *
   * OpenRA 对照: GetAutoSaveFiles() → IEnumerable<FileSystemInfo>
   *
   * In the browser, this queries IndexedDB. The default implementation
   * returns an empty array; a real storage provider must be injected.
   */
  getAutoSaveFiles(): AutoSaveFileEntry[]

  /**
   * Delete a specific auto-save file.
   *
   * OpenRA 对照: FileInfo.Delete()
   */
  deleteAutoSaveFile(filename: string): void
}

// ---------------------------------------------------------------------------
// Extended actor type for AutoSave (avoids extending IGameActor to bypass
// WorldStub.actors requirement — the trait only uses AutoSaveWorld methods)
// ---------------------------------------------------------------------------

/** Actor with world reference needed by AutoSave. */
interface AutoSaveActor {
  readonly actorId: number
  readonly world: AutoSaveWorld
}

// ---------------------------------------------------------------------------
// AutoSaveInfo (对应 OpenRA AutoSaveInfo : TraitInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for the AutoSave world trait.
 *
 * OpenRA 对照: AutoSaveInfo
 *
 * @TraitLocation SystemActors.World
 * @Desc Add this trait to the world actor to enable auto-save.
 */
export class AutoSaveInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Create the trait instance.
   *
   * OpenRA 对照: AutoSaveInfo.Create(ActorInitializer init)
   *
   * @param init — actor initializer providing access to self (the world actor)
   * @returns a new AutoSave instance
   */
  create(init: { self: IGameActor }): AutoSave {
    return new AutoSave(
      init.self as unknown as AutoSaveActor,
      this,
    )
  }
}

// ---------------------------------------------------------------------------
// AutoSave (对应 OpenRA AutoSave : ITick)
// ---------------------------------------------------------------------------

/**
 * World trait that periodically triggers automatic game saves.
 *
 * OpenRA 对照: AutoSave
 *
 * Implements ITick. On each tick, decrements a countdown timer and
 * triggers a save when it reaches zero. Automatically rotates old
 * auto-save files to stay within the configured maximum count.
 */
export class AutoSave implements ITick {
  /** Auto-save filename pattern.
   *
   * OpenRA 对照: AutoSavePattern const
   */
  static readonly AutoSavePattern = AUTO_SAVE_PATTERN

  /** Save file extension.
   *
   * OpenRA 对照: SaveFileExtension const
   */
  static readonly SaveFileExtension = SAVE_FILE_EXTENSION

  /** Ticks remaining until the next auto-save is triggered.
   *
   * OpenRA 对照: ticksUntilAutoSave
   */
  ticksUntilAutoSave: number

  /** Last known auto-save interval for change detection.
   *
   * OpenRA 对照: lastSaveInterval (note: C# has typo "lastSaveInverval")
   */
  private _lastSaveInterval: number

  /** Whether auto-save is disabled for the current game mode.
   *
   * OpenRA 对照: isDisabled (readonly)
   */
  readonly isDisabled: boolean

  /** Reference to the auto-save settings.
   *
   * OpenRA 对照: autoSaveSettings
   */
  readonly autoSaveSettings: AutoSaveSettings

  /** Reference to the world actor (for tick callback).
   *
   * NOTE: Stored for ITick.tick(self) — not in C# (C# uses field auto-capture).
   */
  private readonly _world: AutoSaveWorld

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA AutoSave(Actor, AutoSaveInfo))
  // ---------------------------------------------------------------------------

  /**
   * Create an AutoSave trait for the world actor.
   *
   * OpenRA 对照: AutoSave(Actor self, AutoSaveInfo info)
   *
   * Loads settings, initializes the countdown timer, and computes
   * the disabled state based on game mode.
   *
   * @param self — the world actor this trait is attached to
   * @param _info — trait configuration (unused, all config from settings)
   */
  constructor(self: AutoSaveActor, _info: AutoSaveInfo) {
    const world = self.world

    this.autoSaveSettings = world.getSettings(AutoSaveSettings)
    this.ticksUntilAutoSave = this._getTicksBetweenAutosaves(world)
    this._lastSaveInterval = this.autoSaveSettings.AutoSaveInterval

    this.isDisabled =
      !!world.lobbyInfo.globalSettings.dedicated ||
      world.lobbyInfo.nonBotClients.length > 1

    this._world = world
  }

  // ---------------------------------------------------------------------------
  // ITick.tick (对应 OpenRA ITick.Tick(Actor self))
  // ---------------------------------------------------------------------------

  /**
   * Called every game logic tick.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * Decrements the countdown timer and triggers a save when it reaches 0.
   * Skips if auto-save is disabled, in replay mode, loading a save, or
   * the interval is 0.
   *
   * @param _self — the world actor (unused, stored in constructor)
   */
  tick(_self: IGameActor): void {
    const world = this._world

    if (this.isDisabled || world.isReplay || world.isLoadingGameSave) {
      return
    }

    if (this.autoSaveSettings.AutoSaveInterval === 0) {
      return
    }

    const autoSaveFileLimit = Math.max(
      this.autoSaveSettings.AutoSaveMaxFileCount,
      MIN_AUTO_SAVE_FILES,
    )

    // Detect interval change
    if (this._lastSaveInterval !== this.autoSaveSettings.AutoSaveInterval) {
      this._lastSaveInterval = this.autoSaveSettings.AutoSaveInterval
      this.ticksUntilAutoSave = this._getTicksBetweenAutosaves(world)
    }

    // Decrement countdown
    if (--this.ticksUntilAutoSave > 0) {
      return
    }

    // File rotation: delete oldest files beyond max count
    const oldAutoSaveFiles = world
      .getAutoSaveFiles()
      .sort((a, b) => b.createdTime.getTime() - a.createdTime.getTime())
      .slice(autoSaveFileLimit - 1)

    for (const oldFile of oldAutoSaveFiles) {
      world.deleteAutoSaveFile(oldFile.name)
    }

    // Generate ISO datetime filename (matching C# yyyy-MM-ddTHHmmssZ, no ms)
    const now = new Date()
    const year = now.getUTCFullYear().toString()
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0')
    const day = now.getUTCDate().toString().padStart(2, '0')
    const hours = now.getUTCHours().toString().padStart(2, '0')
    const minutes = now.getUTCMinutes().toString().padStart(2, '0')
    const seconds = now.getUTCSeconds().toString().padStart(2, '0')
    const dateTime = `${year}-${month}-${day}T${hours}${minutes}${seconds}Z`

    const fileName = `${AUTO_SAVE_PATTERN}${dateTime}${SAVE_FILE_EXTENSION}`

    world.requestGameSave(fileName, true)
    this.ticksUntilAutoSave = this._getTicksBetweenAutosaves(world)
  }

  // ---------------------------------------------------------------------------
  // Private: getTicksBetweenAutosaves (对应 OpenRA GetTicksBetweenAutosaves)
  // ---------------------------------------------------------------------------

  /**
   * Convert the auto-save interval from seconds to game ticks.
   *
   * OpenRA 对照: GetTicksBetweenAutosaves(Actor self)
   *
   * Formula: 1000 / timestep * intervalInSeconds
   * At 25 TPS (timestep=40ms): 25 * intervalInSeconds
   *
   * @param world — the game world (for timestep)
   * @returns tick count until next auto-save
   */
  private _getTicksBetweenAutosaves(world: AutoSaveWorld): number {
    const timestep = world.timestep || DEFAULT_TIMESTEP
    return (1000 / timestep) * this.autoSaveSettings.AutoSaveInterval
  }
}
