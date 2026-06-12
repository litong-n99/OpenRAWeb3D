# Chapter 8 Phase B -- Projectiles System: Architecture Design Specification

> **Architect**: Migration Architect
> **Date**: 2026-06-12
> **Status**: DESIGN -- Ready for Manager approval
> **Blocked by**: Phase A (15 warheads -- COMPLETE), Bullet.ts (Chapter 7 Phase F -- COMPLETE)
> **Blocks**: Phase C (WeaponInfo references projectile types), Phase D (Armament creates projectiles on fire)

---

## 1. Executive Summary

### 1.1 Scope

| Metric | Value |
|--------|-------|
| **Files to migrate** | 7 |
| **Total C# source lines** | 2,166 |
| **Estimated TS implementation lines** | ~3,100 |
| **Estimated TS test lines** | ~2,400 |
| **Complexity range** | LOW (InstantHit, 96 lines) to HIGH (Missile, 980 lines) |
| **Reference implementation** | `src/OpenRA.Mods.Common/Projectiles/Bullet.ts` (1,470 lines, 56 tests) |

### 1.2 File Inventory

| # | TODO | OpenRA Source | Target TS | C# Lines | Complexity |
|:--:|:------|:---|:---|:---:|:---:|
| 1 | TODO-8.B.1 | `Missile.cs` | `src/OpenRA.Mods.Common/Projectiles/Missile.ts` | 980 | **HIGH** |
| 2 | TODO-8.B.2 | `AreaBeam.cs` | `src/OpenRA.Mods.Common/Projectiles/AreaBeam.ts` | 297 | MEDIUM |
| 3 | TODO-8.B.3 | `Railgun.cs` | `src/OpenRA.Mods.Common/Projectiles/Railgun.ts` | 257 | MEDIUM |
| 4 | TODO-8.B.4 | `LaserZap.cs` | `src/OpenRA.Mods.Common/Projectiles/LaserZap.ts` | 217 | MEDIUM |
| 5 | TODO-8.B.5 | `NukeLaunch.cs` | `src/OpenRA.Mods.Common/Projectiles/NukeLaunch.ts` | 173 | MEDIUM |
| 6 | TODO-8.B.6 | `GravityBomb.cs` | `src/OpenRA.Mods.Common/Projectiles/GravityBomb.ts` | 146 | LOW |
| 7 | TODO-8.B.7 | `InstantHit.cs` | `src/OpenRA.Mods.Common/Projectiles/InstantHit.ts` | 96 | LOW |

### 1.3 Dependencies

```
Phase A (Warheads -- 15 files, COMPLETE)
    │
    ├─► Bullet.ts (Ch7 Phase F, COMPLETE) ── reference patterns
    │
    └─► Phase B (Projectiles -- this spec, 7 files)
         │
         ├─► Missile ──────── (standalone, uses ContrailLogic + SpriteEffect)
         ├─► AreaBeam ─────── (standalone, uses BeamRenderable pattern)
         ├─► Railgun ──────── (standalone, uses BeamRenderable + Animation)
         ├─► LaserZap ─────── (standalone, uses BeamRenderable + Animation + SpriteEffect)
         ├─► NukeLaunch ───── (standalone, uses Animation + SpriteEffect + Sound)
         ├─► GravityBomb ──── (standalone, uses Animation)
         └─► InstantHit ───── (standalone, no visuals)
                            │
                            └─► Phase C (WeaponInfo factory references)
```

All 7 projectiles share these dependencies already migrated:
- `WPos`, `WVec`, `WDist`, `WAngle`, `WRot` -- Chapter 3 Phase A (COMPLETE)
- `IEffect`, `ISpatiallyPartitionable` -- `src/OpenRA.Game/Effects/IEffect.ts` (COMPLETE)
- `Warhead`, `WarheadArgs`, `WarheadEffect` -- Phase A (COMPLETE)
- `Target`, `TargetType` -- Chapter 3 (COMPLETE)
- `GameWorldManager` stub -- Chapter 3 (COMPLETE)
- `Animation` stub -- Chapter 2 (COMPLETE)
- `SpriteEffect` -- Chapter 7 Phase E (COMPLETE)
- `ContrailLogic` -- defined in `Bullet.ts` (COMPLETE)

---

## 2. Interface Design

### 2.1 IProjectile (already defined in Bullet.ts -- REUSE AS-IS)

The `IProjectile` interface from `Bullet.ts` (lines 60-66) is the canonical interface for all projectiles:

```typescript
export interface IProjectile extends IEffect {
  readonly isDestroyed: boolean
}
```

All 7 new projectiles implement this interface directly. No changes needed.

### 2.2 ProjectileArgs (already defined in Bullet.ts -- EXTEND)

The existing `ProjectileArgs` interface (Bullet.ts lines 81-129) is sufficient for 4 of the 7 projectiles (GravityBomb, InstantHit, AreaBeam, LaserZap, Railgun). Two projectiles need extensions:

**Missile** requires additional fields:

```typescript
// Extension to ProjectileArgs for Missile
interface MissileArgs extends ProjectileArgs {
  /** Range modifiers applied to weapon range (for fuel limit calculation).
   *  OpenRA: args.RangeModifiers (int[])
   */
  rangeModifiers: number[]
}
```

-Note: The Bullet already has `inaccuracySource`, `facing`, etc. Missile needs `RangeModifiers` which is not currently in `ProjectileArgs`. This should be added as an optional field to `ProjectileArgs` rather than creating a separate interface, since other projectiles may also use range modifiers (e.g., AreaBeam uses `Util.ApplyPercentageModifiers(args.Weapon.Range.Length, args.RangeModifiers)`).

**NukeLaunch** does NOT use `ProjectileArgs`. It has its own constructor signature (NukeLaunch.cs lines 50-53) that accepts `Player`, `image`, `WeaponInfo`, launch/target positions, velocity, delays, and trail config. It is a special-case projectile created by the `NukePower` support power, not by `Armament`. We will model this as a standalone constructor with a `NukeLaunchConfig` parameter interface.

**Decision**: Extend `ProjectileArgs` to include optional `rangeModifiers: number[]`. Add `NukeLaunchConfig` as a separate config interface for that projectile.

### 2.3 Factory / Registry Pattern

OpenRA uses `IProjectileInfo.Create(ProjectileArgs)` for runtime instantiation. In TypeScript we use factory functions (same pattern as `BulletFactory`).

All 7 projectiles export a factory object:

```typescript
// Example for Missile
export const MissileFactory = {
  create(info: MissileInfo, args: ProjectileArgs): Missile {
    return new Missile(info, args)
  },
}

// Registry for Phase C (WeaponInfo) lookup
export const ProjectileTypes = {
  Bullet: BulletFactory,
  Missile: MissileFactory,
  AreaBeam: AreaBeamFactory,
  Railgun: RailgunFactory,
  LaserZap: LaserZapFactory,
  NukeLaunch: NukeLaunchFactory,  // Note: may need special factory
  GravityBomb: GravityBombFactory,
  InstantHit: InstantHitFactory,
} as const

export type ProjectileTypeName = keyof typeof ProjectileTypes
```

The registry is exported from a new barrel file: `src/OpenRA.Mods.Common/Projectiles/ProjectileRegistry.ts`.

### 2.4 ProjectileInfo Config Interfaces

