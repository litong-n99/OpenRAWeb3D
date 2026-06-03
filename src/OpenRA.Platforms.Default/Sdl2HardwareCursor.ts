/**
 * Sdl2HardwareCursor.ts — SDL2 硬件光标 NOP 存根
 * OpenRA 对照: OpenRA.Platforms.Default/Sdl2HardwareCursor.cs
 *
 * 核心范式转换:
 * - SDL2 SDL_CreateColorCursor → CSS cursor 属性 + Data URL
 * - IHardwareCursor 接口 → CSSStyleDeclaration.cursor
 *
 * 此文件为 NOP 存根，因为:
 * 1. 浏览器提供原生 CSS cursor 属性，支持:
 *    - 内置光标: 'pointer', 'crosshair', 'move', 'default' 等
 *    - 自定义光标: cursor: url('data:image/png;base64,...'), auto
 *    - 通过 HTMLCanvasElement.toDataURL() 动态生成光标图像
 * 2. CSS cursor 由浏览器硬件加速渲染，无需手动管理 GPU 光标纹理。
 * 3. IHardwareCursor 接口已在 PlatformInterfaces.ts 中定义，
 *    具体实现可在需要时创建（通过 CSS cursor 属性的轻量包装）。
 * 4. CursorManager（OpenRA.Game/Graphics/CursorManager.cs）的迁移
 *    将直接使用 CSS cursor 属性，绕过 IHardwareCursor 抽象层。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。功能由 CSS cursor 属性提供。
 * @see src/OpenRA.Game/Graphics/CursorManager.ts — 光标管理（待迁移）
 */

// 无代码 —— 所有功能由 CSS cursor 属性提供。
// IHardwareCursor 接口定义位于:
//   src/OpenRA.Game/Graphics/PlatformInterfaces.ts
