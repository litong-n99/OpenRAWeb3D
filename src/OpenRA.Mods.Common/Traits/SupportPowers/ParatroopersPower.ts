/**
 * ParatroopersPower.ts — 伞兵投放支援能力（运输机编队投放步兵）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/ParatroopersPower.cs (277 lines)
 *
 * 核心范式转换:
 * - C# DirectionalSupportPower extends SupportPower → TS extends DirectionalSupportPower
 * - C# Fly/ParaDrop/Cargo activity queuing → TS Activity 桩（导入 Ch9）
 * - C# ParaDrop.SetLZ + OnEnteredDropRange/OnExitedDropRange → TS ParaDrop 桩
 * - C# Cargo.Load(a, unit) → TS Cargo 桩
 * - C# Beacon effect → TS Beacon 桩（同 AirstrikePower）
 * - C# camera actor spawn at drop range → TS camera 桩
 * - C# DropItems distributed among planes with ceiling division → TS 同逻辑
 * - C# Unused units disposed via Dispose() → TS dispose 调用
 * - C# Reinforcement notifications (speech + text) → TS 音频/文本桩
 * - C# World.CreateActor(false, unitType, inits) → TS World 桩
 * - C# Map.Rules.Actors.TryGetValue() → TS 配置查找桩
 * - C# Even-sized squads skip lead plane → TS 同逻辑
 *
 * ParatroopersPower sends aircraft loaded with infantry to a drop zone.
 * Infantry are distributed evenly among planes. When aircraft enter the drop
 * range, ParaDrop triggers to release passengers. Unused units are disposed.
 */

import {
  DirectionalSupportPower,
  type DirectionalSupportPowerInfo,
} from './DirectionalSupportPower.js'
import type { ISupportPowerManager, OrderStub } from './SupportPower.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WorldPos } from './AirstrikePower.js'

// ---------------------------------------------------------------------------
// Forward stubs for Ch9 types (Cargo, ParaDrop)
// ---------------------------------------------------------------------------

/** Forward reference to ParaDrop trait from Ch9. */
export interface IParaDrop {
  /** Set the landing zone for the paradrop.
   *
   * OpenRA 对照: ParaDrop.SetLZ(CPos, bool)
   *
   * @param cell — the target cell
   * @param checkImpassable — whether to check for impassable terrain
   */
  setLZ(cell: { readonly X: number; readonly Y: number }, checkImpassable: boolean): void

  /** Callback when aircraft enters drop range. */
  onEnteredDropRange?: ((actor: IGameActor) => void) | null

  /** Callback when aircraft exits drop range. */
  onExitedDropRange?: ((actor: IGameActor) => void) | null

  /** Callback when aircraft is removed from the world. */
  onRemovedFromWorld?: ((actor: IGameActor) => void) | null
}

/** Forward reference to Cargo trait from Ch9. */
export interface ICargo {
  /** Load a unit into the cargo hold.
   *
   * OpenRA 对照: Cargo.Load(Actor, Actor)
   *
   * @param self — the cargo aircraft
   * @param passenger — the unit to load
   */
  load(self: IGameActor, passenger: IGameActor): void
}

// ---------------------------------------------------------------------------
// ParatroopersPowerInfo
// OpenRA 对照: ParatroopersPowerInfo : DirectionalSupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for ParatroopersPower.
 *
 * OpenRA 对照: ParatroopersPowerInfo
 *
 * Defines aircraft type, formation, drop items (infantry), drop zone
 * validation, camera actor, and beacon configuration.
 */
export interface ParatroopersPowerInfo extends DirectionalSupportPowerInfo {
  /** Aircraft used to deliver the drop (default "badr").
   *
   * OpenRA 对照: ParatroopersPowerInfo.UnitType
   */
  readonly unitType?: string

  /** Number of aircraft to use in the formation (default 1).
   *
   * OpenRA 对照: ParatroopersPowerInfo.SquadSize
   */
  readonly squadSize?: number

  /** Distance between aircraft in a formation.
   *
   * OpenRA 对照: ParatroopersPowerInfo.SquadOffset (default (-1536, 1536, 0))
   */
  readonly squadOffset?: { readonly X: number; readonly Y: number; readonly Z: number }

