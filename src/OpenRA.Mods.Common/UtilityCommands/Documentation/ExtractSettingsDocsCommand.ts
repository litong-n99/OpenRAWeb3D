/**
 * ExtractSettingsDocsCommand.ts — 生成设置文档 (markdown 格式)
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/Documentation/ExtractSettingsDocsCommand.cs (112 lines)
 *
 * 核心范式转换:
 * - C# Utility.GetFields + DescAttribute 反射 → 预提取的 SettingsSection 描述符
 * - C# SettingsModule + YamlNodeAttribute → 节描述符显式注册表
 * - C# LaunchArguments + Arguments → 预提取的 "Launch" 字段描述符
 * - C# Console.WriteLine → 字符串累积器（write callback 注入）
 *
 * 此命令生成带有设置文档的 markdown 文件。
 * 所有反射式数据提取推迟到构建时；
 * 设置节通过显式描述符数组提供。
 */

import type { IUtilityCommand, Utility } from '../../../OpenRA.Game/IUtilityCommand.js'
import type { SettingsSection, SettingsFieldDescriptor } from './DocumentationHelpers.js'

// ---------------------------------------------------------------------------
// ExtractSettingsDocsCommand
// ---------------------------------------------------------------------------

/**
 * 设置文档提取命令。
 *
 * 用法: --settings-docs [VERSION]
 *
 * 生成带有设置文档的 markdown，包含每个设置键的描述和默认值。
 *
 * 输出采用以下格式:
 * ```
 * This documentation displays annotated settings with default values...
 *
 * ## Location
 * ...
 *
 * ## {SectionKey}
 * ### {FieldName}
 * {description}
 *
 * **Default Value:** {value}
 * ```miniyaml
 * {key}:
 * \t{name}: {value}
 * ```
 * ```
 *
 * OpenRA 对照: sealed class ExtractSettingsDocsCommand : IUtilityCommand
 */
export class ExtractSettingsDocsCommand implements IUtilityCommand {
  readonly name = '--settings-docs'

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
   * 执行设置文档生成。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令执行上下文
   * @param args — 参数数组（可选 VERSION 说明符）
   */
  run(utility: Utility, args: string[]): void {
    // 确定版本字符串
    let version = utility.modData.manifest.metadata.version
    if (args.length > 1) {
      version = args[1]
    }

    const output = this._generateDocs(version)
    console.log(output)
  }

  /**
   * 生成完整的设置文档 markdown。
   *
   * 此方法与 run() 分离以允许无 console.log 的测试。
   *
   * @param version — 版本字符串
   * @returns 完整的 markdown 字符串
   */
  generateDocs(version: string): string {
    return this._generateDocs(version)
  }

  // ---------------------------------------------------------------------------
  // 内部文档生成
  // ---------------------------------------------------------------------------

  /** 生成完整的 markdown 文档。 */
  private _generateDocs(version: string): string {
    const lines: string[] = []

    // 页眉
    lines.push(
      `This documentation displays annotated settings with default values and description. ` +
        `Please do not edit it directly, but add new \`[Desc("String")]\` tags to the source code. ` +
        `This file has been automatically generated for version ${version} of OpenRA.`,
    )
    lines.push('')
    lines.push(
      'All settings can be changed by starting the game via a command-line parameter like ' +
        '`Game.Mod=ra`.',
    )
    lines.push('')

    // 位置
    lines.push('## Location')
    lines.push('* Windows: `%APPDATA%\\OpenRA\\settings.yaml`')
    lines.push('* Mac OS X: `~/Library/Application Support/OpenRA/settings.yaml`')
    lines.push('* Linux `~/.config/openra/settings.yaml`')
    lines.push('')
    lines.push(
      'Older releases (before playtest-20190825) used different locations, ' +
        'which newer versions may continue to use in some circumstances:',
    )
    lines.push('* Windows: `%USERPROFILE%\\Documents\\OpenRA\\settings.yaml`')
    lines.push('* Linux `~/.openra/settings.yaml`')
    lines.push('')
    lines.push(
      'If you create the folder `Support` relative to the OpenRA main directory, everything ' +
        'including settings gets stored there to aid portable installations.',
    )
    lines.push('')

    // 设置节
    for (const section of this._settingsSections) {
      this._writeFields(section.key, section.fields, lines)
    }

    // 启动参数
    this._writeFieldsWithNote(
      'Launch',
      this._launchFields,
      "These are runtime parameters which can't be defined in `settings.yaml`.",
      lines,
    )

    return lines.join('\n') + '\n'
  }

  /**
   * 将设置节字段写入 markdown。
   *
   * OpenRA 对照: ExtractSettingsDocsCommand.WriteFields(string key, object value)
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
    let writeHeader = true

    for (const field of fields) {
      if (writeHeader) {
        lines.push(`## ${key}`)
        writeHeader = false
      }

      lines.push(`### ${field.name}`)

      for (const descLine of field.descriptionLines) {
        lines.push(descLine)
        lines.push('')
      }

      const fieldValue = field.defaultValue
      if (fieldValue !== null && !fieldValue.startsWith('System.')) {
        lines.push(`**Default Value:** ${fieldValue}`)
        lines.push('')
        lines.push('```miniyaml')
        lines.push(`${key}: `)
        lines.push(`\t${field.name}: ${fieldValue}`)
        lines.push('```')
      }
    }
  }

  /**
   * 将字段写入 markdown，预先输出一个注释行。
   *
   * 用于 "Launch" 节。
   *
   * @param key — 节键
   * @param fields — 字段描述符
   * @param note — 在节标题后输出的注释行
   * @param lines — 用于累积输出的行数组
   */
  private _writeFieldsWithNote(
    key: string,
    fields: readonly SettingsFieldDescriptor[],
    note: string,
    lines: string[],
  ): void {
    if (fields.length === 0) return

    lines.push(`## ${key}`)
    lines.push(note)

    for (const field of fields) {
      lines.push(`### ${field.name}`)

      for (const descLine of field.descriptionLines) {
        lines.push(descLine)
        lines.push('')
      }

      const fieldValue = field.defaultValue
      if (fieldValue !== null && !fieldValue.startsWith('System.')) {
        lines.push(`**Default Value:** ${fieldValue}`)
        lines.push('')
        lines.push('```miniyaml')
        lines.push(`${key}: `)
        lines.push(`\t${field.name}: ${fieldValue}`)
        lines.push('```')
      }
    }
  }
}
