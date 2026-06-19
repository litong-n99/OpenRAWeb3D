# Ch21 Editor - Editor UI Shell 编辑器整体布局验证

> **人工验收测试页**
> 模块: Editor UI Shell (编辑器整体布局外壳)
> 测试ID: `ch21-editor/editor-ui-shell`
> OpenRA 对照: `OpenRA.Mods.Common/Widgets/Logic/Editor/MapEditorLogic.cs` (根控制器), `MapEditorTabsLogic.cs` (Tab 栏), `MapToolsLogic.cs` (工具面板)
> 创建日期: 2026-06-19

---

## 测试目标

本测试页面验证 P1A.4 Editor UI Shell 的完整布局和交互。编辑器是整个 OpenRAWeb3D 项目最重要的 WYSIWYG 工具之一，其 UI 外壳必须满足：菜单栏功能、工具栏工具切换、属性面板联动、Minimap 交互和最小视口适配。

---

## B. 期望结果（可量化验收标准）

### 期望 1: 所有工具栏工具可点击且激活状态互斥

**操作**: 依次点击工具栏上的每个工具按钮，观察按钮状态和提示。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 工具总数 | 10 个 (select, paint, fill, erase, line, rect, undo, redo, zoomIn, zoomOut) | 精确计数 |
| 激活态背景色 | `#1a4a7a` (border: `#3388cc`) | 视觉判定 |
| 非激活态背景色 | 透明 / 暗色（无蓝色边框） | 视觉判定 |
| 同时激活数 | 1 个（仅绘制工具互斥；undo/redo/zoom 按钮不改变激活态） | 精确为 1 |
| 点击后 Toast 提示 | 出现 "🛠 Tool: [工具描述]" 消息，2 秒后淡出 | 文本含 "Tool:" |
| 悬停背景变化 | hover → `#0f3460`，100ms 内完成 | 无明显延迟 |
| 悬停 tooltip | data-tooltip 属性值在 200ms 内显示 | 文本匹配 |
| 默认激活工具 | Select（⬚ 按钮 + "Select Tool" 标签） | 精确匹配 |

### 期望 2: Minimap 视角矩形随相机移动更新

**操作**: 在 Minimap 上点击不同位置，观察白色视口矩形移动及坐标输出。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| Minimap 尺寸 | 180px × 120px（默认）/ 280px × 180px（展开） | ±2px |
| 画布实际分辨率 | 256px × 256px（内部渲染） | 精确 |
| 视口矩形位置 | 白色 (1.5px 线宽, 6% 白色填充) 随点击移动 | 视觉判定 |
| 点击坐标显示 | Toast 消息含 "cell(CX, CY)" | 文本含 "cell(" |
| 视口矩形边界 | 不超出 Minimap 边界 (0-63 cells) | 始终在画布内 |
| 展开/收起按钮 | 点击 "＋" 变为 "−"，尺寸变为 280×180；再次点击恢复 | 按钮文本切换 |
| Minimap 关闭后 | View → Toggle Minimap 或按 M 键 → 容器 `display: none` | 不占空间 |

### 期望 3: 属性面板显示选中对象的关联字段

**操作**: 点击 3D 视口中的不同 actor 模型，观察左侧属性面板更新。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 无选中状态 | 显示 "Select an object to view properties"（灰色斜体，颜色 #556） | 文本精确匹配 |
| 选中后显示组 | 4 个属性组：General, Position, Stats, Visual | 全部可见 |
| 组头颜色 | `#7799bb` | 视觉判定 |
| General→Name | 对应 actor 名称（如 "harv1", "e1", "tank1"） | 文本精确匹配 |
| General→Type | 对应类型（Harvester / Infantry / Vehicle / Building / Civilian） | 精确匹配 |
| Position→Cell X/Cell Y | 与 3D 场景中位置对应（整数） | 值合理 |
| Position→World | 格式 "([X*1024], [Y*1024])" | 1024 倍关系 |
| Stats→Health | 格式 "[N] / 100" | 整数 ≥ 0 |
| Visual→Facing | 格式 "[N]°" | 0-359 |
| 组折叠 | 点击组标题 → 组折叠（▾ 旋转 -90deg），字段隐藏；再点击展开 | CSS transform |
| 选中后 Toast | 消息含 "Selected: [name] ([type]) at cell(X, Y)" | 文本含 "Selected:" |
| 状态栏 Cell 更新 | 显示 "(cx, cy)" | 匹配选中 actor |
| 状态栏 WPos 更新 | 显示 "([X*1024], [Y*1024])" | 匹配 |

