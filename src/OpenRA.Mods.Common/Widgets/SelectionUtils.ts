/**
 * SelectionUtils.ts — 单元选择工具函数（优先级计算、玩家筛选、框选死区）
 * OpenRA 对照: OpenRA.Mods.Common.Widgets/SelectionUtils.cs (86 lines)
 *
 * 核心范式转换:
 * - 2D ScreenMap.ActorsInMouseBox() 空间索引 → Babylon.js scene.pick() + frustum culling
 *   （屏幕查询由调用方通过 WorldInteractionControllerWidget 的 raycast/frustum 完成；
 *   SelectionUtils 提供纯逻辑函数：过滤、优先级计算、玩家包含规则）
 * - C# LINQ WithHighestSelectionPriority + SubsetWithHighestSelectionPriority
 *   → TypeScript Array.sort() + reduce 分组
 * - C# CalculateActorSelectionPriority(selectionPixel, bounds) 2D 像素距离
 *   → TypeScript 保留相同公式: priority - (pixelDistance << 16)
 * - C# Player.Spectating / Player.NonCombatant → SelectionPlayerInfo 鸭子类型接口
 *
 * NOTE: 本文件不直接调用 Babylon.js scene.pick() 或创建 frustum。
 * 这些 3D 操作由 WorldInteractionControllerWidget（已有迁移）负责。
 * SelectionUtils 提供 WICW 在点选/框选/双击选中时调用的过滤和优先级逻辑。
 */

import type { SelectionPriorityModifiers } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Selection-relevant type imports (from TraitsInterfaces)
// ---------------------------------------------------------------------------

/**
 * Selection priority modifier flags — re-exported for convenience.
 *
 * OpenRA 对照: SelectionPriorityModifiers (Flags enum)
 */
export { SelectionPriorityModifiers } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Interfaces — minimal player/world info for selection logic
// ---------------------------------------------------------------------------

/**
 * Player information needed by selection logic.
 *
 * OpenRA 对照: Player (partial — Spectating, NonCombatant)
 *
 * Uses duck-typing: any object with these optional properties is compatible.
 * Both the full Player class (Player.ts) and test stubs satisfy this interface.
 */
export interface SelectionPlayerInfo {
  /** Whether this player is spectating.
   *
   * OpenRA 对照: Player.Spectating
   */
  readonly spectating?: boolean

  /** Whether this player is non-combatant (observer/spawn-point selector).
   *
   * OpenRA 对照: Player.NonCombatant
   */
  readonly nonCombatant?: boolean
}

/**
 * World information needed by selection logic.
 *
 * OpenRA 对照: World (partial — renderPlayer, localPlayer, players)
 */
export interface SelectionWorldInfo {
  /** The player whose perspective is rendered (null for editor/no-shroud).
   *
   * OpenRA 对照: World.RenderPlayer
   */
  readonly renderPlayer: SelectionPlayerInfo | null | undefined

  /** The local client's player.
   *
   * OpenRA 对照: World.LocalPlayer
   */
  readonly localPlayer: SelectionPlayerInfo | null | undefined

  /** All players in the game.
   *
   * OpenRA 对照: World.Players
   */
  readonly players: readonly SelectionPlayerInfo[]
}

// ---------------------------------------------------------------------------
// Actor info for selection — what SelectionUtils needs to know about each actor
// ---------------------------------------------------------------------------

/**
 * Per-actor selection metadata required by SelectionUtils.
 *
 * OpenRA 对照: combination of ISelectable trait + ISelectableInfo + Actor properties
 *
 * Callers (e.g., WorldInteractionControllerWidget) construct this from their
 * game actor objects by querying ISelectable traits and ActorInfo metadata.
 */
export interface SelectionActorInfo {
  /** Globally unique actor identifier.
   *
   * OpenRA 对照: Actor.ActorID
   */
  readonly actorId: number

