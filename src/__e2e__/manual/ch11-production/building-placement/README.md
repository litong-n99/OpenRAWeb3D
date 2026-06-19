# Building Placement — Acceptance Test

**Module**: PlaceBuilding + BuildingUtils (Chapter 11 Production & Building)
**Test Case ID**: `ch11-production/building-placement`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Player/PlaceBuilding.cs`, `OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.cs`, `OpenRA.Mods.Common/Traits/Buildings/Building.cs`
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Player/PlaceBuilding.ts`, `src/OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.ts`, `src/OpenRA.Mods.Common/Traits/Buildings/Building.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果 (Expected Results)

### E1. Ghost 半透明预览跟随鼠标

**上下文**: 建筑放置前，应在鼠标悬停位置显示半透明 ghost 预览，直观展示建筑将占据的区域。Ghost 应跟随鼠标实时移动，无可见延迟（< 2 帧）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E1.1 | Ghost 覆盖层透明度 alpha = 0.50 | `getGhostInfo().alpha === 0.50`，容差 ±0.02 |
| E1.2 | Ghost 跟随鼠标实时移动 | 移动鼠标时 ghost 位置立即更新（< 2 帧），无可见拖尾 |
| E1.3 | 鼠标移出可玩区域时 ghost 隐藏 | `getGhostInfo().visible === false` |
| E1.4 | Ghost 的大小等于建筑 footprint 尺寸 × CELL_SIZE | 发电厂 ghost = 2x2 wu，炮塔 ghost = 1x1 wu |

### E2. Footprint 单元格与 Building 定义精确匹配

**上下文**: 建筑放置的每个 footprint 单元格必须与 `BuildingInfo.footprint` 的定义完全一致。不同单元格类型（Occupied='x', OccupiedPassable='=', Empty='_'）应有不同的视觉表现。

坐标约定: footprint 字符串为行优先 (row-major)，第一行为顶部 (Y=0)，从左到右为 X 递增。例如 "xx=x" 表示 2x2 footprint: (0,0)='x', (1,0)='x', (0,1)='=', (1,1)='x'。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E2.1 | 发电厂 (2x2, "xxxx") 有 4 个 Occupied 单元格 | `getFootprintCells().length === 4`，全部 `type === 'occupied'` |
| E2.2 | 兵营 (2x2, "xx=x") 有 3 个 Occupied + 1 个 Passable | `getFootprintCells()` 返回 3 occupied + 1 passable |
| E2.3 | 炮塔 (1x1, "x") 有 1 个 Occupied 单元格 | `getFootprintCells().length === 1`，`type === 'occupied'` |
| E2.4 | OccupiedPassable 单元格显示为蓝色 (#4040C8) | `getCellColor(passableCell)` 返回 `{r:0.25, g:0.25, b:0.55}` ±5% |
| E2.5 | Empty 单元格在 `getFootprintCells()` 结果中以 `type === 'empty'` 出现 | 遍历结果数组，包含所有 footprint 单元格（含 empty 类型） |

### E3. 有效/无效放置颜色区分

**上下文**: 建筑放置到有效位置时显示绿色高亮，无效位置时显示红色高亮。颜色必须使用精确的 RGB 值以确保视觉一致性。有效性由 BuildingUtils 逻辑决定：地图边界内、无占用冲突、地形类型匹配。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E3.1 | 有效放置时 ghost 颜色为 (0.13, 0.55, 0.13) | `getGhostInfo().color` 的 R=0.13±5%, G=0.55±5%, B=0.13±5% |
| E3.2 | 无效放置时 ghost 颜色为 (0.76, 0.14, 0.14) | `getGhostInfo().color` 的 R=0.76±5%, G=0.14±5%, B=0.14±5% |
| E3.3 | 空地 (无障碍、无占用) 判定为有效 | `__testHarness.moveCursorToCell({x:2,y:2})` 后 `canPlace() === true` |
| E3.4 | 障碍物占据单元格判定为无效 | `__testHarness.moveCursorToCell({x:4,y:4})` 后 `canPlace() === false` |
| E3.5 | 越界 (OOB) 判定为无效，ghost 隐藏 | `__testHarness.moveCursorToCell({x:0,y:0})` 后 `canPlace() === false` |
| E3.6 | 水域单元格对建筑判定为无效 (terrainTypes 不匹配) | `__testHarness.moveCursorToCell({x:8,y:3})` 后 `canPlace() === false` |
| E3.7 | 已有建筑占用的单元格判定为无效 | 先放置建筑，再在同一位置检测 → `canPlace() === false` |

### E4. Grid Snap 对齐到 Cell Center

**上下文**: 建筑放置后必须精确对齐到格子中心，偏差不得超过 0.1 世界单位。这是 RTS 游戏网格对齐的基本要求，确保所有建筑排列整齐。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E4.1 | 放置后建筑中心与 cell center 偏差 < 0.1 wu | `|ghostPos - cellCenter| < 0.1` 世界单位 |
| E4.2 | 1x1 建筑中心精确对齐单元中心 | 无偏移 (偏差 = 0.0000 wu) |
| E4.3 | 2x2 建筑几何中心在 4 个 cell 交界处 | 偏移量 = (0.5, 0, 0.5) wu，对齐到子单元精度 |

### E5. 旋转循环 4 个方向

**上下文**: 建筑放置时可通过热键 (R) 或按钮旋转方向。每次旋转 90° 顺时针，循环 4 个方向: 0° → 90° → 180° → 270° → 0°。旋转后 footprint 尺寸相应交换（W 和 H 互换）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E5.1 | 初始旋转为 0° | `getRotation() === 0` |
| E5.2 | 调用 `rotateBuilding()` 后旋转 +90° | 返回 90 |
| E5.3 | 调用 4 次 `rotateBuilding()` 后回到 0° | 第 4 次调用返回 0 |
| E5.4 | 90°/270° 时 footprint 尺寸 W 和 H 互换 | 发电厂 (2x2) 旋转 90° 后仍为 2x2；2x3 建筑会变为 3x2 |
| E5.5 | 旋转后放置的建筑保持该旋转方向 | `getPlacedBuildings()[0].rotation === 当前旋转角` |
| E5.6 | 旋转不改变 footprint 单元格类型 (occupied 仍为 occupied) | 旋转后每个 offset 对应的 footprint char 保持不变 |

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch11-production/building-placement/`
- 确认环境信息栏显示 "WebGL 2.0" 引擎
- 设置屏幕分辨率为 1920×1080 (1x 缩放，如使用 HiDPI 显示器)
- 确认页面布局: 左侧控制面板 + 中央 3D 视口 + 右侧诊断面板
- 确认 12x12 格网可见，中间 10x10 为可玩区域 (深色)，外围为 OOB (棕色)
- 确认灰色圆柱体 = 障碍物，蓝色方块 = 水域

