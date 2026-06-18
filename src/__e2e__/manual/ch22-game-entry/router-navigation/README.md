# Ch22 Game Entry - 路由导航验证

> **人工验收测试页**
> 模块: Router + ModSelector (完整 Router API 集成测试)
> 测试ID: `ch22-game-entry/router-navigation`
> OpenRA 对照: `Router.ts` — on(), dispatch(), navigate(); `ModSelector.ts` — show(), launchMod()
> 创建日期: 2026-06-18

---

## 测试目标

本测试页面验证 Chapter 22 Phase A 路由系统的完整 API：Router 的 `on()` 模式注册、`dispatch()` 路径匹配与参数提取、`navigate()` history.pushState 导航。所有导航按钮均通过 `router.navigate()` 触发（非直接调用渲染函数），route handler 调用真实的 `ModSelector.show()` 和 `ModSelector.launchMod()`。

测试路径使用 TEST_BASE 前缀 `/test/ch22-game-entry/router-navigation` 以确保 pushState 在测试页面 URL 下操作，不会导航离开测试环境。

---

## B. 期望结果（可量化验收标准）

### 期望 1: 首页路由渲染（Router.dispatch 匹配）

**操作**: 页面初始加载（Router 自动 dispatch 当前 pathname）。

**量化标准**:
| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| window.location.pathname | `/test/ch22-game-entry/router-navigation/` | 精确匹配 |
| 路由匹配结果 | "MATCHED" (绿色) | - |
| 匹配模式 | `/test/ch22-game-entry/router-navigation/` | - |
| 调用的渲染函数 | ModSelector.show()（真实导入） | - |
| 卡片数量 | 4 | - |
| 标题 | "OpenRAWeb3D" | 精确匹配 |

### 期望 2: router.navigate 触发 Play 启动流程

**操作**: 点击 "Navigate to /play/ra" 按钮 → 调用 `router.navigate(TEST_BASE + '/play/ra')`。

**量化标准**:
| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| Router 内部调用 | history.pushState() + dispatch() | - |
| URL pathname 变化 | 变为 `/test/ch22-game-entry/router-navigation/play/ra` | 精确匹配 |
| 路由参数提取 | `{ "modId": "ra" }` | - |
| 调用的函数 | ModSelector.launchMod('ra')（真实导入） | - |
| Mod 选择器隐藏 | display:none，在 50ms 内生效 | - |
| 加载遮罩显示 | display:flex，在 50ms 内生效 | - |

### 期望 3: 进度条动画序列（ModSelector.launchMod 真实行为）

**操作**: 观察 "Navigate to /play/ra" 后的加载流程。

**量化标准**:
| 阶段 | 时间偏移 | 进度 | 文字 |
|------|---------|------|------|
| 1 | t=0ms (同步) | 10% | "Loading engine for ra..." |
| 2 | t≈100ms | 40% | "Initializing mod..." |
| 3 | t≈200ms | 70% | "Starting shellmap..." |
| 4 | t≈300ms | 100% | "Ready — engine stub (Phase B)" |

每阶段之间过渡平滑（transition: width 0.3s ease），进度条长度肉眼可见变化。

### 期望 4: Editor 占位页（router.navigate → RouteHandler → renderEditorStub）

**操作**: 点击 "Navigate to /editor/ra" 按钮。

