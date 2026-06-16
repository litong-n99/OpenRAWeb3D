/**
 * LobbyUtils.ts — Multiplayer lobby static utility functions
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyUtils.cs (707 lines)
 *
 * 核心范式转换:
 * - C# static class with FluentReference constants → TypeScript standalone functions
 * - C# Widget Get<T>/GetOrNull pattern → direct widget property access
 * - C# CachedTransform deferred evaluation → CachedTransform from LobbyTypes
 * - C# FluentProvider.GetMessage → stub function (TODO-16.C.1 Fluent migration)
 * - C# Color (System.Drawing) → hex string color
 * - C# ShowDropDown<T> with delegate factories → TypeScript showDropDown
 * - C# SplitOnFirstToken (tuple return) → TypeScript with nullable strings
 */

import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { CheckboxWidget } from '../../CheckboxWidget.js'
import type { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import type { LabelWidget } from '../../LabelWidget.js'
import type { ImageWidget } from '../../ImageWidget.js'
import type { ColorBlockWidget } from '../../ColorBlockWidget.js'
import { WidgetUtils } from '../../WidgetUtils.js'

// ---------------------------------------------------------------------------
// Helper: access child widget by ID from widget tree
// ---------------------------------------------------------------------------

import {
  CachedTransform,
  PredictedCachedTransform,
  ClientState,
  ConnectionQuality,
  type SessionClient,
  type SessionSlot,
  type LobbyInfo,
  type LobbyFaction,
  type MapPreviewLobby,
  type DropDownOption,
  type OrderManagerLobby,
} from './LobbyTypes.js'

// ---------------------------------------------------------------------------
// Helper: access child widget by ID from widget tree
// ---------------------------------------------------------------------------

function widgetChild<T extends Widget = Widget>(parent: Widget, id: string): T | undefined {
  return (parent as unknown as Record<string, unknown>)[id] as T | undefined
}

// ---------------------------------------------------------------------------
// Fluent message stub (TODO-16.C.1)
// ---------------------------------------------------------------------------

/** Stub for FluentProvider.GetMessage — returns key as-is.
 *
 * TODO-16.C.1: Replace with real FluentProvider when localization is migrated.
 */
function fluentMsg(key: string, ..._args: string[]): string {
  return key
}

// ---------------------------------------------------------------------------
// Color utilities
// OpenRA 对照: implicit in OpenRA.Primitives.Color
// ---------------------------------------------------------------------------

/**
 * Calculate relative luminance of a hex color.
 * Uses sRGB luminance formula (ITU-R BT.709).
 *
 * OpenRA 对照: Used for choose contrasting text color (white/black on color bg)
 */
function relativeLuminance(hexColor: string): number {
  const r = parseInt(hexColor.substring(0, 2), 16) / 255
  const g = parseInt(hexColor.substring(2, 4), 16) / 255
  const b = parseInt(hexColor.substring(4, 6), 16) / 255

  const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear
}

/**
 * Get contrasting text color for a background color.
 * White text if bg luminance < 128 (dark background), else black text.
 *
 * OpenRA 对照: LobbyUtils.GetPlayerColor()
 */
export function getPlayerColor(bgColor: string): string {
  return relativeLuminance(bgColor) < 0.5 ? 'FFFFFF' : '000000'
}

// ---------------------------------------------------------------------------
// Latency color and description
// OpenRA 对照: LobbyUtils.LatencyColor + LobbyUtils.LatencyDescription
// ---------------------------------------------------------------------------

/** Get latency indicator color for a client.
 *
 * OpenRA 对照: LobbyUtils.LatencyColor(Session.Client)
 */
export function latencyColor(client: SessionClient | null): string {
  if (!client) return '888888' // Gray
  switch (client.connectionQuality) {
    case ConnectionQuality.Good: return '32CD32' // LimeGreen
    case ConnectionQuality.Moderate: return 'FFA500' // Orange
    case ConnectionQuality.Poor: return 'FF0000' // Red
    default: return '888888' // Gray
  }
}

/** Get latency text description for a client.
 *
 * OpenRA 对照: LobbyUtils.LatencyDescription(Session.Client)
 */
export function latencyDescription(client: SessionClient | null): string {
  if (!client) return 'Unknown'
  switch (client.connectionQuality) {
    case ConnectionQuality.Good: return 'Good'
    case ConnectionQuality.Moderate: return 'Moderate'
    case ConnectionQuality.Poor: return 'Poor'
    default: return 'Unknown'
  }
}

// ---------------------------------------------------------------------------
// Slot state image helper
// OpenRA 对照: LobbyUtils.SlotStateImage (implicit via state string selection)
// ---------------------------------------------------------------------------

/** Get slot state image name for a given state.
 *
 * OpenRA 对照: implicit in lobbyslot YAML templates
 */
export function slotStateImage(state: string): string {
  return `slot-${state.toLowerCase()}`
}

/** Get client state image name for a given state.
 *
 * OpenRA 对照: implicit in lobby player template STATUS_IMAGE
 */
export function clientStateImage(state: string): string {
  return `client-${state.toLowerCase()}`
}

// ---------------------------------------------------------------------------
// SplitOnFirstToken — split string on first occurrence of delimiter
// OpenRA 对照: LobbyUtils.SplitOnFirstToken(string, string = "\n")
// ---------------------------------------------------------------------------

/** Splits a string into two parts on the first instance of a given token.
 *
 * OpenRA 对照: LobbyUtils.SplitOnFirstToken(string input, string token = "\n")
 *
 * @param input — input string
 * @param token — delimiter token (default newline)
 * @returns tuple of [first, second]; second is null if token not found
 */
export function splitOnFirstToken(
  input: string | null,
  token = '\n',
): [string | null, string | null] {
  if (!input) return [null, null]

  const split = input.indexOf(token)
  if (split < 0) return [input, null]

  const first = input.substring(0, split)
  const second = input.substring(split + token.length) || null
  return [first, second]
}

// ---------------------------------------------------------------------------
// Populate faction dropdown
// OpenRA 对照: LobbyUtils.ShowFactionDropDown
// ---------------------------------------------------------------------------

/**
 * Show faction selection dropdown for a client.
 *
 * OpenRA 对照: LobbyUtils.ShowFactionDropDown(DropDownButtonWidget, Session.Client, OrderManager, Dictionary<string, LobbyFaction>)
 */
export function showFactionDropDown(
  dropdown: DropDownButtonWidget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  factions: Record<string, LobbyFaction>,
): void {
  // Group factions by side, filter only selectable
  const bySide = new Map<string, string[]>()
  for (const [factionId, faction] of Object.entries(factions)) {
    if (!faction.selectable) continue
    const sideKey = faction.side ? fluentMsg(faction.side) : ''
    const list = bySide.get(sideKey) || []
    list.push(factionId)
    bySide.set(sideKey, list)
  }

  // Build options dictionary
  const options: Record<string, string[]> = {}
  for (const [side, ids] of bySide) {
    options[side] = ids.map(id => fluentMsg(id))
  }

  function setupItem(factionId: string, _template: unknown): unknown {
    const faction = factions[factionId]
    if (!faction) return {}

    const selected = () => client.faction === factionId
    const onClick = () => {
      orderManager.issueOrder({
        type: 'command',
        text: `faction ${client.index} ${factionId}`,
      })
    }

    const description = faction.description ? fluentMsg(faction.description) : null
    const [_text, desc] = splitOnFirstToken(description)

    return { selected, onClick, label: fluentMsg(faction.name), factionId, description: desc }
  }

  dropdown.showDropDown('FACTION_DROPDOWN_TEMPLATE', 154, Object.keys(factions), setupItem)
}

// ---------------------------------------------------------------------------
// Populate color dropdown
// OpenRA 对照: LobbyUtils.SetupEditableColorWidget (uses IColorPickerManagerInfo)
// ---------------------------------------------------------------------------

/**
 * Show color picker dropdown for a client.
 *
 * OpenRA 对照: IColorPickerManagerInfo.ShowColorDropDown
 *
 * NOTE: Simplified — uses basic color palette since IColorPickerManagerInfo
 * is not yet migrated. Full color picker deferred to TODO-16.C.2.
 *
 * @param dropdown — the dropdown button widget
 * @param _currentColor — current player color
 * @param _faction — current player faction
 * @param onColorPicked — callback with selected color hex string
 */
export function showColorDropDown(
  dropdown: DropDownButtonWidget,
  _currentColor: string,
  _faction: string,
  onColorPicked: (color: string) => void,
): void {
  const presetColors = [
    'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    'FF8800', '8800FF', '0088FF', 'FF0088', '88FF00', 'FFFFFF',
    'FF4444', '44FF44', '4444FF', 'FFAA00', 'AA00FF', '00AAFF',
  ]

  function setupItem(color: string, _template: unknown): unknown {
    const selected = () => _currentColor === color
    const onClick = () => onColorPicked(color)
    return { selected, onClick, label: `#${color}`, color }
  }

  dropdown.showDropDown('COLOR_DROPDOWN_TEMPLATE', 180, presetColors, setupItem)
}

// ---------------------------------------------------------------------------
// Setup slot dropdown (open/close/bot)
// OpenRA 对照: LobbyUtils.ShowSlotDropDown
// ---------------------------------------------------------------------------

interface SlotDropDownOption {
  title: string
  order: string
  selected: () => boolean
}

/**
 * Show the slot management dropdown (open, close, add/remove bot).
 *
 * OpenRA 对照: LobbyUtils.ShowSlotDropDown(DropDownButtonWidget, Session.Slot, Session.Client, OrderManager, MapPreview, ModData)
 */
export function showSlotDropDown(
  dropdown: DropDownButtonWidget,
  slot: SessionSlot,
  client: SessionClient | null,
  orderManager: OrderManagerLobby,
  map: MapPreviewLobby,
): void {
  const openText = fluentMsg('options-lobby-slot.open')
  const closedText = fluentMsg('options-lobby-slot.closed')
  const botsText = fluentMsg('options-lobby-slot.bots')
  const botsDisabledText = fluentMsg('options-lobby-slot.bots-disabled')
  const slotText = fluentMsg('options-lobby-slot.slot')

  const options: Record<string, SlotDropDownOption[]> = {}

  // Slot open/close options
  options[slotText] = [
    {
      title: openText,
      order: `slot_open ${slot.playerReference}`,
      selected: () => !slot.closed && client === null,
    },
    {
      title: closedText,
      order: `slot_close ${slot.playerReference}`,
      selected: () => slot.closed,
    },
  ]

  // Bot options
  const bots: SlotDropDownOption[] = []
  if (slot.allowBots) {
    const botController = orderManager.lobbyInfo.clients.find(c => c.isAdmin)
    if (botController) {
      // NOTE: In full migration, bots come from map.PlayerActorInfo.TraitInfos<IBotInfo>()
      // Simplified: use a single "Bot" entry for now
      const botType = 'Bot'
      const botName = map.tryGetMessage('Bot') || fluentMsg('label-bot-player')
      bots.push({
        title: botName,
        order: `slot_bot ${slot.playerReference} ${botController.index} ${botType}`,
        selected: () => client !== null && client.bot === botType,
      })
    }
  }

  options[bots.length > 0 ? botsText : botsDisabledText] = bots

  function setupItem(option: SlotDropDownOption, _template: unknown): unknown {
    const selected = option.selected
    const onClick = () =>
      orderManager.issueOrder({ type: 'command', text: option.order })
    return { selected, onClick, label: option.title }
  }

  dropdown.showDropDown('LABEL_DROPDOWN_TEMPLATE', 180, Object.values(options).flat(), setupItem)
}

// ---------------------------------------------------------------------------
// Show team dropdown
// OpenRA 对照: LobbyUtils.ShowTeamDropDown
// ---------------------------------------------------------------------------

/**
 * Show team selection dropdown.
 *
 * OpenRA 对照: LobbyUtils.ShowTeamDropDown(DropDownButtonWidget, Session.Client, OrderManager, int)
 */
export function showTeamDropDown(
  dropdown: DropDownButtonWidget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  teamCount: number,
): void {
  const options: number[] = []
  for (let i = 0; i <= teamCount; i++) {
    options.push(i)
  }

  function setupItem(ii: number, _template: unknown): unknown {
    const selected = () => client.team === ii
    const onClick = () =>
      orderManager.issueOrder({ type: 'command', text: `team ${client.index} ${ii}` })
    const label = ii === 0 ? '-' : String(ii)
    return { selected, onClick, label }
  }

  dropdown.showDropDown('TEAM_DROPDOWN_TEMPLATE', 150, options, setupItem)
}

// ---------------------------------------------------------------------------
// Show handicap dropdown
// OpenRA 对照: LobbyUtils.ShowHandicapDropDown
// ---------------------------------------------------------------------------

/**
 * Show handicap selection dropdown (0-95% in 5% steps).
 *
 * OpenRA 对照: LobbyUtils.ShowHandicapDropDown(DropDownButtonWidget, Session.Client, OrderManager)
 */
export function showHandicapDropDown(
  dropdown: DropDownButtonWidget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
): void {
  const options: number[] = []
  for (let i = 0; i < 20; i++) {
    options.push(5 * i)
  }

  function setupItem(ii: number, _template: unknown): unknown {
    const selected = () => client.handicap === ii
    const onClick = () =>
      orderManager.issueOrder({ type: 'command', text: `handicap ${client.index} ${ii}` })
    const label = `${ii}%`
    return { selected, onClick, label }
  }

  dropdown.showDropDown('TEAM_DROPDOWN_TEMPLATE', 150, options, setupItem)
}

// ---------------------------------------------------------------------------
// Show spawn point dropdown
// OpenRA 对照: LobbyUtils.ShowSpawnDropDown + SetSpawnPoint
// ---------------------------------------------------------------------------

/**
 * Show spawn point selection dropdown.
 *
 * OpenRA 对照: LobbyUtils.ShowSpawnDropDown(DropDownButtonWidget, Session.Client, OrderManager, IEnumerable<int>)
 */
export function showSpawnDropDown(
  dropdown: DropDownButtonWidget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  spawnPoints: number[],
): void {
  function setupItem(ii: number, _template: unknown): unknown {
    const selected = () => client.spawnPoint === ii
    const onClick = () => {
      const owned =
        orderManager.lobbyInfo.clients.some(c => c.spawnPoint === ii) ||
        orderManager.lobbyInfo.disabledSpawnPoints.includes(ii)
      if (ii === 0 || !owned) {
        orderManager.issueOrder({ type: 'command', text: `spawn ${client.index} ${ii}` })
      }
    }
    const label = ii === 0 ? '-' : String.fromCharCode('A'.charCodeAt(0) - 1 + ii)
    return { selected, onClick, label }
  }

  dropdown.showDropDown('SPAWN_DROPDOWN_TEMPLATE', 150, spawnPoints, setupItem)
}

// ---------------------------------------------------------------------------
// Available spawn points
// OpenRA 对照: LobbyUtils.AvailableSpawnPoints + InsufficientEnabledSpawnPoints
// ---------------------------------------------------------------------------

/**
 * Get list of available spawn points (excluding disabled ones).
 * Range: 1 to totalSpawnPoints.
 *
 * OpenRA 对照: LobbyUtils.AvailableSpawnPoints(int, Session)
 */
export function availableSpawnPoints(
  totalSpawnPoints: number,
  lobbyInfo: LobbyInfo,
): number[] {
  const result: number[] = []
  for (let i = 1; i <= totalSpawnPoints; i++) {
    if (!lobbyInfo.disabledSpawnPoints.includes(i)) {
      result.push(i)
    }
  }
  return result
}

/**
 * Check if there are insufficient enabled spawn points.
 *
 * OpenRA 对照: LobbyUtils.InsufficientEnabledSpawnPoints(MapPreview, Session)
 */
export function insufficientEnabledSpawnPoints(
  map: MapPreviewLobby,
  lobbyInfo: LobbyInfo,
): boolean {
  const spawnPoints = map.spawnPoints.length
  if (spawnPoints === 0) return false
  return availableSpawnPoints(spawnPoints, lobbyInfo).length <
    lobbyInfo.clients.filter(c => !c.isObserver).length
}

// ---------------------------------------------------------------------------
// Setup widget helpers — wire widget state for lobby slots
// OpenRA 对照: LobbyUtils.SetupEditableSlotWidget / SetupSlotWidget / etc.
// ---------------------------------------------------------------------------

/**
 * Hide a child widget by ID.
 *
 * OpenRA 对照: LobbyUtils.HideChildWidget(Widget, string)
 */
export function hideChildWidget(parent: Widget, widgetId: string): void {
  const w = widgetChild(parent, widgetId)
  if (w) {
    w.isVisible = () => false
  }
}

/**
 * Setup editable slot widget (host can open/close slot or add bot).
 *
 * OpenRA 对照: LobbyUtils.SetupEditableSlotWidget(...)
 */
export function setupEditableSlotWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient | null,
  orderManager: OrderManagerLobby,
  map: MapPreviewLobby,
): void {
  const slotOpts = widgetChild<DropDownButtonWidget>(parent, 'SLOT_OPTIONS')
  if (!slotOpts) return

  slotOpts.isVisible = () => true
  slotOpts.isDisabled = () => orderManager.localClient?.isReady ?? false

  const truncated = new CachedTransform<string, string>(name => {
    const width = slotOpts.bounds.width - slotOpts.bounds.height
    return WidgetUtils.truncateText(name, width, '14px Arial')
  })

  const closed = fluentMsg('options-lobby-slot.closed')
  const open = fluentMsg('options-lobby-slot.open')

  slotOpts.getText = () => {
    if (client) {
      return truncated.update(client.bot !== null
        ? (map.tryGetMessage(client.name) || fluentMsg('label-bot-player'))
        : client.name)
    }
    return truncated.update(slot.closed ? closed : open)
  }

  slotOpts.onMouseDown = () => {
    showSlotDropDown(slotOpts, slot, client, orderManager, map)
  }

  hideChildWidget(parent, 'NAME')
}

