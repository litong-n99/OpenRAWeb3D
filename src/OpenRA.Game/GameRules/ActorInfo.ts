/**
 * ActorInfo.ts — ActorConfig: static actor type metadata loaded from JSON
 * OpenRA 对照: OpenRA.Game/GameRules/ActorInfo.cs
 *
 * 核心范式转换:
 * - C# reflection-based trait loading from MiniYaml
 *   → TypeScript JSON parsing with explicit dependsOn/notBefore arrays
 * - C# Requires<T>/NotBefore<T> generic interface constraints
 *   → Explicit `dependsOn: string[]` + `notBefore: string[]` on TraitConfig
 * - C# iterative dependency resolution (Type.AssignableFrom checks)
 *   → Kahn's algorithm with transitive interface matching
 * - C# TypeDictionary for trait storage
 *   → Indexed Maps for O(1) trait lookup by name/interface
 * - C# ActorInfo immutability (implicit, frozen after YAML load)
 *   → TypeScript Object.freeze() deep-recursive immutability
 * - C# TraitInfo reflection factory (ObjectCreator.CreateObject<T>)
 *   → TraitConfig stores raw properties for deferred Component construction
 */

// ---------------------------------------------------------------------------
// Constants (对应 OpenRA ActorInfo constants)
// ---------------------------------------------------------------------------

/**
 * Prefix for abstract actor types (template-only, not spawnable).
 *
 * OpenRA 对照: ActorInfo.AbstractActorPrefix = '^'
 */
export const ABSTRACT_ACTOR_PREFIX = '^'

/**
 * Separator between trait name and instance name for disambiguation.
 * Example: "Turreted@primary" → trait "Turreted", instance "primary"
 *
 * OpenRA 对照: ActorInfo.TraitInstanceSeparator = '@'
 */
export const TRAIT_INSTANCE_SEPARATOR = '@'

/**
 * Prefix for removing inherited traits.
 * Example: "-Mobile" means "remove the Mobile trait inherited from parent"
 *
 * OpenRA 对照: (implicit in YAML node parsing — key starting with '-')
 */
export const REMOVE_TRAIT_PREFIX = '-'

// ---------------------------------------------------------------------------
// TraitConfig — configuration for a single trait (对应 OpenRA TraitInfo + YAML node)
// ---------------------------------------------------------------------------

/**
 * Configuration data for one trait on an actor.
 *
 * OpenRA 对照: TraitInfo (abstract base) + its YAML node
 *
 * Each TraitConfig holds:
 * - The trait class name and optional instance name for disambiguation
 * - Raw property values for deferred Component construction
 * - Explicit dependency declarations (replacing C# generic interface reflection)
 * - Interface names this trait implements (for dependency resolution)
 */
export interface TraitConfig {
  /** Trait class name (e.g., "Health", "Mobile", "RenderSprites").
   *
   * OpenRA 对照: TraitInfo.GetType().Name
   */
  readonly name: string

  /** Optional instance name for disambiguation when multiple traits of
   * the same type are on one actor. Parsed from the @-separated suffix.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /** Raw configuration values — parsed from YAML/JSON for later
   * consumption by Component subclasses during construction.
   *
   * OpenRA 对照: TraitInfo fields populated by FieldLoader.Load()
   */
  readonly properties: Record<string, unknown>

  /** Interface names this trait IMPLEMENTS.
   * Used for dependency resolution: if trait B depends on "IMove",
   * and trait A's `implements` includes "IMove", then A satisfies
   * B's dependency.
   *
   * OpenRA 对照: GetType().GetInterfaces() — resolved via reflection
   */
  readonly implements: string[]

  /** Interface names this trait REQUIRES (hard dependency).
   * All traits implementing these interfaces must be present and
   * constructed before this trait.
   *
   * OpenRA 对照: Requires<T> — resolved via GetGenericArguments()
   */
  readonly dependsOn: string[]

  /** Interface names this trait should NOT come before (soft dependency).
   * If any trait implementing these interfaces is present, this trait
   * must be constructed AFTER them. But if none is present, it's fine.
   *
   * OpenRA 对照: NotBefore<T> — resolved via GetGenericArguments()
   */
  readonly notBefore: string[]

  /** Optional callback invoked when the ruleset is fully loaded.
   * Allows traits to resolve cross-references (e.g., looking up other
   * actor types, weapon definitions, or terrain info).
   *
   * OpenRA 对照: IRulesetLoaded.RulesetLoaded(Ruleset, ActorInfo)
   */
  readonly rulesetLoaded?: RulesetLoadedHandler

