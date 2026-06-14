/**
 * DeveloperMode.ts — 开发者模式/作弊管理器桩
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/DeveloperMode.cs
 *
 * 核心范式转换:
 * - C# DeveloperModeInfo 完整配置 → TS 桩，仅保留生产队列需要的字段
 * - C# DeveloperMode 完整实现 → TS 桩，仅返回配置值
 *
 * @todo 完整实现推迟至后续章节。当前桩提供 ProductionQueue 所需的
 *   fastBuild、allTech、buildAnywhere、unlimitedPower 作弊开关。
 */

// ---------------------------------------------------------------------------
// DeveloperModeInfo
// OpenRA 对照: DeveloperModeInfo
// ---------------------------------------------------------------------------

/** Configuration for the DeveloperMode trait.
 *
 * OpenRA 对照: DeveloperModeInfo
 *
 * Controls cheat modes available in developer/debug builds. All flags
 * default to false (disabled) for normal gameplay.
 *
 * @todo Full implementation deferred. Current stub has minimal fields
 *   needed by ProductionQueue. Full DeveloperMode (instant build,
 *   visibility cheats, etc.) will be implemented in a later chapter.
 */
export class DeveloperModeInfo {
  readonly instanceName?: string

  /** Enable instant build (0 tick build time).
   *
   * OpenRA 对照: DeveloperModeInfo.FastBuild
   */
  readonly fastBuild: boolean = false

  /** Grant all tech tree prerequisites.
   *
   * OpenRA 对照: DeveloperModeInfo.AllTech
   */
  readonly allTech: boolean = false

  /** Allow building placement anywhere (ignore terrain/footprint rules).
   *
   * OpenRA 对照: DeveloperModeInfo.BuildAnywhere
   */
  readonly buildAnywhere: boolean = false

  /** Disable power consumption checks.
   *
   * OpenRA 对照: DeveloperModeInfo.UnlimitedPower
   */
  readonly unlimitedPower: boolean = false

  constructor(params: {
    instanceName?: string
    fastBuild?: boolean
    allTech?: boolean
    buildAnywhere?: boolean
    unlimitedPower?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.fastBuild = params.fastBuild ?? false
    this.allTech = params.allTech ?? false
    this.buildAnywhere = params.buildAnywhere ?? false
    this.unlimitedPower = params.unlimitedPower ?? false
  }
}

// ---------------------------------------------------------------------------
// DeveloperMode
// OpenRA 对照: DeveloperMode
// ---------------------------------------------------------------------------

/** Manages developer/cheat mode state for a player.
 *
 * OpenRA 对照: DeveloperMode
 *
 * @todo Full implementation deferred. Current stub returns config values
 *   directly. ProductionQueue uses this for:
 *   - fastBuild: zero build time
 *   - allTech: bypass prerequisite checks
 *   - buildAnywhere: skip placement validation
 *   - unlimitedPower: ignore low-power slowdown
 */
export class DeveloperMode {
  readonly info: DeveloperModeInfo

  constructor(info: DeveloperModeInfo = new DeveloperModeInfo()) {
    this.info = info
  }

  /** Whether instant build is enabled.
   *
   * OpenRA 对照: DeveloperMode.FastBuild
   *
   * When true, ProductionQueue.getBuildTime() returns 0 for all items.
   */
  get fastBuild(): boolean {
    return this.info.fastBuild
  }

  /** Whether all tech tree prerequisites are granted.
   *
   * OpenRA 对照: DeveloperMode.AllTech
   *
   * When true, ProductionQueue bypasses prerequisite checks.
   */
  get allTech(): boolean {
    return this.info.allTech
  }

  /** Whether building placement restrictions are bypassed.
   *
   * OpenRA 对照: DeveloperMode.BuildAnywhere
   */
  get buildAnywhere(): boolean {
    return this.info.buildAnywhere
  }

  /** Whether power checks are bypassed.
   *
   * OpenRA 对照: DeveloperMode.UnlimitedPower
   *
   * When true, ProductionQueue ignores low-power build time slowdown.
   */
  get unlimitedPower(): boolean {
    return this.info.unlimitedPower
  }
}
