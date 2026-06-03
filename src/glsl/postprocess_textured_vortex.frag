/**
 * postprocess_textured_vortex.frag — 漩涡纹理后处理片段着色器
 * OpenRA 对照: glsl/postprocess_textured_vortex.frag
 *
 * 效果: 基于 VortexTexture 查找的像素位移 + 强度衰减。
 * 用于超时空漩涡视觉效果。这是最复杂的后处理着色器。
 *
 * Uniform 映射:
 * - VortexTexture: sampler2D — 漩涡位移查找纹理
 * - SourceTexture: sampler2D — 场景渲染缓冲
 * - vTexCoord: vec2 — 来自顶点着色器的纹理坐标
 *
 * 处理管道:
 *   1. 从 VortexTexture 采样位移向量 (delta)
 *   2. 从 VortexTexture 采样强度系数 (frac)
 *   3. 从 SourceTexture 按 delta 偏移采样
 *   4. 输出偏移颜色 * 强度
 *   5. 如果 VortexTexture.r > 0.055，丢弃该片段
 */
#version 300 es
precision mediump float;

uniform sampler2D VortexTexture;
uniform sampler2D SourceTexture;

in vec2 vTexCoord;
out vec4 fragColor;

void main()
{
	vec4 vtx = texture(VortexTexture, vTexCoord.xy);

	vec2 delta = (vtx.bg - 0.5) * 256.0;
	float frac = 16.0 * vtx.r + 0.0625;
	if (vtx.r > 0.055)
		discard;

	fragColor = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy + delta), 0)
	          * vec4(frac, frac, frac, 1.0);
}
