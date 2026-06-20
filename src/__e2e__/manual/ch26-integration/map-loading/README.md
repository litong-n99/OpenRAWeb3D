# Ch26 Map Loading & Actor Spawning — Acceptance Test

> **人工验收测试页**
> 模块: Ch26 Phase A — Map Loading, Actor Spawning, Player Creation, World Initialization
> 测试ID: `ch26-integration/map-loading`
> OpenRA 对照: `Map.ts` + `TraitFactory.ts` + `World.ts` (`_createPlayers`, `loadComplete`)
> 创建日期: 2026-06-20

---

## 对应模块

| 文件 | 功能 | 验证点 |
|------|------|--------|
| `Map.ts` | Map binary data parsed → terrain mesh generated | TerrainMeshBuilder 生成的网格几何 |
| `TraitFactory.ts` | `createActor()` from map entries with traits | Actor 在正确位置/朝向/颜色 |
| `World.ts` | `_createPlayers()` + `loadComplete()` | Player 创建 + trait 初始化顺序 |

## 测试目标

验证 Ch26 Phase A 的地图加载和 Actor 生成管线在 3D 场景中正确运作:

1. **Terrain Rendering**: 地形平面应正确渲染 map 尺寸（16x16 cells），带有网格参考线
2. **Actor Spawning Visualization**: 6 个不同 actor 类型（MCV、Infantry、PowerPlant、Barracks）在正确的 cell 坐标渲染
3. **Player Color Coding**: Player 1 单位显示为红色，Player 2 单位显示为蓝色
4. **Information Panel**: 侧边栏正确显示 actor 数量、玩家数量、地图元数据
5. **Camera Interaction**: ArcRotateCamera 可自由旋转/缩放/平移

---

## B. 期望结果（可量化验收标准）

### 期望 1: Terrain Grid Visible with Correct Dimensions

**观察点**:
- 大型绿色地面平面（16x16 单元格网格，每个单元格 0.8 世界单位，总面积 12.8x12.8 单位）
- 每个 cell 之间的网格线可见（颜色约 #2D4024，深绿灰色）
- 棋盘格装饰图案（交替亮/暗绿的 cell 表面平面）可见，增强 cell 区分度
- 深色边框环绕地形，清晰界定地图边界
- 原点处有十字标标记 cell (0,0)，X 轴（红色）和 Z 轴（蓝色）参考线

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 网格尺寸 | 地面面覆盖 16x16 可见单元格 | 网格线对齐 |
| 单元格尺寸 | 每个 cell 约 0.8 世界单位 | 参考网格间距 |
| 网格线颜色 | 约 #2D4024 (0.18, 0.25, 0.14)，与地形绿有明显对比 | 肉眼可分辨 |
| 棋盘格模式 | 所有 256 个 cell 均有装饰平面；交替色调绿色（偶数和位置亮: #3D5E30, 奇数和位置暗: #33542B），两色均清晰可见 | 肉眼可分辨 |
| 地图边界 | 深色（#15171C）边框在地形外延伸 2 单位 | 清晰边界 |
| 原点标记 | 十字标 + 坐标轴参考线位于 cell (0,0) | 标记正确 |

### 期望 2: 6+ Actors Visible at Distinct Positions and Colors

**观察点**:
- 总共 6 个带颜色的方块 + 支柱 + 标签，分散在地图上
- 3 个 Player 1 (Red) 单位：MCV、Infantry、PowerPlant
- 3 个 Player 2 (Blue) 单位：MCV、Infantry、Barracks
- 每个 actor 类型有不同的尺寸比例（MCV 粗壮，Infantry 细长，建筑宽阔）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 总数 | 精确 6 个彩色方块 + 6 个支柱 + 6 个悬浮标签 | 肉眼计数 |
| P1-MCV | 红色方块位于 cell (3,3)，尺寸 0.9x0.6x0.9 | 位置/尺寸正确 |
| P1-Infantry | 红色方块位于 cell (5,1)，尺寸 0.35x0.55x0.35（较瘦小） | 位置/尺寸正确 |
| P1-PowerPlant | 红色方块位于 cell (1,5)，尺寸 1.0x0.5x0.8（较宽大） | 位置/尺寸正确 |
| P2-MCV | 蓝色方块位于 cell (12,12)，尺寸 0.9x0.6x0.9 | 位置/尺寸正确 |
| P2-Infantry | 蓝色方块位于 cell (14,10)，尺寸 0.35x0.55x0.35 | 位置/尺寸正确 |
| P2-Barracks | 蓝色方块位于 cell (10,14)，尺寸 1.0x0.5x0.7 | 位置/尺寸正确 |
| 颜色纯度 | P1 红色 #E02E2E (0.88, 0.18, 0.18)，P2 蓝色 #2D59E0 (0.18, 0.35, 0.88) | C3/C4 面板标注 |

