/**
 * MapBuildRadius.ts — 地图级别的建造半径大厅选项 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/MapBuildRadius.cs (92 lines)
 *
 * 核心范式转换:
 * - C# TraitLocation(SystemActors.World) → TS 约定：注册到世界 Actor 上
 * - C# ILobbyOptions interface → TS ILobbyOptions + LobbyOptionStub
 * - C# yield return lobby options → TS 数组返回
 * - C# LobbyBooleanOption → TS LobbyOptionStub 桩
 * - C# World.LobbyInfo.GlobalSettings.OptionOrDefault → TS 简化：直接使用
 *   默认值（完整大厅系统在 Chapter 16）
 *
 * MapBuildRadius 控制建造范围显示的启用/禁用，包括：
 * - 友军建造范围（AllyBuildRadius）
 * - 己方建造范围（BuildRadius）
 */

import type {
  ITraitInfo,
  INotifyCreated,
  IGameActor,
  ILobbyOptions,
  LobbyOptionStub,
  MapPreviewStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// MapBuildRadiusInfo
// OpenRA 对照: MapBuildRadiusInfo : TraitInfo, ILobbyOptions
// ---------------------------------------------------------------------------

/** Configuration for the MapBuildRadius world trait.
 *
 * OpenRA 对照: MapBuildRadiusInfo
 *
 * Controls the ally and build radius checkboxes in the lobby options.
 * This is a World trait (registered on the WorldActor).
 */
export class MapBuildRadiusInfo implements ITraitInfo, ILobbyOptions {
  readonly instanceName?: string

  // ---- Ally Build Radius Checkbox ----

  /** Descriptive label for the ally build radius checkbox.
   *
   * OpenRA 对照: AllyBuildRadiusCheckboxLabel
   */
  readonly allyBuildRadiusCheckboxLabel: string

  /** Tooltip description for the ally build radius checkbox.
   *
   * OpenRA 对照: AllyBuildRadiusCheckboxDescription
   */
  readonly allyBuildRadiusCheckboxDescription: string

  /** Default value of the ally build radius checkbox.
   *
   * OpenRA 对照: AllyBuildRadiusCheckboxEnabled (default true)
   */
  readonly allyBuildRadiusCheckboxEnabled: boolean

  /** Whether the ally build radius checkbox is locked.
   *
   * OpenRA 对照: AllyBuildRadiusCheckboxLocked (default false)
   */
  readonly allyBuildRadiusCheckboxLocked: boolean

  /** Whether to display the ally build radius checkbox.
   *
   * OpenRA 对照: AllyBuildRadiusCheckboxVisible (default true)
   */
  readonly allyBuildRadiusCheckboxVisible: boolean

  /** Display order for the ally build radius checkbox.
   *
   * OpenRA 对照: AllyBuildRadiusCheckboxDisplayOrder (default 0)
   */
  readonly allyBuildRadiusCheckboxDisplayOrder: number

  // ---- Build Radius Checkbox ----

  /** Descriptive label for the build radius checkbox.
   *
   * OpenRA 对照: BuildRadiusCheckboxLabel
   */
  readonly buildRadiusCheckboxLabel: string

  /** Tooltip description for the build radius checkbox.
   *
   * OpenRA 对照: BuildRadiusCheckboxDescription
   */
  readonly buildRadiusCheckboxDescription: string

  /** Default value of the build radius checkbox.
   *
   * OpenRA 对照: BuildRadiusCheckboxEnabled (default true)
   */
  readonly buildRadiusCheckboxEnabled: boolean

  /** Whether the build radius checkbox is locked.
   *
   * OpenRA 对照: BuildRadiusCheckboxLocked (default false)
   */
  readonly buildRadiusCheckboxLocked: boolean

  /** Whether to display the build radius checkbox.
   *
   * OpenRA 对照: BuildRadiusCheckboxVisible (default true)
   */
  readonly buildRadiusCheckboxVisible: boolean

  /** Display order for the build radius checkbox.
   *
   * OpenRA 对照: BuildRadiusCheckboxDisplayOrder (default 0)
   */
  readonly buildRadiusCheckboxDisplayOrder: number

  constructor(params: {
    instanceName?: string
    // Ally build radius
    allyBuildRadiusCheckboxLabel?: string
    allyBuildRadiusCheckboxDescription?: string
    allyBuildRadiusCheckboxEnabled?: boolean
    allyBuildRadiusCheckboxLocked?: boolean
    allyBuildRadiusCheckboxVisible?: boolean
    allyBuildRadiusCheckboxDisplayOrder?: number
    // Build radius
    buildRadiusCheckboxLabel?: string
    buildRadiusCheckboxDescription?: string
    buildRadiusCheckboxEnabled?: boolean
    buildRadiusCheckboxLocked?: boolean
    buildRadiusCheckboxVisible?: boolean
    buildRadiusCheckboxDisplayOrder?: number
  } = {}) {
    this.instanceName = params.instanceName

    // Ally build radius defaults
    this.allyBuildRadiusCheckboxLabel =
      params.allyBuildRadiusCheckboxLabel ?? 'checkbox-ally-build-radius.label'
    this.allyBuildRadiusCheckboxDescription =
      params.allyBuildRadiusCheckboxDescription ??
      'checkbox-ally-build-radius.description'
    this.allyBuildRadiusCheckboxEnabled =
      params.allyBuildRadiusCheckboxEnabled ?? true
    this.allyBuildRadiusCheckboxLocked =
      params.allyBuildRadiusCheckboxLocked ?? false
    this.allyBuildRadiusCheckboxVisible =
      params.allyBuildRadiusCheckboxVisible ?? true
    this.allyBuildRadiusCheckboxDisplayOrder =
      params.allyBuildRadiusCheckboxDisplayOrder ?? 0

    // Build radius defaults
    this.buildRadiusCheckboxLabel =
      params.buildRadiusCheckboxLabel ?? 'checkbox-build-radius.label'
    this.buildRadiusCheckboxDescription =
      params.buildRadiusCheckboxDescription ??
      'checkbox-build-radius.description'
    this.buildRadiusCheckboxEnabled =
      params.buildRadiusCheckboxEnabled ?? true
    this.buildRadiusCheckboxLocked =
      params.buildRadiusCheckboxLocked ?? false
    this.buildRadiusCheckboxVisible =
      params.buildRadiusCheckboxVisible ?? true
    this.buildRadiusCheckboxDisplayOrder =
      params.buildRadiusCheckboxDisplayOrder ?? 0
  }

  // -----------------------------------------------------------------------
  // ILobbyOptions
  // OpenRA 对照: ILobbyOptions.LobbyOptions(MapPreview map)
  // -----------------------------------------------------------------------

  /** Return the lobby options (boolean checkboxes) for map build radius.
   *
   * OpenRA 对照: ILobbyOptions.LobbyOptions(MapPreview map)
   *
   * In OpenRA, this yields LobbyBooleanOption instances. In TS, we return
   * an array of LobbyOptionStub values. The full lobby UI system is
   * planned for Chapter 16.
   *
   * @param _map — the map preview (unused for stub implementation)
   * @returns array of lobby option stubs
   */
  lobbyOptions(_map: MapPreviewStub): readonly LobbyOptionStub[] {
    return [
      // Ally build radius option
      {
        id: 'allybuild',
        name: this.allyBuildRadiusCheckboxLabel,
        description: this.allyBuildRadiusCheckboxDescription,
        values: new Map([
          ['true', 'True'],
          ['false', 'False'],
        ]),
        defaultValue: this.allyBuildRadiusCheckboxEnabled ? 'true' : 'false',
        isLocked: this.allyBuildRadiusCheckboxLocked,
        isVisible: this.allyBuildRadiusCheckboxVisible,
        displayOrder: this.allyBuildRadiusCheckboxDisplayOrder,
      },
      // Build radius option
      {
        id: 'buildradius',
        name: this.buildRadiusCheckboxLabel,
        description: this.buildRadiusCheckboxDescription,
        values: new Map([
          ['true', 'True'],
          ['false', 'False'],
        ]),
        defaultValue: this.buildRadiusCheckboxEnabled ? 'true' : 'false',
        isLocked: this.buildRadiusCheckboxLocked,
        isVisible: this.buildRadiusCheckboxVisible,
        displayOrder: this.buildRadiusCheckboxDisplayOrder,
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// MapBuildRadius
// OpenRA 对照: MapBuildRadius : INotifyCreated
// ---------------------------------------------------------------------------

/** Controls the build radius display options at the map level.
 *
 * OpenRA 对照: MapBuildRadius
 *
 * Implements INotifyCreated to read lobby options during world creation.
 * BaseProvider traits check BuildRadiusEnabled and AllyBuildRadiusEnabled
 * to determine whether to show range circles.
 */
export class MapBuildRadius implements INotifyCreated {
  /** The configuration info for this trait. */
  readonly info: MapBuildRadiusInfo

  /** Whether ally build radius display is enabled.
   *
   * OpenRA 对照: MapBuildRadius.AllyBuildRadiusEnabled
   */
  allyBuildRadiusEnabled: boolean

  /** Whether build radius display is enabled.
   *
   * OpenRA 对照: MapBuildRadius.BuildRadiusEnabled
   */
  buildRadiusEnabled: boolean

  /** Construct a MapBuildRadius trait.
   *
   * OpenRA 对照: MapBuildRadius(MapBuildRadiusInfo info)
   *
   * @param info — configuration for this trait
   */
  constructor(info: MapBuildRadiusInfo) {
    this.info = info
    // Default to info defaults until created() reads lobby options
    this.allyBuildRadiusEnabled = info.allyBuildRadiusCheckboxEnabled
    this.buildRadiusEnabled = info.buildRadiusCheckboxEnabled
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: INotifyCreated.Created(Actor self)
  // -----------------------------------------------------------------------

  /** Called when this trait's actor is created.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor self)
   *
   * Reads lobby options from the world's lobby info to determine
   * whether ally build radius and build radius display are enabled.
   *
   * @param _self — the world actor this trait is attached to
   */
  created(_self: IGameActor): void {
    // NOTE: Full lobby info integration deferred to Chapter 16.
    // In OpenRA, this reads from self.World.LobbyInfo.GlobalSettings
    // .OptionOrDefault("allybuild", ...) and .OptionOrDefault("buildradius", ...).
    //
    // For now, the values initialized in the constructor (from info defaults)
    // are used. When the lobby system is implemented, this method will
    // read the actual lobby option values.
    //
    // Integrate with full lobby info system (Ch16).
  }
}
