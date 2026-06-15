/**
 * SupportPower.ts — 支援能力抽象基类 (超武/技能系统)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.cs (261 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<SupportPowerInfo> → TS ConditionalTrait<SupportPowerInfo>
 * - C# Game.Sound.Play/PayNotification → TS Sound/SoundDevice stub (Ch7 Phase D)
 * - C# TextNotificationsManager → TS text notification stub
 * - C# IEnumerable<CPos> yield return → TS CPos[]
 * - C# RadarPing (typed reference) → TS 桩 (RadarPings deferred to Ch16)
 * - C# World.OrderGenerator assignment → TS WorldInteractNotifier 委托
 * - C# TraitsImplementing<INotifySupportPower>() → TS 遍历组件数组
 *
 * NOTE: Audio calls are stubbed — full Sound integration requires Ch7 Phase D
 * runtime wiring. Subclasses should override playPowerSound() to provide real
 * audio playback.
 * NOTE: RadarPing and OrderGenerator visual feedback are deferred to Chapter 16.
 * NOTE: Fluent localization (Name, Description) uses raw string fallback.
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type INotifySupportPower,
  type IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { CVec } from '../../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// Forward stubs (types not yet fully migrated)
// ---------------------------------------------------------------------------

/** Forward reference to SupportPowerManager trait. */
export interface ISupportPowerManager {
  readonly self: IGameActor
  readonly powers: ReadonlyMap<string, ISupportPowerInstance>
  readonly devMode?: IDevMode
  readonly techTree?: unknown
}

/** Forward reference to SupportPowerInstance. */
export interface ISupportPowerInstance {
  readonly key: string
  readonly instances: ISupportPower[]
  readonly info: SupportPowerInfo
  readonly totalTicks: number
  readonly remainingTicks: number
  readonly active: boolean
  readonly ready: boolean
  readonly disabled: boolean
}

/** Forward reference to a SupportPower trait instance. */
export interface ISupportPower {
  readonly info: SupportPowerInfo
  readonly self: IGameActor
  readonly isTraitDisabled: boolean
  readonly isTraitPaused: boolean
  createInstance(key: string, manager: ISupportPowerManager): ISupportPowerInstance
}

/** Forward reference to DevMode. */
export interface IDevMode {
  fastCharge: boolean
  allTech: boolean
}

// ---------------------------------------------------------------------------
// SupportPowerInfo
// OpenRA 对照: SupportPowerInfo : PausableConditionalTraitInfo
// ---------------------------------------------------------------------------

export const DefaultSupportPowerPaletteOrder = 9999

// ---------------------------------------------------------------------------
// Audio category constants
// ---------------------------------------------------------------------------

/**
 * Audio notification categories for support power lifecycle events.
 *
 * OpenRA 对照: Notification categories set via Game.Sound.Play/Speech/TNotification
 */
export const SupportPowerAudioCategory = {
  beginCharge: 'beginCharge',
  endCharge: 'endCharge',
  selectTarget: 'selectTarget',
  insufficientPower: 'insufficientPower',
  launch: 'launch',
  incoming: 'incoming',
  detected: 'detected',
} as const

export type SupportPowerAudioCategory = (typeof SupportPowerAudioCategory)[keyof typeof SupportPowerAudioCategory]

/** Configuration for a support power.
 *
 * OpenRA 对照: SupportPowerInfo (14 regular + 32 sound/notification fields)
 *
 * Contains all configurable properties: charge timer, icon, prerequisites,
 * targeting cursor, audio notifications, beacon, and radar ping settings.
 */
export interface SupportPowerInfo extends ConditionalTraitInfo {
  /** Ticks between charges (0 = no auto-recharge).
   *
   * OpenRA 对照: SupportPowerInfo.ChargeInterval
   */
  readonly chargeInterval: number

  /** Icon sprite displayed in the support power palette.
   *
   * OpenRA 对照: SupportPowerInfo.IconImage / Icon / IconPalette
   */
  readonly iconImage?: string
  readonly icon?: string | null
  readonly iconPalette?: string

