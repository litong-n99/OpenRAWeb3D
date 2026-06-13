/**
 * SubterraneanLocomotor.ts — 地下移动系统（潜地单位移动）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/SubterraneanLocomotor.cs
 *
 * 核心范式转换:
 * - C# TraitInfo.Create() → TypeScript constructor pattern
 * - C# FrozenSet<string> → ReadonlySet<string>
 * - C# short → number
 * - C# WDist → TypeScript WDist class
 * - C# property override → TypeScript getter override
 *
 * SubterraneanLocomotor 继承 Locomotor，用于地下潜地单位的移动。
 * 与普通 Locomotor 的关键区别：
 * - 允许地面层（layer 0）和地下层（layer 2）之间的过渡
 * - 配置过渡条件（地形类型、斜坡、深度）
 * - 与 SubterraneanActorLayer 协同管理地下占用
 */

import { WDist } from '../../../OpenRA.Game/WDist'
import {
  Locomotor,
  LocomotorInfo,
  TerrainInfo,
  type ILocomotorWorld,
} from './Locomotor'

// ---------------------------------------------------------------------------
// SubterraneanLocomotorInfo — 地下移动配置
// ---------------------------------------------------------------------------

/**
 * 地下移动 Locomotor 的配置信息。
 *
 * OpenRA 对照: SubterraneanLocomotorInfo（继承 LocomotorInfo）
 *
 * 额外配置：
 * - 地下过渡成本（地面 ↔ 地下）
 * - 允许过渡的地形类型
 * - 是否允许在斜坡过渡
 * - 地下深度（用于显示和碰撞）
 */
export class SubterraneanLocomotorInfo extends LocomotorInfo {
  /** Pathfinding cost for submerging or reemerging.
   *
   * OpenRA 对照: SubterraneanTransitionCost (short, default 0)
   */
  readonly SubterraneanTransitionCost: number

  /** The terrain types that this actor can transition on.
   * Empty set means any terrain type is allowed.
   *
   * OpenRA 对照: SubterraneanTransitionTerrainTypes (FrozenSet<string>, default empty)
   */
  readonly SubterraneanTransitionTerrainTypes: ReadonlySet<string>

  /** Can this actor transition on slopes?
   *
   * OpenRA 对照: SubterraneanTransitionOnRamps (bool, default false)
   */
  readonly SubterraneanTransitionOnRamps: boolean

  /** Depth at which the subterranean condition is applied.
   *
   * OpenRA 对照: SubterraneanTransitionDepth (WDist, default new WDist(-1024))
   */
  readonly SubterraneanTransitionDepth: WDist

  /**
   * Create a SubterraneanLocomotorInfo.
   *
   * OpenRA 对照: SubterraneanLocomotorInfo constructor（无参数默认构造，YAML FieldLoader 填充）
   *
   * All LocomotorInfo base class options are forwarded, plus
   * subterranean-specific options.
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
    // Subterranean-specific fields
    subterraneanTransitionCost?: number
    subterraneanTransitionTerrainTypes?: ReadonlySet<string>
    subterraneanTransitionOnRamps?: boolean
    subterraneanTransitionDepth?: WDist
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

    this.SubterraneanTransitionCost = opts?.subterraneanTransitionCost ?? 0
    this.SubterraneanTransitionTerrainTypes =
      opts?.subterraneanTransitionTerrainTypes ?? new Set()
    this.SubterraneanTransitionOnRamps = opts?.subterraneanTransitionOnRamps ?? false
    this.SubterraneanTransitionDepth =
      opts?.subterraneanTransitionDepth ?? new WDist(-1024)
  }
}

// ---------------------------------------------------------------------------
// SubterraneanLocomotor — 地下移动 Locomotor
// ---------------------------------------------------------------------------

/**
 * 地下移动 Locomotor。
 *
 * OpenRA 对照: SubterraneanLocomotor（继承 Locomotor）
 *
 * 薄封装层：所有核心逻辑由基类 Locomotor 处理。
 * 标记类型用于 SubterraneanActorLayer.enabledForLocomotor 的判断。
 * 地下特定的路径计算委托 SubterraneanActorLayer 处理。
 */
export class SubterraneanLocomotor extends Locomotor {
  /** Configuration for this subterranean locomotor.
   *
   * OpenRA 对照: SubterraneanLocomotor.Info（继承 Locomotor.Info，类型为 SubterraneanLocomotorInfo）
   */
  declare readonly Info: SubterraneanLocomotorInfo

  /**
   * Create a new SubterraneanLocomotor.
   *
   * OpenRA 对照: SubterraneanLocomotor(Actor self, SubterraneanLocomotorInfo info)
   *
   * @param world — the game world
   * @param info — subterranean locomotor configuration
   */
  constructor(world: ILocomotorWorld, info: SubterraneanLocomotorInfo) {
    super(world, info)
  }
}