  /** Sync field metadata for @VerifySync-annotated trait fields.
   * Populated at build time by sync-hash-generator.ts.
   * Each entry describes a field whose value contributes to the
   * deterministic frame sync hash.
   *
   * OpenRA 对照: [VerifySync] attribute on TraitInfo fields
   */
  readonly syncFields?: readonly SyncFieldMeta[]
}

// ---------------------------------------------------------------------------
// SyncFieldMeta — metadata for a @VerifySync-annotated field
// OpenRA 对照: [VerifySync] attribute
// ---------------------------------------------------------------------------

/**
 * Metadata describing a field that participates in sync hash computation.
 *
 * OpenRA 对照: ISync interface + [VerifySync] attribute
 *
 * Populated at build time by the sync hash generator scanning
 * for /** @VerifySync *`/` JSDoc annotations on trait property declarations.
 */
export interface SyncFieldMeta {
  /** Field name as declared in the trait class. */
  readonly name: string

  /** Optional custom hash function name. If provided, the build-time
   * generator uses this named function instead of the default
   * type-based hash algorithm.
   *
   * OpenRA 对照: (no direct equivalent — C# uses type-specific IL)
   */
  readonly customHash?: string
}

// ---------------------------------------------------------------------------
// IRulesetRef — minimal ruleset reference for IRulesetLoaded handlers
// OpenRA 对照: (avoid circular dependency between ActorInfo.ts and Ruleset.ts)
// ---------------------------------------------------------------------------

/**
 * Minimal ruleset reference passed to IRulesetLoaded callbacks.
 *
 * Avoids circular dependency with Ruleset.ts. The full Ruleset class
 * structurally satisfies this interface.
 */
export interface IRulesetRef {
  readonly actors: ReadonlyMap<string, ActorConfig>
}

/**
 * Callback type for IRulesetLoaded trait handlers.
 *
 * OpenRA 对照: IRulesetLoaded.RulesetLoaded(Ruleset rules, TInfo info)
 *
 * @param ruleset — the fully populated ruleset (via IRulesetRef)
 * @param actorInfo — the ActorConfig this trait belongs to
 */
export type RulesetLoadedHandler = (
  ruleset: IRulesetRef,
  actorInfo: ActorConfig,
) => void

// ---------------------------------------------------------------------------
// ActorJSON — raw JSON shape for fromJSON input
// ---------------------------------------------------------------------------

/**
 * Raw JSON structure that fromJSON accepts.
 *
 * This is the runtime format produced by the build-time YAML→JSON compiler
 * (see rendering_migration_plan.md ).
 */
export interface ActorJSON {
  /** Actor type name (e.g., "E1", "^Infantry", "HARV").
   *
   * OpenRA 对照: first YAML key
   */
  name: string

  /** Parent actor types whose traits this actor inherits.
   * Empty array or absent for root types.
   *
   * OpenRA 对照: Inherits: node
   */
  inherits?: string[]

  /** Trait configurations for this actor.
   *
   * OpenRA 对照: MiniYaml nodes under the actor key
   */
  traits?: TraitJSON[]
}

/**
 * Raw JSON for a single trait within an actor config.
 */
export interface TraitJSON {
  /** Trait name with optional @instance suffix.
   * Example: "Health", "Turreted@primary", "-Mobile"
   *
   * OpenRA 对照: the key of each MiniYaml node under the actor
   */
  trait: string

  /** Interface names this trait implements.
   *
   * OpenRA 对照: resolved by build-time tool from TypeScript metadata
   */
  implements?: string[]

  /** Interface names this trait requires (hard deps).
   *
   * OpenRA 对照: Requires<T> resolved at build time
   */
  dependsOn?: string[]

  /** Interface names this trait should not come before (soft deps).
   *
   * OpenRA 对照: NotBefore<T> resolved at build time
   */
  notBefore?: string[]

  /** Raw configuration values for this trait.
   *
   * OpenRA 对照: MiniYaml node value (FieldLoader.Load)
   */
  properties?: Record<string, unknown>
}

// =========================================================================
// ActorConfig
// =========================================================================

