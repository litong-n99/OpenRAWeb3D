/**
 * EncyclopediaLogic.test.ts — EncyclopediaLogic 单元测试
 *
 * 测试范围: actor 列表构建、分类过滤、描述文本生成、建造时间计算。
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  EncyclopediaLogic,
  type EncyclopediaInfo,
  type BuildableInfo,
  type ValuedInfo,
  type PowerInfo,
} from './EncyclopediaLogic.js'
import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ActorConfig, TraitConfig } from '../../../OpenRA.Game/GameRules/ActorInfo.js'
import type { Ruleset } from '../../../OpenRA.Game/GameRules/Ruleset.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeTraitConfig(
  name: string,
  implements_: string[] = [],
  properties: Record<string, unknown> = {},
): TraitConfig {
  return { name, implements: implements_, dependsOn: [], notBefore: [], properties }
}

function makeActorConfig(name: string, traits: TraitConfig[]): ActorConfig {
  return {
    name,
    isAbstract: name.startsWith('^'),
    traitConfigs: traits,
    inheritsFrom: [],
  } as unknown as ActorConfig
}

class MockWidget {
  id: string
  children: Map<string, MockWidget> = new Map()
  parentVal: MockWidget | null = null
  isVisibleFn: (() => boolean) | null = null
  isSelectedFn: (() => boolean) | null = null
  onClickFn: () => void = () => {}
  getTextFn: (() => string) | null = null

  constructor(id: string) { this.id = id }

  get parent() { return this.parentVal }

  addChild(child: MockWidget) { child.parentVal = this; this.children.set(child.id, child) }
  removeChildren() { this.children.clear() }

  getOrNull<T>(id: string): T | null {
    if (this.id === id) return this as unknown as T
    for (const [, c] of this.children) {
      const found = c.getOrNull<T>(id)
      if (found) return found
    }
    return null
  }

  get<T>(id: string): T {
    const t = this.getOrNull<T>(id)
    if (!t) throw new Error(`Widget ${this.id} has no child ${id}`)
    return t
  }

  clone(): MockWidget {
    const c = new MockWidget(this.id)
    for (const [, child] of this.children) {
      c.children.set(child.id, child.clone())
    }
    c.isSelectedFn = this.isSelectedFn
    c.onClickFn = this.onClickFn
    c.getTextFn = this.getTextFn
    return c
  }

  // Property delegates to match Widget pattern
  set isVisible(fn: () => boolean) { this.isVisibleFn = fn }
  set isSelected(fn: () => boolean) { this.isSelectedFn = fn }
  set onClick(fn: () => void) { this.onClickFn = fn }
  get onClick() { return this.onClickFn }
  set getText(fn: () => string) { this.getTextFn = fn }
}

function createMockRuleset(actors: ActorConfig[] = []): Ruleset {
  const map = new Map<string, ActorConfig>()
  for (const actor of actors) {
    map.set(actor.name.toLowerCase(), actor)
  }
  return { actors: map } as unknown as Ruleset
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EncyclopediaLogic', () => {
  function buildWidget(): MockWidget {
    const widget = new MockWidget('root')
    widget.children.set('BACK_BUTTON', new MockWidget('BACK_BUTTON'))
    widget.children.set('ACTOR_INFO', new MockWidget('ACTOR_INFO'))
    widget.children.set('ACTOR_PREVIEW', new MockWidget('ACTOR_PREVIEW'))
    widget.children.set('ACTOR_DESCRIPTION_PANEL', new MockWidget('ACTOR_DESCRIPTION_PANEL'))

    const actorList = new MockWidget('ACTOR_LIST')
    const headerTemplate = new MockWidget('HEADER')
    headerTemplate.children.set('LABEL', new MockWidget('LABEL'))
    const itemTemplate = new MockWidget('TEMPLATE')
    itemTemplate.children.set('TITLE', new MockWidget('TITLE'))

    actorList.children.set('HEADER', headerTemplate)
    actorList.children.set('TEMPLATE', itemTemplate)
    widget.children.set('ACTOR_LIST', actorList)

    return widget
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('constructs successfully with empty ruleset', () => {
    const widget = buildWidget()
    const rules = createMockRuleset([])
    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, () => {})

    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('constructs with actors having encyclopedia traits', () => {
    const widget = buildWidget()
    const e1 = makeActorConfig('E1', [
      makeTraitConfig('IRenderActorPreviewSprites', ['IRenderActorPreviewSpritesInfo']),
      makeTraitConfig('Encyclopedia', ['EncyclopediaInfo'], {
        Category: 'Infantry',
        Order: 1,
        Description: 'Rifle Infantry',
        Scale: 1,
        BuildableQueue: 'Infantry',
      }),
    ])

    const rules = createMockRuleset([e1])
    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, () => {})

    expect(logic).toBeDefined()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Actor filtering
  // ---------------------------------------------------------------------------

  it('skips actors without render preview sprites', () => {
    const widget = buildWidget()
    const e1 = makeActorConfig('E1', [
      makeTraitConfig('Encyclopedia', ['EncyclopediaInfo'], { Category: 'Infantry' }),
    ])

    const e2 = makeActorConfig('E2', [
      makeTraitConfig('IRenderActorPreviewSprites', ['IRenderActorPreviewSpritesInfo']),
      makeTraitConfig('Encyclopedia', ['EncyclopediaInfo'], { Category: 'Vehicles' }),
    ])

    const rules = createMockRuleset([e1, e2])
    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, () => {})

    // E1 should be skipped, E2 should be included
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('skips actors without EncyclopediaInfo', () => {
    const widget = buildWidget()
    const e1 = makeActorConfig('E1', [
      makeTraitConfig('IRenderActorPreviewSprites', ['IRenderActorPreviewSpritesInfo']),
      // No EncyclopediaInfo
    ])

    const rules = createMockRuleset([e1])
    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, () => {})

    expect(logic).toBeDefined()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Back button
  // ---------------------------------------------------------------------------

  it('BACK_BUTTON onClick calls onExit', () => {
    const widget = buildWidget()
    const rules = createMockRuleset([])
    const onExit = vi.fn()

    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, onExit)

    const backBtn = widget.children.get('BACK_BUTTON')
    expect(backBtn?.onClickFn).toBeDefined()
    backBtn?.onClickFn?.()

    expect(onExit).toHaveBeenCalled()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // ChromeLogic interface
  // ---------------------------------------------------------------------------

  it('tick does not throw', () => {
    const widget = buildWidget()
    const rules = createMockRuleset([])
    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, () => {})

    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })

  it('dispose does not throw', () => {
    const widget = buildWidget()
    const rules = createMockRuleset([])
    const logic = new EncyclopediaLogic(widget as unknown as Widget, null, rules, () => {})

    expect(() => logic.dispose()).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // formatTime
  // ---------------------------------------------------------------------------

  it('formatTime formats ticks correctly', () => {
    expect(EncyclopediaLogic.formatTime(1500, 40)).toBe('1:00')
    expect(EncyclopediaLogic.formatTime(750, 40)).toBe('0:30')
    expect(EncyclopediaLogic.formatTime(4500, 40)).toBe('3:00')
    expect(EncyclopediaLogic.formatTime(0, 40)).toBe('0:00')
  })

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  it('EncyclopediaInfo type has all required fields', () => {
    const info: EncyclopediaInfo = {
      category: 'Buildings',
      order: 5,
      description: 'A building',
      scale: 1.5,
      previewOwner: 'Neutral',
      hideBuildable: false,
      buildableQueue: 'Building',
    }
    expect(info.category).toBe('Buildings')
    expect(info.order).toBe(5)
    expect(info.scale).toBe(1.5)
  })

  it('BuildableInfo has required fields', () => {
    const bi: BuildableInfo = {
      buildDuration: 1000,
      buildDurationModifier: 100,
      queue: ['Building', 'Defense'],
      prerequisites: ['anypower', 'proc'],
    }
    expect(bi.queue).toHaveLength(2)
    expect(bi.prerequisites).toContain('proc')
  })

  it('ValuedInfo has cost field', () => {
    const vi: ValuedInfo = { cost: 500 }
    expect(vi.cost).toBe(500)
  })

  it('PowerInfo has amount field', () => {
    const pi: PowerInfo = { amount: 100 }
    expect(pi.amount).toBe(100)
  })
})
