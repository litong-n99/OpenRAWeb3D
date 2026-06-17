# Chapter 19 Phase A — Architecture Design for HIGH-Complexity Files

> **Date**: 2026-06-17
> **Architect**: migration-architect
> **Status**: DESIGN (pending Team Lead review)
> **Prerequisite**: Chapters 2-18 COMPLETE (484/484, 100%)

---

## Table of Contents

1. [ChronoshiftPower (TODO-19.A.4)](#1-chronoshiftpower-todo-19a4)
2. [Disguise (TODO-19.A.28)](#2-disguise-todo-19a28)
3. [TSVeinsRenderer (TODO-19.A.42)](#3-tsveinsrenderer-todo-19a42)

---

## 1. ChronoshiftPower (TODO-19.A.4)

### 1.1 Source & Target

| | |
|---|---|
| **OpenRA C# source** | `OpenRA/OpenRA.Mods.Cnc/Traits/SupportPowers/ChronoshiftPower.cs` (394 lines) |
| **TypeScript target** | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/ChronoshiftPower.ts` |
| **Test target** | `src/OpenRA.Mods.Cnc/Traits/SupportPowers/ChronoshiftPower.test.ts` |
| **Migration plan ref** | TODO-19.A.4 |
| **Complexity** | HIGH |

### 1.2 Class Hierarchy

```
ConditionalTrait<TInfo>                         (Ch3: TraitsInterfaces.ts:2891)
  └── SupportPower                               (Ch13: SupportPower.ts:313)
        └── ChronoshiftPower                     ← THIS FILE
              ├── inner class: SelectChronoshiftTarget extends OrderGenerator  (Ch15)
              └── inner class: SelectDestination extends OrderGenerator        (Ch15)
```

**Interfaces implemented** (via `SelectChronoshiftTarget` / `SelectDestination` inner `OrderGenerator` classes): `IOrderGenerator`

**Info class**: `ChronoshiftPowerInfo extends SupportPowerInfo`

### 1.3 Key Properties (ChronoshiftPowerInfo)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Dimensions` | `CVec` | **required** | Size of affected area footprint |
| `Footprint` | `string` | **required** | Actual footprint pattern; cells marked 'x' are affected |
| `Duration` | `number` | 750 | Ticks until auto-return after teleport |
| `TargetOverlayPalette` | `string` | `"terrain"` | Palette for footprint overlay |
| `FootprintImage` | `string` | `"overlay"` | Sequence image for footprint sprites |
| `ValidFootprintSequence` | `string` | `"target-valid"` | Sequence for valid destination tiles |
| `InvalidFootprintSequence` | `string` | `"target-invalid"` | Sequence for invalid destination tiles |
| `SourceFootprintSequence` | `string` | `"target-select"` | Sequence for source selection tiles |
| `KillCargo` | `boolean` | `true` | Whether passengers die on teleport |
| `SelectionCursor` | `string` | `"chrono-select"` | Cursor during area selection |
| `TargetCursor` | `string` | `"chrono-target"` | Cursor when targeting valid area |
| `TargetBlockedCursor` | `string` | `"move-blocked"` | Cursor when targeting blocked area |

### 1.4 Key Methods

#### 1.4.1 `ChronoshiftPower.selectTarget(self, order, manager)` — Override SupportPower

```
PSEUDOCODE:
selectTarget(self: IGameActor, order: string, manager: SupportPowerManager):
    self.world.orderGenerator = new SelectChronoshiftTarget(self.world, order, manager, this)
```

Sets an `OrderGenerator` that intercepts mouse input for the two-stage chronoshift targeting.

#### 1.4.2 `ChronoshiftPower.activate(self, order, manager)` — Override SupportPower

```
PSEUDOCODE:
activate(self: IGameActor, order: Order, manager: SupportPowerManager):
    super.activate(self, order, manager)          // base class: charge, notification
    this.playLaunchSounds()
    info = this.info as ChronoshiftPowerInfo
    targetDelta = self.world.map.cellContaining(order.target.centerPosition) - order.extraLocation
    for each target in this.unitsInRange(order.extraLocation):
        cs = target.traitsImplementing(Chronoshiftable).firstEnabledConditionalTraitOrDefault()
        if cs == null: continue
        targetCell = target.location + targetDelta
        if self.owner.shroud.isExplored(targetCell) AND cs.canChronoshiftTo(target, targetCell):
            cs.teleport(target, targetCell, info.duration, info.killCargo, self)
```

This is the main activation logic. It exists as a concrete `SupportPower`:
1. Calls base `Activate` for charge management and notifications.
2. Extracts the `sourceLocation` from `order.ExtraLocation`.
3. Calculates `targetDelta = clickCell - sourceLocation`.
4. For each Chronoshiftable unit within the footprint at `sourceLocation`, teleports to `unit.Location + targetDelta` using the deferred-action pattern.

**Deferred-action pattern (ADR-19.5)**: The teleport is queued via `cs.Teleport()` which internally calls `self.QueueActivity(new Teleport(...))`. The actual position mutation happens when the `Teleport` activity executes at end-of-tick, preventing mid-tick state cascade.

#### 1.4.3 `ChronoshiftPower.unitsInRange(xy)` — Determine affected units

```
PSEUDOCODE:
unitsInRange(xy: CPos): IGameActor[]
    tiles = cellsMatching(xy, footprint, dimensions)   // inherited from SupportPower
    units = new Set<IGameActor>()
    for each t in tiles:
        units.addAll(self.world.actorMap.getActorsAt(t))
    return units.filter(a => a.traitsImplementing(Chronoshiftable).any(cs => !cs.isTraitDisabled))
```

Collects all actors whose footprint overlaps the chronoshift area AND have an enabled `Chronoshiftable` trait.

#### 1.4.4 `ChronoshiftPower.similarTerrain(xy, sourceLocation)` — Terrain validation

```
PSEUDOCODE:
similarTerrain(xy: CPos, sourceLocation: CPos): boolean
    if !self.owner.shroud.isExplored(xy): return false
    sourceTiles = cellsMatching(sourceLocation, footprint, dimensions)
    destTiles = cellsMatching(xy, footprint, dimensions)
    if sourceTiles is empty or destTiles is empty: return false
    iterate paired (source, dest):
        if !self.owner.shroud.isExplored(source) or !self.owner.shroud.isExplored(dest): return false
        if self.world.map.getTerrainIndex(source) != self.world.map.getTerrainIndex(dest): return false
    return true
```

Validates that source and destination cells have the same terrain type. This allows chronoshifting to empty terrain of matching type (alerting the player to enemy unit presence via cursor change without revealing fog).

#### 1.4.5 `SelectChronoshiftTarget` (inner class `OrderGenerator`)

Two-stage target selection: first click selects the source area, second click selects the destination.

**Stage 1 — `SelectChronoshiftTarget.OrderInner()`**:
```
PSEUDOCODE:
OrderInner(world, cell, worldPixel, mi):
    world.cancelInputMode()
    world.orderGenerator = new SelectDestination(world, order, manager, power, cell)
    yield break  // no order produced yet; transitions to stage 2
```

**Stage 1 — `SelectChronoshiftTarget.Render()`**: Renders the footprint overlay tiles at mouse position + selection annotations (red box) on units in range.

**Stage 1 — `SelectChronoshiftTarget.GetCursor()`**: Returns `SelectionCursor`.

#### 1.4.6 `SelectDestination` (inner class `OrderGenerator`)

**Stage 2 — `SelectDestination.OrderInner()`**:
```
PSEUDOCODE:
OrderInner(world, cell, worldPixel, mi):
    ret = OrderInner(cell).firstOrDefault()
    if ret == null: yield break
    world.cancelInputMode()
    yield ret

OrderInner(xy: CPos):
    if isValidTarget(xy):
        yield new Order(order, manager.self, Target.fromCell(manager.self.world, xy), false) {
            extraLocation = sourceLocation,
            suppressVisualFeedback = true
        }
```

**Stage 2 — `SelectDestination.RenderAboveShroud()`**: Renders:
- Destination footprint tiles at `sourceLocation + (mouse - sourceLocation)` with valid/invalid tinting
- Unit previews: each unit in the source area is rendered at its projected destination position, showing whether it can chronoshift there
- Offset rendering: `unit.Render(wr).offsetBy(offset)`

**Stage 2 — `SelectDestination.Render()`**: Renders only the source footprint tiles (without offset).

**Stage 2 — `SelectDestination.isValidTarget(xy)`**:
```
PSEUDOCODE:
isValidTarget(xy: CPos): boolean
    canTeleport = false
    anyUnitsInRange = false
    for each unit in unitsInRange(sourceLocation):
        anyUnitsInRange = true
        targetCell = unit.location + (xy - sourceLocation)
        if shroud.isExplored(targetCell) AND unit.trait(Chronoshiftable).canChronoshiftTo(unit, targetCell):
            canTeleport = true; break
    if !anyUnitsInRange: return false
    if !canTeleport:
        canTeleport = similarTerrain(sourceLocation, xy)
    return canTeleport
```

**Stage 2 — `SelectDestination.GetCursor()`**: Returns `TargetCursor` if valid, else `TargetBlockedCursor`.

### 1.5 Dependencies

| Import | Source Path | Status |
|--------|------------|--------|
| `SupportPower`, `SupportPowerInfo`, `OrderStub`, `TargetStub` | `../../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js` | COMPLETE (Ch13) |
| `ConditionalTrait` | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `CPos` | `../../../../OpenRA.Game/CPos.js` | COMPLETE (Ch3) |
| `CVec` | `../../../../OpenRA.Game/CVec.js` | COMPLETE (Ch3) |
| `OrderGenerator`, `IOrderGenerator` | `../../../../OpenRA.Mods.Common/Orders/OrderGenerator.js` | COMPLETE (Ch15) |
| `ISpriteSequence`, `Sprite` | `../../../../OpenRA.Game/Graphics/Sprite.js` | COMPLETE (Ch2) |
| `WorldRenderer` (stub for sprite rendering) | `../../../../OpenRA.Game/Graphics/WorldRenderer.js` | COMPLETE (Ch2) |
| `IResourceLayer` | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `SupportPowerManager` (forward ref) | `../../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPowerManager.js` | COMPLETE (Ch13) |
| `Chronoshiftable` (forward ref) | `../../Chronoshiftable.js` | **TODO-19.A.1 (BLOCKING)** |
| `Viewport` (for `ViewToWorld`) | `../../../../OpenRA.Game/Graphics/Viewport.js` | COMPLETE (Ch7) |
| `ISelectionDecorations` | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `PaletteReference` | `../../../../OpenRA.Game/Graphics/PaletteReference.js` | COMPLETE (Ch2) |

### 1.6 TypeScript Paradigm Mapping

| C# Pattern | TypeScript / Babylon.js Equivalent |
|-----------|-----------------------------------|
| `sealed class ChronoshiftPower : SupportPower` | `class ChronoshiftPower extends SupportPower` |
| `sealed class SelectChronoshiftTarget : OrderGenerator` | Inner class extending `OrderGenerator` (exported separately for testability) |
| `SpriteRenderable(tile, center, WVec.Zero, -511, palette, 1f, alpha, float3.Ones, TintModifiers.IgnoreWorldTint, true)` | `new SpriteRenderable({ sprite: tile, pos: center, offset: WVec.zero, zOffset: -511, palette, scale: 1, alpha, tint: Float3.ones, tintModifiers: TintModifiers.IgnoreWorldTint, isDecoration: true })` |
| `IEnumerable<IRenderable> yield return` | Generator functions: `*Render(wr, world): Generator<IRenderable>` |
| `wr.Viewport.ViewToWorld(Viewport.LastMousePos)` | `wr.viewport.viewToWorld(Viewport.lastMousePos)` |
| `self.World.Map.CellContaining(pos)` | `self.world.map.cellContaining(pos)` |
| `Target.FromCell(world, xy)` | `Target.fromCell(world, xy)` (static factory from Ch6) |
| `world.OrderGenerator = new SelectChronoshiftTarget(...)` | `world.setOrderGenerator(new SelectChronoshiftTarget(...))` |
| `FieldLoader.Require` attribute | `ChronoshiftPowerInfo` constructor validates required fields |
| `PaletteReference` attribute | `string` type with JSDoc `@PaletteReference` annotation |
| `SequenceReference(nameof(FootprintImage), prefix: true)` | `string` type with JSDoc `@SequenceReference` annotation |
| `CursorReference` attribute | `string` type with JSDoc `@CursorReference` annotation |

### 1.7 Test Strategy

**Unit Tests** (~40 expected):

1. **Info validation**: Verify `ChronoshiftPowerInfo` constructs with all required/default fields; `Dimensions` and `Footprint` are required.
2. **footprint parsing**: Test `Footprint` string parsing — whitespace removal, 'x' cell positions extracted correctly.
3. **selectTarget()**: Verify `OrderGenerator` is set to `SelectChronoshiftTarget` instance.
4. **unitsInRange()**: Mock `World.ActorMap` with actors at various cells in/out of footprint. Verify only actors with enabled `Chronoshiftable` trait are returned.
5. **activate()**: Verify correct teleport dispatch:
   - Each `Chronoshiftable` unit in range receives `teleport()` call with correct `targetCell = unit.Location + delta`
   - `killCargo` and `duration` propagated from info
   - Units without `Chronoshiftable` are skipped
6. **similarTerrain()**: Mock `World.Map` with various terrain indices. Verify matching/different terrain returns true/false. Verify unexplored cells return false.
7. **SelectChronoshiftTarget.OrderInner()**: Verify transitions to `SelectDestination` with correct `sourceLocation`.
8. **SelectChronoshiftTarget.Render()**: Verify footprint sprites rendered at mouse position tiles.
9. **SelectDestination.OrderInner()**: Verify returns `Order` with `extraLocation = sourceLocation` when valid.
10. **SelectDestination.isValidTarget()**: Test empty unit range (false), valid unit teleport (true), terrain-only valid (true into empty matched terrain), all blocked (false).
11. **SelectDestination.RenderAboveShroud()**: Verify both destination overlay + unit preview offset rendering.
12. **Tick cancellation**: Verify `OrderGenerator` cancels when power is no longer ready/active.

**Mocks Required**:
- `SupportPowerManager` with `powers` map and ready/active flags
- `World` with `Map`, `Shroud`, `ActorMap`, `OrderGenerator` setter
- `Chronoshiftable` trait on actors
- `WorldRenderer` with `Viewport`, `Palette()`
- `ISpriteSequence` with `GetSprite(0)` and `GetAlpha(0)`
- `Viewport` with `lastMousePos` and `viewToWorld()`

**Edge Cases to Test**:
- Empty footprint (no units selected)
- All units have disabled `Chronoshiftable` (none teleported)
- Target outside explored shroud area
- Terrain mismatch between source and destination
- `KillCargo = false` (passengers survive teleport)
- `sourceLocation === destinationCell` (no-op shift, 0 delta)

### 1.8 Things to Watch Out For

- The `SelectDestination`'s `RenderAboveShroud` performs **dual rendering**: destination overlay (static tiles at projected position) + unit preview (each source unit rendered at destination with offset). These are in two separate loops and must not be confused.
- `OrderInner` in `SelectDestination` checks `isValidTarget` which has a two-fallback: unit-can-teleport? OR terrain-match?. If no units in range at all, it returns false even if terrain matches — this prevents ghost-chronos.
- Tileset-specific sequence lookup: `ValidFootprintSequence + "-" + world.Map.Tileset.ToLowerInvariant()` must fall back to base sequence if tileset variant doesn't exist.
- The `SuppressVisualFeedback = true` flag in the returned order prevents duplicate visual feedback from the order system.

### 1.9 Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| Radar ping on activation | Requires Ch16 RadarWidget | TODO-16.X |
| Beacon display at destination | Requires Ch16 BeaconWidget | TODO-16.X |
| Full audio integration | `PlayLaunchSounds()` is stubbed | Ch7 Phase D |
| ChronoshiftPostProcessEffect (palette shift post-FX) | Separate file (TODO-19.A.5), low pri | TODO-19.A.5 |

### 1.10 Acceptance Criteria

- [ ] All public members from OpenRA `ChronoshiftPower` + inner `SelectChronoshiftTarget` + `SelectDestination` accounted for
- [ ] Unit tests pass (`npx vitest run`) with coverage for every public method
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] Generator functions for `Render()`, `RenderAboveShroud()`, `RenderAnnotations()` yielding `IRenderable`
- [ ] Deferred-action pattern properly documented (ADR-19.5)

---

## 2. Disguise (TODO-19.A.28)

### 2.1 Source & Target

| | |
|---|---|
| **OpenRA C# source** | `OpenRA/OpenRA.Mods.Cnc/Traits/Disguise.cs` (335 lines) |
| **TypeScript target** | `src/OpenRA.Mods.Cnc/Traits/Disguise.ts` |
| **Test target** | `src/OpenRA.Mods.Cnc/Traits/Disguise.test.ts` |
| **Migration plan ref** | TODO-19.A.28 |
| **Complexity** | HIGH |

### 2.2 Class Hierarchy

The OpenRA file contains **four** classes:

```
Component                                      (Ch3)
  └── ConditionalTrait<TInfo>
        ├── DisguiseTooltip : ConditionalTrait<DisguiseTooltipInfo>, ITooltip
        │     └── (requires Disguise, provides spoofed tooltip/owner)
        └── [NOT inherited] Disguise : IEffectiveOwner, IIssueOrder, IResolveOrder, IOrderVoice, INotifyAttack, INotifyDamage, INotifyLoadCargo, INotifyUnloadCargo, INotifyDemolition, INotifyInfiltration, ITick
              └── (core disguise logic — NOT a ConditionalTrait, does NOT extend it)

UnitOrderTargeter                               (Ch15)
  └── DisguiseOrderTargeter : UnitOrderTargeter
        └── (target validation for Disguise order)

TraitInfo                                       (Ch3)
  └── TooltipInfo
        └── DisguiseTooltipInfo : TooltipInfo, Requires<DisguiseInfo>
              └── (info for DisguiseTooltip)
  └── DisguiseInfo : TraitInfo
        └── (info for Disguise)
```

### 2.3 Key Properties

#### DisguiseInfo

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Voice` | `string` | `"Action"` | Voice response when disguise order issued |
| `DisguisedCondition` | `string` | `null` | Condition granted to self while disguised |
| `ValidRelationships` | `PlayerRelationship` | `Ally \| Neutral \| Enemy` | Valid relationships for disguise targets |
| `TargetTypes` | `BitSet<TargetableType>` | `new("Disguise")` | Target types valid for disguise |
| `RevealDisguiseOn` | `RevealDisguiseType` | `Attack` | Flags controlling what reveals disguise |
| `DisguisedAsConditions` | `FrozenDictionary<string,string>` | `Empty` | Per-actor-type conditions granted while disguised |
| `Cursor` | `string` | `"ability"` | Cursor when hovering valid disguise target |

#### RevealDisguiseType (Flags enum)

```typescript
enum RevealDisguiseType {
  None        = 0,
  Attack      = 1,
  Damaged     = 2,
  Load        = 4,
  Unload      = 8,
  Infiltrate  = 16,
  Demolish    = 32,
  Move        = 64,
}
```

#### Disguise (class properties)

| Property | Type | Description |
|----------|------|-------------|
| `AsActor` | `ActorInfo` | The actor info being impersonated |
| `AsPlayer` | `Player` | The player being impersonated |
| `AsTooltipInfo` | `ITooltipInfo` | The tooltip info of the impersonated actor |
| `Disguised` | `boolean` (get) | `AsPlayer !== null` |
| `Owner` | `Player` (get) | `AsPlayer` (for `IEffectiveOwner`) |

### 2.4 Key Methods

#### 2.4.1 `Disguise.disguiseAs(target: IGameActor | null)` — Core disguise logic

```
PSEUDOCODE:
disguiseAs(target: IGameActor | null):
    oldEffectiveActor = AsActor
    oldEffectiveOwner = AsPlayer
    oldDisguiseSetting = Disguised

    if target != null:
        targetDisguise = target.traitOrDefault(Disguise)
        if targetDisguise != null AND targetDisguise.disguised:
            // Chain-of-disguise: if target itself is disguised, impersonate target's disguise
            if targetDisguise.AsActor.name == self.info.name AND targetDisguise.AsPlayer == self.owner:
                // Don't disguise as yourself
                AsTooltipInfo = null; AsPlayer = null; AsActor = self.info
            else:
                AsPlayer = targetDisguise.AsPlayer
                AsActor = targetDisguise.AsActor
                AsTooltipInfo = targetDisguise.AsTooltipInfo
        else:
            if target.info.name == self.info.name AND target.owner == self.owner:
                // Don't disguise as yourself
                AsTooltipInfo = null; AsPlayer = null; AsActor = self.info
            else:
                tooltip = target.traitsImplementing(ITooltip).firstEnabledTraitOrDefault()
                if tooltip == null: throw new ArgumentException("Missing tooltip or invalid target")
                AsPlayer = tooltip.owner
                AsActor = target.info
                AsTooltipInfo = tooltip.tooltipInfo
    else:
        // target == null → undisguise (reveal true identity)
        AsTooltipInfo = null; AsPlayer = null; AsActor = self.info

    handleDisguise(oldEffectiveActor, oldEffectiveOwner, oldDisguiseSetting)
```

#### 2.4.2 `Disguise.disguiseAs(actorInfo, newOwner)` — Disguise from frozen actor

```
PSEUDOCODE:
disguiseAs(actorInfo: ActorInfo, newOwner: Player):
    oldEffectiveActor = AsActor; oldEffectiveOwner = AsPlayer; oldDisguiseSetting = Disguised
    AsPlayer = newOwner
    AsActor = actorInfo
    AsTooltipInfo = actorInfo.traitInfos(TooltipInfo).firstOrDefault(info => info.enabledByDefault)
    handleDisguise(oldEffectiveActor, oldEffectiveOwner, oldDisguiseSetting)
```

#### 2.4.3 `Disguise.handleDisguise(oldActor, oldOwner, oldDisguised)` — Condition + notification dispatch

```
PSEUDOCODE:
handleDisguise(oldEffectiveActor: ActorInfo, oldEffectiveOwner: Player, oldDisguiseSetting: boolean):
    // Notify all INotifyEffectiveOwnerChanged traits
    for each t in self.traitsImplementing(INotifyEffectiveOwnerChanged):
        t.onEffectiveOwnerChanged(self, oldEffectiveOwner, AsPlayer)

    // Grant/revoke DisguisedCondition
    if Disguised != oldDisguiseSetting:
        if Disguised AND disguisedToken == INVALID:
            disguisedToken = self.grantCondition(info.disguisedCondition)
        else if !Disguised AND disguisedToken != INVALID:
            disguisedToken = self.revokeCondition(disguisedToken)

    // Grant/revoke actor-specific conditions
    if AsActor != oldEffectiveActor:
        if disguisedAsToken != INVALID:
            disguisedAsToken = self.revokeCondition(disguisedAsToken)
        if info.disguisedAsConditions.has(AsActor.name):
            disguisedAsToken = self.grantCondition(info.disguisedAsConditions.get(AsActor.name))
```

#### 2.4.4 `Disguise` reveal-on-event handlers

Each handler checks `info.revealDisguiseOn.hasFlag(RevealDisguiseType.X)` and if true, calls `disguiseAs(null)`:

- **`INotifyAttack.attacking()`**: Reveal on `Attack` flag
- **`INotifyDamage.damaged()`**: Reveal on `Damaged` flag, only if `e.Damage.Value > 0`
- **`INotifyLoadCargo.loading()`**: Reveal on `Load` flag
- **`INotifyUnloadCargo.unloading()`**: Reveal on `Unload` flag
- **`INotifyDemolition.demolishing()`**: Reveal on `Demolish` flag
- **`INotifyInfiltration.infiltrating()`**: Reveal on `Infiltrate` flag
- **`ITick.tick()`**: Reveal on `Move` flag, when `lastPos != self.Location`

#### 2.4.5 `Disguise` order interface (`IIssueOrder` / `IResolveOrder`)

```
PSEUDOCODE:
// IIssueOrder.Orders (getter): yield new DisguiseOrderTargeter(info)
// IIssueOrder.issueOrder(): return new Order("Disguise", self, target, queued)

// IResolveOrder.resolveOrder:
if order.orderString == "Disguise":
    if target.type == TargetType.Actor:
        disguiseAs((target.actor != self AND target.actor.isInWorld) ? target.actor : null)
    if target.type == TargetType.FrozenActor:
        disguiseAs(target.frozenActor.info, target.frozenActor.owner)
```

#### 2.4.6 `DisguiseTooltip` (spoofed tooltip)

```
PSEUDOCODE:
class DisguiseTooltip extends ConditionalTrait<DisguiseTooltipInfo> implements ITooltip:
    get tooltipInfo(): return disguise.disguised ? disguise.AsTooltipInfo : this.info
    get owner():
        if !disguise.disguised OR self.owner.isAlliedWith(self.world.renderPlayer):
            return self.owner
        return disguise.AsPlayer
```

#### 2.4.7 `DisguiseOrderTargeter` (target validation)

```
PSEUDOCODE:
class DisguiseOrderTargeter extends UnitOrderTargeter("Disguise", 7, info.Cursor, true, true):
    canTargetActor(self, target, modifiers, ref cursor):
        relationship = self.owner.relationshipWith(target.owner)
        if !info.validRelationships.hasRelationship(relationship): return false
        if target == self: return false
        return info.targetTypes.overlaps(target.getAllTargetTypes())

    canTargetFrozenActor(self, target, modifiers, ref cursor):
        relationship = self.owner.relationshipWith(target.owner)
        if !info.validRelationships.hasRelationship(relationship): return false
        return info.targetTypes.overlaps(target.info.getAllTargetTypes())
```

### 2.5 Dependencies

| Import | Source Path | Status |
|--------|------------|--------|
| `ConditionalTrait`, `ConditionalTraitInfo` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `ITooltip`, `ITooltipInfo` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `IEffectiveOwner` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `INotifyEffectiveOwnerChanged` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `INotifyAttack`, `INotifyDamage`, `INotifyLoadCargo`, `INotifyUnloadCargo`, `INotifyDemolition`, `INotifyInfiltration` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3, Ch8) |
| `ITick`, `IIssueOrder`, `IResolveOrder`, `IOrderVoice` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3, Ch6) |
| `PlayerRelationship` | `../../../OpenRA.Mods.Common/Traits/Player/PlayerRelationship.js` | COMPLETE (Ch3) |
| `BitSet<TargetableType>` | `../../../OpenRA.Game/Primitives/BitSet.js` | COMPLETE (Ch3) |
| `TargetableType` | `../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `UnitOrderTargeter`, `IOrderTargeter` | `../../../OpenRA.Mods.Common/Orders/UnitOrderTargeter.js` | COMPLETE (Ch15) |
| `Order` | `../../../OpenRA.Game/Network/Order.js` | COMPLETE (Ch6) |
| `Target`, `TargetType` | `../../../OpenRA.Game/Network/Target.js` | COMPLETE (Ch6) |
| `ActorInfo`, `TraitInfo` | `../../../OpenRA.Game/GameRules/ActorInfo.js` | COMPLETE (Ch3) |
| `Player` (stub) | `../../../OpenRA.Game/Player.js` | COMPLETE (Ch3) |
| `TooltipInfo` | `../../../OpenRA.Mods.Common/Traits/Tooltip.js` | COMPLETE (Ch3) |

### 2.6 TypeScript Paradigm Mapping

| C# Pattern | TypeScript / Babylon.js Equivalent |
|-----------|-----------------------------------|
| `sealed class Disguise : IEffectiveOwner, IIssueOrder, ...` | `class Disguise implements IEffectiveOwner, IIssueOrder, ...` |
| `Disguise` does NOT extend `ConditionalTrait` (uses raw condition management) | Same: plain class with `disguisedToken`/`disguisedAsToken` stored as `number`/symbol |
| `public ActorInfo AsActor { get; private set; }` | `asActor: ActorInfo` (readonly from outside via getter pattern) |
| `public bool Disguised => AsPlayer != null;` | `get disguised(): boolean { return this._asPlayer !== null }` |
| `FrozenDictionary<string, string>` | `ReadonlyMap<string, string>` (or `Record<string, string>`) |
| `[Flags] enum RevealDisguiseType` | TypeScript numeric enum with bitwise flag values |
| `HasFlag(RevealDisguiseType.Attack)` | `(this._revealOn & RevealDisguiseType.Attack) !== 0` |
| `INotifyAttack.Attacking(self, target, a, b)` | `onAttack(self: IGameActor, target: Target, armament: Armament, barrel: Barrel): void` |
| `self.GrantCondition(info.DisguisedCondition)` | `self.conditionManager.grantCondition(info.disguisedCondition)` (via `ConditionManager`) |
| `self.Trait<Disguise>()` | `self.getTrait(Disguise)` (runtime trait lookup, same pattern as Ch3) |
| `INotifyEffectiveOwnerChanged` callback | Same pattern: iterate actors, call `onEffectiveOwnerChanged()` |
| `new ArgumentException(...)` | `throw new Error(...)` |

**3D paradigm shift — mesh swapping for disguise visual**:

| C# Pattern | Babylon.js / 3D Equivalent |
|-----------|---------------------------|
| Sprite/palette swap for disguise | Swap the actor's `Mesh` / `TransformNode` children to the disguised actor's mesh hierarchy |
| Disguise broken = restore real sprites | Swap back to the real actor's mesh hierarchy |
| `RenderSprites` shows disguised sprite | `TransformNode` parenting: detach real mesh, attach disguised mesh |
| Not our own actor → not rendering our sprite | Disguised mesh is reference to glTF asset pre-loaded from `disguisedAsActor`'s model |

**ADR-19.5 (Deferred-Action for Identity Swap)**: The mesh swap is queued via `AddFrameEndTask` — it happens after all `tick()` calls, preventing mid-tick inconsistent rendering where half the system sees the disguised actor and half sees the real one.

### 2.7 Test Strategy

**Unit Tests** (~35 expected):

1. **DisguiseInfo construction**: Verify defaults (`Voice`, `TargetTypes`, `RevealDisguiseOn`, `Cursor`)
2. **disguiseAs(actor)**: Core disguise test:
   - Target with different actor type + different owner → `AsActor`, `AsPlayer`, `AsTooltipInfo` set correctly
   - Target with same actor type + same owner → no disguise applied (stays as self)
   - Target that is itself disguised → chain-of-disguise applied (spy B disguised as spy A's disguise)
   - Target without `ITooltip` → throws error
   - `null` target → undisguise (clears `AsPlayer`, restores `AsActor = self.info`)
3. **disguiseAs(actorInfo, owner)**: Frozen actor disguise test
4. **handleDisguise**: Condition grant/revoke:
   - `Disguised` transitions from false→true → `disguisedCondition` granted
   - `Disguised` transitions from true→false → `disguisedCondition` revoked
   - `AsActor` changes → old `disguisedAsToken` revoked, new one granted (if in `DisguisedAsConditions`)
   - `INotifyEffectiveOwnerChanged` fired on change
5. **Reveal-on-Event**: Each `RevealDisguiseType` flag:
   - `Attack` → attacking reveals
   - `Damaged` → damage > 0 reveals
   - `Load` → loading cargo reveals
   - `Unload` → unloading reveals
   - `Infiltrate` → infiltrating reveals
   - `Demolish` → demolishing reveals
   - `Move` → position change reveals
6. **Reveal-on-Event disabled**: When flag not set, action does NOT reveal (e.g., `RevealDisguiseOn = None`)
7. **DisguiseTooltip**: 
   - When disguised + enemy render player → returns `disguise.AsTooltipInfo` + `disguise.AsPlayer`
   - When not disguised → returns own `Info` + own `Owner`
   - When allied render player → always returns own `Owner`
8. **DisguiseOrderTargeter**: 
   - `canTargetActor`: relationship validation, self-rejection, target type overlap
   - `canTargetFrozenActor`: relationship + target type validation
9. **IssueOrder/ResolveOrder**: Issue "Disguise" order, resolve with target actor or frozen actor
10. **IOrderVoice**: Returns `info.Voice` for "Disguise" order

**Mocks Required**:
- `IGameActor` with `info`, `owner`, `traitsImplementing()`, `traitOrDefault()`, `getAllTargetTypes()`
- `ConditionManager` with `grantCondition()` / `revokeCondition()`
- `Player` with `relationshipWith()`, `isAlliedWith()`
- `ActorInfo` with `name`, `traitInfos()`
- `ITooltip` trait with `tooltipInfo`, `owner`
- `Disguise` trait for chain-of-disguise testing
- `Armament`, `Barrel` for `INotifyAttack` call

**Edge Cases to Test**:
- Disguise chain depth (A disguised as B disguised as C — A sees C's identity)
- Disguising as self (same type + same owner) → no-op
- Target actor disposed/destroyed mid-disguise
- `DisguisedCondition` is null (no condition granted — shouldn't crash)
- `DisguisedAsConditions` is empty
- Multiple reveal triggers in same tick (should not double-undisguise)
- Disguise carried across actor transform

### 2.8 Things to Watch Out For

- `Disguise` does **NOT** extend `ConditionalTrait` in OpenRA. It manages conditions manually via `disguisedToken` / `disguisedAsToken`. Do NOT inherit from `ConditionalTrait`.
- The chain-of-disguise logic is critical: if SpyB targets SpyA (who is disguised as RifleInfantry), SpyB should appear as RifleInfantry, not as SpyA. This chain must be handled recursively.
- `DisguiseTooltip.Owner` has a special allied check: if the render player is allied with the disguise owner, always show the true owner. This prevents allied players from seeing the disguised identity.
- `INotifyDamage.Damaged` only reveals if `e.Damage.Value > 0` — healing (negative damage) should not reveal.
- Move detection uses `lastPos` tracked across ticks; initial tick should NOT reveal (guard with `lastPos != null`).
- The `RevealDisguiseOn` is a `[Flags]` enum — multiple triggers can be combined.

### 2.9 Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|--------|--------|----------|
| 3D mesh swap for disguise visual | Requires `WithDisguisingInfantryBody` render trait (TODO-19.C.3) | TODO-19.C.3 |
| FrozenActor support in `disguiseAs()` | Requires Ch12 frozen actor system | Already available (Ch12) |

### 2.10 Acceptance Criteria

- [ ] All 4 classes (DisguiseInfo, Disguise, DisguiseTooltipInfo/DisguiseTooltip, DisguiseOrderTargeter) migrated
- [ ] All 11 interfaces implemented on `Disguise`
- [ ] `RevealDisguiseType` enum with all 7 flags
- [ ] Chain-of-disguise logic correctly implemented
- [ ] Unit tests pass (`npx vitest run`) covering all public methods
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] Deferred mesh-swap visual noted with TODO-19.C.3 reference

---

## 3. TSVeinsRenderer (TODO-19.A.42)

### 3.1 Source & Target

| | |
|---|---|
| **OpenRA C# source** | `OpenRA/OpenRA.Mods.Cnc/Traits/World/TSVeinsRenderer.cs` (430 lines) |
| **TypeScript target** | `src/OpenRA.Mods.Cnc/Traits/World/TSVeinsRenderer.ts` |
| **Test target** | `src/OpenRA.Mods.Cnc/Traits/World/TSVeinsRenderer.test.ts` |
| **Migration plan ref** | TODO-19.A.42 |
| **Complexity** | HIGH |

### 3.2 Class Hierarchy

```
[Does not extend ResourceRenderer in C# — implements IResourceRenderer directly]
TSVeinsRenderer : IResourceRenderer, IWorldLoaded, IRenderOverlay, ITickRender, INotifyActorDisposing, IRadarTerrainLayer

TSVeinsRendererInfo : TraitInfo, Requires<IResourceLayerInfo>, IMapPreviewSignatureInfo
```

Unlike `TiberiumRenderer` and `D2kResourceRenderer`, TSVeinsRenderer does **NOT** extend `ResourceRenderer` in C#. It is a standalone implementation of `IResourceRenderer` with vein-specific rendering logic, adjacency calculation, and border rendering.

**Key design decision**: In TypeScript, TSVeinsRenderer should also NOT extend `ResourceRenderer` from Ch10. It should implement `IResourceRenderer` independently. This is because:
1. Vein sprite selection uses adjacency-based indices (not density interpolation like base ResourceRenderer).
2. Vein borders are rendered on cells that do NOT contain resources (adjacent to vein cells).
3. The dirty-cell processing logic is more complex (has veinhole actor management).

### 3.3 Key Properties

#### TSVeinsRendererInfo

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `ResourceType` | `string` | **required** | Resource type name for veins |
| `Image` | `string` | `"resources"` | Sequence image for vein sprites |
| `Sequence` | `string` | `"veins"` | Sequence name for vein sprites |
| `Palette` | `string` | `"terrain"` | Palette for rendering |
| `Name` | `string` | **required** | Resource name for tooltips (Fluent) |
| `VeinholeActors` | `FrozenSet<string>` | `Empty` | Actor types treated as veinholes for adjacency |

#### TSVeinsRenderer (instance fields)

| Field | Type | Description |
|-------|------|-------------|
| `info` | `TSVeinsRendererInfo` | Configuration |
| `world` | `World` | Game world reference |
| `resourceLayer` | `IResourceLayer` | Resource data backend |
| `renderIndices` | `CellLayer<int[]>` | Per-cell sprite index array (null = no vein) |
| `borders` | `CellLayer<Adjacency>` | Per-cell border adjacency flags |
| `dirty` | `Set<CPos>` | Cells needing sprite update |
| `cleanDirty` | `CPos[]` (used as queue) | Cells to withdraw from dirty set |
| `veinholeCells` | `Set<CPos>` | Pre-cached veinhole actor cell positions |
| `maxDensity` | `number` (byte) | Maximum vein density |
| `veinRadarColor` | `Color` | Color for radar minimap |
| `veinSequence` | `ISpriteSequence` | The vein sprite sequence |
| `veinPalette` | `PaletteReference` | Palette ref for rendering |
| `spriteLayer` | `TerrainSpriteLayer` | Terrain sprite layer for rendering |

#### Adjacency (Flags enum, private)

```typescript
enum Adjacency {
  None   = 0x0,
  MinusX = 0x1,  // west neighbor has vein
  PlusX  = 0x2,  // east neighbor has vein
  MinusY = 0x4,  // north neighbor has vein
  PlusY  = 0x8,  // south neighbor has vein
}
```

#### BorderIndices Map

A static `Map<Adjacency, number[]>` mapping each adjacency combination to a set of 3 sprite frame indices:

```
{MinusY}                     → [3, 4, 5]
{PlusX}                      → [6, 7, 8]
{MinusY, PlusX}              → [9, 10, 11]
{PlusY}                      → [12, 13, 14]
{MinusY, PlusY}              → [15, 16, 17]
{PlusY, PlusX}               → [18, 19, 20]
{MinusY, PlusY, PlusX}       → [21, 22, 23]
{MinusX}                     → [24, 25, 26]
{MinusX, MinusY}             → [27, 28, 29]
{MinusX, PlusX}              → [30, 31, 32]
{MinusX, PlusX, MinusY}      → [33, 34, 35]
{MinusX, PlusY}              → [36, 37, 38]
{MinusX, MinusY, PlusY}      → [39, 40, 41]
{MinusX, PlusX, PlusY}       → [42, 43, 44]
{MinusX, PlusX, MinusY, PlusY} → [45, 46, 47]
```

#### Sprite Index Constants

| Constant | Indices | Meaning |
|----------|---------|---------|
| `HeavyIndices` | `[48, 49, 50, 51]` | Full-density vein cell (4 variants) |
| `LightIndices` | `[52]` | Low-density vein cell (1 variant) |
| `Ramp1Indices` | `[53, 54]` | Vein on ramp type 1 |
| `Ramp2Indices` | `[55, 56]` | Vein on ramp type 2 |
| `Ramp3Indices` | `[57, 58]` | Vein on ramp type 3 |
| `Ramp4Indices` | `[59, 60]` | Vein on ramp type 4 |

### 3.4 Key Methods

#### 3.4.1 `TSVeinsRenderer.constructor(self, info)`

```
PSEUDOCODE:
constructor(self: IGameActor, info: TSVeinsRendererInfo):
    this.info = info
    world = self.world
    resourceLayer = self.trait(IResourceLayer)
    resourceLayer.cellChanged += addDirtyCell          // subscribe to resource changes
    maxDensity = resourceLayer.getMaxDensity(info.resourceType)

    // Get vein radar color from terrain info
    terrainInfo = world.map.rules.terrainInfo
    resourceLayer.info.tryGetTerrainType(info.resourceType, out terrainType)
    veinRadarColor = terrainInfo.terrainTypes[terrainInfo.getTerrainIndex(terrainType)].color

    renderIndices = new CellLayer<int[]>(world.map)
    borders = new CellLayer<Adjacency>(world.map)

    veinSequence = world.map.sequences.getSequence(info.image, info.sequence)
```

#### 3.4.2 `TSVeinsRenderer.worldLoaded(w, wr)` — IWorldLoaded

```
PSEUDOCODE:
worldLoaded(w: World, wr: WorldRenderer):
    // Track veinhole actors
    w.actorAdded += actorAddedToWorld
    w.actorRemoved += actorRemovedFromWorld
    for each a in w.actors:
        actorAddedToWorld(a)

    veinPalette = wr.palette(info.palette)
    first = veinSequence.getSprite(0)
    emptySprite = new Sprite(first.sheet, Rectangle.empty, first.channel)
    spriteLayer = new TerrainSpriteLayer(w, wr, emptySprite, first.blendMode, wr.world.type != WorldType.Editor)

    // Initialize all cells (for Explored Map fog visibility)
    for each cell in w.map.allCells:
        resource = resourceLayer.getResource(cell)
        cellIndices = calculateCellIndices(resource, cell)
        if cellIndices != null:
            renderIndices.set(cell, cellIndices)
            updateRenderedSprite(cell, cellIndices)
```

#### 3.4.3 `TSVeinsRenderer.calculateCellIndices(contents, cell)` — Sprite selection

```
PSEUDOCODE:
calculateCellIndices(contents: ResourceLayerContents, cell: CPos): int[] | null
    if contents.type != info.resourceType OR contents.density == 0:
        return null

    ramp = world.map.ramp[cell]
    switch ramp:
        case 1: return Ramp1Indices
        case 2: return Ramp2Indices
        case 3: return Ramp3Indices
        case 4: return Ramp4Indices
        default: return contents.density == maxDensity ? HeavyIndices : LightIndices
```

#### 3.4.4 `TSVeinsRenderer.tickRender(wr, self)` — ITickRender (dirty processing)

```
PSEUDOCODE:
tickRender(wr: WorldRenderer, self: IGameActor):
    for each cell in dirty:
        if !resourceLayer.isVisible(cell): continue

        contents = resourceLayer.getResource(cell)
        cellIndices = calculateCellIndices(contents, cell)
        if cellIndices != renderIndices.get(cell):
            renderIndices.set(cell, cellIndices)
            updateRenderedSprite(cell, cellIndices)

        cleanDirty.push(cell)

    while cleanDirty.length > 0:
        dirty.delete(cleanDirty.shift())
```

#### 3.4.5 `TSVeinsRenderer.render(wr)` — IRenderOverlay

```
PSEUDOCODE:
render(wr: WorldRenderer):
    spriteLayer.draw(wr.viewport)
```

#### 3.4.6 `TSVeinsRenderer.hasBorder(cell)` — Border check

```
PSEUDOCODE:
hasBorder(cell: CPos): boolean
    if !renderIndices.contains(cell): return false
    return (world.map.ramp[cell] == 0 AND renderIndices.get(cell) != null) OR veinholeCells.has(cell)
```

A cell has a "border" if it's flat and has vein resources, OR if it's a veinhole actor location.

#### 3.4.7 `TSVeinsRenderer.calculateBorders(cell)` — Adjacency computation

```
PSEUDOCODE:
calculateBorders(cell: CPos): Adjacency
    if world.map.ramp[cell] != 0: return Adjacency.None    // borders only on flat terrain

    ret = Adjacency.None
    if hasBorder(cell + new CVec(0, -1)): ret |= Adjacency.MinusY   // north
    if hasBorder(cell + new CVec(-1, 0)): ret |= Adjacency.MinusX   // west
    if hasBorder(cell + new CVec(1, 0)):  ret |= Adjacency.PlusX    // east
    if hasBorder(cell + new CVec(0, 1)):  ret |= Adjacency.PlusY    // south
    return ret
```

#### 3.4.8 `TSVeinsRenderer.updateRenderedSprite(cell, indices)` — Update cell + neighbors

```
PSEUDOCODE:
updateRenderedSprite(cell: CPos, indices: int[]):
    borders.set(cell, Adjacency.None)
    updateSpriteLayers(cell, indices)

    // Also update all 4 orthogonal neighbors (their border status may have changed)
    for each c in expandFootprint(cell, false):
        updateBorderSprite(c)
```

#### 3.4.9 `TSVeinsRenderer.updateBorderSprite(cell)` — Border rendering

```
PSEUDOCODE:
updateBorderSprite(cell: CPos):
    // Borders are never drawn ON resource cells or on ramps
    if hasBorder(cell) OR world.map.ramp[cell] != 0: return

    adjacency = calculateBorders(cell)
    if borders.get(cell) == adjacency: return    // no change

    borders.set(cell, adjacency)

    if adjacency == Adjacency.None:
        updateSpriteLayers(cell, null)           // clear border sprite
    else if borderIndices.has(adjacency):
       updateSpriteLayers(cell, borderIndices.get(adjacency))
    else:
       throw new Error(`No index for Adjacency ${adjacency}`)
```

#### 3.4.10 `TSVeinsRenderer.updateSpriteLayers(cell, indices)` — Actual sprite update

```
PSEUDOCODE:
updateSpriteLayers(cell: CPos, indices: int[]):
    if indices != null:
        // Pick a random variant from the 3-4 indices
        chosen = indices[randomInt(indices.length, world.localRandom)]
        spriteLayer.update(cell, veinSequence, veinPalette, chosen)
    else:
        spriteLayer.clear(cell)
```

#### 3.4.11 Veinhole Actor Management

```
PSEUDOCODE:
actorAddedToWorld(a: IGameActor):
    if info.veinholeActors.has(a.info.name):
        for each cell in a.occupiesSpace.occupiedCells():
            veinholeCells.add(cell.cell)
            addDirtyCell(cell.cell, info.resourceType)

actorRemovedFromWorld(a: IGameActor):
    if info.veinholeActors.has(a.info.name):
        for each cell in a.occupiesSpace.occupiedCells():
            veinholeCells.delete(cell.cell)
            addDirtyCell(cell.cell, null)    // null triggers border recalculation
```

#### 3.4.12 `IResourceRenderer` Interface Methods

```
PSEUDOCODE:
// IResourceRenderer.resourceTypes: yield info.resourceType

// IResourceRenderer.getRenderedResourceType(cell):
    if renderIndices.get(cell) != null: return info.resourceType
    return borders.get(cell) != Adjacency.None ? info.resourceType : null

// IResourceRenderer.getRenderedResourceTooltip(cell):
    if renderIndices.get(cell) != null OR borders.get(cell) != Adjacency.None:
        return FluentProvider.getMessage(info.name)
    return null

// IResourceRenderer.renderUIPreview(wr, resourceType, origin, scale):
    if resourceType != info.resourceType: yield break
    sprite = veinSequence.getSprite(HeavyIndices[0])    // 48
    palette = wr.palette(info.palette)
    yield new UISpriteRenderable(sprite, WPos.zero, origin, 0, palette, scale)

// IResourceRenderer.renderPreview(wr, resourceType, origin):
    if resourceType != info.resourceType: yield break
    frame = HeavyIndices[0]
    sprite = veinSequence.getSprite(frame)
    alpha = veinSequence.getAlpha(frame)
    palette = wr.palette(info.palette)
    tintModifiers = veinSequence.ignoreWorldTint ? IgnoreWorldTint : None
    yield new SpriteRenderable(sprite, origin, WVec.zero, 0, palette, veinSequence.scale, alpha, Float3.ones, tintModifiers, false)
```

#### 3.4.13 `IMapPreviewSignatureInfo` — Static population (in Info class)

```
PSEUDOCODE:
static populateMapPreviewSignatureCells(map, ai, s, destinationBuffer):
    resourceLayer = ai.traitInfoOrDefault(IResourceLayerInfo)
    if resourceLayer == null: return
    if !resourceLayer.tryGetResourceIndex(resourceType, out resourceIndex): return
    if !resourceLayer.tryGetTerrainType(resourceType, out terrainType): return

    // Collect veinhole cells from map actor definitions
    veinholeCells = new Set<CPos>()
    for each [_, value] of map.actorDefinitions:
        if !veinholeActors.has(value.value): continue
        actorRef = new ActorReference(value.value, value)
        location = actorRef.get(LocationInit)
        veinholeInfo = map.rules.actors[actorRef.type]
        for each cell in veinholeInfo.traitInfo(IOccupySpaceInfo).occupiedCells(veinholeInfo, location.value):
            veinholeCells.add(cell.key)

    terrainInfo = map.rules.terrainInfo
    info = terrainInfo.terrainTypes[terrainInfo.getTerrainIndex(terrainType)]

    for i in 0..map.mapSize.width:
        for j in 0..map.mapSize.height:
            uv = new MPos(i, j)

            if map.resources[uv].type == resourceIndex:
                destinationBuffer.push({ uv, color: info.color })
                continue

            isBorder = map.ramp[uv] == 0 AND expandFootprint(uv.toCPos(map), false).some(c => {
                if !map.resources.contains(c): return false
                if veinholeCells.has(c): return true
                return map.resources[c].type == resourceIndex AND map.ramp[c] == 0
            })

            if isBorder:
                destinationBuffer.push({ uv, color: info.color })
```

#### 3.4.14 `INotifyActorDisposing.disposing()` — Cleanup

```
PSEUDOCODE:
disposing(self: IGameActor):
    resourceLayer.cellChanged -= addDirtyCell
    world.actorAdded -= actorAddedToWorld
    world.actorRemoved -= actorRemovedFromWorld
```

#### 3.4.15 `IRadarTerrainLayer` — Minimap integration

```
PSEUDOCODE:
// CellEntryChanged event delegation:
cellEntryChanged += value: renderIndices.cellEntryChanged += value; borders.cellEntryChanged += value
cellEntryChanged -= value: renderIndices.cellEntryChanged -= value; borders.cellEntryChanged -= value

// tryGetTerrainColorPair:
tryGetTerrainColorPair(uv: MPos): { left: Color, right: Color } | null
    if borders[uv] == Adjacency.None AND renderIndices[uv] == null: return null
    return { left: veinRadarColor, right: veinRadarColor }
```

### 3.5 Dependencies

| Import | Source Path | Status |
|--------|------------|--------|
| `IResourceRenderer` | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `IWorldLoaded`, `IRenderOverlay`, `ITickRender`, `INotifyActorDisposing`, `IRadarTerrainLayer` | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `IMapPreviewSignatureInfo` | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `IResourceLayer` (with `CellChanged` event) | `../../../../OpenRA.Game/Traits/TraitsInterfaces.js` | COMPLETE (Ch3) |
| `CellLayer<T>` | `../../../../OpenRA.Game/Map/CellLayer.js` | COMPLETE (Ch4) |
| `TerrainSpriteLayer` | `../../../../OpenRA.Game/Graphics/TerrainSpriteLayer.js` | COMPLETE (Ch2) |
| `ISpriteSequence`, `Sprite` | `../../../../OpenRA.Game/Graphics/Sprite.js` | COMPLETE (Ch2) |
| `PaletteReference` | `../../../../OpenRA.Game/Graphics/PaletteReference.js` | COMPLETE (Ch2) |
| `CPos`, `CVec`, `MPos` | `../../../../OpenRA.Game/CPos.js` etc. | COMPLETE (Ch3) |
| `WorldRenderer` | `../../../../OpenRA.Game/Graphics/WorldRenderer.js` | COMPLETE (Ch2) |
| `Color` | `../../../../OpenRA.Game/Primitives/Color.js` | COMPLETE (Ch3) |
| `Rectangle` (for empty sprite) | `../../../../OpenRA.Game/Primitives/Rectangle.js` | COMPLETE (Ch3) |
| `TextureChannel` | `../../../../OpenRA.Game/Graphics/TextureChannel.js` | COMPLETE (Ch2) |
| `BlendMode` | `../../../../OpenRA.Game/Graphics/BlendMode.js` | COMPLETE (Ch2) |
| `FluentProvider` (getMessage) | `../../../../OpenRA.Game/FluentProvider.js` | DEFERRED (use string fallback) |
| `ExpandFootprint` utility | `../../../../OpenRA.Game/Map/MapGrid.js` or util | COMPLETE (Ch4) |

### 3.6 TypeScript Paradigm Mapping

| C# Pattern | TypeScript / Babylon.js Equivalent |
|-----------|-----------------------------------|
| `[Flags] enum Adjacency : byte` | TypeScript numeric enum, bitwise `|` / `&` operations |
| `static readonly FrozenDictionary<Adjacency, int[]>` | `static readonly Map<Adjacency, number[]>` initialized with `new Map()` |
| `HashSet<CPos> dirty` | `Set<string>` using `cell.key()` as hash, or `Set<number>` using packed int key |
| `Queue<CPos> cleanDirty` | `CPos[]` as array with `push()`/`shift()` |
| `CellLayer<int[]>` | `CellLayer<number[] | null>` (Ch4 CellLayer generic) |
| `resourceLayer.CellChanged += handler` | `resourceLayer.addCellChangedListener(handler)` (event pattern from Ch10) |
| `world.ActorAdded += handler` | `world.onActorAdded(handler)` (event pattern) |
| `foreach (var cell in dirty)` → `cleanDirty.Enqueue(cell)` | Separate enqueue loop, then `while (cleanDirty.length) dirty.delete(cleanDirty.shift())` |
| `indices.Random(world.LocalRandom)` | `indices[Math.floor(world.localRandom.next() * indices.length)]` |
| `spriteLayer.Update(cell, sequence, palette, index)` | `spriteLayer.update(cell, sequence, palette, index)` |
| `spriteLayer.Clear(cell)` | `spriteLayer.clear(cell)` |
| `IEnumerable<IRenderable> yield return` | Generator: `*RenderUIPreview(): Generator<IRenderable>` |
| `event Action<CPos> IRadarTerrainLayer.CellEntryChanged` | `get cellEntryChanged(): { add(fn), remove(fn) }` (event relay pattern) |
| `IMapPreviewSignatureInfo.PopulateMapPreviewSignatureCells` | Static method on `TSVeinsRendererInfo`: `populateMapPreviewSignatureCells(...)` |

**3D paradigm shift — vein rendering**:

| C# / 2D Pattern | Babylon.js / 3D Equivalent |
|-----------------|---------------------------|
| `TerrainSpriteLayer` with per-cell sprite UV update | Same: Ch2 `TerrainSpriteLayer` already wraps `Mesh` for large terrain grids. Vein sprites are placed on the same terrain mesh layer. |
| 2D sprite frames for vein connectivity | Same approach: UV offsets into a texture atlas sheet containing all 60 vein sprites. |
| Adjacency-based border sprite selection | Pure data computation (no GPU changes); results in different sprite frame index per cell |
| Vein growth animation (density change) | Frame swap on `TerrainSpriteLayer` using `updateVerticesData("uv", ...)` for dirty cells |

**ADR-19.6 (Vein LinesMesh for growth connections)**: For the vein growth/spread animation, a `BABYLON.LinesMesh` can be used to render glowing vein tendrils growing from veinhole sources outward. This is an optional visual enhancement beyond the 2D parity behavior. The LinesMesh would connect veinhole actor positions to vein cell centers with animated color gradient. **This feature is deferred to post-MVP**.

### 3.7 Test Strategy

**Unit Tests** (~45 expected):

1. **Info construction**: Verify `TSVeinsRendererInfo` with required `ResourceType` and `Name` fields.
2. **constructor**: Verify subscriptions:
   - `resourceLayer.cellChanged` listener attached
   - `terrainInfo` queried for vein color
   - `veinSequence` loaded from `map.sequences`
3. **calculateCellIndices()**:
   - Vein resource type + max density → `HeavyIndices` (4-element array)
   - Vein resource type + sub-max density → `LightIndices` (single-element array)
   - Ramp 1-4 → respective `Ramp1-4Indices`
   - Non-vein resource type → `null`
   - Zero density → `null`
   - Empty cell (default contents) → `null`
4. **hasBorder()**:
   - Flat cell with vein → `true`
   - Veinhole actor cell → `true` (even without vein resource)
   - Flat cell without vein → `false`
   - Ramp cell with vein → `false`
   - Cell outside renderIndices → `false`
5. **calculateBorders()**:
   - All four neighbors have veins → `Adjacency.MinusX | PlusX | MinusY | PlusY`
   - Only north neighbor → `Adjacency.MinusY`
   - Only two neighbors (west + south) → `Adjacency.MinusX | PlusY`
   - No neighbors → `Adjacency.None`
   - On ramp cell → `Adjacency.None` always
6. **updateRenderedSprite()**:
   - Vein cell: `borders[cell]` set to `None`, `spriteLayer.update()` called with correct index, neighbors' `updateBorderSprite()` triggered
   - Non-vein cell (indices=null): `spriteLayer.clear()` called
7. **updateBorderSprite()**:
   - Cell adjacent to vein: border adjacency calculated, correct `BorderIndices` sprite frame selected
   - Cell not adjacent to any vein: sprite cleared
   - Cell already has same adjacency: no update (optimization)
   - Cell has vein itself: no border drawn (early return)
8. **dirty cell processing** (`tickRender`):
   - Dirty set iterated, each cell's `calculateCellIndices` compared to `renderIndices`
   - Changed cells: `updateRenderedSprite` called
   - All processed cells removed from dirty set
   - Non-visible cells skipped
9. **Veinhole actor management**:
   - Veinhole actor added → cells added to `veinholeCells` + marked dirty
   - Veinhole actor removed → cells removed from `veinholeCells` + marked dirty (null resource type)
   - Non-veinhole actor added → ignored
10. **render()**: Verify `spriteLayer.draw(wr.viewport)` called.
11. **getRenderedResourceType()**: Vein cell returns `info.resourceType`; border cell returns `info.resourceType`; neither returns `null`.
12. **getRenderedResourceTooltip()**: Vein or border cell returns Fluent name; neither returns `null`.
13. **disposing()**: All three subscriptions removed.
14. **IRadarTerrainLayer**: `cellEntryChanged` event relay delegates to both `renderIndices` and `borders`.
15. **IMapPreviewSignatureCells**: Static method populates destinationBuffer with vein cells and border cells.

**Mocks Required**:
- `IResourceLayer` with `getResource()`, `getMaxDensity()`, `isVisible()`, `addCellChangedListener()`, `info.tryGetTerrainType()`
- `World` with `map` (including `ramp`, `allCells`, `mapSize`, `sequences`, `actorDefinitions`, `rules.terrainInfo`), `actors`, `actorAdded`/`actorRemoved` events
- `WorldRenderer` with `viewport`, `palette()`
- `TerrainSpriteLayer` with `update()`, `clear()`, `draw()`
- `ISpriteSequence` with `getSprite()`, `getAlpha()`
- `CellLayer` mock with `get()`, `set()`, `contains()`
- `IGameActor` mock for veinhole actors with `info.name`, `occupiesSpace.occupiedCells()`

**Edge Cases to Test**:
- Entire map has no veins (all `calculateCellIndices` return null)
- Veinhole actor placed on ramp (border should still be drawn at veinhole cells)
- Vein cell transitions from Heavy to Light density (different indices array)
- Multiple veinhole actors overlapping (cells added twice → should be idempotent)
- Border calculation on map edge (out-of-bounds neighbor → just `false`)
- `resourceLayer.isVisible(cell)` returns false → skip in dirty loop
- Fluent localization unavailable → fallback to raw `info.Name` string

### 3.8 Things to Watch Out For

- **Borders are drawn on non-resource cells** adjacent to vein cells. This is the key behavioral difference from base `ResourceRenderer`. The `hasBorder()` function returns `true` for cells that contain vein resources, while `updateBorderSprite()` skips cells where `hasBorder()` is true — borders are rendered on the cells BETWEEN vein patches, not ON them.
- **Veinhole cells always have borders**: `hasBorder()` returns true for veinhole cells even if they don't contain vein resources. However, `updateBorderSprite()` still skips them (since `hasBorder(cell)` returns true, the early return prevents border rendering ON the veinhole itself). The veinhole's neighboring cells get borders.
- **Dirty set uses packed integer keys** (same pattern as `ResourceRenderer._cellKey()`): `((cell.Y & 0xffff) << 16) | (cell.X & 0xffff)`.
- **`cleanDirty` pattern**: Must enqueue all cells from dirty before dequeuing (to avoid concurrent modification). Use `while (cleanDirty.length > 0) dirty.delete(cleanDirty.shift())`.
- **`ExpandFootprint` for border updates**: When a cell's vein state changes, all 4 orthogonal neighbors' borders must be recalculated. This is done via `Common.Util.ExpandFootprint(cell, false)` which returns the 4 adjacent cells.
- **Ramp cells do not get borders**: `calculateBorders()` returns `None` for any ramp cell, and `updateBorderSprite()` skips ramp cells.
- **Map preview signature cells**: This is a build-time or map-preview-time calculation that determines what color to display on the map preview. It must handle the case where `map.resources` doesn't contain a given cell.

### 3.9 Features That Can Be Deferred

| Feature | Reason | TODO Ref |
|---------|--------|----------|
| 3D LinesMesh for vein growth connections (ADR-19.6) | Visual enhancement beyond 2D parity | Post-MVP |
| FluentProvider localization | Use raw `info.Name` string fallback | Fluent deferred |
| Map editor actor monitoring | `// TODO: Add support for monitoring actors placed in the map editor!` | TODO-21.X |
| Radar minimap integration (IRadarTerrainLayer) | Requires Ch16 RadarWidget | TODO-16.X |

### 3.10 Acceptance Criteria

- [ ] All 8 interfaces implemented (`IResourceRenderer`, `IWorldLoaded`, `IRenderOverlay`, `ITickRender`, `INotifyActorDisposing`, `IRadarTerrainLayer` + `IMapPreviewSignatureInfo` on Info)
- [ ] All 4 inner enums/constants (`Adjacency`, `BorderIndices`, Heavy/Light/Ramp indices) migrated
- [ ] Static `populateMapPreviewSignatureCells()` on Info class
- [ ] Veinhole actor add/remove tracking with proper cleanup on dispose
- [ ] Unit tests pass (`npx vitest run`) covering all public methods + border calculation
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] Generator functions for `renderUIPreview()` and `renderPreview()`
- [ ] Dispose pattern: unsubscribes from all 3 event sources

### 3.11 Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| `tickRender` processing | < 5ms for 500 dirty cells | Per-cell index comparison is O(1); sprite layer update triggers GPU buffer upload |
| `borderIndices` lookup | O(1) | `Map<Adjacency, number[]>` with 15 keys |
| Memory per cell | ~32 bytes | `renderIndices` (pointer to int array) + `borders` (1 byte enum) + dirty set overhead |

---

## Appendix A: Cross-File Dependencies Among the 3 Files

```
ChronoshiftPower
  ├── depends on: Chronoshiftable (TODO-19.A.1) — calls cs.teleport() and cs.canChronoshiftTo()
  ├── depends on: SupportPower (Ch13) — inherits base activation/charging logic
  ├── depends on: OrderGenerator (Ch15) — inner classes extend this
  └── referenced by: nothing else in Phase A

Disguise
  ├── depends on: ConditionalTrait + 11 interfaces (Ch3)
  ├── depends on: UnitOrderTargeter (Ch15)
  ├── depends on: Order, Target (Ch6)
  └── referenced by: DisguiseTooltip (same file), WithDisguisingInfantryBody (TODO-19.C.3)

TSVeinsRenderer
  ├── depends on: IResourceLayer + IResourceRenderer (Ch3/Ch10)
  ├── depends on: CellLayer (Ch4), TerrainSpriteLayer (Ch2)
  ├── depends on: ISpriteSequence, Sprite, PaletteReference (Ch2)
  ├── depends on: CPos, CVec, MPos (Ch3), MapGrid.ExpandFootprint (Ch4)
  └── referenced by: World actor (via IResourceRenderer lookup)
```

## Appendix B: Migration Order Implications

These 3 HIGH files should be migrated **after** their blocking dependencies but **before** the MEDIUM/LOW Phase A files that depend on them:

| Order | File | Reason |
|-------|------|--------|
| 1 | `Chronoshiftable` (TODO-19.A.1) | Required by ChronoshiftPower |
| 2 | **ChronoshiftPower** (TODO-19.A.4) | Unblocks ConyardChronoReturn (TODO-19.A.3) |
| 3 | **Disguise** (TODO-19.A.28) | Unblocks DisguiseTooltip (same file), required by WithDisguisingInfantryBody (TODO-19.C.3) |
| 4 | `TSResourceLayer` (TODO-19.A.40) | Required by TSVeinsRenderer |
| 5 | **TSVeinsRenderer** (TODO-19.A.42) | Unblocks TSTiberiumRenderer (TODO-19.A.41) |

**Recommended assignment sequence**: `Chronoshiftable` → `ChronoshiftPower` + `TSResourceLayer` (parallel) → `Disguise` + `TSVeinsRenderer` (parallel).

---

> **ADR-19.5** (Deferred-Action for Teleport & Identity Swap): All actor position mutations and identity/mesh swaps are queued during `tick()` via `World.AddFrameEndTask()` and applied after all tick logic completes. This prevents mid-tick state cascade where some systems observe the pre-teleport state and others observe the post-teleport state. TypeScript implementation uses a `frameEndActions: Array<() => void>` queue on the `World` instance, processed in `world.tick()` after all actors have ticked. See ADR-8.1 (Warhead Resolution) for the originating pattern.
>
> **ADR-19.6** (Vein LinesMesh for Growth Animation): For post-MVP visual enhancement, vein growth/spread can be visualized using a `BABYLON.LinesMesh` connecting veinhole source positions to vein cell centers. The LinesMesh vertices animate outward as vein density increases, with a color gradient from bright green (source) to dark green (edge). This is a pure visual improvement over the 2D sprite-based rendering and does not affect gameplay logic. The underlying `CellLayer` and adjacency calculations remain the same; only the rendering output changes from `TerrainSpriteLayer.sprite()` to `LinesMesh.updateVertices()`.