  /** Fluent localization references.
   *
   * OpenRA 对照: SupportPowerInfo.Name / Description
   */
  readonly name?: string | null
  readonly description?: string | null

  /** Allow multiple instances of the same support power.
   *
   * OpenRA 对照: SupportPowerInfo.AllowMultiple
   */
  readonly allowMultiple?: boolean

  /** Allow this to be used only once.
   *
   * OpenRA 对照: SupportPowerInfo.OneShot
   */
  readonly oneShot?: boolean

  /** Cursor to display for using this support power.
   *
   * OpenRA 对照: SupportPowerInfo.Cursor / BlockedCursor
   */
  readonly cursor?: string
  readonly blockedCursor?: string

  /** If set to true, the support power will be fully charged when available.
   *
   * OpenRA 对照: SupportPowerInfo.StartFullyCharged
   */
  readonly startFullyCharged?: boolean

  /** TechTree prerequisite names.
   *
   * OpenRA 对照: SupportPowerInfo.Prerequisites
   */
  readonly prerequisites?: readonly string[]

  /** Auto-generated order name: GetType().Name + "Order"
   *
   * OpenRA 对照: SupportPowerInfo.OrderName
   */
  readonly orderName: string

  /** Sort order for the support power palette.
   *
   * OpenRA 对照: SupportPowerInfo.SupportPowerPaletteOrder
   */
  readonly supportPowerPaletteOrder?: number

  // -----------------------------------------------------------------------
  // Audio notification fields (7 categories x 3 channels = 21 fields)
  // -----------------------------------------------------------------------

  /** Played when an enemy player detects this power.
   *
   * OpenRA 对照: DetectedSound / DetectedSpeechNotification / DetectedTextNotification
   */
  readonly detectedSound?: string | null
  readonly detectedSpeechNotification?: string | null
  readonly detectedTextNotification?: string | null

  /** Played when the charge cycle begins.
   *
   * OpenRA 对照: BeginChargeSound / BeginChargeSpeechNotification / BeginChargeTextNotification
   */
  readonly beginChargeSound?: string | null
  readonly beginChargeSpeechNotification?: string | null
  readonly beginChargeTextNotification?: string | null

  /** Played when the charge cycle completes.
   *
   * OpenRA 对照: EndChargeSound / EndChargeSpeechNotification / EndChargeTextNotification
   */
  readonly endChargeSound?: string | null
  readonly endChargeSpeechNotification?: string | null
  readonly endChargeTextNotification?: string | null

  /** Played when the player selects a target.
   *
   * OpenRA 对照: SelectTargetSound / SelectTargetSpeechNotification / SelectTargetTextNotification
   */
  readonly selectTargetSound?: string | null
  readonly selectTargetSpeechNotification?: string | null
  readonly selectTargetTextNotification?: string | null

  /** Played when the player cannot activate (no power/blocked).
   *
   * OpenRA 对照: InsufficientPowerSound / InsufficientPowerSpeechNotification / InsufficientPowerTextNotification
   */
  readonly insufficientPowerSound?: string | null
  readonly insufficientPowerSpeechNotification?: string | null
  readonly insufficientPowerTextNotification?: string | null

  /** Played to allies when launched.
   *
   * OpenRA 对照: LaunchSound / LaunchSpeechNotification / LaunchTextNotification
   */
  readonly launchSound?: string | null
  readonly launchSpeechNotification?: string | null
  readonly launchTextNotification?: string | null

  /** Played to enemies when launched.
   *
   * OpenRA 对照: IncomingSound / IncomingSpeechNotification / IncomingTextNotification
   */
  readonly incomingSound?: string | null
  readonly incomingSpeechNotification?: string | null
  readonly incomingTextNotification?: string | null

  // -----------------------------------------------------------------------
  // Timer display and beacon
  // -----------------------------------------------------------------------

