/**
 * BrowserTypes.ts — shared enums and interfaces for Phase C browser menu Logic
 * OpenRA 对照: Various enums from MapPreview, GameSave, ReplayMetadata, etc.
 *
 * 核心范式转换:
 * - OpenRA C# enums → TypeScript const objects (erasableSyntaxOnly compatible)
 * - OpenRA MapClassification / MapStatus / MapVisibility → TypeScript const objects
 * - OpenRA File.GetLastWriteTime / File.GetCreationTime → Date object properties
 *
 * NOTE: This is a dependency stub module. Full implementations of MapPreview,
 * GameSave, ReplayMetadata, and related systems are deferred to later chapters.
 */

// ---------------------------------------------------------------------------
// MapClassification — map origin classification
// OpenRA 对照: MapClassification enum
// ---------------------------------------------------------------------------

export const MapClassification = {
  Unknown: 'Unknown',
  System: 'System',
  User: 'User',
  Remote: 'Remote',
  Generated: 'Generated',
} as const

export type MapClassification =
  (typeof MapClassification)[keyof typeof MapClassification]

// ---------------------------------------------------------------------------
// MapStatus — map availability status
// OpenRA 对照: MapStatus enum
// ---------------------------------------------------------------------------

export const MapStatus = {
  Available: 'Available',
  Unavailable: 'Unavailable',
  Downloading: 'Downloading',
  Searching: 'Searching',
  Generating: 'Generating',
} as const

export type MapStatus = (typeof MapStatus)[keyof typeof MapStatus]

// ---------------------------------------------------------------------------
// MapVisibility — map visibility flags
// OpenRA 对照: [Flags] MapVisibility enum
// ---------------------------------------------------------------------------

export const MapVisibility = {
  None: 0,
  Lobby: 1 << 0,
  Shellmap: 1 << 1,
  MissionSelector: 1 << 2,
} as const

export type MapVisibility = number

// ---------------------------------------------------------------------------
// MapPreview stub — minimal map metadata
// OpenRA 对照: MapPreview class
// ---------------------------------------------------------------------------

export interface MapPreviewStub {
  uid: string
  title: string
  author: string
  playerCount: number
  bounds: { width: number; height: number }
  status: MapStatus
  class: MapClassification
  visibility: MapVisibility
  categories: string[]
  modifiedDate: Date
  minimapRendered?: boolean
}

// ---------------------------------------------------------------------------
// MapCache stub — minimal map catalog
// OpenRA 对照: MapCache class
// ---------------------------------------------------------------------------

export interface MapCacheStub {
  maps: MapPreviewStub[]
  getMap(uid: string): MapPreviewStub | undefined
  getMapsByClass(cls: MapClassification): MapPreviewStub[]
  getAvailableMaps(): MapPreviewStub[]
}

// ---------------------------------------------------------------------------
// MapGenerationArgs stub
// OpenRA 对照: MapGenerationArgs class
// ---------------------------------------------------------------------------

