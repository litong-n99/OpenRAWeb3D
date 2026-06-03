/**
 * TraitDictionary.ts — Centralized trait storage and query system
 * OpenRA 对照: OpenRA.Game/TraitDictionary.cs
 *
 * 核心范式转换:
 * - C# Dictionary<Type, ITraitContainer> + binary search on sorted arrays
 *   → Map<string, Component[]> + linear scan
 * - C# reflection (GetInterfaces + BaseTypes) for trait registration
 *   → static readonly interfaces: string[] declared on each Component subclass
 * - C# O(log n) binary search per actor
 *   → O(n) linear scan (n = 10-30 traits per actor, performance is acceptable)
 * - C# ApplyToActorsWithTraitTimed with PerfTickLogger
 *   → console.time/timeEnd or optional perf callback
 *
 * TraitDictionary is a GLOBAL, centralized registry — NOT per-actor.
 * It indexes all traits by interface name across all actors, enabling:
 * - Per-actor queries: "give me all ITick traits on actor #42"
 * - Global queries: "give me all actors that have IResolveOrder"
 * - Bulk operations: "call tick() on every ITick in the world"
 *
 * Key design tradeoff (documented):
 * OpenRA uses generic type-keyed binary search on sorted arrays (O(log n)).
 * TypeScript degrades to linear scan with type guard functions (O(n)).
 * Acceptable because a single Actor typically has only 10-30 components.
 */

import type { IGameActor } from './Traits/TraitsInterfaces.js'
import { Component } from './Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// TraitPair — typed pair of (actor, trait) used by iteration APIs
// ---------------------------------------------------------------------------

/**
 * A typed pair of an actor and one of its traits.
 *
 * OpenRA 对照: TraitPair<T> struct
 */
export interface TraitPair<T> {
  readonly actor: IGameActor
  readonly trait: T
}

// ---------------------------------------------------------------------------
// Perf callback type
// ---------------------------------------------------------------------------

/**
 * Performance timing callback, called after each trait invocation in
 * applyToActorsWithTraitTimed.
 *
 * OpenRA 对照: PerfTickLogger.LogLongTick
 *
 * @param trait — the trait that was just invoked
 * @param elapsedMs — elapsed time for this trait's invocation
 */
export type TraitPerfCallback = (trait: Component, elapsedMs: number) => void

// ---------------------------------------------------------------------------
// TraitDictionary
// ---------------------------------------------------------------------------

/**
 * Centralized storage and query system for all traits across all actors.
 *
 * OpenRA 对照: TraitDictionary class
 *
 * Traits are indexed by interface name. Each trait Component can be
 * registered under multiple interface names — just as a C# class can
 * implement multiple interfaces.
 *
 * Usage:
 *   const dict = new TraitDictionary()
 *   dict.addTrait(actor, trait)  // trait must have static interfaces
 *   dict.traitsImplementing<ITick>(actor, 'ITick')
 *   dict.actorsWithTrait<IResolveOrder>('IResolveOrder')
 *   dict.applyToActorsWithTraitTimed<ITick>('ITick', (a, t) => t.tick(a), 'Tick')
 */
export class TraitDictionary {
  /**
   * Internal storage: interface name → array of all components implementing
   * that interface across all actors.
   *
   * OpenRA 对照: Dictionary<Type, ITraitContainer>
   *
   * Each Component array stores components from all actors. Per-actor
   * queries filter this array by the component's actor property.
   */
  private readonly traits = new Map<string, Component[]>()

  /**
   * Counter for performance reporting via printReport().
   * Incremented on each query operation.
   */
  private queryCount = 0
  private queryCounts = new Map<string, number>()

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a trait component, indexing it under all its declared interfaces.
   *
   * OpenRA 对照: TraitDictionary.AddTrait(Actor, object)
   *
   * The trait's class MUST declare `static readonly interfaces: string[]`
   * listing all interface names this component implements. The component
   * is added to the storage under each declared interface name.
   *
   * @param actor — the actor this trait belongs to
   * @param trait — the trait component to register
   * @throws if trait.constructor has no `interfaces` static field
   */
  addTrait(actor: IGameActor, trait: Component): void {
    void actor // intentionally unused — Component already tracks its actor via attach()
    const ifaces = this.getInterfaces(trait)
    for (const iface of ifaces) {
      let list = this.traits.get(iface)
      if (!list) {
        list = []
        this.traits.set(iface, list)
      }
      list.push(trait)
    }
  }

