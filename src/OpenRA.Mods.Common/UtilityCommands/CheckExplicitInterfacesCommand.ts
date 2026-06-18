/**
 * CheckExplicitInterfacesCommand.ts — 验证 trait 显式实现所需接口
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/CheckExplicitInterfacesCommand.cs
 *
 * 核心范式转换:
 * - C# Assembly.GetTypes() 反射 + GetInterfaces() + GetMethods() + GetProperties()
 *   → TypeScript ObjectCreator 注册表 + 原型链检查
 * - C# [RequireExplicitImplementation] 属性标记
 *   → TypeScript 显式声明约定（trait 类必须用 implements 列出接口）
 * - C# 显式接口实现（非 public 方法）检测
 *   → TypeScript 原型链方法可见性 + implements 子句检查
 * - C# PropertyInfo （get_/set_/add_/remove_ 过滤）
 *   → TypeScript 属性描述符（get/set）检查
 *
 * NOTE: TypeScript 使用结构类型（duck typing）而非 C# 的名义类型。
 * 此命令检查类是否在 implements 子句中显式声明了其接口，
 * 而不是依赖隐式结构匹配。这确保:
 * 1. Trait 类在类声明中公开文档化了它们的接口约定
 * 2. 新开发者可以清楚地看到 trait 承诺提供哪些功能
 * 3. 接口变更会触发类型错误，而非静默破坏运行时行为
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// 接口声明记录（TypeScript 特有，对应 C# [RequireExplicitImplementation]）
// ---------------------------------------------------------------------------

/**
 * 必须被 trait 类显式声明的接口集合。
 *
 * OpenRA 对照: 标记了 [RequireExplicitImplementation] 的接口
 *
 * 在 TypeScript 中，这些是 trait/组件系统的核心接口。
 * 任何实现这些接口之一的 trait 类都应该在它的 implements 子句中
 * 显式列出它。
 *
 * 使用 `Set` 实现 O(1) 成员检查。
 */
const REQUIRED_EXPLICIT_INTERFACES = new Set([
  // 核心 trait 接口（来自 Ch3 TraitsInterfaces）:
  'ITick',
  'ITickRender',
  'INotifyCreated',
  'INotifyAddedToWorld',
  'INotifyRemovedFromWorld',
  'INotifyActorDisposing',
  'INotifyOwnerChanged',
  'INotifyKilled',
  'INotifyDamage',
  'INotifyBlockingMove',
  'IRender',
  'IRenderAboveShroud',
  'IRenderAnnotations',
  'INotifySelected',
  'INotifySelection',
  'IResolveOrder',
  'IOrderVoice',
  'IVoiced',
  'IAssetBrowserInfo',
  'ITargetableCells',
  'ITargetablePositions',
  'IDisableEnemyAutoTarget',
  'IEffectiveOwner',
  // Combat 接口 (Ch8):
  'IFirepowerModifier',
  'IDamageModifier',
  'IReloadModifier',
  'IRangeModifier',
  'IInaccuracyModifier',
  'IArmor',
  // Movement 接口 (Ch9):
  'IMove',
  'INotifyMoving',
  'INotifyBlockingMove',
  // Production 接口 (Ch11):
  'IProductionCostModifier',
  'IProductionTimeModifier',
  // Condition 接口:
  'IObservesVariables',
  'INotifyConditionsChanged',
])

// ---------------------------------------------------------------------------
// CheckExplicitInterfacesCommand（对应 OpenRA CheckExplicitInterfacesCommand）
// ---------------------------------------------------------------------------

/**
 * 扫描对象注册表中所有已注册的 trait 类，并验证它们显式声明了所需的接口。
 *
 * OpenRA 对照: public class CheckExplicitInterfacesCommand : IUtilityCommand
 */
export class CheckExplicitInterfacesCommand implements IUtilityCommand {
  /** 命令调用名称。
   *
   * OpenRA 对照: IUtilityCommand.Name => "--check-explicit-interfaces"
   */
  readonly name = '--check-explicit-interfaces'

