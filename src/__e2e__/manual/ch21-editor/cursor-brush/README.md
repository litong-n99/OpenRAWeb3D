# Editor Brush & Cursor -- Brush覆盖 / 路径绘制 人工验收

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-19
**对应模块**:
- `src/OpenRA.Mods.Common/Traits/World/EditorCursorLayer.ts` (475 lines, editor cursor grid overlay)
- `src/OpenRA.Mods.Common/Traits/World/TilingPathTool.ts` (907 lines, path planning tool with Bresenham supercover)

## 期望结果 (Expected Results)

1. **E1. Brush 覆盖 NxN cells 精确匹配**:
   - 1x1 brush 精确高亮 1 个 cell (`size² = 1`)
   - 3x3 brush 精确高亮 9 个 cells (`size² = 9`)
   - 5x5 brush 精确高亮 25 个 cells (`size² = 25`)
   - 可量化指标: `getHighlightedCells().length === brushSize * brushSize` (当光标不在边界时)
   - 可量化指标: 边界情况 (光标在 grid 边缘) — 超出 grid 的 cells 不渲染, `length <= size²`

2. **E2. 高亮颜色 = 蓝色 40% opacity**:
   - 默认 brush 高亮颜色为半透明蓝色 `rgba(64, 128, 255, 0.40)`
   - 可量化指标: R 通道 = 64 (±5), G 通道 = 128 (±5), B 通道 = 255 (±5)
   - 可量化指标: Alpha = 0.40 (±0.02), 透明度滑杆可调范围 10%-90%
   - 可量化指标: 蓝色高亮叠加在深色网格 (`#1a2a1a`) 上, 最终视觉颜色应明显不同于网格背景
   - 可量化指标: 路径高亮颜色为半透明橙色 `rgba(255, 180, 0, 0.55)`, Alpha 固定 0.55

3. **E3. 路径连接 start→end (Bresenham 超覆盖)**:
   - 路径使用 Bresenham supercover 算法 (匹配 `PathPlan.pointsWithRallyIndex()`)
   - 路径从起点到终点连续, 每对相邻 cells 为 8 方向连通 (共享边或角)
   - 可量化指标: 水平路径 `(0,0)→(5,0)` = 6 cells (含两端)
   - 可量化指标: 对角路径 `(0,0)→(4,4)` = 9 cells (Bresenham supercover 路径)
   - 可量化指标: 对角路径 `(0,0)→(3,4)` 的 cells 数量与 `(0,0)→(4,4)` 不同 (非正方形对角)
   - 可量化指标: 起点/终点重合 `(0,0)→(0,0)` = 1 cell (仅起点自身)

4. **E4. Tile 类型切换立即生效**:
   - 从下拉菜单或 Tile 选择面板切换 Tile 类型后, 状态面板在 `<100ms` 内更新
   - 可量化指标: 切换 Tile 后 `getSelectedTileType()` 立即返回新值 (同步变化)
   - 可量化指标: 点击 tile 面板中的色块 → 色块高亮 border 切换为 `#4a9` (绿色), 同时下拉菜单同步
   - 可量化指标: 不同 Tile 类型的颜色正确: Sand=`#e6c87a`, Rock=`#888888`, Grass=`#4caf50`, Water=`#42a5f5`, Road=`#666666`, Cliff=`#a0522d`

5. **E5. 不同 brush size 边界正确**:
   - 切换 brush size 后, 旧 size 区域外的 cells 不再高亮
   - 可量化指标: 从 5x5 切换到 3x3 → 高亮 cell 数量从 25 减少到 9
   - 可量化指标: 从 3x3 切换到 1x1 → 高亮 cell 数量从 9 减少到 1
   - 可量化指标: 5x5 brush 的边界距离中心 2 cells (半径=2), 3x3 距离中心 1 cell (半径=1)
   - 可量化指标: brush 中心在当前光标 cell, 奇数 brush (1,3,5) 始终有唯一中心 cell

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch21-editor/cursor-brush/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示 20x20 深色网格 (绿色网格线), 左侧有 Tile 选择面板
- 确认右上角显示期望结果面板 (E1-E5)

### 2. 步骤一: Brush 尺寸验证 (E1, E5)