  /** Speech notification when entering the drop zone.
   *
   * OpenRA 对照: ParatroopersPowerInfo.ReinforcementsArrivedSpeechNotification
   */
  readonly reinforcementsArrivedSpeechNotification?: string | null

  /** Text notification when entering the drop zone.
   *
   * OpenRA 对照: ParatroopersPowerInfo.ReinforcementsArrivedTextNotification
   */
  readonly reinforcementsArrivedTextNotification?: string | null

  /** Number of facings for approach direction (default 32).
   *
   * OpenRA 对照: ParatroopersPowerInfo.QuantizedFacings
   */
  readonly quantizedFacings?: number

  /** Spawn distance beyond map edge (default WDist(5120)).
   *
   * OpenRA 对照: ParatroopersPowerInfo.Cordon
   */
  readonly cordon?: number

  /** Troops to be delivered. Distributed between planes if SquadSize > 1.
   *
   * OpenRA 对照: ParatroopersPowerInfo.DropItems (ImmutableArray<string>)
   */
  readonly dropItems?: readonly string[]

  /** Risks stuck units when they don't have the Paratrooper trait.
   *
   * OpenRA 对照: ParatroopersPowerInfo.AllowImpassableCells (default false)
   */
  readonly allowImpassableCells?: boolean

  /** Actor to spawn when the paradrop starts (optional).
   *
   * OpenRA 对照: ParatroopersPowerInfo.CameraActor
   */
  readonly cameraActor?: string | null

  /** Ticks to keep the camera alive while the passengers drop (default 85).
   *
   * OpenRA 对照: ParatroopersPowerInfo.CameraRemoveDelay
   */
  readonly cameraRemoveDelay?: number

  /** Weapon range offset for beacon clock calculation.
   *
   * OpenRA 对照: ParatroopersPowerInfo.BeaconDistanceOffset (default WDist.FromCells(4))
   */
  readonly beaconDistanceOffset?: number
}

/** Default values for ParatroopersPowerInfo. */
export const PARATROOPERS_POWER_DEFAULTS = {
  unitType: 'badr',
  squadSize: 1,
  squadOffset: { X: -1536, Y: 1536, Z: 0 },
  quantizedFacings: 32,
  cordon: 5120,
  allowImpassableCells: false,
  cameraRemoveDelay: 85,
  beaconDistanceOffset: 4 * 1024, // WDist.FromCells(4).Length
} as const

// ---------------------------------------------------------------------------
// ParatroopersPower
// OpenRA 对照: ParatroopersPower : DirectionalSupportPower
// ---------------------------------------------------------------------------

/**
 * Support power that spawns transport aircraft to paradrop infantry at a target.
 *
 * OpenRA 对照: ParatroopersPower
 *
 * Aircraft are spawned at a random map edge, fly to the drop zone, release
 * paratroopers via ParaDrop/Cargo, then exit at the opposite edge. Infantry
 * are created at the start and distributed among planes. Unused infantry units
 * are disposed. A Beacon clock tracks remaining flight time. Reinforcements
 * arrived notification plays when the first plane enters the drop zone.
 *
 * Even-sized squads skip the lead plane (i == 0) for symmetric formation.
 */
export class ParatroopersPower extends DirectionalSupportPower {
  /** Typed info reference.
   *
   * OpenRA 对照: ParatroopersPower.info
   */
  get paraInfo(): ParatroopersPowerInfo {
    return this.info as ParatroopersPowerInfo
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the paradrop power.
   *
   * OpenRA 对照: ParatroopersPower.Activate(Actor, Order, SupportPowerManager)
   *
   * Extracts facing from order ExtraData (if UseDirectionalTarget) or uses
   * a random facing. Delegates to SendParatroopers().
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)

    const useDirectional = this.dirInfo.useDirectionalTarget ?? false
    const hasExtraData = order.extraData !== undefined && order.extraData !== 0xffffffff
    const facing = useDirectional && hasExtraData
      ? order.extraData as number
      : null

    const target = order.target?.centerPosition
    if (!target) return

