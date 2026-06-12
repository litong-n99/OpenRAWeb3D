/**
 * WeaponInfo.ts — Central weapon configuration data hub
 * OpenRA 对照: OpenRA.Game/GameRules/WeaponInfo.cs (268 lines)
 *
 * 核心范式转换:
 * - C# sealed class with 14 readonly fields + 2 runtime-resolved fields
 *   → TypeScript immutable class with private constructor + fromJSON() factory
 * - C# IProjectileInfo (constructed at load time via reflection)
 *   → projectileType string + projectileConfig Record<string, unknown>
 *     (projectile constructed at fire time from registry)
 * - C# ImmutableArray<IWarhead> resolved at load time
 *   → readonly IWarhead[] resolved from WARHEAD_REGISTRY in fromJSON()
 * - C# BitSet<TargetableType> for valid/invalid targets
 *   → ReadonlySet<string> with set overlap checks
 * - C# World.Map.DistanceAboveTerrain / CellContaining for terrain validation
 *   → duck-typed optional chain with TODO-8.C.DEFER-2 markers
 * - C# FrozenActor target validation
 *   → TODO-8.C.DEFER-1 (throws descriptive error until Chapter 12)
 * - C# Impact() creates DelayedImpact effects
 *   → TypeScript DelayedImpact via import from Effects/
 *
 * All fields are readonly after construction (immutable config pattern).
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { WDist } from '../WDist.js'
import { WPos } from '../WPos.js'
import { WVec } from '../WVec.js'
import { WAngle } from '../WAngle.js'
import { WRot } from '../WRot.js'
import { Target, TargetType } from '../Traits/Target.js'
import type { IGameActor } from '../Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../World.js'
import type { IWarhead, WarheadArgs } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'
import type { WarheadConstructor } from '../../OpenRA.Mods.Common/Warheads/WarheadRegistry.js'
import { DelayedImpact } from '../Effects/DelayedImpact.js'

// ---------------------------------------------------------------------------
// ProjectileArgs — construction context for projectiles
// OpenRA 对照: OpenRA.GameRules.ProjectileArgs
// ---------------------------------------------------------------------------

/**
 * Arguments passed to projectile constructors.
 *
 * OpenRA 对照: ProjectileArgs struct (WeaponInfo.cs)
 *
 * ADR-8.C.1: This is the CANONICAL ProjectileArgs definition. All projectile
 * implementations must import from this file. Contains 11 fields matching
 * the C# definition exactly.
 *
 * Some fields use callbacks (currentMuzzleFacing, currentSource) to support
 * turreted units where the muzzle position/facing changes between when the
 * weapon is fired and when the projectile is actually created.
 */
export interface ProjectileArgs {
  /** The weapon that fired this projectile.
   *  OpenRA: ProjectileArgs.Weapon */
  weapon: WeaponInfo

  /** Percentage modifiers applied to warhead damage (e.g., FirepowerMultiplier).
   *  OpenRA: ProjectileArgs.DamageModifiers */
  damageModifiers: number[]

  /** Percentage modifiers applied to inaccuracy.
   *  OpenRA: ProjectileArgs.InaccuracyModifiers */
  inaccuracyModifiers: number[]

  /** Percentage modifiers applied to weapon range.
   *  OpenRA: ProjectileArgs.RangeModifiers */
  rangeModifiers: number[]

  /** Facing angle at launch time (from the source actor's turret/body).
   *  OpenRA: ProjectileArgs.Facing */
  facing: WAngle

  /** Callback to get the current muzzle facing (for multi-barrel/turreted weapons).
   *  Returns the launch facing if null.
   *  OpenRA: ProjectileArgs.CurrentMuzzleFacing */
  currentMuzzleFacing: (() => WAngle) | null

  /** Source position (firing point).
   *  OpenRA: ProjectileArgs.Source */
  source: WPos

  /** Callback to get the current source position (for multi-barrel weapons).
   *  Returns `source` if null.
   *  OpenRA: ProjectileArgs.CurrentSource */
  currentSource: (() => WPos) | null

  /** The actor that fired this projectile.
   *  OpenRA: ProjectileArgs.SourceActor */
  sourceActor: IGameActor