/**
 * Setup non-editable slot widget (non-host player sees slot name only).
 *
 * OpenRA 对照: LobbyUtils.SetupSlotWidget(...)
 */
export function setupSlotWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient | null,
): void {
  const name = widgetChild<LabelWidget>(parent, 'NAME')
  if (!name) return

  name.isVisible = () => true
  name.getText = () => {
    if (client) return client.name
    return slot.closed
      ? fluentMsg('options-lobby-slot.closed')
      : fluentMsg('options-lobby-slot.open')
  }

  hideChildWidget(parent, 'SLOT_OPTIONS')
}

/**
 * Setup editable name widget for a player.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableNameWidget(...)
 */
export function setupEditableNameWidget(
  parent: Widget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
): void {
  const nameField = widgetChild<Widget & {
    text: string
    isDisabled: () => boolean
    isVisible: () => boolean
    onLoseFocus?: () => void
    onEnterKey?: (_: unknown) => boolean
    onEscKey?: (_: unknown) => boolean
    yieldKeyboardFocus?: () => void
  }>(parent, 'NAME')

  if (!nameField) return

  nameField.isVisible = () => true
  nameField.isDisabled = () => orderManager.localClient?.isReady ?? false
  nameField.text = client.name

  let escPressed = false
  nameField.onLoseFocus = () => {
    if (escPressed) {
      escPressed = false
      return
    }
    const trimmed = (nameField.text || '').trim()
    if (trimmed.length === 0) {
      nameField.text = client.name
    } else if (trimmed !== client.name) {
      const sanitized = sanitizePlayerName(trimmed)
      nameField.text = sanitized
      orderManager.issueOrder({ type: 'command', text: `name ${sanitized}` })
    }
  }

  nameField.onEnterKey = () => {
    nameField.yieldKeyboardFocus?.()
    return true
  }

  nameField.onEscKey = () => {
    nameField.text = client.name
    escPressed = true
    nameField.yieldKeyboardFocus?.()
    return true
  }

  hideChildWidget(parent, 'SLOT_OPTIONS')
}

