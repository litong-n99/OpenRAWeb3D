# Ch27 Main Menu - Widget 树渲染

> **人工验收测试页**
> 模块: WidgetLoader + ContainerWidget + ButtonWidget + LabelWidget + BackgroundWidget + ImageWidget + DropDownButtonWidget + LogicKeyListenerWidget
> 测试ID: `ch27-mainmenu/widget-menu-rendering`
> OpenRA 对照: `Game.ts` — showMainMenuWidget(), `mainmenu.json` — MAINMENU widget tree
> 创建日期: 2026-06-20
> **审核状态**: ✅ 全部审核通过

---

## 测试目标

验证 WidgetLoader 从 `common|chrome/mainmenu.json` 正确加载并渲染主菜单 Widget 树。这是 ADR-27.1 中 Widget 主动升级路径的核心验收点——Widget 系统必须能完整渲染主菜单，不能依赖纯 DOM 覆盖层。

关键验证点：
1. **Widget 类型注册**: 7 种 widget 类型全部注册并能通过 WidgetLoader 实例化
2. **Widget 树结构**: Container → Background → Button → Label → Image 层次正确
3. **DOM 渲染**: Widget 渲染输出包含 `data-widget-id` 属性（区别于纯 DOM 覆盖层）
4. **按钮可见性**: 至少 3 个主按钮可见（Skirmish, Settings, Exit）
5. **其他元素**: 标题 Label、版本 Label、Logo Image 均存在

---

## B. 期望结果（可量化验收标准）

### 期望 1: Widget 树正确加载并渲染

**操作**: 打开测试页面（自动加载），或点击 "加载 Widget 菜单"。

**量化标准**:

| 检查项 | 预期值 | 验证方法 |
|--------|--------|---------|
| 根 overlay 元素 | ID 为 `main-menu-widget-overlay` 的 div 存在于 DOM | `document.getElementById('main-menu-widget-overlay')` 非 null |
| data-widget-id 属性 | DOM 中至少有 5 个元素包含 `data-widget-id` 属性 | `document.querySelectorAll('[data-widget-id]').length >= 5` |
| Widget 树节点数 | 至少 10 个 Widget 节点（含嵌套） | 树结构面板显示 >= 10 行 |
| 加载时间 | fetch + 布局解析 + UI 实例化 + DOM 渲染在 500ms 内完成 | 观察信息栏时间戳变化 |

### 期望 2: 按钮 Widget 正确渲染

**操作**: 加载完成后观察 sandbox 区域。

**量化标准**:

| 按钮 ID | 预期状态 | 文本 |
|---------|---------|------|
| SINGLEPLAYER_BUTTON | 可见 | 单机游戏 / Skirmish |
| MULTIPLAYER_BUTTON | 可见 | 多人游戏 / Multiplayer |
| SETTINGS_BUTTON | 可见 | 设置 / Settings |
| QUIT_BUTTON | 可见 | 退出 / Exit |
| EXTRAS_BUTTON | 可见 | 扩展 / Extras |
| CONTENT_BUTTON | 可见 | 内容管理 / Content |

> 至少 3 个按钮的 `style.display` 不是 `none`。

### 期望 3: Widget 类型注册完整

**操作**: 打开浏览器控制台，检查 WidgetLoader 的注册状态。

**量化标准**:

| Widget 类型 | 构造函数 | 注册状态 |
|-------------|---------|---------|
| Container | ContainerWidget | 已注册 |
| Button | ButtonWidget | 已注册 |
| Label | LabelWidget | 已注册 |
| Background | BackgroundWidget | 已注册 |
| Image | ImageWidget | 已注册 |
| DropDownButton | DropDownButtonWidget | 已注册 |
| LogicKeyListener | LogicKeyListenerWidget | 已注册 |

> 页面加载无 "Cannot find type" 或 "Widget has duplicate Key" 错误。

### 期望 4: Widget 树结构正确

**操作**: 查看右侧 "Widget 树结构" 面板。

**量化标准**:

| 层级 | 预期类型 | 预期 ID |
|------|---------|---------|
| 根 (depth=0) | ContainerWidget | MAINMENU |
| depth=1 | BackgroundWidget | BORDER / NEWS_BG |
| depth=1 | ImageWidget | LOGO |
| depth=1 | LabelWidget | VERSION_LABEL |
| depth=2+ | ButtonWidget | SINGLEPLAYER_BUTTON, etc. |
| depth=2+ | LabelWidget | MAINMENU_LABEL_TITLE |

> 树结构面板显示至少 4 层深度，包含 Container、Background、Image、Label、Button 类型。

### 期望 5: 自适应缩放

**操作**: 在缩放下拉菜单中选择不同比例。

**量化标准**:

| 缩放 | widget-root CSS transform |
|------|--------------------------|
| 100% | `scale(1)` |
| 75% | `scale(0.75)` |
| 50% | `scale(0.5)` |
| 35% | `scale(0.35)` |

