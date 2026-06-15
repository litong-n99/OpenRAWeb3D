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
 * - C# event Action<PPos> OnShroudChanged → TS callback pattern (deferred)
 * - C# Sound/SpriteEffect in Tick() → deferred (TODO-12.DEFERRED.15/16)
 *
 * Deferred features:
 * - TODO-12.A.4.2:  INotifyDockClient / INotifyDockHost (dock uncloak)
 * - TODO-12.A.4.3:  INotifyLoadCargo (load uncloak)
 * - TODO-12.A.4.4:  INotifyUnloadCargo (unload uncloak)
 * - TODO-12.A.4.5:  INotifyDemolition (demolish uncloak)
 * - TODO-12.A.4.6:  INotifyInfiltration (infiltrate uncloak)
 * - TODO-12.A.4.7:  IRadarColorModifier + INotifySupportPower
 * - TODO-12.A.4.8:  ModifyRender visual effects (Alpha/Color/Palette renderable wrapping)
 * - TODO-12.DEFERRED.15: SpriteEffect visual effect generation on cloak/uncloak
 * - TODO-12.DEFERRED.16: DetectCloaked integration in IsVisible
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
  type ISync,
  type PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type INotifyAttack,
  type Barrel,
} from './CombatInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { WVec } from '../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// INotifyDamage — imported from TraitsInterfaces for use by Cloak
// ---------------------------------------------------------------------------

import {
  type INotifyDamage,
  type AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

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
   * TODO-12.DEFERRED.16: Detection type matching with DetectCloaked
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
  // (TODO-12.A.4.8) and isVisible() relies on TODO-12.DEFERRED.16 for
  // full DetectCloaked integration. Declaring these interfaces now would
  // create a misleading contract. They should be added once the stubs are
  // fully implemented.

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

      // TODO-12.DEFERRED.15: Sound + SpriteEffect on cloak transition
      // C# plays cloakSound and creates SpriteEffect with CloakEffectSequence
      // if (!(firstTick && Info.InitialDelay == 0) && (otherCloaks == null || !otherCloaks.Any(a => a.Cloaked)))
      // {
      //   Game.Sound.Play(SoundType.World, Info.CloakSound, self.CenterPosition);
      //   self.World.AddFrameEndTask(w => w.Add(new SpriteEffect(...)));
      // }
    } else if (!isCloaked && this.wasCloaked) {
      // Just became uncloaked — revoke condition
      if (this.cloakedToken !== -1) {
        self.revokeCondition?.(this.cloakedToken)
        this.cloakedToken = -1
      }

      // TODO-12.DEFERRED.15: Sound + SpriteEffect on uncloak transition
      // C# plays uncloakSound and creates SpriteEffect with UncloakEffectSequence
      // if (!(firstTick && Info.InitialDelay == 0) && (otherCloaks == null || !otherCloaks.Any(a => a.Cloaked)))
      // {
      //   Game.Sound.Play(SoundType.World, Info.UncloakSound, self.CenterPosition);
      //   self.World.AddFrameEndTask(w => w.Add(new SpriteEffect(...)));
      // }
    }

    this.wasCloaked = isCloaked
    this.firstTick = false
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
   * However, a cloaked enemy actor is only visible to the viewer if
   * a DetectCloaked unit belonging to the viewer (or an ally) is within
   * detection range.
   *
   * TODO-12.DEFERRED.16: Full DetectCloaked integration
   *
   * @param self — the actor this trait is attached to
   * @param viewer — the player whose perspective we check
   * @returns true if the actor is visible to the viewer
   */
  isVisible(self: IGameActor, viewer: PlayerStub): boolean {
    if (!this.cloaked) return true

    const owner = self.owner as IPlayerWithAllied | undefined
    if (owner?.isAlliedWith?.(viewer)) return true

    // TODO-12.DEFERRED.16: Check for allied DetectCloaked units in range
    // In C#:
    // return self.World.ActorsWithTrait<DetectCloaked>().Any(a =>
    //   a.Actor.IsInWorld &&
    //   a.Actor.Owner.IsAlliedWith(viewer) &&
    //   Info.DetectionTypes.Overlaps(a.Trait.Info.DetectionTypes) &&
    //   (self.CenterPosition - a.Actor.CenterPosition).LengthSquared <= a.Trait.Range.LengthSquared);
    return false
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
