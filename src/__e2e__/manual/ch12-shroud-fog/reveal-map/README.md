# Shroud — Full Map Reveal Visual Test

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-02, 8/8 通过, 100%)
**创建日期**: 2026-06-15
**对应模块**: `src/OpenRA.Mods.Common/Traits/RevealsMap.ts`

## 期望结果 (Expected Results)

1. **RevealMap 关闭时**: 地图根据实际探索状态显示。
   - 可量化指标: 未探索区域显示纯黑 Hidden `rgba(0,0,0,1.0)`
   - 可量化指标: 已探索区域显示暗灰 Explored `rgba(15,15,15,0.55)`
   - 可量化指标: 信息栏 Hidden/Explored/Visible 计数反映 baseState

2. **RevealMap 开启时**: 整个地图变为 Explored（暗灰迷雾）状态。
   - 可量化指标: 点击 "Reveal Map (开启)" 后所有 Cell 立即变为 Explored
   - 可量化指标: 信息栏显示 Hidden=0, Explored=100（10x10 网格总和），无 Hidden 黑色区域
   - 可量化指标: 地形绿色棋盘格可以透过暗灰色滤镜可见
   - 可量化指标: 两个单位建筑以冻结（灰色半透明 alpha=0.5）状态渲染，不是实时彩色状态

3. **RevealMap 关闭后恢复先前状态**: 关闭 RevealMap 后地图恢复到开启前的状态，不是全部变回黑色。
   - 可量化指标: 先探索四角 → 开启 RevealMap → 关闭 RevealMap → 四角保持 Explored 状态
   - 可量化指标: 先前未探索的区域恢复为 Hidden（黑色），但不影响已探索区域
   - 可量化指标: 状态面板中"先前探索细胞"计数在关闭 RevealMap 后与开启前的 `baseState >= EXPLORED` 计数一致

4. **多次切换一致性**: RevealMap 可以反复开关而不丢失探索状态。
   - 可量化指标: 开启→关闭→开启→关闭 循环 3 次后，baseState 中探索过的 Cell 数量不变
   - 可量化指标: 每次开启都重新保存当前探索状态（覆盖旧的 previouslyExplored）

5. **有效状态正确性**: effectiveState() 在 RevealMap 开启时始终返回 EXPLORED，关闭时返回 baseState。
   - 可量化指标: 开启 RevealMap 后 effectiveState(5,5) = EXPLORED（即使 baseState[55] = HIDDEN）
   - 可量化指标: 关闭 RevealMap 后 effectiveState(5,5) 恢复为 HIDDEN

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/shroud/reveal-map/`
- 确认: 10x10 网格全部为黑色 Hidden 状态
- 确认环境信息栏显示 **"引擎: WebGL 2.0"**
- 确认 RevealMap 状态面板显示 "Disabled"

### 2. 步骤一: 探索部分区域

- 操作: 点击"探索四角"按钮
- 观察点:
  - 四个角落出现小型 Explored 区域（3x3），中心单元格为 Visible（透明可见绿色地形）
  - 地图主体仍为黑色 Hidden
- 预期: 信息栏显示部分 Hidden、部分 Explored、少量 Visible

- 操作: 记录信息栏中 Hidden/Explored/Visible 的数值

### 3. 步骤二: 开启 RevealMap

- 操作: 点击 "Reveal Map (开启)" 按钮（或按 R）
- 观察点:
  - 整个地图立即变为暗灰色 Explored
  - 之前黑色的 Hidden 区域消失，全部变为半透明暗灰色
  - 两个建筑（橙色在 3,3、蓝色在 6,6）以冻结灰色半透明状态出现
  - 信息栏: Hidden=0, Explored=100, Visible=0
- 预期: 全图可见地形，但无实时彩色单位（单位显示为冻结灰色半透明）
- 预期: 状态面板显示 "Enabled (全图Explored)"，先前探索细胞计数稳定不变

### 4. 步骤三: 关闭 RevealMap — 验证恢复

- 操作: 点击 "Reveal Map (关闭)" 按钮
- 观察点:
  - 地图恢复到步骤一的状态
  - 四个角落保持 Explored/Visible
  - 中间区域恢复为黑色 Hidden
  - 信息栏 Hidden/Explored/Visible 计数与步骤一中记录的数值一致
- 预期: **不是全黑**，先前探索的区域保留了——"先前探索细胞"计数与 baseState >= EXPLORED 的数目一致
- 预期: 单位在 Hidden 区域消失，在 Visible 区域以实时彩色状态显示

### 5. 步骤四: 切换 RevealMap + 探索新区域

- 操作: 先开启 RevealMap（全图灰暗），再关闭
- 操作: 点击"探索中心"按钮（圆形 Visible 区域 + Explored 环）
- 观察点:
  - 中心区域出现圆形 Visible（绿色可见）+ Explored 环
  - 四角仍然保持之前的探索状态（没有被覆盖）
- 操作: 开启 RevealMap → 关闭
- 观察点:
  - 中心圆形区域和四角区域都保持 Explored/Visible
  - 其他区域恢复 Hidden
- 预期: 多次探索和 RevealMap 切换后，所有历史探索过的区域都正确保留

### 6. 步骤五: 验证多次切换一致性

- 操作: 先点击"探索横条"（rows 3-6 Visible + rows 2,7 Explored）
- 操作: 重复以下操作 3 次: 开启 RevealMap → 关闭 RevealMap
- 观察点:
  - 每次关闭后横条区域保持 Visible/Explored
  - 横条之外的区域恢复 Hidden
  - "先前探索细胞"计数在每次切换中保持一致（每次开启时重新保存）

### 7. 边界/异常测试

- **边界 A - 全 Hidden 时开启**: 点击"重置全部Hidden"→ 开启 RevealMap → 关闭
  - 预期: 全 Hidden 恢复为全 Hidden（previouslyExplored 为空，关闭后全黑）
- **边界 B - 在 RevealMap 开启时探索**: 先开启 RevealMap，再点击"探索四角"
  - 预期: RevealMap 覆盖了所有视觉，但 baseState 仍被正确修改；关闭 RevealMap 后四角正确显示

### 8. 结果判定

- [x] 所有期望结果通过 → **ACCEPTED** (2026-07-02)
- [ ] 部分未通过 → 记录具体差异（附截图和环境信息栏数据），提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息，检查 WebGL 支持