    this.sendParatroopers(self, target, facing)
  }

  // -----------------------------------------------------------------------
  // SendParatroopers — main paradrop logic
  // -----------------------------------------------------------------------

  /**
   * Send a formation of aircraft to paradrop infantry at the target.
   *
   * OpenRA 对照: ParatroopersPower.SendParatroopers(Actor, WPos, WAngle?)
   *
   * Creates aircraft at the map edge, creates infantry units, distributes
   * them among planes, configures ParaDrop landing zones, subscribes to
   * range callbacks, and queues Fly activities.
   *
   * @param self — the actor holding this power
   * @param targetPos — the target position
   * @param _facingFacing — the approach facing (WAngle.Facing value), or null for random
   * @returns tuple of { aircraft, units }
   */
  sendParatroopers(
    self: IGameActor,
    targetPos: WorldPos,
    _facingFacing: number | null,
  ): { aircraft: IGameActor[]; units: IGameActor[] } {
    const squadSize = this.paraInfo.squadSize ?? PARATROOPERS_POWER_DEFAULTS.squadSize
    const unitType = this.paraInfo.unitType ?? PARATROOPERS_POWER_DEFAULTS.unitType
    const squadOff = this.paraInfo.squadOffset ?? PARATROOPERS_POWER_DEFAULTS.squadOffset
    const dropItems = this.paraInfo.dropItems ?? []

    // Resolve facing
    const facing = this._resolveFacing(self, _facingFacing)
    const altitude = this._getCruiseAltitude(self, unitType)
    const delta = this._computeDelta(facing)
    const target3d: WorldPos = {
      X: targetPos.X,
      Y: targetPos.Y,
      Z: targetPos.Z + altitude,
    }

    const startEdge = this._computeEdge(target3d, delta, -1, self)
    const finishEdge = this._computeEdge(target3d, delta, 1, self)

    // Aircraft and unit tracking
    const aircraft: IGameActor[] = []
    const units: IGameActor[] = []
    const aircraftInRange: Map<IGameActor, boolean> = new Map()
    let camera: IGameActor | null = null
    let beacon: unknown = null

    // Callback: OnEnterRange
    const onEnterRange = (a: IGameActor): void => {
      // Spawn camera when first plane enters the target area
      if (
        this.paraInfo.cameraActor &&
        camera === null &&
        !Array.from(aircraftInRange.values()).some((v) => v)
      ) {
        camera = this._spawnCamera(self, targetPos)
      }

      this._removeBeacon(self, beacon)
      beacon = null

      // Play reinforcements arrived notification
      if (!Array.from(aircraftInRange.values()).some((v) => v)) {
        if (this.paraInfo.reinforcementsArrivedSpeechNotification) {
          this.playSpeechNotification(self, this.paraInfo.reinforcementsArrivedSpeechNotification)
        }
        if (this.paraInfo.reinforcementsArrivedTextNotification) {
          this.addTextNotification(self, this.paraInfo.reinforcementsArrivedTextNotification)
        }
      }

      aircraftInRange.set(a, true)
    }

    // Callback: OnExitRange
    const onExitRange = (a: IGameActor): void => {
      aircraftInRange.set(a, false)

      // Remove camera when final plane leaves
      if (!Array.from(aircraftInRange.values()).some((v) => v)) {
        this._removeCamera(camera)
        camera = null
      }
    }

    // Callback: OnRemovedFromWorld
    const onRemovedFromWorld = (a: IGameActor): void => {
      aircraftInRange.set(a, false)

      if (Array.from(aircraftInRange.keys()).every((k) => !k.isInWorld)) {
        this._removeCamera(camera)
        this._removeBeacon(self, beacon)
        camera = null
        beacon = null
      }
    }

    // Create aircraft immediately
    for (let i = -Math.floor(squadSize / 2); i <= Math.floor(squadSize / 2); i++) {
      if (i === 0 && (squadSize & 1) === 0) continue

      const spawnOffset = this._computeSpawnOffset(i, squadOff, facing)
      const pos: WorldPos = {
        X: startEdge.X + spawnOffset.X,
        Y: startEdge.Y + spawnOffset.Y,
        Z: startEdge.Z,
      }

      const a = this._createAircraft(self, unitType, pos, facing)
      aircraft.push(a)
      aircraftInRange.set(a, false)
    }

    // Create infantry units
    for (const dropType of dropItems) {
      const u = this._createUnit(self, dropType)
      units.push(u)
    }

    // Frame-end: add to world, distribute units, queue activities, create beacon
    this._queueParadropFrameEnd(
      self,
      aircraft,
      units,
      targetPos,
      startEdge,
      finishEdge,
      squadOff,
      facing,
      altitude,
      aircraftInRange,
      onEnterRange,
      onExitRange,
      onRemovedFromWorld,
      (b) => { beacon = b },
    )

    return { aircraft, units }
  }

  // -----------------------------------------------------------------------
  // Camera / Beacon helpers
  // -----------------------------------------------------------------------

  /**
   * Queue removal of a camera actor after CameraRemoveDelay ticks.
   *
   * OpenRA 对照: ParatroopersPower.RemoveCamera(Actor)
   */
  protected _removeCamera(_camera: IGameActor | null): void {
    if (!_camera) return
    // NOTE: camera.QueueActivity(new Wait(info.CameraRemoveDelay));
    //        camera.QueueActivity(new RemoveSelf());
  }

  /**
   * Queue removal of a beacon via frame-end task.
   */
  protected _removeBeacon(_self: IGameActor, _beacon: unknown): void {
    if (!_beacon) return
    // NOTE: Self.World.AddFrameEndTask(w => w.Remove(beacon));
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Resolve the approach facing.
   */
  protected _resolveFacing(self: IGameActor, providedFacing: number | null): number {
    if (providedFacing !== null) return providedFacing

    const quantized = this.paraInfo.quantizedFacings ?? PARATROOPERS_POWER_DEFAULTS.quantizedFacings
    const randomIndex = (self.actorId * 127 + 42) % quantized
    return Math.floor(1024 * randomIndex / quantized)
  }

  /**
   * Get cruise altitude for the aircraft type.
   */
  protected _getCruiseAltitude(_self: IGameActor, _unitType: string): number {
    // NOTE: map.Rules.Actors[unitType].TraitInfo<AircraftInfo>().CruiseAltitude.Length
    return 2048
  }

  /**
   * Compute approach delta vector from facing.
   */
  protected _computeDelta(_facing: number): WorldPos {
    return { X: 0, Y: -1024, Z: 0 }
  }

  /**
   * Compute an edge position relative to target.
   */
  protected _computeEdge(
    target: WorldPos,
    delta: WorldPos,
    sign: number,
    _self: IGameActor,
  ): WorldPos {
    const distance = 10240 + (this.paraInfo.cordon ?? PARATROOPERS_POWER_DEFAULTS.cordon)
    const divisor = Math.sqrt(delta.X * delta.X + delta.Y * delta.Y) || 1024
    return {
      X: target.X + sign * distance * delta.X / divisor,
      Y: target.Y + sign * distance * delta.Y / divisor,
      Z: target.Z,
    }
  }

  /**
   * Compute the spawn offset for aircraft i.
   */
  protected _computeSpawnOffset(
    i: number,
    so: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
  ): WorldPos {
    return {
      X: i * so.Y,
      Y: -Math.abs(i) * so.X,
      Z: 0,
    }
  }

  /**
   * Create an aircraft actor.
   */
  protected _createAircraft(
    _self: IGameActor,
    _unitType: string,
    _pos: WorldPos,
    _facing: number,
  ): IGameActor {
    // TODO: Replace Math.random() with seeded RNG for multiplayer sync replay
    return {
      actorId: Math.floor(Math.random() * 100000) + 100000,
      isInWorld: true,
      disabled: false,
      disposed: false,
      isDead: false,
      owner: _self.owner,
      world: _self.world,
    } as unknown as IGameActor
  }

  /**
   * Create an infantry unit actor.
   */
  protected _createUnit(_self: IGameActor, _unitType: string): IGameActor {
    // TODO: Replace Math.random() with seeded RNG for multiplayer sync replay
    return {
      actorId: Math.floor(Math.random() * 100000) + 200000,
      isInWorld: true,
      disabled: false,
      disposed: false,
      isDead: false,
      owner: _self.owner,
      world: _self.world,
    } as unknown as IGameActor
  }

  /**
   * Spawn a camera actor.
   */
  protected _spawnCamera(_self: IGameActor, _targetPos: WorldPos): IGameActor | null {
    return null
  }

  /**
   * Get the ParaDrop trait from an aircraft.
   */
  protected _getParaDrop(_aircraft: IGameActor): IParaDrop | null {
    return null
  }

  /**
   * Get the Cargo trait from an aircraft.
   */
  protected _getCargo(_aircraft: IGameActor): ICargo | null {
    return null
  }

  /**
   * Queue frame-end tasks: add aircraft, distribute units, queue activities,
   * create beacon, dispose unused units.
   */
  protected _queueParadropFrameEnd(
    self: IGameActor,
    aircraft: IGameActor[],
    units: IGameActor[],
    _target: WorldPos,
    _startEdge: WorldPos,
    finishEdge: WorldPos,
    squadOff: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
    _altitude: number,
    _aircraftInRange: Map<IGameActor, boolean>,
    onEnterRange: (a: IGameActor) => void,
    onExitRange: (a: IGameActor) => void,
    onRemovedFromWorld: (a: IGameActor) => void,
    _beaconRef: (b: unknown) => void,
  ): void {
    this.playLaunchSounds()

    const dropItems = this.paraInfo.dropItems ?? []
    const squadSize = this.paraInfo.squadSize ?? PARATROOPERS_POWER_DEFAULTS.squadSize
    const allowImpassable = this.paraInfo.allowImpassableCells ?? PARATROOPERS_POWER_DEFAULTS.allowImpassableCells

    // Ceiling division: distribute units among planes
    const passengersPerPlane = Math.ceil(dropItems.length / squadSize)

    let added = 0
    let j = 0
    for (let i = -Math.floor(squadSize / 2); i <= Math.floor(squadSize / 2); i++) {
      if (i === 0 && (squadSize & 1) === 0) continue

      const targetOffset: WorldPos = {
        X: i * squadOff.Y,
        Y: 0,
        Z: 0,
      }
      const a = aircraft[j++]

      // Add to world
      this._addAircraftToWorld(self, a)

      // Configure ParaDrop
      const drop = this._getParaDrop(a)
      if (drop) {
        const cell = this._cellContaining({ X: _target.X + targetOffset.X, Y: _target.Y + targetOffset.Y, Z: _target.Z })
        drop.setLZ(cell, !allowImpassable)
        drop.onEnteredDropRange = onEnterRange
        drop.onExitedDropRange = onExitRange
        drop.onRemovedFromWorld = onRemovedFromWorld
      }

      // Load passengers
      const cargo = this._getCargo(a)
      if (cargo) {
        const numToLoad = Math.min(passengersPerPlane, units.length - added)
        for (let k = added; k < added + numToLoad; k++) {
          cargo.load(a, units[k])
        }
        added += numToLoad
      }

      // Queue activities
      this._queueAircraftActivities(a, _startEdge, finishEdge)
    }

    // Dispose unused units
    for (let i = added; i < units.length; i++) {
      this._disposeUnit(units[i])
    }

    // Beacon (stubbed)
    if (this.info.displayBeacon) {
      // NOTE: beacon = new Beacon(...)
    }
  }

  /**
   * Add an aircraft to the game world.
   */
  protected _addAircraftToWorld(_self: IGameActor, _aircraft: IGameActor): void {
    // NOTE: w.Add(a) — World integration deferred.
  }

  /**
   * Queue Fly activities for an aircraft.
   */
  protected _queueAircraftActivities(
    _aircraft: IGameActor,
    _startEdge: WorldPos,
    _finishEdge: WorldPos,
  ): void {
    // NOTE: a.QueueActivity(new Fly(a, ...)) — Activity integration deferred.
  }

  /**
   * Convert a world position to a cell position.
   */
  protected _cellContaining(
    _position: { readonly X: number; readonly Y: number; readonly Z: number },
  ): { readonly X: number; readonly Y: number } {
    return { X: 512, Y: 512 }
  }

  /**
   * Dispose a unit that was not loaded onto any aircraft.
   */
  protected _disposeUnit(_unit: IGameActor): void {
    // NOTE: unit.Dispose() — World integration deferred.
  }
}