### 期望 4: 菜单项触发正确操作

**操作**: 依次点击各菜单栏（File/Edit/View/Map/Help）及其子项，观察反馈。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 菜单栏数量 | 5 个（File, Edit, View, Map, Help） | 精确 |
| 点击菜单展开 | 下拉菜单在 50ms 内出现，z-index 高于其他元素 | 视觉判定 |
| 点击外部关闭 | 点击灰色遮罩层或空白区域 → 下拉菜单关闭 | 50ms 内关闭 |
| 按 Esc 关闭 | 在菜单打开时按 Escape → 菜单关闭 | 立即 |
| File→New | Toast: "📄 New Map — creating blank map..." | 文本精确匹配 |
| File→Open | Toast: "📂 Open Map — file dialog would open" | 文本精确匹配 |
| File→Save | Toast: "💾 Map Saved (Ctrl+S)" | 文本精确匹配 |
| File→Save As | Toast: "💾 Save As... — save dialog would open" | 文本精确匹配 |
| File→Exit | Toast: "🚪 Exit Editor — returning to main menu" | 文本精确匹配 |
| Edit→Undo | Toast: "↩ Nothing to undo" 或 "↩ Undo — N actions remaining" | 文本含 "Undo" |
| Edit→Redo | Toast: "↪ Nothing to redo" 或 "↪ Redo — N actions remaining" | 文本含 "Redo" |
| Edit→Cut | Toast: "✂ Cut — copied selection to clipboard" | 文本精确匹配 |
| Edit→Copy | Toast: "📋 Copy — copied to clipboard" | 文本精确匹配 |
| Edit→Paste | Toast: "📄 Paste — pasted from clipboard" | 文本精确匹配 |
| Edit→Select All | Toast: "▣ Select All — all objects selected" | 文本精确匹配 |
| View→Zoom In | Toast: "🔍 Zoom In — [N]%" | 百分比递增 25 |
| View→Zoom Out | Toast: "🔎 Zoom Out — [N]%" | 百分比递减 25 |
| View→Reset Zoom | Toast: "↺ Zoom Reset — 100%" | 恢复 100% |
| View→Toggle Grid | Toast: "📐 Grid ON/OFF"，状态栏 Grid 切换 | 文本含 "Grid" |
| View→Toggle Minimap | Toast: "🗺 Minimap ON/OFF"，Minimap 显隐切换 | 文本含 "Minimap" |
| Map→Validate | Toast: "✅ Validating map... No errors found." | 文本精确匹配 |
| Help→About | Toast: "ℹ OpenRAWeb3D Map Editor v0.1.0 — Phase A Shell" | 文本精确匹配 |
| Help→Shortcuts | Toast: "⌨ Shortcuts: S=Select P=Paint F=Fill..." | 文本精确匹配 |

### 期望 5: 1280×720 最小视口无溢出

**操作**: 将浏览器窗口调整到 1280×720，检查所有元素可见、无重叠、无水平滚动。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 水平滚动条 | 不存在（body overflow hidden） | 无水平滚动 |
| 菜单栏高度 | 28px | ±2px |
| 工具栏高度 | 36px | ±2px |
| 状态栏高度 | 24px | ±2px |
| 信息栏高度 | ~22px | ±4px |
| 属性面板宽度 | 240px | ±2px |
| 3D 视口区域 | 填充剩余空间（~1040px × ~610px） | 填充无间隙 |
| Minimap 位置 | 视口右下角，距右 12px，距底 12px | 完全可见 |
| 所有工具栏按钮 | 10 个按钮全部可见，无换行 | 单行显示 |
| 所有菜单项 | 5 个菜单标签全部可见 | 无被截断 |
| Toast 通知 | 水平居中，不被裁剪 | 完整显示 |
| 各组件间无重叠 | 属性面板/视口/Minimap 边界清晰 | 视觉判定 |

### 期望 6: 键盘快捷键工作正常

**操作**: 按下工具快捷键 S/P/F/E/L/R/G/M，观察 UI 响应。

**量化标准**:

