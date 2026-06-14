/**
 * ActorInitializer.ts — Actor 初始化参数容器
 * OpenRA 对照: OpenRA.Game/ActorInitializer.cs
 *
 * 核心范式转换:
 * - C# TypeDictionary (type-keyed lookup) → TS Map<string, any> (string-keyed bag)
 * - C# ActorInit<T> abstract base → TS ActorInit<T> abstract base
 * - C# ValueActorInit<T> generic → TS ValueActorInit<T> generic
 * - C# ISingleInstanceInit marker → TS ISingleInstanceInit marker interface
 * - C# LocationInit, CenterPositionInit, etc. → TS 同名便利类
 *
 * @todo 完整实现推迟至第14章。当前桩提供 Production.ts 和 PlaceBuilding.ts
 *   所需的初始化参数容器。TypeDictionary 的完整类型安全替换将在
 *   ActorInitializer 系统完整迁移时实现。
 */

import type { CPos } from './CPos.js'
import type { WPos } from './WPos.js'
import type { WAngle } from './WAngle.js'
import type { PlayerStub } from './Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ActorInit — abstract base for initialization values
// OpenRA 对照: ActorInit<T> abstract class
// ---------------------------------------------------------------------------

/** Abstract base class for actor initialization values.
 *
 * OpenRA 对照: ActorInit<T>
 *
 * Each ActorInit represents a single piece of initialization data
 * that is passed to an actor when it is created. The key is a string
 * (e.g., "location", "centerPosition") rather than a C# type.
 */
export abstract class ActorInit<T> {
  /** The string key used to identify this init in the ActorInitializer bag. */
  abstract readonly key: string

  /** The value to initialize the actor with.
   *
   * OpenRA 对照: ActorInit<T>.Value()
   */
  abstract readonly value: T
}

// ---------------------------------------------------------------------------
// ISingleInstanceInit — marker for init types that can only appear once
// OpenRA 对照: ISingleInstanceInit
// ---------------------------------------------------------------------------

/** Marker interface indicating this init type can only appear once
 * in an actor's initializer bag.
 *
 * OpenRA 对照: ISingleInstanceInit
 */
export interface ISingleInstanceInit {
  // intentionally empty — marker interface
}

// ---------------------------------------------------------------------------
// ValueActorInit — generic value-based init
// OpenRA 对照: ValueActorInit<T>
// ---------------------------------------------------------------------------

/** Generic actor init that holds a single typed value.
 *
 * OpenRA 对照: ValueActorInit<T>
 *
 * Most concrete init types (LocationInit, FacingInit, etc.) extend this.
 */
export abstract class ValueActorInit<T> extends ActorInit<T> implements ISingleInstanceInit {
  private readonly _value: T

  constructor(value: T) {
    super()
    this._value = value
  }

  get value(): T {
    return this._value
  }
}

// ---------------------------------------------------------------------------
// ActorInitializer — container bag for init values
// OpenRA 对照: ActorInitializer
// ---------------------------------------------------------------------------

/** Container for actor initialization parameters.
 *
 * OpenRA 对照: ActorInitializer
 *
 * In C#, ActorInitializer uses a TypeDictionary for type-keyed lookup.
 * In TypeScript, we use a Map<string, any> with string keys.
 *
 * Production.ts calls `new Map(inits)` to clone the bag when creating
 * actors. PlaceBuilding.ts populates the bag with LocationInit,
 * CenterPositionInit, FacingInit, etc.
 *
 * @todo Full TypeDictionary replacement deferred to Chapter 14.
 */
export class ActorInitializer {
  /** The init bag: string key -> value mapping. */
  private readonly _inits: Map<string, unknown>

  /** The world this actor is being created in.
   *
   * OpenRA 对照: ActorInitializer.World
   *
   * @todo Stub — World reference deferred.
   */
  readonly world: unknown | null = null

  /** The actor being initialized (self-reference, set after creation).
   *
   * OpenRA 对照: ActorInitializer.Self
   *
   * @todo Stub — Self reference deferred.
   */
  self: unknown | null = null