  /** The passive target position (where to aim at).
   *  OpenRA: ProjectileArgs.PassiveTarget */
  passiveTarget: WPos

  /** The active/guided target (actor, frozen actor, or terrain position).
   *  OpenRA: ProjectileArgs.GuidedTarget */
  guidedTarget: Target
}

// ---------------------------------------------------------------------------
// WeaponInfoFields — constructor parameter object
// ---------------------------------------------------------------------------

/**
 * Internal constructor parameter interface for WeaponInfo.
 */
export interface WeaponInfoFields {
  range: WDist
  firstBurstTargetOffset: WVec
  followingBurstTargetOffset: WVec
  report: readonly string[]
  startBurstReport: readonly string[]
  afterFireSound: readonly string[]
  afterFireSoundDelay: number
  reloadDelay: number
  burst: number
  canTargetSelf: boolean
  validTargets: ReadonlySet<string>
  invalidTargets: ReadonlySet<string>
  airThreshold: WDist
  burstDelays: readonly number[]
  minRange: WDist
  targetActorCenter: boolean
  projectileType: string | null
  projectileConfig: Record<string, unknown> | null
  warheads: readonly IWarhead[]
}

// ---------------------------------------------------------------------------
// WeaponInfo
// OpenRA 对照: OpenRA.GameRules.WeaponInfo (sealed class, 268 lines)
// ---------------------------------------------------------------------------

/**
 * Weapon configuration data loaded from JSON rule files.
 *
 * OpenRA 对照: OpenRA.GameRules.WeaponInfo
 *
 * WeaponInfo is the central configuration hub for weapons. It specifies:
 * - Range, burst, reload behavior
 * - Which warheads to apply on impact
 * - Which projectile type to use
 * - What target types are valid/invalid
 * - Sound effects for firing/reloading
 *
 * All fields are readonly after construction (immutable config).
 *
 * ## Deferred Features
 * - TODO-8.C.DEFER-1: FrozenActor target validation
 *   deferred until FrozenActor trait is migrated (Chapter 12).
 * - TODO-8.C.DEFER-2: Terrain altitude check via world.Map.DistanceAboveTerrain()
 *   deferred until map terrain query is fully wired.
 */
export class WeaponInfo {
  // ---------------------------------------------------------------------------
  // ---- Readonly fields (matching C# WeaponInfo fields exactly) ----
  // ---------------------------------------------------------------------------

  /** The maximum range the weapon can fire.
   *  OpenRA: WeaponInfo.Range (WDist, default WDist.Zero) */
  readonly range: WDist

  /** First burst is aimed at this offset relative to target position.
   *  OpenRA: WeaponInfo.FirstBurstTargetOffset (WVec, default WVec.Zero) */
  readonly firstBurstTargetOffset: WVec

  /** Each burst after the first lands by this offset away from the previous burst.
   *  OpenRA: WeaponInfo.FollowingBurstTargetOffset (WVec, default WVec.Zero) */
  readonly followingBurstTargetOffset: WVec

  /** Sound played each time the weapon is fired.
   *  OpenRA: WeaponInfo.Report (ImmutableArray<string>) */
  readonly report: readonly string[]

  /** Sound played only on first burst in a salvo.
   *  OpenRA: WeaponInfo.StartBurstReport (ImmutableArray<string>) */
  readonly startBurstReport: readonly string[]

  /** Sound played when the weapon is reloaded.
   *  OpenRA: WeaponInfo.AfterFireSound (ImmutableArray<string>) */
  readonly afterFireSound: readonly string[]

  /** Delay in ticks to play reloading sound.
   *  OpenRA: WeaponInfo.AfterFireSoundDelay (int, default 0) */
  readonly afterFireSoundDelay: number

  /** Delay in ticks between reloading ammo magazines.
   *  OpenRA: WeaponInfo.ReloadDelay (int, default 1) */
  readonly reloadDelay: number

  /** Number of shots in a single ammo magazine.
   *  OpenRA: WeaponInfo.Burst (int, default 1) */
  readonly burst: number

  /** Can this weapon target the attacker itself?
   *  OpenRA: WeaponInfo.CanTargetSelf (bool, default false) */
  readonly canTargetSelf: boolean

