/**
 * postprocess_tint.frag — 色调后处理片段着色器
 * OpenRA 对照: glsl/postprocess_tint.frag
 *
 * 效果: 将场景颜色乘以 Tint 颜色，实现昼夜循环等全局色调效果。
 *
 * Uniform 映射:
 * - Tint: vec3 — 色调乘数 (RGB，每个通道独立)
 * - SourceTexture: sampler2D — 场景渲染缓冲
 *
 * 注意：此效果通常始终启用（Enabled = true），
 * 默认 Tint = (1.0, 1.0, 1.0) 即无变化。
 */
#version 300 es
precision mediump float;

uniform vec3 Tint;
uniform sampler2D SourceTexture;
out vec4 fragColor;

void main()
{
	vec4 c = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy), 0);
	fragColor = vec4(Tint, c.a) * c;
}
