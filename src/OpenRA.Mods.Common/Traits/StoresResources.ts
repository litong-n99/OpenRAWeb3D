/**
 * StoresResources.ts — Resource storage trait (e.g., refinery cargo, silo storage)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/StoresResources.cs (107 lines)
 *
 * 核心范式转换:
 * - C# Dictionary<string, int> + ReadOnlyDictionary wrapper → TS Map<string, number> + ReadonlyMap getter
 * - C# TraitInfo + IStoresResourcesInfo → TS ConditionalTraitInfo + IStoresResourcesInfo
 * - C# [VerifySync] ContentHash → TS ISync marker interface + contentHash getter
 * - C# explicit interface implementation (IStoresResources.AddResource) → TS public method
 * - C# ImmutableArray<string> Resources → TS readonly string[] resources
 *
 * StoresResources provides per-actor resource storage (cargo for harvesters,
 * refineries, silos, etc.). It tracks contents by resource type and supports
 * add/remove operations with overflow/underflow semantics.
 *
 * NOTE: In OpenRA C#, StoresResources extends plain TraitInfo / plain class.
 * In this TS migration, it extends ConditionalTrait<StoresResourcesInfo>
 * to support condition-based enable/disable (consistent with Harvester's usage
 * as cargo trait where empty/full conditions are managed).
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IStoresResources,
  IStoresResourcesInfo,
  ISync,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// StoresResourcesInfo
// OpenRA 对照: StoresResourcesInfo (TraitInfo, IStoresResourcesInfo)
// ---------------------------------------------------------------------------

/** Configuration for the StoresResources trait.
 *
 * OpenRA 对照: StoresResourcesInfo
 */
export class StoresResourcesInfo implements ConditionalTraitInfo, IStoresResourcesInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Maximum total resource units that can be stored across all types.
   *
   * OpenRA 对照: StoresResourcesInfo.Capacity (default 28)
   */
  readonly capacity: number = 28

  /** Which resource types can be stored.
   *
   * OpenRA 对照: StoresResourcesInfo.Resources (ImmutableArray, default empty)
   */
  readonly resources: readonly string[] = []

  /** Resource types that can be stored (IStoresResourcesInfo contract).
   *
   * OpenRA 对照: IStoresResourcesInfo.ResourceTypes => Resources
   */
  get resourceTypes(): readonly string[] {
    return this.resources
  }

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    capacity?: number
    resources?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.capacity = params.capacity ?? 28
    this.resources = params.resources ?? []
  }
}

// ---------------------------------------------------------------------------
// StoresResources
// OpenRA 对照: StoresResources (IStoresResources, ISync)
// ---------------------------------------------------------------------------

/** Resource storage trait for per-actor resource tracking.
 *
 * OpenRA 对照: StoresResources
 *
 * Manages a per-type resource inventory with a shared total capacity limit.
 * When addResource exceeds capacity, the overflow amount is returned.
 * When removeResource exceeds the stored amount, the underflow is returned.
 *
 * ContentHash provides a deterministic hash for network sync verification.
 * The hash algorithm matches OpenRA exactly: sum over all types of
 * (storedAmount << typeName.length).
 */
