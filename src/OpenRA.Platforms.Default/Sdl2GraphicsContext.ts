/**
 * Sdl2GraphicsContext.ts — SDL2 OpenGL 图形上下文 NOP 存根
 * OpenRA 对照: OpenRA.Platforms.Default/Sdl2GraphicsContext.cs
 *
 * 核心范式转换:
 * - SDL2 GL context 管理（SDL_GL_CreateContext/SDL_GL_SwapWindow）
 *   → BABYLON.Engine 构造时自动创建 WebGL 2.0 上下文
 * - IGraphicsContext 接口的所有方法 → BABYLON.Engine 内部管理
 *
 * 此文件为 NOP 存根，因为:
 * 1. Babylon.js Engine 在初始化时自动创建 WebGL 2.0 上下文
 *    （通过 HTMLCanvasElement.getContext('webgl2')）。
 * 2. OpenRA 中 IGraphicsContext 的所有资源工厂方法
 *    （createVertexBuffer, createTexture, createFrameBuffer 等）
 *    已由各个平台类直接使用 Babylon.js 构造函数替代。
 * 3. 帧同步（SwapWindow/VSync）由 Engine.runRenderLoop() 和
 *    requestAnimationFrame 自动处理。
 * 4. 浏览器沙盒阻止直接访问底层 GPU 上下文，
 *    所有 GL 操作均通过 Babylon.js 的抽象层进行。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。功能已由 BABYLON.Engine 提供。
 * @see src/OpenRA.Game/Renderer.ts — 引擎初始化与渲染循环
 */

// 无代码 —— 所有功能由 BABYLON.Engine 内部管理。
// IGraphicsContext 接口定义位于:
//   src/OpenRA.Game/Graphics/PlatformInterfaces.ts
