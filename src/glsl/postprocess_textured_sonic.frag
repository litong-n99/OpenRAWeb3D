/**
 * postprocess_textured_sonic.frag — 声波后处理片段着色器
 * OpenRA 对照: glsl/postprocess_textured_sonic.frag
 *
 * 效果: 基于纹理坐标的圆形裁剪区域 + 像素偏移。
 * 用于声波攻击的视觉扭曲效果。
 *
 * Uniform 映射:
 * - SourceTexture: sampler2D — 场景渲染缓冲
 * - Scale: float — UV 偏移缩放因子
 * - vTexCoord: vec2 — 来自顶点着色器的纹理坐标
 */
#version 300 es
precision mediump float;

uniform sampler2D SourceTexture;
uniform float Scale;

in vec2 vTexCoord;
out vec4 fragColor;

void main()
{
	if (dot(vTexCoord, vTexCoord) >= 1.0)
		discard;

	fragColor = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy + Scale * vTexCoord), 0);
}