### 期望 3: Player Color Coding — Visual Distinction

**观察点**:
- 在摄像机任何角度下，Player 1 和 Player 2 单位的颜色应**清晰可辨**
- 红色和蓝色之间的颜色对比度足够高（色相差约 180 度）
- 支柱（连接方块到地面的圆柱）颜色是主色的 50% 亮度版本
- 标签 billboard 颜色与对应 Player 颜色一致

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| P1 vs P2 区分度 | 任何视角下红色和蓝色方块可一眼区分 | 无歧义 |
| 支柱颜色 | P1 支柱 ~#701212, P2 支柱 ~#172C5C | 与主色协调 |
| 标签颜色 | P1 标签 ~#F25959, P2 标签 ~#598CF2 | 与主色对应 |
| 无颜色串扰 | 红色单位上没有蓝色调成分，反之亦然 | 颜色纯净 |

### 期望 4: Info Panel Shows Correct Actor Count and Map Metadata

**观察点**:
- 控制面板 C2 显示地图元数据（名称 "Test Map (16x16)"，尺寸 "16 x 16 cells"，地形 "Clear (100%)"，玩家数 "2"）
- Actor 总数显示为 "6"
- C3 面板列出所有 Player 1 单位及其 cell 坐标
- C4 面板列出所有 Player 2 单位及其 cell 坐标

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| C2 地图名称 | "Test Map (16x16)" | 文本匹配 |
| C2 地图尺寸 | "16 x 16 cells" | 文本匹配 |
| C2 玩家数 | "2" | 文本匹配 |
| C2 Actor 总数 | "6" (未高亮时为 "6 (All visible)") | 数字正确 |
| C3 P1 单位 | 3 条目通过 main.ts 动态填充: MCV cell(3,3) world(2.80, 0.45, 2.80), Infantry cell(5,1) world(4.40, 0.35, 1.20), PowerPlant cell(1,5) world(1.20, 0.40, 4.40) | 坐标/世界位匹配 |
| C4 P2 单位 | 3 条目通过 main.ts 动态填充: MCV cell(12,12) world(10.00, 0.45, 10.00), Infantry cell(14,10) world(11.60, 0.35, 8.40), Barracks cell(10,14) world(8.40, 0.40, 11.60) | 坐标/世界位匹配 |

### 期望 5: Camera Orbitable Around the Scene

**观察点**:
- 鼠标左键拖拽旋转摄像机场景
- 鼠标滚轮缩放（拉近/拉远）
- 鼠标右键拖拽平移
- 摄像机始终看向地图中心（8 cells * 0.8 = 6.4, 0, 6.4）
- 缩放范围限制在 6-45 世界单位半径内
- 俯仰角限制在约 8.6 度（minimum）到约 85 度（maximum）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 旋转 | 拖拽左键平滑旋转（无跳变） | FPS 稳定 |
| 缩放 | 滚轮缩放，最小半径 6 单位（近），最大 45 单位（远） | 极限处停止 |
| 平移 | 右键拖拽平移（目标点移动） | 无弹跳 |
| 初始视角 | 从地图中心右前方约 45 度，仰角约 51 度 | 复位按钮恢复此视角 |
| 复位按钮 | 点击 "复位摄像机" → 恢复初始视角 | 即时恢复 |

### 期望 6: Player Highlight Mode

**操作**: 点击 "高亮 Player 1 (Red) 单位" 按钮。

