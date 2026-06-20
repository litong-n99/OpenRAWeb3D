# Ch27 Main Menu - DOM 覆盖层回退

> **人工验收测试页**
> 模块: Game._showMainMenuDomOverlay() — 纯 DOM 主菜单覆盖层
> 测试ID: `ch27-mainmenu/dom-fallback`
> OpenRA 对照: `Game.ts` — _showMainMenuDomOverlay() (lines 1219-1347), setShellmapFallback()
> 创建日期: 2026-06-20
> **审核状态**: ✅ 全部审核通过

---

## 测试目标

验证当 WidgetLoader 不可用或加载失败时，纯 DOM 覆盖层作为回退方案正确显示。这是 ADR-27.1 中的回退路径——DOM 覆盖层始终同步可用，确保用户在任何情况下都能看到主菜单。

关键验证点：
1. **DOM 结构完整性**: 标题、副标题、4 个按钮、版本文字全部存在
2. **样式精确性**: 按钮渐变背景、hover 效果、disabled 状态匹配 Game.ts 定义
3. **按钮交互**: Skirmish/Settings/Exit 可点击，Multiplayer 禁用
4. **Shellmap 背景**: 深蓝色回退背景色 (Color4: 0.05, 0.05, 0.1)
5. **版本文字动画**: CSS pulse 动画 3s ease-in-out infinite

---

## B. 期望结果（可量化验收标准）

### 期望 1: DOM 结构完整

**操作**: 打开测试页面（自动显示 DOM 覆盖层）。

**量化标准**:

| 元素 | 选择器 | 预期内容 |
|------|--------|---------|
| 覆盖层容器 | `#main-menu-overlay` | 存在，z-index: 99, pointer-events: none |
| 菜单卡片 | overlay 内 div | background: rgba(10,10,30,0.75), border-radius: 12px |
| 标题 | overlay 内 h1 | "OpenRAWeb3D", color: #f0f0f0, font-size: 2rem |
| 副标题 | overlay 内 p:first-of-type | "Web-based RTS Engine", color: #8888aa |
| Skirmish 按钮 | `#btn-skirmish` | 文本 "Skirmish", disabled=false |
| Multiplayer 按钮 | `#btn-multiplayer` | 文本 "Multiplayer (Coming Soon)", disabled=true |
| Settings 按钮 | `#btn-settings` | 文本 "Settings", disabled=false |
| Exit 按钮 | `#btn-exit` | 文本 "Exit to Desktop", disabled=false |
| 版本文字 | overlay 内最后一个 p | "Prototype — Phase C", pulse 动画 |

### 期望 2: 按钮样式精确

**操作**: 观察按钮的常态样式。

**量化标准**:

