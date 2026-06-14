/**
 * PowerManager.ts — 电力管理器桩：生产队列低电力减速的依赖项
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PowerManager.cs
 *
 * 核心范式转换:
 * - C# PowerManager 完整实现 → TS 桩，始终返回 PowerState.Normal
 * - C# PowerState 枚举 → TS const 对象 + type alias
 *
 * @todo 完整实现推迟至后续章节。当前桩仅提供 PowerState 枚举和
 *   始终返回 Normal 状态的 getter，以 unblock ProductionQueue 的
 *   低电力减速逻辑。
 */

// ---------------------------------------------------------------------------
// PowerState
// OpenRA 对照: PowerManager.PowerState enum
// ---------------------------------------------------------------------------

/** Power state of a player's base.
 *
 * OpenRA 对照: PowerManager.PowerState
 *
 * - Normal:  power >= 0 (sufficient power)
 * - Low:     power < 0 but >= -powerDrained * 0.5 (moderate deficit)
 * - Critical: power < -powerDrained * 0.5 (severe deficit)
 */
export const PowerState = {
  Normal: 0,
  Low: 1,
  Critical: 2,
} as const

export type PowerState = (typeof PowerState)[keyof typeof PowerState]

// ---------------------------------------------------------------------------
// PowerManagerInfo
// OpenRA 对照: PowerManagerInfo
// ---------------------------------------------------------------------------

/** Configuration for the PowerManager trait.
 *
 * OpenRA 对照: PowerManagerInfo
 *
 * @todo Full implementation deferred. Current stub has no config fields.
 */
export class PowerManagerInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// PowerManager
// OpenRA 对照: PowerManager
// ---------------------------------------------------------------------------

/** Manages power state for a player.
 *
 * OpenRA 对照: PowerManager
 *
 * @todo Full implementation deferred. Current stub always returns
 *   PowerState.Normal. ProductionQueue will use this for low-power
 *   build time slowdown. Full power tracking (power generation vs
 *   consumption) will be implemented in a later chapter.
 */
export class PowerManager {
  readonly info: PowerManagerInfo

  constructor(info: PowerManagerInfo = new PowerManagerInfo()) {
    this.info = info
  }

  /** Get the current power state.
   *
   * OpenRA 对照: PowerManager.PowerState property
   *
   * @todo Stub — always returns Normal. Full power calculation deferred.
   * @returns current power state
   */
  get powerState(): PowerState {
    return PowerState.Normal
  }

  /** Get the current power surplus (generation - consumption).
   *
   * OpenRA 对照: PowerManager.Power property
   *
   * @todo Stub — always returns 0. Full calculation deferred.
   * @returns current power surplus
   */
  get power(): number {
    return 0
  }

  /** Get the total power drained by all structures.
   *
   * OpenRA 对照: PowerManager.PowerDrained property
   *
   * @todo Stub — always returns 0. Full calculation deferred.
   * @returns total power consumption
   */
  get powerDrained(): number {
    return 0
  }
}
