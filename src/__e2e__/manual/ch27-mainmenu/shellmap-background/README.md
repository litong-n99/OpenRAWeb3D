# Ch27 Main Menu - Shellmap 背景渲染

> **人工验收测试页**
> 模块: Game.ts — shellmap 3D 场景 + 菜单覆盖层 + 回退背景色
> 测试ID: `ch27-mainmenu/shellmap-background`
> OpenRA 对照: `Game.ts` — setShellmapFallback() (clearColor), showMainMenu() (shellmap canvas), _showMainMenuDomOverlay() (菜单覆盖层)
> 创建日期: 2026-06-20

**审核状态**: 全部审核通过

---

## 测试目标

验证主菜单的 Shellmap 背景渲染系统：当有 shellmap 地图数据时，3D 场景在菜单覆盖层后方渲染；当没有 shellmap 数据时，回退到纯色背景（Color4: 0.05, 0.05, 0.1, 1.0 = #0d0d1a）。这是 ADR-27.1 中"视觉层级"的核心验收点——用户必须能透过半透明菜单看到动态 shellmap 场景。

关键验证点：
1. **Shellmap 3D 场景渲染**: Babylon.js canvas 在菜单覆盖层下方渲染完整的 3D 场景（地面、建筑、单位、植被、光照、雾效）
2. **回退背景色**: 当 shellmap 不可用时，sandbox 背景为精确的 #0d0d1a（深蓝黑）
3. **菜单覆盖层半透明**: rgba(10,10,30,0.75) 叠加在 canvas 上方，shellmap 可见且文字清晰
4. **状态过渡**: shellmap ↔ fallback 切换时 500ms opacity fade 过渡，无闪烁
5. **Canvas/覆盖层 z-order**: 正确分层，canvas 始终在 DOM 覆盖层下方

---

## B. 期望结果（可量化验收标准）

### 期望 1: Shellmap 3D 场景正确渲染

**操作**: 点击"启动 Shellmap"按钮，观察 sandbox 区域。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| Canvas 可见 | opacity = 1，非 hidden | - |
| 场景包含地面 | 绿色地面平面可见 | 肉眼判定 |
| 场景包含建筑 | 至少 5 栋建筑（Box + 屋顶） | 肉眼判定 |
| 场景包含单位 | 至少 3 辆载具（Box + 炮塔） | 肉眼判定 |
| 场景包含植被 | 至少 6 棵树（圆柱 + 球体） | 肉眼判定 |
| 光照可见 | 建筑和地面有明显的明暗面 | 肉眼判定 |
| 雾效可见 | 远处物体颜色向背景色渐变 | 肉眼判定 |
| FPS | >= 30 fps（现代硬件：>= 55） | 信息栏读数 |
| Mesh 数量 | >= 30（地面 + 6 建筑 + 6 屋顶 + 5 单位 + 5 炮塔 + 16 树木部件） | 信息栏读数 |
| 三角面 | >= 500 | 信息栏读数 |

> 场景应从俯视视角渲染，摄像机缓慢轨道旋转（约 0.15 rad/s）。

### 期望 2: 回退背景色精确匹配

**操作**: 确保 shellmap 已停止（点击"停止 Shellmap"或页面初始状态），观察 sandbox 区域。

**量化标准**:

