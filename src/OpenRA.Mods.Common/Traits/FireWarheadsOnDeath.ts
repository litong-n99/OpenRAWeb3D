/**
 * FireWarheadsOnDeath.ts -- Death explosion trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/FireWarheadsOnDeath.cs (190 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<Info>, INotifyKilled, INotifyDamage → TS ConditionalTrait<Info>
 * - C# ExplosionType enum → TS const object
 * - C# DamageSource enum → TS const object
 * - C# BuildingInfo duck-typed → TS duck-typed
 * - C# ParentActorInit → TS duck-typed initializer
 * - C# WeaponInfo.Impact() → TS duck-typed weapon.impact()
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type AttackInfo,
  type BitSetStub,
  type IHealth,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// ExplosionType enum
// OpenRA 对照: ExplosionType { Footprint, CenterPosition }
// ---------------------------------------------------------------------------

export const ExplosionType = {
  Footprint: 0,
  CenterPosition: 1,
} as const
export type ExplosionType =
  (typeof ExplosionType)[keyof typeof ExplosionType]

// ---------------------------------------------------------------------------
// DamageSource enum
// OpenRA 对照: DamageSource { Self, Parent, Killer }
// ---------------------------------------------------------------------------

export const DamageSource = {
  Self: 0,
  Parent: 1,
  Killer: 2,
} as const
export type DamageSource =
  (typeof DamageSource)[keyof typeof DamageSource]

// ---------------------------------------------------------------------------
// FireWarheadsOnDeathInfo
// OpenRA 对照: FireWarheadsOnDeathInfo (ConditionalTraitInfo, Requires<IHealthInfo>)
// ---------------------------------------------------------------------------

/** Configuration for FireWarheadsOnDeath trait.
 *
 *  OpenRA 对照: FireWarheadsOnDeathInfo
 */
export class FireWarheadsOnDeathInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Default weapon to use for explosion if ammo/payload is loaded.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.Weapon
   */
  readonly weapon: string | null = null

  /** Fallback weapon to use for explosion if empty (no ammo/payload).
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.EmptyWeapon (default "UnitExplode")
   */
  readonly emptyWeapon: string = 'UnitExplode'

  /** Chance that the explosion will use Weapon instead of EmptyWeapon when
   *  exploding, provided the actor has ammo/payload.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.LoadedChance (default 100)
   */
  readonly loadedChance: number = 100

  /** Chance that this actor will explode at all.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.Chance (default 100)
   */
  readonly chance: number = 100

  /** Health level at which actor will explode.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.DamageThreshold (default 0)
   */
  readonly damageThreshold: number = 0

  /** DeathType(s) that trigger the explosion.
   *  Leave empty to always trigger an explosion.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.DeathTypes
   */
  readonly deathTypes: BitSetStub<unknown> = {
    contains: () => false,
    isEmpty: () => true,
  }

  /** Who is counted as source of damage for explosion.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.DamageSource (default DamageSource.Self)
   */
  readonly damageSource: DamageSource = DamageSource.Self

  /** Explosion type: CenterPosition or Footprint.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.Type (default ExplosionType.CenterPosition)
   */
  readonly type: ExplosionType = ExplosionType.CenterPosition

  /** Offset of the explosion from the center of the exploding actor (or cell).
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.Offset (default WVec.Zero)
   */
  readonly offset: WVec = WVec.Zero

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    weapon?: string | null
    emptyWeapon?: string
    loadedChance?: number
    chance?: number
    damageThreshold?: number
    deathTypes?: BitSetStub<unknown>
    damageSource?: DamageSource
    type?: ExplosionType
    offset?: WVec
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.weapon = params.weapon ?? null
    this.emptyWeapon = params.emptyWeapon ?? 'UnitExplode'
    this.loadedChance = params.loadedChance ?? 100
    this.chance = params.chance ?? 100
    this.damageThreshold = params.damageThreshold ?? 0
    this.deathTypes = params.deathTypes ?? { contains: () => false, isEmpty: () => true }
    this.damageSource = params.damageSource ?? DamageSource.Self
    this.type = params.type ?? ExplosionType.CenterPosition
    this.offset = params.offset ?? WVec.Zero
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// FireWarheadsOnDeath
// OpenRA 对照: FireWarheadsOnDeath (ConditionalTrait<Info>, INotifyKilled, INotifyDamage)
// ---------------------------------------------------------------------------

