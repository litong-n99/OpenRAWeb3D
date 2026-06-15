/**
 * AirstrikePower.ts — 空袭支援能力（飞机编队轰炸）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/AirstrikePower.cs (227 lines)
 *
 * 核心范式转换:
 * - C# DirectionalSupportPower extends SupportPower → TS extends DirectionalSupportPower
 * - C# WAngle/WRot/WVec position math → TS 同接口（映射自 OpenRA 数值）
 * - C# Fly activity queuing → TS Activity 桩（导入 Ch9）
 * - C# AttackBomber.SetTarget + range callbacks → TS AttackBomber 桩
 * - C# Beacon effect (sprite-based clock) → TS Beacon 桩
 * - C# camera actor spawn at attack range → TS camera 桩
 * - C# self.World.AddFrameEndTask(w => ...) → TS frameEndActions 回调
 * - C# self.World.CreateActor(false, unitType, inits) → TS World 桩
 * - C# world.Map.Rules.Actors[unitType].TraitInfo<AircraftInfo>().CruiseAltitude → TS 桩
 * - C# world.Map.DistanceToEdge(target, delta) → TS 距离计算桩
 * - C# Even-sized squads skip lead plane (i == 0 && (squadSize & 1) == 0) → TS 同逻辑
 * - C# Game.Sound.PlayNotification → TS 音频桩 (Ch7 Phase D)
 *
 * AirstrikePower sends a formation of aircraft from a random map edge toward
 * the target. Aircraft drop bombs via AttackBomber when in range, then fly
 * to the opposite edge. A Beacon with clock animation tracks progress, and
 * an optional camera actor provides vision during the attack.
 */

import {
  DirectionalSupportPower,
  type DirectionalSupportPowerInfo,
} from './DirectionalSupportPower.js'
import type { ISupportPowerManager, OrderStub } from './SupportPower.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Forward stubs for Ch9 types (Aircraft, AttackBomber, Fly)
// ---------------------------------------------------------------------------

/** Forward reference to AttackBomber trait from Ch9. */
export interface IAttackBomber {
  /** Set the bomb target position.
   *
   * OpenRA 对照: AttackBomber.SetTarget(WPos)
   */
  setTarget(target: { readonly X: number; readonly Y: number; readonly Z: number }): void

  /** Callback when aircraft enters attack range of its target. */
  onEnteredAttackRange?: ((actor: IGameActor) => void) | null

  /** Callback when aircraft exits attack range of its target. */
  onExitedAttackRange?: ((actor: IGameActor) => void) | null

  /** Callback when aircraft is removed from the world. */
  onRemovedFromWorld?: ((actor: IGameActor) => void) | null
}

// ---------------------------------------------------------------------------
// WPos-like position interface
// ---------------------------------------------------------------------------

/** 3D world position (WPos equivalent). */
export interface WorldPos {
  readonly X: number
  readonly Y: number
  readonly Z: number
}

/** 2D cell position (CPos equivalent — simpler than the full CPos class). */
export interface CellPos {
  readonly X: number
  readonly Y: number
}

// ---------------------------------------------------------------------------
// Aircraft tracking state
// ---------------------------------------------------------------------------

/** Per-aircraft tracking state.
 *
 * OpenRA 对照: aircraftInRange Dictionary<Actor, bool> + closure state
 */
export interface AircraftState {
  /** The aircraft actor. */
  aircraft: IGameActor
  /** Whether this aircraft is currently in attack range. */
  inRange: boolean
}

// ---------------------------------------------------------------------------
// AirstrikePowerInfo
// OpenRA 对照: AirstrikePowerInfo : DirectionalSupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for AirstrikePower.
 *
 * OpenRA 对照: AirstrikePowerInfo
 *
 * Defines the aircraft type, formation parameters, targeting mechanics,
 * camera actor, and beacon configuration.
 */
export interface AirstrikePowerInfo extends DirectionalSupportPowerInfo {
  /** Aircraft used to deliver the airstrike (default "badr.bomber").
   *
   * OpenRA 对照: AirstrikePowerInfo.UnitType
   */
  readonly unitType?: string

