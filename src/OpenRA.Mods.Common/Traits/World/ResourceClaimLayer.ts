/**
 * ResourceClaimLayer.ts — 防止同一玩家采油车在同一 cell 上争抢资源的协调层
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ResourceClaimLayer.cs
 *
 * 核心范式转换:
 * - C# Dictionary<CPos, List<Actor>> → Map<string, IGameActor[]> (CPos.toString() 键控)
 * - C# Dictionary<Actor, CPos> → Map<number, CPos> (IGameActor.actorId 键控)
 * - C# Actor.IsDead → IGameActor.isDead
 * - C# Actor.Owner.IsAlliedWith() → 鸭子类型检查 (通过 IGameActor.owner)
 * - C# TraitInfo<ResourceClaimLayer> 泛型 → ResourceClaimLayerInfo.create() 工厂
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// ResourceClaimLayerInfo — world-trait 配置 (无配置字段)
// OpenRA 对照: ResourceClaimLayerInfo : TraitInfo<ResourceClaimLayer>
// ---------------------------------------------------------------------------

/** Configuration for the ResourceClaimLayer world trait.
 *
 * OpenRA 对照: ResourceClaimLayerInfo (sealed class, TraitInfo<ResourceClaimLayer>)
 *
 * Attached to the world actor. No configuration fields — purely a marker
 * that enables resource claim coordination for harvesters.
 */
export class ResourceClaimLayerInfo implements ITraitInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }

  /**
   * Create a ResourceClaimLayer trait instance.
   *
   * OpenRA 对照: TraitInfo<ResourceClaimLayer>.Create(ActorInitializer)
   *
   * @returns a new ResourceClaimLayer instance
   */
  create(): ResourceClaimLayer {
    return new ResourceClaimLayer()
  }
}

// ---------------------------------------------------------------------------
// ResourceClaimLayer — 采油车资源 cell 声索协调
// OpenRA 对照: ResourceClaimLayer (sealed class)
// ---------------------------------------------------------------------------

/** Allows harvesters to coordinate their operations. Attach this to the world actor.
 *
 * OpenRA 对照: ResourceClaimLayer
 *
 * Maintains a bidirectional mapping between cells and harvesters that have
 * claimed them. Prevents harvesters from the same player (or allied players)
 * from fighting over the same resource cell.
 *
 * Player separation: harvesters from different (non-allied) players can
 * claim the same cell — only intra-faction contention is prevented.
 *
 * Stale cleanup: dead actors are removed from claims during claim checks.
 */
export class ResourceClaimLayer {
  /** Cell index to list of claiming actors.
   *
   * OpenRA 对照: claimByCell (Dictionary<CPos, List<Actor>>)
   *
   * Keyed by CPos.toString() string representation ("X,Y" or "X,Y,Layer").
   */
  private readonly claimByCell: Map<string, IGameActor[]> = new Map()

  /** Actor ID to the cell they have claimed.
   *
   * OpenRA 对照: claimByActor (Dictionary<Actor, CPos>)
   *
   * Keyed by IGameActor.actorId (number).
   */
  private readonly claimByActor: Map<number, CPos> = new Map()

  // ---------------------------------------------------------------------------
  // tryClaimCell
  // OpenRA 对照: ResourceClaimLayer.TryClaimCell(Actor, CPos)
  // ---------------------------------------------------------------------------

