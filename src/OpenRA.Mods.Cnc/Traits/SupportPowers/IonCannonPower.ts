/**
 * IonCannonPower.ts — 离子炮支援能力（轨道离子炮打击）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/SupportPowers/IonCannonPower.cs (104 lines)
 *
 * 核心范式转换:
 * - C# SupportPower (extends) → TypeScript SupportPower abstract class
 * - C# IonCannon effect (World.Add) → TypeScript effect spawn stub
 * - C# CameraActor spawn + Wait + RemoveSelf → TypeScript camera stub
 * - C# Game.Sound.Play → TypeScript audio stub
 * - C# IRulesetLoaded weapon resolution → TypeScript runtime weapon lookup
 */

import {
  SupportPower,
  type SupportPowerInfo,
  type OrderStub,
  type ISupportPowerManager,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IonCannonPowerInfo
// OpenRA 对照: IonCannonPowerInfo : SupportPowerInfo, IRulesetLoaded
// ---------------------------------------------------------------------------

/** Configuration for the Ion Cannon superweapon.
 *
 * OpenRA 对照: IonCannonPowerInfo
 */
export class IonCannonPowerInfo implements ITraitInfo {
  /** Actor to spawn when the attack starts (camera).
   *
   * OpenRA 对照: IonCannonPowerInfo.CameraActor
   */
  readonly cameraActor: string | null

  /** Ticks to keep the camera alive.
   *
   * OpenRA 对照: IonCannonPowerInfo.CameraRemoveDelay
   */
  readonly cameraRemoveDelay: number

  /** Effect sequence sprite image.
   *
   * OpenRA 对照: IonCannonPowerInfo.Effect
   */
  readonly effect: string

  /** Effect sequence to display.
   *
   * OpenRA 对照: IonCannonPowerInfo.EffectSequence
   */
  readonly effectSequence: string

  /** Effect palette.
   *
   * OpenRA 对照: IonCannonPowerInfo.EffectPalette
   */
  readonly effectPalette: string

  /** Which weapon to fire.
   *
   * OpenRA 对照: IonCannonPowerInfo.Weapon
   */
  readonly weapon: string

  /** Weapon info reference (loaded at ruleset time).
   *
   * OpenRA 对照: IonCannonPowerInfo.WeaponInfo
   */
  weaponInfo: unknown = null

  /** Apply the weapon impact this many ticks into the effect.
   *
   * OpenRA 对照: IonCannonPowerInfo.WeaponDelay
   */
  readonly weaponDelay: number

  /** Sound to play at the targeted area.
   *
   * OpenRA 对照: IonCannonPowerInfo.OnFireSound
   */
  readonly onFireSound: string | null

  /** Support power base fields. */
  readonly orderName: string = 'IonCannonPowerInfoOrder'
  readonly chargeInterval: number = 0
  readonly cursor: string = 'ioncannon'

  constructor(params?: {
    cameraActor?: string | null
    cameraRemoveDelay?: number
    effect?: string
    effectSequence?: string
    effectPalette?: string
    weapon?: string
    weaponDelay?: number
    onFireSound?: string | null
    orderName?: string
    chargeInterval?: number
  }) {
    this.cameraActor = params?.cameraActor ?? null
    this.cameraRemoveDelay = params?.cameraRemoveDelay ?? 25
    this.effect = params?.effect ?? 'ionsfx'
    this.effectSequence = params?.effectSequence ?? 'idle'
    this.effectPalette = params?.effectPalette ?? 'effect'
    this.weapon = params?.weapon ?? 'IonCannon'
    this.weaponDelay = params?.weaponDelay ?? 7
    this.onFireSound = params?.onFireSound ?? null
    if (params?.orderName) this.orderName = params.orderName
    if (params?.chargeInterval !== undefined) this.chargeInterval = params.chargeInterval
  }

  create(init: IGameActor): IonCannonPower {
    return new IonCannonPower(init, this)
  }
}

// ---------------------------------------------------------------------------
// IonCannonPower
// OpenRA 对照: IonCannonPower : SupportPower
// ---------------------------------------------------------------------------

/** Fires an Ion Cannon projectile from orbit to a ground target.
 *
 * OpenRA 对照: IonCannonPower
 *
 * On activation, spawns an IonCannon effect descending from the sky,
 * plays the fire sound at the targeted position, and optionally spawns
 * a camera actor to view the impact area.
 */
export class IonCannonPower extends SupportPower {
  declare readonly info: IonCannonPowerInfo

  constructor(self: IGameActor, info: IonCannonPowerInfo) {
    // Build a minimal SupportPowerInfo-compatible object
    const spInfo: SupportPowerInfo = {
      orderName: info.orderName,
      chargeInterval: info.chargeInterval,
      cursor: info.cursor,
    }
    super(self, spInfo)
    // Override the info reference with the proper type
    ;(this as any).info = info
    ;(this as any).self = self
  }

  // -------------------------------------------------------------------------
  // Activate
  // -------------------------------------------------------------------------

  /** Activate the Ion Cannon.
   *
   * OpenRA 对照: IonCannonPower.Activate(Actor, Order, SupportPowerManager)
   *
   * Spawns the IonCannon effect, plays sounds, and optionally spawns a camera.
   *
   * @param self — the power's owning actor
   * @param order — the activation order
   * @param manager — the support power manager
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)

    // C#: Activate(self, order.Target)
    this._activateWithTarget(self, order.target ?? null)
  }

  /** Activate the Ion Cannon at a specific target.
   *
   * OpenRA 对照: IonCannonPower.Activate(Actor, Target)
   *
   * @param self — the power's owning actor
   * @param target — the target position/actor
   */
  private _activateWithTarget(self: IGameActor, target: unknown): void {
    const world = (self as any).world
    if (!world) return

    // C#: self.World.AddFrameEndTask(w => { ... })
    this.playLaunchSounds()

    // Play on-fire sound at target position
    if (this.info.onFireSound) {
      // NOTE: Game.Sound.Play(SoundType.World, info.OnFireSound, target.CenterPosition)
      // Audio stubbed — see Ch7 Phase D
    }

    // Spawn IonCannon effect: new IonCannon(owner, weaponInfo, world, centerPosition, target, ...)
    const targetPos = (target as any)?.centerPosition ?? { X: 0, Y: 0, Z: 0 }
    const effect = {
      owner: (self as any).owner,
      weaponInfo: this.info.weaponInfo,
      world,
      sourcePos: (self as any).centerPosition ?? { X: 0, Y: 0, Z: 0 },
      targetPos,
      image: this.info.effect,
      sequence: this.info.effectSequence,
      palette: this.info.effectPalette,
      weaponDelay: this.info.weaponDelay,
    }

    // Add to world (frame end task)
    const addEffect = world.addEffect as
      | ((effect: unknown) => void)
      | undefined
    if (addEffect) {
      addEffect(effect)
    }

    // Spawn camera actor if configured
    if (this.info.cameraActor) {
      // C#: var camera = w.CreateActor(info.CameraActor, ...)
      //      camera.QueueActivity(new Wait(info.CameraRemoveDelay));
      //      camera.QueueActivity(new RemoveSelf());
      // NOTE: Camera actor creation deferred — requires full Actor creation pipeline.
    }
  }
}