  /** The owner player reference.
   *
   * OpenRA 对照: Actor.Owner
   */
  readonly owner: SelectionPlayerInfo | null

  /** Selection class (e.g., "Infantry", "Vehicle", "Building").
   * null if the actor has no ISelectable trait.
   *
   * OpenRA 对照: ISelectable.Class
   */
  readonly selectionClass: string | null

  /** Base selection priority from trait info.
   *
   * OpenRA 对照: ISelectableInfo.Priority (default 10)
   */
  readonly priority: number

  /** Priority modifier flags (Ctrl / Alt).
   *
   * OpenRA 对照: ISelectableInfo.PriorityModifiers
   */
  readonly priorityModifiers: SelectionPriorityModifiers
}

// ---------------------------------------------------------------------------
// Modifier key state (used in priority calculation)
// ---------------------------------------------------------------------------

/**
 * Modifier key state for selection logic.
 *
 * OpenRA 对照: OpenRA.Game/Modifiers.cs
 */
export interface SelectionModifiers {
  /** Whether the Shift key is held. */
  readonly shift: boolean

  /** Whether the Ctrl key is held. */
  readonly ctrl: boolean

  /** Whether the Alt key is held. */
  readonly alt: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Priority penalty per relationship tier.
 *
 * OpenRA 对照: SelectableExts.PriorityRange = 30
 */
const PRIORITY_RANGE = 30

/**
 * Threshold applied to priority when the actor is not owned by the viewer.
 *
 * Relationship penalties (OpenRA SelectableExts.SelectionPriority):
 * - Ally:     basePriority - PriorityRange
 * - Neutral:  basePriority - 2 * PriorityRange
 * - Enemy:    basePriority - 3 * PriorityRange
 *
 * These values are pre-computed as constants for clarity.
 */
const RELATIONSHIP_PENALTY = {
  ALLY: PRIORITY_RANGE,           // basePriority - 30
  NEUTRAL: 2 * PRIORITY_RANGE,    // basePriority - 60
  ENEMY: 3 * PRIORITY_RANGE,      // basePriority - 90
} as const

/**
 * Multiplier for incorporating pixel distance into priority (2^16).
 *
 * OpenRA 对照: SelectableExts.CalculateActorSelectionPriority()
 * Formula: (selectionPriority - pixelDistance) * 65536
 *
 * The C# original uses `(priority - (long)pixelDistance) << 16` where
 * `-` has higher precedence than `<<`. We use multiplication by 65536
 * to avoid JavaScript's 32-bit integer << limit while producing the
 * same result. The large multiplier ensures that even ~1px distance
 * differences override all priority modifiers (priority ranges from
 * ~[priority-90, MAX_SAFE_INTEGER]), making proximity the dominant
 * factor for resolving ambiguous clicks.
 */
const PIXEL_DISTANCE_MULTIPLIER = 65536  // 1 << 16

// ---------------------------------------------------------------------------
// SelectionUtils — 单元选择工具
// ---------------------------------------------------------------------------

/**
 * Static utility methods for unit selection filtering and priority computation.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Widgets.SelectionUtils
 *
 * This class provides:
 * - Actor filtering by owner and selection class
 * - Selection priority computation (matching OpenRA's SelectableExts formula)
 * - Player inclusion rules for selection
 * - Highest-priority actor selection (from a set, sorted by priority + distance)
 *
 * ## 3D Adaptation Notes
 *
 * OpenRA's SelectionUtils delegates spatial queries (ScreenMap.ActorsInMouseBox,
 * ScreenMap.ActorsAtMouse) to the ScreenMap 2D spatial index. In the 3D
 * migration, these spatial queries are replaced by:
 * - scene.pick() / scene.pickWithRay() for point queries
 * - frustum construction from screen rectangle corners for box queries
 *
 * These 3D operations are performed by WorldInteractionControllerWidget
 * (already migrated). SelectionUtils accepts pre-filtered candidate lists
 * and applies selection-class filtering, owner filtering, and priority
 * computation — exactly matching OpenRA's SelectActorsByOwnerAndSelectionClass,
 * WithHighestSelectionPriority, and SubsetWithHighestSelectionPriority.
 */
export class SelectionUtils {
  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  /**
   * Filter actors by owner and selection class.
   *
   * OpenRA 对照: SelectActorsByOwnerAndSelectionClass()
   *
   * An actor passes the filter if:
   * 1. Its owner is in the `owners` set, AND
   * 2. It has an ISelectable trait with a non-null selection class, AND
   * 3. `selectionClasses` is null (select everything) OR the actor's class
   *    is in the `selectionClasses` set.
   *
   * **Performance**: O(n) single pass — no per-frame allocation beyond the
   * result array. For 500 actors, this completes in well under 16ms.
   *
   * @param actors — candidate actors
   * @param owners — player references to include (matched by reference identity)
   * @param selectionClasses — class filter; null = select all matching classes
   * @returns filtered actors in original order
   */
  static selectActorsByOwnerAndSelectionClass(
    actors: Iterable<SelectionActorInfo>,
    owners: Iterable<SelectionPlayerInfo>,
    selectionClasses: readonly string[] | null,
  ): SelectionActorInfo[] {
    const ownerSet = new Set(owners)

    const result: SelectionActorInfo[] = []
    for (const a of actors) {
      // Must be owned by an eligible player
      if (!a.owner || !ownerSet.has(a.owner)) continue

      // Must be selectable (has a selection class)
      if (a.selectionClass === null) continue

      // selectionClasses == null means select all matching classes
      if (selectionClasses !== null && !selectionClasses.includes(a.selectionClass)) continue

      result.push(a)
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Selection priority computation
  // ---------------------------------------------------------------------------

  /**
   * Compute the base selection priority for an actor, incorporating modifier
   * keys and relationship penalties.
   *
   * OpenRA 对照: SelectableExts.SelectionPriority(Actor, Modifiers)
   *
   * Algorithm:
   * 1. Start with the actor's base priority from ISelectableInfo.Priority
   * 2. If Ctrl is held (without Alt) and the actor has Ctrl priority modifier:
   *    priority = Number.MAX_SAFE_INTEGER
   * 3. If Alt is held (without Ctrl) and the actor has Alt priority modifier:
   *    priority = Number.MAX_SAFE_INTEGER
   * 4. Apply relationship penalty if the viewer is not the owner:
   *    - Ally: basePriority - 30
   *    - Neutral: basePriority - 60
   *    - Enemy: basePriority - 90
   *
   * NOTE: This method requires a `viewer` player reference to compute
   * relationship penalties. If the viewer is null (no local player),
   * no penalty is applied.
   *
   * @param actor — the actor to compute priority for
   * @param modifiers — current modifier key state
   * @param viewer — the viewer player (localPlayer or renderPlayer)
   * @param relationshipWith — function returning the relationship from viewer to owner
   * @returns computed priority value (higher = more likely to be selected)
   */
  static selectionPriority(
    actor: SelectionActorInfo,
    modifiers: SelectionModifiers,
    viewer: SelectionPlayerInfo | null,
    relationshipWith: (viewer: SelectionPlayerInfo, other: SelectionPlayerInfo) => number,
  ): number {
    // Step 1: base priority
    let priority = actor.priority

    // Step 2: Ctrl modifier boost
    if (
      modifiers.ctrl &&
      !modifiers.alt &&
      (actor.priorityModifiers & 1) === 1   // SelectionPriorityModifiers.Ctrl = 1
    ) {
      priority = Number.MAX_SAFE_INTEGER
    }

    // Step 3: Alt modifier boost
    if (
      modifiers.alt &&
      !modifiers.ctrl &&
      (actor.priorityModifiers & 2) === 2   // SelectionPriorityModifiers.Alt = 2
    ) {
      priority = Number.MAX_SAFE_INTEGER
    }

    // Step 4: Relationship penalty
    // NOTE: Ctrl/Alt-boosted priority (MAX_SAFE_INTEGER) is not further penalized —
    // OpenRA's formula also lets the modifier-boosted priority override penalties,
    // since int.MaxValue - 30 is still effectively int.MaxValue.
    if (viewer && actor.owner && viewer !== actor.owner) {
      const rel = relationshipWith(viewer, actor.owner)
      switch (rel) {
        case 4:  // PlayerRelationship.Ally = 4
          priority -= RELATIONSHIP_PENALTY.ALLY
          break
        case 2:  // PlayerRelationship.Neutral = 2
          priority -= RELATIONSHIP_PENALTY.NEUTRAL
          break
        case 1:  // PlayerRelationship.Enemy = 1
          priority -= RELATIONSHIP_PENALTY.ENEMY
          break
        // default: no penalty (e.g., relationship = None)
      }
    }

    return priority
  }

  /**
   * Compute the combined selection priority for an actor incorporating pixel
   * distance from the click point to the actor's screen position.
   *
   * OpenRA 对照: SelectableExts.CalculateActorSelectionPriority()
   *
   * Formula: `(BaseSelectionPriority(modifiers) - pixelDistance) * 65536`
   *
   * **Key distinction from box-selection**: OpenRA's point-click priority
   * uses `ActorInfo.SelectionPriority()` which applies ONLY modifier boosts
   * (Ctrl/Alt), WITHOUT relationship penalties. Box-selection uses
   * `Actor.SelectionPriority()` which applies BOTH modifier boosts AND
   * relationship penalties (Ally -30, Neutral -60, Enemy -90).
   *
   * When `applyPenalty` is `true` (default, for backward compatibility),
   * relationship penalties are included. When `false` (used by
   * withHighestSelectionPriority for point-click), only modifier boosts
   * are applied — matching OpenRA's ActorInfo.SelectionPriority().
   *
   * **Important**: In C#, `-` has higher precedence than `<<`, so the
   * original `info.SelectionPriority(modifiers) - (long)pixelDistance << 16`
   * evaluates as `(priority - pixelDistance) << 16`. We use `* 65536`
   * (equivalent to `<< 16` without JavaScript's 32-bit integer truncation)
   * to produce the same result.
   *
   * @param actor — the actor to compute priority for
   * @param pixelDistance — distance from click point to this actor's screen
   *   projection center (pixels), computed per-actor by the caller
   * @param modifiers — current modifier key state
   * @param viewer — the viewer player (null to skip relationship penalty)
   * @param relationshipWith — relationship computation function
   * @param applyPenalty — whether to apply relationship penalties
   *   (false for point-click matching ActorInfo.SelectionPriority)
   * @returns combined priority (higher = more likely to be selected)
   */
  static calculateActorSelectionPriority(
    actor: SelectionActorInfo,
    pixelDistance: number,
    modifiers: SelectionModifiers,
    viewer: SelectionPlayerInfo | null,
    relationshipWith: (viewer: SelectionPlayerInfo, other: SelectionPlayerInfo) => number,
    applyPenalty: boolean = true,
  ): number {
    // Point-click: use ActorInfo.SelectionPriority → no relationship penalty
    // Box-select: use Actor.SelectionPriority → with relationship penalty
    // When applyPenalty=false, pass null viewer to skip the penalty check
    const effectiveViewer = applyPenalty ? viewer : null

    const basePriority = SelectionUtils.selectionPriority(
      actor,
      modifiers,
      effectiveViewer,
      relationshipWith,
    )
    // Formula: (basePriority - pixelDistance) * 65536
    // This matches OpenRA's C# operator precedence where `-` binds before `<<`.
    // Using * 65536 instead of << 16 avoids JavaScript's 32-bit integer
    // truncation on the << operator, preserving float precision for
    // sub-pixel distance differences.
    return (basePriority - pixelDistance) * PIXEL_DISTANCE_MULTIPLIER
  }

  // ---------------------------------------------------------------------------
  // Highest-priority selection helpers
  // ---------------------------------------------------------------------------

  /**
   * From a set of actors, select the one with the highest combined priority.
   *
   * OpenRA 对照: SelectableExts.WithHighestSelectionPriority()
   *
   * Uses `ActorInfo.SelectionPriority()` — NO relationship penalties applied.
   * This matches OpenRA's point-click behavior where `CalculateActorSelectionPriority`
   * calls the ActorInfo extension (modifier boost only), not the Actor extension
   * (which adds relationship penalties). Box-selection uses
   * `subsetWithHighestSelectionPriority()` which applies relationship penalties.
   *
   * Each actor's pixel distance from the click point is computed individually
   * via the `getPixelDistance` callback, matching OpenRA's per-ActorBoundsPair
   * distance calculation (center of bounding box → distance to selectionPixel).
   *
   * Uses single-pass linear scan (O(n), no allocation beyond the result
   * reference).
   *
   * @param actors — candidate actors (non-empty)
   * @param getPixelDistance — callback returning pixel distance from click
   *   point to each actor's screen projection center
   * @param modifiers — current modifier key state
   * @param viewer — the viewer player (for Ctrl/Alt boost; NOT for relationship penalty)
   * @param relationshipWith — relationship computation function (NOT used; point-click
   *   uses ActorInfo.SelectionPriority which excludes relationship penalties)
   * @returns the actor with the highest priority, or null if the set is empty
   */
  static withHighestSelectionPriority(
    actors: readonly SelectionActorInfo[],
    getPixelDistance: (actor: SelectionActorInfo) => number,
    modifiers: SelectionModifiers,
    viewer: SelectionPlayerInfo | null,
    relationshipWith: (viewer: SelectionPlayerInfo, other: SelectionPlayerInfo) => number,
  ): SelectionActorInfo | null {
    if (actors.length === 0) return null

    let best: SelectionActorInfo | null = null
    let bestPriority = -Infinity

    for (const actor of actors) {
      const priority = SelectionUtils.calculateActorSelectionPriority(
        actor,
        getPixelDistance(actor),
        modifiers,
        viewer,
        relationshipWith,
        false,  // applyPenalty=false: matches ActorInfo.SelectionPriority (no penalties)
      )
      if (priority > bestPriority) {
        bestPriority = priority
        best = actor
      }
    }

    return best
  }

  /**
   * From a set of actors, select the subset sharing the highest priority tier.
   *
   * OpenRA 对照: SelectableExts.SubsetWithHighestSelectionPriority()
   *
   * This is used for box selection: after filtering by owner/alliance,
   * actors are grouped by priority; only the highest-priority group is
   * returned. This prevents mixed-priority box selections (e.g., an infantry
   * and a building cannot be selected together unless Ctrl/Alt forces it).
   *
   * Algorithm:
   * 1. Compute selectionPriority (without pixel distance) for each actor
   * 2. Group by priority value
   * 3. Return the group with the highest priority
   *
   * @param actors — candidate actors
   * @param modifiers — current modifier key state
   * @param viewer — the viewer player
   * @param relationshipWith — relationship computation function
   * @returns the highest-priority subset; empty array if input is empty
   */
  static subsetWithHighestSelectionPriority(
    actors: readonly SelectionActorInfo[],
    modifiers: SelectionModifiers,
    viewer: SelectionPlayerInfo | null,
    relationshipWith: (viewer: SelectionPlayerInfo, other: SelectionPlayerInfo) => number,
  ): SelectionActorInfo[] {
    if (actors.length === 0) return []

    // Group by priority (using Map for O(n) performance)
    const groups = new Map<number, SelectionActorInfo[]>()
    let maxPriority = -Infinity

    for (const actor of actors) {
      const priority = SelectionUtils.selectionPriority(
        actor,
        modifiers,
        viewer,
        relationshipWith,
      )
      const group = groups.get(priority)
      if (group) {
        group.push(actor)
      } else {
        groups.set(priority, [actor])
      }
      if (priority > maxPriority) {
        maxPriority = priority
      }
    }

    // Return the highest-priority group
    return groups.get(maxPriority) ?? []
  }

  // ---------------------------------------------------------------------------
  // Player inclusion logic
  // ---------------------------------------------------------------------------

  /**
   * Determine which players should be included in selection.
   *
   * OpenRA 对照: SelectionUtils.GetPlayersToIncludeInSelection(World)
   *
   * Rules (matching OpenRA exactly):
   * 1. If there is no viewer (renderPlayer is null AND localPlayer is null),
   *    or shroud is disabled (renderPlayer is null and localPlayer is
   *    spectating): include ALL players (editor / no-shroud mode).
   * 2. If the viewer is a spectating non-combatant (observer): include ALL
   *    players (observer can select everyone's units).
   * 3. Otherwise: only the viewer's own players (self + allies managed by
   *    the caller; this method returns [viewer]).
   *
   * **NOTE**: OpenRA returns `{ viewer }` only. The caller (WICW) is
   * responsible for expanding this to allied players when appropriate.
   * In OpenRA, the caller checks `owner.IsAlliedWith(world.RenderPlayer)`
   * for each candidate actor. This method matches that pattern.
   *
   * @param world — the game world (partial interface)
   * @returns the array of players eligible for selection
   */
  static getPlayersToIncludeInSelection(
    world: SelectionWorldInfo,
  ): readonly SelectionPlayerInfo[] {
    const viewer = world.renderPlayer ?? world.localPlayer

    // No viewer — include everyone (editor mode)
    if (!viewer) {
      return world.players
    }

    // Shroud disabled: renderPlayer is null and localPlayer is spectating
    const isShroudDisabled =
      world.renderPlayer == null &&
      (world.localPlayer?.spectating === true)

    // Observer (spectating non-combatant) sees everyone
    const isEveryone =
      viewer.nonCombatant === true &&
      viewer.spectating === true

    if (isShroudDisabled || isEveryone) {
      return world.players
    }

    return [viewer]
  }

  // ---------------------------------------------------------------------------
  // Composite selection helpers (OpenRA SelectActorsOnScreen / SelectActorsInWorld)
  // ---------------------------------------------------------------------------

  /**
   * Select all actors on screen matching the given selection classes and
   * owned by eligible players.
   *
   * OpenRA 对照: SelectionUtils.SelectActorsOnScreen()
   *
   * In OpenRA, this uses ScreenMap.ActorsInMouseBox(Viewport.TopLeft,
   * Viewport.BottomRight). In the 3D migration, on-screen candidates are
   * provided by the caller (e.g., via frustum culling or camera.isInFrustum).
   * This method applies owner + selection-class filtering to the pre-filtered
   * list.
   *
   * @param onScreenCandidates — actors currently visible on screen (pre-filtered by caller)
   * @param selectionClasses — class filter; null = select all matching classes
   * @param eligiblePlayers — players eligible for selection (from getPlayersToIncludeInSelection)
   * @returns filtered actors in original order
   */
  static selectActorsOnScreen(
    onScreenCandidates: Iterable<SelectionActorInfo>,
    selectionClasses: readonly string[] | null,
    eligiblePlayers: readonly SelectionPlayerInfo[],
  ): SelectionActorInfo[] {
    return SelectionUtils.selectActorsByOwnerAndSelectionClass(
      onScreenCandidates,
      eligiblePlayers,
      selectionClasses,
    )
  }

  /**
   * Select all actors in the world matching the given selection classes and
   * owned by eligible players.
   *
   * OpenRA 对照: SelectionUtils.SelectActorsInWorld()
   *
   * Filters world actors by IsInWorld (pre-filtered), then by owner and
   * selection class.
   *
   * @param worldActors — all actors currently in the world
   * @param selectionClasses — class filter; null = select all matching classes
   * @param eligiblePlayers — players eligible for selection
   * @returns filtered actors
   */
  static selectActorsInWorld(
    worldActors: Iterable<SelectionActorInfo>,
    selectionClasses: readonly string[] | null,
    eligiblePlayers: readonly SelectionPlayerInfo[],
  ): SelectionActorInfo[] {
    return SelectionUtils.selectActorsByOwnerAndSelectionClass(
      worldActors,
      eligiblePlayers,
      selectionClasses,
    )
  }

  /**
   * Select the highest-priority actor under a screen point (deadzone-aware
   * degenerate case — the point is treated as a zero-area box).
   *
   * OpenRA 对照: SelectionUtils.SelectHighestPriorityActorAtPoint()
   *
   * In OpenRA, this uses ScreenMap.ActorsAtMouse(a). In the 3D migration,
   * the caller provides the set of actors hit by the raycast at the screen
   * point, along with a function to compute each actor's screen distance.
   *
   * ## Required pre-filters (OpenRA parity)
   *
   * OpenRA applies these filters before priority ranking. The caller MUST
   * ensure `candidates` already satisfies them:
   * 1. `HasTraitInfo<ISelectableInfo>()` — actor must have a selectable trait
   *    info. Callers should exclude actors without ISelectableInfo.
   * 2. `Owner.IsAlliedWith(RenderPlayer) || !FogObscures(actor)` — enemy
   *    actors hidden by fog are excluded. Since fog-of-war is TODO-3.G,
   *    FogObscures currently always returns false (all actors visible).
   *
   * @param candidates — actors at the screen point (from scene.pick / raycast),
   *   already filtered by HasTraitInfo<ISelectableInfo> and fog visibility
   * @param getPixelDistance — callback returning per-actor pixel distance
   *   from the click point to the actor's screen projection center
   * @param modifiers — current modifier key state
   * @param viewer — the viewer player (for relationship penalty)
   * @param relationshipWith — relationship computation function
   * @returns the highest-priority actor, or null if candidates is empty
   */
  static selectHighestPriorityActorAtPoint(
    candidates: readonly SelectionActorInfo[],
    getPixelDistance: (actor: SelectionActorInfo) => number,
    modifiers: SelectionModifiers,
    viewer: SelectionPlayerInfo | null,
    relationshipWith: (viewer: SelectionPlayerInfo, other: SelectionPlayerInfo) => number,
  ): SelectionActorInfo | null {
    return SelectionUtils.withHighestSelectionPriority(
      candidates,
      getPixelDistance,
      modifiers,
      viewer,
      relationshipWith,
    )
  }

  /**
   * Select actors within a screen-space box, with deadzone handling.
   *
   * OpenRA 对照: SelectionUtils.SelectActorsInBoxWithDeadzone()
   *
   * Deadzone logic:
   * - If the diagonal of the box is <= deadzone: shrink box to a point
   *   (the end point becomes both corners).
   * - If start == end (zero-area box): delegate to
   *   selectHighestPriorityActorAtPoint() using fallbackCandidates.
   * - Otherwise: filter boxCandidates by subsetWithHighestSelectionPriority().
   *
   * ## Required pre-filters (OpenRA parity)
   *
   * OpenRA applies these filters before priority ranking. The caller MUST
   * ensure both `boxCandidates` and `fallbackCandidates` already satisfy:
   * 1. `HasTraitInfo<ISelectableInfo>()` — only actors with selectable info
   *    are eligible. Actors without this trait info should be excluded.
   * 2. `Owner.IsAlliedWith(RenderPlayer) || !FogObscures(actor)` — enemy
   *    actors hidden by fog are excluded. FogObscures is TODO-3.G
   *    (fog-of-war not yet migrated; currently all actors are visible).
   *
   * In the 3D migration:
   * - `boxCandidates` is the set of actors whose bounding boxes intersect
   *   the frustum constructed from the 4 corners of the screen rectangle.
   *   This frustum construction is done by the caller (WICW).
   * - `getPixelDistance` for the point-fallback case is computed per-actor
   *   by the caller from screen coordinates to actor screen projections.
   *
   * @param boxStart — one corner of the selection box (screen pixels)
   * @param boxEnd — opposite corner of the selection box (screen pixels)
   * @param deadzone — minimum drag distance in pixels (default 4)
   * @param boxCandidates — all actors in the box frustum, pre-filtered
   *   by ISelectableInfo and fog visibility
   * @param fallbackCandidates — actors at the fallback point (for degenerate
   *   box), pre-filtered by ISelectableInfo and fog visibility
   * @param getPixelDistance — callback returning per-actor pixel distance
   *   for the point-fallback case
   * @param modifiers — current modifier key state
   * @param viewer — the viewer player
   * @param relationshipWith — relationship computation function
   * @returns selected actors
   */
  static selectActorsInBoxWithDeadzone(
    boxStart: { x: number; y: number },
    boxEnd: { x: number; y: number },
    deadzone: number,
    boxCandidates: readonly SelectionActorInfo[],
    fallbackCandidates: readonly SelectionActorInfo[],
    getPixelDistance: (actor: SelectionActorInfo) => number,
    modifiers: SelectionModifiers,
    viewer: SelectionPlayerInfo | null,
    relationshipWith: (viewer: SelectionPlayerInfo, other: SelectionPlayerInfo) => number,
  ): SelectionActorInfo[] {
    // Shrink box if below deadzone
    const dx = boxStart.x - boxEnd.x
    const dy = boxStart.y - boxEnd.y
    const diagonal = Math.sqrt(dx * dx + dy * dy)

    let effectiveStart = boxStart
    if (diagonal <= deadzone) {
      // Shrink to a single point at boxEnd
      effectiveStart = boxEnd
    }

    // Zero-area box: delegate to point selection
    if (effectiveStart.x === boxEnd.x && effectiveStart.y === boxEnd.y) {
      const best = SelectionUtils.selectHighestPriorityActorAtPoint(
        fallbackCandidates,
        getPixelDistance,
        modifiers,
        viewer,
        relationshipWith,
      )
      return best ? [best] : []
    }

    // Box selection: subset by highest priority tier
    return SelectionUtils.subsetWithHighestSelectionPriority(
      boxCandidates,
      modifiers,
      viewer,
      relationshipWith,
    )
  }

  // ---------------------------------------------------------------------------
  // Utility: relationship helpers
  // ---------------------------------------------------------------------------

  /**
   * Default relationship computation using PlayerRelationship bitmask values.
   *
   * OpenRA 对照: PlayerRelationship enum + Player.RelationshipWith()
   *
   * This is a convenience wrapper that callers can use when their player
   * objects implement the standard PlayerRelationship bitmask protocol.
   *
   * @param viewer — the viewer player
   * @param other — the other player
   * @returns the relationship bits (1=Enemy, 2=Neutral, 4=Ally)
   */
  static defaultRelationshipWith(
    _viewer: SelectionPlayerInfo,
    _other: SelectionPlayerInfo,
  ): number {
    // Default: treat non-owner as neutral for selection priority.
    // Callers should override this with their actual diplomacy system
    // (Player.relationshipWith() which uses LongBitSet player masks).
    // This default is provided for environments where full Player objects
    // are not available (e.g., unit tests with stubs).
    //
    // OpenRA 对照: Player.RelationshipWith(Player)
    //
    // In OpenRA, the relationship is: Ally (self == owner, or allied),
    // Neutral (non-combatant), or Enemy (at war).
    // The default here assumes non-self = Neutral, which is a safe fallback
    // for priority computation (Ally penalty for non-self would be too small).
    return 2   // Neutral
  }
}