| 快捷键 | 预期行为 | 
|--------|---------|
| S | 切换到 Select 工具 |
| P | 切换到 Paint 工具 |
| F | 切换到 Fill 工具 |
| E | 切换到 Erase 工具 |
| L | 切换到 Line 工具 |
| R | 切换到 Rectangle 工具 |
| G | 切换 Grid ON/OFF |
| M | 切换 Minimap ON/OFF |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch21-editor/editor-ui-shell/`
2. 确认环境信息栏显示 "Babylon.js (WebGL)" 引擎
3. 确认 FPS 计数器显示 ≥ 30
4. 将屏幕分辨率设置为 1920×1080（1x 缩放）或更高

### 步骤一：布局检查

1. 观察页面整体布局
2. 确认顶部菜单栏：File | Edit | View | Map | Help（5 个菜单）
3. 确认工具栏：⬚ Select, 🖌 Paint, 🪣 Fill, ⌫ Erase, ╱ Line, ◻ Rect, ↩ Undo, ↪ Redo, 🔍 Zoom+, 🔎 Zoom- （10 个按钮）
4. 确认左侧属性面板（240px 宽）显示 "Select an object to view properties"
5. 确认中央 3D 视口显示暗色地面 + 网格线 + 彩色方块（actor）
6. 确认右下角 Minimap（180×120px）显示地形概览 + 白色视口矩形
7. 确认底部状态栏显示 "Zoom: 100% | Cell: - | WPos: - | Layer: Terrain | Grid: ON | Minimap: ON"

**预期**: 符合期望 5（1280×720 无障碍）→ 继续

### 步骤二：菜单栏交互

1. 点击 "File" → 下拉菜单展开，含 New, Open, Save, Save As, Exit
2. 点击 "New" → Toast 显示 "📄 New Map — creating blank map..."
3. 再次点击 "File" → 点击 "Save" → Toast 显示 "💾 Map Saved (Ctrl+S)"
4. 点击 "Edit" → 下拉展开，查看 Undo, Redo, Cut, Copy, Paste, Select All
5. 连续点击 Edit → Undo 3 次 → Toast 每次递减（第 1 次 "0 actions remaining"，之后 "Nothing to undo"）
6. 点击 "View" → 点击 "Zoom In" 2 次 → 状态栏显示 "Zoom: 150%"
7. 点击 "View" → 点击 "Zoom Out" → 状态栏显示 "Zoom: 125%"
8. 点击 "View" → 点击 "Toggle Minimap" → Minimap 消失，状态栏显示 "Minimap: OFF"
9. 再次点击 "View" → "Toggle Minimap" → Minimap 重新出现
10. 点击 "Map" → "Validate Map" → Toast 显示 "✅ Validating map..."
11. 点击 "Help" → "About Editor" → Toast 显示 "ℹ OpenRAWeb3D Map Editor..."
12. 点击菜单外部空白区域 → 菜单关闭

**预期**: 符合期望 4 → 继续

### 步骤三：工具栏切换

1. 默认 Select 按钮高亮（蓝色边框 `#3388cc`），视口标签显示 "Select Tool"
2. 点击 🖌 Paint → Select 取消高亮，Paint 高亮 → Toast "🛠 Tool: Paint Tool..."
3. 点击 🪣 Fill → 同上切换
4. 点击 ⌫ Erase → 同上切换
5. 点击 ╱ Line → 同上切换
6. 点击 ◻ Rect → 同上切换
7. 点击 ↩ Undo → 直接执行 undo 操作（不改变当前选中工具）
8. 点击 ↩ Undo 4 次后 → Toast "↩ Nothing to undo"
9. 点击 🔍 Zoom+ 3 次 → 状态栏 "Zoom: 175%"
10. 确认绘制工具（Select/Paint/Fill/Erase/Line/Rect）中始终只有 1 个高亮

**预期**: 符合期望 1 → 继续

### 步骤四：3D 视口 & Actor 选择

1. 在 3D 视口区域使用鼠标中键拖拽 → 视口平移
2. 使用滚轮 → 视口缩放（摄像机拉近/拉远）
3. 右键拖拽 → 视口旋转
4. 点击黄色方块（Harvester）→ 被点击的 mesh 高亮（蓝色光晕），属性面板显示属性
5. 检查属性面板：
   - General→Name: "harv1"
   - General→Type: "Harvester"
   - General→Owner: "Player"
   - Position→Cell X: -8, Cell Y: 10
   - Stats→Health: "85 / 100"
