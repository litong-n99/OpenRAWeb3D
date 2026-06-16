/**
 * GenericDockSequence.ts — 通用对接动画序列
 * OpenRA 对照: OpenRA.Mods.Common/Activities/GenericDockSequence.cs
 *
 * 核心范式转换:
 * - C# protected enum DockingState → TypeScript 字符串联合类型
 * - C# Action 回调 → TypeScript () => void 回调
 * - C# WithDockingOverlay 精灵动画 → TypeScript 动画存根 (延迟到渲染章节)
 * - C# IDockClientBody 动画回调 → TypeScript 方法存根
 * - C# virtual PlayDockAnimations → TypeScript 方法 (可被覆盖)
 * - C# QueueChild(new Drag(...)) → TypeScript this.queueChild(new Drag(...))
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.ts'
import type { GameActor } from '../../OpenRA.Game/Actor.ts'
import type { IDockHost } from '../../OpenRA.Game/Traits/TraitsInterfaces.ts'
import { Target } from '../../OpenRA.Game/Traits/Target.ts'
import { WPos } from '../../OpenRA.Game/WPos.ts'
import { WVec } from '../../OpenRA.Game/WVec.ts'
import { Wait } from './Wait.ts'
import { Drag } from './Move/Drag.ts'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.ts'
import type {
  INotifyDockClient,
  INotifyDockHost,
  IDockClientBody,
  WithDockingOverlay,
} from './EconomicActivityInterfaces.ts'
import type { DockClientManagerLike } from './MoveToDock.ts'

// ---------------------------------------------------------------------------
// DockingState 枚举
// ---------------------------------------------------------------------------

/** 对接动画序列的状态。
 *
 *  OpenRA 对照: GenericDockSequence.DockingState { Wait, Drag, Dock, Loop, Undock, Complete }
 */
export const DockingState = {
  Wait: 'Wait',
  Drag: 'Drag',
  Dock: 'Dock',
  Loop: 'Loop',
  Undock: 'Undock',
  Complete: 'Complete',
} as const

export type DockingState = (typeof DockingState)[keyof typeof DockingState]

// ---------------------------------------------------------------------------
// GenericDockSequence
// ---------------------------------------------------------------------------

/**
 * 通用对接动画序列 — 控制 actor 进入对接位置、播放动画、执行对接逻辑、退出。
 *
 * OpenRA 对照: GenericDockSequence activity
 *
 * 状态机:
 *   Drag → 验证主机状态，如需要则排队 Drag 子活动
 *   Dock → 播放对接动画，通知 INotifyDockClient/INotifyDockHost，调用 onDockStarted
 *   Loop → 每 tick 调用 onDockTick，直到完成或取消
 *   Undock → 播放解对接动画
 *   Complete → 调用 onDockCompleted，通知解对接，如需要则排队反向 Drag
 *
 * 被 Harvester (卸货) 和 Repair/Rearm 活动使用。
 */
