#version 300 es
precision highp float;

// ---------------------------------------------------------------------------
// combined.vert — OpenRA 精灵顶点着色器的 WebGL 2.0 (GLSL ES 3.0) 迁移
// OpenRA 对照: glsl/combined.vert
//
// 核心范式转换:
// - uniform Scroll/p1/p2 手动投影 → Babylon.js 自动注入 worldViewProjection
// - attribute → in (GLSL ES 3.0)
// - varying → out (GLSL ES 3.0)
// - 保留 aVertexAttributes 位字段解码逻辑（通道类型、采样器索引、调色板行）
//
// 注意:
// - Babylon.js ShaderMaterial 自动注入 worldViewProjection 等矩阵 uniform
// - 自定义 uniform 通过 ShaderMaterial.setFloat/setVector3 设置
// ---------------------------------------------------------------------------

// Babylon.js 自动注入的矩阵
uniform mat4 worldViewProjection;
uniform mat4 world;

// 自定义 uniform（通过 ShaderMaterial API 设置）
uniform float PaletteRows;

// 顶点属性（对应 CombinedShaderBindings 布局）
// layout: aVertexPosition(float3) | aVertexTexCoord(float4) |
//          aVertexAttributes(uint) | aVertexTint(float4)
in vec3 aVertexPosition;
in vec4 aVertexTexCoord;
in uint aVertexAttributes;
in vec4 aVertexTint;

// 传递到片段着色器
out vec4 vTexCoord;
flat out float vTexPalette;
flat out vec4 vChannelMask;
flat out uint vChannelSampler;
flat out uint vChannelType;
flat out vec4 vDepthMask;
flat out uint vDepthSampler;
out vec4 vTint;

// ---------------------------------------------------------------------------
// SelectChannelMask — 将通道类型位编码译码为通道选择掩码
//
// 对应 OpenRA combined.vert 中的 SelectChannelMask 函数。
// 位编码规则：
//   7 (111): Alpha 通道
//   5 (101): Blue 通道
//   3 (011): Green 通道
//   2 (010): RGBA（全通道）
//   1 (001): Red 通道
//   0 (000): 未使用
// ---------------------------------------------------------------------------

vec4 SelectChannelMask(uint x)
{
    switch (x)
    {
        case 7u:
            return vec4(0.0, 0.0, 0.0, 1.0);
        case 5u:
            return vec4(0.0, 0.0, 1.0, 0.0);
        case 3u:
            return vec4(0.0, 1.0, 0.0, 0.0);
        case 2u:
            return vec4(1.0, 1.0, 1.0, 1.0);
        case 1u:
            return vec4(1.0, 0.0, 0.0, 0.0);
        default:
            return vec4(0.0, 0.0, 0.0, 0.0);
    }
}

// ---------------------------------------------------------------------------
// main() — 顶点着色器入口
//
// 与 OpenRA 的区别：
// - 使用 worldViewProjection 矩阵替换手动 Scroll/p1/p2 投影计算
//   OpenRA: gl_Position = vec4((aVertexPosition - Scroll) * p1 + p2, 1);
//   Web:    gl_Position = worldViewProjection * vec4(aVertexPosition, 1.0);
// - 位字段解码逻辑完全保留
// ---------------------------------------------------------------------------

void main()
{
    // 投影：使用 Babylon.js 自动注入的 worldViewProjection 矩阵
    gl_Position = worldViewProjection * vec4(aVertexPosition, 1.0);

    // 传递纹理坐标
    vTexCoord = aVertexTexCoord;

    // 解码 aVertexAttributes 位字段（与 OpenRA 完全一致的位布局）
    // Bits 0-2:   主纹理通道类型
    // Bits 3-5:   次纹理通道类型（深度）
    // Bits 6-8:   主纹理采样器索引 (0-7)
    // Bits 9-11:  次纹理采样器索引 (0-7)
    // Bits 16-31: 调色板纹理行索引
    vChannelType = aVertexAttributes & 0x07u;
    vChannelMask = SelectChannelMask(vChannelType);
    vDepthMask = SelectChannelMask((aVertexAttributes >> 3) & 0x07u);
    vChannelSampler = (aVertexAttributes >> 6) & 0x07u;
    vDepthSampler = (aVertexAttributes >> 9) & 0x07u;
    vTexPalette = float(aVertexAttributes >> 16) / PaletteRows;

    // 传递色调/透明度
    vTint = aVertexTint;
}
