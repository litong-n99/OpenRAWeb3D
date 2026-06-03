/**
 * ThreadedGraphicsContext.ts — 多线程图形上下文 NOP 存根
 * OpenRA 对照: OpenRA.Platforms.Default/ThreadedGraphicsContext.cs
 *
 * 核心范式转换:
 * - OpenRA 双线程渲染管线（主线程 + 渲染线程）→ 浏览器单线程模型
 * - SDL2 线程同步原语 → Web Worker + OffscreenCanvas（未来可选优化）
 *
 * 此文件为 NOP 存根，因为:
 * 1. 浏览器 JavaScript 执行模型为单线程（主线程），
 *    WebGL 2.0 上下文只能在创建它的线程中访问。
 * 2. Babylon.js Engine 在主线程运行，所有渲染操作串行执行。
 * 3. requestAnimationFrame 回调自动与浏览器刷新率同步，
 *    无需手动实现帧同步原语。
 * 4. 未来可选优化: Web Worker + OffscreenCanvas
 *    （允许在 Worker 线程中进行 WebGL 渲染）。
 *    但这是性能优化阶段的事宜，当前阶段仅记录为 TODO。
 * 5. OpenRA 的 ThreadAffine 线程亲和性验证已完全移除，
 *    因为 TypeScript/JavaScript 在浏览器中天然单线程。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。浏览器单线程模型无需线程上下文分离。
 * @future Web Worker + OffscreenCanvas 渲染管线（性能优化阶段）
 */

// 无代码 —— 浏览器单线程模型无需线程上下文管理。
// ThreadAffine 基类已移除（见 src/OpenRA.Platforms.Default/ThreadAffine.ts）。
