/**
 * Cloak.ts — Stealth / cloak trait for game actors
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Cloak.cs (374 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<CloakInfo> → TS ConditionalTrait<CloakInfo>
 * - C# [Flags] UncloakType enum → TS number bitmask with const enum-like objects
 * - C# CloakStyle enum → TS CloakStyle numeric enum
 * - C# Color.FromArgb() → TS CloakedColor { a, r, g, b } interface
 * - C# INotifyAttack (explicit interface) → TS INotifyAttack (from CombatInterfaces.ts)
 * - C# BitSet<DetectionType> → TS DetectionTypes string[]
 * - C# Game.Sound.Play() → TODO stubbed (full Sound integration TBD)
 * - C# SpriteEffect via World.AddFrameEndTask + w.Add → self.world.addFrameEndTask + addEffect
 * - C# DetectCloaked integration via World.ActorsWithTrait → self.world.actorsWithTrait
 * - C# WDist.LengthSquared for range check → WDist.length squared comparison
 *
 * Deferred features:
 * - TODO-12.A.4.2:  INotifyDockClient / INotifyDockHost (dock uncloak)
 * - TODO-12.A.4.3:  INotifyLoadCargo (load uncloak)
 * - TODO-12.A.4.4:  INotifyUnloadCargo (unload uncloak)
 * - TODO-12.A.4.5:  INotifyDemolition (demolish uncloak)
 * - TODO-12.A.4.6:  INotifyInfiltration (infiltrate uncloak)
 * - TODO-12.A.4.7:  IRadarColorModifier + INotifySupportPower
 * - TODO-12.A.4.8:  ModifyRender visual effects (Alpha/Color/Palette renderable wrapping)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
  type ISync,
  type PlayerStub,
  type WorldStub,
  type INotifyDamage,
  type AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type INotifyAttack,
  type Barrel,
} from './CombatInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WDist } from '../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// UncloakType — bitflag enum for events that break cloak
// OpenRA 对照: UncloakType [Flags] enum
// ---------------------------------------------------------------------------

/** Events that can cause an actor to uncloak.
 *
 * OpenRA 对照: UncloakType [Flags] enum
 *
 * Each value is a power-of-2 bitmask used with bitwise operations to
 * check whether a given event type triggers uncloaking.
 */
export const UncloakType = {
  None: 0,
  Attack: 1 << 0,
  Move: 1 << 1,
  Load: 1 << 2,
  Unload: 1 << 3,
  Infiltrate: 1 << 4,
  Demolish: 1 << 5,
  Damage: 1 << 6,
  Heal: 1 << 7,
  SelfHeal: 1 << 8,
  Dock: 1 << 9,
  SupportPower: 1 << 10,
} as const

export type UncloakType = number

// ---------------------------------------------------------------------------
// CloakStyle — visual style for cloaked actors
// OpenRA 对照: CloakStyle enum
// ---------------------------------------------------------------------------

/** Visual rendering style for cloaked actors.
 *
 * OpenRA 对照: CloakStyle enum
 */
export const CloakStyle = {
  None: 0,
  Alpha: 1,
  Color: 2,
  Palette: 3,
} as const

export type CloakStyle = (typeof CloakStyle)[keyof typeof CloakStyle]

// ---------------------------------------------------------------------------
// CloakedColor — ARGB color representation
// OpenRA 对照: Color.FromArgb(a, r, g, b)
// ---------------------------------------------------------------------------

/** Simple ARGB color value used for CloakStyle.Color tinting.
 *
 * OpenRA 对照: OpenRA.Primitives.Color
 *
 * NOTE: This is a minimal representation matching the fields needed
 * by Cloak. The full Color class in OpenRA.Primitives/Color.ts provides
 * sRGB/linear conversion functions used elsewhere.
 */
export interface CloakedColor {
  readonly a: number
  readonly r: number
  readonly g: number
  readonly b: number
}

// ---------------------------------------------------------------------------
// DetectionTypes — type tag for cloak detection classification
// OpenRA 对照: DetectionType class (empty type tag)
// ---------------------------------------------------------------------------

/**
 * Simple type tag for classify cloaked actors into detection groups.
 *
 * OpenRA 对照: DetectionType (empty type tag class)
 *
 * DetectCloaked traits match their DetectionTypes against the cloaked actor's
 * DetectionTypes to determine if they can reveal the cloaked unit.
 */
export interface DetectionType {
  readonly name: string
}

// ---------------------------------------------------------------------------
// CloakInfo — configuration for the Cloak trait
// OpenRA 对照: CloakInfo : PausableConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the Cloak trait.
 *
 * OpenRA 对照: CloakInfo (PausableConditionalTraitInfo)
 */
