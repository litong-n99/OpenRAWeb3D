/**
 * DeveloperMode.ts — 开发者模式/作弊管理器 (完整迁移)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/DeveloperMode.cs
 *
 * 核心范式转换:
 * - C# TraitInfo + ILobbyOptions → TS data class implementing ITraitInfo
 * - C# reflection-based self.Trait<T>() → TS optional chaining on IGameActor
 * - C# IResolveOrder/INotifyCreated/IUnlocksRenderPlayer/ISync → TS interfaces
 * - C# FluentProvider / TextNotificationsManager → TS stub (console.debug)
 * - C# LINQ Where/ForEach → TS for-of loops
 */

import type {
  IGameActor,
  IResolveOrder,
  INotifyCreated,
  ISync,
  IUnlocksRenderPlayer,
  ITraitInfo,
  ILobbyOptions,
  MapPreviewStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
// NOTE: Order is imported from TraitsInterfaces (where it = OrderStub) for
// IResolveOrder interface conformance. Internal code casts to access full API.
import type { Order } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { LobbyOptionStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  TargetType,
} from '../../../OpenRA.Game/Traits/Target.js'
import {
  Damage,
  type IHealth,
  type ISeedableResource,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// LobbyBooleanOption — simple lobby option helper
// OpenRA 对照: LobbyBooleanOption (in OpenRA.Game/Network/LobbyOption.cs)
// ---------------------------------------------------------------------------

/** A boolean lobby option for the developer mode checkbox.
 *
 * OpenRA 对照: LobbyBooleanOption
 */
class LobbyBooleanOption implements LobbyOptionStub {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly values: ReadonlyMap<string, string>
  readonly defaultValue: string
  readonly isLocked: boolean
  readonly isVisible: boolean
  readonly displayOrder: number

  constructor(
    id: string,
    name: string,
    description: string,
    isVisible: boolean,
    displayOrder: number,
    defaultValue: boolean,
    isLocked: boolean,
  ) {
    this.id = id
    this.name = name
    this.description = description
    this.values = new Map<string, string>([
      ['true', 'Enabled'],
      ['false', 'Disabled'],
    ])
    this.defaultValue = defaultValue ? 'true' : 'false'
    this.isLocked = isLocked
    this.isVisible = isVisible
    this.displayOrder = displayOrder
  }
}

// ---------------------------------------------------------------------------
// DeveloperModeInfo
// OpenRA 对照: DeveloperModeInfo : TraitInfo, ILobbyOptions
// ---------------------------------------------------------------------------

/** Configuration for the DeveloperMode trait.
 *
 * OpenRA 对照: DeveloperModeInfo
 *
 * Controls all cheat mode defaults and the lobby checkbox. Implements
 * ILobbyOptions to expose a "cheats" toggle in the game lobby.
 */
export class DeveloperModeInfo implements ITraitInfo, ILobbyOptions {
  readonly instanceName?: string

  // -----------------------------------------------------------------------
  // Lobby option fields (对应 OpenRA FluentReference / Desc attributes)
  // -----------------------------------------------------------------------

  /** Descriptive label for the developer mode checkbox in the lobby. */
  readonly checkboxLabel: string

  /** Tooltip description for the developer mode checkbox in the lobby. */
  readonly checkboxDescription: string

  /** Default value of the developer mode checkbox in the lobby. */
  readonly checkboxEnabled: boolean

  /** Prevent the developer mode state from being changed in the lobby. */
  readonly checkboxLocked: boolean

  /** Whether to display the developer mode checkbox in the lobby. */
  readonly checkboxVisible: boolean

  /** Display order for the developer mode checkbox in the lobby. */
  readonly checkboxDisplayOrder: number

  // -----------------------------------------------------------------------
  // Cheat configuration defaults
  // -----------------------------------------------------------------------

  /** Default cash bonus granted by the give cash cheat. */
  readonly cash: number

  /** Growth steps triggered by the grow resources button. */
  readonly resourceGrowth: number

  /** Enable the fast build cheat by default. */
  readonly fastBuild: boolean

  /** Enable the fast support powers cheat by default. */
  readonly fastCharge: boolean

  /** Enable the disable visibility cheat by default. */
  readonly disableShroud: boolean

  /** Enable the unlimited power cheat by default. */
  readonly unlimitedPower: boolean

  /** Enable the build anywhere cheat by default. */
  readonly buildAnywhere: boolean

  /** Enable the path debug overlay by default. */
  readonly pathDebug: boolean

  constructor(params: Partial<DeveloperModeInfoFields> = {}) {
    this.instanceName = params.instanceName
    this.checkboxLabel = params.checkboxLabel ?? 'checkbox-debug-menu.label'
    this.checkboxDescription = params.checkboxDescription ?? 'checkbox-debug-menu.description'
    this.checkboxEnabled = params.checkboxEnabled ?? false
    this.checkboxLocked = params.checkboxLocked ?? false
    this.checkboxVisible = params.checkboxVisible ?? true
    this.checkboxDisplayOrder = params.checkboxDisplayOrder ?? 0
    this.cash = params.cash ?? 20000
    this.resourceGrowth = params.resourceGrowth ?? 100
    this.fastBuild = params.fastBuild ?? false
    this.fastCharge = params.fastCharge ?? false
    this.disableShroud = params.disableShroud ?? false
    this.unlimitedPower = params.unlimitedPower ?? false
    this.buildAnywhere = params.buildAnywhere ?? false
    this.pathDebug = params.pathDebug ?? false
  }

  /** Provide the lobby options for the cheats checkbox.
   *
   * OpenRA 对照: ILobbyOptions.LobbyOptions(MapPreview)
   */
  lobbyOptions(_map: MapPreviewStub): readonly LobbyOptionStub[] {
    return [
      new LobbyBooleanOption(
        'cheats',
        this.checkboxLabel,
        this.checkboxDescription,
        this.checkboxVisible,
        this.checkboxDisplayOrder,
        this.checkboxEnabled,
        this.checkboxLocked,
      ),
    ]
  }
}

/** Constructor parameter type for DeveloperModeInfo. */
export interface DeveloperModeInfoFields {
  instanceName?: string
  checkboxLabel: string
  checkboxDescription: string
  checkboxEnabled: boolean
  checkboxLocked: boolean
  checkboxVisible: boolean
  checkboxDisplayOrder: number
  cash: number
  resourceGrowth: number
  fastBuild: boolean
  fastCharge: boolean
  disableShroud: boolean
  unlimitedPower: boolean
  buildAnywhere: boolean
  pathDebug: boolean
}

// ---------------------------------------------------------------------------
// DeveloperMode
// OpenRA 对照: DeveloperMode : IResolveOrder, ISync, INotifyCreated,
//   IUnlocksRenderPlayer
// ---------------------------------------------------------------------------

/** Manages developer/cheat mode state for a player.
 *
 * OpenRA 对照: DeveloperMode
 *
 * This is a Player trait (attached to the player actor). It gates all
 * cheat/debug commands. When `enabled` is false, all cheat properties
 * return false regardless of their internal state.
 *
 * Key design:
 * - All public boolean properties are AND'ed with `enabled` (matching C#).
 * - `enabled` is set in `created()` based on lobby settings.
 * - `resolveOrder()` processes all developer command orders.
 */
export class DeveloperMode
  implements IResolveOrder, ISync, INotifyCreated, IUnlocksRenderPlayer
{
  // -------------------------------------------------------------------------
  // Orders constants (对应 OpenRA DeveloperMode.Orders)
  // -------------------------------------------------------------------------

  static readonly Orders = {
    All: 'DevAll',
    EnableTech: 'DevEnableTech',
    FastCharge: 'DevFastCharge',
    FastBuild: 'DevFastBuild',
    GiveCash: 'DevGiveCash',
    GiveCashAll: 'DevGiveCashAll',
    GrowResources: 'DevGrowResources',
    Visibility: 'DevVisibility',
    GiveExploration: 'DevGiveExploration',
    ResetExploration: 'DevResetExploration',
    UnlimitedPower: 'DevUnlimitedPower',
    BuildAnywhere: 'DevBuildAnywhere',
    PlayerExperience: 'DevPlayerExperience',
    Heal: 'DevHeal',
    Kill: 'DevKill',
    Dispose: 'DevDispose',
  } as const

  /** Order name for the PathFinderOverlay debug toggle.
   *
   * OpenRA 对照: PathFinderOverlay.OrderName = "DevPathDebug"
   */
  static readonly PATH_DEBUG_ORDER_NAME = 'DevPathDebug'

  // -------------------------------------------------------------------------
  // Notification constants (对应 OpenRA FluentReference strings)
  // -------------------------------------------------------------------------

  /** Notification key when a cheat is used (includes amount suffix). */
  static readonly CHEAT_USED = 'notification-cheat-used'

  /** Notification key when a cheat toggle is enabled. */
  static readonly CHEAT_ENABLED = 'notification-cheat-enabled'

  /** Notification key when a cheat toggle is disabled. */
  static readonly CHEAT_DISABLED = 'notification-cheat-disabled'

  // -------------------------------------------------------------------------
  // Instance fields
  // -------------------------------------------------------------------------

  readonly info: DeveloperModeInfo

  /** Whether developer mode is currently enabled.
   *
   * OpenRA 对照: DeveloperMode.Enabled
   *
   * Set in `created()` based on lobby. When false, all cheat properties
   * (AllTech, FastBuild, etc.) return false.
   */
  enabled: boolean = false

  // -------------------------------------------------------------------------
  // Private state (对应 OpenRA [VerifySync] fields)
  // -------------------------------------------------------------------------

  private _fastCharge: boolean
  private _allTech: boolean = false
  private _fastBuild: boolean
  private _disableShroud: boolean
  private _pathDebug: boolean
  private _unlimitedPower: boolean
  private _buildAnywhere: boolean
  private _enableAll: boolean = false

  // -------------------------------------------------------------------------
  // Public cheat properties (gated by enabled — 对应 OpenRA computed props)
  // -------------------------------------------------------------------------

  /** Whether fast support powers are enabled.
   *
   * OpenRA 对照: DeveloperMode.FastCharge => Enabled && fastCharge
   */
  get fastCharge(): boolean {
    return this.enabled && this._fastCharge
  }

  /** Whether all tech tree prerequisites are granted.
   *
   * OpenRA 对照: DeveloperMode.AllTech => Enabled && allTech
   */
  get allTech(): boolean {
    return this.enabled && this._allTech
  }

  /** Whether fast build mode is enabled (0-tick build time).
   *
   * OpenRA 对照: DeveloperMode.FastBuild => Enabled && fastBuild
   */
  get fastBuild(): boolean {
    return this.enabled && this._fastBuild
  }

  /** Whether the shroud (fog of war) is disabled.
   *
   * OpenRA 对照: DeveloperMode.DisableShroud => Enabled && disableShroud
   */
  get disableShroud(): boolean {
    return this.enabled && this._disableShroud
  }

  /** Whether the path debug overlay is enabled.
   *
   * OpenRA 对照: DeveloperMode.PathDebug => Enabled && pathDebug
   */
  get pathDebug(): boolean {
    return this.enabled && this._pathDebug
  }

  /** Whether unlimited power cheat is enabled.
   *
   * OpenRA 对照: DeveloperMode.UnlimitedPower => Enabled && unlimitedPower
   */
  get unlimitedPower(): boolean {
    return this.enabled && this._unlimitedPower
  }

  /** Whether build anywhere cheat is enabled.
   *
   * OpenRA 对照: DeveloperMode.BuildAnywhere => Enabled && buildAnywhere
   */
  get buildAnywhere(): boolean {
    return this.enabled && this._buildAnywhere
  }

  // -------------------------------------------------------------------------
  // IUnlocksRenderPlayer
  // -------------------------------------------------------------------------

  /** Whether the render player is unlocked (allows spectator-like view).
   *
   * OpenRA 对照: IUnlocksRenderPlayer.RenderPlayerUnlocked => Enabled
   */
  get renderPlayerUnlocked(): boolean {
    return this.enabled
  }

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA DeveloperMode constructor)
  // -------------------------------------------------------------------------

  constructor(info: DeveloperModeInfo = new DeveloperModeInfo()) {
    this.info = info
    this._fastBuild = info.fastBuild
    this._fastCharge = info.fastCharge
    this._disableShroud = info.disableShroud
    this._pathDebug = info.pathDebug
    this._unlimitedPower = info.unlimitedPower
    this._buildAnywhere = info.buildAnywhere
  }

  // -------------------------------------------------------------------------
  // INotifyCreated (对应 OpenRA INotifyCreated.Created)
  // -------------------------------------------------------------------------

  /** Called when the actor is fully created.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor)
   *
   * Sets enabled based on lobby settings:
   * - Single player (non-bot count == 1): always enabled
   * - Multiplayer: enabled if lobby "cheats" option is true
   */
  created(self: IGameActor): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    if (!world) {
      this.enabled = this.info.checkboxEnabled
      return
    }

    // Check if single player (only one non-bot player)
    const players = world.players
    if (Array.isArray(players)) {
      let nonBotCount = 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of players as any[]) {
        if (!p.isBot) nonBotCount++
      }

      if (nonBotCount <= 1) {
        this.enabled = true
        return
      }
    }

    // In multiplayer, check lobby option
    const lobbyInfo = world.lobbyInfo
    if (lobbyInfo?.globalSettings?.optionOrDefault) {
      this.enabled = lobbyInfo.globalSettings.optionOrDefault(
        'cheats',
        this.info.checkboxEnabled,
      )
    } else {
      this.enabled = this.info.checkboxEnabled
    }
  }

  // -------------------------------------------------------------------------
  // IResolveOrder (对应 OpenRA DeveloperMode.ResolveOrder)
  // -------------------------------------------------------------------------

  /** Process a developer command order.
   *
   * OpenRA 对照: DeveloperMode.ResolveOrder(Actor, Order)
   *
   * Handles all cheat toggles and actions. Returns immediately if
   * `enabled` is false.
   *
   * @param self — the player actor
   * @param order — the order to process
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (!this.enabled) return

    // Cast to access full Order API (OrderStub only has orderName/targetString/extraData)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = order as any
    const orderStr: string = o.orderString ?? o.orderName ?? ''
    let debugSuffix = ''

    switch (orderStr) {
      // -------------------------------------------------------------------
      // All — toggle all cheats at once
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.All: {
        this._enableAll = !this._enableAll
        this._allTech = this._enableAll
        this._fastCharge = this._enableAll
        this._fastBuild = this._enableAll
        this._disableShroud = this._enableAll
        this._unlimitedPower = this._enableAll
        this._buildAnywhere = this._enableAll

        if (this._enableAll) {
          const amount: number = o.extraData !== 0 ? o.extraData : this.info.cash
          this._giveCashToSelf(self, amount)
        }

        this._updateShroudState(self)
        this._updateRenderPlayer(self)
        break
      }

      // -------------------------------------------------------------------
      // EnableTech — toggle all tech tree unlock
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.EnableTech: {
        this._allTech = !this._allTech
        break
      }

      // -------------------------------------------------------------------
      // FastCharge — toggle fast support powers
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.FastCharge: {
        this._fastCharge = !this._fastCharge
        break
      }

      // -------------------------------------------------------------------
      // FastBuild — toggle fast build (0-tick build time)
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.FastBuild: {
        this._fastBuild = !this._fastBuild
        break
      }

      // -------------------------------------------------------------------
      // GiveCash — give cash to this player
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.GiveCash: {
        const amount: number = o.extraData !== 0 ? o.extraData : this.info.cash
        this._giveCashToSelf(self, amount)
        debugSuffix = ` (${amount} credits)`
        break
      }

      // -------------------------------------------------------------------
      // GiveCashAll — give cash to all playable players
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.GiveCashAll: {
        const amount: number = o.extraData !== 0 ? o.extraData : this.info.cash
        this._giveCashToAll(self, amount)
        debugSuffix = ` (${amount} credits)`
        break
      }

      // -------------------------------------------------------------------
      // GrowResources — grow resources on the map
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.GrowResources: {
        this._growResources(self)
        break
      }

      // -------------------------------------------------------------------
      // Visibility — toggle shroud disable
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.Visibility: {
        this._disableShroud = !this._disableShroud
        this._updateShroudState(self)
        this._updateRenderPlayer(self)
        break
      }

      // -------------------------------------------------------------------
      // Path debug — toggle path debug overlay
      // -------------------------------------------------------------------
      case DeveloperMode.PATH_DEBUG_ORDER_NAME: {
        this._pathDebug = !this._pathDebug
        break
      }

      // -------------------------------------------------------------------
      // GiveExploration — explore entire map
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.GiveExploration: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const owner = self.owner as any
        owner?.shroud?.exploreAll?.()
        break
      }

      // -------------------------------------------------------------------
      // ResetExploration — reset map exploration
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.ResetExploration: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const owner = self.owner as any
        owner?.shroud?.resetExploration?.()
        break
      }

      // -------------------------------------------------------------------
      // UnlimitedPower — toggle unlimited power cheat
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.UnlimitedPower: {
        this._unlimitedPower = !this._unlimitedPower
        break
      }

      // -------------------------------------------------------------------
      // BuildAnywhere — toggle build anywhere cheat
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.BuildAnywhere: {
        this._buildAnywhere = !this._buildAnywhere
        break
      }

      // -------------------------------------------------------------------
      // PlayerExperience — give experience to player
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.PlayerExperience: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const owner = self.owner as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playerActor = owner?.playerActor as any
        const exp = playerActor?.traitOrDefault?.('PlayerExperience')
        if (exp?.giveExperience) {
          exp.giveExperience(o.extraData)
        }
        break
      }

      // -------------------------------------------------------------------
      // Heal — heal target actor to full HP
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.Heal: {
        const target = o.target
        if (!target || target.type !== TargetType.Actor) break

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actor = target.actor as any
        if (!actor) break

        const health = this._getTraitOrDefault<IHealth>(actor, 'IHealth')
        if (health) {
          health.inflictDamage(
            actor,
            actor,
            new Damage(-health.maxHP),
            true,
          )
        }
        break
      }

      // -------------------------------------------------------------------
      // Kill — kill target actor
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.Kill: {
        const target = o.target
        if (!target || target.type !== TargetType.Actor) break

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actor = target.actor as any
        if (!actor) break

        const targetStr: string = o.targetString ?? ''
        const args = targetStr.split(' ')

        // Integrate with BitSet<DamageType> when fully
        // available. For now, pass empty BitSetStub.
        const damageTypes = {
          contains: (_v: number) => false,
          isEmpty: () => true,
        }

        // NOTE: kill may be on IActorRef via duck-typing, or on IHealth
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (actor as any).kill === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (actor as any).kill(actor, damageTypes)
        }
        // Also try IHealth.kill if directly available
        const health = this._getTraitOrDefault<IHealth>(actor, 'IHealth')
        if (health) {
          health.kill(actor, actor, damageTypes)
        }

        // Suppress unused warning for args — used in C# BitSet<DamageType>
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        void args
        break
      }

      // -------------------------------------------------------------------
      // Dispose — silently remove target actor
      // -------------------------------------------------------------------
      case DeveloperMode.Orders.Dispose: {
        const target = o.target
        if (!target || target.type !== TargetType.Actor) break

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actor = target.actor as any
        if (!actor) break

        // NOTE: dispose may be on IActorRef via duck-typing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (actor as any).dispose === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (actor as any).dispose()
        }
        break
      }

      // -------------------------------------------------------------------
      // Unknown order — return silently
      // -------------------------------------------------------------------
      default:
        return
    }

    // Emit notification
    this._emitNotification(self, orderStr, debugSuffix)
  }

  // -------------------------------------------------------------------------
  // checkPermission (convenience — 对应常见权限检查模式)
  // -------------------------------------------------------------------------

  /** Check if a player has developer mode enabled.
   *
   * This is a convenience method for gate checks throughout the codebase.
   * In OpenRA, this is typically done by checking `developerMode.Enabled`
   * directly. This static method provides a null-safe alternative.
   *
   * @param devMode — the DeveloperMode instance (may be null/undefined)
   * @returns true if developer mode is enabled for this player
   */
  static checkPermission(devMode: DeveloperMode | null | undefined): boolean {
    return devMode?.enabled ?? false
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Give cash to the owning player's resources.
   *
   * OpenRA 对照: self.Trait<PlayerResources>().ChangeCash(amount)
   */
  private _giveCashToSelf(self: IGameActor, amount: number): void {
    // NOTE: PlayerResources trait is on the player actor.
    // Use traitsImplementing to find it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resList = self.traitsImplementing?.('PlayerResources') as any[]
    if (resList && resList.length > 0 && typeof resList[0].changeCash === 'function') {
      resList[0].changeCash(amount)
    }
  }

  /** Give cash to all playable players.
   *
   * OpenRA 对照: world.Players.Where(p => p.Playable).ForEach(...)
   */
  private _giveCashToAll(self: IGameActor, amount: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const players = world?.players as any[]
    if (!Array.isArray(players)) return

    for (const player of players) {
      if (player.playable !== false) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playerActor = player.playerActor as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resList = playerActor?.traitsImplementing?.('PlayerResources') as any[]
        if (resList && resList.length > 0 && typeof resList[0].changeCash === 'function') {
          resList[0].changeCash(amount)
        }
      }
    }
  }

  /** Grow resources across the map.
   *
   * OpenRA 对照: world.ActorsWithTrait<ISeedableResource>().ForEach(...)
   */
  private _growResources(self: IGameActor): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allActors = world?.allActors?.() as any[] | undefined
    if (!allActors) return

    // When ISeedableResource trait is fully available on actors,
    // use traitsImplementing('ISeedableResource') to enumerate.
    for (const actor of allActors) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seedableList = actor.traitsImplementing?.('ISeedableResource') as ISeedableResource[]
      if (seedableList) {
        for (const trait of seedableList) {
          for (let i = 0; i < this.info.resourceGrowth; i++) {
            trait.seed(actor)
          }
        }
      }
    }
  }

  /** Update shroud disabled state on the owner's Shroud trait.
   *
   * OpenRA 对照: self.Owner.Shroud.Disabled = DisableShroud
   */
  private _updateShroudState(self: IGameActor): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owner = self.owner as any
    const shroud = owner?.shroud
    if (shroud && 'disabled' in shroud) {
      shroud.disabled = this.disableShroud
    }
  }

  /** Update the render player based on shroud visibility.
   *
   * OpenRA 对照: if (world.LocalPlayer == self.Owner)
   *   world.RenderPlayer = DisableShroud ? null : self.Owner
   */
  private _updateRenderPlayer(self: IGameActor): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    const owner = self.owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((world as any)?.localPlayer === owner) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (world as any).renderPlayer = this.disableShroud ? null : owner
    }
  }

  /** Get a trait from an actor by interface name, or return undefined.
   *
   * OpenRA 对照: actor.TraitOrDefault<T>()
   */
  private _getTraitOrDefault<T>(actor: IGameActor, interfaceName: string): T | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = actor.traitsImplementing?.(interfaceName) as unknown[] | undefined
    if (list && list.length > 0) {
      return list[0] as T
    }
    return undefined
  }

  /** Emit a debug notification for the given order.
   *
   * OpenRA 对照: TextNotificationsManager.Debug(FluentProvider.GetMessage(...))
   *
   * NOTE: TextNotificationsManager and FluentProvider are not yet migrated.
   * For now, uses console.debug as a placeholder.
* Integrate with TextNotificationsManager when available.
   */
  private _emitNotification(
    self: IGameActor,
    orderString: string,
    debugSuffix: string,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owner = self.owner as any
    const playerName = owner?.resolvedPlayerName ?? owner?.playerName ?? 'Unknown'

    // Determine notification type based on order
    let notification: string
    switch (orderString) {
      case DeveloperMode.Orders.All:
        notification = this._enableAll ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.Orders.EnableTech:
        notification = this._allTech ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.Orders.FastCharge:
        notification = this._fastCharge ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.Orders.FastBuild:
        notification = this._fastBuild ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.Orders.Visibility:
        notification = this._disableShroud ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.PATH_DEBUG_ORDER_NAME:
        notification = this._pathDebug ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.Orders.UnlimitedPower:
        notification = this._unlimitedPower ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      case DeveloperMode.Orders.BuildAnywhere:
        notification = this._buildAnywhere ? DeveloperMode.CHEAT_ENABLED : DeveloperMode.CHEAT_DISABLED
        break
      default:
        notification = DeveloperMode.CHEAT_USED
        break
    }

    // NOTE: Full FluentProvider.GetMessage integration pending.
    // For now, log to console.debug as a placeholder.
    if (notification === DeveloperMode.CHEAT_USED) {
      console.debug(
        `[DevMode] CHEAT_USED: cheat=${orderString} player=${playerName} suffix=${debugSuffix}`,
      )
    } else {
      console.debug(
        `[DevMode] ${notification}: cheat=${orderString} player=${playerName}`,
      )
    }
  }
}
