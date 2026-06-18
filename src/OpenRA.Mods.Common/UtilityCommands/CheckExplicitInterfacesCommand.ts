/**
 * CheckExplicitInterfacesCommand.ts — 验证 trait 显式实现所需接口
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/CheckExplicitInterfacesCommand.cs
 *
 * 核心范式转换:
 * - C# Assembly.GetTypes() 反射 + GetInterfaces() + GetMethods() → ObjectCreator 注册表 + 原型链检查
 * - C# [RequireExplicitImplementation] 属性标记 → TypeScript 的 KNOWN_INTERFACE_METHODS 映射
 * - C# 显式接口实现（非 public 方法）检测 → TypeScript 运行时方法存在性检查 + 编译时委托
 * - C# PropertyInfo（get_/set_/add_/remove_ 过滤）→ TypeScript 属性描述符检查
 *
 * 关键边界说明:
 * TypeScript 使用结构类型（duck typing）而非 C# 的名义类型。
 * TypeScript 的 `interface` 在编译后完全擦除 — 运行时无法区分
 * "直接实现接口" 与 "duck-typed 结构匹配"。
 *
 * 因此，此命令实现两层策略:
 * 1. 编译时委托: 通知用户 `tsc --noEmit` 已经强制所有 `implements` 子句
 * 2. 运行时启发式: 检测部分接口实现模式（某个 trait 类具有接口的部分方法但缺少其余方法），
 *    这种模式强烈暗示接口声明不完整或遗漏
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// 已知接口方法映射（TypeScript 特有，对应 C# 反射 GetMethods()）
// ---------------------------------------------------------------------------

/**
 * 将接口名称映射到其声明的方法名集合。
 *
 * 此映射从 TraitsInterfaces.ts 实际定义的 TypeScript 接口手动维护。
 * 每个条目代表该接口声明的所有方法名称。
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
  IEffectiveOwner: ['getEffectiveOwner'],
  IFirepowerModifier: ['getFirepowerModifier'],
  IDamageModifier: ['getDamageModifier'],
  IReloadModifier: ['getReloadModifier'],
  IRangeModifier: ['getRangeModifier'],
  IInaccuracyModifier: ['getInaccuracyModifier'],
  IArmor: ['getArmorType'],
  IMove: ['moveTo'],
  INotifyMoving: ['onMovementStarted', 'onMovementComplete'],
  IProductionCostModifier: ['getProductionCostModifier'],
  IProductionTimeModifier: ['getProductionTimeModifier'],
  IObservesVariables: ['getVariableObservers'],
  INotifyConditionsChanged: ['conditionsChanged'],
  INotifyDamageStateChanged: ['damageStateChanged'],
  ITargetableCells: ['targetableCells'],
  ITargetablePositions: ['targetablePositions'],
}

// ---------------------------------------------------------------------------
// CheckExplicitInterfacesCommand（对应 OpenRA CheckExplicitInterfacesCommand）
// ---------------------------------------------------------------------------

/**
 * 验证已注册的 trait 类具备完整的接口方法覆盖。
 *
 * OpenRA 对照: public class CheckExplicitInterfacesCommand : IUtilityCommand
 */
export class CheckExplicitInterfacesCommand implements IUtilityCommand {
  readonly name = '--check-explicit-interfaces'

  private _violationCount = 0

  // ---------------------------------------------------------------------------
  // validateArguments
  // ---------------------------------------------------------------------------

  validateArguments(args: string[]): boolean {
    return args.length === 0
  }

  // ---------------------------------------------------------------------------
  // run
  // ---------------------------------------------------------------------------

  run(utility: Utility, _args: string[]): void {
    this._violationCount = 0

    // 编译时委托消息:
    // TypeScript 接口在编译后擦除 — 运行时无法确定一个类是否声明了
    // "implements IFoo"。`tsc --noEmit` 已在编译时强制执行所有 implements
    // 子句。此命令提供额外的运行时启发式检查。
    console.log(
      'NOTE: Interface implementation verification is primarily handled at compile ' +
        'time by `tsc --noEmit`. Run `npx tsc --noEmit` for full verification.',
    )

    console.log(
      'Checking explicit interface implementations in mod: ' +
        utility.modData.manifest.id,
    )

    const classNames = utility.modData.objectCreator.registeredNames

    for (const className of classNames) {
      const ctor = utility.modData.objectCreator.getType(className)
      if (!ctor) continue
      if (typeof ctor !== 'function' || !ctor.prototype) continue

      this._checkClass(className, ctor)
    }

    if (this._violationCount > 0) {
      console.log(`Explicit interface violations: ${this._violationCount}`)
      console.log(
        'Run `npx tsc --noEmit` to see compile-time interface errors.',
      )
      this._exitWithError()
    } else {
      console.log('No explicit interface violations found.')
    }
  }

  // ---------------------------------------------------------------------------
  // 私有方法
  // ---------------------------------------------------------------------------

  /**
   * 检查单个类的接口实现完整性。
   *
   * 运行时启发式: 如果一个类在原型上具有某个已定义接口的部分方法但缺少其余方法，
   * 将其标记为违规。这是"忘记声明 implements 子句"的强信号。
   *
   * @param className — 类名（来自注册表）
   * @param ctor — 类构造函数
   */
  private _checkClass(
    className: string,
    ctor: new (...args: unknown[]) => unknown,
  ): void {
    const proto = ctor.prototype as Record<string, unknown>
    const protoKeys = new Set(Object.getOwnPropertyNames(proto))
    const protoChainMethods = this._getPrototypeChainMethods(proto)
    const allMethods = new Set([...protoKeys, ...protoChainMethods])

    for (const [ifaceName, requiredMethods] of Object.entries(
      KNOWN_INTERFACE_METHODS,
    )) {
      if (requiredMethods.length === 0) continue

      // 统计此类实现了多少接口方法
      const implementedCount = requiredMethods.filter((m) =>
        allMethods.has(m),
      ).length
      const totalRequired = requiredMethods.length

      // 部分实现: 具有某些方法但不具有全部方法
      // 这是接口声明不完整的强信号
      if (implementedCount > 0 && implementedCount < totalRequired) {
        const missingMethods = requiredMethods.filter(
          (m) => !allMethods.has(m),
        )

        console.error(
          `${className}: partial implementation of ${ifaceName} — ` +
            `implemented ${implementedCount}/${totalRequired} methods. ` +
            `Missing: ${missingMethods.join(', ')}`,
        )
        this._violationCount++
        continue
      }

      // 完全实现: 类具有接口的所有方法
      // 在 TS 中这是良好的（无论是通过 extends 还是 duck typing）
      if (implementedCount === totalRequired) {
        // 检查方法是否在类自身的原型上（直接定义，而非仅继承）
        const ownMethodCount = requiredMethods.filter((m) =>
          protoKeys.has(m),
        ).length

        if (ownMethodCount > 0) {
          console.log(
            `\t${className} — implements ${ifaceName} ` +
              `(${ownMethodCount}/${totalRequired} methods own, ` +
              `${totalRequired - ownMethodCount} inherited)`,
          )
        }
      }
    }
  }

  /**
   * 获取对象原型链上的所有方法名。
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