  /** What types of targets are affected.
   *  OpenRA: WeaponInfo.ValidTargets (BitSet<TargetableType>, default "Ground,Water") */
  readonly validTargets: ReadonlySet<string>

  /** What types of targets are unaffected (overrules ValidTargets).
   *  OpenRA: WeaponInfo.InvalidTargets (BitSet<TargetableType>) */
  readonly invalidTargets: ReadonlySet<string>

  /** If target position is above this altitude, weapon ignores terrain target
   *  types and only checks Air target type for validity.
   *  OpenRA: WeaponInfo.AirThreshold (WDist, default new WDist(128)) */
  readonly airThreshold: WDist

  /** Delay in ticks between firing shots from the same magazine.
   *  OpenRA: WeaponInfo.BurstDelays (ImmutableArray<int>, default [5]) */
  readonly burstDelays: readonly number[]

  /** The minimum range the weapon can fire.
   *  OpenRA: WeaponInfo.MinRange (WDist, default WDist.Zero) */
  readonly minRange: WDist

  /** Does this weapon aim at the target's center regardless of other offsets?
   *  OpenRA: WeaponInfo.TargetActorCenter (bool, default false) */
  readonly targetActorCenter: boolean

  // ---------------------------------------------------------------------------
  // ---- Runtime-resolved fields (constructed at fromJSON time) ----
  // ---------------------------------------------------------------------------

  /** The projectile type name (for registry lookup at fire time).
   *  OpenRA: WeaponInfo.Projectile (IProjectileInfo)
   *  In TS, we store the type name + raw config for deferred construction.
   *  ADR-8.C.3: projectile constructed at fire time, not load time. */
  readonly projectileType: string | null

  /** Raw projectile configuration (passthrough to factory).
   *  OpenRA: IProjectileInfo fields from FieldLoader.Load() */
  readonly projectileConfig: Record<string, unknown> | null

  /** Resolved warhead instances (constructed at load time).
   *  OpenRA: WeaponInfo.Warheads (ImmutableArray<IWarhead>) */
  readonly warheads: readonly IWarhead[]

  // ---------------------------------------------------------------------------
  // ---- Static target type constants (matching C#) ----
  // ---------------------------------------------------------------------------

  /** Air target type identifier used for air-threshold checks.
   *  OpenRA: TargetTypeAir = new("Air") */
  static readonly TARGET_TYPE_AIR = 'Air'

  /** Default valid targets: Ground, Water.
   *  OpenRA: ValidTargets default = new("Ground", "Water") */
  static readonly DEFAULT_VALID_TARGETS: ReadonlySet<string> = new Set(['Ground', 'Water'])

  /** Default burst delays: [5].
   *  OpenRA: BurstDelays default = [5] */
  static readonly DEFAULT_BURST_DELAYS: readonly number[] = [5]

  // ---------------------------------------------------------------------------
  // ---- Constructor ----
  // ---------------------------------------------------------------------------

  /**
   * Private constructor -- use fromJSON() factory.
   *
   * OpenRA 对照: WeaponInfo(MiniYaml content)
   */
  private constructor(fields: WeaponInfoFields) {
    this.range = fields.range
    this.firstBurstTargetOffset = fields.firstBurstTargetOffset
    this.followingBurstTargetOffset = fields.followingBurstTargetOffset
    this.report = fields.report
    this.startBurstReport = fields.startBurstReport
    this.afterFireSound = fields.afterFireSound
    this.afterFireSoundDelay = fields.afterFireSoundDelay
    this.reloadDelay = fields.reloadDelay
    this.burst = fields.burst
    this.canTargetSelf = fields.canTargetSelf
    this.validTargets = fields.validTargets
    this.invalidTargets = fields.invalidTargets
    this.airThreshold = fields.airThreshold
    this.burstDelays = fields.burstDelays
    this.minRange = fields.minRange
    this.targetActorCenter = fields.targetActorCenter
    this.projectileType = fields.projectileType
    this.projectileConfig = fields.projectileConfig
    this.warheads = fields.warheads
  }

  // ---------------------------------------------------------------------------
  // ---- fromJSON() factory ----
  // ---------------------------------------------------------------------------

