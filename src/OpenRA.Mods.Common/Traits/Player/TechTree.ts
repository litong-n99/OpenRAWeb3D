/**
 * TechTree.ts -- 科技树管理器：前提条件追踪与建造限制检查
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/TechTree.cs (200 lines)
 *
 * 核心范式转换:
 * - C# List<Watcher> + LINQ → TS Watcher[] + 显式循环 (PERF 要求)
 * - C# Dictionary<string, int> ownedPrerequisites → TS Map<string, number>
 * - C# ImmutableArray<string> prerequisites → TS readonly string[]
 * - C# ActorAdded/ActorRemoved 事件 → TS 显式 actorChanged() 调用
 * - C# HasPrerequisites XOR 逻辑 → TS 布尔 !== 比较
 *
 * 关键逻辑：前提条件字符串前缀语义
 *   - `!` 前缀：反转前提条件（该 Actor 必须不存在才能建造）
 *   - `~` 前缀：当不满足时从生产面板隐藏（但不阻止建造）
 *   - `!~` 或 `~!`：两者组合
 *
 * HasPrerequisites 的 XOR 逻辑（C# 行 69-71）：
 *   `startsWith('!') ^ !containsKey`  → TS: `A !== B`
 *   其中 A = prereq.startsWith('!'), B = !ownedPrerequisites.has(key)
 *   简化为：若 `prereq.startsWith('!') === ownedPrerequisites.has(key)` 则前提不满足
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ITechTreeElement — callback interface for prerequisite state changes
// OpenRA 对照: ITechTreeElement
// ---------------------------------------------------------------------------

/** Callback interface for objects that watch tech tree prerequisite state.
 *
 * OpenRA 对照: ITechTreeElement
 *
 * Implementers (typically ProductionQueue) receive notifications when
 * prerequisites become available/unavailable or when items should be
 * hidden/shown in the UI.
 */
export interface ITechTreeElement {
  /** Called when all prerequisites for this item are now satisfied.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesAvailable(string)
   */
  prerequisitesAvailable(key: string): void

  /** Called when prerequisites for this item are no longer satisfied.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesUnavailable(string)
   */
  prerequisitesUnavailable(key: string): void

  /** Called when this item should be hidden from the production palette.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesItemHidden(string)
   */
  prerequisitesItemHidden(key: string): void

  /** Called when this item should be shown in the production palette.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesItemVisible(string)
   */
  prerequisitesItemVisible(key: string): void
}

// ---------------------------------------------------------------------------
// TechTreeInfo
// OpenRA 对照: TechTreeInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the TechTree trait.
 *
 * OpenRA 对照: TechTreeInfo
 *
 * TechTree is a player-level trait that manages build limits and prerequisites.
 * It attaches to the player actor.
 */
export class TechTreeInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// TechTree
// OpenRA 对照: TechTree class
// ---------------------------------------------------------------------------

/** Manages build limits and prerequisites for a player.
 *
 * OpenRA 对照: TechTree
 *
 * Watches actor additions/removals in the world and updates prerequisite
 * state for registered ITechTreeElement listeners.
 *
 * @todo Full implementation deferred. Current stub supports prerequisite
 *   checking and watcher management. Actor change events (ActorAdded/
 *   ActorRemoved) will be wired when World event system is complete.
 */
export class TechTree {
  /** The player that owns this tech tree. */
  readonly owner: PlayerStub

  /** Registered watchers keyed by their prerequisite key. */
  private readonly _watchers: Watcher[] = []

  /** Cached owned prerequisites from last update. */
  private _ownedPrerequisites: Map<string, number> = new Map()

  constructor(owner: PlayerStub) {
    this.owner = owner
  }

  /** Register a watcher for prerequisite state changes.
   *
   * OpenRA 对照: TechTree.Add(string, ImmutableArray<string>, int, ITechTreeElement)
   *
   * @param key — the actor type or alternate name key being watched
   * @param prerequisites — prerequisite strings (may include ! and ~ prefixes)
   * @param limit — build limit (0 = unlimited)
   * @param element — the callback recipient for state changes
   */
  add(key: string, prerequisites: readonly string[], limit: number, element: ITechTreeElement): void {
    this._watchers.push(new Watcher(key, prerequisites, limit, element))
  }

