/**
 * UtilityActivityInterfaces.ts — Phase F 鸭子类型接口
 *
 * 为 Phase F 活动 (Wait/RemoveSelf/Transform/DeployForGrantedCondition/
 * DonateCash/DonateExperience/RepairBridge/InstantRepair) 提供 trait 接口。
 * 这些 trait 尚未迁移（属于 Ch8/Ch10/Ch11/Ch19），因此使用鸭子类型。
 *
 * 模式与 EconomicActivityInterfaces.ts 和 TransportActivityInterfaces.ts 相同。
 */

import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Damage / Health
// ---------------------------------------------------------------------------

/** Damage state enum. OpenRA 对照: DamageState */
export const DamageState = {
  Undamaged: 0,
  Light: 1,
  Medium: 2,
  Heavy: 3,
  Critical: 4,
  Dead: 5,
} as const
export type DamageState = (typeof DamageState)[keyof typeof DamageState]

/** IHealth-like duck type. OpenRA 对照: IHealth */
export interface IHealthLike {
  readonly damageState: DamageState
  readonly hp: number
  readonly maxHP: number
  readonly isDead: boolean
}

// ---------------------------------------------------------------------------
// Enter Behaviour
// ---------------------------------------------------------------------------

/** Enter behaviour enum. OpenRA 对照: EnterBehaviour */
export const EnterBehaviour = {
  None: 0,
  Dispose: 1,
  Suicide: 2,
} as const
export type EnterBehaviour = (typeof EnterBehaviour)[keyof typeof EnterBehaviour]

// ---------------------------------------------------------------------------
// Deploy / GrantConditionOnDeploy
// ---------------------------------------------------------------------------

/** Deploy state. OpenRA 对照: DeployState */
export const DeployState = {
  Deployed: 0,
  Undeployed: 1,
  Deploying: 2,
  Undeploying: 3,
} as const
export type DeployState = (typeof DeployState)[keyof typeof DeployState]

/** GrantConditionOnDeploy-like duck type. OpenRA 对照: GrantConditionOnDeploy */
export interface GrantConditionOnDeployLike {
  readonly deployState: DeployState
  readonly info: GrantConditionOnDeployInfoLike
  deploy(): void
  undeploy(): void
}

export interface GrantConditionOnDeployInfoLike {
  readonly facing?: WAngle
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/** Transforms-like duck type. OpenRA 对照: Transforms */
export interface TransformsLike {
  canDeploy(): boolean
}

/** INotifyTransform-like duck type. OpenRA 对照: INotifyTransform */
export interface INotifyTransformLike {
  beforeTransform(actor: GameActor): void
  onTransform(actor: GameActor): void
  afterTransform(newActor: GameActor): void
}

/** WithMakeAnimation-like duck type. OpenRA 对照: WithMakeAnimation */
export interface WithMakeAnimationLike {
  reverse(actor: GameActor, callback: () => void): void
  forward(actor: GameActor, callback: () => void): void
}

/** ITransformActorInitModifier-like duck type */
export interface ITransformActorInitModifierLike {
  modifyTransformActorInit(actor: GameActor, init: Map<string, unknown>): void
}

// ---------------------------------------------------------------------------
// Cash / Experience
// ---------------------------------------------------------------------------

/** PlayerResources-like duck type. OpenRA 对照: PlayerResources */
export interface PlayerResourcesLike {
  changeCash(amount: number): number
}

/** PlayerExperience-like duck type. OpenRA 对照: PlayerExperience */
export interface PlayerExperienceLike {
  giveExperience(amount: number): void
}

/** GainsExperience-like duck type. OpenRA 对照: GainsExperience */
export interface GainsExperienceLike {
  readonly level: number
  readonly maxLevel: number
  giveLevels(count: number): void
}

/** INotifyCashTransfer-like duck type */
export interface INotifyCashTransferLike {
  onAcceptingCash(target: GameActor, source: GameActor): void
  onDeliveringCash(self: GameActor, target: GameActor): void
}

// ---------------------------------------------------------------------------
// Repair / Bridge
// ---------------------------------------------------------------------------

/** BridgeHut-like duck type. OpenRA 对照: BridgeHut */
export interface BridgeHutLike {
  readonly bridgeDamageState: DamageState
  readonly repairing: boolean
  repair(actor: GameActor): void
}

/** LegacyBridgeHut-like duck type. OpenRA 对照: LegacyBridgeHut */
export interface LegacyBridgeHutLike {
  readonly bridgeDamageState: DamageState
  readonly repairing: boolean
  readonly bridge: LegacyBridgeLike
  repair(actor: GameActor): void
}

export interface LegacyBridgeLike {
  getHut(index: number): unknown
}

// ---------------------------------------------------------------------------
// Instant Repair
// ---------------------------------------------------------------------------

/** InstantlyRepairable-like duck type. OpenRA 对照: InstantlyRepairable */
export interface InstantlyRepairableLike {
  readonly isTraitDisabled: boolean
}

/** ValidRelationships-like duck type */
export interface ValidRelationshipsLike {
  hasRelationship(stance: number): boolean
}

/** InstantlyRepairsInfo-like duck type */
export interface InstantlyRepairsInfoLike {
  readonly validRelationships: ValidRelationshipsLike
  readonly repairSound?: string
  readonly enterBehaviour: EnterBehaviour
}

// ---------------------------------------------------------------------------
// IFacing / Aircraft info (for Transform)
// ---------------------------------------------------------------------------

/** IFacing trait info presence check. OpenRA 对照: IFacingInfo */
export interface IFacingInfoPresence {
  hasTraitInfo(name: string): boolean
}

/** IFacing-like duck type */
export interface IFacingLike {
  facing: WAngle
}

// ---------------------------------------------------------------------------
// Transform init helpers
// ---------------------------------------------------------------------------

/** Init dict for Transform.createActor */
export interface TransformInit {
  Location: CPos
  Owner: unknown
  Facing: WAngle
  SkipMakeAnims?: boolean
  Faction?: string
  Health?: number
}
