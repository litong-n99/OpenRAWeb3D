/**
 * DeployForGrantedCondition.ts — 部署/取消部署活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/DeployForGrantedCondition.cs
 *
 * 核心范式转换:
 * - C# DeployForGrantedCondition + DeployInner nested classes → TypeScript two classes
 * - C# GrantConditionOnDeploy trait → TypeScript duck-typed GrantConditionOnDeployLike
 * - C# DeployState enum → TypeScript DeployState const object
 * - C# Turn child activity → injected factory
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, ActivityState, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import {
  DeployState,
  type GrantConditionOnDeployLike,
} from './UtilityActivityInterfaces.js'

// ---------------------------------------------------------------------------
// DeployForGrantedCondition
// ---------------------------------------------------------------------------

/**
 * 部署/取消部署活动 — 切换 GrantConditionOnDeploy 的部署状态。
 *
 * OpenRA 对照: DeployForGrantedCondition activity
 *
 * 工作流程:
 * 1. OnFirstRun: 如果 undeployed 且需要转向，排队 Turn
 * 2. Tick: 排队 DeployInner 子活动
 */
export class DeployForGrantedCondition extends Activity {
  private readonly deploy: GrantConditionOnDeployLike
  private readonly canTurn: boolean
  private readonly moving: boolean

  /** Turn 工厂 (可注入)。 */
  static _turnFactory: ((self: GameActor, facing: import('../../OpenRA.Game/WAngle.js').WAngle) => Activity) | null = null

  constructor(self: GameActor, deploy: GrantConditionOnDeployLike, moving: boolean = false) {
    super()
    this.deploy = deploy
    this.moving = moving
    this.canTurn = (self as unknown as { info?: { hasTraitInfo?: (name: string) => boolean } }).info?.hasTraitInfo?.('IFacing') ?? false
  }

  protected override onFirstRun(self: GameActor): void {
    // Turn to the required facing if undeployed
    if (this.deploy.deployState === DeployState.Undeployed &&
        this.deploy.info.facing !== undefined &&
        this.canTurn &&
        !this.moving) {
      const turnFactory = DeployForGrantedCondition._turnFactory
      if (turnFactory) {
        this.queueChild(turnFactory(self, this.deploy.info.facing))
      }
    }
  }

  override tick(_self: GameActor): boolean {
    if (this.isCanceling || this.state === ActivityState.Done ||
        (this.deploy.deployState !== DeployState.Deployed && this.moving)) {
      return true
    }

    this.queueChild(new DeployInner(this.deploy))
    return true
  }

  override targetLineNodes(self: GameActor): TargetLineNode[] {
    if (this.nextActivity !== null) {
      return this.nextActivity.targetLineNodes(self)
    }
    return []
  }
}

// ---------------------------------------------------------------------------
// DeployInner (nested class equivalent)
// ---------------------------------------------------------------------------

/**
 * 内部部署活动 — 实际执行 deploy() 或 undeploy() 调用。
 *
 * OpenRA 对照: DeployForGrantedCondition.DeployInner nested class
 *
 * 一旦开始部署动画，活动不可中断。
 */
class DeployInner extends Activity {
  private readonly deployment: GrantConditionOnDeployLike
  private initiated: boolean = false

  constructor(deployment: GrantConditionOnDeployLike) {
    super()
    this.deployment = deployment
    // Once deployment animation starts, the animation must finish
    this.isInterruptible = false
  }

  override tick(_self: GameActor): boolean {
    // Wait for deployment/undeployment to finish
    if (this.deployment.deployState === DeployState.Deploying ||
        this.deployment.deployState === DeployState.Undeploying) {
      return false
    }

    if (this.initiated) return true

    if (this.deployment.deployState === DeployState.Undeployed) {
      this.deployment.deploy()
    } else {
      this.deployment.undeploy()
    }

    this.initiated = true
    return false
  }
}
