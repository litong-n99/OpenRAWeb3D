/**
 * ProjectileRegistry.ts — 抛射体工厂注册表（barrel file）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/ (全部 IProjectileInfo 实现)
 *
 * Architect spec Section 7.4: Central registry exporting all projectile factory
 * names for use by the weapon system's projectile resolution.
 *
 * 核心范式转换:
 * - C# IProjectileInfo + 反射式 Create → TypeScript factory function registry
 * - C# namespace-level resolution → map-based lookup
 */

import { BulletFactory } from './Bullet.js'
import { MissileFactory } from './Missile.js'
import { GravityBombFactory } from './GravityBomb.js'
import { InstantHitFactory } from './InstantHit.js'
import { LaserZapFactory } from './LaserZap.js'
import { RailgunFactory } from './Railgun.js'
import { AreaBeamFactory } from './AreaBeam.js'
import { NukeLaunchFactory } from './NukeLaunch.js'

// ---------------------------------------------------------------------------
// ProjectileFactory — union type for all projectile factory objects
// ---------------------------------------------------------------------------

export type ProjectileFactory =
  | typeof BulletFactory
  | typeof MissileFactory
  | typeof GravityBombFactory
  | typeof InstantHitFactory
  | typeof LaserZapFactory
  | typeof RailgunFactory
  | typeof AreaBeamFactory
  | typeof NukeLaunchFactory

// ---------------------------------------------------------------------------
// PROJECTILE_REGISTRY — canonical name → factory mapping
// ---------------------------------------------------------------------------

/**
 * Central registry of all projectile factories by name.
 *
 * OpenRA 对照: IProjectileInfo resolution by projectile type name
 *
 * Usage:
 * ```typescript
 * import { PROJECTILE_REGISTRY } from './ProjectileRegistry.js'
 * const factory = PROJECTILE_REGISTRY['Bullet']
 * const projectile = factory.create(args)
 * ```
 */
export const PROJECTILE_REGISTRY: Record<string, ProjectileFactory> = {
  Bullet: BulletFactory,
  Missile: MissileFactory,
  GravityBomb: GravityBombFactory,
  InstantHit: InstantHitFactory,
  LaserZap: LaserZapFactory,
  Railgun: RailgunFactory,
  AreaBeam: AreaBeamFactory,
  NukeLaunch: NukeLaunchFactory,
}