/**
 * Static metadata describing one actor type.
 *
 * OpenRA 对照: ActorInfo class
 *
 * ActorConfig is the template/blueprint from which GameActor instances are
 * created. It holds the complete resolved trait configuration, in dependency
 * order, ready for trait construction.
 *
 * ## Immutability
 *
 * After construction (via `fromJSON()` or the programmatic constructor),
 * ActorConfig is deeply frozen with Object.freeze(). Attempting to mutate
 * it in strict mode will throw a TypeError.
 *
 * ## Lifecycle
 *
 * ```
 * YAML files  →  Build-time compiler  →  JSON  →  fromJSON()  →  ActorConfig (frozen)
 * ```
 *
 * ## Trait Construction Order
 *
 * Traits are topologically sorted by Kahn's algorithm. A trait's `dependsOn`
 * interfaces must all be satisfied by traits placed before it. `notBefore`
 * interfaces add ordering edges only when the target trait is present.
 *
 * ## Inheritance
 *
 * `fromJSON()` supports explicit inherits via the `inherits` field. When
 * provided, parent traits are merged first, then child traits override.
 * The `-TraitName` syntax removes inherited traits.
 */
export class ActorConfig {
  // -----------------------------------------------------------------------
  // Static constants (matching OpenRA)
  // -----------------------------------------------------------------------

  static readonly ABSTRACT_ACTOR_PREFIX = ABSTRACT_ACTOR_PREFIX
  static readonly TRAIT_INSTANCE_SEPARATOR = TRAIT_INSTANCE_SEPARATOR
  static readonly REMOVE_TRAIT_PREFIX = REMOVE_TRAIT_PREFIX

  // -----------------------------------------------------------------------
  // Properties (对应 OpenRA ActorInfo fields)
  // -----------------------------------------------------------------------

  /** Actor type name (e.g., "E1", "HARV", "^Infantry").
   *
   * OpenRA 对照: ActorInfo.Name
   */
  readonly name: string

  /** Whether this actor type is abstract (template-only, not spawnable).
   * Names prefixed with '^' are abstract.
   *
   * OpenRA 对照: name[0] == AbstractActorPrefix check (no direct field)
   */
  readonly isAbstract: boolean

  /** All trait configurations, in dependency-resolved construction order.
   *
   * OpenRA 对照: ActorInfo.TraitsInConstructOrder()
   */
  readonly traitConfigs: readonly TraitConfig[]

  /** Parent actor names this config inherited from.
   *
   * OpenRA 对照: Inherits: YAML node (tracked for debugging)
   */
  readonly inheritsFrom: readonly string[]

  // -----------------------------------------------------------------------
  // Private indices (for O(1) lookup, matching TypeDictionary performance)
  // -----------------------------------------------------------------------

  /** Trait name → TraitConfig. Only stores base name (without @instance).
   * For traits with instance names, the key is the base trait name.
   *
   * OpenRA 对照: traits TypeDictionary
   */
  private readonly _byName: ReadonlyMap<string, TraitConfig>

  /** Interface name → all TraitConfigs implementing that interface.
   *
   * OpenRA 对照: traits.WithInterface<T>()
   */
  private readonly _byInterface: ReadonlyMap<string, readonly TraitConfig[]>

  /** Registered IRulesetLoaded handlers collected from trait configs.
   *
   * OpenRA 对照: (traits implementing IRulesetLoaded, stored and invoked
   *   by Ruleset constructor)
   *
   * This array is deliberately non-enumerable so that deepFreeze() skips
   * it during the immutability step. The array remains mutable so that
   * onRulesetLoaded() can register additional handlers before the
   * Ruleset constructor invokes notifyRulesetLoaded().
   */
  // Assigned via Object.defineProperty in constructor (non-enumerable, to
  // prevent deepFreeze from freezing the mutable handler array).
  private readonly _rulesetLoadedHandlers!: RulesetLoadedHandler[]

  // -----------------------------------------------------------------------
  // Constructor (programmatic — matches OpenRA ActorInfo(string, TraitInfo[]))
  // -----------------------------------------------------------------------

