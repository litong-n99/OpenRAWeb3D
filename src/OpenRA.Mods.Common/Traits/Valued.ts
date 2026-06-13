/**
 * Valued.ts — 单位价值 trait（生产花费 / 赏金基数）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Valued.cs (25 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<Valued> + empty Valued class → TS ValuedInfo: ITraitInfo + Valued: Component
 * - C# Cost accessed via Info.TraitInfoOrDefault<ValuedInfo>() → TS Valued.cost getter
 *
 * 这是 OpenRA 中最简单的 trait 之一，仅声明该 actor 的价值（C# 中仅 `Cost` 配置字段，
 * `Valued` 本身为空类）。在 TS 迁移中，为方便使用添加了 `cost` 属性 getter。
 */

import {
  Component,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ITraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ValuedInfo
// OpenRA 对照: ValuedInfo : TraitInfo<Valued>
// ---------------------------------------------------------------------------

/** 该单位的价值 / 生产花费配置。
 *
 *  OpenRA 对照: ValuedInfo
 */
export class ValuedInfo implements ITraitInfo {
  readonly instanceName?: string

  /** 该单位的价值（生产花费，同时也是赏金的计算基数）。
   *
   *  OpenRA 对照: ValuedInfo.Cost (FieldLoader.Require, default 0)
   */
  readonly cost: number = 0

  constructor(params: { instanceName?: string; cost?: number } = {}) {
    this.instanceName = params.instanceName
    this.cost = params.cost ?? 0
  }
}

// ---------------------------------------------------------------------------
// Valued
// OpenRA 对照: Valued (empty class)
// ---------------------------------------------------------------------------

/** 单位价值 trait。
 *
 *  OpenRA 对照: Valued
 *
 *  该 trait 本身仅作为"标记"存在，表示该 actor 拥有一个可查询的价值数值。
 *  在 C# 中该类为空；在 TS 中添加了 `cost` getter 以方便访问。
 *  实际的价值数据存储在 ValuedInfo.Cost 中。
 */
export class Valued extends Component {
  /** 该 trait 的配置信息。
   *
   *  OpenRA 对照: N/A (C# Valued 为空类，Cost 从 ValuedInfo 查询)
   */
  readonly info: ValuedInfo

  constructor(info: ValuedInfo) {
    super()
    this.info = info
  }

  /** 该单位的基础价值（= info.Cost）。
   *
   *  OpenRA 对照: ValuedInfo.Cost (通过 TraitInfoOrDefault 查询)
   */
  get cost(): number {
    return this.info.cost
  }
}