### 2. 步骤一: Ghost 半透明预览 (E1)

- 在视口中移动鼠标到格子 (2, 2) — 空白区域
- 观察: 应出现绿色半透明覆盖层，覆盖 2x2 区域 (发电厂默认选择)
- 预期: E1.1 — ghost alpha 约 50%，可以透过 ghost 看到下方网格线
- 移动鼠标到格子 (5, 5) — 障碍物区域
- 观察: ghost 应变为红色
- 预期: E1.3 — ghost 跟随鼠标实时移动，无延迟感
- 移动鼠标到边缘外 OOB 区域 (0, 0)
- 预期: E1.4 — ghost 隐藏，右侧面板显示 "越界 (OOB)"

### 3. 步骤二: Footprint 精确匹配 (E2)

- 确保选中「发电厂」按钮 (高亮)
- 将鼠标移到格子 (2, 2)
- 观察右侧「Footprint 诊断」面板
- 预期: E2.1 — 显示 4 个绿色 'x' 格，2x2 布局
- 点击「兵营」按钮
- 将鼠标移到格子 (2, 2)
- 观察 footprint 诊断
- 预期: E2.2 — 显示 3 个 'x' + 1 个蓝色 '=' (passable cell 在坐标 (2,3) 即第 2 行第 1 列)
- 点击「防御炮塔」按钮
- 将鼠标移到格子 (2, 2)
- 预期: E2.3 — 显示单个 1x1 绿色 'x' 格
- 检查「Footprint 单元格列表」: 应列出所有非 empty 单元格及其类型和状态

### 4. 步骤三: 有效/无效颜色 (E3)

- 选中「发电厂」
- 移动到 (2, 2) — 空地
- 预期: E3.1/E3.3 — ghost 为绿色，右侧面板显示 `Ghost 颜色: R=0.13 G=0.55 B=0.13`，放置状态: "有效 (绿色)"
- 移动到 (4, 4) — 障碍物
- 预期: E3.2/E3.4 — ghost 为红色，右侧面板显示 `Ghost 颜色: R=0.76 G=0.14 B=0.14`，放置状态: "无效 (红色)"
- 移动到 (8, 3) — 水域
- 预期: E3.6 — placement 无效 (红色)
- 在 (2, 2) 点击放置一个发电厂
- 移动鼠标回到 (2, 2)
- 预期: E3.7 — 已占用区域显示为红色，canPlace = false

### 5. 步骤四: Grid Snap 对齐 (E4)

