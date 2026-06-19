# Editor - Actor 放置与选择 (EditorActorLayer + EditorActorPreview) 人工验收

> **人工验收测试页**
> 模块: EditorActorLayer.ts + EditorActorPreview.ts
> 测试ID: `ch21-editor/actor-placement`
> OpenRA 对照: `OpenRA.Mods.Common/Traits/World/EditorActorLayer.cs` + `EditorActorPreview.cs`
> 创建日期: 2026-06-19
> **审核状态**: 待审核
> 审核人: (pending)

---

## 测试目标

本测试页面验证编辑器 actor 放置系统 (EditorActorLayer + EditorActorPreview) 的核心交互行为：

1. Ghost 预览实时跟随鼠标，延迟不超过 1 帧
2. 有效放置位置绿色高亮，无效位置红色高亮
3. Grid snap: actor 精确对齐到 cell center
4. 碰撞检测: 障碍物 / OOB / 已有 actor 重叠拒绝放置
5. Rubber-band 选择: 拖拽虚线矩形框选择已放置的 actor

---

## B. 期望结果（可量化验收标准）

### 期望 1: Ghost 跟随延迟 ≤1 帧

**操作**: 在网格上移动鼠标，观察 ghost（半透明预览方块）跟随情况。

**量化标准**:
- Ghost 在鼠标移动到新格后 **≤1 帧 (16.7ms @ 60fps)** 内更新位置
- Ghost 中心点严格在 **cell center** (`cx + 0.5, cz + 0.5`)，偏差 ≤ 0.02 世界单位
- 鼠标快速移动时 ghost **无残影、无跳帧漏格**
- 鼠标移出网格 (OOB 区域) 时 ghost **立即隐藏**

**失败判定**: Ghost 滞后 > 1 帧可见延迟，或位置未吸附到格子中心 → **BLOCKER**

---

### 期望 2: 有效/无效放置颜色

**操作**: 分别在空地格、障碍物格、已占据格、OOB 区域移动鼠标，观察 ghost 颜色。

**量化标准**:
- 有效放置（空地、无阻挡、无重叠、在网格内）→ ghost 为 **绿色**：
  - R: **0.20 (0.19-0.21)**
  - G: **0.70 (0.665-0.735)**
  - B: **0.20 (0.19-0.21)**
- 无效放置（障碍物 / 已有 actor 占据 / Building 超界）→ ghost 为 **红色**：
  - R: **0.80 (0.76-0.84)**
  - G: **0.15 (0.1425-0.1575)**
  - B: **0.15 (0.1425-0.1575)**
- 颜色切换在鼠标移动后 **≤1 帧** 完成
- ghost 半透明度: **alpha = 0.55**

**失败判定**: 颜色偏差超出 ±5% 范围，或颜色切换有可见延迟 → **BLOCKER**

---

### 期望 3: Grid Snap 放置精度

**操作**: 在有效格上点击放置 actor，观察 actor 位置。

**量化标准**:
- 1x1 actor (Infantry/Vehicle) 放置后中心位置与 cell center 偏差 ≤ **0.1 世界单位 (wu)**
- cell center 坐标公式: **(`cx` + 0.5, 0.2, `cy` + 0.5)** world units
- 2x2 actor (Building) 放置后中心位置与四格中心偏差 ≤ **0.1wu**
- Actor 网格尺寸: 1x1 为 **0.9wu x 0.9wu**，2x2 为 **1.8wu x 1.8wu**（90% 填充率）

**失败判定**: Actor 明显偏离 cell center 超过 0.1wu → **BLOCKER**

---

### 期望 4: 碰撞检测与放置拒绝

**操作**: 分别尝试在以下位置放置 actor，确认 ghost 为红色且点击无法放置。

**量化标准**:
- **障碍物格** (3,3), (4,3), (3,5), (6,5), (7,5), (4,7), (5,7), (8,8): ghost 红色，点击无效
- **已占据格**: 先在 (2,2) 放置 Infantry，再尝试在 (2,2) 放置 Vehicle → ghost 红色，无法放置
- **Building 超界**: 在 (9,0) 尝试放置 Building (2x2) → 右侧超出网格 → ghost 红色
- **OOB 区域** (x<0 或 x≥10 或 y<0 或 y≥10): ghost 不显示
- **Building 部分重叠**: 在 (1,1) 放置 Building，再尝试在 (2,2) 放置 Building → 重叠，ghost 红色

**失败判定**: 任何情况下可在无效位置成功放置 → **BLOCKER**

---

### 期望 5: Rubber-band 选择

**操作**: 在空白区域拖拽鼠标，观察虚线选择框；释放后观察 actor 选中状态。

**量化标准**:
- 拖拽时显示 **虚线矩形框**（由 4 条线段组成），颜色为 **#44aaff (R:0.27, G:0.67, B:1.0)**
- 选择框从拖拽起点到终点，精确匹配**屏幕像素坐标**
- 释放后框内所有 actor 变为 **黄色高亮**（diffuse: #FFE633, emissive: #665908）
- 释放在空白区域极小拖拽 (< 4px) → 取消所有选择（不选中任何 actor）
- 点击单个已放置 actor → 直接选中该 actor（变黄），其他取消选中
- Ctrl + 点击已选中 actor → 取消该 actor 选中
- 右键点击 → 取消全部选择