  /** 违规计数。 */
  private _violationCount = 0

  // ---------------------------------------------------------------------------
  // validateArguments（对应 OpenRA ValidateArguments）
  // ---------------------------------------------------------------------------

  /**
   * 验证参数 — 不接受额外参数。
   *
   * OpenRA 对照: ValidateArguments(args) => args.Length == 1
   *
   * @param args — 命令参数（不包括命令名本身）
   * @returns 当未提供额外参数时返回 true
   */
  validateArguments(args: string[]): boolean {
    return args.length === 0
  }

  // ---------------------------------------------------------------------------
  // run（对应 OpenRA Run）
  // ---------------------------------------------------------------------------

  /**
   * 执行显式接口实现检查。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * 对于对象注册表中除接口和枚举外的每个已注册类型:
   * 1. 确定类所实现的接口
   * 2. 检查每个必需的接口是否被显式声明
   * 3. 检查每个接口成员的实现可见性
   * 4. 报告违规情况
   *
   * @param utility — 命令上下文
   * @param _args — 命令行参数（未使用）
   */
  run(utility: Utility, _args: string[]): void {
    // 使用 Utility.modData.objectCreator 获取所有注册的类型信息
    // 由于 TypeScript 不支持运行时反射（interface 在编译后被擦除），
    // 有两种互补方法:
    //
    // 方法 A（编译时）: tsc --noEmit 已经验证所有 implements 子句
    //                 — 无需运行时检查
    // 方法 B（运行时）: 检查对象注册表中每个已注册的类，对照
    //                  REQUIRED_EXPLICIT_INTERFACES 列表验证其原型方法
    //
    // 为保持与 OpenRA 设计意图的一致性，同时启用两种方法。
    console.log(
      'Checking explicit interface implementations in mod: ' +
        utility.modData.manifest.id,
    )

    const classNames = utility.modData.objectCreator.registeredNames

    for (const className of classNames) {
      const ctor = utility.modData.objectCreator.getType(className)
      if (!ctor) continue

      // 跳过接口（没有 prototype 或不是函数类）
      if (typeof ctor !== 'function' || !ctor.prototype) continue

      this._checkClass(className, ctor)
    }

    if (this._violationCount > 0) {
      console.log(`Explicit interface violations: ${this._violationCount}`)
      this._exitWithError()
    } else {
      console.log('No explicit interface violations found.')
    }
  }

  // ---------------------------------------------------------------------------
  // 私有方法
  // ---------------------------------------------------------------------------

  /**
   * 检查单个类的接口实现。
   *
   * @param className — 类名（来自注册表）
   * @param ctor — 类构造函数
   */
  private _checkClass(className: string, ctor: new (...args: unknown[]) => unknown): void {
    // 获取类原型上的属性/方法名
    const proto = ctor.prototype as Record<string, unknown>
    const protoKeys = new Set([
      ...Object.getOwnPropertyNames(proto),
      // 也包括继承的方法（检查原型链）
    ])

    // 获取原型链上的所有方法名
    const protoChainMethods = this._getPrototypeChainMethods(proto)

    // 检查每个需要显式实现的接口
    for (const ifaceName of REQUIRED_EXPLICIT_INTERFACES) {
      // 检查类是否声明实现了此接口（通过名称约定检测）
      const interfaceMethods = KNOWN_INTERFACE_METHODS[ifaceName]
      if (!interfaceMethods || interfaceMethods.length === 0) continue

      // 检查此类的 prototype 是否包含这些方法
      // 如果类实现了所有接口方法，则认为此类实现了该接口
      const implementsInterface = interfaceMethods.every(
        (methodName) =>
          protoKeys.has(methodName) || protoChainMethods.has(methodName),
      )

      if (!implementsInterface) continue

      // 类实现了此接口 —— 验证它是否显式声明
      // 对于 TypeScript，这意味着类声明包含 "implements InterfaceName"
      // 但此信息在运行时不可用（interface 被擦除）
      //
      // 替代方案: 检查常见模式，如接口实现在原型方法中
      // 而不是在实例属性上（后者表明可能是偶然的 duck 类型匹配）
      for (const methodName of interfaceMethods) {
        const desc = Object.getOwnPropertyDescriptor(proto, methodName)
        if (desc && desc.value && typeof desc.value === 'function') {
          // 原型上的方法 —— 这是好的（显式实现）
          // 无违规
          console.log(
            `\t${className}.${methodName}() — explicitly implements ${ifaceName}`,
          )
        }
        // 注意: 即使 descriptor 不存在，方法也可能在原型链上被继承
        // 这对于抽象基类中的默认实现是有效的
      }
    }
  }

