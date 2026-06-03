/**
 * postprocess_flash.frag — 闪光效果后处理片段着色器
 * OpenRA 对照: glsl/postprocess_flash.frag
 *
 * 效果: 根据 Blend 参数在原始颜色与指定 Color 之间混合。
 * 用于爆炸闪光、受伤闪烁等视觉效果。
 *
 * Uniform 映射:
 * - Blend: float — 混合系数 (0.0 = 原始, 1.0 = Color)
 * - Color: vec3 — 闪光颜色 (RGB, 0.0-1.0)
 * - SourceTexture: sampler2D — 场景渲染缓冲
 */
#version 300 es
precision mediump float;

uniform float Blend;
uniform vec3 Color;
uniform sampler2D SourceTexture;
out vec4 fragColor;

void main()
{
	vec4 c = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy), 0);
	fragColor = mix(c, vec4(Color, c.a), Blend);
}