  /**
   * Create an ActorConfig programmatically.
   *
   * OpenRA 对照: ActorInfo(string name, params TraitInfo[] traitInfos)
   *
   * The constructor performs topological sort on the provided traits.
   * For JSON-based creation, use `fromJSON()` instead.
   *
   * @param name — actor type name
   * @param traitConfigs — trait configurations (unsorted; will be topo-sorted)
   * @throws if circular dependencies are detected
   */
  constructor(
    name: string,
    traitConfigs: TraitConfig[],
    inheritsFrom: string[] = [],
  ) {
    // Validate trait names for duplicates
    const seen = new Set<string>()
    for (const t of traitConfigs) {
      if (seen.has(t.name)) {
        throw new Error(
          `ActorConfig "${name}": duplicate trait '${t.name}'`,
        )
      }
      seen.add(t.name)
    }

    this.name = name
    this.isAbstract = name.startsWith(ABSTRACT_ACTOR_PREFIX)
    this.inheritsFrom = Object.freeze([...inheritsFrom])

    // Sort traits topologically
    this.traitConfigs = topoSort(traitConfigs, name)

    // Build lookup indices
    const byName = new Map<string, TraitConfig>()
    const byInterface = new Map<string, TraitConfig[]>()
    for (const t of this.traitConfigs) {
      byName.set(t.name, t)
      for (const iface of t.implements) {
        let list = byInterface.get(iface)
        if (!list) {
          list = []
          byInterface.set(iface, list)
        }
        list.push(t)
      }
    }
    this._byName = byName
    this._byInterface = byInterface

    // Initialize _rulesetLoadedHandlers as a non-enumerable property so that
    // deepFreeze() skips it (it only recurses into enumerable properties via
    // Object.keys()). The array itself remains mutable for onRulesetLoaded().
    //
    // OpenRA 对照: (traits implementing IRulesetLoaded — these are identified
    //   at Ruleset construction time via TraitInfos<IRulesetLoaded>())
    const handlers: RulesetLoadedHandler[] = []
    for (const t of this.traitConfigs) {
      if (t.rulesetLoaded) {
        handlers.push(t.rulesetLoaded)
      }
    }
    Object.defineProperty(this, '_rulesetLoadedHandlers', {
      value: handlers,
      writable: false,
      enumerable: false,
      configurable: false,
    })

    // Deep freeze for immutability
    deepFreeze(this)
  }

  // -----------------------------------------------------------------------
  // fromJSON — factory method (对应 OpenRA ActorInfo(ObjectCreator, string, MiniYaml))
  // -----------------------------------------------------------------------

  /**
   * Create an ActorConfig from compiled JSON.
   *
   * OpenRA 对照: ActorInfo(ObjectCreator creator, string name, MiniYaml node)
   *
   * Parses the JSON representation of an actor's YAML config. Handles:
   * - Trait name parsing with @instance disambiguation
   * - `-TraitName` removal markers
   * - Trait property extraction
   * - Inheritance chain resolution (if `allConfigs` provided)
   *
   * @param json — raw JSON object conforming to ActorJSON shape
   * @param allConfigs — optional map of all actor JSONs for inheritance resolution
   * @param _ancestorPath — internal: current ancestor chain for cycle detection.
   *   An immutable array (not a shared Set) so diamond inheritance works correctly.
   * @returns a deeply-frozen ActorConfig
   * @throws if JSON is malformed or circular dependencies are detected
   */
  static fromJSON(
    json: unknown,
    allConfigs?: ReadonlyMap<string, ActorJSON>,
    _ancestorPath?: readonly string[],
  ): ActorConfig {
    const parsed = validateActorJSON(json)

    // Detect circular inheritance: if this actor already appears in MY own
    // ancestor chain, we have a true cycle.
    // Uses an immutable ancestor-path array (not a shared Set) so that
    // diamond inheritance (A inherits [B,C], both B and C inherit D) is
    // correctly allowed — D only appears in D's own ancestor checks,
    // not in sibling branches.
    if (_ancestorPath?.includes(parsed.name)) {
      const chain = [..._ancestorPath, parsed.name].join(' -> ')
      throw new Error(
        `ActorConfig.fromJSON "${parsed.name}": circular inheritance detected. ` +
        `Inheritance chain: ${chain}`,
      )
    }

    let traitConfigs = parseTraitConfigs(parsed.traits ?? [], parsed.name)

    // Resolve inheritance if specified
    if (parsed.inherits && parsed.inherits.length > 0) {
      if (!allConfigs) {
        throw new Error(
          `ActorConfig.fromJSON "${parsed.name}": inherits specified but no allConfigs provided for inheritance resolution.`,
        )
      }

      // Build my ancestor path for recursive calls. Each recursive call
      // receives a new array (immutable snapshot), so sibling branches
      // do not contaminate each other's ancestor checks.
      const myPath: readonly string[] = [...(_ancestorPath ?? []), parsed.name]

      const inheritsFrom: string[] = []
      for (const parentName of parsed.inherits) {
        const parentJSON = allConfigs.get(parentName)
        if (!parentJSON) {
          throw new Error(
            `ActorConfig.fromJSON "${parsed.name}": parent "${parentName}" not found in allConfigs.`,
          )
        }
        // Recursively resolve parent (may also have inheritance).
        // Pass ancestor path to detect true inheritance cycles.
        const parentConfig = ActorConfig.fromJSON(parentJSON, allConfigs, myPath)
        inheritsFrom.push(...parentConfig.inheritsFrom, parentName)

        // Merge parent traits with child. Parent traits come first;
        // child overrides parent of same name.
        traitConfigs = mergeTraits(
          parentConfig.traitConfigs as TraitConfig[],
          traitConfigs,
          parsed.name,
        )
      }

      return new ActorConfig(parsed.name, traitConfigs, inheritsFrom)
    }

    return new ActorConfig(parsed.name, traitConfigs)
  }