**观察点**:
- Player 1（红色）单位产生明显的自发光光晕（emissiveColor 从 0 变为 0.35）
- Player 2（蓝色）单位的自发光降至几乎不可见（0.02）
- 点击 "高亮 Player 2 (Blue) 单位" → P2 高亮，P1 暗淡
- 点击 "显示全部单位" → 所有单位恢复正常（无自发光）
- 高亮效果即时切换（< 1 帧延迟）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| P1 高亮 | P1 单位 emissive=0.35，P2 单位 emissive=0.02 | 肉眼可辨 |
| P2 高亮 | P2 单位 emissive=0.35，P1 单位 emissive=0.02 | 肉眼可辨 |
| 全显示 | 所有单位 emissive=0 | 正常外观 |
| 切换延迟 | < 1 帧 (~16ms) | 肉眼即时 |

---

## 验证步骤

### 准备工作

1. 启动 dev server: `npm run dev`
2. 打开测试页面: `http://localhost:5173/test/ch26-integration/map-loading/`
3. 确认环境信息栏显示 WebGL 2.0 引擎
4. 确认页面加载后可见大绿色网格地面 + 6 个彩色方块

### 步骤一: 验证地形渲染（期望 1）

- 观察绿色地面区域：应看到 16x16 的网格线
- 数网格线：水平方向应有 17 条（0-16），垂直方向应有 17 条（0-16）
- 确认棋盘格图案（256 个 cell 表面，交替亮绿 #3D5E30 和暗绿 #33542B 两色，无遗漏 cell）
- 确认深色边框环绕地形
- 确认原点 (0,0) 处有十字标
- 确认 X 轴（红色）和 Z 轴（蓝色）参考线
- 预期: ✅ 地形网格尺寸正确 16x16，网格线清晰，原点标记正确

### 步骤二: 验证 Actor 位置和颜色（期望 2 + 3）

- 确认 6 个方块都可见（3 红 + 3 蓝）
- 在 cell (3,3) 处确认红色 MCV（粗壮方块）
- 在 cell (5,1) 处确认红色 Infantry（瘦小方块）
- 在 cell (1,5) 处确认红色 PowerPlant（宽大方块）
- 在 cell (12,12) 处确认蓝色 MCV
- 在 cell (14,10) 处确认蓝色 Infantry
- 在 cell (10,14) 处确认蓝色 Barracks
- 确认每个方块下方有圆柱支柱，上方有悬浮标签
- 预期: ✅ 所有 6 个 Actor 在正确位置、正确颜色

### 步骤三: 验证信息面板（期望 4）

- 检查 C2 面板："地图名称" = "Test Map (16x16)"
- 检查 "地图尺寸" = "16 x 16 cells"
- 检查 "玩家数量" = "2"
- 检查 "Actor 总数" = "6 (All visible)"
- 检查 C3 面板：3 个红色单位列表，显示格式 `cell(col,row) world(x, y, z)`，数值来自 main.ts 动态计算
- 检查 C4 面板：3 个蓝色单位列表，显示格式 `cell(col,row) world(x, y, z)`，数值来自 main.ts 动态计算
- Y 值应为各 actor 的 offsetY（0.35-0.45），不应为 0
- 预期: ✅ 面板信息完全匹配场景实际世界坐标

### 步骤四: 验证摄像机交互（期望 5）

- 鼠标左键拖拽旋转：场景应平滑旋转
- 鼠标滚轮缩放：拉近到最小 6 单位，拉远到最大 45 单位
- 鼠标右键拖拽平移：地图中心可移动
- 旋转到极端角度确认无掉帧
- 点击 "复位摄像机" 按钮：视角恢复初始状态
- 预期: ✅ 摄像机操作流畅，复位工作正常

### 步骤五: 验证 Player Highlight（期望 6）

- 点击 "高亮 Player 1 (Red) 单位" → 红色单位发出光晕，蓝色变暗
- 点击 "高亮 Player 2 (Blue) 单位" → 蓝色单位发出光晕，红色变暗
- 点击 "显示全部单位" → 所有单位恢复正常
- 反复切换 5 次确认无闪烁或状态混乱
- 预期: ✅ 高亮切换即时，颜色正确

### 边界/异常测试

- **极端缩放**: 滚轮缩放到最小半径 6 单位 → 不应穿透地形；缩放到最大 45 单位 → 所有单位仍可见
- **快速切换高亮**: 连续点击 P1/P2/All 按钮 10 次 → 最终状态与最后点击一致
- **F5 刷新**: 刷新浏览器 → 页面恢复正常初始状态（全显示，初始摄像机角度）
- **Tab 切换**: 打开其他浏览器标签页再切回 → 场景状态保持不变
- **坐标验证**: 用网格线交叉点验证 cell 坐标 — cell (3,3) 处的红色 MCV 应位于第 3 列第 3 行网格线的交叉区域内

