/**
 * MapGeneratorLogic.ts — 随机地图生成界面逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MapGeneratorLogic.cs (463 lines)
 */

import { ChromeLogic, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ModDataStub } from './MapChooserLogic.js'
import type { MapPreviewStub, MapGenerationArgsStub } from './BrowserTypes.js'

export interface MapGeneratorBooleanOption { type: 'boolean'; id: string; label: string; value: boolean }
export interface MapGeneratorIntegerOption { type: 'integer'; id: string; label: string; value: number }
export interface MapGeneratorMultiIntegerChoiceOption { type: 'multiIntegerChoice'; id: string; label: string; value: number; choices: number[] }
export interface MapGeneratorMultiChoiceOption { type: 'multiChoice'; id: string; label: string | null; value: string; default: string | null; choices: Map<string, { label: string; description?: string }> }
export type MapGeneratorOption = MapGeneratorBooleanOption | MapGeneratorIntegerOption | MapGeneratorMultiIntegerChoiceOption | MapGeneratorMultiChoiceOption
export interface MapGeneratorSettings { playerCount: number; options: MapGeneratorOption[]; randomize(rng: { nextDouble: () => number }): void; initialize(args: MapGenerationArgsStub): void; compile(terrain: { id: string; name: string }, size: { width: number; height: number }): MapGenerationArgsStub }
export interface IEditorMapGeneratorInfo { name: string; tilesets: string[]; getSettings(): MapGeneratorSettings; generate(modData: ModDataStub, args: MapGenerationArgsStub): MapPreviewStub }

const MapSizes = new Map<string, { width: number; height: number }>([
  ['Small', { width: 48, height: 60 }], ['Medium', { width: 60, height: 90 }],
  ['Large', { width: 90, height: 120 }], ['Huge', { width: 120, height: 160 }],
])

export class MapGeneratorLogic extends ChromeLogic {
  readonly modData: ModDataStub; readonly generator: IEditorMapGeneratorInfo
  readonly settings: MapGeneratorSettings; readonly onGenerate: ((args: MapGenerationArgsStub, _package: unknown) => void) | null
  readonly settingsPanel: Widget
  selectedTerrain: { id: string; name: string }; selectedSize = 'Medium'
  size: { width: number; height: number } = { width: 60, height: 90 }
  generationCounter = 0; lastGeneration = 0; failed = false; initialGenerationDone = false
  get isGenerating(): boolean { return this.lastGeneration !== this.generationCounter }

  constructor(widget: Widget, modData: ModDataStub, generator: IEditorMapGeneratorInfo, onGenerate: ((args: MapGenerationArgsStub, _package: unknown) => void) | null = null) {
    super()
    this.modData = modData; this.generator = generator; this.settings = generator.getSettings(); this.onGenerate = onGenerate
    this.settingsPanel = widget.get<Widget>('SETTINGS_PANEL')
    this.selectedTerrain = { id: generator.tilesets[0]!, name: generator.tilesets[0]! }
  }

  static mapSizeLabel(size: { width: number; height: number }): string {
    const area = size.width * size.height
    const label = area >= 120 * 120 ? 'Huge' : area >= 90 * 90 ? 'Large' : area >= 60 * 60 ? 'Medium' : 'Small'
    return `${size.width}x${size.height} (${label})`
  }

  randomizeSize(): void {
    const sr = MapSizes.get(this.selectedSize)
    if (!sr) { this.size = { width: 60, height: 90 }; return }
    const w = sr.width + Math.floor(Math.random() * (sr.height - sr.width))
    this.size = { width: w + 2, height: w * 2 + 6 }
  }

  refreshSettings(): void {
    this.settingsPanel.removeChildren()
    // NOTE: Settings population uses Phase A widgets (DropDownButtonWidget,
    // CheckboxWidget, TextFieldWidget). Full implementation deferred.
  }

  generateMap(): void {
    this.generationCounter++; const currentGeneration = this.generationCounter; this.failed = false
    this.onGenerate?.(null as unknown as MapGenerationArgsStub, null)
    void (async () => {
      if (currentGeneration !== this.generationCounter) return
      try {
        const args = this.settings.compile(this.selectedTerrain, this.size)
        const map = this.generator.generate(this.modData, args)
        if (currentGeneration === this.generationCounter) { args.uid = map.uid; this.lastGeneration = currentGeneration; this.onGenerate?.(args, null) }
      } catch { if (currentGeneration === this.generationCounter) { this.lastGeneration = currentGeneration; this.failed = true } }
    })()
  }

  tick(): void { if (!this.initialGenerationDone && !this.isGenerating) { this.initialGenerationDone = true; this.generateMap() } }
  override dispose(): void { this.generationCounter = 0; this.lastGeneration = 0; super.dispose() }
}
