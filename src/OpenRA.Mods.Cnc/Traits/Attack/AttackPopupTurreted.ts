/**
 * AttackPopupTurreted.ts — 弹出式炮塔攻击（地下隐藏→升起→攻击→降下）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Attack/AttackPopupTurreted.cs (135 lines)
 *
 * 核心范式转换:
 * - C# AttackPopupTurreted : AttackTurreted, INotifyIdle, IDamageModifier → TS
 * - C# enum PopupState {Open, Rotating, Transitioning, Closed} → TS const object state machine
 * - C# WithSpriteBody.PlayCustomAnimation → TS duck-typed sprite body access
 * - C# Turreted.FaceTarget → TS duck-typed turret trait
 * - C# IDamageModifier.GetDamageModifier → TS damage modifier interface
 * - C# Target.FromPos(self.CenterPosition + facingOffset) → TS WPos arithmetic
 * - 3D: turret mesh Y-axis animation (hidden below ground → emerge → hide)
 */

import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import { Target as TargetClass } from '../../../OpenRA.Game/Traits/Target.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  AttackTurreted,
  AttackTurretedInfo,
} from '../../../OpenRA.Mods.Common/Traits/Attack/AttackTurreted.js'

// ---------------------------------------------------------------------------
// PopupState enum
// OpenRA 对照: AttackPopupTurreted.PopupState
// ---------------------------------------------------------------------------

export const PopupState = {
  Open: 0,
  Rotating: 1,
  Transitioning: 2,
  Closed: 3,
} as const
export type PopupState = (typeof PopupState)[keyof typeof PopupState]

// ---------------------------------------------------------------------------
// AttackPopupTurretedInfo
// OpenRA 对照: AttackPopupTurretedInfo : AttackTurretedInfo,
//              Requires<BuildingInfo>, Requires<WithEmbeddedTurretSpriteBodyInfo>
// ---------------------------------------------------------------------------

export class AttackPopupTurretedInfo extends AttackTurretedInfo {
  readonly closeDelay: number = 125
  readonly defaultFacing: WAngle = WAngle.Zero
  readonly closedDamageMultiplier: number = 50
  readonly openingSequence: string = 'opening'
  readonly closingSequence: string = 'closing'
  readonly closedIdleSequence: string = 'closed-idle'
  readonly body: string = 'body'

  constructor(
    params: Partial<AttackPopupTurretedInfo> &
      ConstructorParameters<typeof AttackTurretedInfo>[0] = {},
  ) {
    super(params)
    this.closeDelay = params.closeDelay ?? 125
    this.defaultFacing =
      params.defaultFacing instanceof WAngle
        ? params.defaultFacing
        : WAngle.Zero
    this.closedDamageMultiplier = params.closedDamageMultiplier ?? 50
    this.openingSequence = params.openingSequence ?? 'opening'
    this.closingSequence = params.closingSequence ?? 'closing'
    this.closedIdleSequence = params.closedIdleSequence ?? 'closed-idle'
    this.body = params.body ?? 'body'
  }
}

// ---------------------------------------------------------------------------
// WithSpriteBody duck-type (for type safety)
// ---------------------------------------------------------------------------

interface WithSpriteBodyStub {
  info?: { sequence?: string; name?: string }
  playCustomAnimationRepeating(s: IGameActor, seq: string): void
  playCustomAnimation(s: IGameActor, seq: string, cb: () => void): void
}

interface TurretedStub {
  faceTarget(s: IGameActor, t: TargetType_): void
  hasAchievedDesiredFacing?: boolean
}

// ---------------------------------------------------------------------------
// AttackPopupTurreted
// OpenRA 对照: AttackPopupTurreted : AttackTurreted, INotifyIdle, IDamageModifier
// ---------------------------------------------------------------------------

/**
 * Turret attack with pop-up/down animation. The turret remains hidden
 * underground when idle, emerges when a target is found, and hides
 * again after a period of inactivity.
 *
 * OpenRA 对照: AttackPopupTurreted
 */
export class AttackPopupTurreted extends AttackTurreted {
  readonly info: AttackPopupTurretedInfo

  private state: PopupState = PopupState.Open
  private idleTicks: number = 0
  private skippedMakeAnimation: boolean = false
  private wsb: WithSpriteBodyStub | null = null
  private turret: TurretedStub | null = null

