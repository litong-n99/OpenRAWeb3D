/**
 * Transform.ts — 变形/部署活动 (MCV deployment)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Transform.cs
 *
 * 核心范式转换:
 * - C# Transform class extending Activity → TypeScript Transform extends Activity
 * - C# TypeDictionary init → TypeScript Map<string, unknown>
 * - C# self.World.AddFrameEndTask() → TypeScript world.queueFrameEndAction()
 * - C# w.CreateActor(ToActor, init) → TypeScript world.createActor()
 * - C# self.Dispose() → TypeScript self.dispose()
 * - C# Traits: Transforms, WithMakeAnimation, INotifyTransform, ITransformActorInitModifier → duck-typed
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, ActivityState } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { WaitFor } from './Wait.js'
import type {
  TransformsLike,
  INotifyTransformLike,
  WithMakeAnimationLike,
  ITransformActorInitModifierLike,
  IHealthLike,
} from './UtilityActivityInterfaces.js'

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * 变形/部署活动 — 将当前 actor 替换为新 actor 类型（如 MCV 部署）。
 *
 * OpenRA 对照: Transform activity
 *
 * 工作流程:
 * 1. OnFirstRun: 排队 Turn（如果需要）+ Land（如果是飞机）
 * 2. Tick: 验证 CanDeploy，通知 INotifyTransform，播放 make 动画或直接变形
 * 3. DoTransform: 帧末创建新 actor，转移选择/编组，清理旧 actor
 */
export class Transform extends Activity {
  /** 目标 actor 类型 (YAML 名称)。 */
  readonly toActor: string

  /** 偏移量 (单元格)。 */
  offset: CVec = CVec.Zero

  /** 朝向。 */
  facing: WAngle = new WAngle(384)

  /** 播放的声音列表。 */
  sounds: string[] = []

  /** 语音通知 ID。 */
  notification: string | null = null

  /** 文字通知。 */
  textNotification: string | null = null

  /** 强制血量百分比 (0 = 保留当前百分比)。 */
  forceHealthPercentage: number = 0

  /** 跳过 make 动画。 */
  skipMakeAnims: boolean = false

  /** 势力 ID。 */
  faction: string | null = null

  /** Turn 工厂 (可注入)。 */
  static _turnFactory: ((self: GameActor, facing: WAngle) => Activity) | null = null

  /** Land 工厂 (可注入)。 */
  static _landFactory: ((self: GameActor) => Activity) | null = null

  constructor(toActor: string) {
    super()
    this.toActor = toActor
  }

  protected override onFirstRun(self: GameActor): void {
    const info = (self as unknown as { info?: { hasTraitInfo?: (name: string) => boolean } }).info

    // If the actor has a facing trait, turn to the desired facing
    if (info?.hasTraitInfo?.('IFacing')) {
      const turnFactory = Transform._turnFactory
      if (turnFactory) {
        this.queueChild(turnFactory(self, this.facing))
      }
    }

    // If the actor is an aircraft, land first
    if (info?.hasTraitInfo?.('Aircraft')) {
      const landFactory = Transform._landFactory
      if (landFactory) {
        this.queueChild(landFactory(self))
      }
    }
  }

  override tick(self: GameActor): boolean {
    if (this.isCanceling || this.state === ActivityState.Done) return true

    // Prevent deployment in bogus locations
    const transforms = Transform._resolveTransforms(self)
    if (transforms !== null && !transforms.canDeploy()) return true

    // Notify INotifyTransform
    const notifiers = Transform._resolveTransformNotifiers(self)
    for (const nt of notifiers) {
      nt.beforeTransform(self)
    }

    const makeAnimation = Transform._resolveMakeAnimation(self)
    if (!this.skipMakeAnims && makeAnimation !== null) {
      // Once the make animation starts the activity must not be stopped
      this.isInterruptible = false

      // Wait forever until callback fires
      this.queueChild(new WaitFor(() => false))
      makeAnimation.reverse(self, () => {
        this.doTransform(self, transforms, makeAnimation)
      })
      return false
    }

    this.doTransform(self, transforms, null)
    return true
  }