  /** Number of aircraft to use in a formation (default 1).
   *
   * OpenRA 对照: AirstrikePowerInfo.SquadSize
   */
  readonly squadSize?: number

  /** Offset vector between aircraft in a formation.
   *
   * OpenRA 对照: AirstrikePowerInfo.SquadOffset (default (-1536, 1536, 0))
   */
  readonly squadOffset?: { readonly X: number; readonly Y: number; readonly Z: number }

  /** Number of possible facings for approach direction (default 32).
   *
   * OpenRA 对照: AirstrikePowerInfo.QuantizedFacings
   */
  readonly quantizedFacings?: number

  /** Additional distance beyond map edge to spawn/despawn (default WDist(5120)).
   *
   * OpenRA 对照: AirstrikePowerInfo.Cordon (WDist)
   */
  readonly cordon?: number

  /** Actor type to spawn when aircraft enter attack range (optional).
   *
   * OpenRA 对照: AirstrikePowerInfo.CameraActor
   */
  readonly cameraActor?: string | null

  /** Ticks to keep camera alive after aircraft leave range (default 25).
   *
   * OpenRA 对照: AirstrikePowerInfo.CameraRemoveDelay
   */
  readonly cameraRemoveDelay?: number

  /** Weapon range offset for beacon clock calculation (default WDist.FromCells(6)).
   *
   * OpenRA 对照: AirstrikePowerInfo.BeaconDistanceOffset
   */
  readonly beaconDistanceOffset?: number
}

/** Default values for AirstrikePowerInfo. */
export const AIRSTRIKE_POWER_DEFAULTS = {
  unitType: 'badr.bomber',
  squadSize: 1,
  squadOffset: { X: Math.floor(-1536), Y: 1536, Z: 0 },
  quantizedFacings: 32,
  cordon: 5120,
  cameraRemoveDelay: 25,
  beaconDistanceOffset: 6 * 1024, // WDist.FromCells(6).Length
} as const

// ---------------------------------------------------------------------------
// AirstrikePower
// OpenRA 对照: AirstrikePower : DirectionalSupportPower
// ---------------------------------------------------------------------------

/**
 * Support power that spawns a formation of aircraft to deliver an airstrike.
 *
 * OpenRA 对照: AirstrikePower
 *
 * Aircraft are spawned at a random map edge, fly toward the target, drop bombs
 * via AttackBomber, then exit at the opposite edge. A Beacon clock tracks
 * remaining flight time. An optional camera actor provides vision during the
 * attack run.
 *
 * Even-sized squads skip the lead plane (i == 0) to maintain symmetric
 * formation balance — only odd SquadSize has a center aircraft.
 */
export class AirstrikePower extends DirectionalSupportPower {
  /** Typed info reference.
   *
   * OpenRA 对照: AirstrikePower.info
   */
  get airstrikeInfo(): AirstrikePowerInfo {
    return this.info as AirstrikePowerInfo
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the airstrike power.
   *
   * OpenRA 对照: AirstrikePower.Activate(Actor, Order, SupportPowerManager)
   *
   * Extracts facing from order ExtraData (if UseDirectionalTarget) or uses
   * a random facing. Delegates to SendAirstrike().
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)

    // Extract facing from order or use random
    const useDirectional = this.dirInfo.useDirectionalTarget ?? false
    const hasExtraData = order.extraData !== undefined && order.extraData !== 0xffffffff
    const facing = useDirectional && hasExtraData
      ? order.extraData as number
      : null

    const target = order.target?.centerPosition
    if (!target) return

