/**
 * __test_utils.ts — shared test utilities for Phase C browser Logic tests.
 *
 * Provides a recursive mock widget factory that dynamically creates
 * child widgets on demand, enabling deep widget tree lookup without
 * manual tree population.
 */

import { ContainerWidget, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'

/** Create a recursive mock widget. Every getOrNull() call that misses
 *  creates a new auto-populating child widget. */
export function createRecursiveMockWidget(id = 'root'): ContainerWidget {
  const w = new ContainerWidget()
  w.id = id
  w.bounds = { x: 0, y: 0, width: 1024, height: 768 }
  w.isVisible = () => true

  const children = new Map<string, ContainerWidget>()

  // Override getOrNull to auto-create children recursively
  w.getOrNull = <T extends Widget>(childId: string): T | null => {
    if (children.has(childId)) return children.get(childId) as unknown as T
    const child = createRecursiveMockWidget(childId)
    children.set(childId, child)
    child.parent = w
    return child as unknown as T
  }

  // Override get to use our custom getOrNull
  w.get = <T extends Widget>(childId: string): T => {
    const t = w.getOrNull<T>(childId)
    if (t === null) throw new Error(`Widget ${id} has no child ${childId}`)
    return t
  }

  // Override addChild
  w.addChild = (child: Widget): void => {
    children.set(child.id, child as ContainerWidget)
    child.parent = w
  }

  // Override removeChildren
  w.removeChildren = (): void => {
    children.clear()
  }

  return w
}