- 操作: 鼠标悬停在 grid 中央 (约 cell 10,10), 默认 brush=5x5
- 观察点: 25 个 cells 高亮为蓝色半透明, 中心有白色十字准星
- 操作: 点击 "1x1" brush 按钮
- 观察点: 仅 1 个 cell 高亮 (光标所在 cell), 状态面板显示 "Brush尺寸: 1x1", "高亮Cells: 1"
- 操作: 移动鼠标到 grid 边缘 (cell 0,0)
- 观察点: brush 不超出 grid, 高亮 cells 数量可能小于 size² (被边界裁剪)
- 操作: 依次点击 "3x3" 和 "5x5"
- 观察点: 边界正确扩展, 5x5→25 cells, 3x3→9 cells, 旧区域外 cells 不再高亮
- 预期: ✅ E1 + E5 通过

### 3. 步骤二: 高亮颜色验证 (E2)

- 操作: 默认 brush 5x5 悬停 grid 中央
- 观察点: 蓝色高亮 `rgba(64, 128, 255, 0.40)`, 可以透过高亮看到网格线
- 操作: 拖动 "高亮透明度" 滑杆到 10%
- 观察点: 高亮非常淡, 几乎不可见
- 操作: 拖动到 90%
- 观察点: 高亮非常不透明, 几乎覆盖网格
- 操作: 拖动回 40%
- 观察点: 恢复默认效果
- 操作: 切换到路径模式, 设置起点和终点
- 观察点: 路径高亮为橙色 `rgba(255, 180, 0, 0.55)`, 起点为绿色 (S), 终点为红色 (E)
- 预期: ✅ E2 通过

### 4. 步骤三: Tile 选择面板 (E4)

- 操作: 在左侧 Tile 选择面板点击 "Grass (草地)" 行
- 观察点: Grass 色块出现绿色高亮边框 (`#4a9`), 状态面板 "当前Tile: Grass"
- 操作: 点击 "Water (水域)"
- 观察点: Water 色块高亮, 状态面板更新为 Water, 前一个 Grass 色块失去高亮
- 操作: 在顶部下拉菜单选择 "Road (道路)"
- 观察点: 下拉菜单和 Tile 面板同步 (Road 色块高亮), 状态面板显示 Road
- 操作: 在画笔模式下点击 grid 中央
- 观察点: 5x5 Brush 区域 cells 变为 Road 颜色 (`#666666` 半透明叠加)
- 操作: 切换为 "Sand", 再次点击
- 观察点: 新区域变为沙色 (`#e6c87a`)
- 预期: ✅ E4 通过

### 5. 步骤四: 路径绘制验证 (E3)

- 操作: 点击 "路径 (Path)" 模式按钮
- 观察点: 画笔高亮消失, 鼠标悬停处显示虚线框
- 操作: 点击 grid 位置 (2, 2) — 设置起点
- 观察点: 绿色圆形标记 "S" 出现在 (2,2), 状态面板 "起点: (2,2)"
- 操作: 点击 grid 位置 (7, 2) — 设置终点 (水平路径)
- 观察点: 橙色路径覆盖 cells (3,2),(4,2),(5,2),(6,2),(7,2), 红色标记 "E" 在 (7,2)
- 观察点: 状态面板 "路径Cells: 6" (含起终点)
- 操作: 点击 (2, 6) 设置新起点, 再点击 (6, 2) 设置终点 (对角路径)
- 观察点: 橙色路径使用 Bresenham 阶梯状连接 (8 方向)
- 观察点: 状态面板显示路径 cells 数量
- 操作: 点击同一个 cell 两次 (起点=终点)
- 观察点: "路径Cells: 1"
- 预期: ✅ E3 通过

### 6. 步骤五: Brush 放置 Tile (综合)

- 操作: 点击 "画笔 (Brush)" 模式按钮
- 操作: 选择 brush=3x3, Tile=Rock
- 操作: 在 grid 左上角 (1,1) 点击
- 观察点: 3x3 区域 (0-2, 0-2) 变为岩石色
- 操作: 选择 brush=1x1, Tile=Water
- 操作: 在 grid 右下角 (18,18) 点击
- 观察点: 仅 1 个 cell 变为水色
- 操作: 点击 "重置" 按钮
- 观察点: 所有放置的 tiles 清除, grid 恢复原始状态, brush 恢复 5x5 Sand, 路径清除
- 预期: ✅ 综合验证通过

