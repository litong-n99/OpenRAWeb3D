/**
 * NukeLaunch.ts — 核弹发射抛射体（多阶段飞行：上升 → 下降 → 引爆）
 * OpenRA 对照: OpenRA.Mods.Common/Effects/NukeLaunch.cs
 *
 * 核心范式转换:
 * - C# NukeLaunch(IProjectile, ISpatiallyPartitionable) → TypeScript 同接口
 * - C# WPos.LerpQuadratic → TypeScript 相同插值
 * - C# 独立构造参数 → NukeLaunchConfig 专用接口
 * - C# SpriteEffect trail → deferred TODO marker (MAJOR 10)
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type {
  WorldRendererStub,
  IRenderable,
  PlayerStub,
  IGameActor,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ISpatiallyPartitionable } from '../../OpenRA.Game/Effects/IEffect.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import {
  type IProjectile,
  type WeaponStub,
  type WarheadArgsStub,
} from './Bullet.js'

// ---------------------------------------------------------------------------
// NukeLaunchConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for the NukeLaunch projectile.
 *
 * OpenRA 对照: NukeLaunch constructor parameters
 */
export interface NukeLaunchConfig {
  /** The player that fired this nuke. */
  firedBy: PlayerStub
  /** Sprite image for the nuke visual. */
  image: string | null
  /** The weapon to impact on detonation. */
  weapon: WeaponStub
  /** Palette for weapon rendering. */
  weaponPalette: string
  /** Sequence name for ascent animation. */
  upSequence: string
  /** Sequence name for descent animation. */
  downSequence: string
  /** Launch position. */
  launchPos: WPos
  /** Target position (detonation point). */
  targetPos: WPos
  /** Altitude above target at which to detonate. */
  detonationAltitude: WDist
  /** Whether to remove the projectile from world on detonation. */
  removeOnDetonation: boolean
  /** Vertical velocity (ascent/descent). */
  velocity: WDist
  /** Delay before launch (ticks). */
  launchDelay: number
  /** Total flight time (ticks). */
  impactDelay: number
  /** Skip ascent phase (start at apex). */
  skipAscent: boolean
  /** Trail smoke image. */
  trailImage: string | null
  /** Trail smoke animation sequences. */
  trailSequences: readonly string[]
  /** Palette for trail rendering. */
  trailPalette: string
  /** Whether trail uses player palette. */
  trailUsePlayerPalette: boolean
  /** Delay before trail spawns. */
  trailDelay: number
  /** Interval between trail particles. */
  trailInterval: number
}

export function defaultNukeLaunchConfig(overrides?: Partial<NukeLaunchConfig>): NukeLaunchConfig {
  return {
    firedBy: {} as PlayerStub,
    image: null,
    weapon: { impact: () => {} } as unknown as WeaponStub,
    weaponPalette: 'effect',
    upSequence: 'up',
    downSequence: 'down',
    launchPos: new WPos(0, 0, 0),
    targetPos: new WPos(0, 0, 0),
    detonationAltitude: WDist.Zero,
    removeOnDetonation: true,
    velocity: new WDist(0),
    launchDelay: 0,
    impactDelay: 0,
    skipAscent: false,
    trailImage: null,
    trailSequences: ['idle'],
    trailPalette: 'effect',
    trailUsePlayerPalette: false,
    trailDelay: 0,
    trailInterval: 2,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// NukeLaunch class
// ---------------------------------------------------------------------------

export class NukeLaunch implements IProjectile, ISpatiallyPartitionable {
  readonly config: NukeLaunchConfig
  readonly ascendSource: WPos
  readonly ascendTarget: WPos
  readonly descendSource: WPos
  readonly descendTarget: WPos
  readonly turn: number
  pos: WPos
  ticks: number
  trailTicks: number
  launchDelayRemaining: number
  isLaunched: boolean
  detonated: boolean
  isDestroyed: boolean

  constructor(config: NukeLaunchConfig) {
    this.config = config
    this.ticks = 0
    this.launchDelayRemaining = config.launchDelay
    this.isLaunched = false
    this.detonated = false
    this.isDestroyed = false
    this.trailTicks = config.trailDelay

    this.turn = config.skipAscent ? 0 : Math.trunc(config.impactDelay / 2)

    const offset = new WVec(0, 0, config.velocity.length * (config.impactDelay - this.turn))
    this.ascendSource = config.launchPos
    this.ascendTarget = WPos.add(config.launchPos, offset)
    this.descendSource = WPos.add(config.targetPos, offset)
    this.descendTarget = config.targetPos

    this.pos = config.skipAscent ? this.descendSource : this.ascendSource
  }

  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    if (this.launchDelayRemaining-- > 0) return

    if (!this.isLaunched) {
      this.isLaunched = true
    }

    const isDescending = this.ticks >= this.turn

    if (!isDescending) {
      this.pos = WPos.lerpQuadratic(
        this.ascendSource, this.ascendTarget, WAngle.Zero,
        this.ticks, this.turn > 0 ? this.turn : 1,
      )
    } else {
      const descentTicks = this.config.impactDelay - this.turn
      this.pos = WPos.lerpQuadratic(
        this.descendSource, this.descendTarget, WAngle.Zero,
        this.ticks - this.turn, descentTicks > 0 ? descentTicks : 1,
      )
    }

    if (
      this.config.trailImage !== null && this.config.trailImage.length > 0 &&
      --this.trailTicks < 0
    ) {
      // TODO-8.B.10-EFFECTS: SpriteEffect trail smoke — deferred visual effect
      // OpenRA 对照: NukeLaunch creates SpriteEffect trail particles
      // Requires Animation + World context integration.
      this.trailTicks = this.config.trailInterval
    }

    const shouldDetonate =
      this.ticks >= this.config.impactDelay ||
      (isDescending && this._isBelowDetonationAltitude())

    if (shouldDetonate) {
      this._explode(world, this.ticks >= this.config.impactDelay || this.config.removeOnDetonation)
    }

    this.ticks++
  }

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true }

  get fractionComplete(): number {
    if (this.config.impactDelay <= 0) return 0
    return this.ticks / this.config.impactDelay
  }

  private _explode(world: GameWorldManager, removeProjectile: boolean): void {
    if (removeProjectile) {
      world.addFrameEndTask(() => { world.removeEffect(this) })
    }

    if (this.detonated) return

    const target = Target.fromPos(this.pos)
    const warheadArgs: WarheadArgsStub = {
      firedBy: this.config.firedBy as unknown as IGameActor,
      facing: WAngle.Zero,
      impactOrientation: new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero),
      impactPosition: this.pos,
      weapon: this.config.weapon,
    }

    this.config.weapon.impact(target, warheadArgs)
    this.detonated = true
  }

  private _isBelowDetonationAltitude(): boolean {
    return this.pos.Z <= this.config.targetPos.Z + this.config.detonationAltitude.length
  }
}

export const NukeLaunchFactory = {
  create(config: NukeLaunchConfig): NukeLaunch {
    return new NukeLaunch(config)
  },
}