  /** Remove all watchers for a given key.
   *
   * OpenRA 对照: TechTree.Remove(string)
   *
   * @param key — the key to remove watchers for
   */
  remove(key: string): void {
    for (let i = this._watchers.length - 1; i >= 0; i--) {
      if (this._watchers[i].key === key) {
        this._watchers.splice(i, 1)
      }
    }
  }

  /** Remove all watchers registered by a specific element.
   *
   * OpenRA 对照: TechTree.Remove(ITechTreeElement)
   *
   * @param element — the element whose watchers should be removed
   */
  removeByElement(element: ITechTreeElement): void {
    for (let i = this._watchers.length - 1; i >= 0; i--) {
      if (this._watchers[i].registeredBy === element) {
        this._watchers.splice(i, 1)
      }
    }
  }

  /** Update all watchers with the current prerequisite state.
   *
   * OpenRA 对照: TechTree.Update()
   *
   * Gathers owned prerequisites and notifies all registered watchers.
   */
  update(): void {
    this._ownedPrerequisites = this.gatherOwnedPrerequisites()
    for (const watcher of this._watchers) {
      watcher.update(this._ownedPrerequisites)
    }
  }

  /** Check if all given prerequisites are satisfied.
   *
   * OpenRA 对照: TechTree.HasPrerequisites(IEnumerable<string>)
   *
   * The XOR logic: `prereq.startsWith('!') ^ !ownedPrerequisites.has(key)`
   * In boolean terms: prerequisite is satisfied when `startsWith('!') !== !hasKey`.
   * Equivalently: prerequisite is NOT satisfied when `startsWith('!') === !hasKey`.
   *
   * @param prerequisites — prerequisite strings to check
   * @returns true if all prerequisites are satisfied
   */
  hasPrerequisites(prerequisites: readonly string[]): boolean {
    const ownedPrereqs = this.gatherOwnedPrerequisites()
    for (const prereq of prerequisites) {
      const key = prereq.replace(/~/g, '').replace(/!/g, '')
      const hasKey = ownedPrereqs.has(key)
      const isInverted = prereq.replace(/~/g, '').startsWith('!')
      // XOR: if inverted === hasKey, prerequisite is NOT satisfied
      if (isInverted === hasKey) {
        return false
      }
    }
    return true
  }

  /** Gather all currently owned prerequisites from the player's world.
   *
   * OpenRA 对照: TechTree.GatherOwnedPrerequisites(Player) (static)
   *
   * In the full implementation, this scans:
   * 1. All player-owned actors with ITechTreePrerequisite trait
   * 2. All player-owned actors with Buildable where BuildLimit > 0
   *
   * @todo Full implementation deferred. Currently returns empty Map.
   *   Will be completed when ITechTreePrerequisite and ActorMap are migrated.
   *
   * @returns Map of prerequisite name -> count
   */
  gatherOwnedPrerequisites(): Map<string, number> {
    // Full implementation when ITechTreePrerequisite is migrated.
    // For now, return empty map — stubs that need prerequisites will
    // use allTech cheat mode or explicit test setup.
    return new Map()
  }

  /** Called when an actor is added or removed from the world.
   *
   * OpenRA 对照: TechTree.ActorChanged(Actor)
   *
   * If the actor is owned by this tech tree's player and has relevant
   * traits (ITechTreePrerequisite or Buildable with BuildLimit > 0),
   * triggers an update of all watchers.
   *
   * @param actor — the actor that changed
   */
  actorChanged(actor: IGameActor): void {
    // Full implementation when ITechTreePrerequisite is migrated.
    // For now, always trigger update to keep watchers in sync.
    if (actor.owner === this.owner) {
      this.update()
    }
  }
}

// ---------------------------------------------------------------------------
// Watcher — inner class tracking prerequisite state for a single item
// OpenRA 对照: TechTree.Watcher (sealed inner class)
// ---------------------------------------------------------------------------