    this.sendAirstrike(self, target, facing)
  }

  // -----------------------------------------------------------------------
  // SendAirstrike — main formation logic
  // -----------------------------------------------------------------------

  /**
   * Send a formation of aircraft to deliver an airstrike.
   *
   * OpenRA 对照: AirstrikePower.SendAirstrike(Actor, WPos, WAngle?)
   *
   * Computes edge-to-edge flight path, creates aircraft at start edge,
   * configures AttackBomber targets, subscribes to range callbacks,
   * and queues Fly activities. Returns the created aircraft array.
   *
   * @param self — the actor holding this power
   * @param targetPos — the target position
   * @param _facingFacing — the approach facing (WAngle.Facing value), or null for random
   * @returns array of created aircraft actors
   */
  sendAirstrike(
    self: IGameActor,
    targetPos: WorldPos,
    _facingFacing: number | null,
  ): IGameActor[] {
    const squadSize = this.airstrikeInfo.squadSize ?? AIRSTRIKE_POWER_DEFAULTS.squadSize
    const unitType = this.airstrikeInfo.unitType ?? AIRSTRIKE_POWER_DEFAULTS.unitType
    const squadOff = this.airstrikeInfo.squadOffset ?? AIRSTRIKE_POWER_DEFAULTS.squadOffset

    // Compute a random or specified facing
    const facing = this._resolveFacing(self, _facingFacing)

    // Compute positions using facing
    const altitude = this._getCruiseAltitude(self, unitType)
    const delta = this._computeDelta(facing)
    const target3d: WorldPos = {
      X: targetPos.X,
      Y: targetPos.Y,
      Z: targetPos.Z + altitude,
    }

    const startEdge = this._computeEdge(target3d, delta, -1, self)
    const finishEdge = this._computeEdge(target3d, delta, 1, self)

    // Aircraft tracking state
    const aircraftStates: AircraftState[] = []
    const aircraftList: IGameActor[] = []

    // Camera and beacon references
    let camera: IGameActor | null = null
    let beacon: unknown = null

    // Callback: OnEnterRange
    const onEnterRange = (a: IGameActor): void => {
      // Spawn camera when first plane enters target area
      if (
        this.airstrikeInfo.cameraActor &&
        camera === null &&
        !aircraftStates.some((s) => s.inRange)
      ) {
        camera = this._spawnCamera(self, targetPos)
      }

      this._removeBeacon(self, beacon)
      beacon = null

      // Update state
      const st = aircraftStates.find((s) => s.aircraft === a)
      if (st) st.inRange = true
    }

    // Callback: OnExitRange
    const onExitRange = (a: IGameActor): void => {
      const st = aircraftStates.find((s) => s.aircraft === a)
      if (st) st.inRange = false

      // Remove camera when all aircraft have left range
      if (!aircraftStates.some((s) => s.inRange)) {
        this._removeCamera(camera)
        camera = null
      }
    }

    // Callback: OnRemovedFromWorld
    const onRemovedFromWorld = (a: IGameActor): void => {
      const st = aircraftStates.find((s) => s.aircraft === a)
      if (st) st.inRange = false

      // Clean up if all aircraft are destroyed/removed
      if (aircraftStates.every((s) => !s.aircraft.isInWorld)) {
        this._removeCamera(camera)
        this._removeBeacon(self, beacon)
        camera = null
        beacon = null
      }
    }

    // Create aircraft immediately
    for (let i = -Math.floor(squadSize / 2); i <= Math.floor(squadSize / 2); i++) {
      // Even-sized squads skip the lead plane
      if (i === 0 && (squadSize & 1) === 0) continue

      const spawnOffset = this._computeSpawnOffset(i, squadOff, facing)
      const targetOffset = this._computeTargetOffset(i, squadOff, facing)

      const pos: WorldPos = {
        X: startEdge.X + spawnOffset.X,
        Y: startEdge.Y + spawnOffset.Y,
        Z: startEdge.Z,
      }

      const a = this._createAircraft(self, unitType, pos, facing, targetOffset)
      aircraftList.push(a)
      aircraftStates.push({ aircraft: a, inRange: false })

      // Configure AttackBomber
      const attack = this._getAttackBomber(a)
      if (attack) {
        attack.setTarget({
          X: targetPos.X + targetOffset.X,
          Y: targetPos.Y + targetOffset.Y,
          Z: targetPos.Z,
        })
        attack.onEnteredAttackRange = onEnterRange
        attack.onExitedAttackRange = onExitRange
        attack.onRemovedFromWorld = onRemovedFromWorld
      }
    }

    // Frame-end: add to world, queue activities, create beacon
    this._queueAirstrikeFrameEnd(
      self,
      aircraftList,
      targetPos,
      startEdge,
      finishEdge,
      target3d,
      squadOff,
      facing,
      altitude,
      aircraftStates,
      (b) => { beacon = b },
    )

    return aircraftList
  }

  // -----------------------------------------------------------------------
  // Camera / Beacon helpers
  // -----------------------------------------------------------------------

  /**
   * Queue removal of a camera actor after CameraRemoveDelay ticks.
   *
   * OpenRA 对照: AirstrikePower.RemoveCamera(Actor)
   *
   * Queues Wait(CameraRemoveDelay) + RemoveSelf() on the camera actor.
   */
  protected _removeCamera(_camera: IGameActor | null): void {
    if (!_camera) return
    // NOTE: In OpenRA:
    //   camera.QueueActivity(new Wait(info.CameraRemoveDelay));
    //   camera.QueueActivity(new RemoveSelf());
    // Activity queuing requires full Activity system integration.
  }

  /**
   * Queue removal of a beacon via frame-end task.
   *
   * OpenRA 对照: AirstrikePower.RemoveBeacon(Beacon)
   */
  protected _removeBeacon(_self: IGameActor, _beacon: unknown): void {
    if (!_beacon) return
    // NOTE: In OpenRA:
    //   Self.World.AddFrameEndTask(w => w.Remove(beacon));
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Resolve the approach facing.
   * If facing is provided, use it. Otherwise pick random from QuantizedFacings.
   */
  protected _resolveFacing(self: IGameActor, providedFacing: number | null): number {
    if (providedFacing !== null) return providedFacing

    const quantized = this.airstrikeInfo.quantizedFacings ?? AIRSTRIKE_POWER_DEFAULTS.quantizedFacings
    // NOTE: In OpenRA: 1024 * self.World.SharedRandom.Next(quantized) / quantized
    // Random must be deterministic for multiplayer. Stubbed with simple hash.
    const randomIndex = (self.actorId * 127 + 42) % quantized
    return Math.floor(1024 * randomIndex / quantized)
  }

  /**
   * Get the cruise altitude for a given unit type.
   */
  protected _getCruiseAltitude(_self: IGameActor, _unitType: string): number {
    // NOTE: self.World.Map.Rules.Actors[unitType].TraitInfo<AircraftInfo>().CruiseAltitude.Length
    // Stubbed — default altitude of 2048 (2 cells).
    return 2048
  }

  /**
   * Compute the approach delta vector from facing.
   * delta = WVec(0, -1024, 0).Rotate(WRot.FromYaw(facing))
   */
  protected _computeDelta(_facing: number): WorldPos {
    // NOTE: WVec(0, -1024, 0).Rotate(WRot.FromYaw(facing))
    // This rotates the vector CW by the facing angle.
    // For 0 facing (North): delta = (0, -1024, 0)
    // For 256 facing (East):  delta = (1024, 0, 0)
    // Stubbed — returns (0, -1024, 0) for simplicity.
    return { X: 0, Y: -1024, Z: 0 }
  }

  /**
   * Compute an edge position relative to target.
   * startEdge = target - distance * delta / 1024
   * finishEdge = target + distance * delta / 1024
   */
  protected _computeEdge(
    target: WorldPos,
    delta: WorldPos,
    sign: number,
    _self: IGameActor,
  ): WorldPos {
    // NOTE: self.World.Map.DistanceToEdge(target, delta) + cordon
    // DistanceToEdge is a complex map operation.
    // Stubbed with a constant offset.
    const distance = 10240 + (this.airstrikeInfo.cordon ?? AIRSTRIKE_POWER_DEFAULTS.cordon)
    const length = Math.sqrt(delta.X * delta.X + delta.Y * delta.Y)
    const divisor = length || 1024
    return {
      X: target.X + sign * distance * delta.X / divisor,
      Y: target.Y + sign * distance * delta.Y / divisor,
      Z: target.Z,
    }
  }

  /**
   * Compute the spawn offset for aircraft i in the formation.
   * spawnOffset = WVec(i * so.Y, -|i| * so.X, 0).Rotate(attackRotation)
   */
  protected _computeSpawnOffset(
    i: number,
    so: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
  ): WorldPos {
    // 90 degree rotation between body and world coordinates:
    // WVec(i * so.Y, -Math.abs(i) * so.X, 0).Rotate(attackRotation)
    return {
      X: i * so.Y,
      Y: -Math.abs(i) * so.X,
      Z: 0,
    }
  }

  /**
   * Compute the target offset for aircraft i.
   * targetOffset = WVec(i * so.Y, 0, 0).Rotate(attackRotation)
   */
  protected _computeTargetOffset(
    i: number,
    so: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
  ): WorldPos {
    return {
      X: i * so.Y,
      Y: 0,
      Z: 0,
    }
  }

  /**
   * Create an aircraft actor at the given position.
   */
  protected _createAircraft(
    _self: IGameActor,
    _unitType: string,
    _pos: WorldPos,
    _facing: number,
    _targetOffset: WorldPos,
  ): IGameActor {
    // NOTE: self.World.CreateActor(false, unitType, [CenterPositionInit(pos), OwnerInit, FacingInit])
    // Actor creation requires full world integration.
    // Returns a stub actor for testing.
    // TODO: Replace Math.random() with seeded RNG for multiplayer sync replay
    return {
      actorId: Math.floor(Math.random() * 100000),
      isInWorld: true,
      disabled: false,
      disposed: false,
      isDead: false,
      owner: _self.owner,
      world: _self.world,
    } as unknown as IGameActor
  }

  /**
   * Get the AttackBomber trait from an aircraft actor.
   */
  protected _getAttackBomber(_aircraft: IGameActor): IAttackBomber | null {
    // NOTE: aircraft.Trait<AttackBomber>()
    // Stubbed — returns null for testing (overridden in test subclass).
    return null
  }

  /**
   * Spawn a camera actor at the target position.
   */
  protected _spawnCamera(_self: IGameActor, _targetPos: WorldPos): IGameActor | null {
    // NOTE: w.CreateActor(info.CameraActor, [LocationInit(cell), OwnerInit])
    // Stubbed.
    return null
  }

  /**
   * Queue frame-end tasks: add aircraft to world, queue Fly activities, create beacon.
   */
  protected _queueAirstrikeFrameEnd(
    self: IGameActor,
    aircraft: IGameActor[],
    _target: WorldPos,
    startEdge: WorldPos,
    finishEdge: WorldPos,
    _target3d: WorldPos,
    _squadOff: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
    _altitude: number,
    _aircraftStates: AircraftState[],
    _beaconRef: (b: unknown) => void,
  ): void {
    // NOTE: In OpenRA:
    //   self.World.AddFrameEndTask(w => {
    //     PlayLaunchSounds();
    //     for each aircraft:
    //       w.Add(a);
    //       a.QueueActivity(new Fly(a, Target.FromPos(target + spawnOffset)));
    //       a.QueueActivity(new Fly(a, Target.FromPos(finishEdge + spawnOffset)));
    //       a.QueueActivity(new RemoveSelf());
    //     if (DisplayBeacon):
    //       beacon = new Beacon(...);
    //       w.Add(beacon);
    //   });

    this.playLaunchSounds()

    // Log formation for testing
    for (const a of aircraft) {
      this._addAircraftToWorld(self, a)
      this._queueAircraftActivities(a, startEdge, finishEdge)
    }

    // Beacon creation (stubbed)
    if (this.info.displayBeacon) {
      // NOTE: beacon = new Beacon(owner, target, ..., clockFn, delay)
      // Beacon class not yet migrated. Stubbed.
    }
  }

  /**
   * Add an aircraft to the game world.
   */
  protected _addAircraftToWorld(_self: IGameActor, _aircraft: IGameActor): void {
    // NOTE: w.Add(a) — World integration deferred.
  }

  /**
   * Queue Fly activities for an aircraft (approach -> exit -> remove).
   */
  protected _queueAircraftActivities(
    _aircraft: IGameActor,
    _startEdge: WorldPos,
    _finishEdge: WorldPos,
  ): void {
    // NOTE: In OpenRA:
    //   a.QueueActivity(new Fly(a, Target.FromPos(target + spawnOffset)));
    //   a.QueueActivity(new Fly(a, Target.FromPos(finishEdge + spawnOffset)));
    //   a.QueueActivity(new RemoveSelf());
    // Activity queuing requires full Activity system integration.
  }
}
