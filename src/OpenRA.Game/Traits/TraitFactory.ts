/**
 * TraitFactory.ts — Trait constructor registry for actor creation
 * OpenRA 对照: OpenRA.Game/Actor.cs (Actor constructor loop: traitInfo.Create(init))
 *
 * 核心范式转换:
 * - C# reflection-based ObjectCreator.CreateObject<T>(TraitInfo) → TypeScript
 *   explicit registry Map<string, TraitConstructor>
 * - C# TraitInfo.Create(ActorInitializer) factory method → TypeScript TraitFactory
 *   with register/create pattern (similar to WarheadRegistry in Ch8)
 * - C# implicit trait construction order from ActorInfo.TraitsInConstructOrder()
 *   → TypeScript iterate ActorConfig.traitConfigs (already topo-sorted)
 *
 * The TraitFactory is a central registry mapping trait names to their
 * TypeScript constructors. It decouples actor creation from trait module
 * imports, allowing the World.createActor() pipeline to create any trait
 * without knowing its concrete type.
 *
 * Usage:
 *   const factory = new TraitFactory()
 *   factory.register('Health', (actor, config) => new Health(actor, config))
 *   const trait = factory.create(actor, 'Health', config)
 */

import type { IGameActor } from './TraitsInterfaces.js'
import { Component } from './TraitsInterfaces.js'
import type { TraitConfig } from '../GameRules/ActorInfo.js'
import type { ActorInitializer } from './ActorInitializer.js'

// ---------------------------------------------------------------------------
// TraitConstructor — signature for trait factory functions
// ---------------------------------------------------------------------------

/**
 * Factory function that creates a trait Component for a given actor.
 *
 * OpenRA 对照: TraitInfo.Create(ActorInitializer) → object
 *
 * @param actor — the actor receiving this trait
 * @param config — the TraitConfig with raw properties (from JSON/YAML)
 * @param initializer — optional ActorInitializer with spawn-time overrides
 * @returns the constructed Component instance
 */
export type TraitConstructor = (
  actor: IGameActor,
  config: TraitConfig,
  initializer?: ActorInitializer,
) => Component

// ---------------------------------------------------------------------------
// TraitFactory — central trait constructor registry
// ---------------------------------------------------------------------------

/**
 * Central registry for trait constructors, enabling actor creation from
 * ruleset configuration without per-trait import dependencies.
 *
 * OpenRA 对照: N/A (C# uses reflection to find and invoke TraitInfo.Create())
 *
 * The registry is populated during mod loading (ModData construction)
 * and consulted during World.createActor() for each trait in the actor's
 * ActorConfig.traitConfigs list.
 *
 * ## Design
 *
 * - O(1) lookup: Map<string, TraitConstructor>
 * - Missing trait: returns null + console.warn (does not throw, matching OpenRA's
 *   behavior for unknown trait types)
 * - Instance-name disambiguation: the config's `instanceName` distinguishes
 *   multiple traits of the same base type (e.g., "Turreted@primary" vs "Turreted@secondary")
 *
 * ## Per ADR-26.1
 *
 * Each trait module registers its constructor in the factory during mod loading:
 *   factory.register('Mobile', (a, c) => new Mobile(a, c))
 * Missing registrations are caught at actor creation time with a clear warning.
 */
