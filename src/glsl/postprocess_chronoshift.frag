/**
 * postprocess_chronoshift.frag — 超时空转换后处理片段着色器
 * OpenRA 对照: glsl/postprocess_chronoshift.frag
 *
 * 效果: 根据 Blend 参数在原始颜色与灰度化之间混合。
 * 用于超时空传送视觉效果。
 *
 * GLSL 版本适配:
 * - OpenGL 3.2 / GLSL 1.50 → WebGL 2.0 / GLSL ES 3.0
 * - `#version {VERSION}` 模板 → `#version 300 es`
 * - `texelFetch` → 保持（GLSL ES 3.0 支持）
 * - `out vec4 fragColor` → 保持
 *
 * Uniform 映射:
 * - Blend: float — 混合系数 (0.0 = 原始, 1.0 = 灰度)
 * - SourceTexture: sampler2D — 场景渲染缓冲
 */
#version 300 es
precision mediump float;

uniform float Blend;
uniform sampler2D SourceTexture;
out vec4 fragColor;

void main()
{
	vec4 c = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy), 0);
	float lum = 0.5 * (min(c.r, min(c.g, c.b)) + max(c.r, max(c.g, c.b)));
	fragColor = mix(c, vec4(lum, lum, lum, c.a), Blend);
}