/**
 * Setup non-editable name widget for a player.
 *
 * OpenRA 对照: LobbyUtils.SetupNameWidget(...)
 */
export function setupNameWidget(
  parent: Widget,
  client: SessionClient,
  map: MapPreviewLobby,
): void {
  const label = widgetChild<LabelWidget>(parent, 'NAME')
  if (!label) return

  label.isVisible = () => true
  label.getText = () => {
    if (client.bot && !map.tryGetMessage(client.name)) {
      return fluentMsg('label-bot-player')
    }
    return WidgetUtils.truncateText(client.name, label.bounds.width, '14px Arial')
  }
}

/**
 * Setup player action dropdown (kick, admin, spectator).
 *
 * OpenRA 对照: LobbyUtils.ShowPlayerActionDropDown + SetupPlayerActionWidget
 */
export function setupPlayerActionWidget(
  parent: Widget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  _lobbyWidget: Widget,
  beforeKick: () => void,
  afterKick: () => void,
): void {
  const actionButton = widgetChild<DropDownButtonWidget>(parent, 'PLAYER_ACTION')
  if (!actionButton) return

  actionButton.isVisible = () => {
    const localClient = orderManager.localClient
    return localClient !== null &&
      localClient.isAdmin &&
      client.index !== localClient.index
  }
  actionButton.isDisabled = () => orderManager.localClient?.isReady ?? false

  actionButton.getText = () => client.name
  actionButton.onMouseDown = () => {
    const options: DropDownOption[] = [
      {
        title: 'Kick',
        isSelected: () => false,
        onClick: () => {
          beforeKick()
          const kickOrder = { type: 'command', text: `kick ${client.index} false` }
          orderManager.issueOrder(kickOrder)
          afterKick()
        },
      },
    ]

    if (orderManager.lobbyInfo.globalSettings.dedicated) {
      options.push({
        title: 'Transfer Admin',
        isSelected: () => false,
        onClick: () =>
          orderManager.issueOrder({ type: 'command', text: `make_admin ${client.index}` }),
      })
    }

    if (!client.isObserver && orderManager.lobbyInfo.globalSettings.allowSpectators) {
      options.push({
        title: 'Move to Spectator',
        isSelected: () => false,
        onClick: () =>
          orderManager.issueOrder({ type: 'command', text: `make_spectator ${client.index}` }),
      })
    }

    function setupItem(option: DropDownOption, _template: unknown): unknown {
      return {
        selected: option.isSelected,
        onClick: option.onClick,
        label: option.title,
      }
    }

    actionButton.showDropDown('PLAYERACTION_DROPDOWN_TEMPLATE', 167, options, setupItem)
  }

  hideChildWidget(parent, 'NAME')
}

