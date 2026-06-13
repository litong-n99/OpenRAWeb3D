/**
 * FireProjectilesOnDeath.ts -- Shrapnel projectile burst when killed
 * OpenRA 对照: OpenRA.Mods.Common/Traits/FireProjectilesOnDeath.cs (124 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<Info>, INotifyKilled → TS ConditionalTrait<Info>
 * - C# ProjectileArgs + PROJECTILE_REGISTRY → TS duck-typed
 * - C# Util.RandomInRange → TS inline random range
 * - C# WRot.FromYaw(WAngle) → TS WRot.fromYaw(WAngle)
 * - C# WVec.Rotate(WRot) → TS WVec.rotate(WRot)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type AttackInfo,
  type BitSetStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { WVec } from '../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// FireProjectilesOnDeathInfo
// OpenRA 对照: FireProjectilesOnDeathInfo (ConditionalTraitInfo, IRulesetLoaded)
// ---------------------------------------------------------------------------

/** Configuration for FireProjectilesOnDeath trait.
 *
 *  OpenRA 对照: FireProjectilesOnDeathInfo
 */
export class FireProjectilesOnDeathInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Weapon names used for shrapnel.
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.Weapons
   */
  readonly weapons: readonly string[] = []

  /** Damage type filter for death trigger.
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.DeathTypes
   */
  readonly deathTypes: BitSetStub<unknown> = {
    contains: () => false,
    isEmpty: () => true,
  }

  /** Minimum damage value required to trigger projectiles.
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.MinimumDamage (default 0)
   */
  readonly minimumDamage: number = 0

  /** Maximum damage value (exclusive) to trigger projectiles.
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.MaximumDamage (default int.MaxValue)
   */
  readonly maximumDamage: number = Number.MAX_SAFE_INTEGER

  /** Pieces of shrapnel: [min, max] range.
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.Pieces (default [3, 10])
   */
  readonly pieces: readonly [number, number] = [3, 10]

  /** Range of travel distances for shrapnel: [min, max].
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.Range (default [WDist.FromCells(2), WDist.FromCells(5)])
   */
  readonly range: readonly [WDist, WDist] = [
    WDist.fromCells(2),
    WDist.fromCells(5),
  ]

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    weapons?: string[]
    deathTypes?: BitSetStub<unknown>
    minimumDamage?: number
    maximumDamage?: number
    pieces?: readonly [number, number]
    range?: readonly [WDist, WDist]
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.weapons = params.weapons ?? []
    this.deathTypes = params.deathTypes ?? { contains: () => false, isEmpty: () => true }
    this.minimumDamage = params.minimumDamage ?? 0
    this.maximumDamage = params.maximumDamage ?? Number.MAX_SAFE_INTEGER
    this.pieces = params.pieces ?? [3, 10]
    this.range = params.range ?? [WDist.fromCells(2), WDist.fromCells(5)]
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// FireProjectilesOnDeath
// OpenRA 对照: FireProjectilesOnDeath (ConditionalTrait<Info>, INotifyKilled)
// ---------------------------------------------------------------------------

/** Throws particles when the actor is destroyed that do damage on impact.
 *
 *  OpenRA 对照: FireProjectilesOnDeath
 */
export class FireProjectilesOnDeath extends ConditionalTrait<FireProjectilesOnDeathInfo> {
  /** Pre-resolved weapon info objects.
   *
   *  OpenRA 对照: FireProjectilesOnDeathInfo.WeaponInfos
   */
  weaponInfos: unknown[] = []

  constructor(info: FireProjectilesOnDeathInfo) {
    super(info)
  }

