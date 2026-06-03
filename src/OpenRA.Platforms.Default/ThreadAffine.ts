/**
 * ThreadAffine.ts — 线程亲和基类 NOP 存根
 * OpenRA 对照: OpenRA.Platforms.Default/ThreadAffine.cs
 *
 * 核心范式转换:
 * - C# 线程亲和性验证 (VerifyThreadAffinity) → 已移除
 * - 原因: JavaScript/TypeScript 在浏览器中运行于单线程主线程模型。
 *   Web Workers 有独立的执行上下文且无法共享 WebGL 上下文，
 *   因此不存在多线程竞争图形资源的场景。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。浏览器单线程模型无需线程亲和性验证。
 */

// 无代码 —— 浏览器 JavaScript 为单线程执行模型。
// WebGL 2.0 上下文仅在创建线程中可访问，
// Web Workers 无法共享 WebGL 上下文，
// 因此不存在并发访问 GPU 资源的场景。