/**
 * Setup kick spectators widget.
 *
 * OpenRA 对照: LobbyUtils.SetupKickSpectatorsWidget(...)
 */
export function setupKickSpectatorsWidget(
  parent: Widget,
  orderManager: OrderManagerLobby,
  _lobbyWidget: Widget,
  beforeKick: () => void,
  afterKick: () => void,
  skirmishMode: boolean,
): void {
  const checkBox = widgetChild<CheckboxWidget>(parent, 'TOGGLE_SPECTATORS')
  if (!checkBox) return

  checkBox.isChecked = () => orderManager.lobbyInfo.globalSettings.allowSpectators
  checkBox.isVisible = () => (orderManager.localClient?.isAdmin ?? false) && !skirmishMode
  checkBox.isDisabled = () => false

  checkBox.onClick = () => {
    beforeKick()

    const spectatorCount = orderManager.lobbyInfo.clients.filter(c => c.isObserver).length
    if (spectatorCount > 0) {
      // NOTE: In full migration, this would open KICK_SPECTATORS_DIALOG
      // Simplified: directly execute kick
      const allowValue = !orderManager.lobbyInfo.globalSettings.allowSpectators
      orderManager.issueOrder({ type: 'command', text: `allow_spectators ${allowValue}` })
      for (const c of orderManager.lobbyInfo.clients) {
        if (c.isObserver && !c.isAdmin) {
          orderManager.issueOrder({ type: 'command', text: `kick ${c.index} ${c.name}` })
        }
      }
    } else {
      const allowValue = !orderManager.lobbyInfo.globalSettings.allowSpectators
      orderManager.issueOrder({ type: 'command', text: `allow_spectators ${allowValue}` })
    }

    afterKick()
  }
}

