/**
 * RepairBridge.ts — 修复桥梁活动 (extends Enter)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/RepairBridge.cs
 *
 * 核心范式转换:
 * - C# sealed class RepairBridge : Enter → TypeScript class RepairBridge extends Enter
 * - C# BridgeHut / LegacyBridgeHut traits → TypeScript duck-typed interfaces
 * - C# EnterBehaviour enum → TypeScript EnterBehaviour const object
 * - C# Game.Sound.PlayNotification() → TypeScript stub (audio system)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  EnterBehaviour,
  DamageState,
  type BridgeHutLike,
  type LegacyBridgeHutLike,
} from './UtilityActivityInterfaces.js'

// ---------------------------------------------------------------------------
// RepairBridge
// ---------------------------------------------------------------------------

/**
 * 修复桥梁 — 进入桥梁小屋并修复桥梁。
 *
 * OpenRA 对照: RepairBridge sealed class
 *
 * 继承 Enter 基类。TryStartEnter 检查桥梁是否需要修复。
 * OnEnterComplete 执行修复操作。
 */
export class RepairBridge extends Enter {
  private readonly enterBehaviour: EnterBehaviour
  private readonly speechNotification: string
  private readonly textNotification: string

  private enterActor: GameActor | null = null
  private enterHut: BridgeHutLike | null = null
  private enterLegacyHut: LegacyBridgeHutLike | null = null

  constructor(
    self: GameActor,
    target: Target,
    enterBehaviour: EnterBehaviour,
    speechNotification: string,
    textNotification: string,
    targetLineColor: ColorStub,
  ) {
    super(self, target, targetLineColor)
    this.enterBehaviour = enterBehaviour
    this.speechNotification = speechNotification
    this.textNotification = textNotification
  }

  private canEnterHut(): boolean {
    if (this.enterLegacyHut !== null) {
      return this.enterLegacyHut.bridgeDamageState !== DamageState.Undamaged &&
        !this.enterLegacyHut.repairing &&
        this.enterLegacyHut.bridge.getHut(0) !== null &&
        this.enterLegacyHut.bridge.getHut(1) !== null
    }

    if (this.enterHut !== null) {
      return this.enterHut.bridgeDamageState !== DamageState.Undamaged &&
        !this.enterHut.repairing
    }

    return false
  }

  protected override tryStartEnter(self: GameActor, targetActor: GameActor): boolean {
    this.enterActor = targetActor
    this.enterLegacyHut = RepairBridge._resolveLegacyBridgeHut(targetActor)
    this.enterHut = RepairBridge._resolveBridgeHut(targetActor)

    if (!this.canEnterHut()) {
      this.cancel(self, true)
      return false
    }

    return true
  }

  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    if (targetActor !== this.enterActor) return
    if (!this.canEnterHut()) return

    if (this.enterLegacyHut !== null) {
      this.enterLegacyHut.repair(self)
    } else if (this.enterHut !== null) {
      this.enterHut.repair(self)
    }

    // Audio/notification stubs — Sound system not yet migrated
    // Game.Sound.PlayNotification(...)
    // TextNotificationsManager.AddTransientLine(...)
    void this.speechNotification
    void this.textNotification

    if (this.enterBehaviour === EnterBehaviour.Dispose) {
      self.dispose()
    } else if (this.enterBehaviour === EnterBehaviour.Suicide) {
      self.kill(self)
    }
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  private static _resolveBridgeHut(actor: GameActor): BridgeHutLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<BridgeHutLike>
      if (typeof t.repair === 'function' && typeof (t as { bridgeDamageState?: unknown }).bridgeDamageState !== 'undefined') {
        return t as BridgeHutLike
      }
    }
    return null
  }

  private static _resolveLegacyBridgeHut(actor: GameActor): LegacyBridgeHutLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<LegacyBridgeHutLike>
      if (typeof t.repair === 'function' && typeof (t as { bridge?: unknown }).bridge !== 'undefined') {
        return t as LegacyBridgeHutLike
      }
    }
    return null
  }
}