/** Tracks prerequisite and build limit state for a single tech tree item.
 *
 * OpenRA 对照: TechTree.Watcher
 *
 * Each watcher monitors one key (actor type) and notifies its registered
 * ITechTreeElement when state changes.
 */
class Watcher {
  /** The key (actor type or alternate name) being watched. */
  readonly key: string

  /** The element that registered this watcher. */
  readonly registeredBy: ITechTreeElement

  /** Prerequisite strings (may include ! and ~ prefixes). */
  private readonly _prerequisites: readonly string[]

  /** Build limit (0 = unlimited). */
  private readonly _limit: number

  /** Current prerequisite satisfaction state. */
  private _hasPrerequisites: boolean = false

  /** Current hidden state (from ~ prefix). */
  private _hidden: boolean = false

  /** Whether this watcher has been initialized (first update done). */
  private _initialized: boolean = false

  constructor(key: string, prerequisites: readonly string[], limit: number, watcher: ITechTreeElement) {
    this.key = key
    this._prerequisites = prerequisites
    this.registeredBy = watcher
    this._limit = limit
  }

  /** Check if all prerequisites are satisfied.
   *
   * OpenRA 对照: Watcher.HasPrerequisites(Dictionary<string, int>)
   *
   * PERF: Avoid LINQ — explicit loop.
   */
  private _hasPrerequisitesMet(ownedPrerequisites: Map<string, number>): boolean {
    for (const prereq of this._prerequisites) {
      const withoutTilde = prereq.replace(/~/g, '')
      const key = withoutTilde.replace(/!/g, '')
      const isInverted = withoutTilde.startsWith('!')
      const hasKey = ownedPrerequisites.has(key)
      // XOR: if inverted === hasKey, prerequisite is NOT satisfied
      if (isInverted === hasKey) {
        return false
      }
    }
    return true
  }

  /** Check if the item should be hidden (any ~-prefixed prereq not met).
   *
   * OpenRA 对照: Watcher.IsHidden(Dictionary<string, int>)
   *
   * PERF: Avoid LINQ — explicit loop. Only checks prerequisites with ~ prefix.
   */
  private _isHidden(ownedPrerequisites: Map<string, number>): boolean {
    for (const prereq of this._prerequisites) {
      if (!prereq.startsWith('~')) {
        continue
      }
      const withoutTilde = prereq.replace(/~/g, '')
      const key = withoutTilde.replace(/!/g, '')
      const isInverted = withoutTilde.startsWith('!')
      const hasKey = ownedPrerequisites.has(key)
      // XOR: if inverted === hasKey, prerequisite is NOT satisfied → hidden
      if (isInverted === hasKey) {
        return true
      }
    }
    return false
  }

  /** Update this watcher's state and notify callbacks.
   *
   * OpenRA 对照: Watcher.Update(Dictionary<string, int>)
   *
   * @param ownedPrerequisites — current owned prerequisite map
   */
  update(ownedPrerequisites: Map<string, number>): void {
    const hasReachedLimit = this._limit > 0 && ownedPrerequisites.has(this.key) && (ownedPrerequisites.get(this.key) ?? 0) >= this._limit

    const nowHasPrerequisites = !hasReachedLimit && this._hasPrerequisitesMet(ownedPrerequisites)
    const nowHidden = this._isHidden(ownedPrerequisites)

    if (!this._initialized) {
      this._initialized = true
      this._hasPrerequisites = !nowHasPrerequisites
      this._hidden = !nowHidden
    }

    // Hide/show transitions
    if (nowHidden && !this._hidden) {
      this.registeredBy.prerequisitesItemHidden(this.key)
    }
    if (!nowHidden && this._hidden) {
      this.registeredBy.prerequisitesItemVisible(this.key)
    }

    // Available/unavailable transitions
    if (nowHasPrerequisites && !this._hasPrerequisites) {
      this.registeredBy.prerequisitesAvailable(this.key)
    }
    if (!nowHasPrerequisites && this._hasPrerequisites) {
      this.registeredBy.prerequisitesUnavailable(this.key)
    }

    this._hidden = nowHidden
    this._hasPrerequisites = nowHasPrerequisites
  }
}
