#version 300 es
precision highp float;

// ---------------------------------------------------------------------------
// combined.frag — OpenRA 精灵片段着色器的 WebGL 2.0 (GLSL ES 3.0) 迁移
// OpenRA 对照: glsl/combined.frag
//
// 核心范式转换:
// - #version {VERSION} → #version 300 es
// - #ifdef GL_ES precision → 直接声明 precision mediump float
// - varying → in (GLSL ES 3.0)
// - OpenRA 已使用 texture() / in / out，语法无需变更
// - gl_FragColor → out vec4 fragColor（OpenRA 已使用 out，无需变更）
//
// 保留的核心逻辑:
// - 调色板纹理查找: dot(tex, vChannelMask) → Palette 纹理查找
// - ColorShift HSV 色彩偏移
// - Pixel Art Scaling 手动双线性过滤
// - 深度纹理采样（用于 3D Y-sort）
// - 色调/透明度混合（vTint.a < 0 时为替换模式）
// - Alpha 测试（c.a == 0.0 时 discard）
// ---------------------------------------------------------------------------

// 纹理采样器（8 个精灵纹理 + 调色板 + 颜色偏移）
uniform sampler2D Texture0;
uniform sampler2D Texture1;
uniform sampler2D Texture2;
uniform sampler2D Texture3;
uniform sampler2D Texture4;
uniform sampler2D Texture5;
uniform sampler2D Texture6;
uniform sampler2D Texture7;
uniform sampler2D Palette;
uniform sampler2D ColorShifts;

// 渲染控制 uniform
uniform bool EnableDepthPreview;
uniform vec2 DepthPreviewParams;
uniform float DepthTextureScale;
uniform bool EnablePixelArtScaling;

// 从顶点着色器传入
in vec4 vTexCoord;
flat in float vTexPalette;
flat in vec4 vChannelMask;
flat in uint vChannelSampler;
flat in uint vChannelType;
flat in vec4 vDepthMask;
flat in uint vDepthSampler;
in vec4 vTint;

// 片段着色器输出
out vec4 fragColor;

// ---------------------------------------------------------------------------
// rgb2hsv(vec3) — RGB → HSV 色彩空间转换
//
// 来源: http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl
// 与 OpenRA combined.frag 中的实现完全一致。
// ---------------------------------------------------------------------------