// ---------------------------------------------------------------------------
// Setup editable faction widget
// OpenRA 对照: LobbyUtils.SetupEditableFactionWidget
// ---------------------------------------------------------------------------

/**
 * Setup editable faction dropdown for a player slot.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableFactionWidget(...)
 */
export function setupEditableFactionWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  factions: Record<string, LobbyFaction>,
): void {
  const dropdown = widgetChild<DropDownButtonWidget>(parent, 'FACTION')
  if (!dropdown) return

  dropdown.isDisabled = () => slot.lockFaction || (orderManager.localClient?.isReady ?? false)
  dropdown.onMouseDown = () => showFactionDropDown(dropdown, client, orderManager, factions)

  const description = factions[client.faction]?.description
    ? fluentMsg(factions[client.faction].description!)
    : null
  const [text, desc] = splitOnFirstToken(description)
  ;(dropdown as unknown as Record<string, unknown>)['getTooltipText'] = () => text || ''
  ;(dropdown as unknown as Record<string, unknown>)['getTooltipDesc'] = () => desc || ''

  setupFactionWidget(dropdown, client, factions)
}

/**
 * Setup non-editable faction display.
 *
 * OpenRA 对照: LobbyUtils.SetupFactionWidget(...)
 */
export function setupFactionWidget(
  parent: Widget,
  client: SessionClient,
  factions: Record<string, LobbyFaction>,
): void {
  const factionName = widgetChild<LabelWidget>(parent, 'FACTIONNAME')
  if (factionName) {
    const truncated = new CachedTransform<string, string>(f =>
      WidgetUtils.truncateText(
        fluentMsg(factions[f]?.name || f),
        factionName.bounds.width,
        '14px Arial',
      ),
    )
    factionName.getText = () => truncated.update(client.faction)
  }

  const factionFlag = widgetChild<ImageWidget>(parent, 'FACTIONFLAG')
  if (factionFlag) {
    factionFlag.getImageName = () => client.faction
    factionFlag.getImageCollection = () => 'flags'
  }
}