  private doTransform(self: GameActor, transforms: TransformsLike | null, makeAnimation: WithMakeAnimationLike | null): void {
    // Capture current activity for order transfer
    const currentActivity = (self as unknown as { currentActivity?: Activity }).currentActivity

    const world = (self as unknown as { world?: WorldLike }).world
    if (world === undefined) return

    world.queueFrameEndAction(() => {
      if (self.isDead || self.disposed) return

      // Prevent deployment in bogus locations
      if (transforms !== null && !transforms.canDeploy()) {
        if (!this.skipMakeAnims && makeAnimation !== null) {
          makeAnimation.forward(self, () => {
            this.isInterruptible = true
            this.cancel(self, true)
          })
        } else {
          this.isInterruptible = true
          this.cancel(self, true)
        }
        return
      }

      // Notify INotifyTransform.OnTransform
      const notifiers = Transform._resolveTransformNotifiers(self)
      for (const nt of notifiers) {
        nt.onTransform(self)
      }

      // Selection/control group transfer (stub — Selection/ControlGroups not yet migrated)
      const selected = false
      const controlgroup: number | null = null

      // Dispose self and create new actor
      self.dispose()

      // Create init dict
      const location = (self as unknown as { location: { X: number; Y: number } }).location
      const init = new Map<string, unknown>()
      init.set('Location', { X: location.X + this.offset.X, Y: location.Y + this.offset.Y })
      init.set('Owner', (self as unknown as { owner: unknown }).owner)
      init.set('Facing', this.facing)

      if (this.skipMakeAnims) init.set('SkipMakeAnims', true)
      if (this.faction !== null) init.set('Faction', this.faction)

      const health = Transform._resolveHealth(self)
      if (health !== null) {
        const newHP = this.forceHealthPercentage > 0
          ? this.forceHealthPercentage
          : Math.floor((health.hp * 100) / health.maxHP)
        init.set('Health', newHP)
      }

      // Allow modifiers to adjust init
      const modifiers = Transform._resolveInitModifiers(self)
      for (const modifier of modifiers) {
        modifier.modifyTransformActorInit(self, init)
      }

      // Create new actor
      const newActor = world.createActor(this.toActor, init)

      // Notify AfterTransform
      for (const nt of notifiers) {
        nt.afterTransform(newActor as unknown as GameActor)
      }

      // Transfer orders via IssueOrderAfterTransform
      if (currentActivity) {
        const issueOrders = Transform._resolveIssueOrderActivities(currentActivity)
        for (const issueOrder of issueOrders) {
          if ((issueOrder as unknown as Activity).isCanceling) continue
          const order = issueOrder.issueOrderForTransformedActor(newActor as unknown as GameActor)
          if (order && newActor) {
            const resolveOrders = (newActor as unknown as { traitsImplementing?: (name: string) => { resolveOrder: (a: GameActor, o: unknown) => void }[] }).traitsImplementing
            if (resolveOrders) {
              for (const t of resolveOrders('IResolveOrder')) {
                t.resolveOrder(newActor as unknown as GameActor, order)
              }
            }
          }
        }
      }

      // ReplacedByActor reference
      ;(self as unknown as { replacedByActor: unknown }).replacedByActor = newActor

      // Transfer selection (stub)
      void selected
      void controlgroup
    })
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution
  // ---------------------------------------------------------------------------

  private static _resolveTransforms(actor: GameActor): TransformsLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<TransformsLike>
      if (typeof t.canDeploy === 'function') return t as TransformsLike
    }
    return null
  }

  private static _resolveTransformNotifiers(actor: GameActor): INotifyTransformLike[] {
    const result: INotifyTransformLike[] = []
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyTransformLike>
      if (typeof t.beforeTransform === 'function') result.push(t as INotifyTransformLike)
    }
    return result
  }

  private static _resolveMakeAnimation(actor: GameActor): WithMakeAnimationLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<WithMakeAnimationLike>
      if (typeof t.reverse === 'function' && typeof t.forward === 'function') {
        return t as WithMakeAnimationLike
      }
    }
    return null
  }

  private static _resolveHealth(actor: GameActor): IHealthLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<IHealthLike>
      if (typeof (t as { hp?: unknown }).hp === 'number') return t as IHealthLike
    }
    return null
  }

  private static _resolveInitModifiers(actor: GameActor): ITransformActorInitModifierLike[] {
    const result: ITransformActorInitModifierLike[] = []
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<ITransformActorInitModifierLike>
      if (typeof t.modifyTransformActorInit === 'function') result.push(t as ITransformActorInitModifierLike)
    }
    return result
  }

  private static _resolveIssueOrderActivities(activity: Activity): IssueOrderAfterTransformLike[] {
    const result: IssueOrderAfterTransformLike[] = []
    // Walk the activity queue looking for IssueOrderAfterTransform
    let current: Activity | null = activity
    while (current !== null) {
      const t = current as unknown as Partial<IssueOrderAfterTransformLike>
      if (typeof t.issueOrderForTransformedActor === 'function') {
        result.push(current as unknown as IssueOrderAfterTransformLike)
      }
      current = current.nextActivity
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// IssueOrderAfterTransform (interface for duck-typing)
// ---------------------------------------------------------------------------

interface IssueOrderAfterTransformLike {
  isCanceling: boolean
  issueOrderForTransformedActor(newActor: GameActor): unknown
}

// ---------------------------------------------------------------------------
// WorldLike — 世界最小接口
// ---------------------------------------------------------------------------

interface WorldLike {
  queueFrameEndAction(action: () => void): void
  createActor(name: string, init: Map<string, unknown>): unknown
}