export class GenericDockSequence extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration (protected for subclass access)
  // ---------------------------------------------------------------------------

  /** 对接主机 actor。 */
  protected readonly dockHostActor: GameActor

  /** 对接主机 trait。 */
  protected readonly dockHost: IDockHost

  /** 对接主机上的覆盖动画 (可能为 null)。 */
  protected readonly dockHostSpriteOverlay: WithDockingOverlay | null

  /** 对接客户端管理器。 */
  protected readonly dockClient: DockClientManagerLike

  /** 对接客户端身体动画 (可能为 null)。 */
  protected readonly dockClientBody: IDockClientBody | null

  /** 是否需要拖拽进入对接位置。 */
  protected readonly isDragRequired: boolean

  /** 拖拽动画长度 (tick 数)。 */
  protected readonly dragLength: number

  /** 拖拽起始位置。 */
  protected readonly startDrag: WPos

  /** 拖拽结束位置。 */
  protected readonly endDrag: WPos

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** 当前对接状态。 */
  protected dockingState: DockingState = DockingState.Drag

  /** 对接是否已启动 (用于取消时清理)。 */
  private dockInitiated: boolean = false

  /** 客户端通知接口数组。 */
  private readonly notifyDockClients: INotifyDockClient[]

  /** 主机通知接口数组。 */
  private readonly notifyDockHosts: INotifyDockHost[]

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 GenericDockSequence 活动。
   *
   * OpenRA 对照: GenericDockSequence(Actor, DockClientManager, Actor, IDockHost, int, bool, WVec, int)
   *
   * @param self — 执行此活动的 actor
   * @param client — 对接客户端管理器
   * @param hostActor — 对接主机 actor
   * @param host — 对接主机 trait
   * @param dockWait — 初始等待 tick 数
   * @param isDragRequired — 是否需要拖拽进入
   * @param dragOffset — 拖拽目标偏移 (从主机中心位置)
   * @param dragLength — 拖拽动画长度 (tick 数)
   */
  constructor(
    self: GameActor,
    client: DockClientManagerLike,
    hostActor: GameActor,
    host: IDockHost,
    dockWait: number,
    isDragRequired: boolean,
    dragOffset: WVec,
    dragLength: number,
  ) {
    super()
    this.dockClient = client
    this.dockHost = host
    this.dockHostActor = hostActor
    this.isDragRequired = isDragRequired
    this.dragLength = dragLength
    this.startDrag = (self as unknown as { centerPosition: WPos }).centerPosition
    this.endDrag = WPos.add(
      (hostActor as unknown as { centerPosition: WPos }).centerPosition,
      dragOffset,
    )

    // 解析 IDockClientBody
    this.dockClientBody = GenericDockSequence._resolveDockClientBody(self)

    // 解析 WithDockingOverlay
    this.dockHostSpriteOverlay = GenericDockSequence._resolveWithDockingOverlay(hostActor)

    // 解析通知接口
    this.notifyDockClients = GenericDockSequence._resolveNotifyDockClients(self)
    this.notifyDockHosts = GenericDockSequence._resolveNotifyDockHosts(hostActor)

    // 初始等待
    this.queueChild(new Wait(dockWait))
  }

  // ---------------------------------------------------------------------------
  // Tick — 状态机核心
  // ---------------------------------------------------------------------------

  /**
   * 对接动画状态机。
   *
   * OpenRA 对照: GenericDockSequence.Tick(Actor)
   *
   * @param self — 执行此活动的 actor
   * @returns true 当活动完成，false 继续执行
   */
  override tick(self: GameActor): boolean {
    switch (this.dockingState) {
      case DockingState.Wait:
        return false

      case DockingState.Drag:
        // 检查取消或主机死亡
        if (
          this.isCanceling ||
          this.dockHostActor.isDead ||
          !this.dockHostActor.isInWorld ||
          ((this.dockClient as unknown as Record<string, unknown>).canDockAt !== undefined &&
            !(this.dockClient as unknown as { canDockAt: (a: GameActor, h: IDockHost, b: boolean, c: boolean) => boolean }).canDockAt(
              this.dockHostActor, this.dockHost, false, true
            ))
        ) {
          this.dockClient.unreserveHost()
          return true
        }

        this.dockingState = DockingState.Dock
        if (this.isDragRequired) {
          this.queueChild(new Drag(self, this.startDrag, this.endDrag, this.dragLength))
        }
        return false

      case DockingState.Dock:
        if (
          !this.isCanceling &&
          !this.dockHostActor.isDead &&
          this.dockHostActor.isInWorld &&
          (!(this.dockClient as unknown as Record<string, unknown>).canDockAt ||
            (this.dockClient as unknown as { canDockAt: (a: GameActor, h: IDockHost, b: boolean, c: boolean) => boolean }).canDockAt(
              this.dockHostActor, this.dockHost, false, true
            ))
        ) {
          this.dockInitiated = true
          this.playDockAnimations(self)
          const hostAny = this.dockHost as unknown as Record<string, unknown>
          if (typeof hostAny.onDockStarted === 'function') {
            (hostAny as { onDockStarted: (a: GameActor, b: GameActor, c: unknown) => void }).onDockStarted(this.dockHostActor, self, this.dockClient)
          }
          const clientAny = this.dockClient as unknown as Record<string, unknown>
          if (typeof clientAny.onDockStarted === 'function') {
            (clientAny as { onDockStarted: (a: GameActor, b: GameActor, c: IDockHost) => void }).onDockStarted(self, this.dockHostActor, this.dockHost)
          }
          this.notifyDocked(self)
        } else {
          this.dockingState = DockingState.Undock
        }
        return false

      case DockingState.Loop:
        if (
          this.isCanceling ||
          this.dockHostActor.isDead ||
          !this.dockHostActor.isInWorld ||
          ((this.dockClient as unknown as Record<string, unknown>).onDockTick !== undefined &&
            (this.dockClient as unknown as { onDockTick: (a: GameActor, b: GameActor, c: IDockHost) => boolean }).onDockTick(self, this.dockHostActor, this.dockHost))
        ) {
          this.dockingState = DockingState.Undock
        }
        return false

      case DockingState.Undock:
        if (this.dockInitiated) {
          this.playUndockAnimations(self)
        } else {
          this.dockingState = DockingState.Complete
        }
        return false

      case DockingState.Complete:
        {
          const hostAny2 = this.dockHost as unknown as Record<string, unknown>
          if (typeof hostAny2.onDockCompleted === 'function') {
            (hostAny2 as { onDockCompleted: (a: GameActor, b: GameActor, c: unknown) => void }).onDockCompleted(this.dockHostActor, self, this.dockClient)
          }
          const clientAny2 = this.dockClient as unknown as Record<string, unknown>
          if (typeof clientAny2.onDockCompleted === 'function') {
            (clientAny2 as { onDockCompleted: (a: GameActor, b: GameActor, c: IDockHost) => void }).onDockCompleted(self, this.dockHostActor, this.dockHost)
          }
        }
        this.notifyUndocked(self)
        if (this.isDragRequired) {
          this.queueChild(new Drag(self, this.endDrag, this.startDrag, this.dragLength))
        }
        return true
    }

    throw new Error(`Invalid dock state: ${this.dockingState}`)
  }

  // ---------------------------------------------------------------------------
  // Virtual animation methods
  // ---------------------------------------------------------------------------

  /**
   * 播放对接动画。
   *
   * OpenRA 对照: GenericDockSequence.PlayDockAnimations(Actor)
   *
   * 虚拟方法 — 子类可覆盖以自定义对接动画。
   * 默认实现: 如果有 WithDockingOverlay，播放覆盖动画后进入 Loop；
   * 否则直接进入 Loop。
   */
  playDockAnimations(self: GameActor): void {
    this.playDockClientAnimation(self, () => {
      if (this.dockHostSpriteOverlay !== null && !this.dockHostSpriteOverlay.visible) {
        this.dockingState = DockingState.Wait
        this.dockHostSpriteOverlay!.visible = true
        this.dockHostSpriteOverlay!.withOffset.animation.playThen(
          this.dockHostSpriteOverlay!.info.sequence,
          () => {
            this.dockingState = DockingState.Loop
            this.dockHostSpriteOverlay!.visible = false
          },
        )
      } else {
        this.dockingState = DockingState.Loop
      }
    })
  }

  /**
   * 播放对接客户端身体动画。
   *
   * OpenRA 对照: GenericDockSequence.PlayDockClientAnimation(Actor, Action)
   *
   * 虚拟方法 — 子类可覆盖。
   * 如果有 IDockClientBody，播放身体动画后调用 after；否则直接调用 after。
   */
  playDockClientAnimation(self: GameActor, after: () => void): void {
    if (this.dockClientBody !== null) {
      this.dockingState = DockingState.Wait
      this.dockClientBody.playDockAnimation(self, () => after())
    } else {
      after()
    }
  }

  /**
   * 播放解对接动画。
   *
   * OpenRA 对照: GenericDockSequence.PlayUndockAnimations(Actor)
   *
   * 虚拟方法 — 子类可覆盖以自定义解对接动画。
   * 默认实现: 如果有 WithDockingOverlay，反向播放覆盖动画后进入 Complete。
   */
  playUndockAnimations(self: GameActor): void {
    if (
      this.dockHostActor.isInWorld &&
      !this.dockHostActor.isDead &&
      this.dockHostSpriteOverlay !== null &&
      !this.dockHostSpriteOverlay.visible
    ) {
      this.dockingState = DockingState.Wait
      this.dockHostSpriteOverlay!.visible = true
      this.dockHostSpriteOverlay!.withOffset.animation.playBackwardsThen(
        this.dockHostSpriteOverlay!.info.sequence,
        () => {
          this.playUndockClientAnimation(self, () => {
            this.dockingState = DockingState.Complete
            this.dockHostSpriteOverlay!.visible = false
          })
        },
      )
    } else {
      this.playUndockClientAnimation(self, () => {
        this.dockingState = DockingState.Complete
      })
    }
  }

  /**
   * 播放解对接客户端身体动画。
   *
   * OpenRA 对照: GenericDockSequence.PlayUndockClientAnimation(Actor, Action)
   *
   * 虚拟方法 — 子类可覆盖。
   * 如果有 IDockClientBody，播放反向身体动画后调用 after；否则直接调用 after。
   */
  playUndockClientAnimation(self: GameActor, after: () => void): void {
    if (this.dockClientBody !== null) {
      this.dockingState = DockingState.Wait
      this.dockClientBody.playReverseDockAnimation(self, () => after())
    } else {
      after()
    }
  }

  // ---------------------------------------------------------------------------
  // Notification helpers
  // ---------------------------------------------------------------------------

  /** 通知所有对接完成监听者。
   *
   *  OpenRA 对照: GenericDockSequence.NotifyDocked(Actor)
   */
  private notifyDocked(self: GameActor): void {
    for (const nd of this.notifyDockClients) {
      nd.docked(self, this.dockHostActor)
    }
    for (const nd of this.notifyDockHosts) {
      nd.docked(this.dockHostActor, self)
    }
  }

  /** 通知所有解对接监听者。
   *
   *  OpenRA 对照: GenericDockSequence.NotifyUndocked(Actor)
   */
  private notifyUndocked(self: GameActor): void {
    for (const nd of this.notifyDockClients) {
      nd.undocked(self, this.dockHostActor)
    }
    if (!this.dockHostActor.isDead) {
      for (const nd of this.notifyDockHosts) {
        nd.undocked(this.dockHostActor, self)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * 获取目标。
   *
   * OpenRA 对照: GenericDockSequence.GetTargets(Actor)
   */
  override getTargets(_self: GameActor): Target[] {
    return [Target.fromActor(this.dockHostActor as unknown as IActorRef)]
  }

  /**
   * 获取目标线节点。
   *
   * OpenRA 对照: GenericDockSequence.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    return [new TargetLineNode(Target.fromActor(this.dockHostActor as unknown as IActorRef), { r: 0, g: 1, b: 0, a: 1 })]
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 从 actor 解析 IDockClientBody。 */
  private static _resolveDockClientBody(self: GameActor): IDockClientBody | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits) {
      for (const [, trait] of traits) {
        const t = trait as Partial<IDockClientBody>
        if (
          typeof t.playDockAnimation === 'function' &&
          typeof t.playReverseDockAnimation === 'function'
        ) {
          return t as IDockClientBody
        }
      }
    }
    return null
  }

  /** 从 host actor 解析 WithDockingOverlay。 */
  private static _resolveWithDockingOverlay(hostActor: GameActor): WithDockingOverlay | null {
    const traits = (hostActor as unknown as { traits?: Map<string, unknown> }).traits
    if (traits) {
      for (const [, trait] of traits) {
        const t = trait as Partial<WithDockingOverlay>
        if (
          t.visible !== undefined &&
          t.info !== undefined &&
          t.withOffset !== undefined
        ) {
          return t as WithDockingOverlay
        }
      }
    }
    return null
  }

  /** 从 actor 解析 INotifyDockClient 接口数组。 */
  private static _resolveNotifyDockClients(self: GameActor): INotifyDockClient[] {
    const result: INotifyDockClient[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits) {
      for (const [, trait] of traits) {
        const t = trait as Partial<INotifyDockClient>
        if (typeof t.docked === 'function' && typeof t.undocked === 'function') {
          result.push(t as INotifyDockClient)
        }
      }
    }
    return result
  }

  /** 从 host actor 解析 INotifyDockHost 接口数组。 */
  private static _resolveNotifyDockHosts(hostActor: GameActor): INotifyDockHost[] {
    const result: INotifyDockHost[] = []
    const traits = (hostActor as unknown as { traits?: Map<string, unknown> }).traits
    if (traits) {
      for (const [, trait] of traits) {
        const t = trait as Partial<INotifyDockHost>
        if (typeof t.docked === 'function' && typeof t.undocked === 'function') {
          result.push(t as INotifyDockHost)
        }
      }
    }
    return result
  }
}