export class StoresResources
  extends ConditionalTrait<StoresResourcesInfo>
  implements IStoresResources, ISync
{
  /** Internal resource storage: type -> amount.
   *
   * OpenRA 对照: Dictionary<string, int> contents
   */
  private readonly _contents: Map<string, number> = new Map()

  /** Total amount of resources currently stored (sum of all types).
   *
   * OpenRA 对照: int ContentsSum
   */
  private _contentsSum: number = 0

  constructor(info: StoresResourcesInfo) {
    super(info)
    // Initialize all known resource types to 0 in the contents map
    for (const r of info.resources) {
      this._contents.set(r, 0)
    }
  }

  // -----------------------------------------------------------------------
  // IStoresResources.Capacity
  // OpenRA 对照: int IStoresResources.Capacity => info.Capacity
  // -----------------------------------------------------------------------

  /** Maximum total resource units that can be stored (sum across all types).
   *
   * OpenRA 对照: IStoresResources.Capacity
   */
  get capacity(): number {
    return this.info.capacity
  }

  // -----------------------------------------------------------------------
  // IStoresResources.Contents — public read-only view
  // OpenRA 对照: IReadOnlyDictionary<string, int> Contents
  // -----------------------------------------------------------------------

  /** Public read-only view of the internal resource storage.
   *
   * OpenRA 对照: ReadOnlyDictionary<string, int> Contents
   *
   * Returns a live view — modifications to the internal store are immediately
   * reflected. Equivalent to C# ReadOnlyDictionary wrapping the live dict.
   */
  get contents(): ReadonlyMap<string, number> {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IStoresResources.ContentsSum
  // OpenRA 对照: int ContentsSum
  // -----------------------------------------------------------------------

  /** Total amount of resources currently stored.
   *
   * OpenRA 对照: ContentsSum
   */
  get contentsSum(): number {
    return this._contentsSum
  }

  // -----------------------------------------------------------------------
  // ISync.ContentHash
  // OpenRA 对照: [VerifySync] int ContentHash
  // -----------------------------------------------------------------------

  /** Deterministic sync hash for network desync detection.
   *
   * OpenRA 对照: ContentHash
   *
   * Algorithm: value = 0; foreach (kv in contents) value += kv.Value << kv.Key.Length;
   *
   * The hash combines each resource value shifted left by the type name length.
   * This provides a simple but effective hash for sync verification across
   * networked clients.
   */
  get contentHash(): number {
    let value = 0
    for (const [key, val] of this._contents) {
      value += val << key.length
    }
    return value
  }

  // -----------------------------------------------------------------------
  // IStoresResources.HasType
  // OpenRA 对照: bool HasType(string resourceType)
  // -----------------------------------------------------------------------

  /** Check whether this storage accepts a given resource type.
   *
   * OpenRA 对照: HasType(string)
   *
   * @param resourceType — the resource type to check
   * @returns true if this storage can hold this resource type
   */
  hasType(resourceType: string): boolean {
    return this.info.resources.includes(resourceType)
  }

  // -----------------------------------------------------------------------
  // IStoresResources.AddResource
  // OpenRA 对照: int IStoresResources.AddResource(string, int)
  // -----------------------------------------------------------------------

  /** Add a resource amount to storage.
   *
   * OpenRA 对照: IStoresResources.AddResource(string, int)
   *
   * If the resource type is not accepted (HasType returns false), the full
   * value is returned as overflow and nothing is stored.
   *
   * If adding the full value would exceed Capacity, only the available
   * portion is stored and the remaining overflow is returned.
   *
   * NOTE: This method intentionally does NOT gate on isTraitDisabled.
   * In OpenRA C#, StoresResources extends a plain class (not
   * ConditionalTrait / PausableConditionalTrait), and resource operations
   * are always available regardless of condition state. The TS migration
   * extends ConditionalTrait<StoresResourcesInfo> solely for condition
   * lifecycle management (enable/disable resets via ConditionManager),
   * but preserves the original ungated resource operation behavior.
   *
   * @param resourceType — the type of resource to add
   * @param value — the amount to add
   * @returns the amount that could NOT be added (overflow). 0 means all
   *          was stored successfully.
   */
  addResource(resourceType: string, value: number): number {
    if (!this.hasType(resourceType)) return value

    if (this._contentsSum + value > this.info.capacity) {
      const added = this.info.capacity - this._contentsSum
      const current = this._contents.get(resourceType) ?? 0
      this._contents.set(resourceType, current + added)
      this._contentsSum = this.info.capacity
      return value - added
    }

    const current = this._contents.get(resourceType) ?? 0
    this._contents.set(resourceType, current + value)
    this._contentsSum += value
    return 0
  }

  // -----------------------------------------------------------------------
  // IStoresResources.RemoveResource
  // OpenRA 对照: int IStoresResources.RemoveResource(string, int)
  // -----------------------------------------------------------------------

  /** Remove a resource amount from storage.
   *
   * OpenRA 对照: IStoresResources.RemoveResource(string, int)
   *
   * If the resource type is not accepted (HasType returns false), the full
   * value is returned as underflow and nothing is removed.
   *
   * If the stored amount is less than the requested value, only the stored
   * amount is removed and the remaining underflow is returned.
   *
   * NOTE: This method intentionally does NOT gate on isTraitDisabled,
   * matching the original OpenRA C# behavior. See addResource() JSDoc
   * for the full rationale.
   *
   * @param resourceType — the type of resource to remove
   * @param value — the amount to remove
   * @returns the amount that could NOT be removed (underflow). 0 means all
   *          was removed successfully.
   */
  removeResource(resourceType: string, value: number): number {
    if (!this.hasType(resourceType)) return value

    const current = this._contents.get(resourceType) ?? 0
    if (current < value) {
      const leftover = value - current
      this._contentsSum -= current
      this._contents.set(resourceType, 0)
      return leftover
    }

    this._contents.set(resourceType, current - value)
    this._contentsSum -= value
    return 0
  }
}