  /**
   * Parse WeaponInfo from a JSON object with projectiles/warheads resolved
   * from registries.
   *
   * OpenRA 对照: new WeaponInfo(MiniYaml content) + LoadProjectile / LoadWarheads
   *
   * JSON Format (as produced by MiniYAML pipeline):
   * ```json
   * {
   *   "name": "Rifle",
   *   "Range": 5120,
   *   "Burst": 1,
   *   "BurstDelays": [5],
   *   "ReloadDelay": 15,
   *   "Report": ["gun5.aud"],
   *   "ValidTargets": ["Ground"],
   *   "Projectile": { "type": "Bullet", "Speed": 682, "Image": "bullet" },
   *   "Warhead@1": { "type": "SpreadDamage", "Damage": 15, "Spread": 128 }
   * }
   * ```
   *
   * ADR-8.C.3: Warheads are resolved immediately from warheadRegistry.
   * Projectiles store type name + config for deferred construction at fire time.
   *
   * @param json — parsed JSON record from weapons.yaml
   * @param warheadRegistry — name → Warhead constructor mapping
   * @returns fully constructed WeaponInfo
   * @throws Error if a referenced warhead type is not found in the registry
   */
  static fromJSON(
    json: Record<string, unknown>,
    warheadRegistry: Readonly<Record<string, WarheadConstructor>>,
  ): WeaponInfo {
    // ---- Extract scalar fields with C# defaults ----
    const range = typeof json.Range === 'number'
      ? new WDist(json.Range) : WDist.Zero

    const firstBurstTargetOffset = json.FirstBurstTargetOffset !== undefined
      ? WeaponInfo._parseWVec(json.FirstBurstTargetOffset)
      : WVec.Zero

    const followingBurstTargetOffset = json.FollowingBurstTargetOffset !== undefined
      ? WeaponInfo._parseWVec(json.FollowingBurstTargetOffset)
      : WVec.Zero

    const report: readonly string[] = Array.isArray(json.Report)
      ? json.Report.map(s => String(s))
      : []

    const startBurstReport: readonly string[] = Array.isArray(json.StartBurstReport)
      ? json.StartBurstReport.map(s => String(s))
      : []

    const afterFireSound: readonly string[] = Array.isArray(json.AfterFireSound)
      ? json.AfterFireSound.map(s => String(s))
      : []

    const afterFireSoundDelay = typeof json.AfterFireSoundDelay === 'number'
      ? json.AfterFireSoundDelay : 0

    const reloadDelay = typeof json.ReloadDelay === 'number'
      ? json.ReloadDelay : 1

    const burst = typeof json.Burst === 'number'
      ? json.Burst : 1

    const canTargetSelf = !!json.CanTargetSelf

    const validTargets: ReadonlySet<string> = Array.isArray(json.ValidTargets)
      ? new Set(json.ValidTargets.map(s => String(s)))
      : WeaponInfo.DEFAULT_VALID_TARGETS

    const invalidTargets: ReadonlySet<string> = Array.isArray(json.InvalidTargets)
      ? new Set(json.InvalidTargets.map(s => String(s)))
      : new Set<string>()

    const airThreshold = typeof json.AirThreshold === 'number'
      ? new WDist(json.AirThreshold) : new WDist(128)

    const burstDelays: readonly number[] = Array.isArray(json.BurstDelays)
      ? json.BurstDelays.map(n => Number(n))
      : WeaponInfo.DEFAULT_BURST_DELAYS

    const minRange = typeof json.MinRange === 'number'
      ? new WDist(json.MinRange) : WDist.Zero

    const targetActorCenter = !!json.TargetActorCenter

    // ---- Extract projectile type and config ----
    let projectileType: string | null = null
    let projectileConfig: Record<string, unknown> | null = null

    const projNode = json.Projectile as Record<string, unknown> | undefined
    if (projNode && typeof projNode === 'object') {
      const { type, ...rest } = projNode
      projectileType = typeof type === 'string' ? type : null
      projectileConfig = Object.keys(rest).length > 0 ? rest as Record<string, unknown> : null
    }

    // ---- Resolve warheads ----
    const warheads: IWarhead[] = []

    // C# pattern: foreach node where key starts with "Warhead"
    for (const key of Object.keys(json)) {
      if (!key.startsWith('Warhead')) continue

      const warheadNode = json[key] as Record<string, unknown> | undefined
      if (!warheadNode || typeof warheadNode !== 'object') continue

      const warheadType = typeof warheadNode.type === 'string'
        ? warheadNode.type : undefined
      if (!warheadType) continue

      const Ctor = warheadRegistry[warheadType]
      if (!Ctor) {
        throw new Error(
          `WeaponInfo.fromJSON: Unknown warhead type "${warheadType}" ` +
          `(from key "${key}"). Available: ${Object.keys(warheadRegistry).join(', ')}`,
        )
      }

      const instance = new Ctor()
      instance.loadFromJSON(warheadNode)
      warheads.push(instance)
    }

    return new WeaponInfo({
      range,
      firstBurstTargetOffset,
      followingBurstTargetOffset,
      report,
      startBurstReport,
      afterFireSound,
      afterFireSoundDelay,
      reloadDelay,
      burst,
      canTargetSelf,
      validTargets,
      invalidTargets,
      airThreshold,
      burstDelays,
      minRange,
      targetActorCenter,
      projectileType,
      projectileConfig,
      warheads,
    })
  }

