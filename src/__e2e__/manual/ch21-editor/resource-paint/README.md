# EditorResourceLayer - 资源绘制笔刷

> **人工验收测试页**
> 模块: EditorResourceLayer
> 测试ID: `ch21-editor/resource-paint`
> OpenRA 对照: `EditorResourceLayer.cs`
> 创建日期: 2026-06-19
> **审核状态**: ⏳ 待审核

---

## 测试目标

本测试页面验证编辑器**资源绘制系统**的视觉正确性。自动化单元测试可验证 EditorResourceLayer 的数据模型（addResource/removeResource/getDensity/netWorth），但以下关键行为必须由人工肉眼判断：

1. **密度→颜色强度的线性映射**：cell 颜色强度应随资源密度（0-100%）线性变化，在 0% 时显示为深灰地面色，在 100% 时显示为对应资源类型的饱和色
2. **资源类型颜色正确性**：三种资源类型各自具有明确的标识色，颜色值需与 OpenRA 原始定义一致
3. **笔刷 stroke 多 cell 一致性**：一次拖拽跨越多个 cell 时，每个 cell 均应正确着色
4. **可见性切换即时响应**：Toggle 按钮应瞬间（<100ms）切换资源层的显示/隐藏状态

---

## B. 期望结果（可量化验收标准）

### 期望 1: Cell 颜色强度线性映射到资源密度

**操作**: 载入预置场景（点击「载入预置场景」），观察 Row 0（第一行，Ore 行）。

