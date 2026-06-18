/**
 * LobbyOptionsLogic.ts — Game options configuration screen
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyOptionsLogic.cs (198 lines)
 *
 * 核心范式转换:
 * - C# ILobbyOptions trait system → simplified LobbyOption interface
 * - C# ScrollPanelWidget → existing ScrollPanelWidget (Ch16 Phase A)
 * - C# CLONE template pattern → TypeScript widget template cloning
 * - C# PredictedCachedTransform → PredictedCachedTransform from LobbyTypes
 * - C# FluentProvider.GetMessage → stub ()
 * - C# LobbyUtils.SplitOnFirstToken → splitOnFirstToken from LobbyUtils
 */

import { ChromeLogic } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { ScrollPanelWidget } from '../../../Widgets/ScrollPanelWidget.js'
import type { CheckboxWidget } from '../../../Widgets/CheckboxWidget.js'
import type { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
import type { LabelWidget } from '../../../Widgets/LabelWidget.js'
import { splitOnFirstToken } from './LobbyUtils.js'
import {
  CachedTransform,
  PredictedCachedTransform,
  type LobbyOption,
  type LobbyBooleanOption,
  type LobbyOptionState,
  type SessionGlobal,
  type MapPreviewLobby,
  type OrderManagerLobby,
} from './LobbyTypes.js'

// ---------------------------------------------------------------------------
// Helper: access child widget by ID
// ---------------------------------------------------------------------------

function wc<T extends Widget = Widget>(parent: Widget, id: string): T | undefined {
  return (parent as unknown as Record<string, unknown>)[id] as T | undefined
}

// ---------------------------------------------------------------------------
// Fluent stub
// ---------------------------------------------------------------------------

function fluentMsg(key: string): string {
  return key
}

// ---------------------------------------------------------------------------
// Type guard for boolean options
// ---------------------------------------------------------------------------

function isLobbyBooleanOption(opt: LobbyOption): opt is LobbyBooleanOption {
  return 'enabledByDefault' in opt
}

// ---------------------------------------------------------------------------
// LobbyOptionsLogic — game options tab
// OpenRA 对照: LobbyOptionsLogic : ChromeLogic
// ---------------------------------------------------------------------------

export class LobbyOptionsLogic extends ChromeLogic {
  private _disposed = false
  private readonly _getMap: () => MapPreviewLobby
  private readonly _orderManager: OrderManagerLobby
  private readonly _configurationDisabled: () => boolean
  private _mapPreview: MapPreviewLobby | null = null
  private _mapStatus: string = ''

  private readonly _panel: ScrollPanelWidget
  private readonly _optionsContainer: Widget
  private readonly _checkboxRowTemplate: Widget
  private readonly _dropdownRowTemplate: Widget
  private readonly _yMargin: number

  constructor(
    widget: Widget,
    orderManager: OrderManagerLobby,
    getMap: () => MapPreviewLobby,
    configurationDisabled: () => boolean,
  ) {
    super()
    this._getMap = getMap
    this._orderManager = orderManager
    this._configurationDisabled = configurationDisabled

    this._panel = widget as unknown as ScrollPanelWidget
    this._optionsContainer = wc(widget, 'LOBBY_OPTIONS')!
    this._yMargin = this._optionsContainer.bounds.y
    this._checkboxRowTemplate = wc(this._optionsContainer, 'CHECKBOX_ROW_TEMPLATE')!
    this._dropdownRowTemplate = wc(this._optionsContainer, 'DROPDOWN_ROW_TEMPLATE')!

    this._mapPreview = this._getMap()
    this._mapStatus = this._mapPreview?.status || ''
    this._rebuildOptions()
  }

  tick(): void {
    const newMap = this._getMap()
    if (newMap === this._mapPreview && this._mapStatus === newMap.status) return
    this._mapPreview = newMap
    this._mapStatus = newMap.status
    this._rebuildOptions()
  }

  private _rebuildOptions(): void {
    const map = this._mapPreview
    if (!map) return

    this._optionsContainer.removeChildren()
    this._optionsContainer.bounds.height = 0

    const allOptions = this._getLobbyOptions(map)
    const checkboxColumns: CheckboxWidget[] = []
    const dropdownColumns: DropDownButtonWidget[] = []

    for (const option of allOptions) {
      if (isLobbyBooleanOption(option)) {
        if (checkboxColumns.length === 0) {
          const row = this._checkboxRowTemplate.clone()
          row.bounds.y = this._optionsContainer.bounds.height
          this._optionsContainer.bounds.height += row.bounds.height
          for (const child of row.children) {
            if (typeof (child as CheckboxWidget).isChecked === 'function') {
              checkboxColumns.push(child as CheckboxWidget)
            }
          }
          this._optionsContainer.addChild(row)
        }
        const checkbox = checkboxColumns.shift()
        if (!checkbox) continue

        const optionEnabled = new PredictedCachedTransform<SessionGlobal, boolean>(
          gs => gs.lobbyOptions[option.id]?.isEnabled ?? false,
        )
        const optionLocked = new CachedTransform<SessionGlobal, boolean>(
          gs => gs.lobbyOptions[option.id]?.isLocked ?? false,
        )

        checkbox.getText = () => option.name
        if (option.description) {
          const [text, desc] = splitOnFirstToken(option.description)
          ;(checkbox as unknown as Record<string, unknown>)['getTooltipText'] = () => text
          ;(checkbox as unknown as Record<string, unknown>)['getTooltipDesc'] = () => desc
        }
        checkbox.isVisible = () => true
        checkbox.isChecked = () => optionEnabled.update(this._orderManager.lobbyInfo.globalSettings)
        checkbox.isDisabled = () =>
          this._configurationDisabled() ||
          optionLocked.update(this._orderManager.lobbyInfo.globalSettings)

        checkbox.onClick = () => {
          const state = !optionEnabled.update(this._orderManager.lobbyInfo.globalSettings)
          this._orderManager.issueOrder({ type: 'command', text: `option ${option.id} ${state}` })
          optionEnabled.predict(state)
        }
      } else {
        if (dropdownColumns.length === 0) {
          const row = this._dropdownRowTemplate.clone()
          row.bounds.y = this._optionsContainer.bounds.height
          this._optionsContainer.bounds.height += row.bounds.height
          for (const child of row.children) {
            if (typeof (child as DropDownButtonWidget).showDropDown === 'function') {
              dropdownColumns.push(child as DropDownButtonWidget)
            }
          }
          this._optionsContainer.addChild(row)
        }
        const dropdown = dropdownColumns.shift()
        if (!dropdown) continue

        const optionValue = new CachedTransform<SessionGlobal, LobbyOptionState>(
          gs => gs.lobbyOptions[option.id],
        )
        const getOptionLabel = new CachedTransform<string, string>(id => {
          if (!id || !option.values[id]) return fluentMsg('label-not-available')
          return option.values[id]
        })

        const gs = this._orderManager.lobbyInfo.globalSettings
        const cv = optionValue.update(gs)
        dropdown.getText = () => getOptionLabel.update(cv?.value || option.defaultValue)

        if (option.description) {
          const [text, desc] = splitOnFirstToken(option.description)
          ;(dropdown as unknown as Record<string, unknown>)['getTooltipText'] = () => text
          ;(dropdown as unknown as Record<string, unknown>)['getTooltipDesc'] = () => desc
        }
        dropdown.isVisible = () => true
        dropdown.isDisabled = () =>
          this._configurationDisabled() ||
          (optionValue.update(this._orderManager.lobbyInfo.globalSettings)?.isLocked ?? false)

        dropdown.onMouseDown = () => {
          const entries = Object.entries(option.values)
          const self = this
          const setupItem = (entry: [string, string], _t: unknown): unknown => {
            const [key, label] = entry
            const selected = () =>
              (optionValue.update(self._orderManager.lobbyInfo.globalSettings)?.value || option.defaultValue) === key
            const onClick = () =>
              self._orderManager.issueOrder({ type: 'command', text: `option ${option.id} ${key}` })
            return { selected, onClick, label }
          }
          dropdown.showDropDown('LABEL_DROPDOWN_TEMPLATE', entries.length * 30, entries, setupItem)
        }

        const descLabel = wc<LabelWidget>(dropdown as unknown as Widget, dropdown.id + '_DESC')
        if (descLabel) {
          descLabel.getText = () => option.name + ':'
          descLabel.isVisible = () => true
        }
      }
    }

    this._panel.contentHeight = this._yMargin + this._optionsContainer.bounds.height
    this._optionsContainer.bounds.y = this._yMargin
    this._panel.scrollToTop()
  }

  /** Extract lobby options from map. Simplified stub. : Full ILobbyOptions migration. */
  private _getLobbyOptions(_map: MapPreviewLobby): LobbyOption[] {
    return [
      {
        id: 'startingcash', name: 'Starting Cash',
        description: 'Amount of credits each player starts with',
        defaultValue: '5000', isVisible: true, displayOrder: 1,
        values: { '2500': '$2,500', '5000': '$5,000', '7500': '$7,500', '10000': '$10,000', '20000': '$20,000' },
        label: (v: string) => v,
      },
      {
        id: 'techlevel', name: 'Tech Level',
        description: 'Maximum technology level available',
        defaultValue: 'unrestricted', isVisible: true, displayOrder: 2,
        values: { '1': 'Low', '2': 'Medium', '3': 'High', 'unrestricted': 'Unrestricted' },
        label: (v: string) => v,
      },
      {
        id: 'fog', name: 'Fog of War', description: 'Enable fog of war',
        defaultValue: 'true', isVisible: true, displayOrder: 3, values: {},
        label: (v: string) => v, enabledByDefault: true,
      } as LobbyBooleanOption,
      {
        id: 'crates', name: 'Crates', description: 'Enable crates',
        defaultValue: 'true', isVisible: true, displayOrder: 4, values: {},
        label: (v: string) => v, enabledByDefault: true,
      } as LobbyBooleanOption,
      {
        id: 'shortgame', name: 'Short Game', description: 'Game ends when a player is defeated',
        defaultValue: 'true', isVisible: true, displayOrder: 5, values: {},
        label: (v: string) => v, enabledByDefault: true,
      } as LobbyBooleanOption,
      {
        id: 'cheats', name: 'Debug Menu', description: 'Enable debug/cheat menu',
        defaultValue: 'false', isVisible: true, displayOrder: 6, values: {},
        label: (v: string) => v, enabledByDefault: false,
      } as LobbyBooleanOption,
    ]
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
  }
}
