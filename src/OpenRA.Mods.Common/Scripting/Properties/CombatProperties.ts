/**
 * CombatProperties.ts — Script-exposed Combat category properties for actors
 * OpenRA 对照: CombatProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Combat")] → category = 'Combat'
 * - C# Requires<AttackBaseInfo>, Requires<IMoveInfo> → requiredTraits
 * - C# Hunt(), AttackMove(), Patrol(), PatrolUntil() → queueActivity + script callbacks
 * - C# Attack(targetActor) on AttackBase[] → iterate cached attackBases
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

type ScriptCallable = (...args: unknown[]) => unknown

// ===========================================================================
// CombatProperties — Hunt, AttackMove, Patrol
// ===========================================================================

/**
 * Combat movement properties (Hunt, AttackMove, Patrol).
 *
 * OpenRA 对照: CombatProperties (CombatProperties.cs:23-77)
 */
export class CombatProperties extends ScriptActorProperties {
  static readonly category = 'Combat' as const
  static readonly requiredTraits = ['AttackBaseInfo', 'IMoveInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _move: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._move = (self as any).trait?.('IMove') ?? null
  }

  // ---- Methods ----

  /** Ignoring visibility, find the closest hostile target and attack move to within 2 cells. */
  Hunt(): void {
    this.self.queueActivity?.(createActivity('Hunt', { target: this.self }))
  }

  /**
   * Move to a cell, but stop and attack anything within range on the way.
   * @param cell — target cell
   * @param closeEnough — optional range (cells) that will be considered close enough
   */
  AttackMove(cell: unknown, closeEnough: number = 0): void {
    this.self.queueActivity?.(createActivity('AttackMoveActivity', {
      target: this.self,
      moveFn: () => this._move?.moveTo?.(cell, closeEnough),
    }))
  }

  /**
   * Patrol along a set of given waypoints. The action is repeated by default.
   * @param waypoints — array of cells to patrol
   * @param loop — whether to repeat the patrol (default true)
   * @param wait — ticks to wait at each waypoint (default 0)
   */
  Patrol(waypoints: unknown[], loop: boolean = true, wait: number = 0): void {
    for (const wpt of waypoints) {
      this.self.queueActivity?.(createActivity('AttackMoveActivity', {
        target: this.self,
        moveFn: () => this._move?.moveTo?.(wpt, 2),
      }))
      this.self.queueActivity?.(createActivity('Wait', { ticks: wait }))
    }

    if (loop) {
      this.self.queueActivity?.(createActivity('CallScriptFunc', {
        func: () => { this.Patrol(waypoints, loop, wait) },
      }))
    }
  }

  /**
   * Patrol along a set of waypoints until a condition becomes true.
   * @param waypoints — array of cells
   * @param func — callback function as func(self): boolean
   * @param wait — ticks to wait at each waypoint (default 0)
   */
  PatrolUntil(
    waypoints: unknown[],
    func: ScriptCallable,
    wait: number = 0,
  ): void {
    this.Patrol(waypoints, false, wait)

    const continuePatrol = func(this.self)
    if (continuePatrol) {
      this.self.queueActivity?.(createActivity('CallScriptFunc', {
        func: () => { this.PatrolUntil(waypoints, func, wait) },
      }))
    }
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Hunt', returnType: 'nil',
        description: 'Ignoring visibility, find the closest hostile target and attack move to within 2 cells of it.',
        parameters: [],
        invoke: () => { this.Hunt() },
      },
      {
        memberType: 'method', name: 'AttackMove', returnType: 'nil',
        description: 'Move to a cell, but stop and attack anything within range on the way.',
        parameters: [
          { name: 'cell', type: 'CPos', optional: false },
          { name: 'closeEnough', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => { this.AttackMove(args[0], args[1] as number) },
      },
      {
        memberType: 'method', name: 'Patrol', returnType: 'nil',
        description: 'Patrol along a set of given waypoints. The action is repeated by default.',
        parameters: [
          { name: 'waypoints', type: 'CPos[]', optional: false },
          { name: 'loop', type: 'boolean', optional: true, defaultValue: true },
          { name: 'wait', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => {
          this.Patrol(args[0] as unknown[], args[1] as boolean, args[2] as number)
        },
      },
      {
        memberType: 'method', name: 'PatrolUntil', returnType: 'nil',
        description: 'Patrol along a set of given waypoints until a condition becomes true.',
        parameters: [
          { name: 'waypoints', type: 'CPos[]', optional: false },
          { name: 'func', type: 'function', optional: false },
          { name: 'wait', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => {
          this.PatrolUntil(args[0] as unknown[], args[1] as ScriptCallable, args[2] as number)
        },
      },
    ]
  }
}

// ===========================================================================
// GeneralCombatProperties — Attack, CanTarget
// ===========================================================================

/**
 * General combat properties (Attack, CanTarget).
 *
 * OpenRA 对照: GeneralCombatProperties (CombatProperties.cs:80-109)
 */
export class GeneralCombatProperties extends ScriptActorProperties {
  static readonly category = 'Combat' as const
  static readonly requiredTraits = ['AttackBaseInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _attackBases: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._attackBases = (self as any).traitsImplementing?.('AttackBase') ?? []
  }

  // ---- Methods ----

  /**
   * Attack the target actor. The target actor needs to be visible.
   * @param targetActor — actor to attack
   * @param allowMove — allow moving into range (default true)
   * @param forceAttack — force attack regardless of stance (default false)
   */
  Attack(targetActor: IGameActor, allowMove: boolean = true, forceAttack: boolean = false): void {
    for (const attack of this._attackBases) {
      attack.attackTarget?.(targetActor, 'Default', true, allowMove, forceAttack)
    }
  }

  /**
   * Checks if the targeted actor is a valid target for this actor.
   */
  CanTarget(targetActor: IGameActor): boolean {
    // Delegate to target validation
    if (!targetActor) return false
    return (this.self as any).canTarget?.(targetActor) ?? false
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Attack', returnType: 'nil',
        description: 'Attack the target actor. The target actor needs to be visible.',
        parameters: [
          { name: 'targetActor', type: 'Actor', optional: false },
          { name: 'allowMove', type: 'boolean', optional: true, defaultValue: true },
          { name: 'forceAttack', type: 'boolean', optional: true, defaultValue: false },
        ],
        invoke: (_, args) => {
          this.Attack(args[0] as IGameActor, args[1] as boolean, args[2] as boolean)
        },
      },
      {
        memberType: 'method', name: 'CanTarget', returnType: 'boolean',
        description: 'Checks if the targeted actor is a valid target for this actor.',
        parameters: [{ name: 'targetActor', type: 'Actor', optional: false }],
        invoke: (_, args) => this.CanTarget(args[0] as IGameActor),
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'Combat',
  ctor: CombatProperties,
  requiredTraits: ['AttackBaseInfo', 'IMoveInfo'],
  exposedForDestroyedActors: false,
  description: 'Combat movement: Hunt, AttackMove, Patrol, PatrolUntil',
})

ScriptRegistry.registerActorProperty({
  category: 'Combat',
  ctor: GeneralCombatProperties,
  requiredTraits: ['AttackBaseInfo'],
  exposedForDestroyedActors: false,
  description: 'General combat: Attack, CanTarget',
})
