/**
 * JumpjetLocomotor.ts — 跳跃喷气移动系统（Jumpjet步兵移动）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/JumpjetLocomotor.cs
 *
 * 核心范式转换:
 * - C# TraitInfo.Create() → TypeScript constructor pattern
 * - C# FrozenSet<string> → ReadonlySet<string>
 * - C# short → number
 * - C# property override → TypeScript Object.defineProperty override
 *
 * JumpjetLocomotor 继承 Locomotor，用于跳跃喷气单位（如C&C的Jumpjet步兵）。
 * 与普通 Locomotor 的关键区别：
 * - 允许起飞/降落过渡成本（JumpjetTransitionCost）
 * - 配置过渡条件（地形类型、斜坡限制）
 * - 使用 CustomMovementLayerType.Jumpjet (3)
 * - DisableDomainPassabilityCheck 始终为 true
 *
 * 模式与 SubterraneanLocomotor 相同：配置信息扩展 + 运行时薄封装。
 */

import {
  Locomotor,
  LocomotorInfo,
  TerrainInfo,
  type ILocomotorWorld,
} from '../../../OpenRA.Mods.Common/Traits/World/Locomotor.js'

// ---------------------------------------------------------------------------
// JumpjetLocomotorInfo — 跳跃喷气移动配置
// ---------------------------------------------------------------------------

/**
 * 跳跃喷气 Locomotor 的配置信息。
 *
 * OpenRA 对照: JumpjetLocomotorInfo（继承 LocomotorInfo）
 *
 * 额外配置：
 * - 起飞/降落路径寻找成本（JumpjetTransitionCost）
 * - 允许过渡的地形类型（JumpjetTransitionTerrainTypes）
 * - 是否允许在斜坡过渡（JumpjetTransitionOnRamps）
 *
 * Attach to the world actor. Multiple variants can be created with @suffixes.
 */
export class JumpjetLocomotorInfo extends LocomotorInfo {
  /** Pathfinding cost for taking off or landing.
   *
   * OpenRA 对照: JumpjetTransitionCost (short, default 0)
   */
  readonly JumpjetTransitionCost: number

  /** The terrain types that this actor can transition on.
   * Empty set means any terrain type is allowed.
   *
   * OpenRA 对照: JumpjetTransitionTerrainTypes (FrozenSet<string>, default empty)
   */
  readonly JumpjetTransitionTerrainTypes: ReadonlySet<string>

  /** Can this actor transition on slopes?
   *
   * OpenRA 对照: JumpjetTransitionOnRamps (bool, default true)
   */
  readonly JumpjetTransitionOnRamps: boolean

  /**
   * Create a JumpjetLocomotorInfo.
   *
   * OpenRA 对照: JumpjetLocomotorInfo constructor（YAML FieldLoader 填充）
   *
   * All LocomotorInfo base class options are forwarded, plus
   * jumpjet-specific options.
   *
   * NOTE: DisableDomainPassabilityCheck is force-set to true in the
   * constructor via Object.defineProperty (mirrors C# `override bool`).
   * TypeScript does not allow overriding a readonly field with a getter
   * in a subclass, so we replace the property descriptor after super().
   *
   * @param opts — configuration options
   */
  constructor(opts?: {
    // LocomotorInfo base fields
    name?: string
    waitAverage?: number
    waitSpread?: number
    sharesCell?: boolean
    moveIntoShroud?: boolean
    crushes?: ReadonlySet<string>
    crushDamageTypes?: ReadonlySet<string>
    terrainSpeeds?: ReadonlyMap<string, TerrainInfo>
    disableDomainPassabilityCheck?: boolean
    // Jumpjet-specific fields
    jumpjetTransitionCost?: number
    jumpjetTransitionTerrainTypes?: ReadonlySet<string>
    jumpjetTransitionOnRamps?: boolean
  }) {
    // Conditionally call super with or without arguments to satisfy
    // the LocomotorInfo overloads (constructor() vs constructor(opts)).
    if (opts === undefined) {
      super()
    } else {
      super(opts)
    }

    // C#: public override bool DisableDomainPassabilityCheck => true
    // TypeScript: cannot override readonly field with getter — replace descriptor.
    Object.defineProperty(this, 'DisableDomainPassabilityCheck', {
      get(): boolean { return true },
      enumerable: true,
      configurable: false,
    })

    this.JumpjetTransitionCost = opts?.jumpjetTransitionCost ?? 0
    this.JumpjetTransitionTerrainTypes =
      opts?.jumpjetTransitionTerrainTypes ?? new Set()
    this.JumpjetTransitionOnRamps = opts?.jumpjetTransitionOnRamps ?? true
  }
}

// ---------------------------------------------------------------------------
// JumpjetLocomotor — 跳跃喷气移动 Locomotor
// ---------------------------------------------------------------------------

/**
 * 跳跃喷气移动 Locomotor。
 *
 * OpenRA 对照: JumpjetLocomotor（继承 Locomotor）
 *
 * 薄封装层：所有核心逻辑由基类 Locomotor 处理。
 * 标记类型用于 JumpjetActorLayer.enabledForLocomotor 的判断。
 * 跳跃喷气特定的路径计算委托 JumpjetActorLayer 处理。
 */
export class JumpjetLocomotor extends Locomotor {
  /** Configuration for this jumpjet locomotor.
   *
   * OpenRA 对照: JumpjetLocomotor.Info（继承 Locomotor.Info，类型为 JumpjetLocomotorInfo）
   */
  declare readonly Info: JumpjetLocomotorInfo

  /**
   * Create a new JumpjetLocomotor.
   *
   * OpenRA 对照: JumpjetLocomotor(Actor self, JumpjetLocomotorInfo info)
   *
   * @param world — the game world
   * @param info — jumpjet locomotor configuration
   */
  constructor(world: ILocomotorWorld, info: JumpjetLocomotorInfo) {
    super(world, info)
  }
}