  /** Whether to display a beacon at the target position.
   *
   * OpenRA 对照: SupportPowerInfo.DisplayBeacon
   */
  readonly displayBeacon?: boolean

  /** Beacon palette and image configuration.
   *
   * OpenRA 对照: BeaconPaletteIsPlayerPalette / BeaconPalette / BeaconImage / BeaconPoster / etc.
   */
  readonly beaconPaletteIsPlayerPalette?: boolean
  readonly beaconPalette?: string
  readonly beaconImage?: string
  readonly beaconPoster?: string | null
  readonly beaconPosterPalette?: string
  readonly clockSequence?: string | null
  readonly beaconSequence?: string | null
  readonly arrowSequence?: string | null
  readonly circleSequence?: string | null

  /** Delay after launch before beacon appears (ticks).
   *
   * OpenRA 对照: SupportPowerInfo.BeaconDelay
   */
  readonly beaconDelay?: number

  // -----------------------------------------------------------------------
  // Radar ping
  // -----------------------------------------------------------------------

  /** Whether to display a radar ping on activation.
   *
   * OpenRA 对照: DisplayRadarPing / RadarPingDuration
   */
  readonly displayRadarPing?: boolean
  readonly radarPingDuration?: number
}

// ---------------------------------------------------------------------------
// OrderStub — minimal Order interface for power activation
// ---------------------------------------------------------------------------

/**
 * Minimal Order interface used by SupportPower.Activate().
 *
 * OpenRA 对照: OpenRA.Game/Network/Order.cs (subset)
 *
 * Only the fields needed by support power activation are exposed.
 * Compatible with both the TraitsInterfaces OrderStub (which has `orderName`)
 * and the full Order class (which has `orderString`).
 */
export interface OrderStub {
  readonly orderName: string
  readonly targetString?: string | null
  readonly extraData?: number
  readonly subjectId?: number
  readonly target?: TargetStub | null
}

/** Minimal Target interface for SupportPower ordering. */
export interface TargetStub {
  readonly centerPosition?: { readonly X: number; readonly Y: number; readonly Z: number } | null
  readonly type?: number
  readonly cell?: CPos | null
}

// ---------------------------------------------------------------------------
// SupportPower — abstract base class for all support powers
// OpenRA 对照: SupportPower : PausableConditionalTrait<SupportPowerInfo>
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all support powers (superweapons, abilities).
 *
 * OpenRA 对照: SupportPower (abstract class, 73 lines of logic)
 *
 * Subclasses must override SelectTarget() and Activate() to provide
 * power-specific targeting and activation behaviour. CreateInstance()
 * may be overridden to provide custom SupportPowerInstance subclasses.
 */