| 状态 | 属性 | 预期值 |
|------|------|--------|
| 常态 (enabled) | background | linear-gradient(135deg, #334488, #4466cc) |
| 常态 (enabled) | color | #e0e0f0 |
| 常态 (enabled) | cursor | pointer |
| hover (enabled) | background | linear-gradient(135deg, #4466cc, #5577ee) |
| hover (enabled) | borderColor | rgba(120,140,220,0.6) |
| hover (enabled) | boxShadow | 0 0 8px rgba(100,140,220,0.3) |
| 常态 (disabled) | background | rgba(40,40,60,0.5) |
| 常态 (disabled) | color | #555570 |
| 常态 (disabled) | cursor | not-allowed |

> hover 效果切换时间: transition all 0.15s ease，150ms 内完成。

### 期望 3: 按钮交互日志

**操作**: 依次 hover 并点击 Skirmish、Settings、Exit 按钮。

**量化标准**:

| 交互 | 日志输出 |
|------|---------|
| mouseenter Skirmish | `[hover] Skirmish — hover enter（背景变亮、边框高亮、辉光出现）` |
| mouseleave Skirmish | `[hover] Skirmish — hover leave（恢复常态）` |
| 点击 Skirmish | `[click] Skirmish 按钮被点击 → _openSkirmishSetup()` |
| 点击 Settings | `[click] Settings 按钮被点击 → _openSettingsPanel()` |
| 点击 Exit | `[click] Exit 按钮被点击 → _exitToModSelector()` |

> 日志显示时间戳精确到秒 (HH:MM:SS)。

### 期望 4: Shellmap 回退背景色

**操作**: 点击 "移除覆盖层" 按钮，观察 sandbox 背景。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| sandbox 背景色 | rgb(13, 13, 26) / #0d0d1a | 精确匹配 |
| 右下角标签 | "bg: rgb(13,13,26)" | - |
| Babylon.js 等效 | Color4(0.05, 0.05, 0.1, 1.0) | - |
| 视觉特征 | 深色带蓝色调，非纯黑 | - |

### 期望 5: 模拟 Widget 失败回退

**操作**: 点击 "模拟 Widget 失败 → 回退" 按钮。

**量化标准**:

| 检查项 | 预期值 |
|--------|--------|
| 日志显示 | `[error] 模拟: WidgetLoader 加载失败 → 回退到 DOM 覆盖层` |
| 延迟 | ~500ms 内显示 DOM 覆盖层（模拟 async widget 加载失败） |
| 显示后日志 | `[info] 回退完成: DOM 覆盖层已显示（ADR-27.1 回退方案生效）` |
| 覆盖层状态 | 所有按钮正常显示和交互 |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch27-mainmenu/dom-fallback/`
2. 确认环境信息栏显示 "纯 DOM" 引擎
3. 确认 sandbox 背景为深蓝色 #0d0d1a
4. 页面自动显示 DOM 覆盖层

### 步骤一：DOM 结构验证

1. 打开浏览器 DevTools → Elements 面板
2. 搜索 `#main-menu-overlay` → 确认元素存在
3. 在 overlay 内确认 h1 文本为 "OpenRAWeb3D"
4. 确认第一个 p 元素文本为 "Web-based RTS Engine"
5. 确认以下按钮存在且 ID 正确：
   - `#btn-skirmish` — 文本 "Skirmish"
   - `#btn-multiplayer` — 文本 "Multiplayer (Coming Soon)"
   - `#btn-settings` — 文本 "Settings"
   - `#btn-exit` — 文本 "Exit to Desktop"
6. 确认版本文字 "Prototype — Phase C" 存在
7. 确认右侧自动检查面板全部 9 个指标为绿色

**预期**: 符合期望 1 → 继续

### 步骤二：按钮样式验证

1. 在 DevTools 中选中 `#btn-skirmish`
2. 检查 computed styles → background 包含 `linear-gradient` 和 `#334488`
3. 将鼠标 hover 在 Skirmish 按钮上
4. 检查 computed styles → background 变为 `#4466cc`, border-color 变为 `rgba(120,140,220,0.6)`
5. 检查 box-shadow 变为 `0 0 8px rgba(100,140,220,0.3)`
6. 鼠标移开 → 样式恢复，（hover enter 和 hover leave 各一条日志）
7. 检查 `#btn-multiplayer` → cursor = not-allowed, 背景为暗灰色

**预期**: 符合期望 2 → 继续

### 步骤三：按钮交互验证

1. 依次点击 Skirmish、Settings、Exit 按钮
2. 每点击一次，观察右侧 "交互日志" 面板出现对应日志
3. 确认日志时间戳正确
4. 确认日志颜色编码正确：hover=蓝色, click=绿色, error=红色

**预期**: 符合期望 3 → 继续

### 步骤四：Shellmap 背景色验证

1. 点击 "移除覆盖层" 按钮
2. sandbox 区域露出深蓝色背景
3. 使用 DevTools 取色器确认背景色为 rgb(13, 13, 26) / #0d0d1a
4. 确认右下角标签显示 "bg: rgb(13,13,26)"
5. 点击 "显示 DOM 覆盖层" → 覆盖层重新出现

**预期**: 符合期望 4 → 继续

### 步骤五：Widget 失败回退模拟

1. 点击 "移除覆盖层"
2. 点击 "模拟 Widget 失败 → 回退"
3. 观察日志: [error] 模拟 WidgetLoader 加载失败
4. 等待约 500ms → DOM 覆盖层自动显示
5. 确认所有按钮可交互

**预期**: 符合期望 5 → 继续

### 边界/异常测试

1. **重复显示**: 连续点击 "显示 DOM 覆盖层" 3 次 → 只有 1 个 overlay 存在（防重复逻辑）
2. **Escape 移除**: 显示覆盖层 → 按 Escape 键 → 覆盖层移除，日志输出
3. **快速切换**: 显示→移除→显示→移除，快速点击 → 无残留 DOM 元素
4. **版本文字动画**: 观察版本文字 "Prototype — Phase C" → 3 秒周期内 opacity 在 0.4 和 0.8 之间交替（CSS pulse 动画）

---

## 结果判定

- [ ] 期望 1 通过（DOM 结构完整，8 个元素全部存在）
- [ ] 期望 2 通过（按钮样式精确匹配 Game.ts）
- [ ] 期望 3 通过（按钮交互日志正确）
- [ ] 期望 4 通过（Shellmap 回退背景色 #0d0d1a）
- [ ] 期望 5 通过（Widget 失败回退模拟正常）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行 → 记录 UA/视口/时间，重新测试 |

---

## 覆盖的 Game.ts 方法映射

| Game.ts 方法 | 测试中对应步骤 | 验证内容 |
|-------------|-------------|---------|
| `_showMainMenuDomOverlay()` | 创建 DOM 覆盖层 | DOM 结构、样式、按钮定义 |
| `setShellmapFallback()` | sandbox 背景色 | clearColor = #0d0d1a |
| `hideMainMenu()` → remove overlay | 移除覆盖层 | DOM 清理 |
| 按钮 onClick 处理器 | 第 3-5 步 | 点击 → _openSkirmishSetup / _openSettingsPanel / _exitToModSelector |
| `showMainMenu()` catch fallback | Widget 失败模拟 | ADR-27.1 回退路径验证 |