Each projectile has its own `*Info` config interface (matching the C# `*Info` class). These are plain data interfaces, not classes, following the `BulletInfo` pattern:

- `MissileInfo` -- 30+ fields (all config fields from `MissileInfo` class)
- `AreaBeamInfo` -- 12 fields
- `RailgunInfo` -- 17 fields
- `LaserZapInfo` -- 16 fields
- `NukeLaunchConfig` -- 13 fields (different name to distinguish from Info pattern)
- `GravityBombInfo` -- 6 fields
- `InstantHitInfo` -- 4 fields

### 2.5 Disposal Pattern

Following `Bullet.dispose()` pattern, any projectile creating a `ContrailLogic` must dispose it. Projectiles that create Babylon.js GPU resources (Meshes, LinesMesh) must also dispose those. At this stage, GPU resources will be deferred with TODO markers; the immediate implementation focuses on logic.

```typescript
export interface DisposableProjectile {
  /** Dispose logic-side resources (contrail, etc.).
   *  GPU resources are disposed by the render layer. */
  dispose(): void
}
```

### 2.6 BeamRenderableShape Enum (shared by AreaBeam, Railgun, LaserZap)

```typescript
export const BeamRenderableShape = {
  Cylindrical: 0,
  Flat: 1,
} as const
export type BeamRenderableShape = (typeof BeamRenderableShape)[keyof typeof BeamRenderableShape]
```

This enum is shared by AreaBeam, Railgun, and LaserZap. Place it in a shared file: `src/OpenRA.Mods.Common/Projectiles/BeamRenderableShape.ts` (or add to a shared projectiles types file).

---

## 3. Per-File Detailed Design

### 3.1 Missile (`TODO-8.B.1`) -- HIGH Complexity -- Implementation Order: 4th

**Source**: `OpenRA/OpenRA.Mods.Common/Projectiles/Missile.cs` (980 lines)

#### 3.1.1 Key Data Structures

```typescript
// Missile state machine (C# enum States)
export const MissileState = {
  Freefall: 0,   // Initial launch phase, no homing
  Homing: 1,     // Actively tracking target
  Hitting: 2,    // Final approach (within 3 * loopRadius or target passed)
} as const
export type MissileState = (typeof MissileState)[keyof typeof MissileState]
```

**MissileInfo config fields** (30+ fields matching C# `MissileInfo`):
- `image: string | null` -- sprite sheet name
- `sequences: string[]` -- idle animation sequences (default `['idle']`)
- `palette: string` -- palette name (default `'effect'`)
- `isPlayerPalette: boolean`
- `shadow: boolean`
- `shadowColor: readonly [number, number, number, number]` -- RGBA
- `minimumLaunchAngle: WAngle` -- min pitch (default `new WAngle(-64)`)
- `maximumLaunchAngle: WAngle` -- max pitch (default `new WAngle(128)`)
- `minimumLaunchSpeed: WDist` -- default -1 means use Speed
- `maximumLaunchSpeed: WDist` -- default -1 means use Speed
- `speed: WDist` -- max speed in WDist/tick (default 384)
- `acceleration: WDist` -- acceleration per tick (default 5)
- `arm: number` -- arming delay in ticks (cannot detonate before)
- `blockable: boolean` -- blocked by IBlocksProjectiles
- `terrainHeightAware: boolean` -- aware of terrain heights
- `width: WDist` -- collision width
- `inaccuracy: WDist`
- `inaccuracyType: InaccuracyType`
- `lockOnInaccuracy: WDist` -- override when locked on (default -1 = use Inaccuracy)
- `lockOnProbability: number` -- 0-100 (default 100)
- `horizontalRateOfTurn: WAngle` -- per-tick turn rate (default 20)
- `verticalRateOfTurn: WAngle` -- per-tick turn rate (default 24)
- `gravity: number` -- gravity applied in freefall (default 10)
- `rangeLimit: WDist` -- fuel range, 0 defaults to weapon range (default 0)
- `explodeWhenEmpty: boolean` -- explode on fuel out (default true)
- `airburstAltitude: WDist` -- explode below this altitude (default 0)
- `cruiseAltitude: WDist` -- cruise altitude (default 512)
- `homingActivationDelay: number` -- ticks before homing activates (default 0)
- `trailImage: string | null` -- trail particle image
- `trailSequences: string[]`
- `trailPalette: string`
- `trailUsePlayerPalette: boolean`
- `trailInterval: number` -- ticks between trail spawns (default 2)
- `trailWhenDeactivated: boolean` -- spawn trail even in freefall
- `contrailLength: number` -- contrail length in ticks (default 0)
- `contrailDelay: number` -- delay before contrail appears (default 1)
- `contrailZOffset: number` -- Z-offset (default 2047)
- `contrailStartWidth: WDist` -- start width (default 64)
- `contrailEndWidth: WDist | null` -- end width, defaults to startWidth
- `contrailStartColor: readonly [number, number, number, number]`
- `contrailStartColorUsePlayerColor: boolean`
- `contrailEndColor: readonly [number, number, number, number] | null`
- `contrailEndColorUsePlayerColor: boolean`
- `contrailStartColorAlpha: number` -- 0-255 (default 255)
- `contrailEndColorAlpha: number` -- 0-255 (default 0)
- `jammable: boolean` -- affected by JamsMissiles (default true)
- `jammedDiversionRange: number` -- facing deviation when jammed (default 20)
- `boundToTerrainType: string` -- explode when leaving this terrain (e.g., "Water")
- `allowSnapping: boolean` -- snap to target when close (default false)
- `closeEnough: WDist` -- proximity to target for detonation (default 298)

#### 3.1.2 State Machine

The missile has three states with the following transitions:

```
         +----------+      ticks >= HomingActivationDelay + 1      +--------+
start -> | Freefall | -------------------------------------------> | Homing |
         +----------+                                              +--------+
              ^                                                         |
              |   distanceCovered > rangeLimit                          |
              +---------------------------------------------------------+
              |                                                         |
              |                              relTarHorDist <= 3*loopRadius
              |                              OR state forced to Hitting
              v                                                         |
         (continues)                                              +---------+
                                                                  | Hitting |
                                                                  +---------+
```

**Freefall** (lines 489-499 C#):
- `velocity += gravity` each tick
- speed clamped to `maxSpeed` via `velRatio = maxSpeed * 1024 / velocity.Length`
- position updated by `velocity + gravity / 2`

**Homing** (lines 777-835 C#):
- Complex angle computation via `HomingInnerTick()`
- `Util.TickFacing()` for smooth angle interpolation
- `InclineLookahead()` for terrain height awareness
- Jamming check via `JammedBy()`
- Turn rate limitation via `info.HorizontalRateOfTurn` / `info.VerticalRateOfTurn`

**Hitting** (lines 621-741 C#):
- Final approach phase when within `3 * loopRadius` of target
- `allowPassBy` logic: missile can fly past target and loop back
- `ChangeSpeed()` for deceleration/acceleration

**Key math functions** (static in C#, ported as module-level functions):
- `loopRadius(speed, rot)` -- computes loop radius from speed and rotation rate
- `willClimbWithinDistance(vFacing, loopRadius, predClfDist, diffClfMslHgt)` -- incline climbing check
- `willClimbAroundInclineTop(vFacing, loopRadius, predClfDist, diffClfMslHgt)` -- arc over incline top
- `isNearInclineTop(vFacing, loopRadius, predClfDist)` -- proximity check
- `bisectionSearch(lowerBound, upperBound, testCriterion)` -- binary search utility

#### 3.1.3 Interaction with Tick, Render, Explode

**Tick** (lines 837-926 C#):
1. Increment `ticks`
2. Animate sprite (`anim?.Tick()`)
3. State transition: Freefall->Homing at `homingActivationDelay + 1`
4. State transition: Homing->Freefall when fuel runs out
5. Update target position if guided target is valid
6. Compute predicted target velocity (`predVel`)
7. Compute `move` based on state (FreefallTick or HomingTick)
8. Update render facing
9. Check blocking actors
10. Spawn trail smoke (SpriteEffect)
11. Update contrail
12. Increment `distanceCovered`
13. Check explosion conditions

**Explosion conditions** (line 917-922 C# -- any one triggers explode):
- `height.Length < 0` -- hit terrain
- `relTarDist < info.CloseEnough.Length` -- close enough to target
- `out of fuel && info.ExplodeWhenEmpty` -- fuel exhausted
- `!world.Map.Contains(cell)` -- out of bounds
- `boundToTerrainType` mismatch -- left valid terrain (e.g., torpedo leaving water)
- Airburst altitude check

**Explode** (lines 928-945 C#):
1. Create `ContrailFader` for graceful contrail fade-out
2. Self-remove from world (`w.Remove(this)`)
3. Return early if not yet armed (`ticks <= info.Arm`)
4. Build `WarheadArgs` with `ImpactOrientation` and `ImpactPosition`
5. Call `args.Weapon.Impact(Target.FromPos(pos), warheadArgs)`

**Render** (lines 948-978 C#):
1. Yield contrail if active
2. Skip if no animation
3. Skip if fog-obscured
4. Compute palette name (append player name if `IsPlayerPalette`)
5. If shadow enabled: render shadow sprite at terrain height with tinted color
6. Render main animation sprite

#### 3.1.4 3D Rendering Approach

- **Missile body**: `MeshBuilder.CreatePlane()` with UV offset from sprite sheet. Rotated via `Quaternion.Slerp` based on `hFacing`/`vFacing` angles.
- **Contrail**: Follows `ContrailLogic` pattern from Bullet.ts. GPU rendering deferred (TODO-8.B.1-TRAIL).
- **Shadow**: Plane mesh at terrain height with shadow color, positioned below missile (deferred to render integration -- TODO-8.B.1-SHADOW).
- **Trail smoke**: `SpriteEffect` via `world.addEffect()` -- already implemented.

#### 3.1.5 Collision Detection

Missile uses `BlocksProjectiles.AnyBlockingActorsBetween()` (C# line 896) which can be mapped to a callback like `BlockingActorsChecker` in Bullet.ts. Additionally:
- Terrain height check via `world.Map.DistanceAboveTerrain(pos)` (deferred to Map integration -- TODO-8.B.1-TERRAIN)
- Map boundary check via `world.Map.Contains(cell)` (deferred -- TODO-8.B.1-MAP)
- Terrain type check via `world.Map.GetTerrainInfo(cell).Type` (deferred -- TODO-8.B.1-TERRAINTYPE)

#### 3.1.6 Migration Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Complex homing math (determinism) | HIGH | Port all math functions exactly, 100% test coverage on trajectory |
| `InclineLookahead` / terrain height awareness | HIGH | Defer terrain integration, test math functions in isolation |
| Jamming / JamsMissiles trait | MEDIUM | Callback pattern like blocking actors checker |
| Fuel range vs weapon range calculation | LOW | Clear separation in static function |
| `ContrailFader` effect (C# only) | MEDIUM | Defer to Phase E with TODO, immediate explode removes contrail |
| Predicted target velocity (`tarVel`/`predVel`) | MEDIUM | Port tracking math exactly, test with linear/stationary targets |

---

### 3.2 AreaBeam (`TODO-8.B.2`) -- MEDIUM Complexity -- Implementation Order: 3rd

**Source**: `OpenRA/OpenRA.Mods.Common/Projectiles/AreaBeam.cs` (297 lines)

#### 3.2.1 Key Data Structures

```typescript
interface AreaBeamInfo {
  speed: readonly WDist[]            // 1-2 values, random within range if 2
  duration: number                   // max beam burst duration in ticks (default 10)
  damageInterval: number             // ticks between damage applications (default 3)
  width: WDist                       // beam width for collision/damage (default 512)
  shape: BeamRenderableShape         // Cylindrical or Flat (default Cylindrical)
  beyondTargetRange: WDist           // overshoot distance (default 0)
  minDistance: WDist                 // minimum beam travel (default 0)
  falloff: readonly number[]         // damage % at each range step (default [100, 100])
  range: readonly WDist[]            // range thresholds (default [0, int.MaxValue-like])
  inaccuracy: WDist
  inaccuracyType: InaccuracyType
  blockable: boolean                 // blocked by IBlocksProjectiles (default false)
  trackTarget: boolean               // beam follows moving target (default false)
  renderBeam: boolean                // visually rendered (default true)
  zOffset: number                    // Z-sort (default 0)
  color: readonly [number, number, number, number]  // RGBA
  usePlayerColor: boolean
}
```

#### 3.2.2 State Machine

AreaBeam has a simple two-phase lifecycle:

```
Phase 1: Head travelling          Phase 2: Tail travelling
[source]---head---moving--------->target    [source]---tail---catching up--->target
          tail at source                     tail moving toward target

Both phases: damage applied every damageInterval to actors on line

Complete: head reached target AND tail reached target -> self-remove
```

Key state variables:
- `headPos`: current position of beam head (travels from source toward target)
- `tailPos`: current position of beam tail (starts at source, follows head after `duration` ticks)
- `isHeadTravelling`, `isTailTravelling`: flags
- `headTicks`, `tailTicks`: counters for lerp interpolation
- `continueTracking`: whether beam still tracks target

**Tick** (lines 197-268 C#):
1. Track target if `info.TrackTarget` (updates target position)
2. If head reached target: `isHeadTravelling = false`
3. If head travelling: `headPos = WPos.LerpQuadratic(source, target, 0, headTicks, length)`
4. Tail starts travelling after `info.Duration` ticks or if source actor dies/not aiming
5. If tail travelling: `tailPos = WPos.LerpQuadratic(...)`
6. Check blocking actors between tail and head
7. Every `damageInterval` ticks: find actors on line, apply warhead damage with `GetFalloff()`

#### 3.2.3 Damage Application (C# lines 245-265)

AreaBeam uses `world.FindActorsOnLine(tailPos, headPos, info.Width)` which is a 2D cell-grid query. In TypeScript, this is replaced by a callback:

```typescript
type FindActorsOnLineCallback = (
  world: GameWorldManager,
  from: WPos,
  to: WPos,
  width: WDist,
) => IGameActor[]
```

Each found actor receives a `WarheadArgs` with `DamageModifiers` including the falloff percentage from `GetFalloff(distance)`.

#### 3.2.4 3D Rendering Approach

- **Beam body**: Babylon.js `LinesMesh` with `Color3.FromArray(color)`. Width 1 (Babylon.js lines are fixed-width). The `Cylindrical` vs `Flat` shape distinction in the C# code (C# uses `RgbaColorRenderer.DrawLine` vs `FillRect`) maps to:
  - **Cylindrical**: `LinesMesh` (line from tailPos to headPos, projected into 3D world coordinates)
  - **Flat**: `MeshBuilder.CreatePlane()` -- a flat ribbon oriented in world space with width = `info.Width`. This will require computing perpendicular vectors to the beam direction.
- **Fade**: Beam alpha can be modulated by animation phase (head travel complete -> tail catching up -> fade).
- **Color**: Player color or config color applied as vertex color.

**Paradigm shift**: C# uses screen-space line drawing (`RgbaColorRenderer.DrawLine`). TypeScript uses world-space `LinesMesh` or `Plane` mesh. The `CoordinateTransformer` class (Phase I) maps world positions to 3D scene coordinates.

#### 3.2.5 Collision Detection

- Blocking actors: `BlockingActorsChecker` callback (same as Bullet)
- Actor-on-line: `FindActorsOnLineCallback` for damage application
- No terrain collision -- beam is instant along its path

#### 3.2.6 Migration Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `FindActorsOnLine` spatial query | MEDIUM | Defer with callback pattern; test with mock |
| Flat beam shape 3D geometry | LOW | Compute perpendicular vectors from beam direction |
| Target tracking edge case | LOW | Follow C# logic exactly for tracking state machine |

---

### 3.3 Railgun (`TODO-8.B.3`) -- MEDIUM Complexity -- Implementation Order: 2nd

**Source**: `OpenRA/OpenRA.Mods.Common/Projectiles/Railgun.cs` (257 lines)

#### 3.3.1 Key Data Structures

```typescript
interface RailgunInfo {
  damageActorsInLine: boolean        // damage all on beam, not just target (default false)
  inaccuracy: WDist
  inaccuracyType: InaccuracyType
  blockable: boolean                   // default false
  duration: number                     // beam/helix persistence (default 15)
  zOffset: number                      // default 0
  beamWidth: WDist                     // beam visual width (default 86)
  beamShape: BeamRenderableShape       // default Cylindrical
  beamColor: readonly [number, number, number, number]  // RGBA
  beamPlayerColor: boolean
  beamAlphaDeltaPerTick: number        // beam fade per tick (default -8)
  helixThickness: WDist                // helix line thickness (default 32)
  helixRadius: WDist                   // spiral radius (default 64)
  helixPitch: WDist                    // height of one turn (default 512)
  helixRadiusDeltaPerTick: number      // radius expansion per tick (default 8)
  helixAlphaDeltaPerTick: number       // helix fade per tick (default -8)
  helixAngleDeltaPerTick: WAngle       // helix rotation per tick (default 16)
  quantizationCount: number            // steps per helix cycle (default 16)
  helixColor: readonly [number, number, number, number]  // RGBA
  helixPlayerColor: boolean
  hitAnim: string | null               // impact animation image
  hitAnimSequence: string              // default 'idle'
  hitAnimPalette: string               // default 'effect'
}
```

#### 3.3.2 State Machine

Railgun is simpler than AreaBeam -- it has no travelling head/tail:

```
tick 0: Calculate vectors, apply damage (once), start animation
tick 1..duration: Animate, degrade beam alpha, spin helix
tick > duration AND animation complete: Self-remove
```

Key computed vectors (computed once at construction, C# `CalculateVectors()`):
- `sourceToTarget: WVec` -- direction vector
- `forwardStep: WVec` -- helix step per quantization count
- `leftVector: WVec` -- perpendicular to forwardStep, 0 Z component, unit vector (1024)
- `upVector: WVec` -- perpendicular to both leftVector and forwardStep, unit vector (1024)
- `angleStep: WAngle` -- rotation per step = 1024 / quantizationCount
- `cycleCount: number` -- number of complete helix turns

#### 3.3.3 Damage Application

C# lines 203-230:
- If `!info.DamageActorsInLine`: single warhead impact at `target`
- If `info.DamageActorsInLine`: find actors on line, apply warhead to each

This follows the same `FindActorsOnLineCallback` pattern as AreaBeam.

#### 3.3.4 3D Rendering Approach

Railgun has TWO visual components (C# lines 247-249):

1. **Helix**: `RailgunHelixRenderable` -- a spiral coiling around the beam axis
   - Built from parametric points: `pos = source + i * forwardStep + helixRadius * (cos(i * angleStep) * leftVector + sin(i * angleStep) * upVector)`
   - In Babylon.js: `LinesMesh` with points computed each frame (or on tick 0 if no animation)
   - Radius grows per tick by `helixRadiusDeltaPerTick`
   - Alpha degrades per tick by `helixAlphaDeltaPerTick`
   - Color: player color or config color

2. **Beam**: `BeamRenderable` -- straight line from source to computed endpoint
   - In Babylon.js: `LinesMesh` or `MeshBuilder.CreateCylinder()`
   - Alpha degrades per tick by `beamAlphaDeltaPerTick`

3. **Impact animation** (if `hitAnim` set): `Animation` with `PlayThen` at target position

**Paradigm shift**: C# `RailgunHelixRenderable` (CPU line rendering) -> Babylon.js `LinesMesh` with precomputed helix points updated each frame. The `Mesh.AddPoint()` or `LinesMesh` update pattern handles the animation.

#### 3.3.5 Integration Notes

The C# `Railgun` class exposes computed vectors (`SourceToTarget`, `ForwardStep`, etc.) as public properties because `RailgunHelixRenderable` (a separate class) reads them. In TypeScript, the helix rendering can be internal to the Railgun class via a private `_generateHelixPoints()` method, avoiding the need for public exposure.

---

### 3.4 LaserZap (`TODO-8.B.4`) -- MEDIUM Complexity -- Implementation Order: 1st

**Source**: `OpenRA/OpenRA.Mods.Common/Projectiles/LaserZap.cs` (217 lines)

#### 3.4.1 Key Data Structures

```typescript
interface LaserZapInfo {
  width: WDist                          // beam visual width (default 86)
  shape: BeamRenderableShape            // default Cylindrical
  zOffset: number                       // default 0
  duration: number                      // beam persistence (default 10)
  damageDuration: number                // ticks beam deals damage (default 1)
  damageInterval: number                // ticks between damage (default 1)
  usePlayerColor: boolean
  color: readonly [number, number, number, number]  // RGBA (default Red)
  trackTarget: boolean                  // beam follows target (default true)
  inaccuracy: WDist
  inaccuracyType: InaccuracyType
  blockable: boolean                    // default false
  // Secondary beam (glow effect)
  secondaryBeam: boolean                // default false
  secondaryBeamWidth: WDist             // default 86
  secondaryBeamShape: BeamRenderableShape
  secondaryBeamZOffset: number
  secondaryBeamUsePlayerColor: boolean
  secondaryBeamColor: readonly [number, number, number, number]
  // Impact animation
  hitAnim: string | null
  hitAnimSequence: string               // default 'idle'
  hitAnimPalette: string               // default 'effect'
  // Launch effect
  launchEffectImage: string | null
  launchEffectSequence: string | null
  launchEffectPalette: string           // default 'effect'
}
```

#### 3.4.2 State Machine

LaserZap is the simplest beam projectile:

```
tick 0: Apply damage (if within damageDuration), spawn launch effect, start hit animation
tick 1..damageDuration: Continue applying damage per damageInterval
tick > damageDuration: Visual-only beam, continue hit animation
tick >= duration AND hit animation complete: Self-remove
```

Key differences from AreaBeam:
- No travelling head/tail -- beam is **instant** from source to target
- Damage is applied at impact point (not line-of-sight)
- Visual beam persists for `duration` ticks (aesthetic only after `damageDuration`)
- Beam alpha fades: `(duration - ticks) * color.A / duration`

#### 3.4.3 3D Rendering Approach

- **Primary beam**: Babylon.js `LinesMesh` from source to target, with fading alpha
- **Secondary beam** (if enabled): Second `LinesMesh` with different offset/color for glow effect
- **Hit animation**: `Animation` at target position (same as Railgun)
- **Launch effect**: `SpriteEffect` at source position (spawned on tick 0)

**Paradigm shift**: C# `BeamRenderable` (screen-space line) -> Babylon.js `LinesMesh` (world-space line). Coordinate transformation handled by `CoordinateTransformer`.

#### 3.4.4 Collision Detection

- Blocking actors: `BlockingActorsChecker` callback. If blocked, beam endpoint = blocked position.
- Target tracking: If `trackTarget` and guided target valid, update target each tick.
- No terrain collision.

---

### 3.5 NukeLaunch (`TODO-8.B.5`) -- MEDIUM Complexity -- Implementation Order: 6th (mostly independent)

**Source**: `OpenRA/OpenRA.Mods.Common/Effects/NukeLaunch.cs` (173 lines)

Note: This is in the `OpenRA.Mods.Common.Effects` namespace, not `Projectiles`, but it implements `IProjectile`. Target path: `src/OpenRA.Mods.Common/Projectiles/NukeLaunch.ts`.

#### 3.5.1 Key Data Structures

NukeLaunch does NOT use `ProjectileArgs`. It has a custom constructor (15 parameters):

```typescript
interface NukeLaunchConfig {
  firedBy: PlayerStub
  image: string | null                 // missile sprite sheet
  weapon: WeaponStub                   // weapon to impact with
  weaponPalette: string                // palette for missile sprite
  upSequence: string                   // ascent animation sequence
  downSequence: string                 // descent animation sequence
  launchPos: WPos                      // launch position
  targetPos: WPos                      // target position
  detonationAltitude: WDist            // height at which to detonate
  removeOnDetonation: boolean          // self-remove on detonate
  velocity: WDist                      // upward velocity
  launchDelay: number                  // ticks before launch
  impactDelay: number                  // total ticks before impact
  skipAscent: boolean                  // skip ascent phase
  // Trail
  trailImage: string | null
  trailSequences: string[]
  trailPalette: string
  trailUsePlayerPalette: boolean
  trailDelay: number
  trailInterval: number
}
```

#### 3.5.2 State Machine

```
Phase 1: Launch Delay (launchDelay ticks)
  - Do nothing, count down

Phase 2: Ascent (turn = impactDelay / 2 ticks)
  - Play upSequence animation (repeating)
  - Quadratic lerp from ascendSource to ascendTarget
  - Spawn trail SpriteEffects
  - Sound: Play weapon.Report

Phase 3: Descent (remaining impactDelay - turn ticks)
  - At tick == turn: switch animation to downSequence
  - Quadratic lerp from descendSource to descendTarget
  - Spawn trail SpriteEffects

Detonation (when ticks == impactDelay or (descending && distanceAboveTerrain <= detonationAltitude)):
  - Explode: weapon.Impact(), detonated flag
  - If removeOnDetonation: self-remove from world + ScreenMap
```

**Key positions** (C# constructor lines 73-83):
```
ascendSource = launchPos
ascendTarget = launchPos + WVec(0, 0, velocity * (impactDelay - turn))
descendSource = targetPos + WVec(0, 0, velocity * (impactDelay - turn))
descendTarget = targetPos
```

The missile goes straight up from launchPos, then straight down to targetPos. This creates a "U" shaped trajectory (vertical ascent + vertical descent).

#### 3.5.3 3D Rendering Approach

- **Missile body**: `Mesh` with `Animation` sprite (upSequence during ascent, downSequence during descent)
- **Trail**: `SpriteEffect` particles spawned at delayed position along trajectory
- **Detonation**: Handled by warhead's `CreateEffect` (sprite explosion, screen flash, etc.)
- **Vertical line**: Optional visual beam from missile to ground during descent (can be added as a secondary effect)

**Paradigm shift**: C# 2D sprite-based missile + ScreenMap spatial registration -> 3D `Mesh` with animated sprite texture + Babylon.js spatial indexing (frustum culling).

#### 3.5.4 Integration Notes

- `ISpatiallyPartitionable` is implemented for ScreenMap registration (C# line 21). In TypeScript, implement the interface as a marker (same as Bullet).
- Sound: NukeLaunch calls `Game.Sound.Play()` directly. This should be replaced by `world.playSound()` or a sound callback (deferred to Sound integration -- TODO-8.B.5-SOUND).
- `world.ScreenMap.Add/Update/Remove` -- deferred to spatial index integration (TODO-8.B.5-SCREENMAP).

---

### 3.6 GravityBomb (`TODO-8.B.6`) -- LOW Complexity -- Implementation Order: 5th

**Source**: `OpenRA/OpenRA.Mods.Common/Projectiles/GravityBomb.cs` (146 lines)

#### 3.6.1 Key Data Structures

```typescript
interface GravityBombInfo {
  image: string | null                 // sprite sheet name
  sequences: readonly string[]         // default ['idle']
  openSequence: string | null          // opening animation (bomb bay doors)
  palette: string                      // default 'effect'
  isPlayerPalette: boolean
  shadow: boolean
  shadowColor: readonly [number, number, number, number]  // RGBA
  velocity: WVec                       // initial velocity (forward, right, up)
  acceleration: WVec                    // per-tick acceleration (default: 0, 0, -15)
}
```

#### 3.6.2 State Machine

GravityBomb is the simplest physical projectile:

```
tick 0..N:
  lastPos = pos
  pos += velocity
  velocity += acceleration

Detonation: when pos.Z <= target.Z (ground level)
  - Snap to ground: pos.Z = target.Z
  - Self-remove
  - weapon.Impact() at impact position
```

**Note**: GravityBomb uses a fixed world-Z check (`pos.Z <= args.PassiveTarget.Z`), not terrain height. The C# code assumes the target is at ground level. Terrain height awareness is not implemented in the C# version (unlike Missile which has `TerrainHeightAware`).

#### 3.6.3 3D Rendering Approach

- **Bomb body**: `MeshBuilder.CreatePlane()` with UV from sprite sheet, same as Bullet/Missile body
- **Shadow**: Plane mesh at ground height with shadow color (same pattern as Missile)
- **OpenSequence**: If set, play `openSequence` once then transition to looping `sequences`
- **Facing**: Always `args.Facing` (no rotation during flight -- C# line 82 passes `() => args.Facing`)

#### 3.6.4 Collision Detection

No `Blockable` / collision detection. Only ground contact check: `pos.Z <= target.Z`. This is purely height-based.

---

### 3.7 InstantHit (`TODO-8.B.7`) -- LOW Complexity -- Implementation Order: 7th (trivial, implement last)

**Source**: `OpenRA/OpenRA.Mods.Common/Projectiles/InstantHit.cs` (96 lines)

#### 3.7.1 Key Data Structures

```typescript
interface InstantHitInfo {
  inaccuracy: WDist
  inaccuracyType: InaccuracyType
  blockable: boolean                     // default false
  width: WDist                           // default 1
  blockerScanRadius: WDist               // default -1 (auto-scale to largest HitShape)
}
```

#### 3.7.2 State Machine

InstantHit has the simplest lifecycle of all:

```
Constructor: Set target (with inaccuracy if applicable)

Tick (once):
  1. If guided target invalid -> fallback to passiveTarget
  2. Check blocking actors (if blockable)
  3. weapon.Impact(target, warheadArgs)
  4. Self-remove from world
```

This projectile exists for exactly one tick. It is used for hitscan weapons (sniper rifles, machine guns, instant-beam weapons).

#### 3.7.3 3D Rendering Approach

**No visual rendering**. `Render()` returns empty array (C# line 91-93). The visual effect is handled by the warhead's `CreateEffect` (muzzle flash, impact explosion).

#### 3.7.4 Collision Detection

- Blocking actors: `BlockingActorsChecker` between source and target
- If blocked: target = blocked position, then apply warhead at blocked position

#### 3.7.5 Integration Notes

This is the simplest projectile in the system. It pairs naturally with `LaserZap` -- the LaserZap provides the visual beam, InstantHit provides the instant damage. Some weapons use both.

---

## 4. 3D Rendering Strategy Summary

### 4.1 Mesh Type Mapping

| Projectile | Visual Element | Babylon.js Primitive | Notes |
|:---|:---|:---|:---|
| All sprites | Missile / bomb body | `MeshBuilder.CreatePlane()` with UV offset | Billboard or oriented to facing |
| All sprites | Shadow | `MeshBuilder.CreatePlane()` at ground height | Tinted with shadow color |
| Missile, Bullet | Contrail | `LinesMesh` with decreasing alpha | Points from `ContrailLogic.positions` |
| AreaBeam | Beam (Cylindrical) | `LinesMesh` | tailPos to headPos |
| AreaBeam | Beam (Flat) | `MeshBuilder.CreatePlane()` with custom vertices | Ribbon in world space |
| Railgun | Main beam | `LinesMesh` or `MeshBuilder.CreateCylinder()` | source to endpoint |
| Railgun | Helix | `LinesMesh` with spiral points | Precomputed each tick |
| LaserZap | Beam | `LinesMesh` | source to target |
| LaserZap | Secondary beam | `LinesMesh` with offset | Glow effect |
| NukeLaunch | Missile body | `MeshBuilder.CreatePlane()` | Billboard |
| All | Trail smoke | `SpriteEffect` (ParticleSystem) | Already implemented in Ch7 Phase E |
| All | Impact animation | Animation sprite mesh | At target position |

### 4.2 Coordinate Transformation

All world positions (`WPos`) must be converted to 3D scene coordinates via `CoordinateTransformer` (Chapter 4 Phase I). This is a consistent pattern across all projectiles.

### 4.3 Contrail / Trail Strategy

Two distinct concepts in OpenRA:

1. **Contrail** (Missile, Bullet): A continuous fading line behind the projectile. Uses `ContrailLogic` (position ring buffer) + future `TrailMesh` (GPU geometry). The `ContrailLogic` class already exists in `Bullet.ts`.

2. **Trail smoke** (Missile, Bullet, NukeLaunch): Discrete `SpriteEffect` particles spawned at intervals behind the projectile. Already implemented via Chapter 7 Phase E.

3. **Beam** (AreaBeam, Railgun, LaserZap): A visible line from source to target/head. Rendered as `LinesMesh`.

---

## 5. Collision Detection Mapping

### 5.1 Blocking Actors (`BlocksProjectiles.AnyBlockingActorsBetween`)

Used by: Missile, AreaBeam, Railgun, LaserZap, InstantHit

**C# pattern**: `BlocksProjectiles.AnyBlockingActorsBetween(world, owner, from, to, width, out blockedPos)` -- returns bool + modifies out param.

**TypeScript pattern**: Callback function of type `BlockingActorsChecker` (defined in Bullet.ts):

```typescript
type BlockingActorsChecker = (
  world: GameWorldManager,
  owner: PlayerStub,
  from: WPos,
  to: WPos,
  width: WDist,
) => WPos | null
```

Returns the blocked position or null if clear.

### 5.2 Actors on Line (`world.FindActorsOnLine`)

Used by: AreaBeam (damage area), Railgun (line damage mode)

**C# pattern**: `world.FindActorsOnLine(from, to, width)` returns `IEnumerable<Actor>`.

**TypeScript pattern**: New callback type:

```typescript
type FindActorsOnLineCallback = (
  world: GameWorldManager,
  from: WPos,
  to: WPos,
  width: WDist,
) => IGameActor[]
```

### 5.3 Terrain Height

Used by: Missile (`TerrainHeightAware`, `InclineLookahead`, `DistanceAboveTerrain`)

Deferred to Map system integration (Chapter 4 Phase D -- Map.ts is COMPLETE). The callback pattern:

```typescript
type TerrainHeightGetter = (pos: WPos) => number  // height in WDist units
type CellContainingGetter = (pos: WPos) => CPos
type MapContainsChecker = (cell: CPos) => boolean
type TerrainTypeGetter = (cell: CPos) => string
```

### 5.4 Target Validity / Jamming

Used by: Missile (`lockOn`, `JammedBy`)

Deferred to trait system integration (Chapter 8 Phase D). The callback pattern:

```typescript
type JammingChecker = (
  world: GameWorldManager,
  pos: WPos,
  sourceOwner: PlayerStub,
  jammable: boolean,
  jammedDiversionRange: number,
) => { jammed: boolean; hFacingOffset: number; vFacingOffset: number }
```

---

## 6. Implementation Order Recommendation

The recommended order balances dependency minimization with progressive complexity:

| Order | File | Rationale |
|:-----:|:---|:---|
| **1st** | `LaserZap.ts` | Simplest beam projectile (damage on tick 0, visual-only after). Tests basic `LinesMesh` rendering pattern. No physical movement. |
| **2nd** | `Railgun.ts` | Medium beam projectile with helix. Tests `LinesMesh` with parametric geometry. No movement/state machine. |
| **3rd** | `AreaBeam.ts` | Beam with travelling head/tail state machine. Tests lerp animation + damage-interval pattern. |
| **4th** | `Missile.ts` | HIGH complexity. Requires all previous beam patterns understood + homing math + terrain awareness + fuel system. Implement AFTER simpler projectiles establish patterns. |
| **5th** | `GravityBomb.ts` | Simple ballistic projectile. Tests Euler integration pattern. Quick win after Missile's heavy math. |
| **6th** | `NukeLaunch.ts` | Special projectile with custom constructor. Mostly independent of other projectiles. Implements ISpatiallyPartitionable. Tests quadratic lerp + multi-phase animation. |
| **7th** | `InstantHit.ts` | Trivial. No visuals. One-tick lifecycle. Good warm-down task. |

**Parallelizable**: Railgun + AreaBeam can be implemented in parallel after LaserZap. GravityBomb + InstantHit can be done in parallel. Missile must be sequential (single developer focus on complex math). NukeLaunch is independent of all others.

### Dependency graph among Phase B files:

```
LaserZap (1st) ── establishes BeamRenderableShape enum, LinesMesh pattern
  │
  ├─► Railgun (2nd) ── parametric helix geometry
  │
  ├─► AreaBeam (3rd) ── travelling head/tail state machine, FindActorsOnLineCallback
  │
  └─► Missile (4th) ── (does not depend on any Phase B file directly, but benefits from established patterns)
       │
       ├─► GravityBomb (5th) ── (independent)
       │
       ├─► NukeLaunch (6th) ── (independent)
       │
       └─► InstantHit (7th) ── (independent)
```

---

## 7. Shared Modules to Create

### 7.1 `src/OpenRA.Mods.Common/Projectiles/ProjectileTypes.ts`

Shared types used by multiple projectile files:

```typescript
// Re-export from Bullet.ts
export { type IProjectile, type ProjectileArgs, InaccuracyType, type InaccuracyType,
         type BlockingActorsChecker, type WeaponStub, type WarheadArgsStub } from './Bullet.js'

// New shared types
export { BeamRenderableShape, type BeamRenderableShape } from './BeamRenderableShape.js'

// New callback types
export type FindActorsOnLineCallback = (
  world: GameWorldManager,
  from: WPos,
  to: WPos,
  width: WDist,
) => IGameActor[]

export type JammingChecker = (
  world: GameWorldManager,
  pos: WPos,
  sourceOwner: PlayerStub,
  jammable: boolean,
  jammedDiversionRange: number,
) => { jammed: boolean; hFacingOffset: number; vFacingOffset: number }
```

### 7.2 `src/OpenRA.Mods.Common/Projectiles/BeamRenderableShape.ts`

```typescript
export const BeamRenderableShape = {
  Cylindrical: 0,
  Flat: 1,
} as const
export type BeamRenderableShape = (typeof BeamRenderableShape)[keyof typeof BeamRenderableShape]
```

### 7.3 `src/OpenRA.Mods.Common/Projectiles/MissileMath.ts`

Static math functions extracted from Missile.cs for unit testability:

```typescript
// loopRadius(speed, rot): number
// willClimbWithinDistance(vFacing, loopRadius, predClfDist, diffClfMslHgt): boolean
// willClimbAroundInclineTop(vFacing, loopRadius, predClfDist, diffClfMslHgt): boolean
// isNearInclineTop(vFacing, loopRadius, predClfDist): boolean
// bisectionSearch(lowerBound, upperBound, testCriterion): number
// inclineLookahead(world, pos, hFacing, distCheck, loopRadius): {...}
// increaseAltitude(vFacing, loopRadius, predClfDist, diffClfMslHgt, relTarHorDist, info): number
```

Extracting these as pure functions enables isolated testing without instantiating a full Missile.

### 7.4 `src/OpenRA.Mods.Common/Projectiles/ProjectileRegistry.ts`

Registry for Phase C (WeaponInfo) and Phase D (Armament) lookup:

```typescript
import { BulletFactory, type BulletInfo } from './Bullet.js'
import { MissileFactory, type MissileInfo } from './Missile.js'
// ... etc.

export const ProjectileRegistry = {
  Bullet: { factory: BulletFactory, create: (info: BulletInfo, args: ProjectileArgs) => ... },
  Missile: { factory: MissileFactory, create: (info: MissileInfo, args: ProjectileArgs) => ... },
  AreaBeam: { ... },
  Railgun: { ... },
  LaserZap: { ... },
  NukeLaunch: { ... },  // special: not created via factory pattern
  GravityBomb: { ... },
  InstantHit: { ... },
} as const

export type ProjectileTypeName = keyof typeof ProjectileRegistry
```

---

## 8. Architectural Decisions

### ADR-8.B.1: ProjectileArgs Extension for RangeModifiers

**Context**: Missile and AreaBeam need `rangeModifiers: number[]` to compute effective range from weapon base range. Bullet's `ProjectileArgs` does not include this.

**Decision**: Add `rangeModifiers?: number[]` as an optional field to `ProjectileArgs`. This is backward-compatible with Bullet (which ignores it) and provides the field for Missile and AreaBeam.

**Alternatives considered**:
- Create `MissileArgs extends ProjectileArgs` -- adds interface hierarchy complexity for one field
- Pass `rangeModifiers` separately to constructor -- breaks the "all args in one bag" pattern

**Consequences**: Bullet and other projectiles ignore the optional field. Future projectiles that need range modifiers use it directly.

### ADR-8.B.2: Math Function Extraction from Missile

**Context**: Missile.cs contains ~500 lines of trajectory math functions (`DetermineLaunchSpeedAndAngle`, `InclineLookahead`, `HomingInnerTick`, `IncreaseAltitude`, `BisectionSearch`, etc.). These are static or instance methods deeply embedded in the class.

**Decision**: Extract pure math functions into a separate module `MissileMath.ts`. The Missile class calls these functions, passing its state as parameters. This enables:
- Isolated unit testing of trajectory math
- Reuse if another projectile needs similar calculations
- Clean separation of math from state management

**Alternatives considered**:
- Keep all math in Missile class -- makes testing require full Missile instantiation
- Make them static methods on Missile -- still couples them to the class

**Consequences**: `MissileMath.ts` is a pure function module with no Babylon.js or game-world dependencies. Tests can verify trajectory math with simple number inputs.

### ADR-8.B.3: Beam Rendering -- LinesMesh vs Custom Mesh

**Context**: OpenRA renders beams as screen-space lines using `RgbaColorRenderer.DrawLine`. In 3D, beams need to be world-space geometry.

**Decision**: Use `LinesMesh` for cylindrical beams and `MeshBuilder.CreatePlane()` for flat beams. The CoordinateTransformer maps world positions to 3D space.

- Cylindrical beams: `LinesMesh` with `color` and `alpha` set from projectile config. Width is limited to 1 pixel in Babylon.js `LinesMesh`; visual thickness is achieved through emissive glow material or by using multiple parallel lines.
- Flat beams: Create a ribbon mesh (two triangles forming a quad) oriented perpendicular to the camera (billboard) or in world-space (for true 3D flat beams). The vertices are computed from the beam's start/end positions and a perpendicular width vector.

**Alternatives considered**:
- `MeshBuilder.CreateCylinder()` for all beams -- provides true 3D thickness but is expensive for many beams; good for Railgun's main beam but overkill for LaserZap
- Custom `ShaderMaterial` with line geometry -- adds shader complexity without proportionate benefit

**Consequences**: Beams are visible and correctly positioned in 3D. The cylindrical/flat distinction matches C# behavior. For very wide beams, `CreateCylinder` may be used as an optimization (cylinder has proper 3D thickness vs LinesMesh's 1-pixel width).

### ADR-8.B.4: NukeLaunch Constructor Pattern

**Context**: NukeLaunch does not use `ProjectileArgs`. It has 15 constructor parameters (C# lines 50-53). This is because it's created by `NukePower` (a support power), not by `Armament` (a weapon mount).

**Decision**: Keep NukeLaunch's custom constructor with a `NukeLaunchConfig` interface. Do NOT force it into the `ProjectileArgs` pattern. The `ProjectileRegistry` entry for NukeLaunch uses a different factory signature.

**Alternatives considered**:
- Force all parameters into `ProjectileArgs` -- would require 10+ new optional fields on `ProjectileArgs`, most of which are unused by other projectiles
- Create a generic "projectile config" union type -- too loose, loses type safety

**Consequences**: NukeLaunch has its own config interface. Phase C (WeaponInfo) and Phase D (Armament) will not create NukeLaunch projectiles -- this is handled by the support power system (Chapter 13).

---

## 9. Deferred Features (with TODO references)

| Feature | Affected Files | TODO Ref | Reason |
|---------|---------------|----------|--------|
| GPU contrail rendering (TrailMesh) | Missile | TODO-8.B.1-TRAIL | Requires render layer integration; `ContrailLogic` holds data |
| GPU beam rendering final | AreaBeam, Railgun, LaserZap | TODO-8.B.2-BEAM | LinesMesh works; final materials deferred |
| Terrain height collision | Missile | TODO-8.B.1-TERRAIN | Map.ts is COMPLETE; wiring deferred to integration phase |
| Terrain type collision | Missile | TODO-8.B.1-TERRAINTYPE | Requires `Map.GetTerrainInfo()` wiring |
| Map boundary check | Missile, AreaBeam | TODO-8.B.1-MAP | Map.ts contains cell data; wiring deferred |
| Jamming trait integration | Missile | TODO-8.B.1-JAMMING | Requires `JamsMissiles` trait from Phase D |
| `ContrailFader` effect | Missile, Bullet | TODO-8.B.1-FADER | Not in scope; explode immediately removes contrail |
| Sound playback | NukeLaunch | TODO-8.B.5-SOUND | Sound module is COMPLETE (Ch7 Phase D); wiring deferred |
| ScreenMap registration | NukeLaunch | TODO-8.B.5-SCREENMAP | Spatial index deferred |
| Blocking actors spatial query | Missile, AreaBeam, LaserZap, InstantHit, Railgun | TODO-8.B.1-BLOCKING | Uses `BlockingActorsChecker` callback pattern; real spatial query deferred to Phase D |
| `FindActorsOnLine` spatial query | AreaBeam, Railgun | TODO-8.B.2-LINEQUERY | Uses callback pattern; real spatial query deferred |
| Animation integration | Missile, Railgun, LaserZap, NukeLaunch, GravityBomb | TODO-8.B.1-ANIM | Animation class is COMPLETE (Ch2); wiring in render() deferred |
| Shadow rendering | Missile, GravityBomb | TODO-8.B.1-SHADOW | Deferred to render integration; shadow position calculated in logic |

---

## 10. Test Strategy

### 10.1 Test File Targets

| File | Test File | Min Test Cases | Key Areas |
|:---|:---|:---:|:---|
| `Missile.ts` | `Missile.test.ts` | 40+ | State machine transitions, homing math, fuel range, explosion conditions, contrail, trail smoke |
| `MissileMath.ts` | `MissileMath.test.ts` | 25+ | loopRadius, bisectionSearch, willClimbWithinDistance, inclineLookahead, increaseAltitude |
| `AreaBeam.ts` | `AreaBeam.test.ts` | 20+ | Head/tail travel, damage interval, falloff calculation, tracking, beam completion |
| `Railgun.ts` | `Railgun.test.ts` | 18+ | Vector calculation, helix point generation, damage application, animation lifecycle |
| `LaserZap.ts` | `LaserZap.test.ts` | 18+ | Damage duration, target tracking, beam fade, secondary beam, hit/launch effects |
| `NukeLaunch.ts` | `NukeLaunch.test.ts` | 20+ | Launch delay, ascent/descent lerp, detonation conditions, trail spawning, animation switching |
| `GravityBomb.ts` | `GravityBomb.test.ts` | 15+ | Euler integration, ground contact, velocity/acceleration, animation lifecycle |
| `InstantHit.ts` | `InstantHit.test.ts` | 10+ | One-tick lifecycle, inaccuracy, blocking, guided target invalidation |
| **Total** | | **~166+** | |

### 10.2 Test Patterns (following Bullet.test.ts conventions)

1. **Mock Babylon.js**: `vi.mock('@babylonjs/core', () => ({ Vector3, Quaternion }))`
2. **Mock world**: `createMockWorld()` with `addEffect`, `removeEffect`, `addFrameEndTask`, `drainFrameEndTasks`
3. **Mock actors/players**: `createMockActor()`, `createMockPlayer()`
4. **Deterministic RNG**: `createMockRandom(seed)` for reproducible inaccuracy tests
5. **Trajectory precision**: Verify positions match expected values within 1 WDist unit
6. **Lifecycle tests**: Verify `isDestroyed`, weapon impact called, self-removed from world
7. **Disposal tests**: Verify `dispose()` marks destroyed, cleans up contrail
8. **Edge cases**: Zero distance, negative coordinates, max speed, zero duration

### 10.3 Missile-Specific Test Scenarios

Due to HIGH complexity, Missile tests require extra coverage:

- **Launch angle determination**: test `DetermineLaunchSpeedAndAngle` with various source/target configurations
- **Flat terrain homing**: missile at (0,0,100) targeting (10000,0,0) -- verify position at tick N
- **Terrain-aware homing**: mock terrain height, verify missile climbs over incline
- **Fuel exhaustion**: verify state transitions to Freefall when distanceCovered > rangeLimit
- **Jamming**: mock `JammingChecker` returning diversion, verify facing deviation
- **Snapping**: when within `speed` distance, verify `pos = target + offset`
- **Airburst**: verify explosion when below `AirburstAltitude` within `CloseEnough`
- **BoundToTerrainType**: verify explosion when leaving specified terrain
- **Arm delay**: verify no explosion when `ticks <= arm`

---

## 11. Acceptance Criteria (per file)

### 11.1 Generic (applied to ALL 7 files)

- [ ] All public members from OpenRA source accounted for (implemented, NOTE-documented, or TODO-deferred)
- [ ] Unit tests pass (`npx vitest run`) with coverage for every public method
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] JSDoc on all public APIs with OpenRA method references
- [ ] Dispose pattern implemented if ContraLogic or other resources created
- [ ] No per-frame allocation in hot paths (tick methods)
- [ ] `IProjectile` interface implemented
- [ ] `ProjectileFactory` exported for registry
- [ ] File header with OpenRA file reference and paradigm mapping notes

### 11.2 Missile-specific

- [ ] All 30+ `MissileInfo` fields defaulted correctly from C# defaults
- [ ] State machine transitions tested: Freefall -> Homing -> Hitting (3x3 matrix)
- [ ] `MissileMath.ts` extracted with all 8+ math functions
- [ ] `MissileMath.test.ts` passing with trajectory precision validation
- [ ] `ContrailLogic` integration (if `contrailLength > 0`)
- [ ] `SpriteEffect` trail smoke spawning (if `trailImage` set)
- [ ] All 6 explosion conditions covered in tests

### 11.3 Beam projectiles (AreaBeam, Railgun, LaserZap)

- [ ] `BeamRenderableShape` enum shared correctly
- [ ] Beam fade alpha calculation matches C# per-tick values
- [ ] Hit animation lifecycle (if `hitAnim` set): PlayThen -> animationComplete flag
- [ ] Player color vs config color resolution correct

---

## 12. Performance Considerations

1. **Missile homing math**: The `HomingInnerTick` function is called every tick. Ensure the TypeScript port does not allocate temporary objects. Use primitive `number` parameters rather than WPos/WVec temporaries where possible in the hot path.

2. **Beam `LinesMesh` updates**: For LaserZap and AreaBeam, the beam endpoint changes each tick. Update the `LinesMesh` instance rather than creating a new one each frame. Use `mesh = MeshBuilder.CreateLines(...)` on first tick, then `LinesMesh` `.updateVerticesData()` or replace the mesh instance on subsequent ticks.

3. **Contrail ring buffer**: `ContrailLogic` already uses a push/shift pattern which is O(n) on shift. For long contrails (Missile has `contrailLength` up to hundreds), use a fixed-size pre-allocated array with circular index (like C#'s circular buffer). This is a `TODO-8.B.1-PERF` optimization.

4. **Railgun helix points**: Precompute helix points once at construction. Only recalculate if `helixRadiusDeltaPerTick` or `helixAngleDeltaPerTick` are non-zero. For the common case (no deltas), reuse the precomputed array across all ticks.

---

## 13. Projectile Factories -- Code Pattern Reference

Each projectile exports a factory object following this pattern (from `BulletFactory`):

```typescript
export const MissileFactory = {
  /**
   * Create a Missile with configuration.
   *
   * OpenRA: MissileInfo.Create(ProjectileArgs)
   */
  create(
    info: MissileInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
    checkJamming?: JammingChecker | null,
  ): Missile {
    const mergedInfo: MissileInfo = { ...DEFAULT_MISSILE_INFO, ...info }
    return new Missile(mergedInfo, args, checkBlocking, checkJamming)
  },
}
```

For NukeLaunch (different constructor pattern):

```typescript
export const NukeLaunchFactory = {
  create(config: NukeLaunchConfig): NukeLaunch {
    return new NukeLaunch(config)
  },
}
```

---

## 14. Summary of TODOs Created by This Phase

| TODO Ref | Description | Deferral Target |
|----------|-------------|-----------------|
| TODO-8.B.1-TRAIL | GPU contrail rendering (TrailMesh) | Phase C/D render integration |
| TODO-8.B.1-TERRAIN | Terrain height collision (Missile) | Phase D integration |
| TODO-8.B.1-TERRAINTYPE | Terrain type collision (Missile) | Phase D integration |
| TODO-8.B.1-MAP | Map boundary check | Phase D integration |
| TODO-8.B.1-JAMMING | JamsMissiles trait integration | Phase D traits |
| TODO-8.B.1-FADER | ContrailFader effect | Phase E support effects |
| TODO-8.B.1-ANIM | Animation render integration | Phase C/D render |
| TODO-8.B.1-SHADOW | Shadow rendering | Phase C/D render |
| TODO-8.B.1-PERF | Contrail ring buffer optimization | Post-migration perf pass |
| TODO-8.B.2-LINEQUERY | FindActorsOnLine spatial query | Phase D spatial index |
| TODO-8.B.5-SOUND | NukeLaunch sound playback | Phase D audio wiring |
| TODO-8.B.5-SCREENMAP | NukeLaunch ScreenMap registration | Phase D spatial index |