**观察点**:
- Row 0 从左到右（col 0→9）应呈现从**深灰色 (#333333)** 到**橙棕色 (#C8641E)** 的平滑渐变
- 渐变应均匀递增，无明显的色阶跳跃
- 相邻 cell 之间的颜色差异应肉眼可感知但不过于剧烈

**量化标准**:

| 检查项 | 网格坐标 | 预期密度 | 预期颜色 (HEX) | 容差 |
|--------|---------|---------|---------------|------|
| Ore 10% | (0, 0) | 10% | `#402A22` (±2 RGB) | 肉眼可见淡橙色调 |
| Ore 50% | (4, 0) | 50% | `#7E4C22` (±2 RGB) | 清晰橙色 |
| Ore 100% | (9, 0) | 100% | `#C8641E` | 精确匹配 |
| 空 cell | 任意未绘制 cell | 0% | `#333333` | 精确匹配 |

**失败判定**: 若 Row 0 最右 cell 不是橙棕色且与左侧有明显颜色区分 → 密度映射错误（BLOCKER）。若渐变呈现跳跃色带（相邻 cell 颜色差 > 30 RGB 单位而无中间过渡）→ 插值实现错误（MAJOR）。

### 期望 2: Ore 颜色 = 橙棕 #C8641E at 100%

**操作**: 选择「Ore」资源类型，密度设为 100%，使用 1×1 笔刷在任意空 cell 上点击一次。

**观察点**:
- 该 cell 应立即变为**鲜艳的橙棕色 (#C8641E)**，RGB 约为 R=200, G=100, B=30
- 颜色应为温暖的橙色调，不应偏红（R > 220）或偏黄（G > 150）

**量化标准**:
- 在 100% 密度下，cell 颜色应精确匹配 `#C8641E`
- 肉眼判定：应明显区别于 Gems 的蓝白和 Tiberium 的绿色
- 在 50% 密度下，颜色应为 50% 地面色与 #C8641E 的线性混合

**失败判定**: 若 Ore 100% 时显示为红色或黄色 → 颜色定义错误（BLOCKER）。

### 期望 3: Gems 颜色 = 蓝白 #6496FF at 100%

**操作**: 选择「Gems」资源类型，密度设为 100%，在空 cell 上绘制。

**观察点**:
- 该 cell 应立即变为**蓝白色 (#6496FF)**，RGB 约为 R=100, G=150, B=255
- 颜色偏冷色调，有明显的蓝色成分

**量化标准**:
- Gems 100%: `#6496FF`
- Gems 50%: 50% 地面色与 #6496FF 的线性混合（肉眼判定：应为淡蓝灰色）
- 相邻已绘制 Ore 和 Gems cell 应清晰可辨

### 期望 4: 一次 brush stroke 多个 cell 均正确

**操作**: 选择「Ore」资源类型，密度设为 80%，笔刷大小设为 3×3。在网格空白区域拖拽（按住鼠标左键拖动）一条对角线路径。

**观察点**:
- 鼠标经过的所有 cell（以及 3×3 范围内的相邻 cell）均应被绘制
- 每个被绘制 cell 颜色一致（均为 80% 密度对应的 Ore 颜色）
- 不应有遗漏的 cell 在笔刷路径中
- stroke 两端的边缘 cell 应正确显示为正方形区域的边界

**量化标准**:
- 笔刷路径中所有 cell 的密度值应一致（getCellDensity 返回相同值）
- 3×3 笔刷绘制区域应为正方形，无缺失角

**失败判定**: 若笔刷中心 cell 有颜色但相邻 cell 无颜色 → 笔刷尺寸实现错误（MAJOR）。若拖拽时出现 cell 遗漏（中间有空隙）→ 事件采样率不足（MAJOR）。

### 期望 5: Toggle 正确切换可见性

**操作**: 在已绘制资源的网格上，点击「隐藏资源层」按钮。

**观察点**:
- 所有 cell 应立即（<100ms）恢复为统一的深灰地面色（#333333）
- 网格整体应呈现为完全均匀的灰色平面，无任何资源颜色的残留
- 再次点击「显示资源层」按钮 → 所有资源颜色应立即恢复，位置和颜色与隐藏前完全一致
- 切换过程中不应有闪烁或部分 cell 更新延迟

**量化标准**:
- 切换响应延迟: < 100ms（肉眼不可感知）
- 隐藏后: 所有 cell 颜色均为 `#333333`，无一例外
- 显示后: 所有之前绘制的 cell 颜色恢复，无一丢失
- 信息栏「已绘制 cells」数值在隐藏/显示前后保持不变

**失败判定**: 若隐藏后某些 cell 仍显示资源颜色 → 可见性逻辑错误（BLOCKER）。若显示后资源数据丢失 → 状态管理错误（BLOCKER）。

### 期望 6: 橡皮擦模式正确清除资源

**操作**: 勾选「橡皮擦模式」，在已绘制资源的 cell 上点击。

**观察点**:
- 点击的 cell 应立即恢复为深灰地面色
- 仅清除被点击的 cell，相邻 cell 不受影响
- 「已绘制 cells」计数应减 1
- 「Net Worth」应相应减少

**失败判定**: 若橡皮擦清除不完整（cell 颜色未恢复为地面色）→ 橡皮擦实现错误（MAJOR）。

### 期望 7: FPS 稳定性

**操作**: 快速拖拽笔刷在网格上绘制，同时切换资源类型。

**量化标准**:
- FPS 应稳定在 **55-60 fps**（60Hz 显示器）
- 拖拽绘制时帧率下降不超过 **5 fps**
- 切换资源类型或笔刷大小时无可见延迟
- 页面初始化后首次绘制无超过 200ms 的冻结

---

## 检验流程

### 准备工作

1. 打开测试页面：
   - 开发模式: `http://localhost:5173/test/ch21-editor/resource-paint/`
2. 确认页面底部**环境信息栏**显示：
   - 引擎: `Babylon.js vX.Y.Z / WebGL 2.0`
   - FPS: 显示数值（非 `-`）
   - 视口: 匹配当前浏览器窗口尺寸
3. 设置屏幕分辨率为 **1920x1080**（1x 缩放），关闭浏览器夜间模式/色彩滤镜
4. 页面应自动加载预置场景（8 行 × 10 列资源网格）

### 步骤一：密度渐变色带验证

1. 观察 Row 0（Ore 行）：
   - 从左到右 (col 0→9) 应呈现深灰→橙棕的平滑渐变
   - 最左 cell 应接近深灰 (#333333)，最右 cell 应为橙棕 (#C8641E)
2. 观察 Row 1（Gems 行）：
   - 从左到右应呈现深灰→蓝白 (#6496FF) 的平滑渐变
3. 观察 Row 2（Tiberium 行）：
   - 从左到右应呈现深灰→绿色 (#00CC00) 的平滑渐变
4. 肉眼比较三种资源类型的最右 cell：应各有明显不同的色调

**预期**: 符合期望 1, 2, 3

### 步骤二：单 cell 精确绘制验证

1. 点击「重置全部」清除所有资源
2. 选择资源类型「Ore」，密度设为 100%，笔刷 1×1
3. 在网格左上角 (0,0) cell 点击一次
   - cell 应变橙棕色 #C8641E
4. 密度改为 50%，在相邻 cell (1,0) 点击
   - 颜色应明显比 (0,0) 浅（约为橙色和灰色的中间色）
5. 密度改为 10%，在 (2,0) 点击
   - 颜色应非常接近地面灰色，仅有微弱橙色色调
6. 选择「Gems」，密度 100%，在 (0,1) 点击
   - 应为蓝白色，与 Ore 的橙色明显不同
7. 选择「Tiberium」，密度 100%，在 (0,2) 点击
   - 应为绿色

**预期**: 符合期望 1, 2, 3

### 步骤三：笔刷拖拽验证

1. 点击「重置全部」
2. 选择「Ore」，密度 80%，笔刷 3×3
3. 在网格空白区域按住左键拖拽一条对角线路径
4. 检查：
   - 路径上所有 cell 均被绘制
   - 笔刷形状为 3×3 正方形
   - 路径中间的 cell 无遗漏
5. 重复测试 2×2 和 1×1 笔刷大小

**预期**: 符合期望 4

### 步骤四：可见性切换验证

1. 在已有资源绘制的网格上
2. 点击「隐藏资源层」
   - 所有 cell 应立即变为统一的深灰色
   - 视觉上完全看不出资源分布
3. 点击「显示资源层」
   - 所有资源颜色应立即恢复
   - 位置和颜色与隐藏前一致
4. 在隐藏状态下绘制新资源（应被拒绝或自动显示）→ 观察行为
5. 反复切换 5 次，确认每次切换正确

**预期**: 符合期望 5

### 步骤五：橡皮擦验证

1. 使用预置场景
2. 勾选「橡皮擦模式」
3. 点击 Row 0 的第一个 cell (已有 Ore 资源)
   - cell 应变回深灰地面色
   - 相邻 cell 不受影响
4. 使用 2×2 橡皮擦大小，在 Row 3-4 的棋盘格区域擦除
   - 4 个 cell 应同时被清除

**预期**: 符合期望 6

### 步骤六：FPS 性能验证

1. 观察 FPS 计数器
2. 使用 3×3 笔刷快速拖拽绘制整个网格
3. FPS 应保持 ≥ 50
4. 快速切换资源类型（Ore→Gems→Tiberium 循环 5 次）
5. 切换期间无卡顿

**预期**: 符合期望 7

### 边界/异常测试

1. **密度边界**: 密度设为 0% → 绘制后 cell 应接近地面色（但不完全等于地面色，因为至少绘制了 1 单位密度）
2. **密度边界**: 密度设为 100% 反复在同一 cell 绘制 → 颜色不变（已达最大密度）
3. **画笔边界**: 在网格边缘使用 3×3 笔刷 → 仅在网格范围内的 cell 被绘制，无报错
4. **橡皮擦空 cell**: 在空 cell 上使用橡皮擦 → 无变化，无报错
5. **窗口调整**: 缩小窗口到 800×600 → 网格正常缩放，交互正常
6. **编辑器数据模型验证**: 打开浏览器控制台，执行 `window.__testHarness.getCellDensity(9, 0)` → 应返回 100（Row 0 最右 Ore cell）
7. **颜色查询**: 执行 `window.__testHarness.getResourceColor(9, 0)` → 应返回 `#C8641E`

### 跨浏览器验证（可选）

| 浏览器 | WebGL 版本 | 预期行为 |
|--------|-----------|---------|
| Chrome 130+ | WebGL 2.0 | 所有测试通过 |
| Firefox 130+ | WebGL 2.0 | 所有测试通过 |
| Edge 130+ | WebGL 2.0 | 所有测试通过 |
| Safari 18+ | WebGL 2.0 | 所有测试通过 |

---

## 结果判定

- [ ] 期望 1 通过（密度→颜色强度线性映射）
- [ ] 期望 2 通过（Ore 100% = #C8641E）
- [ ] 期望 3 通过（Gems 100% = #6496FF）
- [ ] 期望 4 通过（笔刷 stroke 多 cell 一致）
- [ ] 期望 5 通过（Toggle 可见性切换正确）
- [ ] 期望 6 通过（橡皮擦正确清除）
- [ ] 期望 7 通过（FPS ≥ 55 稳定）
- [ ] 边界测试通过

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 所有 7 项期望 + 边界测试全部通过 |
| **ACCEPTED WITH ISSUES** | 所有期望通过，但边界测试有 1-2 项异常 |
| **REJECTED** | 任一期望未通过 → 记录具体差异，提交 issue |

---

## 技术背景

### 本测试页面覆盖的关键迁移风险

| 风险 | OpenRA 原始行为 | TypeScript 迁移实现 | 验证方式 |
|------|----------------|-------------------|---------|
| 资源类型颜色映射 | C# EditorResourceLayer 无内置颜色；颜色由渲染系统(TerrainSpriteLayer)基于 terrain type 查找 | TS 中需人工定义颜色映射表 | 期望 1-3 颜色渐变验证 |
| 密度可视化 | C# 通过 TerrainSpriteLayer 的调色板帧渲染 | TS 通过 StandardMaterial.diffuseColor 线性插值 | 期望 1 密度渐变 |
| 笔刷交互 | C# MapEditorSelectionLogic 处理鼠标事件 | TS scene.onPointerObservable + scene.pick() 射线检测 | 期望 4 笔刷拖拽 |
| 数据模型完整性 | C# EditorResourceLayer.AddResource / RemoveResource / ClearResource | TS 同名方法，Map 存储 | `__testHarness` API 验证 |
| 可见性切换 | C# 无此概念（编辑器始终可见） | TS 自定义 toggle | 期望 5 |

### EditorResourceLayer 数据模型简介

```
EditorResourceLayer (IResourceLayer 实现)
  ├── _cells: Map<string, ResourceCellData>  // key="X,Y" → {type, density}
  ├── _netWorth: number                        // 累计经济价值
  ├── _resCells: number                        // 非空 cell 计数
  └── info: EditorResourceLayerInfo
       └── resourceTypes: Map<string, ResourceTypeInfoConfig>
            ├── "ore":     { resourceIndex:1, maxDensity:10, terrainType:"Ore" }
            ├── "gems":    { resourceIndex:2, maxDensity:5,  terrainType:"Gems" }
            └── "tiberium": { resourceIndex:3, maxDensity:12, terrainType:"Tiberium" }

关键方法:
  addResource(type, cell, amount) → 替换/添加资源，触发 CellChanged
  getDensity(cell) → 0-100% 归一化密度
  getResource(cell) → { type, density }
  clearAllResources() → 清空全部
  clone() / applySnapshot() → 撤销/重做快照
```

---

## __testHarness API 参考

测试页面将以下对象暴露到 `window.__testHarness`：

```typescript
// 选择资源类型
__testHarness.selectResource('ore' | 'gems' | 'tiberium')

// 在网格坐标 (col, row) 绘制指定密度 (0-100%)
__testHarness.paintCell(col, row, densityPercent)

// 获取网格坐标 (col, row) 的资源密度百分比 (0-100)
__testHarness.getCellDensity(col, row)

// 获取网格坐标 (col, row) 的当前显示颜色 (HEX 字符串)
__testHarness.getResourceColor(col, row)

// 清除所有资源
__testHarness.reset()

// 获取 EditorResourceLayer 实例
__testHarness.getLayer()
```