  /** Fire shrapnel projectiles when killed.
   *
   *  OpenRA 对照: INotifyKilled.Killed(Actor self, AttackInfo attack)
   *
   *  @param self — the killed actor
   *  @param attack — attack information
   */
  killed(self: IGameActor, attack: AttackInfo): void {
    if (this.isTraitDisabled) return

    // Check death type filter
    if (
      !this.info.deathTypes.isEmpty() &&
      !this.overlapsDeathTypes(attack.damage.damageTypes, this.info.deathTypes)
    ) {
      return
    }

    // Check damage value bounds
    if (
      attack.damage.value <= this.info.minimumDamage ||
      attack.damage.value >= this.info.maximumDamage
    ) {
      return
    }

    const world = self.world
    if (!world) return

    const worldAny = world as unknown as Record<string, unknown>
    const sharedRandom = worldAny.sharedRandom as { next: (max: number) => number } | undefined
    const map = worldAny.map as {
      distanceAboveTerrain?: (pos: unknown) => { length: number }
    } | undefined

    for (const wep of this.weaponInfos) {
      const weapon = wep as Record<string, unknown>

      // Random piece count in range [min, max] inclusive
      const rng = sharedRandom?.next ?? ((max: number) => Math.floor(Math.random() * max))
      const pieceRange = this.info.pieces
      const pieces = pieceRange[0] + rng(pieceRange[1] - pieceRange[0] + 1)

      const rangeLengths = this.info.range
      const rangeVal =
        rangeLengths[0].length +
        rng(rangeLengths[1].length - rangeLengths[0].length + 1)

      for (let i = 0; i < pieces; i++) {
        const rotation = WRot.fromYaw(new WAngle(rng(1024)))

        const centerPos = (self as unknown as { centerPosition?: { X: number; Y: number; Z: number } }).centerPosition
        if (!centerPos) continue

        let source = centerPos
        const dat = map?.distanceAboveTerrain?.(centerPos)
        if (dat && dat.length < 0) {
          source = {
            X: centerPos.X,
            Y: centerPos.Y,
            Z: centerPos.Z + dat.length,
          } as unknown as typeof centerPos
        }

        const passiveTargetVec = new WVec(rangeVal, 0, 0).rotate(rotation)
        const passiveTarget = (source as unknown as WPosStub).add
          ? (source as unknown as { add: (v: WVec) => unknown }).add(passiveTargetVec)
          : source

        const projectileType = weapon.projectileType as string | undefined
        if (!projectileType) continue

        // Duck-typed projectile creation via world.addFrameEndTask
        const addFrameEndTask = worldAny.addFrameEndTask as
          ((fn: (w: unknown) => void) => void) | undefined

        if (addFrameEndTask) {
          addFrameEndTask((w: unknown) => {
            const wAny = w as Record<string, unknown>
            // NOTE: Projectile creation uses PROJECTILE_REGISTRY in C#.
            //   In TS, the registry is duck-typed from the world.
            const registry = wAny.projectileRegistry as
              | Record<string, { create: (args: unknown) => unknown }>
              | undefined
            if (registry?.[projectileType]) {
              const args = {
                weapon: wep,
                facing: new WAngle(rng(1024)),
                currentMuzzleFacing: () => WAngle.Zero,
                damageModifiers: [] as number[],
                inaccuracyModifiers: [] as number[],
                rangeModifiers: [] as number[],
                source: source,
                currentSource: () => source,
                sourceActor: self,
                passiveTarget,
              }
              const projectile = registry[projectileType].create(args)
              if (projectile) {
                const worldAdd = wAny.add as ((proj: unknown) => void) | undefined
                worldAdd?.(projectile)
              }

              // TODO-8.E.SOUND-DEFER: Game.Sound.Play(SoundType.World, weapon.report, self.World, self.CenterPosition)
            }
          })
        }
      }
    }
  }

  /** Check if damage types overlap with required death types.
   *
   *  OpenRA 对照: BitSet<DamageType>.Overlaps()
   */
  private overlapsDeathTypes(
    damageTypes: BitSetStub<unknown>,
    deathTypes: BitSetStub<unknown>,
  ): boolean {
    // Simplified: both must have contains/isEmpty for proper BitSet semantics
    // In C#, Overlaps checks if any bit is set in both sets
    const dtRecord = damageTypes as unknown as Record<string, unknown>
    const rdtRecord = deathTypes as unknown as Record<string, unknown>
    const dtContains = dtRecord.contains as ((v: number) => boolean) | undefined
    const rdtContains = rdtRecord.contains as ((v: number) => boolean) | undefined

    if (!dtContains || !rdtContains) return false

    // Check each possible damage type value (simplified)
    for (let i = 0; i < 32; i++) {
      if (rdtContains(i) && dtContains(i)) return true
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Helper type for WPos-like objects
// ---------------------------------------------------------------------------

interface WPosStub {
  X: number
  Y: number
  Z: number
  add?: (v: WVec) => unknown
}
