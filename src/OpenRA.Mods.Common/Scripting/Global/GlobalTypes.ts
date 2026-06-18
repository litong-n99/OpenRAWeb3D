/**
 * GlobalTypes.ts — Phase C extended interface types for ScriptGlobal subclasses
 * OpenRA 对照: Various World/Map/ActorMap APIs consumed by Global tables
 *
 * 核心范式转换:
 * - C# world.Map, world.ActorMap, world.WorldActor, etc.
 *   → Extended stub interfaces that Phase C Globals can depend on
 * - These interfaces will be replaced with real implementations when
 *   the engine wiring is complete (later phases)
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'
import type { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'

// ---------------------------------------------------------------------------
// WorldType — const object (erasableSyntaxOnly-compatible)
// ---------------------------------------------------------------------------

export const WorldType = {
  Normal: 0,
  Shellmap: 1,
  Editor: 2,
} as const

export type WorldType = (typeof WorldType)[keyof typeof WorldType]

// ---------------------------------------------------------------------------
// Phase C World Stub — extends WorldStub with methods needed by Globals
// ---------------------------------------------------------------------------

/**
 * Extended world interface for Phase C Global API tables.
 *
 * OpenRA 对照: OpenRA.Game/World.cs (public members used by script globals)
 *
 * This is a superset of WorldStub. As the engine is wired, these
 * methods will be provided by the real World implementation.
 */
export interface PhaseCWorldStub {
  readonly actors: Iterable<IGameActor>
  readonly players: Iterable<PlayerStub>
  readonly worldTick: number
  readonly worldActor: IGameActor
  readonly sharedRandom: { next(low: number, high: number): number }
  readonly localPlayer: PlayerStub | null
  readonly lobbyInfo: { nonBotPlayers: Iterable<PlayerStub> }
  readonly map: PhaseCMapStub
  readonly rules: PhaseCRulesStub
  readonly actorMap: PhaseCActorMapStub

  addFrameEndTask(task: () => void): void
  createActor(addToWorld: boolean, type: string, inits: readonly unknown[]): IGameActor
  findActorsInCircle(center: WPos, radius: WDist): IGameActor[]
  addActor?(actor: IGameActor): void

  /** Type of world (Normal, Shellmap, Editor). */
  readonly type: WorldType
}

// ---------------------------------------------------------------------------
// Phase C Map Stub
// ---------------------------------------------------------------------------

export interface PhaseCMapStub {
  readonly rules: PhaseCRulesStub
  readonly projectedTopLeft: WPos
  readonly projectedBottomRight: WPos

  contains(pos: WPos): boolean
  cellContaining(pos: WPos): CPos
  centerOfCell(cell: CPos): WPos
  chooseRandomCell(rng: { next(lo: number, hi: number): number }): CPos
  chooseRandomEdgeCell(rng: { next(lo: number, hi: number): number }): CPos
  chooseClosestEdgeCell(cell: CPos): CPos
  readonly allEdgeCells: CPos[]
  getTerrainInfo(cell: CPos): { type: string }
  facingBetween(from: CPos, to: CPos, fallback: WAngle): WAngle
}

// ---------------------------------------------------------------------------
// Phase C Rules Stub
// ---------------------------------------------------------------------------

export interface PhaseCRulesStub {
  readonly actors: ReadonlyMap<string, PhaseCActorInfoStub>
  readonly music: ReadonlyMap<string, unknown>
}

/**
 * Actor info stub for Phase C — enough to support BuildTime(), CruiseAltitude(), Cost().
 */
export interface PhaseCActorInfoStub {
  readonly name: string
  readonly traitInfos: ReadonlyMap<string, unknown>
  hasTraitInfo(name: string): boolean
  getTraitInfo<T>(name: string): T | undefined
}

// ---------------------------------------------------------------------------
// Phase C ActorMap Stub
// ---------------------------------------------------------------------------

export interface PhaseCActorMapStub {
  actorsInBox(topLeft: WPos, bottomRight: WPos): IGameActor[]
  addCellTrigger(cells: CPos[], onEntry: ((a: IGameActor) => void) | null, onExit: ((a: IGameActor) => void) | null): number
  removeCellTrigger(id: number): void
  addProximityTrigger(pos: WPos, range: WDist, margin: WDist, onEntry: ((a: IGameActor) => void) | null, onExit: ((a: IGameActor) => void) | null): number
  removeProximityTrigger(id: number): void
}

// ---------------------------------------------------------------------------
// Phase C Viewport Stub (for CameraGlobal)
// ---------------------------------------------------------------------------

export interface PhaseCViewportStub {
  readonly centerPosition: WPos
  center(pos: WPos): void
}

// ---------------------------------------------------------------------------
// Phase C Context extension
// ---------------------------------------------------------------------------

/**
 * Extended script context with Phase C world methods.
 * Cast IScriptContext.world to PhaseCWorldStub internally.
 */
export type PhaseCContext = IScriptContext & {
  readonly world: PhaseCWorldStub
  readonly worldRenderer: { viewport: PhaseCViewportStub }
}