export class TraitFactory {
  /** Internal registry: trait name → constructor function. */
  private readonly _registry = new Map<string, TraitConstructor>()

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a trait constructor.
   *
   * OpenRA 对照: (implicit via ObjectCreator.FindType + Activator.CreateInstance)
   *
   * If a constructor is already registered for the given name, the new one
   * replaces it with a console.warn (consistent with Ruleset merge semantics).
   *
   * @param traitName — the trait class name (e.g., "Health", "Mobile")
   * @param ctor — the factory function creating the trait Component
   */
  register(traitName: string, ctor: TraitConstructor): void {
    if (this._registry.has(traitName)) {
      console.warn(
        `[TraitFactory] trait '${traitName}' is already registered — replacing.`,
      )
    }
    this._registry.set(traitName, ctor)
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Check if a trait constructor is registered.
   *
   * @param traitName — the trait class name
   * @returns true if a constructor is registered
   */
  has(traitName: string): boolean {
    return this._registry.has(traitName)
  }

  /**
   * Get the registered constructor for a trait, or undefined.
   *
   * @param traitName — the trait class name
   * @returns the constructor, or undefined if not registered
   */
  getConstructor(traitName: string): TraitConstructor | undefined {
    return this._registry.get(traitName)
  }

  /**
   * Get all registered trait names.
   *
   * @returns array of registered trait names
   */
  registeredTraitNames(): readonly string[] {
    return Array.from(this._registry.keys())
  }

  /**
   * Number of registered traits.
   */
  get count(): number {
    return this._registry.size
  }

  // -----------------------------------------------------------------------
  // Trait creation
  // -----------------------------------------------------------------------

  /**
   * Create a single trait for an actor.
   *
   * OpenRA 对照: traitInfo.Create(init) called within Actor constructor
   *
   * Looks up the constructor by trait name. If not found, logs a warning
   * and returns null (matching OpenRA's graceful handling of unknown traits).
   *
   * @param actor — the actor receiving this trait
   * @param config — the TraitConfig from ActorConfig
   * @param initializer — optional ActorInitializer with spawn-time overrides
   * @returns the constructed Component, or null if trait is unknown
   */
  create(
    actor: IGameActor,
    config: TraitConfig,
    initializer?: ActorInitializer,
  ): Component | null {
    const name = config.name
    const ctor = this._registry.get(name)

    if (!ctor) {
      console.warn(
        `[TraitFactory] Unknown trait '${name}' — not registered. ` +
        `Did you forget to call register()?`,
      )
      return null
    }

    try {
      const component = ctor(actor, config, initializer)
      return component
    } catch (e) {
      console.error(
        `[TraitFactory] Failed to create trait '${name}' for actor ` +
        `${actor.actorId}: ${e instanceof Error ? e.message : String(e)}`,
      )
      return null
    }
  }

  /**
   * Create all traits for an actor from its ActorConfig.
   *
   * OpenRA 对照: Actor constructor loop over Info.TraitsInConstructOrder():
   *   var trait = traitInfo.Create(init); AddTrait(trait);
   *
   * Iterates the ActorConfig's topo-sorted traitConfigs, calls create()
   * for each, and returns an array of successfully created Components.
   * Unknown traits are silently skipped (console.warn in create()).
   *
   * @param actor — the actor receiving these traits
   * @param configs — trait configs from ActorConfig (already topo-sorted)
   * @param initializer — optional ActorInitializer with spawn-time overrides
   * @returns array of successfully created Component instances
   */
  createAllTraits(
    actor: IGameActor,
    configs: readonly TraitConfig[],
    initializer?: ActorInitializer,
  ): Component[] {
    const components: Component[] = []

    for (const config of configs) {
      const component = this.create(actor, config, initializer)
      if (component) {
        components.push(component)
      }
    }

    return components
  }

  // -----------------------------------------------------------------------
  // Bulk registration helper
  // -----------------------------------------------------------------------

  /**
   * Register multiple trait constructors at once.
   *
   * Convenience method for registering all available traits during mod loading.
   *
   * @param entries — array of [traitName, constructor] tuples
   */
  registerAll(entries: readonly (readonly [string, TraitConstructor])[]): void {
    for (const [name, ctor] of entries) {
      this.register(name, ctor)
    }
  }

  // -----------------------------------------------------------------------
  // Dispose / cleanup
  // -----------------------------------------------------------------------

  /**
   * Clear the registry (for testing or mod reload).
   *
   * NOTE: Non-OpenRA — added for testability. OpenRA's ObjectCreator is
   * re-created per ModData load, which has the same effect.
   */
  clear(): void {
    this._registry.clear()
  }
}