export interface MapGenerationArgsStub {
  uid: string
  tileset: string
  size: { width: number; height: number }
  seed: number
  settings: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// GameSave stub — minimal save game metadata
// OpenRA 对照: GameSave class
// ---------------------------------------------------------------------------

export interface GameSaveStub {
  path: string
  lastWrite: Date
  creationTime: Date
  duration?: { totalMinutes: number }
  mapTitle: string
  mapUid: string
  factions: string[]
  players: GameSavePlayerStub[]
  slotClients: Map<string, SlotClientStub>
  globalSettings: { map: string; gameTimestep?: number }
  lastOrdersFrame?: number
  mapGenerationArgs?: MapGenerationArgsStub | null
}

export interface GameSavePlayerStub {
  name: string
  faction: string
  color: { r: number; g: number; b: number; a: number }
  team: number
  spawnPoint: number
  isBot: boolean
  botName?: string
}

export interface SlotClientStub {
  faction: string
  color: { r: number; g: number; b: number; a: number }
  spawnPoint: number
  team: number
  bot: string | null
  botName: string
  name: string
}

// ---------------------------------------------------------------------------
// SpawnOccupant stub
// OpenRA 对照: SpawnOccupant class
// ---------------------------------------------------------------------------

export interface SpawnOccupantStub {
  color: { r: number; g: number; b: number; a: number }
  faction: string
  spawnPoint: number
  team: number
}

// ---------------------------------------------------------------------------
// ReplayMetadata stub — minimal replay metadata
// OpenRA 对照: ReplayMetadata class
// ---------------------------------------------------------------------------

export interface ReplayMetadataStub {
  filePath: string
  gameInfo: ReplayGameInfoStub
}

export interface ReplayGameInfoStub {
  mapTitle: string
  mapUid: string
  startTimeUtc: Date
  duration: { totalMinutes: number }
  isSinglePlayer: boolean
  players: ReplayPlayerStub[]
  disabledSpawnPoints?: number[]
}

export interface ReplayPlayerStub {
  name: string
  factionName: string
  factionId: string
  color: { r: number; g: number; b: number; a: number }
  team: number
  spawnPoint: number
  outcome: WinState
}

// ---------------------------------------------------------------------------
// WinState — match outcome
// OpenRA 对照: WinState enum
// ---------------------------------------------------------------------------

export const WinState = {
  Undefined: 'Undefined',
  Won: 'Won',
  Lost: 'Lost',
} as const

export type WinState = (typeof WinState)[keyof typeof WinState]

// ---------------------------------------------------------------------------
// Filter enums used across browser Logics
// ---------------------------------------------------------------------------

export const SaveType = {
  Any: 'Any',
  Autosave: 'Autosave',
  Manual: 'Manual',
} as const
export type SaveType = (typeof SaveType)[keyof typeof SaveType]

export const DateType = {
  Any: 'Any',
  Today: 'Today',
  LastWeek: 'LastWeek',
  LastFortnight: 'LastFortnight',
  LastMonth: 'LastMonth',
} as const
export type DateType = (typeof DateType)[keyof typeof DateType]

export const DurationType = {
  Any: 'Any',
  VeryShort: 'VeryShort',
  Short: 'Short',
  Medium: 'Medium',
  Long: 'Long',
} as const
export type DurationType = (typeof DurationType)[keyof typeof DurationType]

export const GameType = {
  Any: 'Any',
  Singleplayer: 'Singleplayer',
  Multiplayer: 'Multiplayer',
} as const
export type GameType = (typeof GameType)[keyof typeof GameType]

// ---------------------------------------------------------------------------
// LobbyOption stubs — for MissionBrowserLogic
// ---------------------------------------------------------------------------

export interface LobbyOptionStub {
  id: string
  name: string
  description: string | null
  defaultValue: string
  values: Map<string, string> | Record<string, string>
  isVisible: boolean
  isLocked: boolean
  displayOrder: number
}

export interface LobbyBooleanOptionStub extends LobbyOptionStub {
  // marker interface for boolean lobby options
}

// ---------------------------------------------------------------------------
// FactionInfo stub
// ---------------------------------------------------------------------------

export interface FactionInfoStub {
  internalName: string
  name: string
}

// ---------------------------------------------------------------------------
// MissionData stub
// ---------------------------------------------------------------------------

export interface MissionDataStub {
  briefingVideo: string | null
  backgroundVideo: string | null
  startVideo: string | null
  briefing: string
}

// ---------------------------------------------------------------------------
// Helper: fluent message provider stub
// ---------------------------------------------------------------------------

/**
 * Stub for FluentProvider.GetMessage.
 *
 * OpenRA 对照: FluentProvider.GetMessage(string key, ...args)
 *
 * NOTE: Full FluentProvider not yet migrated. Returns the key directly
 * with optional argument substitution.
 */
export function fluentGetMessage(key: string, args?: Record<string, string | number>): string {
  if (!args) return key
  let result = key
  for (const [k, v] of Object.entries(args)) {
    result = result.replace(`{${k}}`, String(v))
  }
  return result
}
