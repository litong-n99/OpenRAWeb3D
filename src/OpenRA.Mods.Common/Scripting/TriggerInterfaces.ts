/**
 * TriggerInterfaces.ts — INotify* interfaces needed by ScriptTriggers but
 * not yet present in TraitsInterfaces.ts.
 *
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (selected INotify*)
 *
 * These 10 interfaces are declared here rather than in TraitsInterfaces.ts
 * to avoid bloating that file further. They will be consumed by Phase C's
 * TriggerGlobal and by any trait that bridges game events to scripts.
 *
 * 核心范式转换:
 * - C# ITraitNotifyInterface + pattern-based method naming
 *   → Explicit TypeScript interface contracts
 * - C# BitSet<CaptureType> / BitSet<TargetableType> parameters
 *   → number (bitmask) — the TS convention for bit-set types
 * - C# TypeDictionary init parameter (INotifyOtherProduction)
 *   → Record<string, unknown> — generic key-value init bag
 */

import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// INotifyProduction
// ---------------------------------------------------------------------------

/**
 * Notified when an actor produces another actor.
 *
 * OpenRA 对照: INotifyProduction { void UnitProduced(Actor self, Actor other, CPos exit); }
 */
export interface INotifyProduction {
  unitProduced(self: IGameActor, other: IGameActor, exitCell: CPos): void
}

// ---------------------------------------------------------------------------
// INotifyOtherProduction
// ---------------------------------------------------------------------------

/**
 * Notified when SOME OTHER actor produces an actor.
 *
 * OpenRA 对照: INotifyOtherProduction
 *   { void UnitProducedByOther(Actor self, Actor producee, Actor produced,
 *     string productionType, TypeDictionary init); }
 */
export interface INotifyOtherProduction {
  unitProducedByOther(
    self: IGameActor,
    producee: IGameActor,
    produced: IGameActor,
    productionType: string,
    init: Record<string, unknown>,
  ): void
}

// ---------------------------------------------------------------------------
// INotifyBuildingPlaced
// ---------------------------------------------------------------------------

/**
 * Notified when a building placement is completed.
 *
 * OpenRA 对照: INotifyBuildingPlaced
 *   { void BuildingPlaced(Actor self, Actor building); }
 */
export interface INotifyBuildingPlaced {
  buildingPlaced(self: IGameActor, building: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyObjectivesUpdated
// ---------------------------------------------------------------------------

/**
 * Notified when mission objectives change state.
 *
 * OpenRA 对照: INotifyObjectivesUpdated
 *   { void OnObjectiveAdded(Player player, int id);
 *     void OnObjectiveCompleted(Player player, int id);
 *     void OnObjectiveFailed(Player player, int id); }
 */
export interface INotifyObjectivesUpdated {
  onObjectiveAdded(player: PlayerStub, id: number): void
  onObjectiveCompleted(player: PlayerStub, id: number): void
  onObjectiveFailed(player: PlayerStub, id: number): void
}

// ---------------------------------------------------------------------------
// INotifyInfiltrated (Common version)
// ---------------------------------------------------------------------------

/**
 * Notified on the TARGET actor when infiltrated.
 *
 * OpenRA 对照: INotifyInfiltrated
 *   { void Infiltrated(Actor self, Actor infiltrator, BitSet<TargetableType> types); }
 *
 * NOTE: A Cnc-specific version exists in InfiltrationInterfaces.ts.
 * This is the Common version used by ScriptTriggers.
 */
export interface INotifyInfiltrated {
  infiltrated(self: IGameActor, infiltrator: IGameActor, types: number): void
}

// ---------------------------------------------------------------------------
// INotifyDiscovered
// ---------------------------------------------------------------------------

/**
 * Notified when an actor is discovered by a player.
 *
 * OpenRA 对照: INotifyDiscovered
 *   { void OnDiscovered(Actor self, Player discoverer, bool playNotification); }
 */
export interface INotifyDiscovered {
  onDiscovered(self: IGameActor, discoverer: PlayerStub, playNotification: boolean): void
}

// ---------------------------------------------------------------------------
// INotifyPassengerEntered
// ---------------------------------------------------------------------------

/**
 * Notified when a passenger enters a transport.
 *
 * OpenRA 对照: INotifyPassengerEntered
 *   { void OnPassengerEntered(Actor self, Actor passenger); }
 */
export interface INotifyPassengerEntered {
  onPassengerEntered(self: IGameActor, passenger: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyPassengerExited
// ---------------------------------------------------------------------------

/**
 * Notified when a passenger exits a transport.
 *
 * OpenRA 对照: INotifyPassengerExited
 *   { void OnPassengerExited(Actor self, Actor passenger); }
 */
export interface INotifyPassengerExited {
  onPassengerExited(self: IGameActor, passenger: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyWinStateChanged
// ---------------------------------------------------------------------------

/**
 * Notified when a player wins or loses.
 *
 * OpenRA 对照: INotifyWinStateChanged
 *   { void OnPlayerWon(Player player);
 *     void OnPlayerLost(Player player); }
 */
export interface INotifyWinStateChanged {
  onPlayerWon(player: PlayerStub): void
  onPlayerLost(player: PlayerStub): void
}

// ---------------------------------------------------------------------------
// INotifyTimeLimit
// ---------------------------------------------------------------------------

/**
 * Notified when the mission time limit expires.
 *
 * OpenRA 对照: INotifyTimeLimit
 *   { void NotifyTimerExpired(Actor self); }
 */
export interface INotifyTimeLimit {
  notifyTimerExpired(self: IGameActor): void
}
