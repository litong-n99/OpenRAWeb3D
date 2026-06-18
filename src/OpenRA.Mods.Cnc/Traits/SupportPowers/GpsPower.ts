/**
 * GpsPower.ts — GPS 卫星支援能力（全局地图揭示超武）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/SupportPowers/GpsPower.cs (123 lines)
 *
 * 核心范式转换:
 * - C# SupportPowerInfo (class) → TS SupportPowerInfo (interface) — GpsPowerInfo
 *   implements the interface rather than extending a class
 * - C# SupportPower (base class) → TS SupportPower extends ConditionalTrait
 * - C# INotifyKilled / INotifySold / INotifyOwnerChanged → TS same interfaces
 * - C# GpsWatcher.GpsAdd/GpsRemove → TS GpsWatcher methods
 * - C# SatelliteLaunch (World effect) → TS forward stub
 * - C# ProvidesRadar trait check → TS stub ()
 *
 * NOTE: SatelliteLaunch visual effect and GpsSatellite are deferred to
 * (Phase C). ProvidesRadar trait is not yet migrated.
 */

import type {
  IGameActor,
  ITick,
  ITraitInfo,
  ConditionalTraitInfo,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  SupportPower,
  type SupportPowerInfo,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type {
  ISupportPowerManager,
  OrderStub,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import { GpsWatcher } from '../GpsWatcher.js'

// ---------------------------------------------------------------------------
// Forward stubs
// ---------------------------------------------------------------------------

interface INotifyKilledStub {
  killed(self: IGameActor, e: AttackInfoStub): void
}

interface AttackInfoStub {
  readonly attacker?: IGameActor | null
  readonly damage?: unknown
}

interface INotifySoldStub {
  selling(self: IGameActor): void
  sold(self: IGameActor): void
}

interface INotifyOwnerChangedStub {
  onOwnerChanged(self: IGameActor, oldOwner: PlayerStub, newOwner: PlayerStub): void
}

// ---------------------------------------------------------------------------
// GpsPowerInfo
// OpenRA 对照: GpsPowerInfo : SupportPowerInfo
//
// NOTE: In TS, SupportPowerInfo is an interface (export interface SupportPowerInfo
// extends ConditionalTraitInfo). GpsPowerInfo implements it directly since
// interfaces cannot be extended as classes.
// ---------------------------------------------------------------------------

/**
 * Configuration for the GPS satellite support power.
 *
 * OpenRA 对照: GpsPowerInfo
 *
 * Requires GpsWatcher on the player actor.
 */
export class GpsPowerInfo implements SupportPowerInfo, ConditionalTraitInfo, ITraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  // --- SupportPowerInfo fields ---
  readonly chargeInterval: number
  readonly iconImage?: string
  readonly icon?: string | null
  readonly iconPalette?: string
  readonly name?: string | null
  readonly description?: string | null
  readonly allowMultiple: boolean
  readonly beginChargeSound?: string | null
  readonly beginChargeSpeechNotification?: string | null
  readonly beginChargeTextNotification?: string | null
  readonly endChargeSound?: string | null
  readonly endChargeSpeechNotification?: string | null
  readonly endChargeTextNotification?: string | null
  readonly selectTargetSound?: string | null
  readonly selectTargetSpeechNotification?: string | null
  readonly selectTargetTextNotification?: string | null
  readonly insufficientPowerSound?: string | null
  readonly insufficientPowerSpeechNotification?: string | null
  readonly insufficientPowerTextNotification?: string | null
  readonly launchSound?: string | null
  readonly launchSpeechNotification?: string | null
  readonly launchTextNotification?: string | null
  readonly incomingSound?: string | null
  readonly incomingSpeechNotification?: string | null
  readonly incomingTextNotification?: string | null
  readonly displayBeacon?: boolean
  readonly beaconPaletteIsPlayerPalette?: boolean
  readonly beaconPalette?: string
  readonly beaconImage?: string
  readonly beaconPoster?: string | null
  readonly beaconPosterPalette?: string
  readonly clockSequence?: string | null
  readonly beaconSequence?: string | null
  readonly arrowSequence?: string | null
  readonly circleSequence?: string | null
  readonly beaconDelay?: number
  readonly displayRadarPing?: boolean
  readonly radarPingDuration?: number
  readonly orderName: string
  readonly cursor?: string
  readonly sequence?: string | null
  readonly palette?: string
  readonly paletteOrder?: number

  // --- GpsPower-specific fields ---
  readonly revealDelay: number
  readonly doorImage: string
  readonly doorSequence: string
  readonly doorPalette: string
  readonly doorPaletteIsPlayerPalette: boolean
  readonly satelliteImage: string
  readonly satelliteSequence: string
  readonly satellitePalette: string
  readonly satellitePaletteIsPlayerPalette: boolean
  readonly requiresActiveRadar: boolean

  constructor(params?: {
    instanceName?: string
    requiresCondition?: string
    orderName?: string
    chargeInterval?: number
    revealDelay?: number
    doorImage?: string
    doorSequence?: string
    doorPalette?: string
    doorPaletteIsPlayerPalette?: boolean
    satelliteImage?: string
    satelliteSequence?: string
    satellitePalette?: string
    satellitePaletteIsPlayerPalette?: boolean
    requiresActiveRadar?: boolean
  }) {
    this.instanceName = params?.instanceName
    this.requiresCondition = params?.requiresCondition
    this.orderName = params?.orderName ?? 'GpsPower'
    this.chargeInterval = params?.chargeInterval ?? 4500
    this.revealDelay = params?.revealDelay ?? 0
    this.doorImage = params?.doorImage ?? 'atek'
    this.doorSequence = params?.doorSequence ?? 'active'
    this.doorPalette = params?.doorPalette ?? 'player'
    this.doorPaletteIsPlayerPalette = params?.doorPaletteIsPlayerPalette ?? true
    this.satelliteImage = params?.satelliteImage ?? 'sputnik'
    this.satelliteSequence = params?.satelliteSequence ?? 'idle'
    this.satellitePalette = params?.satellitePalette ?? 'player'
    this.satellitePaletteIsPlayerPalette = params?.satellitePaletteIsPlayerPalette ?? true
    this.requiresActiveRadar = params?.requiresActiveRadar ?? true
    this.allowMultiple = false
  }

  create(init: IGameActor): GpsPower {
    return new GpsPower(init, this)
  }
}

// ---------------------------------------------------------------------------
// GpsPower
// OpenRA 对照: GpsPower : SupportPower, INotifyKilled, INotifySold,
//   INotifyOwnerChanged, ITick
// ---------------------------------------------------------------------------

/**
 * GPS satellite support power — reveals the entire map.
 *
 * OpenRA 对照: GpsPower
 */
export class GpsPower
  extends SupportPower
  implements INotifyKilledStub, INotifySoldStub, INotifyOwnerChangedStub, ITick
{
  readonly self: IGameActor
  private _gpsOwner: GpsWatcher | null = null
  private _wasPaused: boolean = false

  constructor(self: IGameActor, info: GpsPowerInfo) {
    super(self, info)
    this.self = self

    // OpenRA: owner = self.Owner.PlayerActor.Trait<GpsWatcher>(); owner.GpsAdd(self);
    // Resolve GpsWatcher from the player actor and register GPS on construction
    const selfAny = self as unknown as Record<string, unknown>
    const owner = selfAny['owner'] as PlayerStub | undefined
    if (owner) {
      const ownerAny = owner as unknown as Record<string, unknown>
      const playerActor = ownerAny['playerActor'] as IGameActor | undefined
      if (playerActor) {
        const playerActorAny = playerActor as unknown as Record<string, unknown>
        const gw = playerActorAny['gpsWatcher'] as GpsWatcher | undefined
        if (gw) {
          this._gpsOwner = gw
          gw.gpsAdd(this.self)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // SupportPower overrides
  // -----------------------------------------------------------------------

  charged(self: IGameActor, key: string): void {
    super.charged(self, key)
    // OpenRA: self.Owner.PlayerActor.Trait<SupportPowerManager>().Powers[key].Activate(new Order())
    // Auto-activate GPS when fully charged. In TS, the SupportPowerManager
    // activation pathway is deferred, but we ensure GPS is registered.
    if (this._gpsOwner) {
      this._gpsOwner.gpsAdd(self)
    }
  }

  activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)
    // SatelliteLaunch effect integration
  }

  // -----------------------------------------------------------------------
  // INotifyKilled
  // -----------------------------------------------------------------------

  killed(_self: IGameActor, _e: AttackInfoStub): void {
    this._removeGps()
  }

  // -----------------------------------------------------------------------
  // INotifySold
  // -----------------------------------------------------------------------

  selling(_self: IGameActor): void { /* no-op */ }

  sold(_self: IGameActor): void {
    this._removeGps()
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged
  // -----------------------------------------------------------------------

  onOwnerChanged(
    _self: IGameActor,
    _oldOwner: PlayerStub,
    newOwner: PlayerStub,
  ): void {
    this._removeGps()
    const newOwnerAny = newOwner as unknown as Record<string, unknown>
    const playerActor = newOwnerAny['playerActor'] as IGameActor | undefined
    if (playerActor) {
      const gw = (playerActor as unknown as Record<string, unknown>)['gpsWatcher'] as GpsWatcher | undefined
      if (gw) {
        this._gpsOwner = gw
        gw.gpsAdd(this.self)
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  tick(_self: IGameActor): void {
    // OpenRA: bool NoActiveRadar { get { return !self.World.ActorsHavingTrait<ProvidesRadar>(...).Any(...) } }
    const requiresRadar = (this.info as unknown as GpsPowerInfo).requiresActiveRadar
    const noActiveRadar = requiresRadar && !this._hasActiveRadar()

    const isPaused = (this as unknown as Record<string, unknown>)['isTraitPaused'] as boolean | undefined
    const paused = isPaused === true

    // OpenRA: if (!wasPaused && (IsTraitPaused || (info.RequiresActiveRadar && NoActiveRadar)))
    if (!this._wasPaused && (paused || noActiveRadar)) {
      this._wasPaused = true
      this._removeGps()
    } else if (this._wasPaused && !paused && !noActiveRadar) {
      // OpenRA: else if (wasPaused && !IsTraitPaused && !(info.RequiresActiveRadar && NoActiveRadar))
      this._wasPaused = false
      if (this._gpsOwner) {
        this._gpsOwner.gpsAdd(this.self)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _removeGps(): void {
    if (this._gpsOwner) {
      this._gpsOwner.gpsRemove(this.self)
    }
  }

  private _hasActiveRadar(): boolean {
    // ProvidesRadar trait integration
    return true
  }

  // -----------------------------------------------------------------------
  // Test helpers
  // -----------------------------------------------------------------------

  setGpsOwner(watcher: GpsWatcher): void {
    this._removeGps()
    this._gpsOwner = watcher
    watcher.gpsAdd(this.self)
  }

  get gpsOwner(): GpsWatcher | null {
    return this._gpsOwner
  }

  setWasPaused(value: boolean): void {
    this._wasPaused = value
  }

  get wasPaused(): boolean {
    return this._wasPaused
  }
}