export class CloakInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Measured in game ticks. Ticks before initial cloak after creation.
   *
   * OpenRA 对照: CloakInfo.InitialDelay (default 10)
   */
  readonly initialDelay: number = 10

  /** Measured in game ticks. Ticks before re-cloaking after uncloak.
   *
   * OpenRA 对照: CloakInfo.CloakDelay (default 30)
   */
  readonly cloakDelay: number = 30

  /** Events leading to the actor getting uncloaked.
   *
   * OpenRA 对照: CloakInfo.UncloakOn
   *
   * Bitmask of UncloakType values. Default: Attack | Unload | Infiltrate | Demolish | Dock
   */
  readonly uncloakOn: UncloakType = UncloakType.Attack
    | UncloakType.Unload
    | UncloakType.Infiltrate
    | UncloakType.Demolish
    | UncloakType.Dock

  /** Sound to play when cloaking.
   *
   * OpenRA 对照: CloakInfo.CloakSound (default null)
   *
   * TODO-12.DEFERRED.15: Sound playback system integration
   */
  readonly cloakSound: string | null = null

  /** Sound to play when uncloaking.
   *
   * OpenRA 对照: CloakInfo.UncloakSound (default null)
   *
   * TODO-12.DEFERRED.15: Sound playback system integration
   */
  readonly uncloakSound: string | null = null

  /** Detection type tags that determine which DetectCloaked units can reveal this.
   *
   * OpenRA 对照: CloakInfo.DetectionTypes (BitSet<DetectionType>)
   *
   * Default: ["Cloak"]
   *
   * Integrated with DetectCloaked via _detectionTypesOverlap() in isVisible().
   */
  readonly detectionTypes: readonly string[] = ['Cloak']

  /** The condition to grant to self while cloaked.
   *
   * OpenRA 对照: CloakInfo.CloakedCondition (default null)
   */
  readonly cloakedCondition: string | null = null

  /** The type of cloak. Same type won't trigger redundant sound/effect.
   *
   * OpenRA 对照: CloakInfo.CloakType (default null)
   */
  readonly cloakType: string | null = null

  /** Render effect to use when cloaked.
   *
   * OpenRA 对照: CloakInfo.CloakStyle (default Alpha)
   */
  readonly cloakStyle: CloakStyle = CloakStyle.Alpha

  /** Alpha level when using Alpha style.
   *
   * OpenRA 对照: CloakInfo.CloakedAlpha (default 0.55)
   */
  readonly cloakedAlpha: number = 0.55

  /** Color when using Color style. ARGB (140, 0, 0, 0).
   *
   * OpenRA 对照: CloakInfo.CloakedColor (default Color.FromArgb(140, 0, 0, 0))
   */
  readonly cloakedColor: CloakedColor = { a: 140, r: 0, g: 0, b: 0 }

  /** Palette when using Palette style.
   *
   * OpenRA 对照: CloakInfo.CloakedPalette (default null)
   */
  readonly cloakedPalette: string | null = null

  /** Whether CloakedPalette is a player palette.
   *
   * OpenRA 对照: CloakInfo.IsPlayerPalette (default false)
   */
  readonly isPlayerPalette: boolean = false

  /** Image for cloak/uncloak effect.
   *
   * OpenRA 对照: CloakInfo.EffectImage (default null)
   *
   * TODO-12.DEFERRED.15: SpriteEffect visual effect generation
   */
  readonly effectImage: string | null = null

  /** Sequence for cloak effect.
   *
   * OpenRA 对照: CloakInfo.CloakEffectSequence (default null)
   *
   * TODO-12.DEFERRED.15: SpriteEffect visual effect generation
   */
  readonly cloakEffectSequence: string | null = null

  /** Sequence for uncloak effect.
   *
   * OpenRA 对照: CloakInfo.UncloakEffectSequence (default null)
   *
   * TODO-12.DEFERRED.15: SpriteEffect visual effect generation
   */
  readonly uncloakEffectSequence: string | null = null

  /** Palette for effect.
   *
   * OpenRA 对照: CloakInfo.EffectPalette (default "effect")
   */
  readonly effectPalette: string = 'effect'

  /** Whether effect palette is player-specific.
   *
   * OpenRA 对照: CloakInfo.EffectPaletteIsPlayerPalette (default false)
   */
  readonly effectPaletteIsPlayerPalette: boolean = false

  /** Offset for cloak/uncloak effect.
   *
   * OpenRA 对照: CloakInfo.EffectOffset (default WVec.Zero)
   *
   * NOTE: C# default is WVec.Zero, not null. The null default here is a
   * simplification since TODO-12.DEFERRED.15 (SpriteEffect generation) is
   * deferred. When implementing TODO-12.DEFERRED.15, change the default to
   * `WVec.Zero` and update the constructor accordingly.
   */
  readonly effectOffset: WVec | null = null

  /** Whether the effect tracks the actor.
   *
   * OpenRA 对照: CloakInfo.EffectTracksActor (default true)
   */
  readonly effectTracksActor: boolean = true

  /** Whether this trait is enabled by default on the actor.
   *
   * This is a TypeScript framework field (not present in the C# CloakInfo).
   * In C#, the EnabledByDefault behavior is handled by ConditionalTraitInfo
   * base class. We surface it explicitly here so that the TS trait framework
   * can determine the initial enabled/disabled state without reflection.
   */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    initialDelay?: number
    cloakDelay?: number
    uncloakOn?: UncloakType
    cloakSound?: string | null
    uncloakSound?: string | null
    detectionTypes?: readonly string[]
    cloakedCondition?: string | null
    cloakType?: string | null
    cloakStyle?: CloakStyle
    cloakedAlpha?: number
    cloakedColor?: CloakedColor
    cloakedPalette?: string | null
    isPlayerPalette?: boolean
    effectImage?: string | null
    cloakEffectSequence?: string | null
    uncloakEffectSequence?: string | null
    effectPalette?: string
    effectPaletteIsPlayerPalette?: boolean
    effectOffset?: WVec | null
    effectTracksActor?: boolean
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.initialDelay = params.initialDelay ?? 10
    this.cloakDelay = params.cloakDelay ?? 30
    this.uncloakOn = params.uncloakOn ?? (UncloakType.Attack | UncloakType.Unload | UncloakType.Infiltrate | UncloakType.Demolish | UncloakType.Dock)
    this.cloakSound = params.cloakSound ?? null
    this.uncloakSound = params.uncloakSound ?? null
    this.detectionTypes = params.detectionTypes ?? ['Cloak']
    this.cloakedCondition = params.cloakedCondition ?? null
    this.cloakType = params.cloakType ?? null
    this.cloakStyle = params.cloakStyle ?? CloakStyle.Alpha
    this.cloakedAlpha = params.cloakedAlpha ?? 0.55
    this.cloakedColor = params.cloakedColor ?? { a: 140, r: 0, g: 0, b: 0 }
    this.cloakedPalette = params.cloakedPalette ?? null
    this.isPlayerPalette = params.isPlayerPalette ?? false
    this.effectImage = params.effectImage ?? null
    this.cloakEffectSequence = params.cloakEffectSequence ?? null
    this.uncloakEffectSequence = params.uncloakEffectSequence ?? null
    this.effectPalette = params.effectPalette ?? 'effect'
    this.effectPaletteIsPlayerPalette = params.effectPaletteIsPlayerPalette ?? false
    this.effectOffset = params.effectOffset ?? null
    this.effectTracksActor = params.effectTracksActor ?? true
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// PlayerWithAllied — extended player stub with isAlliedWith for IsVisible
// ---------------------------------------------------------------------------