  /** Create an initializer bag from an array of ActorInit values.
   *
   * OpenRA 对照: ActorInitializer(Actor, TypeDictionary)
   *
   * @param inits — array of init values to populate the bag
   */
  constructor(inits: readonly ActorInit<unknown>[] = []) {
    this._inits = new Map()
    for (const init of inits) {
      this._inits.set(init.key, init.value)
    }
  }

  /** Create an initializer bag from an existing Map (clone).
   *
   * OpenRA 对照: new ActorInitializer(world, typeDictionary)
   *
   * @param map — existing Map to clone into this initializer
   */
  static fromMap(map: Map<string, unknown>): ActorInitializer {
    const initializer = new ActorInitializer()
    for (const [key, value] of map) {
      initializer._inits.set(key, value)
    }
    return initializer
  }

  /** Get an init value by key.
   *
   * OpenRA 对照: ActorInitializer.Get<T>()
   *
   * @param key — the string key to look up
   * @returns the value, or undefined if not present
   */
  get<T>(key: string): T | undefined {
    return this._inits.get(key) as T | undefined
  }

  /** Check if an init value exists for the given key.
   *
   * OpenRA 对照: ActorInitializer.Contains<T>()
   *
   * @param key — the string key to check
   * @returns true if the key exists in the bag
   */
  contains(key: string): boolean {
    return this._inits.has(key)
  }

  /** Set an init value by key.
   *
   * OpenRA 对照: ActorInitializer.Add<T>(T value)
   *
   * @param key — the string key
   * @param value — the value to set
   */
  set(key: string, value: unknown): void {
    this._inits.set(key, value)
  }

  /** Get the underlying Map for iteration or cloning.
   *
   * @returns the internal init Map
   */
  get inits(): Map<string, unknown> {
    return new Map(this._inits)
  }

  /** Get the number of init values in the bag.
   *
   * @returns the count of init entries
   */
  get count(): number {
    return this._inits.size
  }
}

// ---------------------------------------------------------------------------
// Convenience init classes
// OpenRA 对照: LocationInit, CenterPositionInit, FacingInit, etc.
// ---------------------------------------------------------------------------

/** Initialize actor location (cell position).
 *
 * OpenRA 对照: LocationInit (ValueActorInit<CPos>)
 */
export class LocationInit extends ValueActorInit<CPos> {
  readonly key = 'location'

  constructor(value: CPos) {
    super(value)
  }
}

/** Initialize actor center position (world position).
 *
 * OpenRA 对照: CenterPositionInit (ValueActorInit<WPos>)
 */
export class CenterPositionInit extends ValueActorInit<WPos> {
  readonly key = 'centerPosition'

  constructor(value: WPos) {
    super(value)
  }
}

/** Initialize actor facing direction.
 *
 * OpenRA 对照: FacingInit (ValueActorInit<WAngle>)
 */
export class FacingInit extends ValueActorInit<WAngle> {
  readonly key = 'facing'

  constructor(value: WAngle) {
    super(value)
  }
}

/** Initialize creation activity delay (ticks before actor becomes active).
 *
 * OpenRA 对照: CreationActivityDelayInit (ValueActorInit<int>)
 */
export class CreationActivityDelayInit extends ValueActorInit<number> {
  readonly key = 'creationActivityDelay'

  constructor(value: number) {
    super(value)
  }
}

/** Initialize rally point path.
 *
 * OpenRA 对照: RallyPointInit (ValueActorInit<CPos[]>)
 */
export class RallyPointInit extends ValueActorInit<readonly CPos[]> {
  readonly key = 'rallyPoint'

  constructor(value: readonly CPos[]) {
    super(value)
  }
}

/** Initialize actor owner.
 *
 * OpenRA 对照: OwnerInit (ValueActorInit<Player>)
 */
export class OwnerInit extends ValueActorInit<PlayerStub> {
  readonly key = 'owner'

  constructor(value: PlayerStub) {
    super(value)
  }
}
