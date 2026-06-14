# Chapter 11 Phase B -- Gap Analysis

**Date**: 2026-06-14
**Branch**: `feat/chapter11-phase-b`
**Analyst**: Migration Architect
**Phase A Baseline**: 14 files migrated, 257 test files, 7602 tests passing

---

## 1. File Path Verification

The Phase B plan in `docs/chapter11_production_building_migration_plan.md` lists 16 files (TODO-11.B.1 through TODO-11.B.16). TODO-11.B.7 (`Buildable.ts`) is already implemented from Phase A at `src/OpenRA.Mods.Common/Traits/Buildable.ts`.

The remaining 15 files are verified against actual OpenRA source:

| TODO | OpenRA Source | Target TS Path | Lines(C#) | Path Correct? |
|------|--------------|----------------|-----------|---------------|
| B.1 | `Traits/Buildings/Building.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Building.ts` | 356 | YES |
| B.2 | `Traits/Buildings/BuildingInfluence.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BuildingInfluence.ts` | 92 | YES |
| B.3 | `Traits/Buildings/BaseBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BaseBuilding.ts` | 19 | YES |
| B.4 | `Traits/Buildings/BaseProvider.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BaseProvider.ts` | 135 | YES |
| B.5 | `Traits/Player/PlaceBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Player/PlaceBuilding.ts` | 268 | YES |
| B.6 | `Traits/Buildings/PlaceBuildingVariants.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/PlaceBuildingVariants.ts` | 32 | YES |
| B.7 | (skipped -- already implemented) | N/A | -- | -- |
| B.8 | `Traits/Buildings/LineBuild.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/LineBuild.ts` | 125 | YES |
| B.9 | `Traits/Buildings/RequiresBuildableArea.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/RequiresBuildableArea.ts` | 30 | YES |
| B.10 | `Traits/Buildings/BuildingUtils.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.ts` | 139 | YES |
| B.11 | `Traits/Buildings/RepairableBuilding.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/RepairableBuilding.ts` | 208 | YES |
| B.12 | `Traits/Buildings/Gate.cs` | `src/OpenRA.Mods.Common/Traits/Buildings/Gate.ts` | 147 | YES |
| B.13 | `Traits/Transforms.cs` | `src/OpenRA.Mods.Common/Traits/Transforms.ts` | 171 | YES |
| B.14 | `Traits/Demolition.cs` | `src/OpenRA.Mods.Common/Traits/Demolition.ts` | 153 | YES |
| B.15 | `Traits/World/MapBuildRadius.cs` | `src/OpenRA.Mods.Common/Traits/World/MapBuildRadius.ts` | 92 | YES |
| B.16 | `Orders/PlaceBuildingOrderGenerator.cs` | `src/OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.ts` | 337 | YES |

All 15 paths are correct. No corrections needed.

---

## 2. Dependency Analysis

### 2.1 Already Implemented (READY)

These dependencies exist in `src/` and are production-ready for Phase B consumption:

| Dependency | Location | Used By |
|------------|----------|---------|
| `IOccupySpace` / `IOccupySpaceInfo` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Building, Gate, Immobile, Mobile |
| `INotifySold` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Building |
| `INotifyTransform` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Building |
| `INotifyAddedToWorld` / `INotifyRemovedFromWorld` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Building, LineBuild, Gate |
| `ISync` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Building, RepairableBuilding, Gate |
| `INotifyCreated` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | MapBuildRadius, Pluggable |
| `IHealth` / `IHealthInfo` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | RepairableBuilding |
| `IResolveOrder` / `IIssueOrder` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | PlaceBuilding, Transforms, Demolition |
| `IOrderVoice` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Transforms, Demolition |
| `IIssueDeployOrder` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Transforms |
| `INotifyKilled` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | LineBuild |
| `ISelectionBar` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | BaseProvider |
| `IRenderAnnotationsWhenSelected` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | BaseProvider |
| `ITemporaryBlocker` / `ITemporaryBlockerInfo` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Gate |
| `INotifyBlockingMove` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Gate |
| `ILobbyOptions` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | MapBuildRadius |
| `ConditionalTrait` (includes `isTraitPaused`) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | BaseProvider, RepairableBuilding, Gate, Transforms, Demolition, GivesBuildableArea, RequireBuildingArea |
| `IBlocksProjectiles` | `src/OpenRA.Mods.Common/Traits/CombatInterfaces.ts` | Gate |
| `AttackInfo`, `Damage` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | RepairableBuilding, Gate |
| `DeveloperMode` | `src/OpenRA.Mods.Common/Traits/Player/DeveloperMode.ts` | Building.IsCloseEnoughToBase, BaseProvider |
| `PlayerResources` | `src/OpenRA.Mods.Common/Traits/Player/PlayerResources.ts` | RepairableBuilding |
| `Valued` / `Sellable` (GetSellValue) | `src/OpenRA.Mods.Common/Traits/Valued.ts`, `Sellable.ts` | RepairableBuilding |
| `ProductionQueue` / `ClassicProductionQueue` | `src/OpenRA.Mods.Common/Traits/Player/` | PlaceBuilding, PlaceBuildingOrderGenerator |
| `Production` | `src/OpenRA.Mods.Common/Traits/Production.ts` | PlaceBuilding |
| `Buildable` / `BuildableInfo` | `src/OpenRA.Mods.Common/Traits/Buildable.ts` | PlaceBuilding, PlaceBuildingOrderGenerator |
| `TechTree` | `src/OpenRA.Mods.Common/Traits/Player/TechTree.ts` | (referenced, indirect) |
| `PowerManager` | `src/OpenRA.Mods.Common/Traits/PowerManager.ts` | (referenced, indirect) |
| `Exit` | `src/OpenRA.Mods.Common/Traits/Buildings/Exit.ts` | PlaceBuilding (producer) |
| `RallyPoint` | `src/OpenRA.Mods.Common/Traits/Buildings/RallyPoint.ts` | (referenced, indirect) |
| `PrimaryBuilding` | `src/OpenRA.Mods.Common/Traits/Buildings/PrimaryBuilding.ts` | (referenced, indirect) |
| `Refinery` | `src/OpenRA.Mods.Common/Traits/Buildings/Refinery.ts` | (referenced, indirect) |
| `CellLayer` | `src/OpenRA.Game/Map/CellLayer.ts` | BuildingInfluence |
| `Map` (GameWorldManager) | `src/OpenRA.Game/Map/Map.ts` | Building, BuildingInfluence, BuildingUtils |
| `Order` / `OrderStub` | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | PlaceBuilding, Transforms, Demolition, PlaceBuildingOrderGenerator |
| `Target` | `src/OpenRA.Game/Traits/Target.ts` | Building, Demolition, PlaceBuildingOrderGenerator |

### 2.2 Implementation Artifacts (CONSTRUCTED -- do not exist as separate files)

These are not standalone files but are created/constructed by the Phase B files themselves:

| Artifact | Created By | Notes |
|----------|-----------|-------|
| `BuildingUtils.IsCellBuildable()` | BuildingUtils.ts | Replaces `World.IsCellBuildable()` extension method |
| `BuildingUtils.CanPlaceBuilding()` | BuildingUtils.ts | Replaces `World.CanPlaceBuilding()` extension method |
| `BuildingUtils.GetLineBuildCells()` | BuildingUtils.ts | Finds wall line connection cells |
| `BuildingInfo.footprintTiles()` | Building.ts | Cell enumeration for footprints |
| `PlaceBuildingInit` | PlaceBuilding.ts | Runtime flag marker |
| `LineBuildDirection` enum | LineBuild.ts | Direction for wall segments |
| `INotifyLineBuildSegmentsChanged` | LineBuild.ts | Interface for line build notifications |
| `PlaceBuildingCellType` enum | PlaceBuildingOrderGenerator.ts | Preview cell color coding |
| `VariantWrapper` | PlaceBuildingOrderGenerator.ts | Inner class for variant cycling |

### 2.3 Stub/DEFERRED Dependencies (impact graded)

These dependencies exist as stubs or are completely absent. Each is graded by impact on Phase B.

#### CRITICAL -- Must be implemented for Phase B core logic

| # | Dependency | Current State | Size (C#) | Needed By | Impact |
|---|-----------|---------------|-----------|-----------|--------|
| D1 | **ActorMap** (`IActorMap`, `World.AddToMaps`, `World.RemoveFromMaps`) | Empty stub in `World.ts` | ~200 lines | Building (AddedToWorld/RemovedFromWorld), BuildingUtils (GetActorsAt), PlaceBuilding (Replacement, ClearBlockers), PlaceBuildingOrderGenerator (AcceptsPlug), Gate (addInfluence/removeInfluence), LineBuild (lines 97-110 notification) | **BLOCKER** -- Building cannot function without spatial index |
| D2 | **GivesBuildableArea** | NOT implemented | 33 lines | Building.IsCloseEnoughToBase, BuildingUtils.IsCellBuildable | **BLOCKER** -- placement validation broken |
| D3 | **LineBuildNode** | NOT implemented | 29 lines | BuildingUtils.GetLineBuildCells, LineBuild (connector matching) | **BLOCKER** -- wall placement broken |
| D4 | **Replacement** / **Replaceable** | NOT implemented | 25+30 lines | BuildingUtils.IsCellBuildable, PlaceBuilding.ResolveOrder | **HIGH** -- replacement mechanics (placing over existing buildings) fails |
| D5 | **Plug** / **Pluggable** / **PlugInit** | NOT implemented | 25+160+15 lines | PlaceBuilding.ResolveOrder (PlacePlug), PlaceBuildingOrderGenerator (AcceptsPlug, plug preview) | **HIGH** -- plug placement (sandbags, etc.) fails |
| D6 | **ITargetableCells** (interface) | NOT defined in `TraitsInterfaces.ts` | ~10 lines | Building (implements this) | **MEDIUM** -- currently duck-typed in HitShape.ts; needs proper interface |
| D7 | **IPlaceBuildingDecorationInfo** (interface) | NOT defined anywhere | ~5 lines | BuildingInfo (implements this) | **LOW** -- can be deferred, used only for RangeAnnotation |
| D8 | **IOrderGenerator** (full interface) | Stub only in `World.ts` | ~50 lines | PlaceBuildingOrderGenerator | **BLOCKER** -- cannot declare class implementing IOrderGenerator |
| D9 | **SmudgeLayer** | NOT implemented (only `LeaveSmudgeWarhead` uses the concept) | ~200 lines | Building.RemoveSmudges | **MEDIUM** -- can create stub trait interface; full impl deferred |
| D10 | **IDemolishable** / **IDemolishableInfo** | Interface exists in OpenRA `TraitsInterfaces.cs` (lines 93-98), NOT in TS | ~10 lines | Demolition (target validation) | **HIGH** -- Demolition target check fails |
| D11 | **EnterBehaviour** enum | NOT implemented | ~5 lines | Demolition.DemolitionInfo | **MEDIUM** -- simple enum, block Demolition |
| D12 | **DeployOrderTargeter** | NOT implemented (46 lines C#) | 46 lines | Transforms (issue deploy order) | **HIGH** -- Transforms cannot issue deploy orders |
| D13 | **UnitOrderTargeter** / **TargetTypeOrderTargeter** | NOT implemented (89 lines C#) | 89 lines | Demolition (DemolitionOrderTargeter extends this) | **HIGH** -- Demolition targeting broken |
| D14 | **AIUtils.ClearBlockersOrders** | NOT implemented | ~30 lines | PlaceBuildingOrderGenerator.InnerOrder, Transforms.DeployTransform | **MEDIUM** -- blocker clearing fails, can use stub |
| D15 | **TextNotificationsManager** | NOT implemented | ~30 lines | PlaceBuilding, RepairableBuilding, Transforms | **LOW** -- text notification display; can be `console.warn` stub |
| D16 | **PlayerExperience** | NOT implemented | ~50 lines | RepairableBuilding (line 194) | **MEDIUM** -- XP grant for allied repairs fails silently |
| D17 | **RangeCircleAnnotationRenderable** | NOT implemented | ~40 lines | BaseProvider (range circle rendering) | **HIGH** -- range circle broken, can stub |

#### DEFERRABLE -- Can be stubbed, full implementation in later chapters

| # | Dependency | Needed By | Defer To | Notes |
|---|-----------|-----------|----------|-------|
| D18 | `IPlaceBuildingPreview` / `IPlaceBuildingPreviewGeneratorInfo` | PlaceBuildingOrderGenerator | Ch15 or dedicated sub-phase | Preview interfaces need to be defined; concrete renderers deferred |
| D19 | `ActorPreviewPlaceBuildingPreview` (154 lines) | PlaceBuildingOrderGenerator | Ch15 | 3D building preview with Animation |
| D20 | `FootprintPlaceBuildingPreview` (126 lines) | PlaceBuildingOrderGenerator | Ch15 | Colored footprint cell overlay |
| D21 | `SequencePlaceBuildingPreview` (100 lines) | PlaceBuildingOrderGenerator | Ch15 | Sequence-based wall preview |
| D22 | `LobbyBooleanOption`, full `ILobbyOptions` runtime | MapBuildRadius | Ch16 (Lobby UI) | ILobbyOptions interface exists; boolean option class deferred |
| D23 | `FrozenActor` (full) | UnitOrderTargeter | Ch12 (Shroud) | Stub exists in TraitsInterfaces |
| D24 | `TargetModifiers` enum | UnitOrderTargeter, DeployOrderTargeter | Ch15 | Flag enum for Shift/Ctrl modifiers |
| D25 | `Transform` Activity (full) | Transforms | Ch14 (Activities) | Activity stub exists in Ch3 |
| D26 | `Demolish` Activity (full) | Demolition | Ch14 (Activities) | Activity stub exists in Ch3 |
| D27 | Bridge files (5 files, ~20K lines) | N/A | Deferred indefinitely | Bridge system is complex and game-specific |
| D28 | `TransformsInto*` (7 files, ~31K lines) | N/A | Future Phase B extension | Post-MVP; MCV, aircraft, etc. transformation variants |
| D29 | `FreeActor` / `FreeActorWithDelivery` | N/A | Future | Minor gameplay feature |
| D30 | `Reservable` | N/A | Already handled in Ch10 (DockClientBase) | May need separate trait later |

---

## 3. Files That Should Be Added to Phase B Scope

### 3.1 REQUIRED Additions (blockers for core Phase B logic)

These files are small but essential dependencies that are NOT in the current 15-file plan:

| # | File | OpenRA Source | C# Lines | Reason |
|---|------|--------------|----------|--------|
| B.17 | **GivesBuildableArea.ts** | `Traits/Buildings/GivesBuildableArea.cs` | 33 | Needed by Building.IsCloseEnoughToBase and BuildingUtils.IsCellBuildable |
| B.18 | **LineBuildNode.ts** | `Traits/Buildings/LineBuildNode.cs` | 29 | Needed by BuildingUtils.GetLineBuildCells and LineBuild connector matching |
| B.19 | **Replacement.ts** | `Traits/Replacement.cs` | 25 | Empty tag trait; needed by BuildingUtils.IsCellBuildable and PlaceBuilding |
| B.20 | **Replaceable.ts** | `Traits/Replaceable.cs` | 30 | Conditional trait; needed by BuildingUtils.IsCellBuildable |
| B.21 | **Plug.ts** | `Traits/Plug.cs` | 25 | Empty tag trait; needed by PlaceBuilding and PlaceBuildingOrderGenerator |
| B.22 | **Pluggable.ts** | `Traits/Pluggable.cs` | 160 | Logic trait for plug accept/enable; needed by PlaceBuilding |

**Total added C# lines**: ~302. Estimated TS: ~600 lines plus ~300 test lines.

### 3.2 RECOMMENDED Interface Additions (no new files, edits to existing)

These interfaces must be added to `src/OpenRA.Game/Traits/TraitsInterfaces.ts`:

```typescript
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (line 93-98)
export interface IDemolishableInfo extends ITraitInfoInterface {
  isValidTarget(actorInfo: ActorInfoStub, saboteur: IGameActor): boolean
}

export interface IDemolishable {
  isValidTarget(self: IGameActor, saboteur: IGameActor): boolean
  demolish(self: IGameActor, saboteur: IGameActor, delay: number, damageTypes: BitSetStub): void
}

// OpenRA 对照: (implicit in OpenRA -- Building implements this)
export interface ITargetableCells {
  targetableCells(): [CPos, SubCell][]
}

// OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/Building.cs (IPlaceBuildingDecorationInfo)
export interface IPlaceBuildingDecorationInfo extends ITraitInfoInterface {
  renderAnnotations(wr: WorldRendererStub, w: GameWorldManager, ai: ActorInfoStub, centerPosition: WPos): Iterable<IRenderable>
}

// OpenRA 对照: OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.cs
export interface IPlaceBuildingPreviewGeneratorInfo extends ITraitInfoInterface {
  createPreview(wr: WorldRendererStub, ai: ActorInfoStub, init: TypeDictionaryStub): IPlaceBuildingPreview
}

export interface IPlaceBuildingPreview {
  readonly topLeftScreenOffset: IntVector2
  tick(): void
  render(wr: WorldRendererStub, topLeft: CPos, footprint: Map<string, PlaceBuildingCellType>): Iterable<IRenderable>
  renderAnnotations(wr: WorldRendererStub, topLeft: CPos): Iterable<IRenderable>
}

// OpenRA 对照: OpenRA.Orders/IOrderGenerator.cs (full interface, replaces stub)
export interface IOrderGenerator {
  readonly actionButton: MouseButton
  order(world: GameWorldManager, cell: CPos, worldPixel: IntVector2, mi: MouseInput): Iterable<Order>
  tick(world: GameWorldManager): void
  selectionChanged(world: GameWorldManager, selected: Iterable<IGameActor>): void
  render(wr: WorldRendererStub, world: GameWorldManager): Iterable<IRenderable>
  renderAboveShroud(wr: WorldRendererStub, world: GameWorldManager): Iterable<IRenderable>
  renderAnnotations(wr: WorldRendererStub, world: GameWorldManager): Iterable<IRenderable>
  getCursor(world: GameWorldManager, cell: CPos, worldPixel: IntVector2, mi: MouseInput): string
  handleKeyPress(e: KeyInput): boolean
  deactivate(): void
}
```

### 3.3 DEFERRED from Phase B Scope (accept risk)

These files from the OpenRA Buildings/ directory should NOT be added to Phase B at this time:

| File | Reason for Deferral |
|------|-------------------|
| `ActorPreviewPlaceBuildingPreview.cs` (154 lines) | 3D rendering preview; depends on Animation, requires `IPlaceBuildingPreview` interface; defer to Ch15 |
| `FootprintPlaceBuildingPreview.cs` (126 lines) | 2D ghost footprint overlay; defer to Ch15 |
| `SequencePlaceBuildingPreview.cs` (100 lines) | Sequence-based wall preview; defer to Ch15 |
| `Bridge.cs`, `BridgeHut.cs`, `BridgePlaceholder.cs`, `GroundLevelBridge.cs`, `LegacyBridgeHut.cs` (combined ~25K lines) | Bridge system is a complete subsystem; defer indefinitely |
| `TransformsInto*.cs` (7 files, ~31K lines) | MCV/Aircraft/Dock/Mobile/Passenger/Tunnel variants; these are gameplay extensions, not core; defer to post-MVP Phase B extension |
| `FreeActor.cs` (112 lines) | Minor convenience trait; can be added later |
| `FreeActorWithDelivery.cs` (146 lines) | Minor convenience trait; can be added later |
| `Reservable.cs` (107 lines) | Dock reservation; partially handled in Ch10 DockClientBase; defer to post-MVP |

---

## 4. Batching Strategy

### Phase B-0: Prerequisites (BLOCKERS -- must complete before any Phase B file)

This batch contains all the "dependency files" that Phase B files import. Estimated: ~302 C# lines, ~600 TS lines, ~300 test lines. All 6 files can be done in parallel.

**Batch 0 files** (can be parallelized):
- B.17 GivesBuildableArea.ts -- trivial (33 lines C#)
- B.18 LineBuildNode.ts -- trivial (29 lines C#)
- B.19 Replacement.ts -- trivial (25 lines C#)
- B.20 Replaceable.ts -- trivial (30 lines C#)
- B.21 Plug.ts -- trivial (25 lines C#)
- B.22 Pluggable.ts -- medium (160 lines C#)

**Batch 0 interface changes** (can be parallelized with files above):
- Add `ITargetableCells` to `TraitsInterfaces.ts`
- Add `IPlaceBuildingDecorationInfo` to `TraitsInterfaces.ts`
- Add `IDemolishable` / `IDemolishableInfo` to `TraitsInterfaces.ts`
- Add `IPlaceBuildingPreviewGeneratorInfo` / `IPlaceBuildingPreview` to `TraitsInterfaces.ts`
- Add `IOrderGenerator` (full interface) to `TraitsInterfaces.ts`
- Add `DeployOrderTargeter` to `src/OpenRA.Mods.Common/Orders/`
- Add `UnitOrderTargeter` + `TargetTypeOrderTargeter` to `src/OpenRA.Mods.Common/Orders/`
- Add `EnterBehaviour` enum to `TraitsInterfaces.ts`

### Phase B-1: Core Infrastructure (must be serial, foundational)

1. **BuildingInfluence.ts** (TODO-11.B.2) -- Minimal dependencies (only CellLayer + Map). Must be first to unblock Building.
2. **BuildingUtils.ts** (TODO-11.B.10) -- Depends on BuildingInfluence, GivesBuildableArea, LineBuildNode, Replacement, Replaceable. Must follow B.2.
3. **Building.ts** (TODO-11.B.1) -- Depends on BuildingInfluence, ActorMap (stub upgrade), BuildingUtils. Must follow B.2 and B.10. This is the largest and most complex file.

### Phase B-2: Supporting Traits (can be parallelized within group)

These 6 files depend on Batch 0 + B-1 infrastructure being in place:

4. **BaseBuilding.ts** (TODO-11.B.3) -- Trivial tag trait. Can be done in parallel.
5. **RequiresBuildableArea.ts** (TODO-11.B.9) -- Trivial tag trait. Can be done in parallel.
6. **PlaceBuildingVariants.ts** (TODO-11.B.6) -- Trivial tag trait. Can be done in parallel.
7. **LineBuild.ts** (TODO-11.B.8) -- Depends on LineBuildNode. Can be done in parallel.
8. **MapBuildRadius.ts** (TODO-11.B.15) -- Only depends on ILobbyOptions (interface exists). Can be done in parallel.
9. **BaseProvider.ts** (TODO-11.B.4) -- Depends on MapBuildRadius, DeveloperMode. Can be done in parallel with B.15 complete. RangeCircleRenderable can be stubbed.

### Phase B-3: PlaceBuilding Order Chain (must be serial)

These files form a tight dependency chain:

10. **PlaceBuilding.ts** (TODO-11.B.5) -- Depends on BuildingUtils, Building, ProductionQueue, Replacement, Plug, Pluggable. Core order handler. Must precede B.16.
11. **PlaceBuildingOrderGenerator.ts** (TODO-11.B.16) -- Depends on PlaceBuilding, BuildingUtils, IOrderGenerator, BuildingInfo, IPlaceBuildingPreview. The most complex Phase B file after Building.

### Phase B-4: Gameplay Features (can be parallelized within group)

These 4 files depend on B-1 + B-2 infrastructure. Can be done in parallel:

12. **RepairableBuilding.ts** (TODO-11.B.11) -- Depends on IHealth, PlayerResources, TextNotificationsManager (stubbed). Can be done in parallel.
13. **Gate.ts** (TODO-11.B.12) -- Depends on Building, ActorMap. Can be done in parallel.
14. **Transforms.ts** (TODO-11.B.13) -- Depends on BuildingUtils, DeployOrderTargeter, Activity stub. Can be done in parallel.
15. **Demolition.ts** (TODO-11.B.14) -- Depends on IDemolishable, UnitOrderTargeter, Activity stub. Can be done in parallel.

### Overall Phase B Schedule

```
Phase B-0 (Prerequisites):  6 small files + 8 interface additions    [PARALLEL, ~2hr]
Phase B-1 (Core Infra):     B.2 -> B.10 -> B.1                      [SERIAL, ~4hr]
Phase B-2 (Supporting):     6 files                                  [PARALLEL, ~2hr]
Phase B-3 (PlaceOrder):     B.5 -> B.16                             [SERIAL, ~3hr]
Phase B-4 (Gameplay):       4 files                                  [PARALLEL, ~3hr]
```

**Estimated total**: 21 new files (15 original + 6 additions), ~4,600 TS implementation lines, ~2,800 test lines, ~250 tests.
Plus ~8 interface additions to `TraitsInterfaces.ts` and 2 new order targeter files (~135 lines C# combined).

---

## 5. High-Risk Items

### 5.1 ActorMap Full Implementation

The `ActorMap` stub in `World.ts` is the single biggest blocker. Building needs `AddToMaps`/`RemoveFromMaps`, and virtually every other Phase B file needs `GetActorsAt`. The full `IActorMap` interface from OpenRA includes:

- `AddInfluence(Actor, IOccupySpace)` / `RemoveInfluence(Actor, IOccupySpace)`
- `AddActorPosition(Actor, IOccupySpace)` / `RemoveActorPosition(Actor, IOccupySpace)` -- distinct from influence
- `GetActorsAt(CPos)` / `GetActorsAt(CPos, SubCell)` -- spatial query
- `AnyActorsAt(CPos)` / `AnyActorsAt(CPos, SubCell)` -- fast check
- `CellTrigger` / `CellEntry` / `ActorMapInfo` -- inner types

**Recommendation**: The ActorMap can be progressively implemented. Phase B needs only:
1. `AddInfluence` / `RemoveInfluence` (used by Building.AddedToWorld/RemovedFromWorld)
2. `AddActorPosition` / `RemoveActorPosition` (used by IOccupySpace actors)
3. `GetActorsAt(cell)` (used by BuildingUtils, PlaceBuilding, Gate)

The full implementation with `SubCell` subdivision and `CellTrigger` can happen in a future Chapter 3 extension.

### 5.2 PlaceBuildingOrderGenerator Complexity

At 337 lines C#, this is the second-largest Phase B file. It depends on:
- `IOrderGenerator` full interface (not a stub)
- `IPlaceBuildingPreview` / `IPlaceBuildingPreviewGeneratorInfo` (preview system)
- `BuildingUtils` (placement validation)
- `PlaceBuildingInfo` (for hotkey and notification config)
- `Viewport` (screen-to-world coordinate translation)
- `ChromeMetrics` (cursor defaults)
- `Game.Settings` (input config)
- `Target.FromCell` / `Order` construction

**Risk**: The preview rendering system (`IPlaceBuildingPreview`) is a complete subsystem involving 3 concrete preview renderers (ActorPreview, FootprintPreview, SequencePreview) totaling ~380 lines of rendering code. Without this, the order generator cannot show ghost previews.

**Mitigation**: Implement `IPlaceBuildingPreview` interface now, but stub the concrete preview renderers. The `VariantWrapper` can still be constructed; preview render simply returns empty. Ghost preview visualization is deferred to Ch15.

### 5.3 Transforms and Demolition Activity Stubs

Both `Transforms` and `Demolition` create Activity instances (`Transform` and `Demolish`). These activities have their full implementation in Chapter 14. For Phase B, we need:

- Activity stub classes in `src/OpenRA.Game/Activities/` with the same constructor signatures
- The stub does nothing (just logs or no-ops)
- Full behavior is deferred to Ch14

This is already accounted for in the plan (Ch14 dependency noted in section 4.2).

---

## 6. Implementation Order (Recommended Sequence)

```
ROUND 1 (BLOCKERS -- Architect + Developer parallel):
  1.1 Add interfaces to TraitsInterfaces.ts:
      - ITargetableCells
      - IPlaceBuildingDecorationInfo
      - IDemolishable, IDemolishableInfo
      - IPlaceBuildingPreview, IPlaceBuildingPreviewGeneratorInfo
      - IOrderGenerator (full interface)
      - EnterBehaviour enum
  1.2 Implement Order Targeters:
      - DeployOrderTargeter.ts
      - UnitOrderTargeter.ts + TargetTypeOrderTargeter.ts
  1.3 Implement Batch 0 prerequisite traits (6 files):
      - GivesBuildableArea.ts
      - LineBuildNode.ts
      - Replacement.ts
      - Replaceable.ts
      - Plug.ts
      - Pluggable.ts
  1.4 Upgrade ActorMap stub:
      - Add GetActorsAt(cell), AddInfluence, RemoveInfluence to ActorMapStub
      - Add AddToMaps, RemoveFromMaps to World/GameWorldManager

ROUND 2 (CORE -- Developer, sequential):
  2.1 BuildingInfluence.ts (TODO-11.B.2)
  2.2 BuildingUtils.ts (TODO-11.B.10)
  2.3 Building.ts (TODO-11.B.1) -- largest file

ROUND 3 (SUPPORTING -- Developer, parallel):
  3.1 BaseBuilding.ts (TODO-11.B.3)
  3.2 RequiresBuildableArea.ts (TODO-11.B.9)
  3.3 PlaceBuildingVariants.ts (TODO-11.B.6)
  3.4 LineBuild.ts (TODO-11.B.8)
  3.5 MapBuildRadius.ts (TODO-11.B.15)
  3.6 BaseProvider.ts (TODO-11.B.4)

ROUND 4 (PLACEMENT CHAIN -- Developer, sequential):
  4.1 PlaceBuilding.ts (TODO-11.B.5)
  4.2 PlaceBuildingOrderGenerator.ts (TODO-11.B.16)

ROUND 5 (GAMEPLAY -- Developer, parallel):
  5.1 RepairableBuilding.ts (TODO-11.B.11)
  5.2 Gate.ts (TODO-11.B.12)
  5.3 Transforms.ts (TODO-11.B.13)
  5.4 Demolition.ts (TODO-11.B.14)
```

---

## 7. Revised Phase B File Count

| Category | Count | Files |
|----------|-------|-------|
| Original Phase B plan | 15 | TODO-11.B.1 through B.16 (minus B.7) |
| REQUIRED additions (Batch 0) | 6 | GivesBuildableArea, LineBuildNode, Replacement, Replaceable, Plug, Pluggable |
| REQUIRED additions (Interfaces) | ~8 entries in TraitsInterfaces.ts | ITargetableCells, IPlaceBuildingDecorationInfo, IDemolishable*, IPlaceBuildingPreview*, IOrderGenerator, EnterBehaviour |
| REQUIRED additions (Orders) | 2 | DeployOrderTargeter.ts, UnitOrderTargeter.ts |
| DEFERRED from plan | 0 | All 15 original files are included |
| DEFERRED to future | 5 preview renders + 7 TransformsInto + 5 bridges + 2 free actors = 19 | See section 3.3 |

**Phase B total**: 21 new source files + interface additions + 2 order targeter files = ~23 TS migration units.

---

## 8. Summary of Findings

1. **All 15 original file paths are correct.** No path corrections needed.

2. **6 critical dependency files are missing from the plan** and must be added as Phase B-0 prerequisites before any Phase B file can be implemented. These are all small files (<160 lines C# each).

3. **ActorMap is the single biggest blocker.** The current stub has zero functionality. Phase B needs at minimum `AddInfluence`, `RemoveInfluence`, and `GetActorsAt(cell)`. The full SubCell-aware implementation can be deferred.

4. **The IOrderGenerator interface must be fully defined** (not a stub) for PlaceBuildingOrderGenerator to implement it.

5. **Building (356 lines C#) and PlaceBuildingOrderGenerator (337 lines C#) are the two highest-risk files.** Both depend on a tall stack of prerequisites. Building must be done in Round 2 (after prerequisites and BuildingInfluence/BuildingUtils). PlaceBuildingOrderGenerator must be done in Round 4 (after PlaceBuilding).

6. **DeployOrderTargeter (46 lines) and UnitOrderTargeter (89 lines) should be in Batch 0** as they are needed by Transforms and Demolition respectively.

7. **Three preview renderer files (~380 lines C# combined) are deferred to Chapter 15.** PlaceBuildingOrderGenerator can function without ghost previews by stubbing the preview render method.

8. **19 files from the Buildings/ and related directories are deferred**, including: 5 bridge files, 7 TransformsInto variants, 2 FreeActor variants, 3 preview renderers, and 2 miscellaneous traits.
