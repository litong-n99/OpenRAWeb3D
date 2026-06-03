# OpenRA → Babylon.js 迁移计划：第二章 渲染引擎模块

> **重要声明**：`OpenRA/` 目录为原始 C# 源码参考库，**仅用于对照排查，不可修改**。所有迁移实现均应在 `src/` 下对应路径的 TypeScript 文件中完成。

---

## 目录

1. [总体策略与架构原则](#1-总体策略与架构原则)
2. [文件映射总表](#2-文件映射总表)
3. [核心迁移任务（TODO）](#3-核心迁移任务todo)
   - 3.1 [Renderer.cs — 主渲染器](#31-renderercs--主渲染器)
   - 3.2 [WorldRenderer.cs — 世界渲染器](#32-worldrenderercs--世界渲染器)
   - 3.3 [SpriteRenderer.cs — 精灵渲染器](#33-spriterenderercs--精灵渲染器)
   - 3.4 [RgbaColorRenderer.cs — RGBA 颜色渲染器](#34-rgbacolorrenderercs--rgba-颜色渲染器)
   - 3.5 [Shader / 材质系统](#35-shader--材质系统)
   - 3.6 [帧缓冲与后处理](#36-帧缓冲与后处理)
   - 3.7 [精灵与纹理系统](#37-精灵与纹理系统)
   - 3.8 [平台抽象层](#38-平台抽象层)
4. [GLSL 着色器迁移](#4-glsl-着色器迁移)
5. [验证与测试策略](#5-验证与测试策略)
6. [风险与注意事项](#6-风险与注意事项)

---

## 1. 总体策略与架构原则

渲染引擎迁移的核心范式转换：**从"命令式 OpenGL 编程"到"声明式 3D 场景图"**。

- **OpenRA 侧**：手动管理顶点缓冲、批次边界、FBO 绑定切换、uniform 位置缓存。
- **Babylon.js 侧**：创建 Mesh、设置材质属性、配置相机参数，引擎自动推导最优渲染顺序与资源绑定。

项目目录结构严格与 OpenRA 保持一致，`src/` 下的文件路径与 `OpenRA/` 一一对应，方便逐文件对照排查。

---

## 2. 文件映射总表

| # | OpenRA 源文件路径 | 迁移目标文件路径 | 类/接口名 | 复杂度 | 关键映射目标 |
|:---:|:---|:---|:---|:---:|:---|
| 1 | `OpenRA.Game/Renderer.cs` | `src/OpenRA.Game/Renderer.ts` | `Renderer` | 中 | `BABYLON.Engine` + `HTMLCanvasElement` |
| 2 | `OpenRA.Game/Graphics/WorldRenderer.cs` | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | `WorldRenderer` | 高 | `BABYLON.Scene` + 自定义 `renderLoop` |
| 3 | `OpenRA.Game/Graphics/SpriteRenderer.cs` | `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | `SpriteRenderer` | 高 | `BABYLON.ThinInstances` / `SpriteManager` |
| 4 | `OpenRA.Game/Graphics/RgbaColorRenderer.cs` | `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | `RgbaColorRenderer` | 低 | `BABYLON.GUI` / `CreateLines` |
| 5 | `OpenRA.Game/Graphics/RgbaSpriteRenderer.cs` | `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.ts` | `RgbaSpriteRenderer` | 低 | `SpriteManager` + `StandardMaterial` |
| 6 | `OpenRA.Game/Graphics/Vertex.cs` | `src/OpenRA.Game/Graphics/Vertex.ts` | `Vertex` (struct) | 中 | `BABYLON.VertexData` + 多属性数组 |
| 7 | `OpenRA.Game/Graphics/PlatformInterfaces.cs` | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | `IShader` | 高 | `BABYLON.ShaderMaterial` / `Effect` |
| 8 | `OpenRA.Game/Graphics/Util.cs` | `src/OpenRA.Game/Graphics/Util.ts` | `Util` (static) | 低 | Babylon 内置 + 自定义工具 |
| 9 | `OpenRA.Game/Graphics/PlatformInterfaces.cs` | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | `IGraphicsContext` | 中 | `BABYLON.Engine`（内部管理） |
| 10 | `OpenRA.Game/Graphics/RenderPostProcessPassVertex.cs` | `src/OpenRA.Game/Graphics/RenderPostProcessPassVertex.ts` | `RenderPostProcessPassVertex` | 低 | `BABYLON.PostProcess`（自动全屏四边形） |
| 11 | `OpenRA.Game/Graphics/Sprite.cs` | `src/OpenRA.Game/Graphics/Sprite.ts` | `Sprite` | 中 | `BABYLON.Sprite` / `Mesh` + 自定义 UV |
| 12 | `OpenRA.Game/Graphics/Sheet.cs` | `src/OpenRA.Game/Graphics/Sheet.ts` | `Sheet` | 低 | `BABYLON.Texture` / `RawTexture` |
| 13 | `OpenRA.Game/Graphics/SheetBuilder.cs` | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | `SheetBuilder` | 低 | 构建时预打包（`maxrects-packer`） |
| 14 | `OpenRA.Game/Graphics/HardwarePalette.cs` | `src/OpenRA.Game/Graphics/HardwarePalette.ts` | `HardwarePalette` | 高 | `RawTexture` + 自定义调色板查找 Shader |
| 15 | `OpenRA.Game/Graphics/PlayerColorRemap.cs` | `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` | `PlayerColorRemap` | 中 | CPU 预计算 / GPU Uniform + HSV 转换 |
| 16 | `OpenRA.Game/Graphics/Animation.cs` | `src/OpenRA.Game/Graphics/Animation.ts` | `Animation` | 中 | 自定义 `SpriteAnimation` + UV 更新 |
| 17 | `OpenRA.Game/Graphics/CursorManager.cs` | `src/OpenRA.Game/Graphics/CursorManager.ts` | `CursorManager` | 低 | CSS `cursor: url(...)` / HTML 覆盖层 |
| 18 | `OpenRA.Game/Graphics/TerrainSpriteLayer.cs` | `src/OpenRA.Game/Graphics/TerrainSpriteLayer.ts` | `TerrainSpriteLayer` | 高 | `Mesh` + `ShaderMaterial` + Atlas UV 更新 |
| 19 | `OpenRA.Platforms.Default/Shader.cs` | `src/OpenRA.Platforms.Default/Shader.ts` | `Shader` | 高 | `BABYLON.ShaderMaterial` |
| 20 | `OpenRA.Platforms.Default/Texture.cs` | `src/OpenRA.Platforms.Default/Texture.ts` | `Texture` | 中 | `BABYLON.Texture` / `RawTexture` |
| 21 | `OpenRA.Platforms.Default/FrameBuffer.cs` | `src/OpenRA.Platforms.Default/FrameBuffer.ts` | `FrameBuffer` | 中 | `BABYLON.RenderTargetTexture` |
| 22 | `OpenRA.Platforms.Default/Sdl2GraphicsContext.cs` | `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | `Sdl2GraphicsContext` | 中 | `BABYLON.Engine` |
| 23 | `glsl/combined.vert` | `src/glsl/combined.vert` | — | 高 | 自定义 `ShaderMaterial` 顶点着色器 |
| 24 | `glsl/combined.frag` | `src/glsl/combined.frag` | — | 高 | 自定义 `ShaderMaterial` 片段着色器 |
| 25 | `glsl/postprocess.vert` | `src/glsl/postprocess.vert` | — | 低 | `PostProcess` 自动处理 |
| 26 | `glsl/postprocess_*.frag` | `src/glsl/postprocess_*.frag` | — | 中 | `CustomPostProcess` / `DefaultRenderingPipeline` |
| 27 | `OpenRA.Game/Graphics/ShaderBindings.cs` | `src/OpenRA.Game/Graphics/ShaderBindings.ts` | `ShaderBindings` | 中 | `BABYLON.ShaderMaterial` uniform 绑定 |

---

## 3. 核心迁移任务（TODO）

### 3.1 Renderer.cs — 主渲染器 ✅ 已完成

**OpenRA 对照**: `OpenRA.Game/Renderer.cs`  
**迁移目标**: `src/OpenRA.Game/Renderer.ts`  
**状态**: 已完成 (938行实现 + 782行测试, 89 个测试用例)  
**审核**: 已通过代码审核，修复了像素艺术缩放、平台退化 API 文档等问题

- [x] **TODO-2.1.1** 移除所有直接 OpenGL 调用（`GL.BindFramebuffer`、`GL.Clear`、`GL.Scissor`）。
- [x] **TODO-2.1.2** 用 `BABYLON.Engine` + `HTMLCanvasElement` 替代 SDL2 窗口管理与 OpenGL 上下文。
- [x] **TODO-2.1.3** 用 `Engine.runRenderLoop()` 替代 `BeginFrame()` / `EndFrame()` 手动帧循环。
- [x] **TODO-2.1.4** 迁移双 FBO 架构：实现方案 B（`RenderTargetTexture` 离屏渲染 + 双 Scene）。
- [x] **TODO-2.1.5** 移除 `depthMargin` 概念，利用 Babylon.js 3D 空间天然 Z 轴深度。
- [x] **TODO-2.1.6** 实现正交/透视相机切换，默认正交保持 RTS 传统感。

**复杂度**: 中  
**阻塞任务**: 无（渲染层最基础，优先完成）

---

### 3.2 WorldRenderer.cs — 世界渲染器 ✅ 已完成

**OpenRA 对照**: `OpenRA.Game/Graphics/WorldRenderer.cs`  
**迁移目标**: `src/OpenRA.Game/Graphics/WorldRenderer.ts`  
**状态**: 已完成 (~900行实现 + ~850行测试, 74 个测试用例)  
**审核**: 已通过代码审核，修复了 draw() 渲染编排、构造函数 trait 初始化、generate 方法补全等问题

- [x] **TODO-2.2.1** 用 `BABYLON.Scene.render()` 替代 `Draw()` 的六阶段手动渲染流程（draw() 现已包含 10 阶段渲染编排）。
- [x] **TODO-2.2.2** 用 `renderingGroupId` 分层替代手动渲染阶段：地形(0)、普通对象(1)、覆盖层(2)、注释(3)。
- [x] **TODO-2.2.3** 用 `scene.transparentSortCompareFn` 实现自定义 Y-sort（`Pos.Y + Pos.Z + ZOffset`）+ 稳定排序。
- [x] **TODO-2.2.4** 用 `RawTexture` 替代 `HardwarePalette` 的 GPU 调色板纹理管理（接口定义完成，实现待 HardwarePalette 模块）。
- [x] **TODO-2.2.5** 用内置 Frustum Culling 替代 `GenerateRenderables()` 的 CPU 端视口遍历筛选（6 个渲染来源全部实现）。
- [x] **TODO-2.2.6** 集成 `DefaultRenderingPipeline` 实现后处理通道（泛光、色调映射等）。
- [x] **TODO-2.2.7** 优化调色板更新：仅在调色板实际变化时调用 `RawTexture.update()`，避免每帧上传。

**复杂度**: 高  
**阻塞任务**: 无（依赖 Renderer 已就绪；Trait 系统/IWorld/Viewport 完全实现后部分特性自动启用）

---

### 3.3 SpriteRenderer.cs — 精灵渲染器 ✅ 已完成

**OpenRA 对照**: `OpenRA.Game/Graphics/SpriteRenderer.cs`  
**迁移目标**: `src/OpenRA.Game/Graphics/SpriteRenderer.ts`  
**状态**: 已完成 (~430行实现 + ~430行测试, 55 个测试用例)

- [x] **TODO-2.3.1** 批量渲染方案：选择 ThinInstances + Billboard Mesh 组合（`ThinInstancesBackend`）。
- [x] **TODO-2.3.2** ThinInstances 批量渲染：通过 `thinInstanceSetBuffer("matrix")` 批量更新变换矩阵。
- [x] **TODO-2.3.3** 调色板索引机制：`IPaletteTexture` 接口预留，`ShaderMaterial` 替换待 Shader 模块迁移后实现。
- [x] **TODO-2.3.4** Billboard 模式：`BILLBOARDMODE_Y` 保持 RTS 精灵直立视觉效果。
- [x] **TODO-2.3.5** 多 Sheet 管理：通过分组 ThinInstances 实现 Sheet 间切换，超过容量时自动 Flush。
- [x] **TODO-2.3.6** BlendMode 管理：`blendModeToAlphaMode()` 映射 10 种混合模式到 Babylon.js `material.alphaMode`。

**复杂度**: 高  
**阻塞任务**: TODO-2.5.x (Shader — 调色板着色器中的多纹理查找需 ShaderMaterial)

---

### 3.4 RgbaColorRenderer.cs — RGBA 颜色渲染器 ✅ 已完成

**OpenRA 对照**: `OpenRA.Game/Graphics/RgbaColorRenderer.cs`  
**迁移目标**: `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts`  
**状态**: 已完成 (1012行实现 + 858行测试, 68 个测试用例)  
**审核**: 已通过代码审核（3 轮审核，修复了 2 个 BLOCKER + 3 个 MAJOR + 3 个 MINOR 问题）

- [x] **TODO-2.4.1** UI 元素映射：`Rectangle`/`Line`/`Ellipse` GUI 控件对应 `FillRect`/`DrawLine`/`FillEllipse`。
- [x] **TODO-2.4.2** 调试图形映射：`BABYLON.CreateLines` / `LinesMesh` 对应路径点、碰撞框绘制。
- [x] **TODO-2.4.3** 配置预乘 Alpha：`material.alphaMode = BABYLON.Engine.ALPHA_PREMULTIPLIED`。
- [x] **TODO-2.4.4** 处理 Z-fighting：调试图形设置 `disableDepthWrite = true` 和最高 `renderingGroupId`。
- [x] **TODO-2.4.5** 高频更新优化：实时血条等使用 Babylon GUI 而非每帧重建 `LinesMesh`。

**复杂度**: 低  
**阻塞任务**: TODO-2.1.x (Renderer) ✅ 已满足

---

### 3.5 Shader / 材质系统 ✅ 已完成

**OpenRA 对照**: `OpenRA.Game/Graphics/PlatformInterfaces.cs` (`IShader`), `OpenRA.Game/Graphics/ShaderBindings.cs`, `OpenRA.Game/Graphics/Vertex.cs`, `OpenRA.Platforms.Default/Shader.cs`  
**迁移目标**: `src/OpenRA.Game/Graphics/PlatformInterfaces.ts`, `src/OpenRA.Game/Graphics/ShaderBindings.ts`, `src/OpenRA.Game/Graphics/Vertex.ts`, `src/OpenRA.Platforms.Default/Shader.ts`  
**状态**: 已完成 (1791行实现 + 1308行测试, 6 个源文件 + 4 个测试文件, 142 个新增测试用例)  
**审核**: 已通过代码审核（2 轮审核，修复了 2 个 MAJOR + 5 个 MINOR 问题）

- [x] **TODO-2.5.1** 用 `ShaderMaterial` + `Effect.ShadersStore` 替代 `IShader` 接口与手动 GL 程序管理。
- [x] **TODO-2.5.2** 迁移 `combined.vert` / `combined.frag` 核心逻辑：保留调色板查找算法，适配 Babylon.js uniform 命名。
- [x] **TODO-2.5.3** 处理 GLSL 版本差异：OpenGL 3.2 (GLSL 1.50) → WebGL 2.0 (GLSL ES 3.0)。
- [x] **TODO-2.5.4** 拆分 `Vertex` 48 字节结构：`positions` + `uvs` + `uvs2` + `colors` 独立属性流。
- [x] **TODO-2.5.5** 实现调色板查找精度保障：`floor(tex.r * 255.0 + 0.5)` 精确还原整数索引。
- [x] **TODO-2.5.6** 确保调色板纹理使用 `NEAREST` 采样模式，禁用 Mipmap。
- [x] **TODO-2.5.7** 映射 `IShader.SetVec()` → `shaderMaterial.setVector3()`，`SetTexture()` → `setTexture()`。

**复杂度**: 高  
**阻塞任务**: 无（但阻塞 TODO-2.3.x, TODO-2.7.x）

---

### 3.6 帧缓冲与后处理

**OpenRA 对照**: `OpenRA.Game/Renderer.cs` (FBO 部分), `OpenRA.Platforms.Default/FrameBuffer.cs`  
**迁移目标**: `src/OpenRA.Game/Renderer.ts`, `src/OpenRA.Platforms.Default/FrameBuffer.ts`

- [ ] **TODO-2.6.1** 用 `RenderTargetTexture` 替代 `WorldBuffer` / `ScreenBuffer` 双 FBO 系统。
- [ ] **TODO-2.6.2** 配置 `worldScene.customRenderTargets` 挂载世界离屏渲染目标。
- [ ] **TODO-2.6.3** 用 `DefaultRenderingPipeline` 实现内置后处理（泛光、FXAA、色调映射）。
- [ ] **TODO-2.6.4** 用自定义 `PostProcess` 类实现 OpenRA 特有效果（Sharp Bilinear 缩放）。
- [ ] **TODO-2.6.5** 优化 RTT 内存：WebGL 2.0 支持 NPOT，按实际视口尺寸分配，避免 Power-of-2 向上取整浪费。
- [ ] **TODO-2.6.6** 移动端优化：使用 `DefaultRenderingPipeline` 合并渲染模式减少中间缓冲。

**复杂度**: 中  
**阻塞任务**: TODO-2.1.x (Renderer)

---

### 3.7 精灵与纹理系统

**OpenRA 对照**: `OpenRA.Game/Graphics/Sprite.cs`, `Sheet.cs`, `SheetBuilder.cs`, `HardwarePalette.cs`, `PlayerColorRemap.cs`, `Animation.cs`, `CursorManager.cs`, `TerrainSpriteLayer.cs`  
**迁移目标**: `src/OpenRA.Game/Graphics/` 下对应 `.ts` 文件

- [ ] **TODO-2.7.1** `Sprite.ts`: 映射为 `MeshBuilder.CreatePlane()` + 特定 UV 子区域 + `ShaderMaterial`。
- [ ] **TODO-2.7.2** `Sheet.ts`: `Indexed` → `RawTexture`(LUMINANCE)；`BGRA` → `Texture`(RGBA，注意 R/B 交换)。
- [ ] **TODO-2.7.3** `SheetBuilder.ts`: 运行时打包替换为构建时预打包（`maxrects-packer` / TexturePacker）。
- [ ] **TODO-2.7.4** `HardwarePalette.ts`: 256×N `RawTexture` + `ColorShifts` 浮点纹理 + 自定义 Shader 查找。
- [ ] **TODO-2.7.5** `PlayerColorRemap.ts`: 实现 GPU 端实时 HSV 重映射（方案 B：256×1 查找纹理 + Uniform）。
- [ ] **TODO-2.7.6** `Animation.ts`: `Sprite.playAnimation()` 或 `mesh.updateVerticesData()` 实现帧切换；固定 25fps 逻辑 Tick。
- [ ] **TODO-2.7.7** `CursorManager.ts`: CSS `cursor: url(...)` 或独立 HTML 元素覆盖层。
- [ ] **TODO-2.7.8** `TerrainSpriteLayer.ts`: 大平面网格（宽×高 Quad）+ `updateVerticesData()` 脏行更新。

**复杂度**: 高（调色板系统、地形层）/ 低（光标、Sheet）  
**阻塞任务**: TODO-2.5.x (Shader)

---

### 3.8 平台抽象层

**OpenRA 对照**: `OpenRA.Game/Graphics/PlatformInterfaces.cs`, `OpenRA.Platforms.Default/*`  
**迁移目标**: `src/OpenRA.Game/Graphics/PlatformInterfaces.ts`, `src/OpenRA.Platforms.Default/*.ts`

- [ ] **TODO-2.8.1** `IGraphicsContext` → `BABYLON.Engine`：资源创建从显式接口调用变为隐式构造函数调用。
- [ ] **TODO-2.8.2** `OpenRA.Platforms.Default/Shader.ts` → `ShaderMaterial` 构造函数。
- [ ] **TODO-2.8.3** `OpenRA.Platforms.Default/Texture.ts` → `Texture` / `RawTexture` 构造函数。
- [ ] **TODO-2.8.4** `OpenRA.Platforms.Default/FrameBuffer.ts` → `RenderTargetTexture` 构造函数。
- [ ] **TODO-2.8.5** `OpenRA.Platforms.Default/VertexBuffer.ts` / `StaticIndexBuffer.ts` → `VertexBuffer` / `IndexBuffer`。
- [ ] **TODO-2.8.6** 移除 `Sdl2GraphicsContext.ts`、`Sdl2PlatformWindow.ts` 等 SDL2 特定平台代码，替换为浏览器原生 API。

**复杂度**: 中  
**阻塞任务**: TODO-2.1.x (Renderer)

---

## 4. GLSL 着色器迁移

**OpenRA 对照**: `glsl/combined.vert`, `glsl/combined.frag`, `glsl/model.vert`, `glsl/model.frag`, `glsl/postprocess.vert`, `glsl/postprocess_chronoshift.frag`, `glsl/postprocess_flash.frag`, `glsl/postprocess_menufade.frag`, `glsl/postprocess_textured.vert`, `glsl/postprocess_textured_sonic.frag`, `glsl/postprocess_textured_vortex.frag`, `glsl/postprocess_tint.frag`  
**迁移目标**: `src/glsl/` 下同名文件

> 注意：着色器源码先保留在 `src/glsl/` 中，通过 `Effect.ShadersStore` 注册到 Babylon.js。

- [x] **TODO-2.S1** `combined.vert`：保留精灵顶点变换逻辑，将 `p1/p2` 投影参数替换为 Babylon.js 自动注入的 `worldViewProjection`。
- [x] **TODO-2.S2** `combined.frag`：保留调色板纹理查找、ColorShift HSV 偏移、Alpha 测试核心逻辑。
- [ ] **TODO-2.S3** `postprocess.vert` / `postprocess_*.frag`：后处理效果迁移为 `PostProcess` 类或 `DefaultRenderingPipeline` 配置。
- [ ] **TODO-2.S4** `model.vert` / `model.frag`：模型着色器可直接使用 Babylon.js `StandardMaterial` / `PBRMaterial`，无需自定义。
- [x] **TODO-2.S5** GLSL 版本适配：确保 `attribute`/`varying`/`texture2D` 等语法与 WebGL 2.0 `in`/`out`/`texture()` 兼容。

**复杂度**: 高（combined 着色器对）/ 低（model、postprocess 顶点）

---

## 5. 验证与测试策略

- [x] **TEST-2.1** 创建 `src/OpenRA.Game/Renderer.test.ts`：验证 `Engine` 初始化与 `runRenderLoop()`（89 个测试用例）。
- [x] **TEST-2.2** 创建 `src/OpenRA.Game/Graphics/WorldRenderer.test.ts`：验证场景图渲染顺序与 `renderingGroupId` 分层（98 个测试用例）。
- [x] **TEST-2.3** 创建 `src/OpenRA.Game/Graphics/SpriteRenderer.test.ts`：验证 `ThinInstances` 批量矩阵更新与 Billboard 模式（55 个测试用例）。
- [x] **TEST-2.4** 创建 `src/OpenRA.Game/Graphics/__tests__/Shader.test.ts` 等 4 个测试文件：验证 `ShaderMaterial` 编译成功与 uniform 设置（142 个新增测试用例，测试文件总计 411 个测试用例）。
- [ ] **TEST-2.5** 创建 `src/OpenRA.Game/Graphics/__tests__/HardwarePalette.test.ts`：验证调色板纹理查找颜色正确性。
- [ ] **TEST-2.6** 性能基准：测量 100/500/1000/2000 单位在目标设备上的帧率，确定承载上限。

---

## 6. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|:---|:---|:---|
| **WebGL 性能折损 30-50%** | 高 | `ThinInstances` 批量渲染、LOD 系统、视锥剔除 |
| **GLSL 版本兼容性** | 高 | Babylon.js `Effect` 系统自动适配；手动验证 iOS Safari |
| **调色板索引浮点精度** | 高 | 片段着色器使用 `floor(index * 255.0 + 0.5)` 精确还原；`NEAREST` 采样 |
| **JS 浮点跨平台一致性** | 高 | 三角函数用查找表替代；定点数运算；确定性 PRNG |
| **Z-sort vs GPU 深度测试冲突** | 中 | 不透明物体用深度测试；透明单位用 `renderingGroupId` + `transparentSortCompareFn` |
| **RTT 内存占用** | 中 | WebGL 2.0 使用 NPOT 纹理；合并渲染模式减少中间缓冲 |
| **预乘 Alpha 不匹配** | 低 | 全局配置 `ALPHA_PREMULTIPLIED`；着色器输出 `rgb *= a` |

---

> **再次声明**：`OpenRA/` 目录为原始参考源码，**不可修改**。所有迁移工作均在 `src/` 对应路径完成。若发现 OpenRA 源码理解歧义，应在迁移文档中记录备注，而非修改原始文件。
