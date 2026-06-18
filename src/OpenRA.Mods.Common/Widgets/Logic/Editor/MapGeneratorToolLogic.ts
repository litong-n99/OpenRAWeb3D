/**
 * MapGeneratorToolLogic.ts — 地图生成器工具 UI：动态设置表单 + 生成按钮
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/MapGeneratorToolLogic.cs (331 lines)
 *
 * 核心范式转换:
 * - C# IEditorMapGeneratorInfo / IMapGeneratorSettings → TypeScript 接口存根
 * - C# MapGeneratorBooleanOption / IntegerOption / MultiIntegerChoiceOption / MultiChoiceOption → TS stub
 * - C# FluentProvider.GetMessage → 硬编码字符串（TODO-21.C.5-DEFER-3）
 * - C# MersenneTwister (world.LocalRandom) → Math.random() (TODO-21.C.5-DEFER-2)
 * - C# ConfirmationDialogs.ButtonPrompt → console.log (deferred)
 * - C# Log.Write("debug", ...) → console.debug(...)
 *
 * 读取生成器设置，构建动态表单（4 种选项类型），在点击 Generate
 * 按钮时运行生成器。
 *
 * Migration: TODO-21.C.5 — Chapter 21 Phase C Wave 3
 */

import { ChromeLogic, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { IEditorAction, EditorActionManager } from '../../../Traits/World/EditorActionManager.js'

// ---------------------------------------------------------------------------
// Minimal widget types
// ---------------------------------------------------------------------------

type AnyWidget = Widget

// ---------------------------------------------------------------------------
// Stub interfaces for map generator types (TODO-21.C.5-DEFER-1)
// ---------------------------------------------------------------------------

/**
 * Base option interface for map generator settings.
 *
 * OpenRA 对照: MapGeneratorOption (abstract base)
 */
export interface IMapGeneratorOption {
  readonly id: string
  readonly label: string
}

/**
 * Boolean toggle option.
 *
 * OpenRA 对照: MapGeneratorBooleanOption
 */
export interface IMapGeneratorBooleanOption extends IMapGeneratorOption {
  value: boolean
}

/**
 * Integer input option.
 *
 * OpenRA 对照: MapGeneratorIntegerOption
 */
export interface IMapGeneratorIntegerOption extends IMapGeneratorOption {
  value: number
}

/**
 * Multi-choice from a set of integers.
 *
 * OpenRA 对照: MapGeneratorMultiIntegerChoiceOption
 */
export interface IMapGeneratorMultiIntegerChoiceOption extends IMapGeneratorOption {
  value: number
  readonly choices: readonly number[]
}

/**
 * Multi-choice from a set of strings (with labels).
 *
 * OpenRA 对照: MapGeneratorMultiChoiceOption
 */
export interface IMapGeneratorMultiChoiceOption extends IMapGeneratorOption {
  value: string
  readonly choices: ReadonlyMap<string, { readonly label: string; readonly description?: string }>
  readonly validChoices: (terrainInfo: unknown, playerCount: number) => readonly string[]
  readonly default: readonly string[] | null
}

/**
 * Union of all map generator option types.
 */
export type MapGeneratorOption = IMapGeneratorBooleanOption | IMapGeneratorIntegerOption | IMapGeneratorMultiIntegerChoiceOption | IMapGeneratorMultiChoiceOption

/**
 * Settings object for a map generator.
 *
 * OpenRA 对照: IMapGeneratorSettings
 */
export interface IMapGeneratorSettings {
  readonly playerCount: number
  readonly options: readonly MapGeneratorOption[]
  randomize(random: { next(): number }): void
  compile(terrainInfo: unknown, mapSize: unknown): { settings: unknown; tileset: string }
}

/**
 * Info trait for a map generator tool.
 *
 * OpenRA 对照: IEditorMapGeneratorInfo
 */
export interface IEditorMapGeneratorInfo {
  readonly type: string
  readonly label: string
  readonly name: string
  getSettings(): IMapGeneratorSettings
  generate(modData: unknown, args: { settings: unknown; tileset: string }): unknown
}

// ---------------------------------------------------------------------------
// Generated map stub results (TODO-21.C.5-DEFER-1)
// ---------------------------------------------------------------------------

/** Stub result from map generation. */
export interface IGeneratedMapResult {
  readonly allCells: { mapCoords: () => Iterable<unknown> }
  readonly resources: Record<string, { type: number; index: number }>
  readonly tiles: Record<string, unknown>
  readonly height: Record<string, number>
  readonly playerDefinitions: Array<{ key: string; value: { nodes: unknown[] } }>
  readonly actorDefinitions: Record<string, { value: string; nodes?: unknown[] }>
}

// ---------------------------------------------------------------------------
// RandomMapEditorAction (对应 OpenRA RandomMapEditorAction : IEditorAction)
// ---------------------------------------------------------------------------

/**
 * Editor action wrapper for a map generation operation.
 *
 * OpenRA 对照: RandomMapEditorAction : IEditorAction
 */
class RandomMapEditorAction implements IEditorAction {
  text: string

  private readonly onCommit: () => void
  private readonly onRevert: () => void

  constructor(description: string, onCommit: () => void, onRevert: () => void) {
    this.text = description
    this.onCommit = onCommit
    this.onRevert = onRevert
  }

  execute(): void {
    this.onCommit()
  }

  redo(): void {
    this.onCommit()
  }

  undo(): void {
    this.onRevert()
  }
}

// ---------------------------------------------------------------------------
// MapGeneratorToolLogic (对应 OpenRA MapGeneratorToolLogic : ChromeLogic)
// ---------------------------------------------------------------------------

/**
 * The UI for the map generator tool (IEditorTool trait implementing
 * IEditorMapGeneratorInfo). Reads generator settings and builds a dynamic form.
 *
 * OpenRA 对照: MapGeneratorToolLogic : ChromeLogic
 */
export class MapGeneratorToolLogic extends ChromeLogic {
  // ---- Traits ----
  private readonly editorActionManager: EditorActionManager
  private readonly generator: IEditorMapGeneratorInfo | null
  private readonly settings: IMapGeneratorSettings | null

  // ---- Widget references ----
  private readonly settingsPanel: AnyWidget
  private readonly checkboxSettingTemplate: AnyWidget
  private readonly textSettingTemplate: AnyWidget
  private readonly dropdownSettingTemplate: AnyWidget

  // ---- World references (reserved for future generator integration) ----
  // private readonly world: unknown
  // private readonly worldRenderer: unknown
  // private readonly modData: unknown

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA MapGeneratorToolLogic constructor)
  // -------------------------------------------------------------------------

  /**
   * @param widget — the root widget
   * @param editorActionManager — editor action manager for undo/redo
   * @param generator — the IEditorMapGeneratorInfo trait (may be null)
   * @param world — the world
   * @param worldRenderer — the world renderer
   * @param modData — the mod data
   */
  constructor(
    widget: AnyWidget,
    editorActionManager: EditorActionManager,
    generator: IEditorMapGeneratorInfo | null,
    _world?: unknown,
    _worldRenderer?: unknown,
    _modData?: unknown,
  ) {
    super()

    this.editorActionManager = editorActionManager
    this.generator = generator
    this.settings = generator?.getSettings() ?? null
    void _world; void _worldRenderer; void _modData // reserved

    this.settingsPanel = (widget as any).get('SETTINGS_PANEL') as AnyWidget
    this.checkboxSettingTemplate = (this.settingsPanel as any).get('CHECKBOX_TEMPLATE') as AnyWidget
    this.textSettingTemplate = (this.settingsPanel as any).get('TEXT_TEMPLATE') as AnyWidget
    this.dropdownSettingTemplate = (this.settingsPanel as any).get('DROPDOWN_TEMPLATE') as AnyWidget

    // Generate button
    const generateButton = (widget as any).get('GENERATE_BUTTON') as AnyWidget
    if (generateButton) {
      ;(generateButton as any).onClick = () => this.generateMap()
    }

    // Generate random button
    const randomButton = (widget as any).get('GENERATE_RANDOM_BUTTON') as AnyWidget
    if (randomButton) {
      ;(randomButton as any).onClick = () => {
        if (this.settings) {
          this.settings.randomize({ next: () => Math.random() })
          this.updateSettingsUi()
        }
        this.generateMap()
      }
    }

    this.updateSettingsUi()
  }

  // -------------------------------------------------------------------------
  // Tick (abstract from ChromeLogic)
  // -------------------------------------------------------------------------

  override tick(): void {
    // Map generator has no per-frame logic — UI updates on demand
  }

  // -------------------------------------------------------------------------
  // UpdateSettingsUi (对应 OpenRA UpdateSettingsUi)
  // -------------------------------------------------------------------------

  /** Rebuild the settings form from the generator's Options array.
   *
   * OpenRA 对照: UpdateSettingsUi()
   */
  updateSettingsUi(): void {
    const panel = this.settingsPanel as any
    if (!panel) return

    panel.removeChildren?.()
    if (panel.contentHeight !== undefined) {
      panel.contentHeight = 0
    }

    if (!this.generator || !this.settings) return

    void this.settings.playerCount

    for (const o of this.settings.options) {
      let settingWidget: AnyWidget | null = null

      if (this.isBooleanOption(o)) {
        // Boolean: checkbox template
        settingWidget = (this.checkboxSettingTemplate as any).clone?.() as AnyWidget
        if (!settingWidget) continue
        const checkbox = (settingWidget as any).get('CHECKBOX') as AnyWidget
        if (checkbox) {
          const label = o.label
          ;(checkbox as any).getText = () => label
          ;(checkbox as any).isChecked = () => o.value
          ;(checkbox as any).onClick = () => { o.value = !o.value }
        }
      } else if (this.isIntegerOption(o)) {
        // Integer: text template
        settingWidget = (this.textSettingTemplate as any).clone?.() as AnyWidget
        if (!settingWidget) continue
        const labelWidget = (settingWidget as any).get('LABEL') as AnyWidget
        if (labelWidget) {
          const label = o.label
          ;(labelWidget as any).getText = () => label
        }
        const textField = (settingWidget as any).get('INPUT') as AnyWidget
        if (textField) {
          ;(textField as any).text = String(o.value)
          ;(textField as any).onTextEdited = () => {
            const parsed = parseInt((textField as any).text, 10)
            if (!isNaN(parsed)) {
              o.value = parsed
              ;(textField as any).isValid = () => true
            } else {
              ;(textField as any).isValid = () => false
            }
          }
        }
      } else if (this.isMultiIntegerChoiceOption(o)) {
        // Multi-integer choice: dropdown template
        settingWidget = (this.dropdownSettingTemplate as any).clone?.() as AnyWidget
        if (!settingWidget) continue
        const labelWidget = (settingWidget as any).get('LABEL') as AnyWidget
        if (labelWidget) {
          const label = o.label
          ;(labelWidget as any).getText = () => label
        }
        const dropdown = (settingWidget as any).get('DROPDOWN') as AnyWidget
        if (dropdown) {
          ;(dropdown as any).getText = () => String(o.value)
        }
      } else if (this.isMultiChoiceOption(o)) {
        // Multi-choice: dropdown template with valid choices check
        // NOTE: Full ValidChoices filtering requires terrain info — deferred
        // TODO-21.C.5-DEFER-1: Integrate terrain info for ValidChoices
        settingWidget = (this.dropdownSettingTemplate as any).clone?.() as AnyWidget
        if (!settingWidget) continue
        const labelWidget = (settingWidget as any).get('LABEL') as AnyWidget
        if (labelWidget) {
          const label = o.label
          ;(labelWidget as any).getText = () => label
        }
        const dropdown = (settingWidget as any).get('DROPDOWN') as AnyWidget
        if (dropdown) {
          ;(dropdown as any).getText = () => {
            const choice = o.choices.get(o.value)
            return choice?.label ?? o.value
          }
        }
      }

      if (settingWidget) {
        ;(settingWidget as any).isVisible = () => true
        panel.addChild?.(settingWidget)
      }
    }
  }

  // -------------------------------------------------------------------------
  // GenerateMap (对应 OpenRA GenerateMap + GenerateMapMayThrow)
  // -------------------------------------------------------------------------

  /** Run the generator (with error handling).
   *
   * OpenRA 对照: GenerateMap()
   */
  generateMap(): void {
    try {
      this.generateMapMayThrow()
    } catch (e) {
      this.displayError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  /** Run the generator, may throw.
   *
   * OpenRA 对照: GenerateMapMayThrow()
   *
   * NOTE: Full generation pipeline (MapGenerator.Generate, EditorBlit.Commit)
   *   is deferred. The stub creates a minimal RandomMapEditorAction.
   *   TODO-21.C.5-DEFER-1: Full map generator integration
   */
  generateMapMayThrow(): void {
    if (!this.generator || !this.settings) return

    // NOTE: In C# this does the full pipeline:
    // modData.DefaultTerrainInfo[map.Tileset] →
    // args = settings.Compile(terrainInfo, map.MapSize) →
    // generatedMap = generator.Generate(modData, args) →
    // EditorBlit.Commit() → RandomMapEditorAction → actionManager.Add()

    // Stub: create a minimal editor action with description
    const description = `Generated map with ${this.generator.label}`
    const action = new RandomMapEditorAction(
      description,
      () => { /* commit: no-op stub */ },
      () => { /* revert: no-op stub */ },
    )
    this.editorActionManager.Add(action)
  }

  // -------------------------------------------------------------------------
  // DisplayError (对应 OpenRA DisplayError)
  // -------------------------------------------------------------------------

  /** Display an error from map generation.
   *
   * OpenRA 对照: DisplayError(Exception e)
   *
   * NOTE: ConfirmationDialogs.ButtonPrompt is not yet migrated.
   *   Logs to console instead.
   *   TODO-21.C.5-DEFER-1: Integrate real dialog system
   */
  displayError(e: Error): void {
    console.debug(e)
    console.error('Map generator failed:', e.message)
  }

  // -------------------------------------------------------------------------
  // Type guards for option types
  // -------------------------------------------------------------------------

  private isBooleanOption(o: MapGeneratorOption): o is IMapGeneratorBooleanOption {
    return 'choices' in o === false && typeof (o as any).value === 'boolean'
  }

  private isIntegerOption(o: MapGeneratorOption): o is IMapGeneratorIntegerOption {
    return 'choices' in o === false && typeof (o as IMapGeneratorIntegerOption).value === 'number'
  }

  private isMultiIntegerChoiceOption(o: MapGeneratorOption): o is IMapGeneratorMultiIntegerChoiceOption {
    return 'choices' in o && Array.isArray((o as any).choices) && (o as any).choices.length > 0 && typeof (o as any).choices[0] === 'number'
  }

  private isMultiChoiceOption(o: MapGeneratorOption): o is IMapGeneratorMultiChoiceOption {
    return 'choices' in o && (o as any).choices instanceof Map
  }
}
