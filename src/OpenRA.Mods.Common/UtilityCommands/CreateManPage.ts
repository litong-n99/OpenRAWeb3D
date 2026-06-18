/**
 * CreateManPage.ts — 生成 UNIX man page (troff 格式)
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/CreateManPage.cs (109 lines)
 *
 * 核心范式转换:
 * - C# Utility.GetFields + DescAttribute 反射 → 预提取的 SettingsSection 描述符
 * - C# SettingsModule + YamlNodeAttribute → 节描述符显式注册表
 * - C# LaunchArguments + Arguments → 预提取的 "Launch" 字段描述符
 * - C# Console.Write/Console.WriteLine → 字符串累积器（write callback 注入）
 *
 * 此命令生成 UNIX man page，采用 troff 格式 (.TH, .SH, .TP, .BR 指令)。
 * 所有反射式数据提取推迟到构建时；
 * 设置节通过显式描述符数组提供。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import type { SettingsSection, SettingsFieldDescriptor } from './Documentation/DocumentationHelpers.js'

// ---------------------------------------------------------------------------
// CreateManPage
// ---------------------------------------------------------------------------

/**
 * Man page 创建命令。
 *
 * 用法: --man-page
 *
 * 生成 UNIX man page，采用 troff 格式，输出:
 * - .TH 页眉
 * - .SH NAME / SYNOPSIS / DESCRIPTION / OPTIONS / FILES / BUGS / COPYRIGHT 节
 * - 每个设置字段一个 .TP 段落
 *
 * 输出格式:
 * ```
 * .TH OPENRA 6
 * .SH NAME
 * openra \- An Open Source modernization...
 * .SH OPTIONS
 * .TP
 * .BR {key}.{fieldName}=...
 * {description lines}
 * ...
 * ```
 *
 * OpenRA 对照: sealed class CreateManPage : IUtilityCommand
 */
export class CreateManPage implements IUtilityCommand {
  readonly name = '--man-page'

  private _settingsSections: readonly SettingsSection[]
  private _launchFields: readonly SettingsFieldDescriptor[]

  /**
   * @param settingsSections — 预提取的设置节数组（按名称排序）
   * @param launchFields — "Launch" 节的启动参数字段描述符
   */
  constructor(
    settingsSections: readonly SettingsSection[],
    launchFields: readonly SettingsFieldDescriptor[],
  ) {
    this._settingsSections = settingsSections
    this._launchFields = launchFields
  }

  validateArguments(_args: string[]): boolean {
    return true
  }

  /**
   * 执行 man page 生成。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param _utility — 命令执行上下文（未使用）
   * @param _args — 参数数组（未使用）
   */
  run(_utility: Utility, _args: string[]): void {
    const output = this._generateManPage()
    console.log(output)
  }

  /**
   * 生成完整的 man page。
   *
   * 此方法与 run() 分离以允许无 console.log 的测试。
   *
   * @returns 完整的 troff 格式的 man page 字符串
   */
  generateManPage(): string {
    return this._generateManPage()
  }

  // ---------------------------------------------------------------------------
  // 内部 man page 生成
  // ---------------------------------------------------------------------------

  /** 生成完整的 troff man page。 */
  private _generateManPage(): string {
    const lines: string[] = []

    // 页眉
    lines.push('.TH OPENRA 6')
    lines.push('.SH NAME')
    lines.push(
      'openra \\- An Open Source modernization of the early 2D Command & Conquer games.',
    )
    lines.push('.SH SYNOPSIS')
    lines.push('.B openra')
    lines.push('[\\fB\\Game.Mod=\\fR\\fIra\\fR]')
    lines.push('.SH DESCRIPTION')
    lines.push('.B openra')
    lines.push('starts the game.')
    lines.push('.SH OPTIONS')

    // 设置节
    for (const section of this._settingsSections) {
      this._writeFields(section.key, section.fields, lines)
    }

    // 启动参数
    this._writeFields('Launch', this._launchFields, lines)

    // 页脚
    lines.push('.SH FILES')
    lines.push('Settings are stored in the ~/.openra user folder.')
    lines.push('.SH BUGS')
    lines.push('Known issues are tracked at https://bugs.openra.net')
    lines.push('.SH COPYRIGHT')
    lines.push('Copyright (c) The OpenRA Developers and Contributors')
    lines.push(
      'This manual is part of OpenRA, which is free software. It is GNU GPL v3 licensed. See COPYING for details.',
    )

    return lines.join('\n') + '\n'
  }

  /**
   * 将设置字段写入为 troff .TP 段落。
   *
   * OpenRA 对照: CreateManPage.WriteFields(string key, object value)
   *
   * @param key — 节键（例如 "Sound", "Graphics"）
   * @param fields — 字段描述符
   * @param lines — 用于累积输出的行数组
   */
  private _writeFields(
    key: string,
    fields: readonly SettingsFieldDescriptor[],
    lines: string[],
  ): void {
    for (const field of fields) {
      lines.push('.TP')
      const beginTag = `.BR ${key}.${field.name}=`

      const fieldValue = field.defaultValue
      if (
        fieldValue !== null &&
        fieldValue !== 'True' &&
        fieldValue !== 'False' &&
        !fieldValue.startsWith('System.')
      ) {
        lines.push(`${beginTag}\\fI${fieldValue}\\fR`)
      } else {
        lines.push(beginTag)
      }

      for (const descLine of field.descriptionLines) {
        lines.push(descLine)
      }
    }
  }
}