**量化标准**:
| 检查项 | 预期值 |
|--------|--------|
| URL pathname | `/test/ch22-game-entry/router-navigation/editor/ra` |
| 路由参数 | `{ "modId": "ra" }` |
| 标题 | "Editor" (颜色 #eee, 字号 1.8rem) |
| 描述 | "Coming soon — ra map editor" (颜色 #aaa) |
| 返回链接 | "Back to Mod Selector" (颜色 #6688ee) |
| 点击返回链接 | 调用 router.navigate() 回到首页 |

### 期望 5: 未知路由处理（Router.dispatch 返回 false）

**操作**: 点击 "Navigate to /unknown" 按钮。

**量化标准**:
| 检查项 | 预期值 |
|--------|--------|
| Router.dispatch() 返回值 | `false`（无匹配路由） |
| URL 徽章 | "NO ROUTE" (红色) |
| 匹配模式 | "(none)" |
| 参数 | `{}` |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch22-game-entry/router-navigation/`
2. 确认环境信息栏显示 Router: active
3. 默认状态：Router 已 dispatch 当前 pathname，ModSelector 已渲染 4 张卡片

### 步骤一：首页路由验证（Router.dispatch）

1. 确认 URL 栏显示 `/test/ch22-game-entry/router-navigation/` + MATCHED 徽章（绿色）
2. 确认 4 张 Mod 卡片已渲染（通过 ModSelector.show() 真实 fetch）
3. 确认标题 "OpenRAWeb3D" 可见
4. 在面板中查看路由状态：匹配模式 = TEST_BASE + `/`，参数 = `{}`

**预期**: 符合期望 1 → 继续

### 步骤二：router.navigate 触发 Play 流程

1. 点击面板中的 "Navigate to /play/ra" 按钮
2. 确认浏览器 URL 栏变为 `/test/ch22-game-entry/router-navigation/play/ra`
3. 观察 Mod 选择器消失，加载遮罩出现
4. 面板路由状态显示匹配模式含 `/play/:modId`，参数 `{ "modId": "ra" }`
5. 确认这是通过 `ModSelector.launchMod()` 真实调用的（不是 mock 函数）

**预期**: 符合期望 2 → 继续

### 步骤三：进度条动画

1. 点击 "Navigate to /play/td" 按钮（测试不同 modId）
2. 观察进度条动画：
   - 立即 → 10% "Loading engine for td..."
   - ~100ms → 40% "Initializing mod..."
   - ~200ms → 70% "Starting shellmap..."
   - ~300ms → 100% "Ready — engine stub (Phase B)"
3. 总时间约 300ms

**预期**: 符合期望 3 → 继续

### 步骤四：Editor 占位页

1. 点击 "Navigate to /editor/ra" 按钮
2. 确认 URL pathname 变为 `/test/ch22-game-entry/router-navigation/editor/ra`
3. 确认显示 "Editor" 标题
4. 确认显示 "Coming soon — ra map editor"
5. 确认 "Back to Mod Selector" 链接可见（#6688ee）
6. 点击链接 → router.navigate() 回到首页

**预期**: 符合期望 4 → 继续

### 步骤五：未知路由

1. 点击 "Navigate to /unknown" 按钮
2. 确认 URL 徽章显示 "NO ROUTE"（红色）
3. 确认路由状态显示匹配模式 "(none)"，result "NO MATCH"
4. Router.dispatch() 返回 false（面板中体现为红色状态）

**预期**: 符合期望 5 → 继续

### 步骤六：浏览器后退/前进（popstate 事件）

1. 按顺序点击：首页 → play/ra → editor/ra → 首页
2. 按浏览器后退按钮 3 次 → 每次触发 Router 的 popstate listener
3. 确认每次后退路由状态正确更新
4. 按浏览器前进按钮 → 确认同样正确

### 边界/异常测试

1. **快速切换**: 连续点击首页→play→首页→editor→首页，5 次 → Router 每次正确 dispatch，ModSelector 无残留
2. **重复启动**: 连续点击 "Navigate to /play/ra" 3 次 → ModSelector.launchMod() 每次正确执行加载序列
3. **不同 modId**: 依次点击 play/ra, play/td → 确认文字中 modId 正确变化

---

## 结果判定

- [ ] 期望 1 通过（Router.dispatch 匹配首页，调用 ModSelector.show）
- [ ] 期望 2 通过（router.navigate → pushState + dispatch → launchMod）
- [ ] 期望 3 通过（ModSelector.launchMod 进度条序列正确）
- [ ] 期望 4 通过（Router 参数提取 + Editor 占位页）
- [ ] 期望 5 通过（Router dispatch 返回 false，NO ROUTE 徽章）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行或 /mods/_index.json 无法获取 → 记录 UA/视口/时间，重新启动 dev server 后复测 |

**审核状态**: NEEDS FIXES → 等待 Reviewer 复审
