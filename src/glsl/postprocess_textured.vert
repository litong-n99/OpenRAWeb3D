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