// ---------------------------------------------------------------------------
// Setup editable color widget
// OpenRA 对照: LobbyUtils.SetupEditableColorWidget + SetupColorWidget
// ---------------------------------------------------------------------------

/**
 * Setup editable color picker for a player slot.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableColorWidget(...)
 *
 * NOTE: Uses simplified color picker; full IColorPickerManagerInfo deferred (TODO-16.C.2)
 */
export function setupEditableColorWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient,
  orderManager: OrderManagerLobby,
): void {
  const colorDropdown = widgetChild<DropDownButtonWidget>(parent, 'COLOR')
  if (!colorDropdown) return

  colorDropdown.isDisabled = () => slot.lockColor || (orderManager.localClient?.isReady ?? false)
  colorDropdown.onMouseDown = () =>
    showColorDropDown(colorDropdown, client.color, client.faction, (color) => {
      orderManager.issueOrder({ type: 'command', text: `color ${client.index} ${color}` })
    })

  setupColorWidget(colorDropdown, client)
}

/**
 * Setup non-editable color block display.
 *
 * OpenRA 对照: LobbyUtils.SetupColorWidget(...)
 */
export function setupColorWidget(
  parent: Widget,
  client: SessionClient,
): void {
  const color = widgetChild<ColorBlockWidget>(parent, 'COLORBLOCK')
  if (color) {
    color.getColor = () => client.color
  }
}

