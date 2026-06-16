/**
 * ServerCreationLogic.ts — Multiplayer server creation screen logic
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/ServerCreationLogic.cs (257 lines)
 *
 * 核心范式转换:
 * - C# Game.Settings.Server.* → TypeScript settings object
 * - C# Game.CreateServer → simplified server creation function
 * - C# ConnectionLogic.Connect → ConnectionLogic.connect
 * - C# ConfirmationDialogs.ButtonPrompt → ConfirmationDialogs.buttonPrompt
 * - C# Nat.Status enum → simplified NAT detection
 * - C# MapPreview widget → MapPreviewWidget (TODO-16.C.3)
 * - C# FluentProvider.GetMessage → inline string (Fluent deferred TODO-16.C.1)
 */

import { ChromeLogic, Ui } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ButtonWidget } from '../../Widgets/ButtonWidget.js'
import type { TextFieldWidget } from '../../Widgets/TextFieldWidget.js'
import type { CheckboxWidget } from '../../Widgets/CheckboxWidget.js'
import type { LabelWidget } from '../../Widgets/LabelWidget.js'
import type { PasswordFieldWidget } from '../../Widgets/PasswordFieldWidget.js'
import { ConnectionLogic, type ConnectionTarget } from './ConnectionLogic.js'
import type { MapPreviewLobby } from './Lobby/LobbyTypes.js'

// ---------------------------------------------------------------------------
// Helper: access child widget by ID
// ---------------------------------------------------------------------------

function widgetChild<T extends Widget = Widget>(parent: Widget, id: string): T | undefined {
  return (parent as unknown as Record<string, unknown>)[id] as T | undefined
}

// ---------------------------------------------------------------------------
// NatStatus — UPnP/NAT status
// ---------------------------------------------------------------------------

export const NatStatus = {
  NotSupported: 'NotSupported',
  Disabled: 'Disabled',
  Enabled: 'Enabled',
} as const

export type NatStatus = (typeof NatStatus)[keyof typeof NatStatus]

// ---------------------------------------------------------------------------
// ServerSettings — server configuration
// ---------------------------------------------------------------------------

export interface ServerSettings {
  name: string
  listenPort: number
  password: string
  advertiseOnline: boolean
  map: string
}

// ---------------------------------------------------------------------------
// MapCache (simplified)
// ---------------------------------------------------------------------------

export interface MapCacheStub {
  get(uid: string): MapPreviewLobby
  pickLastModifiedMap(filter: unknown): string | null
  chooseInitialMap(fallback: string, random: unknown): string
  updateMaps(): void
}

export interface ModDataStub {
  mapCache: MapCacheStub
}

// ---------------------------------------------------------------------------
// ServerCreationLogic — server configuration screen
// OpenRA 对照: ServerCreationLogic : ChromeLogic
// ---------------------------------------------------------------------------

export class ServerCreationLogic extends ChromeLogic {
  private _disposed = false
  private readonly _map: MapPreviewLobby
  private readonly _onExit: () => void
  private readonly _onCreate: () => void
  private _advertiseOnline: boolean
  private _settings: ServerSettings

