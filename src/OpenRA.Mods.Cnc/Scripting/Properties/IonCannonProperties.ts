/**
 * IonCannonProperties.ts — Script-exposed Ion Cannon power activation
 * OpenRA 对照: OpenRA.Mods.Cnc/Scripting/Properties/IonCannonProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Support Powers")] attribute → static readonly category
 * - C# Requires<IonCannonPowerInfo> → requiredTraits: ['IonCannonPowerInfo']
 * - C# TraitsImplementing<IonCannonPower>().First() → traitsImplementing('IonCannonPower')[0]
 * - C# icp.Activate(Self, Target.FromCell(Self.World, target)) → trait.activate(self, target)
 *
 *
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class IonCannonProperties extends ScriptActorProperties {
  static readonly category = 'Support Powers' as const
  static readonly requiredTraits = ['IonCannonPowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _icp: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    const powers = (self as any).traitsImplementing?.('IonCannonPower') ?? []
    this._icp = powers.length > 0 ? powers[0] : null
  }

  /**
   * Activate the actor's IonCannonPower.
   *
   * OpenRA 对照: IonCannonProperties.ActivateIonCannon(CPos target)
   * C# calls icp.Activate(Self, Target.FromCell(Self.World, target))
   *
   * Validates that the target cell is within map bounds before activation.
   * If the target is out of bounds or the map data is unavailable, the
   * activation is silently skipped (matching C# behavior where
   * Target.FromCell would fail on out-of-bounds cells).
   */
  ActivateIonCannon(target: unknown): void {
    if (!this._icp) return

    // Validate target is within map bounds
    if (!this._isCellInMapBounds(target)) return

    this._icp.activate?.(this.self, target)
  }

  /**
   * Check whether a cell position is within the world map bounds.
   *
   * OpenRA 对照: implicit validation via Target.FromCell(Self.World, target)
   *
   * Duck-types into the world map's MapSize to verify the cell coordinates
   * are non-negative and within the map width/height.
   */
  private _isCellInMapBounds(cell: unknown): boolean {
    if (cell === null || cell === undefined || typeof cell !== 'object') return false

    const pos = cell as { x?: number; y?: number }
    if (pos.x === undefined || pos.y === undefined) return false
    if (pos.x < 0 || pos.y < 0) return false

    const world = (this.self as any).world
    const map = world?.map
    const mapSize = map?.mapSize

    // If map data is unavailable, allow the call (trait handles its own validation)
    if (!mapSize || mapSize.width === undefined || mapSize.height === undefined) return true

    return pos.x < mapSize.width && pos.y < mapSize.height
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'ActivateIonCannon', returnType: 'nil',
        description: 'Activate the actor\'s IonCannonPower.',
        parameters: [{ name: 'target', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.ActivateIonCannon(args[0]) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Support Powers',
  ctor: IonCannonProperties,
  requiredTraits: ['IonCannonPowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Ion Cannon power: ActivateIonCannon',
})