  // -----------------------------------------------------------------------
  // Trait query methods (对应 OpenRA ActorInfo trait query methods)
  // -----------------------------------------------------------------------

  /**
   * Check if this actor has a trait with the given name.
   *
   * OpenRA 对照: ActorInfo.HasTraitInfo<T>()
   *
   * @param traitName — the trait name (base name without @instance)
   * @returns true if the trait exists
   */
  hasTraitInfo(traitName: string): boolean {
    return this._byName.has(traitName)
  }

  /**
   * Get the trait config by name. Throws if not found.
   *
   * OpenRA 对照: ActorInfo.TraitInfo<T>()
   *
   * @param traitName — the trait name (base name without @instance)
   * @returns the TraitConfig
   * @throws if no trait with the given name exists
   */
  traitInfo(traitName: string): TraitConfig {
    const t = this._byName.get(traitName)
    if (!t) {
      throw new Error(
        `ActorConfig "${this.name}" does not have trait '${traitName}'.`,
      )
    }
    return t
  }

  /**
   * Get the trait config by name, or undefined if not found.
   *
   * OpenRA 对照: ActorInfo.TraitInfoOrDefault<T>()
   *
   * @param traitName — the trait name (base name without @instance)
   * @returns the TraitConfig, or undefined if not found
   */
  traitInfoOrDefault(traitName: string): TraitConfig | undefined {
    return this._byName.get(traitName)
  }

  /**
   * Get all trait configs implementing the given interface.
   *
   * OpenRA 对照: ActorInfo.TraitInfos<T>()
   *
   * @param interfaceName — the interface name to query (e.g., "ITargetableInfo")
   * @returns array of matching TraitConfigs (may be empty)
   */
  traitInfos(interfaceName: string): readonly TraitConfig[] {
    return this._byInterface.get(interfaceName) ?? []
  }

  /**
   * Get the union of all target types declared by ITargetableInfo traits.
   *
   * OpenRA 对照: ActorInfo.GetAllTargetTypes()
   *
   * In OpenRA, this returns a BitSet<TargetableType> union of all
   * ITargetableInfo.GetTargetTypes(). In TypeScript, this returns
   * a Set of target type strings (to be converted to BitSet by the
   * caller if needed).
   *
   * @returns set of all target type strings
   */
  getAllTargetTypes(): Set<string> {
    const targetTypes = new Set<string>()
    for (const t of this.traitInfos('ITargetableInfo')) {
      const tt = t.properties.targetTypes
      if (Array.isArray(tt)) {
        for (const typeStr of tt) {
          if (typeof typeStr === 'string') {
            targetTypes.add(typeStr)
          }
        }
      }
    }
    return targetTypes
  }

  /**
   * Get all traits in dependency-resolved construction order.
   *
   * OpenRA 对照: ActorInfo.TraitsInConstructOrder()
   *
   * @returns deeply frozen array of TraitConfig in construction order
   */
  traitsInConstructOrder(): readonly TraitConfig[] {
    return this.traitConfigs
  }

  // -----------------------------------------------------------------------
  // IRulesetLoaded support (对应 OpenRA IRulesetLoaded.RulesetLoaded())
  // -----------------------------------------------------------------------

  /**
   * Register a handler to be called when the ruleset is fully loaded.
   *
   * OpenRA 对照: (traits implementing IRulesetLoaded — they are
   *   automatically discovered and invoked)
   *
   * Trait-level rulesetLoaded callbacks are automatically collected
   * during construction. Use this method to register additional
   * handlers from external code before the Ruleset is created.
   *
   * NOTE: Due to deepFreeze, `_rulesetLoadedHandlers` is stored as a
   * non-enumerable property and remains mutable. This allows
   * registration even after the ActorConfig is frozen.
   *
   * @param handler — callback that receives the Ruleset ref and this ActorConfig
   */
  onRulesetLoaded(handler: RulesetLoadedHandler): void {
    this._rulesetLoadedHandlers.push(handler)
  }

