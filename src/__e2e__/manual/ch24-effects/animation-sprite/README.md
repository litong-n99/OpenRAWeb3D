# AnimationStub - ShaderMaterial 材质集成 + Sprite Sheet 渲染

> **人工验收测试页**
> 模块: AnimationStub (Ch24 Phase A Material Integration)
> 测试ID: `ch24-effects/animation-sprite`
> OpenRA 对照: `Animation.cs` (OpenRA.Graphics.Animation) — ShaderMaterial + Sheet-backed rendering
> 创建日期: 2026-06-20

---

## 测试目标

验证 AnimationStub 在 Ch24 Phase A 完成 Material Integration 后的三个核心渲染路径：

1. **ShaderMaterial + Sheet 纹理**: 提供 Sheet + frameUVs 时，使用自定义 GLSL shader 采样纹理
2. **Magenta Fallback**: 无 Sheet 时，创建品红色 StandardMaterial 作为调试指示
3. **预乘 Alpha 混合**: ShaderMaterial 使用 `ALPHA_PREMULTIPLIED` 模式，半透明区域正确混合

---

## B. 期望结果（可量化验收标准）

### 期望 1: ShaderMaterial — 帧颜色正确渲染

**操作**: 观察左侧（With Sheet）动画平面，等待其循环切换帧。