  // ---------------------------------------------------------------------------
  // ---- Target validation methods ----
  // ---------------------------------------------------------------------------

  /**
   * Check if the given target types overlap with valid targets
   * and do not overlap with invalid targets.
   *
   * OpenRA 对照: WeaponInfo.IsValidTarget(BitSet<TargetableType>)
   *
   * Matches the C# semantics exactly:
   * ```
   * ValidTargets.Overlaps(targetTypes) && !InvalidTargets.Overlaps(targetTypes)
   * ```
   *
   * @param targetTypes — set of target type strings
   * @returns true if at least one valid target type matches and none are invalid
   */
  isValidTarget(targetTypes: ReadonlySet<string>): boolean {
    let hasValid = false
    for (const t of targetTypes) {
      if (this.invalidTargets.has(t)) return false
      if (this.validTargets.has(t)) hasValid = true
    }
    return hasValid
  }

  /**
   * Full target validation against a Target object.
   *
   * OpenRA 对照: WeaponInfo.IsValidAgainst(in Target target, World world, Actor firedBy)
   *
   * Routes to the appropriate validator based on target type:
   * - TargetType.Actor -> isValidAgainstActor()
   * - TargetType.FrozenActor -> THROWS NOT_IMPLEMENTED (TODO-8.C.DEFER-1)
   * - TargetType.Terrain -> validates terrain cell target types
   *   (TODO-8.C.DEFER-2: partial, uses duck-typed map)
   * - TargetType.Invalid -> returns false
   *
   * @param target — the target to validate
   * @param world — game world (for terrain queries, may be null in tests)
   * @param firedBy — the actor firing the weapon
   * @returns true if the weapon can target this target
   */
  isValidAgainst(
    target: Target,
    world: GameWorldManager | null,
    firedBy: IGameActor,
  ): boolean {
    if (target.type === TargetType.Actor) {
      const victim = (target as { actor?: unknown }).actor as unknown as IGameActor | undefined
      if (!victim) return false
      return this.isValidAgainstActor(victim, firedBy)
    }

    if (target.type === TargetType.FrozenActor) {
      // TODO-8.C.DEFER-1: FrozenActor trait not yet migrated.
      // For now, throw a descriptive error.
      throw new Error(
        'WeaponInfo.isValidAgainst(FrozenActor): Not yet implemented. ' +
        'FrozenActor trait is planned for Chapter 12 (Shroud & Fog of War).',
      )
    }

    if (target.type === TargetType.Terrain) {
      return this._isValidAgainstTerrain(target, world)
    }

    return false
  }