/** Minimal player interface needed by Cloak.IsVisible().
 *
 * OpenRA 对照: Player.IsAlliedWith(Player)
 */
interface IPlayerWithAllied extends PlayerStub {
  isAlliedWith?(viewer: PlayerStub): boolean
}

// ---------------------------------------------------------------------------
// ICloakWorld — world interface subset needed by Cloak for effects + detection
// ---------------------------------------------------------------------------

/** World interface subset used by Cloak.tick() and isVisible().
 *
 * OpenRA 对照: World.AddFrameEndTask() / World.Add() / World.ActorsWithTrait()
 *
 * @internal This is a local interface used to narrow the WorldStub type.
 */
interface ICloakWorld extends WorldStub {
  addFrameEndTask(action: () => void): void
  addEffect(effect: unknown): void
  actorsWithTrait<T>(interfaceName: string): readonly { actor: IGameActor; trait: T }[]
}

// ---------------------------------------------------------------------------
// ICloakedActor — actor interface subset for cloak detection
// ---------------------------------------------------------------------------

/** Actor interface subset used for DetectCloaked range checking.
 *
 * OpenRA 对照: Actor.CenterPosition / Actor.Owner
 *
 * @internal Local interface for type-safe center position access.
 */
interface IDetectableActor extends IGameActor {
  centerPosition: WPos
  owner: IPlayerWithAllied
}

// ---------------------------------------------------------------------------
// Cloak — stealth trait for game actors
// OpenRA 对照: Cloak : PausableConditionalTrait<CloakInfo>
// ---------------------------------------------------------------------------

/** This unit can cloak and uncloak in specific situations.
 *
 * OpenRA 对照: Cloak (PausableConditionalTrait<CloakInfo>,
 *   IRenderModifier, INotifyDamage, INotifyUnloadCargo, INotifyLoadCargo,
 *   INotifyDemolition, INotifyInfiltration, INotifyAttack, ITick,
 *   IVisibilityModifier, IRadarColorModifier, INotifyDockClient,
 *   INotifyDockHost, INotifySupportPower, ISync)
 *
 * Cloak maintains a countdown timer. When the timer reaches zero, the
 * actor becomes cloaked. Events that break cloak reset the timer.
 * While cloaked:
 * - A condition is granted (if configured)
 * - Sound and visual effects play on transition
 * - Renderable output is modified by cloak style
 * - Visibility is restricted to allies and detectors
 */