  constructor(
    widget: Widget,
    modData: ModDataStub,
    onExit: () => void,
    openLobby: () => void,
  ) {
    super()
    this._onExit = onExit
    this._onCreate = openLobby

    this._settings = {
      name: 'OpenRA Web Server',
      listenPort: 1234,
      password: '',
      advertiseOnline: true,
      map: '',
    }

    this._advertiseOnline = this._settings.advertiseOnline

    const initialMap = modData.mapCache.pickLastModifiedMap(null) || this._settings.map
    this._map = modData.mapCache.get(initialMap)

    // Back button
    const backButton = widgetChild<ButtonWidget>(widget, 'BACK_BUTTON')
    if (backButton) {
      backButton.onClick = () => {
        Ui.closeWindow()
        this._onExit()
      }
    }

    // Create button
    const createButton = widgetChild<ButtonWidget>(widget, 'CREATE_BUTTON')
    if (createButton) {
      createButton.onClick = () => this._createAndJoin()
    }

    // Map button
    const mapButton = widgetChild<ButtonWidget>(widget, 'MAP_BUTTON')
    if (mapButton) {
      mapButton.onClick = () => {
        modData.mapCache.updateMaps()
      }
    }

    // Server name
    const serverName = widgetChild<TextFieldWidget>(widget, 'SERVER_NAME')
    if (serverName) {
      serverName.text = this._sanitizeServerName(this._settings.name)
      serverName.onEnterKey = () => {
        serverName.yieldKeyboardFocus()
        return true
      }
      serverName.onLoseFocus = () => {
        serverName.text = this._sanitizeServerName(serverName.text)
        this._settings.name = serverName.text
      }
    }

    // Listen port
    const listenPort = widgetChild<TextFieldWidget>(widget, 'LISTEN_PORT')
    if (listenPort) {
      listenPort.text = String(this._settings.listenPort)
    }

    // Advertise checkbox
    const advertiseCheckbox = widgetChild<CheckboxWidget>(widget, 'ADVERTISE_CHECKBOX')
    if (advertiseCheckbox) {
      advertiseCheckbox.isChecked = () => this._advertiseOnline
      advertiseCheckbox.onClick = () => {
        this._advertiseOnline = !this._advertiseOnline
        this._buildNotices(widget)
      }
    }

    // Password field
    const passwordField = widgetChild<PasswordFieldWidget>(widget, 'PASSWORD')
    if (passwordField) {
      passwordField.text = this._settings.password
    }

    this._buildNotices(widget)
  }

  private _buildNotices(widget: Widget): void {
    const noticesA = widgetChild<LabelWidget>(widget, 'NOTICES_HEADER_A')
    if (!noticesA) return

    const noticesB = widgetChild<LabelWidget>(widget, 'NOTICES_HEADER_B')
    const noticesC = widgetChild<LabelWidget>(widget, 'NOTICES_HEADER_C')

    if (this._advertiseOnline) {
      noticesA.getText = () => 'Internet server: NAT traversal '
      if (noticesB) {
        noticesB.getText = () => this._detectNat()
        noticesB.visible = true
      }
      if (noticesC) {
        noticesC.getText = () => ' (requires UPnP router)'
        noticesC.visible = true
      }
    } else {
      noticesA.getText = () => 'Local/LAN server only'
      if (noticesB) noticesB.visible = false
      if (noticesC) noticesC.visible = false
    }

    const noticesNoUPnP = widgetChild(widget, 'NOTICES_NO_UPNP')
    if (noticesNoUPnP) {
      noticesNoUPnP.isVisible = () =>
        this._advertiseOnline && this._detectNat() !== NatStatus.Enabled
    }

    const noticesUPnP = widgetChild(widget, 'NOTICES_UPNP')
    if (noticesUPnP) {
      noticesUPnP.isVisible = () =>
        this._advertiseOnline && this._detectNat() === NatStatus.Enabled
    }

    const noticesLAN = widgetChild(widget, 'NOTICES_LAN')
    if (noticesLAN) {
      noticesLAN.isVisible = () => !this._advertiseOnline
    }
  }

  private _detectNat(): string {
    return NatStatus.NotSupported
  }

  private _sanitizeServerName(name: string): string {
    const trimmed = name.trim()
    if (trimmed.length === 0) return 'OpenRA Web Server'
    if (trimmed.length > 60) return trimmed.substring(0, 60)
    return trimmed
  }

  private _createAndJoin(): void {
    if (this._map.status !== 'Available') return

    // NOTE: In full migration, read widget values from actual widget tree
    const name = this._sanitizeServerName(this._settings.name)
    const listenPort = this._settings.listenPort
    const password = this._settings.password

    this._settings.name = name
    this._settings.listenPort = listenPort
    this._settings.advertiseOnline = this._advertiseOnline
    this._settings.map = this._map.uid
    this._settings.password = password

    const endpoint: ConnectionTarget = {
      host: 'localhost',
      port: listenPort,
    }

    Ui.closeWindow()
    ConnectionLogic.connect(endpoint, password, this._onCreate, this._onExit)
  }

  tick(): void {
    // No per-frame logic needed
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
  }
}