6. 点击另一个 actor（如红色方块 enemy tank）→ 属性切换
7. 点击其他 9 个 actor → 每次属性面板都正确更新
8. 点击地面空白区域 → 不触发选中（需要鼠标点击地面而非 actor mesh）
9. 点击属性面板组标题（如 "General"）→ 折叠/展开

**预期**: 符合期望 3 → 继续

### 步骤五：Minimap 交互

1. 在 Minimap 上点击不同位置 → 白色视口矩形移动到点击位置
2. Toast 显示 "🗺 Minimap click at cell(X, Y)"
3. 点击 Minimap 右上角 "＋" 按钮 → Minimap 展开为 280×180px
4. 按钮文本变为 "−"
5. 再次点击 "−" → Minimap 恢复 180×120px
6. 按 M 键 → Minimap 消失，状态栏 "Minimap: OFF"
7. 再按 M → Minimap 重新出现
8. 确认 Minimap 上显示彩色点（actor 位置）：绿色(Player)、红色(Enemy)、黄色(Neutral)

**预期**: 符合期望 2 → 继续

### 步骤六：键盘快捷键

1. 确保没有选中可编辑的文本框
2. 按 S → Select 工具高亮（⬚ 按钮激活）
3. 按 P → Paint 工具高亮（🖌 按钮激活）
4. 按 F → Fill 工具高亮（🪣 按钮激活）
5. 按 E → Erase 工具高亮（⌫ 按钮激活）
6. 按 L → Line 工具高亮（╱ 按钮激活）
7. 按 R → Rectangle 工具高亮（◻ 按钮激活）
8. 按 G → 状态栏 Grid 切换（ON→OFF 或 OFF→ON）
9. 按 M → 状态栏 Minimap 切换

**预期**: 符合期望 6 → 继续

### 步骤七：边界/异常测试

1. **1280×720 适配**: 将浏览器窗口缩小到 1280×720 → 确认无水平滚动条、所有工具栏按钮单行显示、Minimap 完全可见
2. **快速菜单切换**: 快速在 File/Edit/View 之间切换 → 下拉菜单无闪烁、无残留
3. **快速工具切换**: 快速依次按 S→P→F→E→L→R→S → 每次只 1 个按钮高亮
4. **空状态 reset**: 选中一个 actor 后，点击 File → New → 属性面板恢复 "Select an object..."
5. **__testHarness.reset()**: 在浏览器控制台执行 `__testHarness.reset()` → 所有状态恢复默认
6. **__testHarness.clickMenu**: 在控制台执行 `__testHarness.clickMenu('file', 'save')` → Toast 显示保存消息
7. **__testHarness.getToolbarTools**: 执行 → 返回 10 个工具对象数组
8. **__testHarness.getMinimapViewport**: 执行 → 返回 minimap 状态对象
9. **__testHarness.getPropertyPanelFields**: 先选中 actor 再执行 → 返回 12 个字段的对象数组

---

## 结果判定

- [ ] 期望 1 通过（工具栏工具可点击且激活态互斥）
- [ ] 期望 2 通过（Minimap 视角矩形随点击移动 + 展开/收起）
- [ ] 期望 3 通过（属性面板显示选中对象关联字段 + 组折叠）
- [ ] 期望 4 通过（菜单项触发正确操作 + Toast 消息精确匹配）
- [ ] 期望 5 通过（1280×720 最小视口无溢出、无重叠）
- [ ] 期望 6 通过（键盘快捷键正常工作）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 6 项期望通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行或 WebGL 不可用 → 记录 UA/视口/时间，重新启动后复测 |

---

## 已知限制

- 菜单操作为 Toast 消息模拟，不实际执行文件读写或编辑器操作
- 3D Viewport 使用简化的 Babylon.js 场景（9 个方块代表 actor），非完整地形渲染
- Property Panel 不实际修改 actor 属性（仅显示）
- 撤销/重做栈为简化实现（在 selectActor 或 toolbar 操作时递增 undo 计数器）
- Minimap 使用 2D Canvas 过程化地形，非真实地图数据
- 未实现完整的 EditorTabsLogic 6 标签页切换

---

**审核状态**: ⏳ 待审核