| 检查项 | 预期值 | 验证方法 |
|--------|--------|---------|
| sandbox 背景色 | rgb(13, 13, 26) / #0d0d1a | DevTools 取色器 或 computed style |
| Canvas 可见性 | opacity = 0，class 含 `hidden` | Elements 面板检查 |
| sandbox-bg-label 文本 | "#0d0d1a (fallback)" | 左下角标签 |
| Babylon.js 等效值 | Color4(0.05, 0.05, 0.1, 1.0) | - |
| 视觉效果 | 深色带蓝色调，非纯黑 (#000000) | 肉眼对比纯黑 |
| 0.05 通道值对应 | R=13, G=13, B=26 (0.05*255≈12.75≈13) | - |

> 特别验证: 回退背景色与纯黑 #000000 有明显区别。在旁边放一个纯黑色块对比可见：回退背景呈深蓝黑色调。

### 期望 3: 菜单覆盖层半透明效果

**操作**: shellmap 激活，菜单覆盖层可见。调整透明度滑块至 0.75。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 菜单卡片背景 | rgba(10, 10, 30, 0.75) | 精确匹配 |
| 卡片边框 | rgba(100, 100, 180, 0.3) | - |
| shellmap 可见性 | 透过菜单卡片能清晰看到后方 3D 场景和动画 | 肉眼判定 |
| 标题文字颜色 | #f0f0f0 | 精确匹配 |
| 按钮文字颜色 | #e0e0f0 | 精确匹配 |
| 菜单卡片位于 canvas 上方 | z-index: 5 > z-index: 0 | 渲染顺序正确 |
| overlay 不阻挡 canvas 鼠标事件 | canvas touch-action 不受影响 | - |

> 透明度滑块测试: 0.1 (几乎完全透明) → 0.95 (几乎不透明)。在每个值 shellmap 可见程度应与透明度成比例。

### 期望 4: 背景过渡动画

**操作**: 点击"测试背景过渡（快速切换）"按钮。

**量化标准**:

| 检查项 | 预期值 |
|--------|--------|
| 过渡 CSS 属性 | `transition: opacity 0.5s ease` (canvas 元素) |
| 单次切换时长 | ~500ms（+/- 100ms） |
| 完整测试序列 | 3 次 on/off 循环，共 6 次切换，总耗时约 3.6 秒 |
| 闪烁/白屏 | 无（切换过程中无白色 flash） |
| 切换后 canvas 状态 | on → canvas visible; off → canvas hidden |
| 切换后 sandbox 背景 | on → transparent; off → #0d0d1a |
| 按钮在过渡期间 | disabled 状态，显示"过渡测试中..." |
| 过渡完成 | 按钮恢复，shellmap 处于 active 状态 |

> 视觉验证要点: 切换时应在约 0.5 秒内观察到 canvas 从不可见到可见（或反之）的平滑淡入/淡出效果。背景色随之切换。

### 期望 5: Canvas / 覆盖层 z-order 分层

**操作**: shellmap 激活 + 覆盖层可见，使用 DevTools 检查元素层级。

**量化标准**:

| 元素 | z-index 预期 | 位置 |
|------|-------------|------|
| Canvas (#sandbox > canvas) | 0 | absolute, inset: 0 |
| GPU 错误遮罩 (.overlay-error) | 1 | absolute, inset: 0 |
| 菜单覆盖层 (#menu-overlay) | 5 | absolute, 居中定位 |
| 左下角标签 (#sandbox-bg-label) | 10 | absolute, bottom/left |
| 右上角状态标签 (#sandbox-mode-label) | 10 | absolute, top/right |

> canvas 的 z-index (0) 永远小于 menu-overlay 的 z-index (5)。覆盖层永远在 canvas 上方。canvas 覆盖整个 sandbox 区域。

### 期望 6: Scene clearColor Alpha 调节

**操作**: shellmap 激活，调整"Shellmap 场景 clearColor alpha"滑块。

**量化标准**:

| clearColor alpha | 预期视觉效果 |
|-----------------|------------|
| 1.00 | 场景背景完全不透明，#0d0d1a 纯色填充 canvas |
| 0.50 | canvas 背景半透明，sandbox 背景色透过 canvas 可见 |
| 0.00 | canvas 背景完全透明，sandbox #0d0d1a 背景色完全可见 |

> 这是模拟 Babylon.js `scene.clearColor = new Color4(0.05, 0.05, 0.1, alpha)` 的效果。默认 alpha=1.0。

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch27-mainmenu/shellmap-background/`
2. 确认环境信息栏显示 "Babylon.js vX.Y.Z / WebGL 2.0" 引擎
3. 确认 sandbox 初始为回退模式（深蓝色 #0d0d1a 背景，菜单覆盖层可见）
4. 确认菜单覆盖层显示 4 个按钮 + 标题 + 版本文字
5. 确认信息栏 FPS 读数正常显示

### 步骤一：回退背景色验证

1. 页面初始状态（shellmap 未启动）
2. 观察 sandbox 区域——应为深蓝黑色背景
3. 在 DevTools 中选中 #sandbox 元素
4. 检查 computed style 的 background-color = `rgb(13, 13, 26)`
5. 用取色器验证颜色值为 #0d0d1a
6. 确认 canvas 元素存在但 class 含 `hidden`，opacity = 0
7. 确认左下角标签显示 "bg: #0d0d1a (fallback)"
8. 确认自动检查面板中"回退背景色 = #0d0d1a"为绿色 pass
9. 确认自动检查面板中"Canvas 存在且尺寸正确"为绿色 pass

**预期**: 符合期望 2 → 继续

### 步骤二：Shellmap 场景渲染验证

1. 点击"启动 Shellmap"按钮
2. 观察约 500ms 内 canvas 淡入
3. 确认 sandbox 中出现 3D 场景：
   - 绿色带网格纹理的地面
   - 6 栋建筑（不同大小和颜色，带屋顶）
   - 5 辆载具/单位（带炮塔）
   - 8+ 棵树（棕色圆柱树干 + 绿色/深绿球体树冠）
4. 确认摄像机从俯视角度渲染（视角倾斜）
5. 确认场景有光照（建筑有明显的明暗面）
6. 确认远处有雾效（远处物体颜色偏暗偏蓝）
7. 确认信息栏 FPS >= 30（现代硬件应 >= 55）
8. 确认场景信息面板显示 Mesh >= 30, 三角面 >= 500
9. 确认 sandbox 模式标签显示 "shellmap"（绿色）
10. 确认自动检查面板：
    - "Canvas 存在且尺寸正确" = 绿色 pass
    - "Shellmap 场景正在渲染 (FPS >= 30)" = 绿色 pass
    - "Canvas z-index < 覆盖层 z-index" = 绿色 pass
    - "过渡动画存在" = 绿色 pass

**预期**: 符合期望 1 → 继续

### 步骤三：菜单覆盖层半透明验证

1. shellmap 仍在渲染，菜单覆盖层可见
2. 透过菜单卡片观察——后方 3D 场景清晰可见
3. 确认菜单卡片的半透明深色背景让 shellmap 可见，同时文字仍清晰可读
4. 打开 DevTools，选中 #menu-card 元素
5. 检查 computed style 的 background-color 包含 `rgba(10, 10, 30, 0.75)`
6. 调整"覆盖层透明度"滑块：
   - 拖到 0.10 → 卡片几乎完全透明，shellmap 非常清晰
   - 拖到 0.50 → 卡片半透明，shellmap 仍可见但略暗
   - 拖到 0.75 → 默认值（同时观察自动检查面板"覆盖层透明度 = 0.75"）
   - 拖到 0.95 → 卡片几乎不透明，shellmap 几乎不可见
7. 拖回 0.75
8. 点击"隐藏菜单覆盖层"→ 菜单消失，仅 shellmap 可见
9. 点击"显示菜单覆盖层"→ 菜单重新出现

**预期**: 符合期望 3 → 继续

### 步骤四：状态切换过渡验证

1. 点击"测试背景过渡（快速切换）"按钮
2. 观察按钮变为 disabled，文本变为"过渡测试中..."
3. 观察 sandbox 区域：
   - shellmap 淡入 → 激活
   - ~600ms 后 shellmap 淡出 → 回退背景
   - ~600ms 后 shellmap 再次淡入 → 激活
   - 重复 3 次循环
4. 确认每次淡入/淡出都是平滑的（约 500ms）
5. 确认无白屏闪烁
6. 确认过渡结束时 shellmap 处于激活状态
7. 确认按钮恢复可点击状态，文本恢复

**预期**: 符合期望 4 → 继续

### 步骤五：Scene clearColor Alpha 调节验证

1. shellmap 处于激活状态，菜单隐藏（便于观察 canvas）
2. 调整"Shellmap 场景 clearColor alpha"滑块至 1.00
3. 观察场景背景为完全不透明的深蓝色 #0d0d1a
4. 降至 0.50 → 观察 canvas 背景半透明，sandbox 背景透过可见
5. 降至 0.00 → 观察 canvas 背景完全透明，沙盒 #0d0d1a 背景完全可见
6. 调回 1.00 → 恢复完全不透明

**预期**: 符合期望 6 → 继续

### 步骤六：Canvas / 覆盖层 z-order 验证

1. shellmap 激活，覆盖层可见
2. 在 DevTools Elements 面板中查看 sandbox 的子元素
3. 确认渲染顺序（从上到下）：
   - #menu-overlay (z-index: 5)
   - #sandbox-bg-label (z-index: 10)
   - canvas (z-index: 0)
4. 确认 canvas 被 menu-overlay 遮挡——菜单卡片所在位置的 canvas 像素被覆盖层遮挡
5. 确认自动检查面板中"Canvas z-index < 覆盖层 z-index"为绿色 pass

**预期**: 符合期望 5 → 继续

### 边界/异常测试

1. **浏览器窗口缩放**: 调整浏览器窗口大小 → canvas 和覆盖层跟随 sandbox 尺寸自适应。菜单覆盖层始终保持居中。信息栏视口读数更新。
2. **快速切换**: 手动连续快速点击"启动 Shellmap"和"停止 Shellmap"各 5 次 → canvas 状态正确切换，无残留样式，无 JavaScript 错误。
3. **隐藏覆盖层后切换 shellmap**: 隐藏菜单覆盖层，然后切换 shellmap on/off → canvas 和背景色正确切换，覆盖层不受影响。
4. **GPU 不可用**: 如果在无 WebGL 环境下打开（如 headless 测试），应显示红色"WebGL 不可用"遮罩。
5. **长时间运行**: 保持 shellmap 激活 5 分钟 → FPS 稳定，无内存泄漏（内存增长 < 50MB），场景动画连续无卡顿。

---

## 结果判定

- [ ] 期望 1 通过（Shellmap 3D 场景正确渲染：地面 + 建筑 + 单位 + 植被，FPS >= 30）
- [ ] 期望 2 通过（回退背景色精确匹配 #0d0d1a / Color4(0.05, 0.05, 0.1, 1.0)）
- [ ] 期望 3 通过（菜单覆盖层半透明 rgba(10,10,30,0.75)，shellmap 透过可见）
- [ ] 期望 4 通过（状态切换过渡 500ms opacity fade，无闪烁）
- [ ] 期望 5 通过（Canvas z-index < 覆盖层 z-index，正确分层）
- [ ] 期望 6 通过（Scene clearColor alpha 调节效果正确）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 6 项期望通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | WebGL 不可用或 dev server 未运行 → 记录 UA/视口/引擎信息，更换环境重新测试 |

---

## 覆盖的 Game.ts 方法映射

| Game.ts 方法 | 测试中对应步骤 | 验证内容 |
|-------------|-------------|---------|
| `setShellmapFallback()` | 步骤一 | clearColor = Color4(0.05, 0.05, 0.1, 1.0) → #0d0d1a |
| Shellmap canvas 创建 | 步骤二 | 3D 场景在 canvas 中渲染 |
| Shellmap 场景加载 | 步骤二 | 地形、建筑、单位、植被渲染 |
| Shellmap 摄像机 | 步骤二 | 轨道摄像机动画 |
| `_showMainMenuDomOverlay()` | 步骤三 | 菜单覆盖层 rgba(10,10,30,0.75) |
| 背景切换逻辑 | 步骤四 | 500ms opacity transition |
| Canvas/覆盖层 z-order | 步骤五/六 | 分层渲染顺序 |
| `scene.clearColor` 设置 | 步骤五 | clearColor alpha 调节 |