// ---------------------------------------------------------------------------
// Setup editable team widget
// OpenRA 对照: LobbyUtils.SetupEditableTeamWidget + SetupTeamWidget
// ---------------------------------------------------------------------------

/**
 * Setup editable team dropdown.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableTeamWidget(...)
 */
export function setupEditableTeamWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  teamCount: number,
): void {
  const dropdown = widgetChild<DropDownButtonWidget>(parent, 'TEAM_DROPDOWN')
  if (!dropdown) return

  dropdown.isVisible = () => true
  dropdown.isDisabled = () => slot.lockTeam || (orderManager.localClient?.isReady ?? false)
  dropdown.onMouseDown = () => showTeamDropDown(dropdown, client, orderManager, teamCount)
  dropdown.getText = () => client.team === 0 ? '-' : String(client.team)

  hideChildWidget(parent, 'TEAM')
}

/**
 * Setup non-editable team display.
 *
 * OpenRA 对照: LobbyUtils.SetupTeamWidget(...)
 */
export function setupTeamWidget(
  parent: Widget,
  client: SessionClient,
): void {
  const team = widgetChild<LabelWidget>(parent, 'TEAM')
  if (team) {
    team.isVisible = () => true
    team.getText = () => client.team === 0 ? '-' : String(client.team)
  }
  hideChildWidget(parent, 'TEAM_DROPDOWN')
}

// ---------------------------------------------------------------------------
// Setup editable handicap widget
// OpenRA 对照: LobbyUtils.SetupEditableHandicapWidget + SetupHandicapWidget
// ---------------------------------------------------------------------------

/**
 * Setup editable handicap dropdown.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableHandicapWidget(...)
 */
export function setupEditableHandicapWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient,
  orderManager: OrderManagerLobby,
): void {
  const dropdown = widgetChild<DropDownButtonWidget>(parent, 'HANDICAP_DROPDOWN')
  if (!dropdown) return

  dropdown.isVisible = () => true
  dropdown.isDisabled = () => slot.lockHandicap || (orderManager.localClient?.isReady ?? false)
  dropdown.onMouseDown = () => showHandicapDropDown(dropdown, client, orderManager)

  const handicapLabel = new CachedTransform<number, string>(h => `${h}%`)
  dropdown.getText = () => handicapLabel.update(client.handicap)

  hideChildWidget(parent, 'HANDICAP')
}

/**
 * Setup non-editable handicap display.
 *
 * OpenRA 对照: LobbyUtils.SetupHandicapWidget(...)
 */
export function setupHandicapWidget(
  parent: Widget,
  client: SessionClient,
): void {
  const handicap = widgetChild<LabelWidget>(parent, 'HANDICAP')
  if (handicap) {
    handicap.isVisible = () => true
    const handicapLabel = new CachedTransform<number, string>(h => `${h}%`)
    handicap.getText = () => handicapLabel.update(client.handicap)
  }
  hideChildWidget(parent, 'HANDICAP_DROPDOWN')
}

// ---------------------------------------------------------------------------
// Setup editable spawn widget
// OpenRA 对照: LobbyUtils.SetupEditableSpawnWidget + SetupSpawnWidget
// ---------------------------------------------------------------------------

/**
 * Setup editable spawn point dropdown.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableSpawnWidget(...)
 */
