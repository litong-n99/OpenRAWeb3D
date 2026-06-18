# Ch22 Game Entry - Editor 占位页验证

> **人工验收测试页**
> 模块: Router + Editor Route Handler (Editor 占位页)
> 测试ID: `ch22-game-entry/editor-stub`
> OpenRA 对照: `src/main.ts` — `router.on('/editor/:modId', ...)`
> 创建日期: 2026-06-18

---

## 测试目标

本测试页面验证 Chapter 22 Phase A 的 Editor 占位路由。当用户导航到 `/editor/:modId` 时，系统应显示一个简单的占位页面，包含标题、描述和返回 Mod 选择器的链接。这是 Phase D（完整编辑器实现）之前的临时占位。

---

## B. 期望结果（可量化验收标准）

### 期望 1: Editor 页面基本渲染

**操作**: 页面加载（默认显示 `/editor/ra`）或点击 Editor 按钮。

**量化标准**:
| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 标题文本 | "Editor" | 精确匹配 |
| 标题字号 | 2.2rem (35.2px) | - |
| 标题颜色 | #eee | - |
| 标题字重 | 700 (bold) | - |
| 描述文本 | "Coming soon — ra map editor"（含对应 modId） | 精确匹配 |
| 描述颜色 | #aaa | - |
| URL 路径 | /editor/ra | 精确匹配 |
| 路由模式 | /editor/:modId | - |
| 路由参数 | { "modId": "ra" } | - |

### 期望 2: 返回链接

**操作**: 观察 "Back to Mod Selector" 链接。

**量化标准**:
| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 链接文本 | "Back to Mod Selector" | 精确匹配 |
| 链接颜色 | #6688ee (rgb(102, 136, 238)) | ±2 per channel |
| 悬停颜色 | #88aaff | - |
| 悬停下划线 | text-decoration: underline | - |
| 过渡时间 | 0.2s (color transition) | - |
| 点击行为 | 导航回 Mod 选择器首页，4 张卡片渲染 | - |

### 期望 3: 不同 modId 动态渲染

**操作**: 依次点击 /editor/ra、/editor/td、/editor/d2k 按钮。

**量化标准**:
| modId | 预期描述文本 | URL 路径 |
|-------|-------------|----------|
| ra | "Coming soon — ra map editor" | /editor/ra |
| td | "Coming soon — td map editor" | /editor/td |
| d2k | "Coming soon — d2k map editor" | /editor/d2k |

每次切换应在 50ms 内完成 DOM 更新。

### 期望 4: 往返导航一致性

**操作**: 从 Editor 返回首页，再重新进入 Editor。

**量化标准**:
- 从 Editor 点击 "Back to Mod Selector" → 显示完整 Mod 选择器（标题 + 4 张卡片）
- URL 更新为 `/`，路由状态重置
- 再次进入 Editor → 重新渲染 Editor 占位页（无残留 DOM）
- 来回切换 5 次 → 无内存泄漏迹象（DOM 节点数不增长）

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch22-game-entry/editor-stub/`
2. 确认浏览器地址栏显示 MATCHED 徽章（绿色）
3. 默认状态：显示 `/editor/ra` 的 Editor 占位页

### 步骤一：基本渲染

1. 观察页面中央显示的 "Editor" 标题
2. 确认标题下方显示 "Coming soon — ra map editor"
3. 确认 "Back to Mod Selector" 链接在描述下方
4. 检查右侧面板的自动检查：4 个指标应全部显示绿色圆点

**预期**: 符合期望 1+2 → 继续

### 步骤二：modId 切换

1. 点击 "Editor: /editor/td" 按钮
2. 确认描述文本变为 "Coming soon — td map editor"
3. 确认 URL 显示变为 `/editor/td`
4. 路由状态显示 `{ "modId": "td" }`
5. 点击 "Editor: /editor/d2k" 按钮
6. 确认描述文本变为 "Coming soon — d2k map editor"
7. 确认 URL 显示变为 `/editor/d2k`

**预期**: 符合期望 3 → 继续

### 步骤三：返回链接测试

1. 在当前 Editor 页面，点击 "Back to Mod Selector" 链接
2. 确认页面切换到 Mod 选择器
3. 确认显示 "OpenRAWeb3D" 标题
4. 确认 4 张 Mod 卡片渲染
5. 确认 URL 显示变为 `/`

**预期**: 符合期望 2+4 → 继续

### 步骤四：往返导航

1. 在 Mod 选择器页面，点击 "Editor: /editor/ra" 按钮
2. 确认 Editor 页面正确渲染
3. 再次点击 "← Back to Mod Selector" 按钮
4. 重复 3 次
5. 确认每次切换都干净利落，无残留元素

**预期**: 符合期望 4 → 继续

### 步骤五：链接悬停效果

1. 在 Editor 页面，鼠标悬停在 "Back to Mod Selector" 链接上
2. 确认颜色从 #6688ee 变为 #88aaff
3. 确认出现下划线
4. 鼠标移开 → 颜色恢复，下划线消失

### 边界/异常测试

1. **空 modId**: 导航到 `/editor/`（无 modId）→ 路由不应匹配，显示 NO ROUTE
2. **特殊字符 modId**: 导航到 `/editor/test-v2_sub` → 应正确渲染带特殊字符的描述
3. **快速切换**: 在 ra → td → d2k 之间快速切换 10 次 → 无闪烁，无渲染异常

---

## 结果判定

- [ ] 期望 1 通过（Editor 页面基本渲染正确）
- [ ] 期望 2 通过（返回链接样式和功能正确）
- [ ] 期望 3 通过（不同 modId 动态渲染正确）
- [ ] 期望 4 通过（往返导航一致性）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行或 /mods/_index.json 无法获取 → 记录 UA/视口/时间，重新启动 dev server 后复测 |

**审核状态**: NEEDS FIXES → 等待 Reviewer 复审