### 7. 边界/异常测试

- **边界 A - Grid 边缘 brush**: 将光标移动到 grid 最边缘 cell (0,0), 使用 5x5 brush
  - 预期: ✅ 仅 grid 内的 cells 高亮 (2x2=4 cells 而非 5x5=25), 系统不崩溃

- **边界 B - 路径穿越 grid 对角**: 设置起点 (0,0) 终点 (19,19)
  - 预期: ✅ Bresenham 路径完整生成, 覆盖所有中间 cells, 连续无断裂

- **边界 C - 快速切换模式**: 在画笔模式和路径模式之间快速切换 5 次
  - 预期: ✅ 状态正确切换, 无残留高亮, 无闪烁

- **边界 D - 透明度极值**: 拖动透明度到 10% 和 90%
  - 预期: ✅ 10% 几乎不可见但 cells 仍存在; 90% 几乎不透明; 极端值不崩溃

- **边界 E - 窗口缩放**: 改变浏览器窗口大小, 从全屏缩小到 800x600
  - 预期: ✅ 网格和高亮随窗口重新缩放, cell 数量不变, 高亮位置正确

- **边界 F - __testHarness API**: 打开 DevTools Console, 执行:
  ```js
  // 验证 brush size
  __testHarness.setBrushSize(3)
  __testHarness.getHighlightedCells().length  // → 9 (指针在内部时)

  // 验证 tile 切换
  __testHarness.selectTileType('Water')
  __testHarness.getSelectedTileType()  // → 'Water'

  // 验证路径
  __testHarness.setPathStart({x:0, z:0})
  __testHarness.setPathEnd({x:5, z:5})
  __testHarness.getPathCells().length  // → Bresenham cells count

  // 验证重置
  __testHarness.reset()
  __testHarness.getBrushSize()  // → 5
  __testHarness.getSelectedTileType()  // → 'Sand'
  ```
  - 预期: ✅ 所有 API 返回值与预期一致

### 8. 结果判定

- [ ] E1 Brush 覆盖 NxN cells 精确匹配 → **PASS / FAIL**
- [ ] E2 高亮颜色蓝 40% opacity → **PASS / FAIL**
- [ ] E3 路径 Bresenham 超覆盖连接 → **PASS / FAIL**
- [ ] E4 Tile 类型切换立即生效 → **PASS / FAIL**
- [ ] E5 Brush size 边界正确 → **PASS / FAIL**
- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据), 提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息, 检查 WebGL 支持

---

## __testHarness API Reference

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `setBrushSize(n)` | `n: number` | `void` | 设置 brush 尺寸为 NxN (奇数 1-21) |
| `selectTileType(id)` | `id: string` | `void` | 选择 tile 类型 (Sand/Rock/Grass/Water/Road/Cliff) |
| `setPathStart(cell)` | `{x: number, z: number}` | `void` | 设置路径起点 |
| `setPathEnd(cell)` | `{x: number, z: number}` | `void` | 设置路径终点并计算 Bresenham 路径 |
| `getHighlightedCells()` | — | `Array<{x,z}>` | 当前高亮的 cells (brush 或 path 模式) |
| `getPathCells()` | — | `Array<{x,z}>` | 路径 cells (Bresenham supercover) |
| `reset()` | — | `void` | 重置所有状态 |
| `getBrushSize()` | — | `number` | 当前 brush size |
| `getSelectedTileType()` | — | `string` | 当前选中的 tile 类型 ID |
| `getCursorCell()` | — | `{x,z} \| null` | 当前鼠标所在 cell |
| `getPathStart()` | — | `{x,z} \| null` | 路径起点 |
| `getPathEnd()` | — | `{x,z} \| null` | 路径终点 |
| `isPathMode()` | — | `boolean` | 是否在路径模式 |
| `getGridCells()` | — | `number` | Grid 尺寸 (20) |
| `getPlacedTiles()` | — | `Map<string, string>` | 已放置的 tiles (key="x,z", value=color) |
| `getHighlightOpacity()` | — | `number` | 当前高亮透明度百分比 |
| `setHighlightOpacity(pct)` | `pct: number` | `void` | 设置高亮透明度 (10-90) |