export function setupEditableSpawnWidget(
  parent: Widget,
  slot: SessionSlot,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  map: MapPreviewLobby,
): void {
  const dropdown = widgetChild<DropDownButtonWidget>(parent, 'SPAWN_DROPDOWN')
  if (!dropdown) return

  dropdown.isVisible = () => true
  dropdown.isDisabled = () => slot.lockSpawn || (orderManager.localClient?.isReady ?? false)
  dropdown.onMouseDown = () => {
    // Available spawns excluding those already taken
    const takenSpawns = new Set(
      orderManager.lobbyInfo.clients
        .filter(cc => cc !== client && cc.spawnPoint !== 0)
        .map(cc => cc.spawnPoint)
    )
    const spawnPoints: number[] = [0] // "None" option
    for (let i = 1; i <= map.spawnPoints.length; i++) {
      if (!takenSpawns.has(i) && !orderManager.lobbyInfo.disabledSpawnPoints.includes(i)) {
        spawnPoints.push(i)
      }
    }
    showSpawnDropDown(dropdown, client, orderManager, spawnPoints)
  }

  dropdown.getText = () =>
    client.spawnPoint === 0
      ? '-'
      : String.fromCharCode('A'.charCodeAt(0) - 1 + client.spawnPoint)

  hideChildWidget(parent, 'SPAWN')
}

/**
 * Setup non-editable spawn display.
 *
 * OpenRA 对照: LobbyUtils.SetupSpawnWidget(...)
 */
export function setupSpawnWidget(
  parent: Widget,
  client: SessionClient,
): void {
  const spawn = widgetChild<LabelWidget>(parent, 'SPAWN')
  if (spawn) {
    spawn.isVisible = () => true
    spawn.getText = () =>
      client.spawnPoint === 0
        ? '-'
        : String.fromCharCode('A'.charCodeAt(0) - 1 + client.spawnPoint)
  }
  hideChildWidget(parent, 'SPAWN_DROPDOWN')
}

// ---------------------------------------------------------------------------
// Setup latency widget
// OpenRA 对照: LobbyUtils.SetupLatencyWidget
// ---------------------------------------------------------------------------

/**
 * Setup latency display for a client.
 *
 * OpenRA 对照: LobbyUtils.SetupLatencyWidget(...)
 */
export function setupLatencyWidget(
  parent: Widget,
  client: SessionClient | null,
): void {
  const visible = client !== null && client.bot === null
  const block = widgetChild(parent, 'LATENCY')
  if (block) {
    block.isVisible = () => visible
    if (visible && client) {
      const colorBlock = widgetChild<ColorBlockWidget>(block, 'LATENCY_COLOR')
      if (colorBlock) {
        colorBlock.getColor = () => latencyColor(client)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Setup ready widgets
// OpenRA 对照: LobbyUtils.SetupEditableReadyWidget / SetupReadyWidget / HideReadyWidgets
// ---------------------------------------------------------------------------

/**
 * Setup editable ready checkbox.
 *
 * OpenRA 对照: LobbyUtils.SetupEditableReadyWidget(...)
 */
export function setupEditableReadyWidget(
  parent: Widget,
  client: SessionClient,
  orderManager: OrderManagerLobby,
  isEnabled: boolean,
): void {
  const status = widgetChild<CheckboxWidget>(parent, 'STATUS_CHECKBOX')
  if (!status) return

  status.isVisible = () => true
  status.isDisabled = () => client.bot !== null || !isEnabled

  if (client.bot === null) {
    const isChecked = new PredictedCachedTransform<SessionClient, boolean>(cc => cc.isReady)
    status.isChecked = () => isChecked.update(client)
    status.onClick = () => {
      const state = isChecked.update(client)
        ? ClientState.NotReady
        : ClientState.Ready
      orderManager.issueOrder({ type: 'command', text: `state ${state}` })
      isChecked.predict(!client.isReady)
    }
  } else {
    status.isChecked = () => true
  }
}

/**
 * Setup ready state image display.
 *
 * OpenRA 对照: LobbyUtils.SetupReadyWidget(...)
 */
export function setupReadyWidget(
  parent: Widget,
  client: SessionClient,
): void {
  const image = widgetChild<ImageWidget>(parent, 'STATUS_IMAGE')
  if (image) {
    image.isVisible = () => client.isReady || client.bot !== null
  }
}

/**
 * Hide both ready status widgets.
 *
 * OpenRA 对照: LobbyUtils.HideReadyWidgets(...)
 */
export function hideReadyWidgets(parent: Widget): void {
  hideChildWidget(parent, 'STATUS_CHECKBOX')
  hideChildWidget(parent, 'STATUS_IMAGE')
}

// ---------------------------------------------------------------------------
// Utility — sanitize player name
// ---------------------------------------------------------------------------

/**
 * Sanitize a player-entered name (trim and limit length).
 *
 * OpenRA 对照: Settings.SanitizedPlayerName(string)
 */
function sanitizePlayerName(name: string): string {
  let sanitized = name.trim()
  if (sanitized.length > 32) sanitized = sanitized.substring(0, 32)
  return sanitized || 'Unnamed'
}