  /**
   * Unregister a trait component from all its declared interfaces.
   *
   * OpenRA 对照: TraitDictionary.RemoveTrait → (no direct C# equivalent;
   *   OpenRA removes by actor via RemoveActor)
   *
   * @param actor — the actor this trait belongs to
   * @param trait — the trait component to unregister
   */
  removeTrait(actor: IGameActor, trait: Component): void {
    void actor // intentionally unused — Component already tracks its actor via attach()
    const ifaces = this.getInterfaces(trait)
    for (const iface of ifaces) {
      const list = this.traits.get(iface)
      if (!list) continue

      const idx = list.indexOf(trait)
      if (idx !== -1) {
        list.splice(idx, 1)
        if (list.length === 0) {
          this.traits.delete(iface)
        }
      }
    }
  }

  /**
   * Remove all traits belonging to an actor.
   *
   * OpenRA 对照: TraitDictionary.RemoveActor(Actor)
   *
   * Iterates all interface buckets and removes any component whose
   * actor reference matches the given actor.
   *
   * @param actor — the actor whose traits should be removed
   */
  removeActor(actor: IGameActor): void {
    for (const [iface, list] of this.traits) {
      // Iterate backwards to safely remove while iterating
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].actor?.actorId === actor.actorId) {
          list.splice(i, 1)
        }
      }
      if (list.length === 0) {
        this.traits.delete(iface)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Per-actor queries
  // -----------------------------------------------------------------------

  /**
   * Get all traits implementing a given interface for a specific actor.
   *
   * OpenRA 对照: TraitDictionary.WithInterface<T>(Actor)
   *
   * Uses O(n) linear scan filtered by actor reference.
   *
   * @param actor — the actor to query traits for
   * @param interfaceName — the interface name to query
   * @returns array of traits (may be empty)
   */
  traitsImplementing<T extends Component>(
    actor: IGameActor,
    interfaceName: string,
  ): T[] {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return []

    const result: T[] = []
    for (const c of list) {
      if (c.actor?.actorId === actor.actorId) {
        result.push(c as unknown as T)
      }
    }
    return result
  }

  /**
   * Get the first trait implementing a given interface for a specific actor,
   * or undefined if not found.
   *
   * OpenRA 对照: TraitDictionary.GetOrDefault<T>(Actor)
   *
   * @param actor — the actor to query
   * @param interfaceName — the interface name to query
   * @returns the first matching trait, or undefined
   */
  traitOrDefault<T extends Component>(
    actor: IGameActor,
    interfaceName: string,
  ): T | undefined {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return undefined

    for (const c of list) {
      if (c.actor?.actorId === actor.actorId) {
        return c as unknown as T
      }
    }
    return undefined
  }

  /**
   * Check whether an actor has at least one trait implementing the given
   * interface.
   *
   * OpenRA 对照: (no direct equivalent; common usage pattern)
   *
   * @param actor — the actor to check
   * @param interfaceName — the interface name to check
   */
  hasTrait(actor: IGameActor, interfaceName: string): boolean {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return false

    for (const c of list) {
      if (c.actor?.actorId === actor.actorId) return true
    }
    return false
  }

  // -----------------------------------------------------------------------
  // Global queries
  // -----------------------------------------------------------------------

  /**
   * Get all (actor, trait) pairs for traits implementing a given interface
   * across ALL actors.
   *
   * OpenRA 对照: TraitDictionary.ActorsWithTrait<T>()
   *
   * @param interfaceName — the interface name to query
   * @returns array of TraitPair objects
   */
  actorsWithTrait<T extends Component>(
    interfaceName: string,
  ): readonly TraitPair<T>[] {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return []

    const result: TraitPair<T>[] = []
    for (const c of list) {
      const actor = c.actor
      if (actor) {
        result.push({ actor, trait: c as unknown as T })
      }
    }
    return result
  }

  /**
   * Get all (actor, trait) pairs matching a predicate.
   *
   * OpenRA 对照: TraitDictionary.ActorsWithTrait<T>(Func<T, bool>)
   *
   * @param interfaceName — the interface name to query
   * @param predicate — filter function applied to each trait
   * @returns array of TraitPair objects matching the predicate
   */
  actorsWithTraitFiltered<T extends Component>(
    interfaceName: string,
    predicate: (trait: T) => boolean,
  ): readonly TraitPair<T>[] {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return []

    const result: TraitPair<T>[] = []
    for (const c of list) {
      const actor = c.actor
      if (actor && predicate(c as unknown as T)) {
        result.push({ actor, trait: c as unknown as T })
      }
    }
    return result
  }

  /**
   * Get all unique actors that have at least one trait implementing the
   * given interface.
   *
   * OpenRA 对照: TraitDictionary.ActorsHavingTrait<T>()
   *
   * @param interfaceName — the interface name to query
   * @returns deduplicated array of actor references
   */
  actorsHavingTrait(
    interfaceName: string,
  ): readonly IGameActor[] {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return []

    const seen = new Set<number>()
    const result: IGameActor[] = []
    for (const c of list) {
      const actor = c.actor
      if (actor && !seen.has(actor.actorId)) {
        seen.add(actor.actorId)
        result.push(actor)
      }
    }
    return result
  }

  /**
   * Get all unique actors having a trait matching a predicate.
   *
   * OpenRA 对照: TraitDictionary.ActorsHavingTrait<T>(Func<T, bool>)
   *
   * @param interfaceName — the interface name to query
   * @param predicate — filter function applied to each trait
   */
  actorsHavingTraitFiltered<T extends Component>(
    interfaceName: string,
    predicate: (trait: T) => boolean,
  ): readonly IGameActor[] {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return []

    const seen = new Set<number>()
    const result: IGameActor[] = []
    for (const c of list) {
      if (predicate(c as unknown as T)) {
        const actor = c.actor
        if (actor && !seen.has(actor.actorId)) {
          seen.add(actor.actorId)
          result.push(actor)
        }
      }
    }
    return result
  }

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  /**
   * Apply a function to all (actor, trait) pairs implementing the given
   * interface.
   *
   * OpenRA 对照: TraitDictionary.ApplyToActorsWithTrait<T>(Action<Actor, T>)
   *
   * @param interfaceName — the interface name to iterate over
   * @param action — function to call for each (actor, trait) pair
   */
  applyToActorsWithTrait<T extends Component>(
    interfaceName: string,
    action: (actor: IGameActor, trait: T) => void,
  ): void {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return

    for (const c of list) {
      const actor = c.actor
      if (actor) {
        action(actor, c as unknown as T)
      }
    }
  }

  /**
   * Apply a function to all (actor, trait) pairs with performance timing.
   *
   * OpenRA 对照: TraitDictionary.ApplyToActorsWithTraitTimed<T>(Action<Actor, T>, string)
   *
   * After each trait invocation, the perf callback is called with the trait
   * and the elapsed time for that invocation.
   *
   * @param interfaceName — the interface name to iterate over
   * @param action — function to call for each (actor, trait) pair
   * @param text — label for the timed operation (used in perf callback)
   * @param perfCallback — optional callback receiving (trait, elapsedMs)
   */
  applyToActorsWithTraitTimed<T extends Component>(
    interfaceName: string,
    action: (actor: IGameActor, trait: T) => void,
    _text: string,
    perfCallback?: TraitPerfCallback,
  ): void {
    this.recordQuery(interfaceName)
    const list = this.traits.get(interfaceName)
    if (!list) return

    for (const c of list) {
      const actor = c.actor
      if (!actor) continue

      const start = performance.now()
      action(actor, c as unknown as T)
      const elapsed = performance.now() - start

      if (perfCallback) {
        perfCallback(c, elapsed)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Performance report
  // -----------------------------------------------------------------------

  /**
   * Print a performance report: interface name → query count.
   * Sorted by query count descending.
   *
   * OpenRA 对照: TraitDictionary.PrintReport()
   *
   * @returns a formatted string with query statistics
   */
  printReport(): string {
    const entries = Array.from(this.queryCounts.entries())
    entries.sort((a, b) => b[1] - a[1])

    const lines: string[] = ['TraitDictionary Query Report:']
    for (const [name, count] of entries) {
      if (count > 0) {
        lines.push(`  ${name}: ${count} queries`)
      }
    }
    if (lines.length === 1) {
      lines.push('  (no queries recorded)')
    }
    return lines.join('\n')
  }

  /**
   * Get the total number of distinct interface buckets.
   */
  get interfaceCount(): number {
    return this.traits.size
  }

  /**
   * Get the total number of trait registrations (sum across all buckets).
   */
  get totalTraits(): number {
    let count = 0
    for (const list of this.traits.values()) {
      count += list.length
    }
    return count
  }

  /**
   * Clear all trait registrations.
   *
   * OpenRA 对照: (no direct equivalent; useful for testing teardown)
   */
  clear(): void {
    this.traits.clear()
    this.queryCount = 0
    this.queryCounts.clear()
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Extract interface names from a component's static declaration.
   *
   * OpenRA 对照: t.GetInterfaces() + t.BaseTypes() via reflection
   */
  private getInterfaces(trait: Component): readonly string[] {
    const ctor = trait.constructor as
      | { interfaces?: readonly string[] }
      | undefined
    const ifaces = ctor?.interfaces
    if (!ifaces) {
      const ctorName =
        typeof ctor === 'function' && 'name' in ctor
          ? (ctor as { name: string }).name
          : 'unknown'
      throw new Error(
        `TraitDictionary: component class "${ctorName}" does not declare static interfaces. ` +
        'Add `static readonly interfaces: string[] = [...]` to the class.',
      )
    }
    // Empty interfaces array is allowed — results in a no-op registration
    return ifaces
  }

  private recordQuery(interfaceName: string): void {
    this.queryCount++
    const current = this.queryCounts.get(interfaceName) ?? 0
    this.queryCounts.set(interfaceName, current + 1)
  }
}