### 结果判定

- [ ] 所有 6 项期望通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异和截图，提交 issue
- [ ] 测试环境异常 → 记录 UA / 视口 / 引擎 / FPS 信息

---

## 技术备注

### 地图加载管线 (Phase A 模拟)

```
Map binary file (.oramap)
  │
  ├── MapBinParser.parse()
  │     ├── mapHeader (width, height, tileset, players)
  │     ├── terrainTiles[] → cell grid data
  │     └── actorEntries[] → spawn position + owner + actor type
  │
  ├── TerrainMeshBuilder.build(scene, mapData)
  │     ├── Create ground plane (width x height)
  │     ├── Apply cell textures per tile type
  │     └── Generate edge ramps (CellRamp data)
  │
  ├── TraitFactory.createActor(actorEntry)
  │     ├── Lookup actor prototype by type name
  │     ├── Instantiate traits from prototype
  │     └── Attach 3D mesh + position
  │
  └── World._createPlayers(mapPlayers)
        ├── Create Player instances
        ├── Assign owner colors
        └── World.loadComplete() → fire Created traits in order
```

### Actor Position Mapping

本测试页面使用的 cell 坐标到世界坐标映射:

```
cellToWorld(col, row) → world(cellSize * col + cellSize/2, 0, cellSize * row + cellSize/2)
cellSize = 0.8 world units
```

| Actor | cell (col, row) | world (x, y, z) |
|-------|-----------------|------------------|
| P1-MCV | (3, 3) | (2.80, 0.45, 2.80) |
| P1-Infantry | (5, 1) | (4.40, 0.35, 1.20) |
| P1-PowerPlant | (1, 5) | (1.20, 0.40, 4.40) |
| P2-MCV | (12, 12) | (10.00, 0.45, 10.00) |
| P2-Infantry | (14, 10) | (11.60, 0.35, 8.40) |
| P2-Barracks | (10, 14) | (8.40, 0.40, 11.60) |

### 自包含设计

本测试页面不依赖任何实际 trait 实现:
- 地形使用 Babylon.js 原生 `CreateGround` + `CreateLines` 构建
- Actor 使用 `CreateBox` + `CreateCylinder` + `CreatePlane` 构建
- 所有材质使用 StandardMaterial，无自定义 Shader
- 高亮功能使用 `emissiveColor` 属性实现
- 没有导入任何 `OpenRA.*` 模块

### 颜色值参考

| 元素 | 颜色 | 值 (RGB) |
|------|------|----------|
| 地形主色 | 绿色 (Clear) | (0.22, 0.35, 0.18) ≈ #385A2E |
| 棋盘格亮色 | 浅绿 | (0.24, 0.37, 0.19) ≈ #3D5E30 |
| 棋盘格暗色 | 深绿 | (0.20, 0.33, 0.17) ≈ #33542B |
| 网格线 | 深绿灰 | (0.18, 0.25, 0.14) ≈ #2D4024 |
| 地图边框 | 深灰黑 | (0.08, 0.09, 0.11) ≈ #15171C |
| P1 单位 diffuse | 红色 | (0.88, 0.18, 0.18) ≈ #E02E2E |
| P2 单位 diffuse | 蓝色 | (0.18, 0.35, 0.88) ≈ #2D59E0 |
| P1 标签 emissive | 浅红 | (0.95, 0.35, 0.35) ≈ #F25959 |
| P2 标签 emissive | 浅蓝 | (0.35, 0.55, 0.95) ≈ #598CF2 |
| 高亮 emissive | 白色光晕 | (0.35, 0.35, 0.35) |
| 暗淡 emissive | 近黑 | (0.02, 0.02, 0.02) |
| 天空/背景 | 深蓝黑 | (0.10, 0.13, 0.18) ≈ #1A212E |

---

| 审核状态 | 审核人 | 审核日期 | 审核结果 |
|---------|--------|---------|---------|
| APPROVED | KV | 2026-06-20 | R2 APPROVED — all 6 expectations verified |
