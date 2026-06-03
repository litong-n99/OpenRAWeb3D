/**
 * model.frag — 模型片段着色器 NOP 存根
 * OpenRA 对照: glsl/model.frag
 *
 * 核心范式转换:
 * - OpenRA 手动调色板纹理查找（Palette + DiffuseTexture 双纹理采样）
 *   → Babylon.js StandardMaterial.diffuseTexture + 内置 sRGB 管线
 * - 手动法线贴图解码（第二纹理层 + 调色板查找 + 光照计算）
 *   → Babylon.js PBRMaterial.normalTexture + 内置 PBR 光照模型
 * - 手动 Alpha 测试（color.a < 0.01 → discard）
 *   → Babylon.js StandardMaterial.alphaMode + alphaCutOff
 * - `AmbientLight + DiffuseLight` 手动光照
 *   → Babylon.js Scene 灯光系统（HemisphericLight / DirectionalLight）
 * - `LightDirection` uniform 与自定义漫反射点积
 *   → Babylon.js 内置 lambert / phong / PBR 光照模型
 *
 * 此着色器无需迁移，因为:
 * 1. Babylon.js StandardMaterial 在 WebGL 2.0 下原生处理漫反射纹理采样、
 *    Alpha 混合/测试与 sRGB 色彩空间转换。
 *    - 替代: StandardMaterial.diffuseTexture 替代 DiffuseTexture 采样器
 *    - 替代: StandardMaterial.alphaMode + alphaCutOff 替代手动 discard
 * 2. 法线贴图与光照计算由 PBRMaterial 管线完整支持
 *    （normalTexture + metallicTexture + roughnessTexture）。
 *    - 替代: PBRMaterial.normalTexture 替代第二纹理层法线查找
 *    - 替代: Scene 灯光系统替代手动 AmbientLight/DiffuseLight
 * 3. 【调色板限制】调色板-法线并行纹理查找是 OpenRA 特有的索引颜色优化。
 *    原始 model.frag 通过 Palette 纹理查找将索引颜色转换为真彩色，
 *    并通过第二 Palette 行查找法线向量。Babylon.js 的真彩色纹理管线
 *    不依赖 256 色调色板，因此不支持此双纹理查找模式。
 *    如需调色板索引颜色支持，请使用 combined.frag 迁移版的自定义
 *    ShaderMaterial（参见 src/OpenRA.Platforms.Default/Shader.ts）。
 * 4. 浏览器环境下 WebGL 2.0 自动处理 Gamma/sRGB 转换，
 *    无需手动片段着色器编写。
 *
 * 保留此文件以维持与 OpenRA 的目录结构一致性。
 *
 * @nop — 无需迁移。功能由 BABYLON.StandardMaterial / PBRMaterial 提供。
 *   - 漫反射纹理: StandardMaterial.diffuseTexture 代替 DiffuseTexture 采样器
 *   - 调色板查找: StandardMaterial 使用真彩色纹理，不支持索引颜色查找
 *   - 法线贴图: PBRMaterial.normalTexture 代替第二纹理层法线解码
 *   - 光照: BABYLON.DirectionalLight / HemisphericLight 代替手动 uniform
 *   - Alpha 测试: StandardMaterial.alphaCutOff 代替手动 discard
 * @see src/OpenRA.Game/Graphics/ShaderBindings.ts — 纹理采样器绑定
 * @see src/OpenRA.Platforms.Default/Shader.ts — 自定义 ShaderMaterial（调色板）
 */

// 无代码 —— 模型片段着色由 BABYLON.StandardMaterial / PBRMaterial 内部管理。
// 原始 OpenRA 着色器 (29 行) 参考:
//   OpenRA/glsl/model.frag
