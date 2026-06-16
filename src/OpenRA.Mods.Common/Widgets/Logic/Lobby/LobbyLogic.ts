/**
 * LobbyLogic.ts — Multiplayer lobby main screen logic
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyLogic.cs (1056 lines)
 *
 * 核心范式转换:
 * - C# Game.LobbyInfoChanged event → TypeScript handler dispatch
 * - C# Ui.LoadWidget with template names → TypeScript widget template cloning
 * - C# PanelType enum → const object type
 * - C# INotificationHandler<TextNotification> → method dispatch
 * - C# Game.Sound.PlayNotification → stub (TODO-16.C.6)
 * - C# TextNotificationsManager → stub (TODO-16.C.7)
 * - C# FluentProvider.GetMessage → stub (TODO-16.C.1)
 */

import { ChromeLogic, Ui } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { ScrollPanelWidget } from '../../../Widgets/ScrollPanelWidget.js'
import type { ButtonWidget } from '../../../Widgets/ButtonWidget.js'
import type { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
import type { LabelWidget } from '../../../Widgets/LabelWidget.js'
import type { TextFieldWidget } from '../../../Widgets/TextFieldWidget.js'
import { WidgetUtils } from '../../../Widgets/WidgetUtils.js'
import {
  setupEditableSlotWidget,
  setupSlotWidget,
  setupEditableNameWidget,
  setupNameWidget,
  setupPlayerActionWidget,
  setupKickSpectatorsWidget,
  setupEditableFactionWidget,
  setupFactionWidget,
  setupEditableColorWidget,
  setupColorWidget,
  setupEditableTeamWidget,
  setupTeamWidget,
  setupEditableHandicapWidget,
  setupHandicapWidget,
  setupEditableSpawnWidget,
  setupSpawnWidget,
  setupEditableReadyWidget,
  setupReadyWidget,
  hideReadyWidgets,
  setupLatencyWidget,
  insufficientEnabledSpawnPoints,
} from './LobbyUtils.js'
import {
  ClientState,
  MapStatus,
  type LobbyFaction,
  type MapPreviewLobby,
  type SpawnOccupant,
  type OrderManagerLobby,
  type DropDownOption,
} from './LobbyTypes.js'

// ---------------------------------------------------------------------------
// Consolidated widget child access (MAJOR 5 fix)
// ---------------------------------------------------------------------------

const wc = WidgetUtils.getChildWidget

// ---------------------------------------------------------------------------
// Fluent stub
// ---------------------------------------------------------------------------

function fluentMsg(key: string, ..._args: string[]): string {
  return key
}

// ---------------------------------------------------------------------------
// SelectSpawnPoint stub
// NOTE: Full LobbyUtils.SelectSpawnPoint migration deferred to TODO-16.C.8
// ---------------------------------------------------------------------------

let _lobbyUtilsSelectSpawnPoint:
  | ((orderManager: OrderManagerLobby, preview: unknown, mapPreview: unknown, mi: unknown) => void)
  | null = null

/** Register the LobbyUtils.SelectSpawnPoint implementation. */
export function setSelectSpawnPoint(
  fn: (orderManager: OrderManagerLobby, preview: unknown, mapPreview: unknown, mi: unknown) => void,
): void {
  _lobbyUtilsSelectSpawnPoint = fn
}

// ---------------------------------------------------------------------------
// PanelType
// ---------------------------------------------------------------------------

const PanelType = {
  Players: 'Players',
  Options: 'Options',
  Music: 'Music',
  Servers: 'Servers',
  Kick: 'Kick',
  ForceStart: 'ForceStart',
} as const
type PanelType = (typeof PanelType)[keyof typeof PanelType]

// ---------------------------------------------------------------------------
// TextNotification
// ---------------------------------------------------------------------------

const TextNotificationPool = {
  System: 'System',
  Join: 'Join',
  Leave: 'Leave',
  Chat: 'Chat',
  Mission: 'Mission',
} as const
type TextNotificationPool = (typeof TextNotificationPool)[keyof typeof TextNotificationPool]

interface TextNotification {
  pool: TextNotificationPool
  text: string
  clientId: number
  prefix: string
}

// ---------------------------------------------------------------------------
// Types for external dependencies
// ---------------------------------------------------------------------------

export interface MapCacheLobby {
  readonly unknownMap: MapPreviewLobby
  get(uid: string): MapPreviewLobby
  updateMaps(): void
  pickLastModifiedMap(filter: unknown): string | null
  queryRemoteMapDetails(repository: string, mapUids: string[]): void
}

export interface ModDataLobby {
  readonly mapCache: MapCacheLobby
  readonly defaultRules: {
    actors: Record<string, { traitInfos<T extends object>(): T[] }>
  }
  getOrCreate<T>(type: new () => T): T
}

// ---------------------------------------------------------------------------
// LobbyLogic — main multiplayer lobby screen
// OpenRA 对照: LobbyLogic : ChromeLogic, INotificationHandler<TextNotification>
// ---------------------------------------------------------------------------

export class LobbyLogic extends ChromeLogic {
  private _disposed = false
  private _panel: PanelType = PanelType.Players
  private _gameStarting = false
  private _chatEnabled = true
  private _disableTeamChat = false
  private _teamChat = false
  private _insufficientPlayerSpawns = false
  private _resetOptionsButtonEnabled = false
  private _mapAvailable = false

  private readonly _modData: ModDataLobby
  private readonly _onStart: () => void
  private readonly _onExit: () => void
  private readonly _orderManager: OrderManagerLobby
  private readonly _skirmishMode: boolean

  private _map: MapPreviewLobby
  private _mapStatus: string = MapStatus.Unavailable
  private readonly _factions: Record<string, LobbyFaction> = {}
  private _spawnOccupants: Map<number, SpawnOccupant> = new Map()

  private readonly _lobby: Widget
  private readonly _editablePlayerTemplate: Widget
  private readonly _nonEditablePlayerTemplate: Widget
  private readonly _emptySlotTemplate: Widget
  private readonly _editableSpectatorTemplate: Widget
  private readonly _nonEditableSpectatorTemplate: Widget
  private readonly _newSpectatorTemplate: Widget
  private readonly _lobbyChatPanel: ScrollPanelWidget
  private readonly _chatTextField: TextFieldWidget
  private readonly _players: ScrollPanelWidget

  private _lobbyInfoHandlers: Array<() => void> = []

  // ---- Sound notification callbacks (MAJOR 7 fix) ----
  // OpenRA 对照: ChromeMetrics keys — chat_line, player_joined, player_left, lobby_option_changed
  // TODO-16.C.6: Wire to actual Sound.PlayNotification when audio system is fully migrated.

  /** Callback for chat line sound. OpenRA 对照: ChromeMetrics "ChatLineSound" */
  private _chatLineSound: ((notification: string) => void) | null = null

  /** Callback for player joined sound. OpenRA 对照: ChromeMetrics "PlayerJoinedSound" */
  private _playerJoinedSound: ((notification: string) => void) | null = null

  /** Callback for player left sound. OpenRA 对照: ChromeMetrics "PlayerLeftSound" */
  private _playerLeftSound: ((notification: string) => void) | null = null

  /** Callback for lobby option changed sound. OpenRA 对照: ChromeMetrics "LobbyOptionChangedSound" */
  private _lobbyOptionChangedSound: ((notification: string) => void) | null = null

  /** 预绑定的 onGameStart 处理器（用于事件注册/解绑）。OpenRA 对照: Game.BeforeGameStart += OnGameStart */
  private readonly _boundOnGameStart: () => void

  constructor(
    widget: Widget,
    modData: ModDataLobby,
    _worldRenderer: unknown,
    orderManager: OrderManagerLobby,
    onExit: () => void,
    onStart: () => void,
    skirmishMode: boolean,
    _logicArgs: Record<string, unknown> = {},
  ) {
    super()

    this._modData = modData
    this._orderManager = orderManager
    this._onStart = onStart
    this._onExit = onExit
    this._skirmishMode = skirmishMode
    this._lobby = widget
    this._map = modData.mapCache.unknownMap

    // Pre-bind game start handler for registration/unregistration
    // OpenRA 对照: Game.BeforeGameStart += OnGameStart
    this._boundOnGameStart = this.notifyGameStart.bind(this)

    // Register game start handler via orderManager event hook
    // OpenRA 对照: Game.BeforeGameStart += OnGameStart
    if (orderManager.onBeforeGameStart) {
      orderManager.onBeforeGameStart(this._boundOnGameStart)
    }

    // Register connection state changed handler for reconnection
    // OpenRA 对照: Game.ConnectionStateChanged += ConnectionStateChanged
    if (orderManager.onConnectionStateChanged) {
      orderManager.onConnectionStateChanged(this._onConnectionStateChanged.bind(this))
    }

    // Load factions
    const worldActorInfo = modData.defaultRules.actors['world']
    if (worldActorInfo) {
      for (const fi of worldActorInfo.traitInfos()) {
        const f = fi as Record<string, unknown>
        if (f['InternalName'] !== undefined && f['Name'] !== undefined) {
          ;(this._factions as Record<string, LobbyFaction>)[f['InternalName'] as string] = {
            selectable: (f['Selectable'] as boolean) ?? true,
            name: f['Name'] as string,
            description: (f['Description'] as string) ?? null,
            side: (f['Side'] as string) ?? null,
          }
        }
      }
    }

    // Register lobby change handlers
    this._lobbyInfoHandlers.push(() => this._updateCurrentMap())
    this._lobbyInfoHandlers.push(() => this._updatePlayerList())
    this._lobbyInfoHandlers.push(() => this._updateSpawnOccupants())
    this._lobbyInfoHandlers.push(() => this._updateOptions())

    // Get widget templates
    const playerBin = wc(widget, 'LOBBY_PLAYER_BIN')!
    this._players = wc<ScrollPanelWidget>(playerBin, 'LOBBY_PLAYERS')!
    this._editablePlayerTemplate = wc(this._players, 'TEMPLATE_EDITABLE_PLAYER')!
    this._nonEditablePlayerTemplate = wc(this._players, 'TEMPLATE_NONEDITABLE_PLAYER')!
    this._emptySlotTemplate = wc(this._players, 'TEMPLATE_EMPTY')!
    this._editableSpectatorTemplate = wc(this._players, 'TEMPLATE_EDITABLE_SPECTATOR')!
    this._nonEditableSpectatorTemplate = wc(this._players, 'TEMPLATE_NONEDITABLE_SPECTATOR')!
    this._newSpectatorTemplate = wc(this._players, 'TEMPLATE_NEW_SPECTATOR')!

    // Chat panel
    this._lobbyChatPanel = wc<ScrollPanelWidget>(widget, 'CHAT_DISPLAY')!
    this._lobbyChatPanel.removeChildren()

    this._chatTextField = wc<TextFieldWidget>(widget, 'CHAT_TEXTFIELD')!
    this._chatTextField.isDisabled = () => !this._chatEnabled
    this._chatTextField.maxLength = 255

    this._chatTextField.onEnterKey = () => {
      if (this._chatTextField.text.length === 0) return true
      this._lobbyChatPanel.scrollToBottom()
      const teamNumber = this._teamChat && this._orderManager.localClient && !this._orderManager.localClient.isObserver
        ? this._orderManager.localClient.team
        : 0
      this._orderManager.issueOrder({ type: 'chat', text: this._chatTextField.text, teamNumber })
      this._chatTextField.text = ''
      return true
    }

    ;(this._chatTextField as unknown as Record<string, unknown>).onEscKey = () => {
      this._chatTextField.yieldKeyboardFocus()
      return true
    }

    // Configuration disabled delegate
    const configurationDisabled = () =>
      !this._orderManager.localClient?.isAdmin ||
      this._gameStarting ||
      this._panel === PanelType.Kick ||
      this._panel === PanelType.ForceStart ||
      !this._mapIsPlayable() ||
      !this._orderManager.localClient ||
      this._orderManager.localClient.isReady

    // Setup tabs
    this._setupTabs(widget, skirmishMode)

    // Change map button
    const mapButton = wc<ButtonWidget>(widget, 'CHANGEMAP_BUTTON')
    if (mapButton) {
      mapButton.isVisible = () => this._panel !== PanelType.Servers
      mapButton.isDisabled = () =>
        this._gameStarting || this._panel === PanelType.Kick || this._panel === PanelType.ForceStart ||
        !this._orderManager.localClient || this._orderManager.localClient.isReady
      mapButton.onClick = () => {
        this._modData.mapCache.updateMaps()
        Ui.openWindow('MAPCHOOSER_PANEL', {
          initialMap: this._modData.mapCache.pickLastModifiedMap(null) || this._map.uid,
          onExit: () => this._modData.mapCache.updateMaps(),
          filter: 'Lobby',
        })
      }
    }

    // Slots button
    const slotsButton = wc<DropDownButtonWidget>(widget, 'SLOTS_DROPDOWNBUTTON')
    if (slotsButton) {
      slotsButton.isVisible = () => this._panel !== PanelType.Servers && this._panel !== PanelType.Options
      slotsButton.isDisabled = () => {
        if (configurationDisabled() || this._panel !== PanelType.Players) return true
        const slots = this._orderManager.lobbyInfo.slots
        const allNoBots = Array.from(slots.values()).every(s => !s.allowBots)
        const anyUnlocked = Array.from(slots.entries()).some(
          ([key, s]) => !s.lockTeam && this._orderManager.lobbyInfo.clientInSlot(key) !== undefined,
        )
        return allNoBots && !anyUnlocked
      }
      slotsButton.onMouseDown = () => {
        const options: Record<string, DropDownOption[]> = {}
        const botController = this._orderManager.lobbyInfo.clients.find(c => c.isAdmin)

        if (Array.from(this._orderManager.lobbyInfo.slots.values()).some(s => s.allowBots)) {
          const botOptions: DropDownOption[] = [{
            title: fluentMsg('options-slot-admin.add-bots'),
            isSelected: () => false,
            onClick: () => {
              for (const [sk, s] of this._orderManager.lobbyInfo.slots) {
                if (s.allowBots && !this._orderManager.lobbyInfo.clientInSlot(sk) && botController) {
                  this._orderManager.issueOrder({ type: 'command', text: `slot_bot ${sk} ${botController.index} Bot` })
                }
              }
            },
          }]

          // MAJOR 9 fix: Add "Remove Bots" option when bots are present (C# lines 328-344)
          const botClients = this._orderManager.lobbyInfo.clients.filter(c => c.bot !== null)
          if (botClients.length > 0) {
            botOptions.push({
              title: fluentMsg('options-slot-admin.remove-bots'),
              isSelected: () => false,
              onClick: () => {
                for (const c of botClients) {
                  this._orderManager.issueOrder({ type: 'command', text: `slot_close ${c.slot}` })
                }
              },
            })
          }

          options[fluentMsg('options-slot-admin.configure-bots')] = botOptions
        }

        const activeSlots = Array.from(this._orderManager.lobbyInfo.slots.entries()).filter(
          ([key, s]) => !s.lockTeam && this._orderManager.lobbyInfo.clientInSlot(key) !== undefined,
        ).length
        const teamCount = Math.max(1, Math.floor((activeSlots + 1) / 2))

        if (teamCount >= 1) {
          const teamOptions: DropDownOption[] = []
          for (let d = teamCount; d >= 2; d--) {
            teamOptions.push({
              title: fluentMsg('options-slot-admin.teams-count', 'count', String(d)),
              isSelected: () => false,
              onClick: () => this._orderManager.issueOrder({ type: 'command', text: `assignteams ${d}` }),
            })
          }
          teamOptions.push({
            title: fluentMsg('options-slot-admin.free-for-all'),
            isSelected: () => false,
            onClick: () => this._orderManager.issueOrder({ type: 'command', text: 'assignteams 0' }),
          })
          options[fluentMsg('options-slot-admin.configure-teams')] = teamOptions
        }

        const allOpts = Object.values(options).flat()
        slotsButton.showDropDown('LABEL_DROPDOWN_TEMPLATE', 175, allOpts, (o, _t) => ({
          selected: (o as DropDownOption).isSelected,
          onClick: (o as DropDownOption).onClick,
          label: (o as DropDownOption).title,
        }))
      }
    }

    // Reset options button
    const resetOptionsButton = wc<ButtonWidget>(widget, 'RESET_OPTIONS_BUTTON')
    if (resetOptionsButton) {
      resetOptionsButton.isVisible = () => this._panel === PanelType.Options
      resetOptionsButton.isDisabled = () => configurationDisabled() || !this._resetOptionsButtonEnabled
      resetOptionsButton.onMouseDown = () =>
        this._orderManager.issueOrder({ type: 'command', text: 'reset_options' })
    }

    // Start game
    const startDisabled = () =>
      this._map.status !== MapStatus.Available ||
      this._insufficientPlayerSpawns

    const startGame = () => {
      if (this._modData.mapCache.get(this._map.uid).status === MapStatus.Available) {
        this._gameStarting = true
        this._orderManager.issueOrder({ type: 'command', text: 'startgame' })
      }
    }

    const startGameButton = wc<ButtonWidget>(widget, 'START_GAME_BUTTON')
    if (startGameButton) {
      startGameButton.isDisabled = () => configurationDisabled() || startDisabled()
      startGameButton.onClick = () => {
        const hasUnready = this._orderManager.lobbyInfo.clients.some(
          c => c.slot !== null && !c.isAdmin && c.bot === null && !c.isReady,
        )
        if (hasUnready) {
          this._panel = PanelType.ForceStart
        } else {
          startGame()
        }
      }
    }

    // Force start dialog
    const forceStartBin = wc(widget, 'FORCE_START_DIALOG')
    if (forceStartBin) {
      forceStartBin.isVisible = () => this._panel === PanelType.ForceStart
      const okButton = wc<ButtonWidget>(forceStartBin, 'OK_BUTTON')
      if (okButton) { okButton.onClick = startGame; okButton.isDisabled = startDisabled }
      const cancelButton = wc<ButtonWidget>(forceStartBin, 'CANCEL_BUTTON')
      if (cancelButton) cancelButton.onClick = () => { this._panel = PanelType.Players }
    }

    // Disconnect button
    const disconnectButton = wc<ButtonWidget>(widget, 'DISCONNECT_BUTTON')
    if (disconnectButton) {
      disconnectButton.onClick = () => { Ui.closeWindow(); this._onExit() }
      if (skirmishMode) disconnectButton.getText = () => fluentMsg('button-back')
    }

    // Chat mode toggle
    const chatMode = wc<ButtonWidget>(widget, 'CHAT_MODE')
    if (chatMode) {
      chatMode.getText = () => this._teamChat ? fluentMsg('button-team-chat') : fluentMsg('button-general-chat')
      chatMode.onClick = () => { this._teamChat = !this._teamChat }
      chatMode.isDisabled = () => this._disableTeamChat || !this._chatEnabled
    }

    // Settings button
    const settingsButton = wc<ButtonWidget>(widget, 'SETTINGS_BUTTON')
    if (settingsButton) {
      settingsButton.onClick = () => Ui.openWindow('SETTINGS_PANEL', { onExit: () => {} })
    }

    // Server name label
    const serverName = wc<LabelWidget>(widget, 'SERVER_NAME')
    if (serverName) {
      serverName.getText = () => this._orderManager.lobbyInfo.globalSettings.serverName
    }

    // Map preview widget
    // OpenRA 对照: LobbyLogic constructor lines 198-220 (MAP_PREVIEW widget loading)
    const mapPreviewRoot = wc(widget, 'MAP_PREVIEW_ROOT')
    if (mapPreviewRoot) {
      const mapPreviewContainer = Ui.loadWidget('MAP_PREVIEW', mapPreviewRoot, {
        orderManager,
        getMap: () => ({ map: this._map, mapStatus: this._mapStatus }),
        onMouseDown: (_preview: unknown, _mapPreview: unknown, mi: unknown) => {
          _lobbyUtilsSelectSpawnPoint?.(orderManager, _preview, _mapPreview, mi)
        },
        getSpawnOccupants: () => this._spawnOccupants,
        getDisabledSpawnPoints: () => this._orderManager.lobbyInfo.disabledSpawnPoints,
        showUnoccupiedSpawnpoints: true,
        mapUpdatesEnabled: true,
        onMapUpdate: (uid: string) => {
          this._orderManager.issueOrder({ type: 'command', text: `map ${uid}` })
        },
      })
      if (mapPreviewContainer) {
        ;(mapPreviewContainer as unknown as Record<string, unknown>).isVisible =
          () => this._panel !== PanelType.Servers
      }
    }

    this._updateCurrentMap()
    this._updatePlayerList()
  }

  private _setupTabs(widget: Widget, skirmishMode: boolean): void {
    const tabContainer = skirmishMode
      ? wc(widget, 'SKIRMISH_TABS')!
      : wc(widget, 'MULTIPLAYER_TABS')!

    tabContainer.isVisible = () => true

    const optionsTab = wc<ButtonWidget>(tabContainer, 'OPTIONS_TAB')
    if (optionsTab) {
      optionsTab.isHighlighted = () => this._panel === PanelType.Options
      optionsTab.isDisabled = () => this._optionsTabDisabled()
      optionsTab.onClick = () => { this._panel = PanelType.Options }
    }
    const playersTab = wc<ButtonWidget>(tabContainer, 'PLAYERS_TAB')
    if (playersTab) {
      playersTab.isHighlighted = () => this._panel === PanelType.Players
      playersTab.isDisabled = () => this._panel === PanelType.Kick || this._panel === PanelType.ForceStart
      playersTab.onClick = () => { this._panel = PanelType.Players }
    }
    const musicTab = wc<ButtonWidget>(tabContainer, 'MUSIC_TAB')
    if (musicTab) {
      musicTab.isHighlighted = () => this._panel === PanelType.Music
      musicTab.isDisabled = () => this._panel === PanelType.Kick || this._panel === PanelType.ForceStart
      musicTab.onClick = () => { this._panel = PanelType.Music }
    }
    const serversTab = wc<ButtonWidget>(tabContainer, 'SERVERS_TAB')
    if (serversTab) {
      serversTab.isHighlighted = () => this._panel === PanelType.Servers
      serversTab.isDisabled = () => this._panel === PanelType.Kick || this._panel === PanelType.ForceStart
      serversTab.onClick = () => { this._panel = PanelType.Servers }
    }
  }

  private _optionsTabDisabled(): boolean {
    return (
      this._map.status === MapStatus.Unavailable ||
      this._map.status === MapStatus.Searching ||
      !this._mapIsPlayable() ||
      this._panel === PanelType.Kick ||
      this._panel === PanelType.ForceStart
    )
  }

  private _mapIsPlayable(): boolean {
    return this._mapStatus === MapStatus.Available
  }

  // ---- Lobby updates ----

  notifyLobbyInfoChanged(): void {
    for (const h of this._lobbyInfoHandlers) h()
  }

  private _updateCurrentMap(): void {
    this._mapStatus = this._orderManager.lobbyInfo.globalSettings.mapStatus
    const uid = this._orderManager.lobbyInfo.globalSettings.map
    if (this._map.uid === uid) return
    this._map = this._modData.mapCache.get(uid)
    this._mapAvailable = this._map.status === MapStatus.Available
    if (this._mapAvailable) {
      this._orderManager.issueOrder({ type: 'command', text: `state ${ClientState.NotReady}` })
    }
  }

  private _updatePlayerList(): void {
    const localClient = this._orderManager.localClient
    if (!localClient) return

    if (localClient.team === 0 && !localClient.isObserver) {
      this._disableTeamChat = true
    } else if (localClient.isObserver) {
      this._disableTeamChat = !this._orderManager.lobbyInfo.clients.some(
        c => c !== localClient && c.isObserver,
      )
    } else {
      this._disableTeamChat = !this._orderManager.lobbyInfo.clients.some(
        c => c !== localClient && c.bot === null && c.team === localClient.team,
      )
    }
    if (this._disableTeamChat) this._teamChat = false

    this._insufficientPlayerSpawns = insufficientEnabledSpawnPoints(this._map, this._orderManager.lobbyInfo)

    const isHost = localClient.isAdmin
    let idx = 0

    for (const [key, slot] of this._orderManager.lobbyInfo.slots) {
      const client = this._orderManager.lobbyInfo.clientInSlot(key)
      let template: Widget | null = null
      if (idx < this._players.children.length) template = this._players.children[idx]

      if (!client) {
        if (!template || template.id !== this._emptySlotTemplate.id) template = this._emptySlotTemplate.clone()
        if (isHost) {
          setupEditableSlotWidget(template, slot, null, this._orderManager, this._map)
        } else {
          setupSlotWidget(template, slot, null)
        }
        const join = wc<ButtonWidget>(template, 'JOIN')
        if (join) {
          join.isVisible = () => !slot.closed
          join.isDisabled = () => localClient.isReady
          join.onClick = () => this._orderManager.issueOrder({ type: 'command', text: `slot ${key}` })
        }
      } else if (client.index === localClient.index || (client.bot !== null && isHost)) {
        if (!template || template.id !== this._editablePlayerTemplate.id) template = this._editablePlayerTemplate.clone()
        setupLatencyWidget(template, client)
        if (client.bot !== null) {
          setupEditableSlotWidget(template, slot, client, this._orderManager, this._map)
        } else {
          setupEditableNameWidget(template, client, this._orderManager)
        }
        setupEditableColorWidget(template, slot, client, this._orderManager)
        setupEditableFactionWidget(template, slot, client, this._orderManager, this._factions)
        setupEditableTeamWidget(template, slot, client, this._orderManager, this._map.playerCount)
        setupEditableHandicapWidget(template, slot, client, this._orderManager)
        setupEditableSpawnWidget(template, slot, client, this._orderManager, this._map)
        setupEditableReadyWidget(template, client, this._orderManager, this._mapIsPlayable())
      } else {
        if (!template || template.id !== this._nonEditablePlayerTemplate.id) template = this._nonEditablePlayerTemplate.clone()
        setupLatencyWidget(template, client)
        setupColorWidget(template, client)
        setupFactionWidget(template, client, this._factions)
        if (isHost) {
          setupEditableTeamWidget(template, slot, client, this._orderManager, this._map.playerCount)
          setupEditableHandicapWidget(template, slot, client, this._orderManager)
          setupEditableSpawnWidget(template, slot, client, this._orderManager, this._map)
          setupPlayerActionWidget(template, client, this._orderManager, this._lobby,
            () => { this._panel = PanelType.Kick }, () => { this._panel = PanelType.Players })
        } else {
          setupNameWidget(template, client, this._map)
          setupTeamWidget(template, client)
          setupHandicapWidget(template, client)
          setupSpawnWidget(template, client)
        }
        setupReadyWidget(template, client)
      }

      template.isVisible = () => true
      if (idx >= this._players.children.length) {
        this._players.addChild(template)
      } else if (this._players.children[idx].id !== template.id) {
        this._players.replaceChild(this._players.children[idx], template)
      }
      idx++
    }

    // Spectators
    for (const client of this._orderManager.lobbyInfo.clients) {
      if (client.slot !== null) continue
      let template: Widget | null = null
      if (idx < this._players.children.length) template = this._players.children[idx]

      if (client.index === localClient.index) {
        if (!template || template.id !== this._editableSpectatorTemplate.id) template = this._editableSpectatorTemplate.clone()
        setupEditableNameWidget(template, client, this._orderManager)
        if (client.isAdmin) {
          setupEditableReadyWidget(template, client, this._orderManager, this._mapIsPlayable())
        } else {
          hideReadyWidgets(template)
        }
      } else {
        if (!template || template.id !== this._nonEditableSpectatorTemplate.id) template = this._nonEditableSpectatorTemplate.clone()
        if (isHost) {
          setupPlayerActionWidget(template, client, this._orderManager, this._lobby,
            () => { this._panel = PanelType.Kick }, () => { this._panel = PanelType.Players })
        } else {
          setupNameWidget(template, client, this._map)
        }
        if (client.isAdmin) setupReadyWidget(template, client)
        else hideReadyWidgets(template)
      }

      setupLatencyWidget(template, client)
      template.isVisible = () => true
      if (idx >= this._players.children.length) {
        this._players.addChild(template)
      } else if (this._players.children[idx].id !== template.id) {
        this._players.replaceChild(this._players.children[idx], template)
      }
      idx++
    }

    // Spectate button
    if (localClient.slot !== null) {
      let spec: Widget | null = null
      if (idx < this._players.children.length) spec = this._players.children[idx]
      if (!spec || spec.id !== this._newSpectatorTemplate.id) spec = this._newSpectatorTemplate.clone()

      setupKickSpectatorsWidget(spec, this._orderManager, this._lobby,
        () => { this._panel = PanelType.Kick }, () => { this._panel = PanelType.Players }, this._skirmishMode)

      const btn = wc<ButtonWidget>(spec, 'SPECTATE')
      if (btn) {
        btn.onClick = () => this._orderManager.issueOrder({ type: 'command', text: 'spectate' })
        btn.isDisabled = () => localClient.isReady
        btn.isVisible = () => this._orderManager.lobbyInfo.globalSettings.allowSpectators || localClient.isAdmin
      }
      spec.isVisible = () => true
      if (idx >= this._players.children.length) {
        this._players.addChild(spec)
      } else if (this._players.children[idx].id !== spec.id) {
        this._players.replaceChild(this._players.children[idx], spec)
      }
      idx++
    }

    while (this._players.children.length > idx) {
      this._players.removeChild(this._players.children[idx])
    }
  }

  private _updateSpawnOccupants(): void {
    this._spawnOccupants = new Map()
    for (const c of this._orderManager.lobbyInfo.clients) {
      if (c.spawnPoint !== 0) {
        this._spawnOccupants.set(c.spawnPoint, { client: c, disabled: false })
      }
    }
  }

  private _updateOptions(): void {
    this._gameStarting = false
    // NOTE: lobbyOptions stored in globalSettings; resetOptionsButtonEnabled
    // would be computed from map trait options in full migration (TODO-16.C.4)
    this._resetOptionsButtonEnabled = true
  }

  // ---- Connection state changed handler ----
  // OpenRA 对照: LobbyLogic.ConnectionStateChanged()

  /**
   * Handle connection state changes.
   * On disconnect, closes the lobby window and shows the connection failed panel
   * with retry logic that re-opens the lobby on reconnect.
   *
   * OpenRA 对照: void ConnectionStateChanged(OrderManager om, string password, NetworkConnection connection)
   */
  private _onConnectionStateChanged(_om: OrderManagerLobby, connectionState: string): void {
    if (connectionState === 'NotConnected') {
      Ui.closeWindow()

      const onReconnect = () => {
        this._onExit()
      }

      // Open the connection failed panel with retry capabilities
      // NOTE: Full ConnectionLogic / CONNECTIONFAILED_PANEL migration deferred to TODO-16.C.12
      Ui.openWindow('CONNECTIONFAILED_PANEL', {
        orderManager: _om,
        onAbort: () => this._onExit(),
        onQuit: null,
        onRetry: onReconnect,
      })
    }
  }

  // ---- Text notification handler ----

  /** Handle text notification — routes to appropriate chat template and plays sound.
   *
   * OpenRA 对照: LobbyLogic.Handle(TextNotification)
   * C# has 5 chat templates: System, Join, Leave, Chat, Mission
   * from TextNotificationPool. Each triggers a specific sound.
   *
   * MAJOR 8 fix: Basic template routing + sound stubs.
   */
  handleTextNotification(notification: TextNotification): void {
    const scrolledToBottom = this._lobbyChatPanel.scrolledToBottom

    // Route to appropriate chat template
    // NOTE: Full template widget creation (CHAT_TEMPLATE, SYSTEM_TEMPLATE, etc.)
    // deferred to TODO-16.C.7 (TextNotificationsManager migration).
    // Current implementation routes notifications by pool type.
    switch (notification.pool) {
      case TextNotificationPool.System:
        // System message — lobby option changed sound
        // OpenRA 对照: Game.Sound.PlayNotification(..., lobbyOptionChangedSound)
        this._lobbyOptionChangedSound?.('LobbyOptionChangedSound')
        break
      case TextNotificationPool.Join:
        // Player joined — use join template
        this._playerJoinedSound?.('PlayerJoinedSound')
        break
      case TextNotificationPool.Leave:
        // Player left — use leave template
        this._playerLeftSound?.('PlayerLeftSound')
        break
      case TextNotificationPool.Chat:
        // Regular chat — use chat template
        this._chatLineSound?.('ChatLineSound')
        break
      case TextNotificationPool.Mission:
        // Mission objective — use mission template
        break
      default:
        break
    }

    // NOTE: In full migration, add chat line widget from template
    // and append to this._lobbyChatPanel
    if (scrolledToBottom) this._lobbyChatPanel.scrollToBottom(true)
  }

  // ---- Game start ----

  notifyGameStart(): void {
    Ui.closeWindow()
    this._onStart()
  }

  // ---- Lifecycle ----

  tick(): void {
    if (!this._mapAvailable && this._map.status === MapStatus.Available) {
      this._mapAvailable = true
    }
    if (this._panel === PanelType.Options && this._optionsTabDisabled()) {
      this._panel = PanelType.Players
    }
    if (!this._chatEnabled) {
      this._chatEnabled = true
      this._chatTextField.text = ''
    }
  }

  /** Clean up resources and event handlers.
   *
   * OpenRA 对照: override Dispose(bool disposing)
   * - Game.BeforeGameStart -= OnGameStart
   * - Game.ConnectionStateChanged -= ConnectionStateChanged
   * - Game.LobbyInfoChanged -= UpdateCurrentMap / UpdatePlayerList / etc.
   */
  override dispose(): void {
    if (this._disposed) return
    this._disposed = true

    // Unregister BeforeGameStart handler
    if (this._orderManager.offBeforeGameStart) {
      this._orderManager.offBeforeGameStart(this._boundOnGameStart)
    }

    // Unregister ConnectionStateChanged handler
    if (this._orderManager.offConnectionStateChanged) {
      this._orderManager.offConnectionStateChanged(this._onConnectionStateChanged)
    }

    this._lobbyInfoHandlers = []
    super.dispose()
  }
}