export class Cloak
  extends ConditionalTrait<CloakInfo>
  implements ITick, INotifyAttack, INotifyDamage, ISync
{
  // NOTE: IRenderModifier and IVisibilityModifier are intentionally NOT
  // listed in the implements clause. The modifyRender() and
  // modifyScreenBounds() methods are present as partial stubs
  // (TODO-12.A.4.8). isVisible() is fully implemented with
  // DetectCloaked integration (P1-C.5).

  // ----- Pre-computed color values for CloakStyle.Color -----

  /** Linear-space RGB for color tinting.
   *
   * OpenRA 对照: Cloak.cloakedColor (float3)
   */
  readonly _cloakedColorRgb: [number, number, number]

  /** Normalized alpha for color tinting.
   *
   * OpenRA 对照: Cloak.cloakedColorAlpha (float)
   */
  readonly _cloakedColorAlpha: number

  // ----- State -----

  /** Remaining ticks before actor becomes cloaked.
   *
   * OpenRA 对照: Cloak.remainingTime [VerifySync]
   */
  remainingTime: number

  /** Whether this actor is currently docking (pause countdown).
   *
   * OpenRA 对照: Cloak.isDocking
   */
  isDocking: boolean = false

  /** Other Cloak traits on the same actor with the same CloakType.
   *
   * OpenRA 对照: Cloak.otherCloaks (Cloak[])
   *
   * Multiple cloaks of the same type won't trigger redundant sounds/effects.
   */
  otherCloaks: readonly Cloak[] = []

  /** Last known cell position for detecting movement.
   *
   * OpenRA 对照: Cloak.lastPos (CPos?)
   */
  lastPos: unknown = null

  /** Whether the actor was cloaked on the previous tick.
   *
   * OpenRA 对照: Cloak.wasCloaked
   */
  wasCloaked: boolean = false

  /** True during the first tick (suppresses transition effects on spawn).
   *
   * OpenRA 对照: Cloak.firstTick
   */
  firstTick: boolean = true

  /** Condition token for the cloaked condition, or -1 if not granted.
   *
   * OpenRA 对照: Cloak.cloakedToken (int = Actor.InvalidConditionToken)
   */
  cloakedToken: number = -1 // Actor.InvalidConditionToken = -1

  constructor(info: CloakInfo) {
    super(info)
    this.remainingTime = info.initialDelay
    this._cloakedColorRgb = [
      info.cloakedColor.r / 255,
      info.cloakedColor.g / 255,
      info.cloakedColor.b / 255,
    ]
    this._cloakedColorAlpha = info.cloakedColor.a / 255
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Attach to an actor. Finds other cloaks of the same CloakType.
   *
   * OpenRA 对照: Cloak.Created(Actor self)
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)

    // Find other Cloak traits on this actor with the same CloakType
    if (this.info.cloakType !== null) {
      const allTraits = actor.traitsImplementing?.('Cloak') ?? []
      this.otherCloaks = allTraits.filter(
        (c): c is Cloak =>
          c !== this && c instanceof Cloak && c.info.cloakType === this.info.cloakType,
      )
    }

    // Grant condition if starting in cloaked state
    if (this.cloaked) {
      this.wasCloaked = true
      if (this.cloakedToken === -1 && this.info.cloakedCondition !== null) {
        this.cloakedToken = actor.grantCondition?.(this.info.cloakedCondition) ?? -1
      }
    }
  }

  /** Detach from actor. Clean up condition token.
   *
   * OpenRA 对照: N/A (C# uses IDisposable.Invalidate)
   */
  override detach(actor: IGameActor): void {
    if (this.cloakedToken !== -1) {
      actor.revokeCondition?.(this.cloakedToken)
      this.cloakedToken = -1
    }
    super.detach(actor)
  }

  // ---------------------------------------------------------------------------
  // Cloaked — computed property
  // OpenRA 对照: Cloak.Cloaked
  // ---------------------------------------------------------------------------

  /** Whether the actor is currently cloaked.
   *
   * OpenRA 对照: Cloak.Cloaked => !IsTraitDisabled && !IsTraitPaused && remainingTime <= 0
   */
  get cloaked(): boolean {
    return !this.isTraitDisabled && !this.isTraitPaused && this.remainingTime <= 0
  }

  // ---------------------------------------------------------------------------
  // Uncloak — force uncloak for a number of ticks
  // OpenRA 对照: Cloak.Uncloak() / Cloak.Uncloak(int time)
  // ---------------------------------------------------------------------------

  /** Force uncloak for the default cloak delay duration.
   *
   * OpenRA 对照: Cloak.Uncloak() => Uncloak(Info.CloakDelay)
   */
  uncloak(time?: number): void {
    this.remainingTime = Math.max(this.remainingTime, time ?? this.info.cloakDelay)
  }

  // ---------------------------------------------------------------------------
  // INotifyAttack — uncloak on attack
  // OpenRA 对照: INotifyAttack.Attacking() / INotifyAttack.PreparingAttack()
  // ---------------------------------------------------------------------------

  /** Called when actor is attacking. Uncloaks if Attack flag is set.
   *
   * OpenRA 对照: INotifyAttack.Attacking(Actor self, Target target, Armament a, Barrel barrel)
   */
  attacking(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    if ((this.info.uncloakOn & UncloakType.Attack) !== 0) {
      this.uncloak()
    }
  }

  /** Called before attack, when preparing. No action for cloak.
   *
   * OpenRA 对照: INotifyAttack.PreparingAttack() — empty
   */
  preparingAttack(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    // No action needed — cloak only breaks on actual attack
  }

  // ---------------------------------------------------------------------------
  // INotifyDamage — uncloak on damage/heal
  // OpenRA 对照: INotifyDamage.Damaged(Actor self, AttackInfo e)
  // ---------------------------------------------------------------------------

  /** Called when actor takes damage (or is healed). Uncloaks based on damage type.
   *
   * OpenRA 对照: INotifyDamage.Damaged(Actor self, AttackInfo e)
   */
  damaged(self: IGameActor, attackInfo: AttackInfo): void {
    if (attackInfo.damage.value === 0) return

    const type = attackInfo.damage.value < 0
      ? (attackInfo.attacker === self ? UncloakType.SelfHeal : UncloakType.Heal)
      : UncloakType.Damage

    if ((this.info.uncloakOn & type) !== 0) {
      this.uncloak()
    }
  }

  // ---------------------------------------------------------------------------
  // ITick — advance cloak timer, handle state transitions
  // OpenRA 对照: ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /** Tick: decrement remainingTime, check state transitions.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * On cloaked/uncloaked transitions, plays sound (TODO: full Sound integration)
   * and creates a SpriteEffect at the actor's CenterPosition with EffectOffset.
   *
   * @param self — the actor this trait is attached to
   */
  tick(self: IGameActor): void {
    if (!this.isTraitDisabled && !this.isTraitPaused) {
      if (this.remainingTime > 0 && !this.isDocking) {
        this.remainingTime--
      }

      if ((this.info.uncloakOn & UncloakType.Move) !== 0) {
        const currentLocation = (self as unknown as { location?: unknown }).location
        // NOTE: Uses reference comparison (!==). If the actor's location
        // property returns a new object each access (not a stable reference),
        // this will trigger uncloak every tick. The assumption is that
        // GameActor.location returns a stable reference that only changes
        // when the actor actually moves. If this assumption is violated,
        // switch to value comparison (compare U and V fields).
        if (this.lastPos === null || this.lastPos !== currentLocation) {
          this.uncloak()
          this.lastPos = currentLocation
        }
      }
    }

    const isCloaked = this.cloaked

    if (isCloaked && !this.wasCloaked) {
      // Just became cloaked — grant condition
      if (this.cloakedToken === -1 && this.info.cloakedCondition !== null) {
        this.cloakedToken = self.grantCondition?.(this.info.cloakedCondition) ?? -1
      }

      // Sound + SpriteEffect on cloak transition (P1-C.4)
      this._doCloakTransition(self)
    } else if (!isCloaked && this.wasCloaked) {
      // Just became uncloaked — revoke condition
      if (this.cloakedToken !== -1) {
        self.revokeCondition?.(this.cloakedToken)
        this.cloakedToken = -1
      }

      // Sound + SpriteEffect on uncloak transition (P1-C.4)
      this._doUncloakTransition(self)
    }

    this.wasCloaked = isCloaked
    this.firstTick = false
  }

  // ---------------------------------------------------------------------------
  // _doCloakTransition — sound + visual effect on entering cloak
  // OpenRA 对照: Cloak.Tick() cloak transition block (lines 236-254)
  // ---------------------------------------------------------------------------

  /** Play sound and create SpriteEffect on cloak transition.
   *
   * OpenRA 对照: ITick.Tick() cloak transition block
   *
   * Conditions for playing effects:
   * 1. Not the first tick with zero initialDelay (suppress on spawn-in-cloaked)
   * 2. No other cloaks of same CloakType are currently cloaked (avoid duplicate effects)
   *
   * @param self — the actor this trait is attached to
   */
  private _doCloakTransition(self: IGameActor): void {
    // Suppress effects on initial spawn with 0 delay
    if (this.firstTick && this.info.initialDelay === 0) return

    // Don't play redundant effects if another cloak of same type is cloaked
    if (this.otherCloaks.length > 0 && this.otherCloaks.some(a => a.cloaked)) return

    // Sound: TODO — full Sound system integration required
    // OpenRA: Game.Sound.Play(SoundType.World, Info.CloakSound, self.CenterPosition)
    // NOTE: Sound playback requires Game.Sound singleton (future Phase D/E engine
    // integration). SpriteEffect rendering depends on P1-B.1 (AnimationStub replacement).
    // When Sound.ts singleton is available, uncomment:
    //   Game.Sound.play(SoundType.World, this.info.cloakSound, centerPos)

    // SpriteEffect
    if (this.info.effectImage !== null && this.info.cloakEffectSequence !== null) {
      this._spawnCloakEffect(self, this.info.cloakEffectSequence)
    }
  }

  // ---------------------------------------------------------------------------
  // _doUncloakTransition — sound + visual effect on exiting cloak
  // OpenRA 对照: Cloak.Tick() uncloak transition block (lines 262-280)
  // ---------------------------------------------------------------------------

  /** Play sound and create SpriteEffect on uncloak transition.
   *
   * OpenRA 对照: ITick.Tick() uncloak transition block
   *
   * Same suppression conditions as cloak transition:
   * 1. Not first tick with zero initialDelay
   * 2. No other cloaks of same CloakType are currently cloaked
   *
   * @param self — the actor this trait is attached to
   */
  private _doUncloakTransition(self: IGameActor): void {
    // Suppress effects on initial spawn with 0 delay
    if (this.firstTick && this.info.initialDelay === 0) return

    // Don't play redundant effects if another cloak of same type is cloaked
    if (this.otherCloaks.length > 0 && this.otherCloaks.some(a => a.cloaked)) return

    // Sound: TODO — full Sound system integration required
    // OpenRA: Game.Sound.Play(SoundType.World, Info.UncloakSound, pos)
    // NOTE: Sound playback requires Game.Sound singleton (future Phase D/E engine
    // integration). SpriteEffect rendering depends on P1-B.1 (AnimationStub replacement).

    // SpriteEffect
    if (this.info.effectImage !== null && this.info.uncloakEffectSequence !== null) {
      this._spawnCloakEffect(self, this.info.uncloakEffectSequence)
    }
  }

  // ---------------------------------------------------------------------------
  // _spawnCloakEffect — create SpriteEffect and schedule it for addition
  // OpenRA 对照: World.AddFrameEndTask(w => w.Add(new SpriteEffect(...)))
  // ---------------------------------------------------------------------------

  /** Create a SpriteEffect at the actor's position and add it to the world.
   *
   * OpenRA 对照: new SpriteEffect(posfunc, () => WAngle.Zero, w, image, sequence, palette)
   *
   * If EffectTracksActor is true, the effect follows the actor (dynamic position).
   * Otherwise, the effect is created at a static snapshot of the actor's position.
   *
   * @param self — the actor this trait is attached to
   * @param sequence — animation sequence name (CloakEffectSequence or UncloakEffectSequence)
   */
  private _spawnCloakEffect(self: IGameActor, sequence: string): void {
    const world = self.world as ICloakWorld | undefined
    if (!world) return

    // Capture actor reference for position computation
    const actor = self as unknown as { centerPosition?: WPos }
    const offset = this.info.effectOffset ?? WVec.Zero

    // Compute palette name
    let palette = this.info.effectPalette
    if (this.info.effectPaletteIsPlayerPalette) {
      const owner = self.owner as IPlayerWithAllied | undefined
      palette += owner?.playerName ?? ''
    }

    // NOTE: SpriteEffect dynamically imported to avoid circular dependency.
    // The effect is created inside the frameEndTask so it has access to the
    // resolved world reference.
    world.addFrameEndTask(() => {
      // Determine position strategy based on EffectTracksActor
      const tracksActor = this.info.effectTracksActor

      // Compute the position snapshot at frame-end for static effects
      const staticPos = actor.centerPosition
        ? WPos.add(actor.centerPosition, offset)
        : undefined

      if (tracksActor && actor.centerPosition) {
        // Dynamic position: follows actor each tick
        const posFunc = () => WPos.add(actor.centerPosition!, offset)
        const effect = this._createEffect(world, posFunc, () => WAngle.Zero, palette, sequence)
        if (effect) world.addEffect(effect)
      } else if (staticPos) {
        // Static position: snapshot at frame-end time
        const effect = this._createEffectStatic(world, staticPos, palette, sequence)
        if (effect) world.addEffect(effect)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // _createEffect — construct a SpriteEffect (dynamic position, used when tracking)
  // ---------------------------------------------------------------------------

  /** Create a SpriteEffect with a dynamic position provider.
   *
   * @param world — the game world
   * @param posFunc — position provider function
   * @param facingFunc — facing provider function
   * @param palette — palette name
   * @param sequence — animation sequence name
   * @returns SpriteEffect or null if creation fails
   *
   * NOTE: Uses dynamic import pattern to avoid circular dependency with
   * SpriteEffect module. At runtime this will resolve to the actual class.
   */
  private _createEffect(
    _world: ICloakWorld,
    _posFunc: () => WPos,
    _facingFunc: () => WAngle,
    _palette: string,
    _sequence: string,
  ): unknown {
    // NOTE: Full SpriteEffect construction requires GameWorldManager
    // (type that extends WorldStub). When the world reference is the actual
    // GameWorldManager at runtime, this will work. For now, we use a
    // duck-typed approach that constructs a compatible effect object.
    //
    // C# equivalent:
    //   new SpriteEffect(posfunc, () => WAngle.Zero, w, Info.EffectImage,
    //     sequence, palette, visibleThroughFog: false, delay: 0)
    //
    // When SpriteEffect full integration is ready, replace with:
    //   import { SpriteEffect } from '../Effects/SpriteEffect.js'
    //   return SpriteEffect.createDynamic(world, posFunc, facingFunc,
    //     this.info.effectImage!, sequence, palette)

    // Stub: Create a minimal effect-like object that can be added to the world.
    // This implements the IGameEffect contract expected by GameWorldManager.addEffect.
    const effect = {
      tick: () => { /* Animation.tick() — deferred to full Animation integration */ },
      render: () => [],
      dispose: () => {},
      pos: _posFunc(),
      initialized: true,
      isActive: true,
      image: this.info.effectImage,
      sequence: _sequence,
      palette: _palette,
    }
    return effect
  }

  // ---------------------------------------------------------------------------
  // _createEffectStatic — construct a SpriteEffect (static position, used when NOT tracking)
  // ---------------------------------------------------------------------------

  /** Create a SpriteEffect at a fixed position.
   *
   * @param world — the game world
   * @param pos — fixed world position
   * @param palette — palette name
   * @param sequence — animation sequence name
   * @returns SpriteEffect or null if creation fails
   */
  private _createEffectStatic(
    _world: ICloakWorld,
    pos: WPos,
    _palette: string,
    _sequence: string,
  ): unknown {
    // NOTE: Same duck-typed approach as _createEffect, but with static position.
    // When SpriteEffect full integration is ready, replace with:
    //   return SpriteEffect.createWithFacing(world, pos, WAngle.Zero,
    //     this.info.effectImage!, sequence, palette)

    const effect = {
      tick: () => {},
      render: () => [],
      dispose: () => {},
      pos,
      initialized: true,
      isActive: true,
      image: this.info.effectImage,
      sequence: _sequence,
      palette: _palette,
    }
    return effect
  }

  // ---------------------------------------------------------------------------
  // TraitEnabled / TraitDisabled — condition lifecycle
  // OpenRA 对照: PausableConditionalTrait.TraitEnabled() / TraitDisabled()
  // ---------------------------------------------------------------------------

  /** When trait is re-enabled, reset remainingTime to InitialDelay.
   *
   * OpenRA 对照: Cloak.TraitEnabled(Actor self)
   */
  protected override traitEnabled(_self: IGameActor): void {
    super.traitEnabled(_self)
    this.remainingTime = this.info.initialDelay
  }

  /** When trait is disabled, force uncloak.
   *
   * OpenRA 对照: Cloak.TraitDisabled(Actor self)
   */
  protected override traitDisabled(_self: IGameActor): void {
    this.uncloak()
    super.traitDisabled(_self)
  }

  // ---------------------------------------------------------------------------
  // IsVisible — visibility check for a viewer
  // OpenRA 对照: Cloak.IsVisible(Actor self, Player viewer)
  // ---------------------------------------------------------------------------

  /** Check whether this actor is visible to the given viewer.
   *
   * OpenRA 对照: Cloak.IsVisible(Actor self, Player viewer)
   *
   * An actor is visible if:
   * 1. It is not currently cloaked, OR
   * 2. The viewer is allied with the owner
   *
   * Otherwise, the actor is only visible if a DetectCloaked unit belonging
   * to the viewer (or an ally) has a matching detection type and is within
   * detection range of the cloaked actor.
   *
   * @param self — the actor this trait is attached to
   * @param viewer — the player whose perspective we check
   * @returns true if the actor is visible to the viewer
   */
  isVisible(self: IGameActor, viewer: PlayerStub): boolean {
    if (!this.cloaked) return true

    const owner = self.owner as IPlayerWithAllied | undefined
    if (owner?.isAlliedWith?.(viewer)) return true

    // Check for allied DetectCloaked units in detection range (P1-C.5)
    return this._isDetectedByAllied(self, viewer)
  }

  // ---------------------------------------------------------------------------
  // _isDetectedByAllied — check if any allied detector can see this actor
  // OpenRA 对照: Cloak.IsVisible() detection block (line 299-301)
  // ---------------------------------------------------------------------------

  /** Check if any allied DetectCloaked unit can reveal this actor.
   *
   * OpenRA 对照:
   * ```
   * self.World.ActorsWithTrait<DetectCloaked>().Any(a =>
   *   a.Actor.IsInWorld &&
   *   a.Actor.Owner.IsAlliedWith(viewer) &&
   *   Info.DetectionTypes.Overlaps(a.Trait.Info.DetectionTypes) &&
   *   (self.CenterPosition - a.Actor.CenterPosition).LengthSquared <= a.Trait.Range.LengthSquared);
   * ```
   *
   * @param self — the cloaked actor
   * @param viewer — the player whose detection capability we check
   * @returns true if a matching detector is in range
   */
  private _isDetectedByAllied(self: IGameActor, viewer: PlayerStub): boolean {
    const world = self.world as ICloakWorld | undefined
    if (!world || !world.actorsWithTrait) return false

    // Get the cloaked actor's center position
    const selfPos = (self as unknown as IDetectableActor).centerPosition
    if (!selfPos) return false

    // Query all actors with DetectCloaked trait
    // NOTE: Currently uses full trait iteration (O(n) in detector count). For large
    // numbers of detector units, consider using ScreenMap spatial index for range-based
    // query. Acceptable for typical RTS games with <20 detector units.
    const pairs = world.actorsWithTrait<{
      info: { detectionTypes: readonly DetectionType[] }
      range: WDist
    }>('DetectCloaked')

    for (const pair of pairs) {
      const detector = pair.actor as IDetectableActor
      if (!detector.isInWorld) continue
      if (!detector.owner?.isAlliedWith?.(viewer)) continue

      const trait = pair.trait
      const detectionRange = trait.range
      if (detectionRange.length === 0) continue

      // Check detection type overlap: CloakInfo.detectionTypes (string[])
      // must overlap with DetectCloakedInfo.detectionTypes (DetectionType[])
      const cloakTypes = this.info.detectionTypes
      const detectTypes = trait.info.detectionTypes
      if (!Cloak._detectionTypesOverlap(cloakTypes, detectTypes)) continue

      // Check range: distance between actor centers <= detection range
      const detectorPos = detector.centerPosition
      if (!detectorPos) continue

      const delta = WPos.subtract(selfPos, detectorPos)
      if (delta.lengthSquared <= detectionRange.length * detectionRange.length) {
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // _detectionTypesOverlap — check if two detection type lists have any match
  // OpenRA 对照: BitSet<DetectionType>.Overlaps()
  // ---------------------------------------------------------------------------

  /** Check if any detection type name in the cloak config matches any
   * detection type name in the detector config.
   *
   * OpenRA 对照: Info.DetectionTypes.Overlaps(a.Trait.Info.DetectionTypes)
   *
   * CloakInfo.detectionTypes is string[] — the type tags this cloak belongs to.
   * DetectCloakedInfo.detectionTypes is DetectionType[] — the types this detector can reveal.
   * A match means at least one name exists in both lists.
   *
   * @param cloakTypes — detection type names from the cloak trait
   * @param detectTypes — detection type objects from the detector trait
   * @returns true if at least one type name is common to both
   */
  static _detectionTypesOverlap(
    cloakTypes: readonly string[],
    detectTypes: readonly DetectionType[],
  ): boolean {
    if (cloakTypes.length === 0 || detectTypes.length === 0) return false
    const detectNames = new Set(detectTypes.map(d => d.name))
    return cloakTypes.some(t => detectNames.has(t))
  }

  // ---------------------------------------------------------------------------
  // ModifyRender — apply cloak visual effect to renderables
  // OpenRA 对照: IRenderModifier.ModifyRender()
  // ---------------------------------------------------------------------------

  /** Apply cloak visual effect to renderables.
   *
   * OpenRA 对照: IRenderModifier.ModifyRender(Actor self, WorldRenderer wr, IEnumerable<IRenderable> r)
   *
   * TODO-12.A.4.8: Implement Alpha/Color/Palette renderable modification.
   * When remainingTime > 0 or trait is disabled/paused: return renderables unchanged.
   * When cloaked and visible to render player: apply Alpha/Color/Palette style.
   * When cloaked and NOT visible to render player: return empty (hide actor).
   *
   * @param _self — the actor
   * @param _wr — the world renderer
   * @param r — the renderable inputs
   * @returns modified renderables
   */
  modifyRender(
    _self: IGameActor,
    _wr: unknown,
    r: readonly unknown[],
  ): readonly unknown[] {
    if (this.remainingTime > 0 || this.isTraitDisabled || this.isTraitPaused) {
      return r
    }

    // TODO-12.A.4.8: Full ModifyRender implementation
    // if (Cloaked && IsVisible(self, self.World.RenderPlayer)) {
    //   switch (Info.CloakStyle) {
    //     case CloakStyle.Alpha: return r.Select(a => a.WithAlpha(Info.CloakedAlpha));
    //     case CloakStyle.Color: return r.Select(a => a.WithTint(cloakedColor, ...).WithAlpha(cloakedColorAlpha));
    //     case CloakStyle.Palette: return r.Select(a => a.WithPalette(palette));
    //   }
    // }
    // return SpriteRenderable.None;

    return r
  }

  // ---------------------------------------------------------------------------
  // ModifyScreenBounds — pass through screen bounds
  // OpenRA 对照: IRenderModifier.ModifyScreenBounds()
  // ---------------------------------------------------------------------------

  /** Pass through screen bounds unchanged.
   *
   * OpenRA 对照: IRenderModifier.ModifyScreenBounds(Actor self, WorldRenderer wr, IEnumerable<Rectangle> bounds)
   */
  modifyScreenBounds(
    _self: IGameActor,
    _wr: unknown,
    bounds: readonly unknown[],
  ): readonly unknown[] {
    return bounds
  }
}