> widget-root 元素的 `transform` CSS 属性在切换后即时更新（50ms 内）。

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch27-mainmenu/widget-menu-rendering/`
2. 确认环境信息栏显示 "WidgetLoader + DOM" 引擎
3. 确认 `public/mods/common/chrome/mainmenu.json` 文件存在（否则 fetch 会 404）
4. 页面自动加载，等待加载遮罩消失（~500ms）

### 步骤一：Widget 树加载验证

1. 观察 sandbox 区域——加载遮罩 fade out 后应看到 Widget 渲染的主菜单元素
2. 确认 sandbox 区域的右下角标签显示 "Widget 渲染区域 (1280x720 逻辑像素，自动缩放适配)"
3. 打开浏览器 DevTools → Elements 面板
4. 搜索 `main-menu-widget-overlay` → 确认该元素存在
5. 搜索 `data-widget-id` → 确认至少有 5 个匹配元素
6. 观察右侧自动检查面板 → 确认所有 7 个指标都是绿色

**预期**: 符合期望 1+2 → 继续

### 步骤二：Widget 树结构验证

1. 查看右侧 "Widget 树结构" 面板
2. 确认第一行显示 `ContainerWidget @ MAINMENU [0,0 1280x720]`
3. 确认树结构中包含 `ButtonWidget` 节点（至少 3 个）
4. 确认树结构中包含 `LabelWidget` 节点（MAINMENU_LABEL_TITLE, VERSION_LABEL）
5. 确认树结构中包含 `ImageWidget` 节点（LOGO）
6. 确认树结构中包含 `BackgroundWidget` 节点（BORDER, NEWS_BG）

**预期**: 符合期望 3+4 → 继续

### 步骤三：按钮可见性验证

1. 在 DevTools Elements 面板中搜索 `SINGLEPLAYER_BUTTON`
2. 确认该元素的 `style` 中 `display` 不是 `none`
3. 同样检查 `SETTINGS_BUTTON`、`QUIT_BUTTON`
4. 确认子菜单按钮（如 `SINGLEPLAYER_MENU`）的 `data-widget-hidden` 属性存在

**预期**: 符合期望 2 → 继续

### 步骤四：缩放测试

1. 在缩放下拉菜单中选择 "75%"
2. 观察 sandbox 区域中的 widget 是否缩小
3. 在 DevTools 中检查 `#widget-root` 的 `transform` → 应为 `scale(0.75)`
4. 切换回 "100%"、"50%"、"35%" → 每次缩放即时生效

**预期**: 符合期望 5 → 继续

### 步骤五：重新加载测试

1. 点击 "重新加载" 按钮
2. 确认加载遮罩再次出现
3. 确认加载完成后 Widget 菜单重新渲染
4. 确认自动检查全部绿色
5. 连续点击 "重新加载" 3 次 → 每次都能正确渲染

### 边界/异常测试

1. **JSON 解析错误**: 如果 `public/mods/common/chrome/mainmenu.json` 不存在或损坏 → 加载错误文本应显示红色错误信息
2. **卸载测试**: 点击 "卸载" → widget 从 sandbox 中移除，自动检查全部重置为灰色
3. **重复加载**: 点击 "加载 Widget 菜单" 多次 → 正确卸载上一次再重新加载，无 DOM 元素泄漏
4. **浏览器缩放**: 改变浏览器窗口大小 → widget 自适应缩放（sandbox 区域保持 widget 可见）

---

## 结果判定

- [ ] 期望 1 通过（Widget 树正确加载并渲染到 DOM）
- [ ] 期望 2 通过（至少 3 个按钮 widget 可见）
- [ ] 期望 3 通过（7 种 widget 类型全部注册）
- [ ] 期望 4 通过（Widget 树结构正确：Container → Background + Button + Label + Image）
- [ ] 期望 5 通过（自适应缩放正常工作）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行或 mainmenu.json 404 → 记录 UA/视口/时间，重新测试 |

---

## 覆盖的 Game.ts / WidgetLoader 方法映射

| 源代码 | 测试中对应步骤 |
|--------|-------------|
| `WidgetLoader.registerWidget('Container', ContainerWidget)` | 第 3 步 — 注册 7 种 widget 类型 |
| `WidgetLoader.loadLayout(mainmenuJson)` | 第 5 步 — 加载 JSON 布局定义 |
| `WidgetLoader.loadUI('MAINMENU', args)` | 第 6 步 — 实例化 Widget 树 |
| `Game._hideSubMenusOnWidgetTree(root)` | 第 7 步 — 隐藏子菜单面板 |
| `rootWidget.renderOuter()` | 第 8 步 — 渲染 Widget 到 DOM |
| `rootWidget.dispose()` | 卸载 — 清理 Widget 树 |