export abstract class SupportPower
  extends ConditionalTrait<SupportPowerInfo>
{
  /** The actor holding this power.
   *
   * OpenRA 对照: SupportPower.Self
   */
  readonly self: IGameActor

  /** Active radar ping reference (null if no radar ping active).
   *
   * OpenRA 对照: SupportPower.ping (RadarPing?)
   */
  protected ping: unknown = null

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /** Static key generation: AllowMultiple ? orderName + "_" + actorID : orderName.
   *
   * OpenRA 对照: SupportPowerManager.MakeKey() (static)
   */
  static makeKey(info: SupportPowerInfo, actorId: number): string {
    return info.allowMultiple ? `${info.orderName}_${actorId}` : info.orderName
  }

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(self: IGameActor, info: SupportPowerInfo) {
    super(info)
    this.self = self
  }

  // -----------------------------------------------------------------------
  // Lifecycle — Created
  // -----------------------------------------------------------------------

  /**
   * Called after the actor has been fully created.
   *
   * OpenRA 对照: SupportPower.Created(Actor)
   *
   * Plays DetectedSound notification when an enemy player detects this power.
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    this.onCreated(actor)
  }

  /** Implementation of Created() logic, separated from attach() for testability.
   *
   * OpenRA 对照: SupportPower.Created(Actor)
   */
  protected onCreated(_self: IGameActor): void {
    // NOTE: OpenRA plays DetectedSound when localPlayer != owner.
    // This requires access to World.LocalPlayer and full Sound system.
    // Sound integration is deferred to Ch7 Phase D runtime wiring.
    // Subclasses may override to provide real audio playback.
  }

  // -----------------------------------------------------------------------
  // Factory — CreateInstance
  // -----------------------------------------------------------------------

  /**
   * Create a SupportPowerInstance for this power.
   *
   * OpenRA 对照: SupportPower.CreateInstance(string, SupportPowerManager)
   *
   * Virtual — subclasses may override to return custom SupportPowerInstance
   * subclasses (e.g., AirstrikePower overrides IconOverlayTextOverride).
   *
   * @param key — the unique power key
   * @param manager — the owning SupportPowerManager
   * @returns a new SupportPowerInstance
   */
  createInstance(key: string, manager: ISupportPowerManager): ISupportPowerInstance {
    return new SupportPowerInstanceImpl(key, this.info, manager)
  }

  // -----------------------------------------------------------------------
  // Charge lifecycle notifications
  // -----------------------------------------------------------------------

  /**
   * Called when the charge cycle begins.
   *
   * OpenRA 对照: SupportPower.Charging(Actor, string)
   *
   * Plays BeginChargeSound notification.
   *
   * @param self — the actor holding this power
   * @param _key — the power key (unused in base, used by subclasses)
   */
  charging(self: IGameActor, _key: string): void {
    // NOTE: Audio playback stubbed — see Ch7 Phase D Sound integration.
    if (this.info.beginChargeSound) {
      this.playPowerSound(self, 'beginCharge', this.info.beginChargeSound)
    }
    if (this.info.beginChargeSpeechNotification) {
      this.playSpeechNotification(self, this.info.beginChargeSpeechNotification)
    }
    if (this.info.beginChargeTextNotification) {
      this.addTextNotification(self, this.info.beginChargeTextNotification)
    }
  }

  /**
   * Called when the charge cycle completes (power becomes ready).
   *
   * OpenRA 对照: SupportPower.Charged(Actor, string)
   *
   * Plays EndChargeSound notification and notifies all INotifySupportPower
   * traits on the same actor.
   *
   * @param self — the actor holding this power
   * @param _key — the power key (unused in base, used by subclasses)
   */
  charged(self: IGameActor, _key: string): void {
    if (this.info.endChargeSound) {
      this.playPowerSound(self, 'endCharge', this.info.endChargeSound)
    }
    if (this.info.endChargeSpeechNotification) {
      this.playSpeechNotification(self, this.info.endChargeSpeechNotification)
    }
    if (this.info.endChargeTextNotification) {
      this.addTextNotification(self, this.info.endChargeTextNotification)
    }

    // Notify all INotifySupportPower traits on this actor
    this.notifySupportPowerCharged(self)
  }

  // -----------------------------------------------------------------------
  // Targeting
  // -----------------------------------------------------------------------

  /**
   * Enter targeting mode — sets the world's active OrderGenerator.
   *
   * OpenRA 对照: SupportPower.SelectTarget(Actor, string, SupportPowerManager)
   *
   * Creates a SelectGenericPowerTarget OrderGenerator. Subclasses may
   * override for power-specific targeting (directional, nuke circles, etc.).
   *
   * @param self — the actor holding this power
   * @param _order — the order string (power key)
   * @param _manager — the owning SupportPowerManager
   */
  selectTarget(
    self: IGameActor,
    _order: string,
    _manager: ISupportPowerManager,
  ): void {
    // NOTE: In OpenRA, this sets self.World.OrderGenerator.
    // In TypeScript, the OrderGenerator is managed by the
    // WorldInteractionControllerWidget. The power's targeting
    // mode is activated via the manager/world interaction bridge.
    // See SelectGenericPowerTarget implementation for details.
    this.setOrderGenerator(self, _order, _manager, this.info)
  }

  // -----------------------------------------------------------------------
  // Activation
  // -----------------------------------------------------------------------

  /**
   * Activate the support power.
   *
   * OpenRA 对照: SupportPower.Activate(Actor, Order, SupportPowerManager)
   *
   * Adds RadarPing if configured, notifies all INotifySupportPower traits.
   * Subclasses MUST call super.Activate() and then implement power-specific
   * logic (spawn aircraft, launch nuke, etc.).
   *
   * @param self — the actor holding this power
   * @param _order — the order that triggered activation
   * @param _manager — the owning SupportPowerManager
   */
  activate(
    self: IGameActor,
    _order: OrderStub,
    _manager: ISupportPowerManager,
  ): void {
    // RadarPing — deferred to Ch16
    if (this.info.displayRadarPing) {
      // NOTE: RadarPings deferred. In OpenRA:
      //   ping = manager.RadarPings.Value.Add(
      //     () => order.Player.IsAlliedWith(self.World.RenderPlayer),
      //     order.Target.CenterPosition,
      //     order.Player.Color,
      //     Info.RadarPingDuration);
    }

    // Notify all INotifySupportPower traits on this actor
    this.notifySupportPowerActivated(self)
  }

  // -----------------------------------------------------------------------
  // Launch sounds
  // -----------------------------------------------------------------------

  /**
   * Play launch sounds (allied hears Launch, enemy hears Incoming).
   *
   * OpenRA 对照: SupportPower.PlayLaunchSounds()
   *
   * Different audio paths are used depending on whether the local player
   * is allied with the owner.
   */
  playLaunchSounds(): void {
    // NOTE: OpenRA checks localPlayer != null && !localPlayer.Spectating,
    // then plays different sounds for allied vs enemy.
    // Sound integration deferred — see Ch7 Phase D.
    if (this.info.launchSound) {
      this.playPowerSoundLocal(this.info.launchSound)
    }
    if (this.info.incomingSound) {
      this.playPowerSoundLocal(this.info.incomingSound)
    }
  }

  // -----------------------------------------------------------------------
  // CellsMatching — footprint utility
  // -----------------------------------------------------------------------

  /**
   * Resolve a footprint char array to cell positions around a location.
   *
   * OpenRA 对照: SupportPower.CellsMatching(CPos, char[], CVec)
   *
   * Iterates the dimensions (j, i) and yields CPos for each 'x' in the
   * footprint pattern. The location is the center; cells are offset by
   * half the dimensions.
   *
   * @param location — the center cell position
   * @param footprint — array of characters, each 'x' marks an affected cell
   * @param dimensions — the width and height of the footprint grid
   * @returns array of cell positions matching 'x' in the footprint
   */
  static cellsMatching(
    location: CPos,
    footprint: string[],
    dimensions: CVec,
  ): CPos[] {
    const result: CPos[] = []
    let index = 0
    const startX =
      location.X - Math.floor((dimensions.X - 1) / 2)
    const startY =
      location.Y - Math.floor((dimensions.Y - 1) / 2)
    for (let j = 0; j < dimensions.Y; j++) {
      for (let i = 0; i < dimensions.X; i++) {
        if (index < footprint.length && footprint[index] === 'x') {
          result.push(new CPos(startX + i, startY + j))
        }
        index++
      }
    }
    return result
  }

  // -----------------------------------------------------------------------
  // Protected helpers — audio stubs (override for real playback)
  // -----------------------------------------------------------------------

  /**
   * Play a power-related sound to the power owner.
   * Override in subclasses to connect to real Sound system.
   *
   * @param _self — the actor holding this power
   * @param _category — the notification category name
   * @param _soundName — the sound asset name
   */
  protected playPowerSound(
    _self: IGameActor,
    _category: string,
    _soundName: string,
  ): void {
    // NOTE: Audio stubbed. Wire to Sound.ts from Ch7 Phase D.
  }

  /**
   * Play a speech notification to the power owner.
   *
   * @param _self — the actor holding this power
   * @param _notification — the speech notification name
   */
  protected playSpeechNotification(
    _self: IGameActor,
    _notification: string,
  ): void {
    // NOTE: Audio stubbed.
  }

  /**
   * Add a transient text notification for the power owner.
   *
   * @param _self — the actor holding this power
   * @param _text — the notification text
   */
  protected addTextNotification(
    _self: IGameActor,
    _text: string,
  ): void {
    // NOTE: Text notifications stubbed.
  }

  /**
   * Play a sound to the local player.
   *
   * @param _soundName — the sound asset name
   */
  protected playPowerSoundLocal(_soundName: string): void {
    // NOTE: Audio stubbed.
  }

  // -----------------------------------------------------------------------
  // Protected helpers — trait notification
  // -----------------------------------------------------------------------

  /**
   * Notify all INotifySupportPower traits on this actor that the power
   * has finished charging.
   *
   * @param self — the actor holding this power
   */
  protected notifySupportPowerCharged(self: IGameActor): void {
    if (self.traitsImplementing) {
      const traits = self.traitsImplementing('INotifySupportPower')
      for (const t of traits) {
        if (typeof (t as INotifySupportPower).charged === 'function') {
          (t as INotifySupportPower).charged(self)
        }
      }
    }
  }

  /**
   * Notify all INotifySupportPower traits on this actor that the power
   * has been activated.
   *
   * @param self — the actor holding this power
   */
  protected notifySupportPowerActivated(self: IGameActor): void {
    if (self.traitsImplementing) {
      const traits = self.traitsImplementing('INotifySupportPower')
      for (const t of traits) {
        if (typeof (t as INotifySupportPower).activated === 'function') {
          (t as INotifySupportPower).activated(self)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Protected helpers — OrderGenerator bridge
  // -----------------------------------------------------------------------

  /**
   * Set the active OrderGenerator for this power's targeting mode.
   * Override in subclasses for power-specific targeting.
   *
   * In OpenRA, this sets `self.World.OrderGenerator`.
   * In TypeScript, this is a bridge to the world interaction system.
   *
   * @param _self — the actor holding this power
   * @param _orderKey — the power key (order string)
   * @param _manager — the owning SupportPowerManager
   * @param _info — the power configuration
   */
  protected setOrderGenerator(
    _self: IGameActor,
    _orderKey: string,
    _manager: ISupportPowerManager,
    _info: SupportPowerInfo,
  ): void {
    // NOTE: OrderGenerator bridge deferred.
    // When WorldInteractionControllerWidget is fully wired,
    // this sets the active OrderGenerator on the world.
  }
}

// ---------------------------------------------------------------------------
// SupportPowerInstanceImpl — minimal stub for CreateInstance()
// ---------------------------------------------------------------------------

/**
 * Minimal SupportPowerInstance stub returned by CreateInstance().
 *
 * OpenRA 对照: SupportPowerInstance (nested in SupportPowerManager.cs)
 *
 * This is a placeholder — the real SupportPowerInstance is in
 * SupportPowerManager.ts. CreateInstance() returns this stub so that
 * the base class can construct instances without circular imports.
 */
class SupportPowerInstanceImpl implements ISupportPowerInstance {
  key: string
  instances: ISupportPower[] = []
  info: SupportPowerInfo
  totalTicks: number
  private _remainingSubTicks: number

  constructor(
    key: string,
    info: SupportPowerInfo,
    _manager: ISupportPowerManager,
  ) {
    this.key = key
    this.info = info
    this.totalTicks = info.chargeInterval ?? 0
    this._remainingSubTicks = info.startFullyCharged ? 0 : this.totalTicks * 100
  }

  get remainingTicks(): number {
    return Math.floor(this._remainingSubTicks / 100)
  }

  get active(): boolean {
    return false
  }

  get ready(): boolean {
    return false
  }

  get disabled(): boolean {
    return true
  }
}
