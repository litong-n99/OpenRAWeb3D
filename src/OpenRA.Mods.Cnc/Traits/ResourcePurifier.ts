/**
 * ResourcePurifier.ts — 资源净化器（额外现金奖励）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/ResourcePurifier.cs (91 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ResourcePurifierInfo> → TypeScript ConditionalTrait
 * - C# INotifyResourceAccepted → TypeScript resource accepted interface
 * - C# PlayerResources.GiveCash(cash) → TypeScript cash transfer stub
 * - C# FloatingText effect → TypeScript stub (deferred to Phase C rendering)
 * - C# Common.Util.ApplyPercentageModifiers → TypeScript percentage calculation
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a percentage modifier to a value.
 *
 * OpenRA 对照: Common.Util.ApplyPercentageModifiers(int, int[])
 */
function applyPercentageModifiers(value: number, modifiers: readonly number[]): number {
  let result = value
  for (const modifier of modifiers) {
    result = Math.floor((result * modifier) / 100)
  }
  return result
}

// ---------------------------------------------------------------------------
// ResourcePurifierInfo
// OpenRA 对照: ResourcePurifierInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for resource purification bonus.
 *
 * OpenRA 对照: ResourcePurifierInfo
 */
export class ResourcePurifierInfo implements ITraitInfo {
  /** Percentage value of the resource to grant as cash.
   *
   * OpenRA 对照: ResourcePurifierInfo.Modifier
   */
  readonly modifier: number

  /** Whether to show cash tick indicators.
   *
   * OpenRA 对照: ResourcePurifierInfo.ShowTicks
   */
  readonly showTicks: boolean

  /** How long cash ticks stay on screen.
   *
   * OpenRA 对照: ResourcePurifierInfo.TickLifetime
   */
  readonly tickLifetime: number

  /** How often cash ticks can appear.
   *
   * OpenRA 对照: ResourcePurifierInfo.TickRate
   */
  readonly tickRate: number

  constructor(params?: {
    modifier?: number
    showTicks?: boolean
    tickLifetime?: number
    tickRate?: number
  }) {
    this.modifier = params?.modifier ?? 0
    this.showTicks = params?.showTicks ?? true
    this.tickLifetime = params?.tickLifetime ?? 30
    this.tickRate = params?.tickRate ?? 10
  }

  create(_init: IGameActor): ResourcePurifier {
    return new ResourcePurifier(this)
  }
}

// ---------------------------------------------------------------------------
// ResourcePurifier
// OpenRA 对照: ResourcePurifier : ConditionalTrait<...>, INotifyResourceAccepted, ITick, INotifyOwnerChanged
// ---------------------------------------------------------------------------

/** Gives additional cash when resources are delivered to refineries.
 *
 * OpenRA 对照: ResourcePurifier
 *
 * Each time a resource is delivered to this refinery, a percentage bonus
 * is granted as extra cash. Floating text indicators can display the bonus
 * amount at configurable intervals.
 */
export class ResourcePurifier extends ConditionalTrait<ResourcePurifierInfo> {
  /** Cash modifier array (from info.modifier).
   *
   * OpenRA 对照: ResourcePurifier.modifier (int[])
   */
  private readonly _modifiers: readonly number[]

  /** Reference to the player's resource manager.
   *
   * OpenRA 对照: ResourcePurifier.playerResources
   */
  private _playerResources: unknown = null

  /** Ticks until next cash indicator display.
   *
   * OpenRA 对照: ResourcePurifier.currentDisplayTick
   */
  private _currentDisplayTick: number = 0

  /** Accumulated cash value for display.
   *
   * OpenRA 对照: ResourcePurifier.currentDisplayValue
   */
  private _currentDisplayValue: number = 0

  constructor(info: ResourcePurifierInfo) {
    super(info)
    this._modifiers = [info.modifier]
    this._currentDisplayTick = info.tickRate
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Called after the actor is created.
   *
   * OpenRA 对照: ResourcePurifier.Created(Actor)
   */
  protected override onCreated(self: IGameActor): void {
    const playerActor = (self as any).owner?.playerActor
    if (playerActor && typeof playerActor.getPlayerResources === 'function') {
      this._playerResources = playerActor.getPlayerResources()
    }
  }

  // -------------------------------------------------------------------------
  // INotifyOwnerChanged
  // -------------------------------------------------------------------------

  /** Handle owner change.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(self: IGameActor): void {
    const playerActor = (self as any).owner?.playerActor
    if (playerActor && typeof playerActor.getPlayerResources === 'function') {
      this._playerResources = playerActor.getPlayerResources()
    }
    this._currentDisplayTick = this.info.tickRate
    this._currentDisplayValue = 0
  }

  // -------------------------------------------------------------------------
  // INotifyResourceAccepted
  // -------------------------------------------------------------------------

  /** Called when a resource is delivered to this refinery.
   *
   * OpenRA 对照: INotifyResourceAccepted.OnResourceAccepted(Actor, Actor, string, int, int)
   *
   * @param self — the refinery actor
   * @param _refinery — the refinery that accepted the resource
   * @param _resourceType — type of resource delivered
   * @param _count — amount of resource delivered
   * @param value — cash value of the delivered resource
   */
  onResourceAccepted(
    self: IGameActor,
    _refinery: IGameActor,
    _resourceType: string,
    _count: number,
    value: number,
  ): void {
    if (this.isTraitDisabled) return

    const cash = applyPercentageModifiers(value, this._modifiers)

    // C#: playerResources.GiveCash(cash)
    if (this._playerResources && typeof (this._playerResources as any).giveCash === 'function') {
      (this._playerResources as any).giveCash(cash)
    }

    if (this.info.showTicks) {
      this._currentDisplayValue += cash
    }

    void self
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /** Display accumulated cash ticks at the configured rate.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   *
   * @param self — the refinery actor
   */
  tick(self: IGameActor): void {
    if (this._currentDisplayValue > 0 && --this._currentDisplayTick <= 0) {
      // C#: world.AddFrameEndTask(w => w.Add(new FloatingText(...)))
      // NOTE: FloatingText rendering deferred to Phase C.
      // The display value is reset regardless.

      this._currentDisplayTick = this.info.tickRate
      this._currentDisplayValue = 0
    }
  }

  // -------------------------------------------------------------------------
  // Queries (for testing)
  // -------------------------------------------------------------------------

  /** Current display value.
   */
  get currentDisplayValue(): number {
    return this._currentDisplayValue
  }

  /** Current display tick countdown.
   */
  get currentDisplayTick(): number {
    return this._currentDisplayTick
  }
}