/** Fires warheads when the actor is killed.
 *
 *  OpenRA 对照: FireWarheadsOnDeath
 */
export class FireWarheadsOnDeath extends ConditionalTrait<FireWarheadsOnDeathInfo> {
  /** Health trait reference.
   *
   *  OpenRA 对照: FireWarheadsOnDeath.health
   */
  private health: IHealth | null = null

  /** Parent actor (for DamageSource.Parent).
   *
   *  OpenRA 对照: FireWarheadsOnDeath.parent
   *
   *  TODO-8.E.PARENT-ACTOR: Full ParentActorInit resolution deferred to Chapter 9.
   */
  private parent: IGameActor | null = null

  /** Building info for footprint explosions.
   *
   *  OpenRA 对照: buildingInfo
   *
   *  TODO-8.E.BUILDING-INFO: Full BuildingInfo.occupiedTiles() deferred to Chapter 11.
   */
  private buildingInfo: unknown | null = null

  /** Armament references for loaded weapon check.
   *
   *  OpenRA 对照: FireWarheadsOnDeath.armaments
   */
  armaments: unknown[] = []

  /** Pre-resolved weapon info.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.WeaponInfo
   */
  weaponInfo: unknown | null = null

  /** Pre-resolved empty weapon info.
   *
   *  OpenRA 对照: FireWarheadsOnDeathInfo.EmptyWeaponInfo
   */
  emptyWeaponInfo: unknown | null = null

  constructor(info: FireWarheadsOnDeathInfo) {
    super(info)
  }

  /** Initialize references after actor creation.
   *
   *  OpenRA 对照: constructor + Created()
   *
   *  @param self — the actor
   *  @param health — the actor's health trait
   *  @param armaments — the actor's armament traits
   */
  init(
    self: IGameActor,
    health: IHealth | null,
    armaments: unknown[],
  ): void {
    this.health = health
    this.armaments = armaments

    // Duck-typed building info
    const selfInfo = (self as unknown as { info?: { getTraits?: (name: string) => unknown[] } }).info
    if (selfInfo?.getTraits) {
      this.buildingInfo = selfInfo.getTraits('buildingInfo')?.[0] ?? null
    }
  }

  /** Handle killed event: fire warheads at death position.
   *
   *  OpenRA 对照: INotifyKilled.Killed(Actor self, AttackInfo e)
   *
   *  @param self — the killed actor
   *  @param e — attack information
   */
  killed(self: IGameActor, e: AttackInfo): void {
    if (this.isTraitDisabled || !self.isInWorld) return

    const world = self.world as unknown as Record<string, unknown> | undefined
    const sharedRandom = world?.sharedRandom as { next: (max: number) => number } | undefined
    const rng = sharedRandom?.next ?? ((max: number) => Math.random() * max)

    // Chance check
    if (rng(100) > this.info.chance) return

    // Death type filter
    if (
      !this.info.deathTypes.isEmpty() &&
      !this.overlapsDeathTypes(e.damage.damageTypes, this.info.deathTypes)
    ) {
      return
    }

    const weapon = this.chooseWeaponForExplosion(self, rng)
    if (!weapon) return

    const source = this.getDamageSource(self, e)

    // TODO-8.E.SOUND-DEFER: weapon.Report sound playback

    const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition
    if (!centerPos) return

    if (
      this.info.type === ExplosionType.Footprint &&
      this.buildingInfo
    ) {
      // Footprint explosion: fire at each occupied cell
      const building = this.buildingInfo as {
        occupiedTiles?: (location: unknown) => unknown[]
      }
      const location = (self as unknown as { location?: unknown }).location
      if (building.occupiedTiles && location) {
        const cells = building.occupiedTiles(location)
        const worldMap = world?.map as Record<string, unknown> | undefined
        const centerOfCell = worldMap?.centerOfCell as
          ((cell: unknown) => { X: number; Y: number; Z: number }) | undefined
        for (const c of cells) {
          if (centerOfCell) {
            const cellCenter = centerOfCell(c)
            const wp = new WPos(
              cellCenter.X + this.info.offset.X,
              cellCenter.Y + this.info.offset.Y,
              cellCenter.Z + this.info.offset.Z,
            )
            ;(weapon as WeaponStub).impact?.(
              Target.fromPos(wp),
              source,
            )
          }
        }
      }
    } else {
      // Center position explosion
      const wp = new WPos(
        centerPos.X + this.info.offset.X,
        centerPos.Y + this.info.offset.Y,
        centerPos.Z + this.info.offset.Z,
      )
      ;(weapon as WeaponStub).impact?.(
        Target.fromPos(wp),
        source,
      )
    }
  }