- 重置场景 (点击「重置所有」)
- 选中「炮塔」(1x1)
- 在格子 (5, 5) 点击放置
- 检查右侧面板「Snap 偏移」
- 预期: E4.2 — 偏移 < 0.005 wu (实际上是 0.0000，因为中心精确计算)
- 选中「发电厂」(2x2)
- 在格子 (7, 2) 点击放置
- 预期: E4.3 — 偏移 < 0.01 wu
- 视觉检查: 建筑是否整齐排列在格子内

### 6. 步骤五: 旋转循环 (E5)

- 选中「发电厂」
- 确认右侧面板显示 "旋转角度: 0°"
- 预期: E5.1 — 初始旋转为 0°
- 点击「旋转建筑方向」按钮 1 次
- 预期: E5.2 — 旋转角度变为 90°
- 再点击 3 次
- 预期: E5.3 — 旋转角度回到 0° (共 4 次回到原位)
- 旋转到 90°，将鼠标移到 (5, 2)，footprint 诊断应仍显示 2x2
- 预期: E5.4 — 2x2 对称建筑旋转后尺寸不变
- 在 (5, 2) 点击放置建筑 (旋转 90°)
- 查看右侧面板「已放置建筑数」及 footprint 诊断
- 预期: E5.5 — 放置的建筑记录 rotation=90
- 按 R 键旋转
- 预期: R 快捷键等效于按钮点击，旋转角度更新

### 7. 边界/异常测试

- **边界放置**: 移动鼠标到可玩区域边缘 (1, 1)，选择发电厂，确认 footprint 不超出可玩区域 → 绿色有效
- **边缘越界**: 移动鼠标到 (9, 9)，选择发电厂 (2x2)，footprint 超出可玩区域 (10 列仅到 index 10) → 红色无效 (部分 cell OOB)
- **多建筑共存**: 在 (2,2)、(5,2)、(8,2) 各放置一个炮塔 → 3 个建筑均显示，每个有独立的 footprint 指示
- **快速切换**: 快速按 1/2/3 数字键切换建筑类型 → ghost 尺寸和 footprint 立即更新，无闪烁
- **窗口缩放**: 调整浏览器窗口大小 → canvas 自适应，视口比例保持，网格不变形

### 8. 结果判定

- [ ] E1 (Ghost 半透明预览): Ghost alpha=0.50, 跟随鼠标, OOB 时隐藏
- [ ] E2 (Footprint 精确匹配): 3 种建筑 footprint 与定义完全一致
- [ ] E3 (有效/无效颜色): 绿色(0.13,0.55,0.13) vs 红色(0.76,0.14,0.14)
- [ ] E4 (Grid Snap): 偏差 < 0.1 wu
- [ ] E5 (旋转循环): 4 方向旋转, footprint 变换正确
- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异，提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息

---

## 技术说明

### 坐标系统

- World space: X = east-west, Y = height (up), Z = north-south
- Cell grid: (cx, cy) 对应 2D 地图格子，cx 向东递增，cy 向南递增
- Cell center: (cx + 0.5, 0, cy + 0.5) 世界单位
- CELL_SIZE = 1.0 世界单位

### Footprint 字符串格式

遵循 OpenRA BuildingInfo 约定:
- 行优先 (row-major): 第一行 = footprint[0..W-1], 第二行 = footprint[W..2W-1], ...
- 字符含义: 'x' = Occupied, '=' = OccupiedPassable, '_' = Empty
- 例如 "xx=x" (2x2): 第一行 "xx" (Y=0), 第二行 "=x" (Y=1)

### 旋转公式

旋转 90° 顺时针时，原始坐标 (dx, dy) 在新坐标系中的位置:
- 90°: new_dx = dy, new_dy = W - 1 - dx (W 和 H 互换)
- 180°: new_dx = W - 1 - dx, new_dy = H - 1 - dy
- 270°: new_dx = H - 1 - dy, new_dy = dx

### 测试 Harness

全局 `window.__testHarness` 暴露以下方法:
- `selectBuilding(type)` — 选择建筑类型
- `moveCursorToCell({x, y})` — 移动光标到指定格子
- `canPlace()` — 检查当前悬停格是否可放置
- `getCellColor({x, y})` — 获取指定 footprint 格的颜色
- `rotateBuilding()` — 旋转建筑
- `getFootprintCells()` — 获取所有 footprint 格信息
- `getGhostInfo()` — 获取 ghost 预览状态
- `getPlacedBuildings()` — 获取已放置建筑列表
- `placeAt(type, {x, y}, rotation?)` — 程序化放置建筑
- `getRotation()` / `getBuildingType()` — 获取当前状态
- `getGridSize()` — 获取格网尺寸
- `isObstacle(cx, cy)` — 检查障碍物
- `reset()` — 重置场景
