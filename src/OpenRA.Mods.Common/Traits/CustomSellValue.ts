/**
 * CustomSellValue.ts — 自定义出售价值（防止买卖价差漏洞）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/CustomSellValue.cs (38 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<CustomSellValue> + empty class → TS CustomSellValueInfo: ITraitInfo + CustomSellValue: Component
 * - C# extension method CustomSellValueExts.GetSellValue(Actor) → TS exported function getSellValue(IGameActor)
 * - C# a.Info.TraitInfoOrDefault<T>() → TS duck-typed info.traitInfoOrDefault()
 */

import {
  Component,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ITraitInfo,
  IGameActor,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CustomSellValueInfo
// OpenRA 对照: CustomSellValueInfo : TraitInfo<CustomSellValue>
// ---------------------------------------------------------------------------

/** 自定义出售价值的配置。
 *
 *  OpenRA 对照: CustomSellValueInfo
 */
export class CustomSellValueInfo implements ITraitInfo {
  readonly instanceName?: string

  /** 覆盖的出售价值。
   *
   *  OpenRA 对照: CustomSellValueInfo.Value (FieldLoader.Require, default 0)
   */
  readonly value: number = 0

  constructor(params: { instanceName?: string; value?: number } = {}) {
    this.instanceName = params.instanceName
    this.value = params.value ?? 0
  }
}

// ---------------------------------------------------------------------------
// CustomSellValue
// OpenRA 对照: CustomSellValue (empty class)
// ---------------------------------------------------------------------------

/** 自定义出售价值 trait。
 *
 *  OpenRA 对照: CustomSellValue
 *
 *  该 trait 允许覆盖单位的出售价值。与 Sellable 配合使用，
 *  可以设置不同于生产花费的出售价格，避免买卖价差漏洞。
 */
export class CustomSellValue extends Component {
  /** 该 trait 的配置信息。 */
  readonly info: CustomSellValueInfo

  constructor(info: CustomSellValueInfo) {
    super()
    this.info = info
  }

  /** 该单位的自定义出售价值（= info.Value）。
   *
   *  OpenRA 对照: CustomSellValueInfo.Value
   */
  get value(): number {
    return this.info.value
  }
}

// ---------------------------------------------------------------------------
// getSellValue — 查询 actor 的出售价值
// OpenRA 对照: CustomSellValueExts.GetSellValue(this Actor a)
// ---------------------------------------------------------------------------

/** Trait info 查询接口（duck-typing for ActorInfo.traitInfoOrDefault）。 */
interface ITraitInfoQuery {
  traitInfoOrDefault?(name: string): { value?: number; cost?: number } | undefined
}

/**
 * 查询 actor 的出售价值。
 *
 * OpenRA 对照: CustomSellValueExts.GetSellValue(Actor)
 *
 * 查找顺序:
 * 1. CustomSellValueInfo.Value — 如果 actor 有此 trait，使用其覆盖值
 * 2. ValuedInfo.Cost — 否则退回到 Valued trait 的生产花费
 * 3. 0 — 如果两者都不存在，返回 0
 *
 * @param actor — 要查询的 actor
 * @returns 该 actor 的出售价值
 */
export function getSellValue(actor: IGameActor): number {
  // Duck-type access to the actor's info → traitInfoOrDefault
  const info = (actor as unknown as {
    info?: ITraitInfoQuery
  }).info

  if (!info?.traitInfoOrDefault) return 0

  // 1. Check CustomSellValueInfo
  const csv = info.traitInfoOrDefault('CustomSellValueInfo')
  if (csv?.value !== undefined && csv.value > 0) {
    return csv.value
  }

  // 2. Fall back to ValuedInfo.Cost
  const valued = info.traitInfoOrDefault('ValuedInfo')
  if (valued?.cost !== undefined) {
    return valued.cost
  }

  // 3. Neither trait present
  return 0
}