**观察点**:
- 左侧平面 (With Sheet, WPos=-1024) 在 4 种颜色之间循环切换
- Frame 0 应显示 **纯红色 (#FF0000)**，无杂色混合
- Frame 1 应显示 **纯绿色 (#00FF00)**，透过棋盘格背景可见（半透明）
- Frame 2 应显示 **纯蓝色 (#0000FF)**，无杂色混合
- Frame 3 应显示 **纯黄色 (#FFFF00)**，无杂色混合
- 帧切换时无闪烁（不会出现全黑/全白帧）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Frame 0 颜色 | 红 (R>200, G<50, B<50) | 肉眼判定纯红 |
| Frame 2 颜色 | 蓝 (B>200, R<50, G<50) | 肉眼判定纯蓝 |
| Frame 3 颜色 | 黄 (R>200, G>200, B<50) | 肉眼判定纯黄 |
| 帧切换连续性 | 无黑色/白色闪烁帧 | 4 帧循环 x10 圈 = 0 次闪烁 |
| 帧切换延迟 | 默认 40ms (1 tick × 40ms base) | 速度 1.0x 时约 2.5 帧/s |

> **NOTE**: 已知潜在问题 — AnimationStub 的 `_updateUVs()` 同时更新了 mesh 顶点 UV 和 `uFrameUV` shader uniform，可能导致双重映射。如果帧颜色出现偏移/混合，说明该 bug 需要修复。正确行为应为：顶点 UV 保持 (0,0)-(1,1) 不变，仅更新 `uFrameUV` uniform。

### 期望 2: Magenta Fallback — 无 Sheet 时品红色渲染

**操作**: 观察右侧（No Sheet）动画平面。

**观察点**:
- 右侧平面 (No Sheet, WPos=1024) 显示为**品红色 (#FF00FF)**
- 平面应为自发光品红色（emissiveColor=(1,0,1)），不受场景光照影响
- 平面应始终可见（双面渲染，backFaceCulling=false）
- 动画 tick 不应导致错误（StandardMaterial 无 setVector4 方法，duck-type 检查应安全跳过）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 颜色 | 品红 (R>200, B>200, G<50) | 肉眼判定品红 |
| 自发光 | 不受光照角度影响色彩 | 旋转摄像机后颜色不变 |
| 双面可见 | 从背面看也能看到品红色 | 旋转摄像机到背面验证 |
| 无控制台错误 | `typeof mat.setVector4 !== 'function'` 静默跳过 | DevTools Console 无 NaN/undefined 错误 |

### 期望 3: Alpha 混合 — 半透明帧透过背景

**操作**: 等待动画切换到 Frame 1（绿色半透明帧），观察背景。

**观察点**:
- Frame 1 显示时，背景棋盘格平面应**透过绿色可见**
- 绿色区域呈现半透明效果（Alpha=128/255 ≈ 50%）
- 不透明帧（Frame 0/2/3）完全遮挡背景

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Frame 1 透明度 | 绿色平面后可见背景灰色 (#404040) | 肉眼判定半透明 |
| Frame 0/2/3 不透明度 | 完全遮挡背景 | 无背景透出 |
| Alpha 模式 | `ALPHA_PREMULTIPLIED` (mode=2) | 控件面板显示 mode=2 |

### 期望 4: renderingGroupId 正确设置

**操作**: 观察控件面板中 renderingGroupId 显示。

**观察点**:
- 控件面板显示 `renderingGroupId: 1`（对应 RenderGroup.Actor）
- 平面在场景中可见（renderingGroupId=1 在 Babylon.js 默认渲染组范围内）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| renderingGroupId | 1 | 控件面板确认为 1 |
| 网格可见性 | 平面正常渲染，非 invisible | 肉眼可见 |

### 期望 5: 纹理预览 — 完整 Sprite Sheet 显示

**操作**: 点击「切换纹理预览」按钮。

**观察点**:
- 场景中出现一个 3x3 单位的平面，显示完整的 4 帧 sprite sheet 纹理
- 纹理包含 4 个象限：左上红、右上绿（半透明）、左下蓝、右下黄
- 绿色区域应为半透明（透过可见背景）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 纹理尺寸 | 256x256, 2x2 象限布局正确 | 4 种颜色各占 1/4 面积 |
| 颜色分布 | R 左上 / G 右上 / B 左下 / Y 右下 | 位置对应正确 |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch24-effects/animation-sprite/`
2. 确认环境信息栏显示 WebGL 2.0 引擎（或更高版本）
3. 设置屏幕分辨率为 1920x1080（1x 缩放）

### 步骤一：验证 ShaderMaterial 帧渲染

- 观察左侧平面（标注为 With Sheet）
- 默认速度 1.0x，帧约 2.5 帧/s 切换
- 使用速度滑块调到 0.25x（慢速，便于观察每帧颜色）
- 使用「单步进帧」按钮逐帧切换
- 预期：✅ 每帧颜色与图例一致（红→绿→蓝→黄）
- **异常记录**: 若颜色偏差/混合，记录当前帧号和观察到的主色调

### 步骤二：验证 Magenta Fallback

- 观察右侧平面（标注为 No Sheet）
- 旋转摄像机（鼠标拖拽）到不同角度
- 预期：✅ 品红色始终可见，不受光照角度影响
- 打开 DevTools Console，确认无错误输出

### 步骤三：验证 Alpha 混合

- 单步进帧到 Frame 1（绿色半透明帧）
- 观察绿色平面后方是否能透见灰色背景
- 预期：✅ 背景灰色透过可见，呈现深绿灰色混合
- 切换到 Frame 0/2/3，确认这些帧完全不透明

### 步骤四：验证 renderingGroupId

- 观察控件面板 `renderingGroupId` 值
- 预期：✅ 显示为 1

### 步骤五：验证纹理预览

- 点击「切换纹理预览」按钮
- 观察场景中出现的 3x3 纹理预览平面
- 预期：✅ 显示 2x2 象限：左上红、右上绿（半透明）、左下蓝、右下黄
- 再次点击按钮关闭预览
- 预期：✅ 预览平面消失

### 边界测试

- **极速测试**: 速度滑块调到 5.0x → 帧切换应流畅无掉帧
- **极慢测试**: 速度滑块调到 0.1x → 帧切换清晰可辨，无跳帧
- **F5 刷新**: 刷新页面后动画从 Frame 0 重新开始
- **摄像机旋转**: 拖拽旋转到背面观察 → 平面应从背面也可见（双面渲染）

### 结果判定

- [ ] 所有 5 项期望通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异和截图，提交 issue
- [ ] 测试环境异常 → 记录 UA / 视口 / 引擎 / FPS 信息

---

## 技术备注

### 双映射 (vertex UV + shader uniform) 潜在问题

AnimationStub 的 `_updateUVs()` 方法同时执行：
1. 更新 mesh 顶点 UV 数据为帧 UV 坐标
2. 设置 `uFrameUV` shader uniform 为相同的帧 UV 坐标

而 fragment shader 通过 `mix(uFrameUV.x, uFrameUV.z, vUV.x)` 对顶点 UV 再次重映射。这导致**双重映射**：顶点 UV 已被设为帧区域坐标，shader 再将其作为 (0..1) 插值因子混合，最终采样坐标偏移。

**正确行为**应为以下两种之一：
- **方案 A**: 顶点 UV 保持 (0,0)-(1,1)，仅更新 `uFrameUV` uniform
- **方案 B**: 顶点 UV 直接设为帧 UV，shader 为简单 pass-through

当前代码同时执行了两者，会导致帧颜色渲染不准确（颜色偏移/混合）。本测试页面应能揭示此问题。

### 测试资源

- Sprite Sheet: 256x256 BGRA，4 帧 2x2 象限，CPU 端 BGRA→GPU 端 RGBA (swapRB)
- Shader: 自定义顶点/片元着色器，WebGL 2.0 / GLSL ES 3.0
- Frame UVs: 4 个 Float32Array，每个 [uMin, vMin, uMax, vMax]
- Fallback Material: StandardMaterial, emissiveColor=(1,0,1), ALPHA_PREMULTIPLIED

---

| 审核状态 | 审核人 | 审核日期 | 审核结果 |
|---------|--------|---------|---------|
| PENDING | - | - | - |