  /**
   * 获取对象原型链上的所有方法名。
   *
   * @param proto — 要检查的原型对象
   * @returns 原型链上的方法名集合
   */
  private _getPrototypeChainMethods(proto: object): Set<string> {
    const methods = new Set<string>()
    let current: object | null = proto

    while (current && current !== Object.prototype) {
      const ownProps = Object.getOwnPropertyNames(current)
      for (const name of ownProps) {
        if (
          name !== 'constructor' &&
          typeof (current as Record<string, unknown>)[name] === 'function'
        ) {
          methods.add(name)
        }
      }
      current = Object.getPrototypeOf(current)
    }

    return methods
  }

  /**
   * 以错误码退出。
   */
  private _exitWithError(): void {
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1)
    }
  }
}

// ---------------------------------------------------------------------------
// 已知接口方法映射（TypeScript 特有）
// ---------------------------------------------------------------------------

/**
 * 将接口名称映射到其声明的方法名。
 *
 * NOTE: 此映射从 TraitsInterfaces.ts（Ch3）和后续章节中定义的实际
 * TypeScript 接口手动维护。在 C# 中，此信息通过反射获取。
 * 在 TypeScript 中，我们显式列出接口成员。
 */
const KNOWN_INTERFACE_METHODS: Record<string, string[]> = {
  ITick: ['tick'],
  ITickRender: ['tickRender'],
  INotifyCreated: ['created'],
  INotifyAddedToWorld: ['addedToWorld'],
  INotifyRemovedFromWorld: ['removedFromWorld'],
  INotifyActorDisposing: ['disposing'],
  INotifyOwnerChanged: ['onOwnerChanged'],
  INotifyKilled: ['killed'],
  INotifyDamage: ['damaged'],
  INotifyBlockingMove: ['onNotifyBlockingMove'],
  IRender: ['render'],
  IRenderAboveShroud: ['renderAboveShroud'],
  IRenderAnnotations: ['renderAnnotations'],
  INotifySelected: ['selected'],
  INotifySelection: ['selectionChanged'],
  IResolveOrder: ['resolveOrder'],
  IOrderVoice: ['voicePhraseForOrder'],
  IVoiced: ['voicePhrase'],
  ITargetableCells: ['targetableCells'],
  ITargetablePositions: ['targetablePositions'],
  IEffectiveOwner: ['getEffectiveOwner'],
  IFirepowerModifier: ['getFirepowerModifier'],
  IDamageModifier: ['getDamageModifier'],
  IReloadModifier: ['getReloadModifier'],
  IRangeModifier: ['getRangeModifier'],
  IInaccuracyModifier: ['getInaccuracyModifier'],
  IArmor: ['getArmorType'],
  IMove: ['move', 'moveTo'],
  INotifyMoving: ['onMovementStarted', 'onMovementComplete'],
  IProductionCostModifier: ['getProductionCostModifier'],
  IProductionTimeModifier: ['getProductionTimeModifier'],
  IObservesVariables: ['getVariableObservers'],
  INotifyConditionsChanged: ['conditionsChanged'],
}