vec3 rgb2hsv(vec3 c)
{
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = c.g < c.b ? vec4(c.bg, K.wz) : vec4(c.gb, K.xy);
    vec4 q = c.r < p.x ? vec4(p.xyw, c.r) : vec4(c.r, p.yzx);
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// ---------------------------------------------------------------------------
// hsv2rgb(vec3) — HSV → RGB 色彩空间转换
//
// 来源: http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl
// 与 OpenRA combined.frag 中的实现完全一致。
// ---------------------------------------------------------------------------

vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ---------------------------------------------------------------------------
// srgb2linear(float) / srgb2linear(vec4) — sRGB → 线性色彩空间
//
// 标准 gamma 转换公式。
// 来源: https://entropymine.com/imageworsener/srgbformula/
// ---------------------------------------------------------------------------

float srgb2linear(float c)
{
    return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

vec4 srgb2linear(vec4 c)
{
    // 预乘 Alpha 需先反除后再去除 gamma 校正
    float eps = 1.0e-10;
    float safeA = c.a + eps;
    return c.a * vec4(
        srgb2linear(c.r / safeA),
        srgb2linear(c.g / safeA),
        srgb2linear(c.b / safeA),
        1.0
    );
}

// ---------------------------------------------------------------------------
// linear2srgb(float) / linear2srgb(vec4) — 线性 → sRGB 色彩空间
// ---------------------------------------------------------------------------

float linear2srgb(float c)
{
    return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec4 linear2srgb(vec4 c)
{
    float eps = 1.0e-10;
    float safeA = c.a + eps;
    return c.a * vec4(
        linear2srgb(c.r / safeA),
        linear2srgb(c.g / safeA),
        linear2srgb(c.b / safeA),
        1.0
    );
}

// ---------------------------------------------------------------------------
// Size(uint) — 获取指定采样器索引的纹理尺寸
//
// 对应 OpenRA combined.frag 中的 Size 函数。
// 用于 Pixel Art Scaling 模式下的手动双线性过滤。
// ---------------------------------------------------------------------------

vec2 Size(uint samplerIndex)
{
    switch (samplerIndex)
    {
        case 7u:
            return vec2(textureSize(Texture7, 0));
        case 6u:
            return vec2(textureSize(Texture6, 0));
        case 5u:
            return vec2(textureSize(Texture5, 0));
        case 4u:
            return vec2(textureSize(Texture4, 0));
        case 3u:
            return vec2(textureSize(Texture3, 0));
        case 2u:
            return vec2(textureSize(Texture2, 0));
        case 1u:
            return vec2(textureSize(Texture1, 0));
        default:
            return vec2(textureSize(Texture0, 0));
    }
}

// ---------------------------------------------------------------------------
// Sample(uint, vec2) — 从指定采样器索引的纹理中采样
//
// 对应 OpenRA combined.frag 中的 Sample 函数。
// ---------------------------------------------------------------------------

vec4 Sample(uint samplerIndex, vec2 pos)
{
    switch (samplerIndex)
    {
        case 7u:
            return texture(Texture7, pos);
        case 6u:
            return texture(Texture6, pos);
        case 5u:
            return texture(Texture5, pos);
        case 4u:
            return texture(Texture4, pos);
        case 3u:
            return texture(Texture3, pos);
        case 2u:
            return texture(Texture2, pos);
        case 1u:
            return texture(Texture1, pos);
        default:
            return texture(Texture0, pos);
    }
}

// ---------------------------------------------------------------------------
// SamplePalettedBilinear(uint, vec2, vec2) — 调色板精灵的手动双线性过滤
//
// 从调色板纹理中采样 4 个邻域像素，进行双线性插值。
// 避免 GPU 对索引纹理的默认插值导致索引值不正确。
//
// 对应 OpenRA combined.frag 中的 SamplePalettedBilinear 函数。
// ---------------------------------------------------------------------------

vec4 SamplePalettedBilinear(uint samplerIndex, vec2 coords, vec2 textureSize)
{
    vec2 texPos = coords * textureSize - vec2(0.5);
    vec2 interp = fract(texPos);
    vec2 tl = (floor(texPos) + vec2(0.5)) / textureSize;
    vec2 px = 1.0 / textureSize;

    vec4 x1 = Sample(samplerIndex, tl);
    vec4 x2 = Sample(samplerIndex, tl + vec2(px.x, 0.0));
    vec4 x3 = Sample(samplerIndex, tl + vec2(0.0, px.y));
    vec4 x4 = Sample(samplerIndex, tl + px);

    // 注意：调色板索引精度依赖 floor(index * 255.0 + 0.5)，
    // 但双线性插值时直接使用 dot() 结果从 Palette 纹理采样
    vec4 c1 = texture(Palette, vec2(dot(x1, vChannelMask), vTexPalette));
    vec4 c2 = texture(Palette, vec2(dot(x2, vChannelMask), vTexPalette));
    vec4 c3 = texture(Palette, vec2(dot(x3, vChannelMask), vTexPalette));
    vec4 c4 = texture(Palette, vec2(dot(x4, vChannelMask), vTexPalette));

    return mix(mix(c1, c2, interp.x), mix(c3, c4, interp.x), interp.y);
}

// ---------------------------------------------------------------------------
// ColorShift(vec4, float) — 颜色偏移 (HSV 空间重映射)
//
// 从 ColorShifts 纹理读取目标色调范围和偏移量，
// 对颜色执行 HSV 空间的色调旋转、饱和度和亮度调整。
//
// 对应 OpenRA combined.frag 中的 ColorShift 函数。
// ---------------------------------------------------------------------------

vec4 ColorShift(vec4 c, float p)
{
    vec4 range = texture(ColorShifts, vec2(0.25, p));
    vec4 shift = texture(ColorShifts, vec2(0.75, p));

    vec3 hsv = rgb2hsv(srgb2linear(c).rgb);
    if (hsv.r > range.r && range.g >= hsv.r)
        c = linear2srgb(vec4(hsv2rgb(vec3(
            hsv.r + shift.r,
            clamp(hsv.g + shift.g, 0.0, 1.0),
            hsv.b * clamp(shift.b, 0.0, 1.0)
        )), c.a));

    return c;
}

// ---------------------------------------------------------------------------
// main() — 片段着色器入口
//
// 着色器执行流程（与 OpenRA 完全一致）：
// 1. 判断纹理通道类型：调色板 / 纯色 / RGBA
// 2. Pixel Art Scaling 模式下手动双线性过滤
// 3. 从调色板纹理查找最终颜色，或直接使用纹理/RGBA 颜色
// 4. Alpha 测试（透明像素 discard）
// 5. ColorShift（非调色板精灵且有颜色偏移时）
// 6. 深度采样（次纹理通道）
// 7. 深度预览模式或最终颜色输出（色调混合）
// ---------------------------------------------------------------------------

void main()
{
    vec2 coords = vTexCoord.st;
    bool isPaletted = (vChannelType & 0x01u) != 0u;
    bool isColor = vChannelType == 0u;

    vec4 c;
    if (EnablePixelArtScaling)
    {
        vec2 textureSize = Size(vChannelSampler);
        vec2 vUv = coords.st * textureSize;
        vec2 offset = fract(vUv);
        vec2 pixelsPerTexel = vec2(1.0 / dFdx(vUv.x), 1.0 / dFdy(vUv.y));

        // 偏移采样点以模拟窗口坐标的双线性插值
        // 参考: https://csantosbh.wordpress.com/2014/01/25/
        //   manual-texture-filtering-for-pixelated-games-in-webgl/
        // ik = 1/k, 设为 1/0.7 ≈ 1.43 以获得良好视觉效果
        float ik = 1.43;
        vec2 interp = clamp(offset * ik * pixelsPerTexel, 0.0, 0.5)
                    + clamp((offset - 1.0) * ik * pixelsPerTexel + 0.5,
                            0.0, 0.5);
        coords = (floor(coords.st * textureSize) + interp) / textureSize;

        if (isPaletted)
            c = SamplePalettedBilinear(vChannelSampler, coords, textureSize);
    }

    if (!(EnablePixelArtScaling && isPaletted))
    {
        vec4 x = Sample(vChannelSampler, coords);
        if (isPaletted)
        {
            // 量化调色板索引以避免浮点精度导致颜色错位：
            // 纹理值在 [0,1] 范围，乘以 255.0 并舍入恢复整数索引，
            // 再除以 255.0 得到精确的调色板纹理 UV 坐标。
            // Palette 纹理使用 NEAREST 采样（256 列 x N 行），
            // 每个列对应一个调色板条目，量化确保查找正确列。
            float index = dot(x, vChannelMask);
            float quantized = floor(index * 255.0 + 0.5) / 255.0;
            c = texture(Palette, vec2(quantized, vTexPalette));
        }
        else if (isColor)
            c = vTexCoord;
        else
            c = x;
    }

    // 丢弃透明片段（颜色和深度均为透明）
    if (c.a == 0.0)
        discard;

    if (!isPaletted && vTexPalette > 0.0)
        c = ColorShift(c, vTexPalette);

    // 深度计算：使用次纹理通道的深度采样
    float depth = gl_FragCoord.z;
    if (length(vDepthMask) > 0.0)
    {
        vec4 y = Sample(vDepthSampler, vTexCoord.pq);
        depth = depth + DepthTextureScale * dot(y, vDepthMask);
    }

    gl_FragDepth = depth;

    // 输出
    if (EnableDepthPreview)
    {
        float intensity = 1.0 - clamp(
            DepthPreviewParams.x * depth
                - 0.5 * DepthPreviewParams.x - DepthPreviewParams.y + 0.5,
            0.0, 1.0
        );
        fragColor = vec4(vec3(intensity), 1.0);
    }
    else
    {
        // 色调应用：vTint.a < 0 表示替换模式（而非相乘）
        if (vTint.a < 0.0)
            c = vec4(vTint.rgb, -vTint.a);
        else
            c *= vTint;

        fragColor = c;
    }
}
