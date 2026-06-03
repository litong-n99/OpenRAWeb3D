/**
 * model.vert — 模型顶点着色器 NOP 存根
 * OpenRA 对照: glsl/model.vert
 *
 * 核心范式转换:
 * - OpenRA 手动 View * TransformMatrix * aVertexPosition 顶点变换
 *   → Babylon.js StandardMaterial / PBRMaterial 自动注入 worldViewProjection
 * - 手动 DecodeMask 纹理元数据解码（通道掩码/法线掩码）
 *   → Babylon.js 引擎自动管理纹理坐标绑定
 * - `in vec4 aVertexTexCoord`, `in vec2 aVertexTexMetadata`
 *   → BABYLON.VertexBuffer.PositionKind / UVKind / NormalKind
 *
 * 此着色器无需迁移，因为:
 * 1. Babylon.js StandardMaterial 内部处理模型顶点变换
 *    （worldViewProjection 矩阵由引擎自动注入着色器）。
 * 2. 纹理坐标传递与插值由 VertexBuffer + ShaderMaterial 标准管线管理。
 * 3. 通道/法线掩码解码逻辑专用于 OpenRA 的调色板-法线并行纹理系统，
 *    在 Babylon.js 中无对应场景 — 法线贴图由 PBRMaterial.normalTexture 直接支持。
 * 4. WebGL 2.0 顶点属性声明由 Babylon.js Effect 层自动生成。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。功能由 BABYLON.StandardMaterial / PBRMaterial 提供。
 * @see src/OpenRA.Game/Graphics/ShaderBindings.ts — 顶点属性绑定布局
 * @see src/OpenRA.Game/Graphics/PlatformInterfaces.ts — ShaderMaterial 接口
 */

// 无代码 —— 模型顶点变换由 BABYLON.StandardMaterial / PBRMaterial 内部管理。
// 原始 OpenRA 着色器 (27 行) 参考:
//   OpenRA/glsl/model.vert
