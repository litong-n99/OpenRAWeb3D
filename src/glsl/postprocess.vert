/**
 * postprocess.vert — 后处理全屏四边形顶点着色器
 * OpenRA 对照: glsl/postprocess.vert
 *
 * 核心范式转换:
 * - OpenRA 手动全屏三角形顶点 → Babylon.js PostProcess 自动处理
 * - 此着色器保留用于自定义 PostProcess 类，Babylon.js 自动传递
 *   全屏四边形顶点坐标，此着色器仅需透传。
 *
 * GLSL 版本适配:
 * - OpenGL 3.2 / GLSL 1.50 → WebGL 2.0 / GLSL ES 3.0
 * - `attribute` → `in` (vertex shader input)
 * - `gl_Position` → 保持 (WebGL 2.0 支持)
 */
#version 300 es

in vec2 aVertexPosition;

void main()
{
	gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}