  /** Attempt to reserve the resource in a cell for the given actor.
   *
   * OpenRA 对照: ResourceClaimLayer.TryClaimCell(Actor claimer, CPos cell)
   *
   * Returns false if the cell is already claimed by an allied actor
   * (same player or ally). Cleans up stale claims from dead actors.
   * If the actor already had a claim on a different cell, the old claim
   * is released automatically.
   *
   * @param claimer — the actor attempting to claim the cell
   * @param cell — the cell position to claim
   * @returns true if the claim was successful, false if blocked by an allied claim
   */
  tryClaimCell(claimer: IGameActor, cell: CPos): boolean {
    const cellKey = cell.toString()

    let claimers = this.claimByCell.get(cellKey)

    if (claimers) {
      // Clean up any stale claims from dead actors
      for (let i = claimers.length - 1; i >= 0; i--) {
        if (claimers[i].isDead) {
          claimers.splice(i, 1)
          // Also clean up from claimByActor
          // NOTE: We don't have the cell context here to clean claimByActor
          // for each dead actor. This is acceptable — the dead actor's
          // entry in claimByActor will be overwritten if it claims again,
          // or removed via removeClaim(). OpenRA has the same behavior
          // since List.RemoveAll only removes from the claimByCell list.
        }
      }

      // Prevent harvesters from the same player or allies from
      // fighting over the same cell
      for (const c of claimers) {
        if (c !== claimer && ResourceClaimLayer.areAllied(claimer, c)) {
          return false
        }
      }
    }

    // Remove the actor's last claim, if it has one
    const oldClaim = this.claimByActor.get(claimer.actorId)
    if (oldClaim !== undefined) {
      const oldClaimers = this.claimByCell.get(oldClaim.toString())
      if (oldClaimers) {
        const idx = oldClaimers.indexOf(claimer)
        if (idx !== -1) oldClaimers.splice(idx, 1)
      }
    }

    if (!claimers) {
      claimers = []
      this.claimByCell.set(cellKey, claimers)
    }
    claimers.push(claimer)
    this.claimByActor.set(claimer.actorId, cell)
    return true
  }

  // ---------------------------------------------------------------------------
  // canClaimCell
  // OpenRA 对照: ResourceClaimLayer.CanClaimCell(Actor, CPos)
  // ---------------------------------------------------------------------------

  /** Returns false if the cell is already reserved by an allied actor.
   *
   * OpenRA 对照: ResourceClaimLayer.CanClaimCell(Actor claimer, CPos cell)
   *
   * Does NOT clean up stale claims (unlike tryClaimCell). This is a
   * read-only check that can be used to determine if moving to a cell
   * would be worthwhile.
   *
   * @param claimer — the actor checking the cell
   * @param cell — the cell position to check
   * @returns true if the cell can be claimed (no allied claimant)
   */
  canClaimCell(claimer: IGameActor, cell: CPos): boolean {
    const claimers = this.claimByCell.get(cell.toString())
    if (!claimers || claimers.length === 0) return true

    for (const c of claimers) {
      // Only blocked by living allied actors that are not ourselves
      if (c !== claimer && !c.isDead && ResourceClaimLayer.areAllied(claimer, c)) {
        return false
      }
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // removeClaim
  // OpenRA 对照: ResourceClaimLayer.RemoveClaim(Actor)
  // ---------------------------------------------------------------------------

  /** Release the last resource claim made by this actor.
   *
   * OpenRA 对照: ResourceClaimLayer.RemoveClaim(Actor claimer)
   *
   * Removes the actor from both claimByCell and claimByActor.
   * Safe to call even if the actor has no claim.
   *
   * @param claimer — the actor whose claim should be released
   */
  removeClaim(claimer: IGameActor): void {
    const oldClaim = this.claimByActor.get(claimer.actorId)
    if (oldClaim !== undefined) {
      const claimers = this.claimByCell.get(oldClaim.toString())
      if (claimers) {
        const idx = claimers.indexOf(claimer)
        if (idx !== -1) claimers.splice(idx, 1)
      }
      this.claimByActor.delete(claimer.actorId)
    }
  }

  // ---------------------------------------------------------------------------
  // Private: areAllied — check if two actors share allied players
  // OpenRA 对照: Actor.Owner.IsAlliedWith(otherOwner)
  // ---------------------------------------------------------------------------

  /** Check whether two actors belong to the same or allied players.
   *
   * OpenRA 对照: claimer.Owner.IsAlliedWith(c.Owner)
   *
   * Uses duck-typing through the IGameActor.owner property, since the
   * full Player class may not be available at compile time. Falls back
   * to false if either actor lacks an owner.
   *
   * @param a — first actor
   * @param b — second actor
   * @returns true if they are allied (or same player)
   */
  private static areAllied(a: IGameActor, b: IGameActor): boolean {
    const ownerA = a.owner as Record<string, unknown> | undefined
    const ownerB = b.owner as Record<string, unknown> | undefined

    if (!ownerA || !ownerB) return false

    // Same player reference
    if (ownerA === ownerB) return true

    // Check via duck-typed isAlliedWith method
    const isAlliedWith = ownerA.isAlliedWith as
      | ((other: Record<string, unknown>) => boolean)
      | undefined
    if (typeof isAlliedWith === 'function') {
      return isAlliedWith(ownerB)
    }

    return false
  }
}
