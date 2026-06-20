# TeslaZap - 3D Lightning Polish (LinesMesh + ShaderMaterial)

> **人工验收测试页**
> 模块: TeslaZapRenderable (Ch24 Phase B Lightning Polish)
> 测试ID: `ch24-effects/tesla-zap`
> OpenRA 对照: `TeslaZapRenderable.cs` (OpenRA.Mods.Cnc/Graphics)
> 创建日期: 2026-06-20

---

## 测试目标

验证 Ch24 Phase B 完成后的 TeslaZapMeshBuilder 四个核心功能：

1. **Emissive LinesMesh Creation**: `createWithDefaults` + `buildZaps` 生成自发光线段网格
2. **Lightning Jitter Animation**: `updateJitter(tickCount)` 每帧顶点抖动，模拟闪电分支效果
3. **Dispose Cleanup**: `dispose()` 正确释放 LinesMesh 和 ShaderMaterial 的 GPU 资源
4. **renderingGroupId**: 网格正确归属到 RenderGroup.Actor (1)

---

## B. 期望结果（可量化验收标准）

### 期望 1: Emissive LinesMesh 渲染 — 亮青色 + 暗蓝色

**操作**: 打开页面，观察场景中的闪电线段。默认创建 2 条 zap 路径（1 bright + 1 dim）。

**观察点**:
- Bright zap（上方的锯齿状闪电主干）显示为**亮青色**线条，RGB 近似 (77, 255, 255)
- Dim zap（下方的分支闪电）显示为**暗蓝色**线条，RGB 近似 (15, 46, 122)
- 两条线段均为**自发光材质**（ShaderMaterial），不受场景光照影响
- 从任意角度旋转摄像机，线段始终保持相同亮度（无光照衰减）

**量化标准**:

| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Bright 颜色 | 亮青色，肉眼判定为明亮的蓝绿色调 | G 通道 > 200, B 通道 > 200 |
| Dim 颜色 | 暗蓝色，肉眼判定明显暗于 Bright | B 通道 > G 通道 > R 通道 |
| 自发光 | 旋转摄像机后颜色/亮度不变 | 各角度一致 |
| 线段数量 | 2 条 LinesMesh（1 bright + 1 dim） | 控件面板 mesh-count = 2 |
| 顶点数 | Bright: 5 顶点 (4 线段), Dim: 4 顶点 (3 线段) | 控件面板正确显示 |

### 期望 2: Lightning Jitter 动画 — 顶点逐帧抖动

**操作**: 确认「启用 Jitter 动画」复选框已勾选，观察闪电线段。

**观察点**:
- 闪电线段的顶点在**逐帧抖动**（非静态直线），形似真实闪电的不规则分支
- 抖动幅度在默认强度 1.0x 下，每帧顶点偏移不超过 0.5 世界单位
- 关闭 Jitter 后，线段恢复到原始路径形状（无抖动，静态直线）
- Jitter 是**确定性**的：相同的 seed (42) + 相同的 tickCount 序列产生相同的抖动模式

**量化标准**:

| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Jitter 可见 | 顶点明显偏移原始路径，肉眼可辨不规则曲折 | 非平直直线 |
| 帧间变化 | 每帧形状不同（连续变化，非跳变） | 闪电持续"蠕动" |
| Jitter 关闭 | 线段恢复为原始锯齿路径 | 恢复静态 |
| 确定性 | 刷新页面后 tick=0 时形状与之前相同 | 闪烁模式可复现 |
| 无位置漂移 | 每帧从 baseline 恢复后 jitter，不累积偏移 | 线段中心不漂移 |

### 期望 3: Dispose 清理 — 无 WebGL 错误

**操作**: 点击「Dispose (Cleanup)」按钮，然后检查浏览器控制台。

**观察点**:
- 场景中的闪电线段**立即消失**（2 条 LinesMesh 被移除）
- 控件面板显示 mesh-count = 0, Builder 状态 = disposed
- 浏览器 DevTools Console 中**无 WebGL 错误**（无 "WebGL: INVALID_OPERATION" 等警告）
- 无 JavaScript 异常抛出

**量化标准**:

| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Mesh 移除 | 闪电线段从场景中消失 | 肉眼无可见线段 |
| Mesh 计数 | mesh-count = 0 | 控件面板确认 |
| WebGL 错误 | 0 个控制台错误 | DevTools Console 干净 |
| JS 异常 | 0 个未捕获异常 | 无报错 |

### 期望 4: renderingGroupId = 1

**操作**: 观察控件面板「Mesh 状态」区域的 renderingGroupId 值。

**观察点**:
- 控件面板显示 `renderingGroupId: 1`（对应 RenderGroup.Actor）
- 线段在场景中正常可见（renderingGroupId=1 在 Babylon.js 默认 0-3 渲染组范围内）

**量化标准**:

| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| renderingGroupId | 固定为 1 | 控件面板确认为 1 |
| 线段可见 | 在线段正常渲染，非 invisible | 肉眼可见 |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch24-effects/tesla-zap/`
2. 确认环境信息栏显示 WebGL 2.0 引擎（或更高版本）
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 打开浏览器 DevTools Console（F12），清除已有日志

### 步骤一：验证 Emissive LinesMesh 渲染

- 观察场景中两条闪电线段
- 上方较亮的锯齿状线段 = Bright zap（亮青色）
- 下方较暗的分支线段 = Dim zap（暗蓝色）
- 鼠标拖拽旋转摄像机到不同角度
- 预期：✅ 线段从各角度保持相同亮度（自发光，无光照衰减）
- 预期：✅ 控件面板 mesh-count = 2, renderingGroupId = 1
- **异常记录**: 若线段颜色与图例不符（如显示白色/灰色而非亮青色），记录观察到的颜色

### 步骤二：验证 Jitter 动画

- 确认「启用 Jitter 动画」复选框已勾选
- 观察闪电线段的顶点是否在逐帧抖动/变化
- 调整「Jitter 强度」滑块到 0.1x → 抖动极慢，每帧形状几乎不变
- 调整到 3.0x → 抖动加速，形状快速变化
- 取消勾选「启用 Jitter 动画」→ 线段恢复为静态原始路径
- 预期：✅ Jitter 开启时顶点明显抖动，关闭时恢复静态
- 预期：✅ 不同强度下动画速度有明显差异

### 步骤三：验证 Dispose 清理

- 点击「Dispose (Cleanup)」按钮
- 观察场景：闪电线段应立即消失
- 检查控件面板：mesh-count = 0, Builder 状态 = disposed
- 检查 DevTools Console：无 WebGL 错误或 JavaScript 异常
- 点击「Recreate Builder」按钮
- 预期：✅ 闪电线段重新出现，Builder 状态恢复为 active
- 预期：✅ mesh-count = 2, renderingGroupId = 1

### 步骤四：验证 Jitter 确定性

- 记录当前 tickCount 值（如 tick=0 时的闪电形状）
- 点击「Rebuild Zaps」重置 tickCount 到 0
- 观察闪电形状是否与之前 tick=0 时一致
- 预期：✅ 相同 seed + 相同 tickCount = 相同抖动模式（确定性伪随机）

### 步骤五：验证 Rebuild Zaps

- 点击「Rebuild Zaps」按钮
- 观察：tickCount 重置为 0，mesh 重新创建
- 预期：✅ mesh-count 保持为 2，renderingGroupId 保持为 1
- 预期：✅ 闪电线段可见，从基础路径重新开始抖动

### 边界测试

- **极慢 Jitter**: 强度 0.1x → 抖动极细微，几乎不可见但仍有微小变化
- **极快 Jitter**: 强度 3.0x → 抖动剧烈，但线段不超出原始包络线
- **Dispose 后操作**: 点击 Dispose 后再点击 Rebuild Zaps → 应有提示（按钮检查 disposed 状态，无操作）
- **Recreate 循环**: Dispose → Recreate → Dispose → Recreate，5 次循环 → 无 WebGL 错误累积，无内存泄漏迹象（FPS 不下降）
- **摄像机极端角度**: 旋转到正上方（beta=0）和正侧面（beta=PI/2）→ 线段始终可见
- **F5 刷新**: 刷新页面后状态恢复初始（2 条线段，tick=0，jitter 启用）
- **长时间运行**: 保持 jitter 开启 60 秒 → FPS 稳定在 55-60，无性能退化

### 结果判定

- [ ] 所有 4 项期望通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异和截图，提交 issue
- [ ] 测试环境异常 (WebGL 不可用等) → 记录 UA / 视口 / 引擎 / FPS 信息

---

## 技术备注

### Jitter 位置漂移与基线恢复

`TeslaZapMeshBuilder.updateJitter()` 的实现从 `mesh.getVerticesData('position')` 读取**当前**顶点位置来叠加抖动偏移。如果不恢复基线，位置会逐帧累积漂移（Random Walk），导致闪电逐渐偏离原始路径。

本测试页面采取**每帧恢复基线**策略：在调用 `updateJitter()` 之前，先将所有 mesh 的顶点位置重置为 `buildZaps()` 后的原始值。这确保：
- 每个 tickCount 的抖动偏移是**从原始路径出发的独立偏移量**
- 抖动动画不产生累积漂移
- 确定性得到保证（相同 seed + tickCount = 相同形状）

这是测试页面的额外安全措施，**不代表** `updateJitter()` 在生产代码中的实际行为。如果要用于生产，建议在 `TeslaZapMeshBuilder` 内部存储基线位置并在 `updateJitter` 中自动恢复。

### ShaderMaterial 结构

每条闪电线使用自定义 GLSL 着色器（通过 `Effect.ShadersStore` 注册）：

**Vertex Shader**: 仅做 MVP 变换，无光照计算
```glsl
gl_Position = worldViewProjection * vec4(position, 1.0);
```

**Fragment Shader**: 纯 emissive 输出，无光照
```glsl
gl_FragColor = vec4(uColor * uIntensity, 1.0);
```

**Bright Material**:
- `uColor = (0.2, 0.8, 1.0)` — 亮青色 (cyan)
- `uIntensity = 1.5` — 高亮度
- `needAlphaBlending = () => true`, `backFaceCulling = false`

**Dim Material**:
- `uColor = (0.1, 0.3, 0.8)` — 暗蓝色
- `uIntensity = 0.6` — 低亮度
- 同样设置 alpha blending + no culling

### 测试资源

- 无外部纹理依赖 — LinesMesh 使用纯色 ShaderMaterial
- 2 条测试 zap 路径：1 bright (5 顶点, 4 段) + 1 dim (4 顶点, 3 段)
- 所有顶点位于 XY 平面 (z=0)，便于从默认摄像机角度观察
- Ground plane 提供空间参考（半透明深灰平面）

### 已知限制

- `updateJitter` 的 `jitterMax` 硬编码为 0.5，无法从外部调整。强度滑块通过调整 tickCount 增量速率间接控制抖动视觉速度。
- 线段宽度受 WebGL `gl.lineWidth` 限制（多数平台最大 1px），LinesMesh 的宽度不可通过 API 调整。亮暗区分主要通过颜色和材质属性实现。

---

| 审核状态 | 审核人 | 审核日期 | 审核结果 |
|---------|--------|---------|---------|
| PENDING | - | - | - |