  /** Handle damage event: check damage threshold.
   *
   *  OpenRA 对照: INotifyDamage.Damaged(Actor self, AttackInfo e)
   *
   *  @param self — the actor
   *  @param e — attack information
   */
  damaged(self: IGameActor, e: AttackInfo): void {
    if (this.info.damageThreshold === 0 || this.isTraitDisabled || !self.isInWorld) return

    if (
      !this.info.deathTypes.isEmpty() &&
      !this.overlapsDeathTypes(e.damage.damageTypes, this.info.deathTypes)
    ) {
      return
    }

    if (this.health && this.health.hp * 100 < this.info.damageThreshold * this.health.maxHP) {
      const world = self.world as unknown as Record<string, unknown> | undefined
      const addFrameEndTask = world?.addFrameEndTask as
        ((fn: (w: unknown) => void) => void) | undefined
      if (addFrameEndTask) {
        addFrameEndTask(() => {
          const source = this.getDamageSource(self, e)
          // NOTE: C# kills self (the damaged actor) with source as attacker.
          // source is the damage-source actor, self is the target being killed.
          ;(self as unknown as { kill?: (attacker: IGameActor, dmgTypes: BitSetStub<unknown>) => void })
            .kill?.(source, e.damage.damageTypes)
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Determine the damage source actor.
   *
   *  OpenRA 对照: FireWarheadsOnDeath.GetDamageSource(Actor self, AttackInfo e)
   */
  private getDamageSource(self: IGameActor, e: AttackInfo): IGameActor {
    switch (this.info.damageSource) {
      case DamageSource.Killer:
        return e.attacker
      case DamageSource.Self:
        return self
      case DamageSource.Parent:
        if (this.parent === null || this.parent.isDead) return self
        return this.parent
      default:
        return self
    }
  }

  /** Choose which weapon to use for the death explosion.
   *
   *  OpenRA 对照: FireWarheadsOnDeath.ChooseWeaponForExplosion(Actor self)
   */
  private chooseWeaponForExplosion(
    _self: IGameActor,
    rng: (max: number) => number,
  ): unknown | null {
    if (this.armaments.length === 0) return this.weaponInfo
    if (rng(100) > this.info.loadedChance) return this.emptyWeaponInfo

    // PERF: Avoid LINQ — check each armament for reloading state
    for (const a of this.armaments) {
      const arm = a as { isReloading?: boolean }
      if (!arm.isReloading) return this.weaponInfo
    }

    return this.emptyWeaponInfo
  }

  /** Check if damage types overlap with required death types.
   *
   *  OpenRA 对照: BitSet<DamageType>.Overlaps()
   */
  private overlapsDeathTypes(
    damageTypes: BitSetStub<unknown>,
    deathTypes: BitSetStub<unknown>,
  ): boolean {
    const dtRecord = damageTypes as unknown as Record<string, unknown>
    const rdtRecord = deathTypes as unknown as Record<string, unknown>
    const dtContains = dtRecord.contains as ((v: number) => boolean) | undefined
    const rdtContains = rdtRecord.contains as ((v: number) => boolean) | undefined

    if (!dtContains || !rdtContains) return false

    for (let i = 0; i < 32; i++) {
      if (rdtContains(i) && dtContains(i)) return true
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Helper stubs
// ---------------------------------------------------------------------------

interface WeaponStub {
  impact?: (target: Target, attacker: IGameActor) => void
  report?: string | null
}