  /**
   * Invoke all registered IRulesetLoaded handlers.
   *
   * Called by the Ruleset constructor after all dictionaries are populated.
   * Wraps each handler call with error context for diagnostics.
   *
   * OpenRA 对照: Ruleset constructor — foreach actor, foreach trait in
   *   TraitInfos<IRulesetLoaded>(), t.RulesetLoaded(this, a)
   *
   * @param ruleset — the fully constructed Ruleset (satisfies IRulesetRef)
   * @internal — called by Ruleset constructor only
   */
  notifyRulesetLoaded(ruleset: IRulesetRef): void {
    for (const handler of this._rulesetLoadedHandlers) {
      try {
        handler(ruleset, this)
      } catch (e) {
        throw new Error(
          `Actor type ${this.name}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
  }

  // -----------------------------------------------------------------------
  // ToString (debugging)
  // -----------------------------------------------------------------------

  /**
   * Human-readable string for debugging.
   *
   * OpenRA 对照: (implicit, no ToString override in C#)
   */
  toString(): string {
    const abstract = this.isAbstract ? '[abstract] ' : ''
    const traitNames = this.traitConfigs.map(t => t.name).join(', ')
    return `ActorConfig(${abstract}${this.name}: [${traitNames}])`
  }
}

// =========================================================================
// Internal helpers (not exported)
// =========================================================================

// ---------------------------------------------------------------------------
// JSON validation
// ---------------------------------------------------------------------------

/**
 * Validate that `json` conforms to ActorJSON shape.
 *
 * Throws descriptive errors for malformed input, matching OpenRA's
 * YamlException error quality.
 */
function validateActorJSON(json: unknown): ActorJSON {
  if (typeof json !== 'object' || json === null) {
    throw new Error(
      `ActorConfig.fromJSON: expected object, got ${typeof json}`,
    )
  }

  const obj = json as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new Error(
      `ActorConfig.fromJSON: required field 'name' is missing or empty. Got: ${JSON.stringify(obj.name)}`,
    )
  }

  if (obj.traits !== undefined && !Array.isArray(obj.traits)) {
    throw new Error(
      `ActorConfig.fromJSON "${obj.name}": 'traits' must be an array. Got: ${typeof obj.traits}`,
    )
  }

  if (obj.inherits !== undefined) {
    if (!Array.isArray(obj.inherits)) {
      throw new Error(
        `ActorConfig.fromJSON "${obj.name}": 'inherits' must be an array of strings. Got: ${typeof obj.inherits}`,
      )
    }
    for (const item of obj.inherits) {
      if (typeof item !== 'string') {
        throw new Error(
          `ActorConfig.fromJSON "${obj.name}": 'inherits' must contain only strings. Got: ${typeof item}`,
        )
      }
    }
  }

  return {
    name: obj.name as string,
    inherits: obj.inherits as string[] | undefined,
    traits: obj.traits as TraitJSON[] | undefined,
  }
}

// ---------------------------------------------------------------------------
// Trait config parsing
// ---------------------------------------------------------------------------

/**
 * Parse raw TraitJSON entries into TraitConfig structures.
 *
 * Handles:
 * - @instance suffix splitting (e.g., "Turreted@primary")
 * - -TraitName removal markers
 * - Default values for missing implements/dependsOn/notBefore
 */
function parseTraitConfigs(
  traitJSONs: TraitJSON[],
  actorName: string,
): TraitConfig[] {
  const configs: TraitConfig[] = []

  for (const raw of traitJSONs) {
    if (typeof raw.trait !== 'string' || raw.trait.length === 0) {
      throw new Error(
        `ActorConfig.fromJSON "${actorName}": each trait entry must have a non-empty 'trait' string. Got: ${JSON.stringify(raw.trait)}`,
      )
    }

    const fullName = raw.trait.trim()
    if (!fullName) continue

    // Handle removal markers
    if (fullName.startsWith(REMOVE_TRAIT_PREFIX)) {
      const nameToRemove = fullName.substring(1).trim()
      // Removal traits are not actual traits — they are processed during
      // mergeTraits(). We add them with a special marker.
      configs.push({
        name: nameToRemove,
        instanceName: undefined,
        properties: {},
        implements: [],
        dependsOn: [],
        notBefore: [],
        _remove: true,
      } as TraitConfig & { _remove?: boolean })
      continue
    }

    // Parse @instance separator
    let traitName = fullName
    let instanceName: string | undefined

    const atIdx = fullName.indexOf(TRAIT_INSTANCE_SEPARATOR)
    if (atIdx > 0) {
      traitName = fullName.substring(0, atIdx).trim()
      instanceName = fullName.substring(atIdx + 1).trim()
      if (instanceName.length === 0) {
        throw new Error(
          `ActorConfig.fromJSON "${actorName}": trait '${fullName}' has empty instance name after '@'.`,
        )
      }
    }

    // Validate trait name
    if (traitName.startsWith(REMOVE_TRAIT_PREFIX)) {
      throw new Error(
        `ActorConfig.fromJSON "${actorName}": trait name '${traitName}' starts with reserved prefix '${REMOVE_TRAIT_PREFIX}'. ` +
        `Use '${REMOVE_TRAIT_PREFIX}${traitName.substring(1)}' to remove an inherited trait.`,
      )
    }

    configs.push({
      name: traitName,
      instanceName,
      properties: { ...(raw.properties ?? {}) },
      implements: raw.implements ?? [],
      dependsOn: raw.dependsOn ?? [],
      notBefore: raw.notBefore ?? [],
    })
  }

  return configs
}

// ---------------------------------------------------------------------------
// Trait merging (inheritance)
// ---------------------------------------------------------------------------

/**
 * Merge parent traits with child traits.
 *
 * Algorithm:
 * 1. Start with all parent traits
 * 2. Process child traits in order:
 *    a. If child trait is a removal marker (-TraitName): remove the named
 *       parent trait from the merged list.
 *    b. If child trait has the same name as an existing parent trait:
 *       override with child's properties (but keep parent's position).
 *    c. Otherwise: append child trait to the end.
 *
 * OpenRA 对照: YAML inheritance resolution (Inherits: + override semantics)
 */
function mergeTraits(
  parentTraits: TraitConfig[],
  childTraits: TraitConfig[],
  _actorName: string,
): TraitConfig[] {
  const merged = [...parentTraits]
  const isRemoval = (
    t: TraitConfig,
  ): t is TraitConfig & { _remove: boolean } =>
    (t as TraitConfig & { _remove?: boolean })._remove === true

  for (const child of childTraits) {
    if (isRemoval(child)) {
      // Remove trait with matching name
      const idx = merged.findIndex(t => t.name === child.name)
      if (idx !== -1) {
        merged.splice(idx, 1)
      }
      // NOTE: In OpenRA, removing a non-existent inherited trait is
      // NOT an error — it's silently ignored.
      continue
    }

    const existingIdx = merged.findIndex(t => t.name === child.name)
    if (existingIdx !== -1) {
      // Override: replace inherited trait with child's version
      merged[existingIdx] = child
    } else {
      // New trait: append
      merged.push(child)
    }
  }

  return merged
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm with interface resolution)
// ---------------------------------------------------------------------------

/**
 * Topologically sort traits by their dependency constraints.
 *
 * Uses Kahn's algorithm with cycle detection. Dependencies are resolved
 * via interface matching:
 * - If trait B "dependsOn: ["IMove"]", then any trait A whose
 *   "implements" includes "IMove" satisfies B's dependency.
 * - "notBefore" adds an edge only if the target interface IS implemented
 *   by some other trait in the set.
 *
 * OpenRA 对照: ActorInfo.TraitsInConstructOrder()
 *
 * @param traits — unsorted trait configs
 * @param actorName — for error messages
 * @returns sorted trait configs (new array)
 * @throws if circular dependencies or missing hard dependencies are detected
 */
function topoSort(
  traits: TraitConfig[],
  actorName: string,
): readonly TraitConfig[] {
  if (traits.length === 0) return Object.freeze([]) as readonly TraitConfig[]

  const n = traits.length
  const traitNames = traits.map(t => t.name)

  // Build name → index mapping
  const nameToIdx = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    nameToIdx.set(traits[i].name, i)
  }

  // Build adjacency list: trait → set of traits that depend on it
  const adjacency: number[][] = Array.from({ length: n }, () => [])

  // Compute in-degree for each trait
  const inDegree = new Int32Array(n)

  // For each trait, resolve its dependsOn and notBefore to concrete indices
  for (let i = 0; i < n; i++) {
    const trait = traits[i]

    // Resolve hard dependencies: dependsOn interface names → trait indices
    for (const depIface of trait.dependsOn) {
      const depIndices = findImplementors(depIface, traits, nameToIdx)
      if (depIndices.length === 0) {
        // No trait implements the required interface — this is a hard
        // dependency failure. Build a helpful error message.
        const available = traits
          .map(t => `${t.name} implements [${t.implements.join(', ')}]`)
          .join('; ')
        throw new Error(
          `ActorConfig "${actorName}" failed to initialize:\n` +
          `Missing: ${depIface} (required by trait '${trait.name}')\n` +
          `Available trait implementations: ${available || '(none)'}`,
        )
      }
      for (const depIdx of depIndices) {
        // Edge: dep → trait (dep must come before trait)
        if (depIdx !== i) {
          adjacency[depIdx].push(i)
          inDegree[i]++
        }
      }
    }

    // Resolve soft dependencies: notBefore interface names → trait indices
    for (const notBeforeIface of trait.notBefore) {
      const depIndices = findImplementors(notBeforeIface, traits, nameToIdx)
      for (const depIdx of depIndices) {
        if (depIdx !== i) {
          // Edge: dep → trait (dep must come before trait)
          adjacency[depIdx].push(i)
          inDegree[i]++
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: number[] = []
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) {
      queue.push(i)
    }
  }

  const result: TraitConfig[] = []
  while (queue.length > 0) {
    // Sort queue to ensure deterministic output
    queue.sort((a, b) => traitNames[a].localeCompare(traitNames[b]))
    const node = queue.shift()!
    result.push(traits[node])

    for (const neighbor of adjacency[node]) {
      inDegree[neighbor]--
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor)
      }
    }
  }

  // Cycle detection: if not all traits were sorted
  if (result.length !== n) {
    const unresolved = traits
      .filter((_, i) => !result.includes(traits[i]))
      .map(t => {
        const unmetDeps = t.dependsOn
          .filter(d => {
            const impl = findImplementors(d, traits, nameToIdx)
            return impl.some(idx => !result.includes(traits[idx]))
          })
        const unmetSoft = t.notBefore
          .filter(d => {
            const impl = findImplementors(d, traits, nameToIdx)
            return impl.some(idx => !result.includes(traits[idx]))
          })
        const allUnmet = [
          ...unmetDeps,
          ...unmetSoft.map(s => `[${s}]`),
        ].join(', ')
        return `  ${t.name}: { ${allUnmet} }`
      })
      .join('\n')

    throw new Error(
      `ActorConfig "${actorName}" failed to initialize because of the following:\n` +
      `Unresolved (circular dependency or missing prerequisite):\n${unresolved}`,
    )
  }

  return result
}

/**
 * Find all trait indices that implement the given interface.
 */
function findImplementors(
  interfaceName: string,
  traits: TraitConfig[],
  _nameToIdx: ReadonlyMap<string, number>,
): number[] {
  const indices: number[] = []
  for (let i = 0; i < traits.length; i++) {
    if (traits[i].implements.includes(interfaceName)) {
      indices.push(i)
    }
  }
  return indices
}

// ---------------------------------------------------------------------------
// Deep freeze (immutability)
// ---------------------------------------------------------------------------

/**
 * Recursively freeze an object and all nested objects/arrays.
 *
 * OpenRA 对照: (implicit — YAML-loaded configs are never mutated)
 *
 * CRITICAL: Per-frame code must not mutate ActorConfigs. Freezing
 * makes accidental mutation throw in strict mode, catching bugs early.
 *
 * Uses a WeakSet to handle circular references safely.
 */
function deepFreeze<T>(obj: T, seen = new WeakSet<object>()): T {
  if (obj === null || typeof obj !== 'object') return obj

  // Already seen — circular reference, skip
  if (seen.has(obj as object)) return obj
  seen.add(obj as object)

  // Freeze the object itself
  Object.freeze(obj)

  // Recurse into properties (but skip Map/Set/WeakMap/WeakSet — they
  // have their own freeze semantics and we trust their internal state)
  if (obj instanceof Map || obj instanceof Set || obj instanceof WeakMap || obj instanceof WeakSet) {
    return obj
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item, seen)
    }
  } else {
    const record = obj as Record<string, unknown>
    for (const key of Object.keys(record)) {
      deepFreeze(record[key], seen)
    }
  }

  return obj
}
