/**
 * postprocess_menufade.frag — 菜单渐隐后处理片段着色器
 * OpenRA 对照: glsl/postprocess_menufade.frag
 *
 * 效果: 在两个效果状态之间混合（原始颜色 / 黑色 / 灰度）。
 * 用于菜单切换渐变。
 *
 * Uniform 映射:
 * - From: float — 起始效果状态 (0.0-2.0)
 * - To: float — 目标效果状态 (0.0-2.0)
 * - Blend: float — 从 From 到 To 的混合系数 (0.0-1.0)
 * - SourceTexture: sampler2D — 场景渲染缓冲
 *
 * 效果状态区间:
 *   [0.0, 0.5] — 原始颜色
 *   (0.5, 1.5] — 黑色
 *   (1.5, 2.0] — 灰度
 */
#version 300 es
precision mediump float;

uniform float From;
uniform float To;
uniform float Blend;
uniform sampler2D SourceTexture;
out vec4 fragColor;

vec4 ColorForEffect(float effect, vec4 c)
{
	if (effect > 1.5)
	{
		float lum = 0.5 * (min(c.r, min(c.g, c.b)) + max(c.r, max(c.g, c.b)));
		return vec4(lum, lum, lum, c.a);
	}

	if (effect > 0.5)
	{
		return vec4(0.0, 0.0, 0.0, c.a);
	}

	return c;
}

void main()
{
	vec4 c = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy), 0);
	fragColor = mix(ColorForEffect(To, c), ColorForEffect(From, c), Blend);
}