  constructor(
    init: { self: IGameActor; contains?: (_info: unknown) => boolean },
    info: AttackPopupTurretedInfo,
  ) {
    super(info)
    this.info = info

    const self = init.self as unknown as {
      traitsImplementing?: <T>(_name: string) => T[]
    }

    // Find the WithSpriteBody matching info.body
    const spriteBodies =
      self.traitsImplementing?.<WithSpriteBodyStub>('WithSpriteBody') ?? []

    const found = spriteBodies.find((w) => w.info?.name === info.body)
    this.wsb = found ?? null

    // Find the first Turreted trait
    const turretTraits =
      self.traitsImplementing?.<TurretedStub>('Turreted') ?? []
    this.turret = turretTraits[0] ?? null

    this.skippedMakeAnimation =
      init.contains?.(info as unknown as never) ?? false
  }

  // ---------------------------------------------------------------------------
  // Created — handle map-placed actors (start in Closed state)
  // ---------------------------------------------------------------------------

  override onCreated(self: IGameActor): void {
    super.onCreated(self)

    if (this.skippedMakeAnimation) {
      this.state = PopupState.Closed
      this.wsb?.playCustomAnimationRepeating(self, this.info.closedIdleSequence)
      this.turret?.faceTarget(self, TargetClass.Invalid as TargetType_)
    }
  }

  // ---------------------------------------------------------------------------
  // CanAttack — open turret if closed
  // ---------------------------------------------------------------------------

  override canAttack(self: IGameActor, target: TargetType_): boolean {
    // NOTE: isTraitPaused guards weapon usage when trait is enabled but
    // has no ammo or is otherwise unable to act (e.g., PauseOnCondition).
    // Differs from isTraitDisabled which indicates the trait itself is inactive.
    // OpenRA 对照: if (IsTraitPaused) return false
    if (this.isTraitDisabled || this.isTraitPaused) return false

    if (this.state === PopupState.Closed) {
      this.state = PopupState.Transitioning
      this.wsb?.playCustomAnimation(self, this.info.openingSequence, () => {
        this.state = PopupState.Open
        this.wsb?.playCustomAnimationRepeating(
          self,
          this.wsb?.info?.sequence ?? '',
        )
      })
      this.idleTicks = 0
    }

    if (this.state === PopupState.Transitioning || !super.canAttack(self, target)) {
      return false
    }

    this.idleTicks = 0
    return true
  }

  // ---------------------------------------------------------------------------
  // TickIdle — close turret after idle timeout
  // ---------------------------------------------------------------------------

  tickIdle(self: IGameActor): void {
    if (this.isTraitDisabled) return

    if (this.state === PopupState.Open && ++this.idleTicks > this.info.closeDelay) {
      // Start rotating to default facing
      const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition
      if (centerPos) {
        const facingWVec = new WVec(0, -1024, 0)
        const rotatedOffset = facingWVec.rotate(
          WRot.fromYaw(this.info.defaultFacing),
        )
        const targetPos = new WPos(
          centerPos.X + rotatedOffset.X,
          centerPos.Y + rotatedOffset.Y,
          centerPos.Z + rotatedOffset.Z,
        )
        this.turret?.faceTarget(
          self,
          TargetClass.fromPos(targetPos) as unknown as TargetType_,
        )
      }
      this.state = PopupState.Rotating
    } else if (
      this.state === PopupState.Rotating &&
      this.turret?.hasAchievedDesiredFacing
    ) {
      this.state = PopupState.Transitioning
      this.wsb?.playCustomAnimation(self, this.info.closingSequence, () => {
        this.state = PopupState.Closed
        this.wsb?.playCustomAnimationRepeating(
          self,
          this.info.closedIdleSequence,
        )
        this.turret?.faceTarget(self, TargetClass.Invalid as TargetType_)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // GetDamageModifier — reduced damage when closed
  // ---------------------------------------------------------------------------

  getDamageModifier(): number {
    return this.state === PopupState.Closed
      ? this.info.closedDamageMultiplier
      : 100
  }

  getState(): PopupState {
    return this.state
  }

  getIdleTicks(): number {
    return this.idleTicks
  }
}
