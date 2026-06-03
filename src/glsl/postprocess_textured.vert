/**
 * postprocess_textured.vert — 纹理化后处理顶点着色器
 * OpenRA 对照: glsl/postprocess_textured.vert
 *
 * 用于需要纹理坐标的后处理效果（sonic、vortex）。
 * 与 postprocess.vert 不同，此着色器传递 UV 坐标给片段着色器。
 *
 * 核心范式转换:
 * - OpenRA 手动全屏四边形顶点 + UV → Babylon.js PostProcess 自动处理
 * - `p1/p2` 投影参数 → Babylon.js 自动注入投影矩阵
 * - 在 Babylon.js PostProcess 中使用时，此着色器可能需要适配
 *   PostProcess 的顶点约定
 *
 * Uniform 映射:
 * - Pos: vec2 — 屏幕位置偏移
 * - Scroll: vec2 — 滚动偏移
 * - p1: vec2 — 缩放因子
 * - p2: vec2 — 平移因子
 * - aVertexPosition: vec2 — 顶点位置输入
 * - aVertexTexCoord: vec2 — 纹理坐标输入
 *
 * TODO-2.S3 — Babylon.js PostProcess 适配方案:
 *   原始 OpenRA 通过 p1/p2 手动计算投影（(pos + Pos - Scroll) * p1 + p2），
 *   Babylon.js PostProcess 使用内部全屏四边形（NDC [-1,1] 空间），
 *   忽略这些手动投影 uniform。适配策略:
 *
 *   方案 A（推荐）: 在 PostProcess 子类构造函数中计算 p1/p2 等效值，
 *     通过 onApply 回调使用 effect.setFloat2("p1", ...) 设置。
 *     使用 engine.getRenderWidth()/getRenderHeight() 计算视口缩放。
 *
 *   方案 B: 重写着色器使用 Babylon.js 内置的 projection 矩阵，
 *     移除 p1/p2/Pos/Scroll，改用 Babylon.js PostProcess
 *     自动注入的 viewport 信息。
 *
 *   当前文件保留完整 OpenRA 兼容的 uniform 集合，
 *   作为参考代码。实际使用时选用方案 A 或 B。
 */
#version 300 es

uniform vec2 Pos, Scroll;
uniform vec2 p1, p2;

in vec2 aVertexPosition;
in vec2 aVertexTexCoord;
out vec2 vTexCoord;

void main()
{
	gl_Position = vec4((aVertexPosition + Pos - Scroll) * p1 + p2, 0.0, 1.0);
	vTexCoord = aVertexTexCoord;
}
