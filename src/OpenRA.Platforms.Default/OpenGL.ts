/**
 * OpenGL.ts — OpenGL 绑定封装 NOP 存根
 * OpenRA 对照: OpenRA.Platforms.Default/OpenGL.cs
 *
 * 核心范式转换:
 * - 手动 gl* 函数绑定 (glGenTextures, glBufferData, etc.) → BABYLON.Engine 内部管理
 * - GLProfile (Automatic/ANGLE/Modern/Embedded) → WebGL 2.0 自动探测
 * - GLFeatures 能力检测 → Babylon.js Engine.getCaps()
 * - CheckGLError 错误检查 → Babylon.js 内部错误处理
 *
 * 此文件为 NOP 存根，因为:
 * 1. Babylon.js Engine 在初始化时自动加载 WebGL 2.0 函数入口点，
 *    所有 GL 操作通过 Babylon.js 的抽象层进行。
 * 2. WebGL 2.0 上下文由浏览器自动选择（与设备能力匹配），
 *    无需手动指定 GLProfile。
 * 3. 原始 OpenRA OpenGL 静态类中的 CheckGLError() 错误检查
 *    在 Babylon.js 内部自动处理（通过 ANGLE_instanced_arrays 和调试回调）。
 * 4. GL 扩展管理由 Babylon.js Engine 的扩展系统处理。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。功能由 BABYLON.Engine 和 WebGL 2.0 API 提供。
 */

// 无代码 —— 所有 GL 函数调用由 BABYLON.Engine 内部管理。
// WebGL 2.0 上下文通过 HTMLCanvasElement.getContext('webgl2') 自动创建。