**失败判定**: 虚线框不显示、框内 actor 未选中、或选中范围错误 → **MAJOR**

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch21-editor/actor-placement/`
2. 确认环境信息栏显示 **WebGL 2.0**
3. 确认 FPS 显示在 **50-60** 范围
4. 确认网格显示为 **10x10**，外围有橙色 OOB 区域
5. 确认 8 个灰色障碍物方块可见

### 步骤一：Ghost 跟随测试

1. 选择 Infantry（默认已选中，蓝色高亮按钮）
2. 在网格上缓慢移动鼠标，观察绿色半透明方块跟随
3. 快速移动鼠标扫过网格，观察 ghost 是否无缝跟随
4. 移动鼠标到橙色 OOB 区域，确认 ghost 消失
5. 移动鼠标到灰色障碍物方块上，确认 ghost 变为红色
6. 观察左侧面板「鼠标所在格」和「Ghost 状态」实时更新

**预期**: 符合期望 1 + 期望 2

### 步骤二：有效放置测试

1. 确保 Infantry 选中
2. 在空地格（如 (0,0)、(2,2)、(5,5)）点击左键
3. 确认蓝色方块出现在格子中心，精确对齐
4. 观察「已放置数量」增加
5. 切换到 Vehicle（青色），在空地格放置
6. 切换到 Building（黄色 2x2），在空地格放置
7. 确认 Building 占据 2x2 四格

**预期**: 符合期望 3

### 步骤三：无效放置测试

1. 尝试在障碍物格 (3,3) 点击 → 确认无法放置（ghost 红色）
2. 在 (0,0) 放置 Infantry 后，尝试在同一格放置 Vehicle → 确认 ghost 红色
3. 尝试在 (9,0) 放置 Building → 确认 ghost 红色（右侧超界）
4. 尝试在 OOB 区域点击 → 确认无 ghost，无法放置
5. 在 (1,1) 放置 Building，尝试在 (2,1) 放置另一个 Building → 确认 ghost 红色（重叠）

**预期**: 符合期望 4

### 步骤四：Rubber-band 选择测试

1. 使用「随机放置 5 个 actor」按钮或手动放置 5 个不同位置的 actor
2. 在网格空白区域按下鼠标左键并拖拽，跨越 2-3 个 actor
3. 确认拖拽时显示蓝色虚线矩形框
4. 释放鼠标，确认框内 actor 变为黄色高亮
5. 在空白处极小拖拽 (< 4px) 释放 → 确认取消所有选择
6. 点击单个已放置 actor → 确认该 actor 被选中（变黄），其他取消
7. 关闭 Rubber-band 选择模式，在空地点击 → 确认直接放置 actor

**预期**: 符合期望 5

### 步骤五：搜索/过滤测试

1. 在搜索框输入 "infantry" → 确认显示匹配结果
2. 输入 "vehicle" → 确认显示匹配结果
3. 输入 "xyz" → 确认显示「无匹配结果」
4. 清空搜索框 → 确认无提示

### 边界/异常测试

1. **全部占满**: 在 10x10 网格所有空地放置 actor，确认最后无空间时 ghost 红色
2. **键盘快捷键**: 按 1/2/3 切换 actor 类型，按 Delete 删除选中 actor，按 Escape 取消选择
3. **Building 障碍物组合**: 在 (2,3) 放置 Building（占据 2,3;3,3;2,4;3,4）→ 确认障碍物 (3,3) 阻挡导致 ghost 红色
4. **无放置后选择**: 确保无任何 actor 放置时，拖拽 rubber-band → 确认无异常

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [ ] 期望 1 通过（Ghost 跟随延迟 ≤1 帧）
- [ ] 期望 2 通过（有效绿色 / 无效红色）
- [ ] 期望 3 通过（Grid Snap 精度 ≤0.1wu）
- [ ] 期望 4 通过（碰撞检测与放置拒绝）
- [ ] 期望 5 通过（Rubber-band 选择）

**最终判定: PENDING REVIEW**

**设备信息**:
- GPU: __________
- 浏览器: __________
- 操作系统: __________
- 视口: __________

---

## 测试覆盖模块对照

| 验收点 | 对应 EditorActorLayer 方法/属性 | 对应 EditorActorPreview 方法/属性 |
|--------|-------------------------------|----------------------------------|
| Ghost 跟随 | `add()`, `previewsAtCell()` | `location`, `footprint`, `centerPosition` |
| 有效/无效颜色 | `previewsAtCell()`, `freeSubCellAt()` | `footprint`, `_occupiedCells()` |
| Grid Snap | `moveActor()`, `add()` | `location`, `_computeCenterPosition()` |
| 碰撞检测 | `previewsAtCell()`, `freeSubCellAt()` | `footprint`, `_computeFootprint()` |
| Rubber-band | `previewsInScreenBox()`, `previewsInCellRegion()` | `bounds`, `selected` |
