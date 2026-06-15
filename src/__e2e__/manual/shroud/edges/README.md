# Shroud — Edge Blending Visual Test

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-15
**对应模块**: `src/OpenRA.Mods.Common/Traits/World/ShroudRenderer.ts` (TODO-12.A.2 `_getEdges`, `_getCellEdges`)

## 期望结果 (Expected Results)

1. **边缘混合渐变**: 相邻 Cell 状态不同时，边界处渲染 4px 渐变过渡条带。
   - Visible↔Explored 边界: 从 `rgba(0,0,0,0)` 到 `rgba(15,15,15,0.55)` 的 4px 渐变
   - Explored↔Hidden 边界: 从 `rgba(15,15,15,0.55)` 到 `rgba(0,0,0,1.0)` 的 4px 渐变
   - Visible↔Hidden 直接边界: 从 `rgba(0,0,0,0)` 到 `rgba(0,0,0,1.0)` 的 4px 渐变
   - 可量化指标: 渐变宽度严格为 4px（CELL_PX=50 时可见为细条带），方向与实际边界正交

2. **全可见内部无边缘**: 被相同状态邻居包围的 Cell 在 overlay 上完全无边缘特效。
   - 可量化指标: 孤岛模式中心 4x4 Visible 区域的内部 Cell 在 inspector 中显示 `shroudEdges = 0x00 (None)`，角邻居栏显示 `全同状态(无边缘)`
   - 可量化指标: 棋盘格模式下每个 Cell 的 4 个对角方向均有边缘标记（因为交替状态）

3. **8方向 Edges 位掩码正确性**: 边缘检测使用 OpenRA 的 `Edges` 枚举（TopLeft=0x01, TopRight=0x02, BottomRight=0x04, BottomLeft=0x08）。
   - 可量化指标: 鼠标悬停时 inspector 显示的 edge flags 必须与 8 邻居状态手工检查一致
   - 可量化指标: 当 Cell 的 TopLeft、Left 邻居均为不同状态时，edges=0x89 (LeftSide|BottomLeft|TopLeft)
   - 可量化指标: 黄色边缘标记线精确绘制在对应角落位置（如 TopLeft 边缘在左上角，BottomRight 边缘在右下角）

4. **动态更新**: 扩张/收缩操作后边缘图案即时更新。
   - 可量化指标: 点击"扩张"按钮后 overlay texture 在 <50ms 内完成重绘（144 个 Cell + 边缘渐变）
   - 可量化指标: 连续扩张时 FPS 保持 >55，无撕裂或闪烁

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/shroud/edges/`
- 确认环境信息栏显示 **"引擎: WebGL 2.0"**
- 页面加载后显示"孤岛模式"预设（中心 Visible 岛 + Explored 环 + Hidden 外围）

### 2. 步骤一: 边缘混合验证（孤岛模式）

- 操作: 确认当前为孤岛模式（如不是，点击"孤岛模式"按钮）
- 使用滚轮缩放至近距离（每个 Cell 约 50px 在屏幕上可见）
- 观察点:
  - 中心 Visible 区域（4x4 绿色透明）与 Explored 环之间的边界 → 应该看到 4px 渐变条带
  - Explored 环与 Hidden 外围之间的边界 → 应该看到 4px 渐变条带
  - 中心 Visible 区域内相邻 Cell 之间 → 应该无渐变条带
- 预期: 边界渐变清晰，内部无边缘

### 3. 步骤二: 8方向边缘指示线验证

- 操作: 在孤岛模式中，将鼠标悬停在 Visible 区域边缘的 Cell 上
- 观察点:
  - 右下角 inspector 面板显示当前 Cell 坐标、状态和 edge flags
  - 如果 Cell 在 Visible 区域左上角，其 TopLeft 邻居（Explored 状态）产生 TopLeft 边缘
  - 黄色边缘指示线应精确显示在对应角落
- 预期: edge flags 值与手工检查 8 邻居一致；黄色指示线位置正确

### 4. 步骤三: 棋盘格模式验证

- 操作: 点击"棋盘格模式"按钮
- 观察点:
  - 每个 Visible Cell 的 4 个对角方向均有边缘线（因为对角邻居是 Explored）
  - 每个 Explored Cell 的 4 个对角方向也均有边缘线
  - 相邻 Visible 与 Explored Cell 之间可见渐变条带
- 预期: 棋盘格模式中所有 Cell 的边缘线密度最高，无遗漏方向

### 5. 步骤四: 对角斜坡模式验证

- 操作: 点击"对角斜坡"按钮
- 观察点:
  - 从左上到右下依次排列 Visible / Explored / Hidden 三态
  - 状态分界线呈对角走向
  - 两种边界（Vis↔Exp 和 Exp↔Hid）均可见渐变条带
- 预期: 对角边界无间断，渐变方向与边界正交

### 6. 步骤五: 动态更新

- 操作: 点击"孤岛模式"回到已知状态
- 操作: 连续点击"扩张可见区域"按钮 5 次
- 观察点:
  - 每次点击后 Visible 区域扩大一圈，边缘图案即时更新
  - overlay 无闪烁、无残影
  - 信息栏中 Hidden/Explored/Visible 计数随之变化
- 预期: 扩张无延迟感，边缘线随区域扩大正确移动

- 操作: 连续点击"收缩可见区域"按钮 5 次
- 观察点:
  - 外围 EXPLORED 变回 HIDDEN，VISIBLE 降级为 EXPLORED
  - 边缘线同步更新
- 预期: 收缩与扩张对称，状态降级正确

### 7. 边界/异常测试

- **边界 A - 全 Hide 后 Checkerboard**: 先全部 Hidden，再切换棋盘格 → 预期: 所有 Cell 从全黑瞬间变为 Visible/Explored 交替
- **边界 B - 极端视角俯视**: 将摄像机旋转至正上方俯视 → 预期: 纹理正常显示，无透视摩尔纹
- **边界 C - 多步扩张**: 步数设为 5，一次点击扩张 5 圈 → 预期: 大范围更新流畅，FPS > 50

### 8. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异（附截图和环境信息栏数据），提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息，检查 WebGL 支持
