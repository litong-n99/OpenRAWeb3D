/**
 * CaptureProperties.ts — Script-exposed capture ability
 * OpenRA 对照: CaptureProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

export class CaptureProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['CaptureManagerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _captureManager: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._captureManager = (self as any).trait?.('CaptureManager') ?? null
  }

  CanCapture(target: IGameActor): boolean {
    if (!this._captureManager) return false
    const targetManager = (target as any).trait?.('CaptureManager')
    return targetManager != null && this._captureManager.canTarget?.(targetManager)
  }

  Capture(target: IGameActor): void {
    if (!this.CanCapture(target)) return
    this.self.queueActivity?.(createActivity('CaptureActor', { target, source: this.self }))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Capture', returnType: 'nil',
        description: 'Captures the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.Capture(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'CanCapture', returnType: 'boolean',
        description: 'Checks if the target actor can be captured.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => this.CanCapture(args[0] as IGameActor),
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: CaptureProperties,
  requiredTraits: ['CaptureManagerInfo'],
  exposedForDestroyedActors: false,
  description: 'Capture ability: Capture, CanCapture',
})
