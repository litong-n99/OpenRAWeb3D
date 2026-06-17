/**
 * DropPodsPower.ts — 空投降落舱支援能力
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/SupportPowers/DropPodsPower.cs (191 lines)
 *
 * 核心范式转换:
 * - C# SupportPower (extends) → TypeScript SupportPower abstract class
 * - C# Dictionary<string, Func<CPos, WPos>> getLaunchLocation → TypeScript Map
 * - C# Aircraft + FallsToEarth physics → TypeScript stub (deferred)
 * - C# DropPodImpact effect → TypeScript effect spawn stub
 * - C# World.SharedRandom → TypeScript random number generator
 * - C# FindTilesInCircle + terrain validation → TypeScript tile search
 */

import {
  SupportPower,
  type SupportPowerInfo,
  type OrderStub,
  type ISupportPowerManager,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'

// ---------------------------------------------------------------------------
// DropPodsPowerInfo
// OpenRA 对照: DropPodsPowerInfo : SupportPowerInfo, IRulesetLoaded
// ---------------------------------------------------------------------------

/** Configuration for the Drop Pods support power.
 *
 * OpenRA 对照: DropPodsPowerInfo
 */
export class DropPodsPowerInfo implements ITraitInfo {
  /** Drop pod unit types.
   *
   * OpenRA 对照: DropPodsPowerInfo.UnitTypes
   */
  readonly unitTypes: readonly string[]

  /** Number of drop pods [min, max].
   *
   * OpenRA 对照: DropPodsPowerInfo.Drops (int2)
   */
  readonly drops: readonly [number, number]

  /** Approach direction.
   *
   * OpenRA 对照: DropPodsPowerInfo.PodFacing (WAngle)
   */
  readonly podFacing: WAngle

  /** Maximum offset from target location.
   *
   * OpenRA 对照: DropPodsPowerInfo.PodScatter
   */
  readonly podScatter: number

  /** Effect sequence sprite image.
   *
   * OpenRA 对照: DropPodsPowerInfo.EntryEffect
   */
  readonly entryEffect: string

  /** Effect sequence to display in the air.
   *
   * OpenRA 对照: DropPodsPowerInfo.EntryEffectSequence
   */
  readonly entryEffectSequence: string

  /** Effect palette.
   *
   * OpenRA 对照: DropPodsPowerInfo.EntryEffectPalette
   */
  readonly entryEffectPalette: string

  /** Camera actor to spawn.
   *
   * OpenRA 对照: DropPodsPowerInfo.CameraActor
   */
  readonly cameraActor: string | null

  /** Camera removal delay.
   *
   * OpenRA 对照: DropPodsPowerInfo.CameraRemoveDelay
   */
  readonly cameraRemoveDelay: number

  /** Weapon to fire.
   *
   * OpenRA 对照: DropPodsPowerInfo.Weapon
   */
  readonly weapon: string

  /** Weapon info reference.
   *
   * OpenRA 对照: DropPodsPowerInfo.WeaponInfo
   */
  weaponInfo: unknown = null

  /** Weapon delay (ticks).
   *
   * OpenRA 对照: DropPodsPowerInfo.WeaponDelay
   */
  readonly weaponDelay: number

  /** Support power base fields. */
  readonly orderName: string = 'DropPodsPowerInfoOrder'
  readonly chargeInterval: number = 0

  constructor(params?: {
    unitTypes?: readonly string[]
    drops?: readonly [number, number]
    podFacing?: WAngle
    podScatter?: number
    entryEffect?: string
    entryEffectSequence?: string
    entryEffectPalette?: string
    cameraActor?: string | null
    cameraRemoveDelay?: number
    weapon?: string
    weaponDelay?: number
    orderName?: string
    chargeInterval?: number
  }) {
    this.unitTypes = params?.unitTypes ?? []
    this.drops = params?.drops ?? [5, 8]
    this.podFacing = params?.podFacing ?? new WAngle(128)
    this.podScatter = params?.podScatter ?? 3
    this.entryEffect = params?.entryEffect ?? 'podring'
    this.entryEffectSequence = params?.entryEffectSequence ?? 'idle'
    this.entryEffectPalette = params?.entryEffectPalette ?? 'effect'
    this.cameraActor = params?.cameraActor ?? null
    this.cameraRemoveDelay = params?.cameraRemoveDelay ?? 25
    this.weapon = params?.weapon ?? 'Vulcan2'
    this.weaponDelay = params?.weaponDelay ?? 0
    if (params?.orderName) this.orderName = params.orderName
    if (params?.chargeInterval !== undefined) this.chargeInterval = params.chargeInterval
  }

  create(init: IGameActor): DropPodsPower {
    return new DropPodsPower(init, this)
  }
}

// ---------------------------------------------------------------------------
// DropPodsPower
// OpenRA 对照: DropPodsPower : SupportPower
// ---------------------------------------------------------------------------

/** Drop pods support power — drops units from the sky.
 *
 * OpenRA 对照: DropPodsPower
 *
 * On activation, spawns a configurable number of drop pods at random
 * positions within the scatter radius. Each pod carries a unit (aircraft)
 * that descends to a valid landable cell using the Aircraft movement system.
 */
export class DropPodsPower extends SupportPower {
  declare readonly info: DropPodsPowerInfo

  /** Lowercase unit type names.
   *
   * OpenRA 对照: DropPodsPower.unitTypes
   */
  private readonly _unitTypes: string[]

  /** Launch location resolver per unit type.
   *
   * OpenRA 对照: getLaunchLocation (Dictionary<string, Func<CPos, WPos>>)
   */
  private readonly _launchLocations = new Map<
    string,
    (cell: { X: number; Y: number }) => { X: number; Y: number; Z: number }
  >()

  /** Landable terrain types per unit type.
   *
   * OpenRA 对照: landableTerrainTypes
   */
  private readonly _landableTypes = new Map<string, ReadonlySet<string>>()

  constructor(self: IGameActor, info: DropPodsPowerInfo) {
    const spInfo: SupportPowerInfo = {
      orderName: info.orderName,
      chargeInterval: info.chargeInterval,
    }
    super(self, spInfo)
    ;(this as any).info = info

    this._unitTypes = info.unitTypes.map((u) => u.toLowerCase())

    // Pre-compute launch locations for each unit type
    for (const unitType of this._unitTypes) {
      // NOTE: In C#, this reads AircraftInfo and FallsToEarthInfo from actor rules.
      // In TypeScript, these are computed from the actor info at ruleset load time.
      // For migration, we use simplified defaults.
      const altitude = 0 // aircraftInfo.CruiseAltitude.Length
      const speed = 0 // aircraftInfo.Speed
      const velocity = 1 // FallsToEarthInfo.Velocity.Length
      const facing = info.podFacing

      // delta = new WVec(0, -altitude * speed / velocity, 0).Rotate(WRot.FromYaw(facing))
      const deltaY = -altitude * speed / velocity
      const rot = WRot.fromYaw(facing)
      const delta = new WVec(0, deltaY, 0).rotate(rot)

      // getLaunchLocation[unitType] = pos => centerOfCell(pos) - delta + new WVec(0, 0, altitude)
      this._launchLocations.set(unitType, (cell) => {
        const center = (self as any).world?.map?.centerOfCell?.(cell) ?? {
          X: cell.X * 1024,
          Y: cell.Y * 1024,
          Z: 0,
        }
        return {
          X: center.X - delta.X,
          Y: center.Y - delta.Y,
          Z: center.Z + altitude,
        }
      })

      // Landable terrain types
      this._landableTypes.set(unitType, new Set())
    }
  }

  // -------------------------------------------------------------------------
  // Activate
  // -------------------------------------------------------------------------

  /** Activate the drop pods power.
   *
   * OpenRA 对照: DropPodsPower.Activate(Actor, Order, SupportPowerManager)
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    const targetPos = (order.target as any)?.centerPosition
    if (!targetPos) return

    const world = (self as any).world
    if (!world) return

    const targetCell = world.map?.cellContaining?.(targetPos) ?? {
      X: 0,
      Y: 0,
    }

    this._sendDropPods(self, targetCell, () =>
      super.activate(self, order, manager),
    )
  }

  /** Check if drop pods can be deployed at a cell.
   *
   * OpenRA 对照: CanActivate(World, CPos)
   */
  canActivate(world: unknown, cell: { X: number; Y: number }): boolean {
    const w = world as any
    if (!w?.map?.contains(cell)) return false

    const tiles = this._findTilesInCircle(w, cell, this.info.podScatter)
    return tiles.some(
      (c) =>
        [...this._landableTypes.values()].some((types) =>
          types.has(w.map.getTerrainInfo?.(c)?.type ?? ''),
        ) && (w.actorMap?.getActorsAt?.(c)?.length ?? 0) === 0,
    )
  }

  /** Send the drop pods to the target cell.
   *
   * OpenRA 对照: SendDropPods(Actor, CPos, Action)
   */
  private _sendDropPods(
    self: IGameActor,
    targetCell: { X: number; Y: number },
    onSuccess: () => void,
  ): void {
    const world = (self as any).world

    // C#: self.World.AddFrameEndTask(world => { ... })
    if (!this.canActivate(world, targetCell)) return

    this.playLaunchSounds()
    onSuccess()

    // Spawn camera actor if configured
    if (this.info.cameraActor) {
      // NOTE: Camera actor creation deferred — requires Actor creation pipeline
    }

    const rng = world?.sharedRandom ?? {
      nextInt: (max: number) => Math.floor(Math.random() * max),
    }

    const dropAmount =
      this.info.drops[0] +
      rng.nextInt(this.info.drops[1] - this.info.drops[0] + 1)
    const validUnitTypes = [...this._unitTypes]

    for (let i = 0; i < dropAmount; i++) {
      if (validUnitTypes.length === 0) return

      const unitTypeIdx = rng.nextInt(validUnitTypes.length)
      const unitType = validUnitTypes[unitTypeIdx]

      const landableSet = this._landableTypes.get(unitType)
      const validLocations = this._findTilesInCircle(
        world,
        targetCell,
        this.info.podScatter,
      ).filter((c) => {
        const terrainType = world?.map?.getTerrainInfo?.(c)?.type ?? ''
        return (
          landableSet?.has(terrainType) &&
          (world?.actorMap?.getActorsAt?.(c)?.length ?? 0) === 0
        )
      })

      if (validLocations.length === 0) {
        validUnitTypes.splice(unitTypeIdx, 1)
        i--
        continue
      }

      const dropLocation = validLocations[rng.nextInt(validLocations.length)]
      const launchFn = this._launchLocations.get(unitType)
      if (!launchFn) continue

      const launchLocation = launchFn(dropLocation)

      // Create the pod (aircraft) at the launch position
      // NOTE: Actor creation via world.createActor is deferred.
      // In C#: world.CreateActor(false, unitType, [CenterPositionInit, OwnerInit, FacingInit])
      // The pod descends using Aircraft.CanLand() + FallsToEarth mechanics.
      // DropPodImpact effect is spawned for the visual.

      const dropEffect = {
        owner: (self as any).owner,
        weaponInfo: this.info.weaponInfo,
        world,
        launchLocation,
        targetLocation: dropLocation,
        weaponDelay: this.info.weaponDelay,
        image: this.info.entryEffect,
        sequence: this.info.entryEffectSequence,
        palette: this.info.entryEffectPalette,
      }

      const addEffect = world?.addEffect as
        | ((effect: unknown) => void)
        | undefined
      if (addEffect) {
        addEffect(dropEffect)
      }
    }
  }

  /** Find tiles within a circle radius.
   *
   * OpenRA 对照: Map.FindTilesInCircle(CPos, int)
   */
  private _findTilesInCircle(
    world: unknown,
    center: { X: number; Y: number },
    radius: number,
  ): { X: number; Y: number }[] {
    const result: { X: number; Y: number }[] = []
    const minX = center.X - radius
    const maxX = center.X + radius
    const minY = center.Y - radius
    const maxY = center.Y + radius
    const rSq = radius * radius

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const dx = x - center.X
        const dy = y - center.Y
        if (dx * dx + dy * dy <= rSq) {
          result.push({ X: x, Y: y })
        }
      }
    }

    return result
  }
}