  /**
   * Check if the weapon can target the given actor.
   *
   * OpenRA 对照: WeaponInfo.IsValidAgainst(Actor victim, Actor firedBy)
   *
   * Checks:
   * 1. CanTargetSelf protection (victim === firedBy)
   * 2. Target type overlap (victim.GetEnabledTargetTypes() vs validTargets/invalidTargets)
   *
   * Uses duck-typing for getEnabledTargetTypes() to avoid dependency on
   * the full Actor trait system.
   *
   * @param victim — the target actor
   * @param firedBy — the actor firing the weapon
   * @returns true if valid
   */
  isValidAgainstActor(victim: IGameActor, firedBy: IGameActor): boolean {
    if (!this.canTargetSelf && victim === firedBy) return false

    // Duck-typed access to getEnabledTargetTypes() which is provided by
    // the Targetable trait on the actor.
    const victimAny = victim as unknown as { getEnabledTargetTypes?: () => Set<string> }
    const targetTypes = victimAny.getEnabledTargetTypes?.()
    if (!targetTypes) return false

    return this.isValidTarget(targetTypes)
  }

  /**
   * Check if the weapon can target the given terrain position.
   *
   * OpenRA 对照: WeaponInfo.IsValidAgainst() terrain branch
   *
   * TODO-8.C.DEFER-2: Full terrain validation requires world.Map.DistanceAboveTerrain(),
   * world.Map.CellContaining(), and world.Map.GetTerrainInfo(). These methods are
   * duck-typed via optional chaining. When the map system is fully wired, these
   * will be available as concrete methods.
   *
   * @param target — terrain target
   * @param world — game world (may be null in tests)
   * @returns true if valid, or permissively true if world/map is unavailable
   */
  private _isValidAgainstTerrain(
    target: Target,
    world: GameWorldManager | null,
  ): boolean {
    const centerPos = target.centerPosition

    // If no world or no map, be permissive (for tests / early integration)
    if (!world || !world.map) return true

    // Duck-typed map access
    const mapAny = world.map as unknown as {
      distanceAboveTerrain?: (pos: WPos) => WDist
      cellContaining?: (pos: WPos) => { X: number; Y: number }
      contains?: (cell: { X: number; Y: number }) => boolean
      getTerrainInfo?: (cell: { X: number; Y: number }) => { targetTypes: Set<string> }
    }

    // Check AirThreshold
    const dat = mapAny.distanceAboveTerrain?.(centerPos)
    if (dat && dat.length > this.airThreshold.length) {
      return this.validTargets.has(WeaponInfo.TARGET_TYPE_AIR)
    }

    const cell = mapAny.cellContaining?.(centerPos)
    if (!cell) return true

    if (!mapAny.contains?.(cell)) return false

    const cellInfo = mapAny.getTerrainInfo?.(cell)
    if (!cellInfo) return true

    if (cellInfo.targetTypes) {
      return this.isValidTarget(cellInfo.targetTypes)
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // ---- Impact methods ----
  // ---------------------------------------------------------------------------

  /**
   * Apply all warheads to the target.
   *
   * OpenRA 对照: WeaponInfo.Impact(in Target target, WarheadArgs args)
   *
   * Iterates all warheads:
   * - If warhead.delay > 0: schedules a DelayedImpact effect
   * - If warhead.delay <= 0: calls warhead.doImpact() immediately
   *
   * The DelayedImpact is added via world.addFrameEndTask() matching the
   * C# pattern exactly:
   * ```
   * world.AddFrameEndTask(w => w.Add(new DelayedImpact(warhead.Delay, warhead, delayedTarget, args)));
   * ```
   *
   * ADR-8.C.5: Uses canonical DelayedImpact from Effects/.
   *
   * NOTE: The closure captures object references to `target` and `args`.
   * Callers must not mutate these objects after calling `impact()`.
   * (In C#, Target is a struct that is implicitly copied.)
   *
   * @param target — the target to impact
   * @param args — warhead arguments (source actor, damage modifiers, etc.)
   */
  impact(target: Target, args: WarheadArgs): void {
    // Get world reference from the source actor (may be duck-typed)
    const world = args.sourceActor.world as GameWorldManager | undefined

    if (!world) {
      // No world — apply warheads directly (for testing)
      for (const warhead of this.warheads) {
        warhead.doImpact(target, args)
      }
      return
    }

    for (const warhead of this.warheads) {
      if (warhead.delay > 0) {
        // Capture copies for the closure (matching C# lambdas-can't-use-in pattern)
        const delayedTarget = target
        const delayedArgs = args

        world.addFrameEndTask(() => {
          // C# 对照: w.Add(new DelayedImpact(warhead.Delay, ...))
          // where w is the World reference. In TS, the frame-end task has no
          // parameter, so we capture the world reference and use addEffect().
          // NOTE: DelayedImpact implements IGameEffect, which is what addEffect() expects.
          world.addEffect(new DelayedImpact(
            warhead.delay,
            warhead,
            delayedTarget,
            delayedArgs,
          ))
        })
      } else {
        warhead.doImpact(target, args)
      }
    }
  }

  /**
   * Impact overload for projectile-less, special-case impacts
   * (e.g., warheads applied directly from traits like Explodes).
   *
   * OpenRA 对照: WeaponInfo.Impact(in Target target, Actor firedBy)
   *
   * Creates WarheadArgs from the firedBy actor and delegates to
   * Impact(target, args).
   *
   * The impact happens immediately at target.CenterPosition.
   *
   * @param target — the target to impact
   * @param firedBy — the actor that caused the impact
   */
  impactDirect(target: Target, firedBy: IGameActor): void {
    // Duck-typed access to OccupiesSpace trait for source position
    const firedByAny = firedBy as unknown as {
      occupiesSpace?: { centerPosition: WPos }
    }

    const args: WarheadArgs = {
      weapon: this,
      sourceActor: firedBy,
      weaponTarget: target,
      source: firedByAny.occupiesSpace?.centerPosition ?? null,
      impactPosition: target.centerPosition,
      impactOrientation: WRot.None,
      damageModifiers: [],
    }

    this.impact(target, args)
  }

  // ---------------------------------------------------------------------------
  // ---- Burst delay computation ----
  // ---------------------------------------------------------------------------

  /**
   * Get the burst delay for the given burst index.
   *
   * OpenRA 对照: BurstDelays accessor (used by Armament at fire time)
   *
   * If burstDelays has a single entry, it is used for all bursts.
   * If multiple entries, the index must be within bounds.
   *
   * @param index — the burst index (0-based, where index < Burst - 1)
   * @returns the delay in ticks for this burst
   */
  getBurstDelay(index: number): number {
    if (this.burstDelays.length === 1) {
      return this.burstDelays[0]!
    }
    return this.burstDelays[index] ?? this.burstDelays[this.burstDelays.length - 1]!
  }

  // ---------------------------------------------------------------------------
  // ---- Private helpers ----
  // ---------------------------------------------------------------------------

  /**
   * Parse a WVec from JSON (accepts {x,y,z} object or array [x,y,z]).
   *
   * TODO-8.C.DEFER-4: This handles numeric values only. OpenRA YAML cell
   * distance notation (5c0, 1c682) must be pre-parsed by the MiniYAML
   * pipeline to integer values before WeaponInfo receives the JSON.
   */
  private static _parseWVec(raw: unknown): WVec {
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw)) {
        const arr = raw as unknown[]
        return new WVec(
          typeof arr[0] === 'number' ? arr[0] : 0,
          typeof arr[1] === 'number' ? arr[1] : 0,
          typeof arr[2] === 'number' ? arr[2] : 0,
        )
      }
      const obj = raw as Record<string, unknown>
      return new WVec(
        typeof obj.x === 'number' ? obj.x : (typeof obj.X === 'number' ? obj.X : 0),
        typeof obj.y === 'number' ? obj.y : (typeof obj.Y === 'number' ? obj.Y : 0),
        typeof obj.z === 'number' ? obj.z : (typeof obj.Z === 'number' ? obj.Z : 0),
      )
    }
    return WVec.Zero
  }
}

// ---------------------------------------------------------------------------
// Re-export convenience aliases (ADR-8.C.1 / ADR-8.C.2)
// ---------------------------------------------------------------------------

/**
 * Re-export WarheadArgs factory functions for convenience.
 * These are defined in Warhead.ts but re-exported from WeaponInfo.ts
 * to match the C# pattern where WarheadArgs is defined in WeaponInfo.cs.
 */
export { createWarheadArgs, copyWarheadArgs } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'
