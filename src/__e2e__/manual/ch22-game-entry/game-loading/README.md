# Ch22 Game Entry - 游戏加载管线

> **人工验收测试页**
> 模块: Game (根协调器), ModSelector.launchMod() (Mod 启动)
> 测试ID: `ch22-game-entry/game-loading`
> OpenRA 对照: `Game.ts` — create(), initializeEngine(), loadMod(), loadShellMap(), dispose()
> 创建日期: 2026-06-18

---

## 测试目标

本测试页面验证 Chapter 22 Phase B 的 Game 类加载管线。Game.create() 是应用启动的核心入口，其 8 阶段加载序列连接了 Renderer/Manifest/FileSystem/ModData/OrderManager/Shellmap 六大子系统。本测试模拟完整管线（无 WebGL 依赖），视觉化展示每个阶段的进度、文字、时序、状态转换和 dispose 清理。

关键验证点：
1. **加载进度条**: 8 阶段序列，每阶段有正确的百分比和加载文字
2. **Shellmap 背景**: Phase 1 回退的深色背景色
3. **Dispose 序列**: 逆序销毁全部子系统
4. **错误处理**: 不存在的 mod 触发 HTTP 404 错误流程

---

## B. 期望结果（可量化验收标准）

### 期望 1: 8 阶段进度条序列

**操作**: 点击 "启动加载 (Auto-run)" 按钮，观察加载流程。

**量化标准**:

| 阶段 # | 阶段名称 | 进度 | 加载文字 | GameState | 间隔 |
|--------|---------|------|---------|-----------|------|
| 1 | Initialize Engine | 15% | "Loading engine..." | LoadingMod | ~200ms |
| 2 | Load Manifest | 25% | "Loading mod manifest..." | LoadingMod | ~300ms |
| 3 | Mount FileSystem | 35% | "Mounting filesystem..." | LoadingMod | ~200ms |
| 4 | Init ModData | 50% | "Initializing ModData..." | LoadingMod | ~250ms |
| 5 | Load RuleSet | 65% | "Loading rule set..." | LoadingMod | ~300ms |
| 6 | Create OrderManager | 75% | "Creating OrderManager..." | Shellmap | ~200ms |
| 7 | Load Shellmap | 90% | "Loading shellmap..." | Shellmap | ~350ms |
| 8 | Ready | 100% | "Ready" | Shellmap | 0ms（最终状态） |

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 总加载时间 | 1.6s - 2.2s | - |
| 进度条过渡 | width 变化带 0.4s ease CSS transition | - |
| 进度条颜色 | linear-gradient(90deg, #4466cc, #6688ee) | - |
| 进度条高度 | 8px，圆角 4px | - |
| 阶段圆点颜色 | 灰色(#333) → 蓝色(#4466cc, 带辉光) → 绿色(#4caf50) | - |
| 阶段连接线颜色 | 灰色(#2a2a4e) → 绿色(#4caf50) | - |
| 右侧面板状态 | 实时显示 当前阶段、进度%、状态、Mod ID、耗时 | - |
| 详细日志 | 每次阶段切换都在底部日志面板追加一条记录 | - |

### 期望 2: Shellmap Phase 1 背景色

**操作**: 等待加载完成（阶段 6+），观察预览区域背景。

**量化标准**:

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 背景色 RGB | rgb(13, 13, 26) | ±1 per channel |
| 背景色 Hex | #0d0d1a | 精确匹配 |
| Babylon.js 等效 | Color4(0.05, 0.05, 0.1, 1.0) | - |
| clearColor 文字标签 | 显示 "rgb(13,13,26) #0d0d1a | Color4(0.05, 0.05, 0.1, 1.0)" | - |
| 背景过渡时间 | 0.5s ease | - |
| 加载遮罩消失 | Ready 阶段后 300ms 内 fade out (opacity 0, pointer-events: none) | - |
| 视觉效果 | 深色带蓝色调，符合经典 RTS 主菜单美学（ADR-22.5） | - |

> **颜色来源**: `Game.ts:590` — `this.renderer.worldScene.clearColor = new Color4(0.05, 0.05, 0.1, 1.0)`。 转换关系: Color4(0.05, 0.05, 0.1) → sRGB = (0.05 * 255, 0.05 * 255, 0.1 * 255) ≈ (13, 13, 26)。

### 期望 3: Dispose 逆序清理

**操作**: 加载完成后点击 "Dispose (模拟销毁)" 按钮。

**量化标准**:

| # | 子系统 | fieldName | 间隔 | 视觉效果 |
|:---:|--------|----------|------|---------|
| 1 | World | this._world | ~80ms | 红色删除线动画 |
| 2 | WorldRenderer | this._worldRenderer | ~80ms | 红色删除线动画 |
| 3 | OrderManager | this.orderManager | ~80ms | 红色删除线动画 |
| 4 | Sound | this.sound | ~80ms | 红色删除线动画 |
| 5 | ModData | this.modData | ~80ms | 红色删除线动画 |
| 6 | Renderer | this.renderer | ~80ms | 红色删除线动画 |
| + | _currentGame | 单例引用清除 | ~100ms | 日志输出 |

| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 总 dispose 时间 | 480ms - 600ms | - |
| 单步间隔 | 80ms | ±20ms |
| 销毁顺序 | 严格逆序（World→WorldRenderer→OrderManager→Sound→ModData→Renderer） | 精确匹配 |
| disposeOverlay 显示 | 红色半透明覆盖层 + "DISPOSING" 标题 | - |
| Shellmap 背景变化 | loaded 类被移除，背景变为 #1a0a0a | - |
| 右侧面板状态 | stateStatus 变为 "DISPOSED" | - |
| 按钮状态 | Start + Step 按钮 disabled | - |

> **逆序要求**: Game.dispose() 在 `Game.ts:655-684` 中明确定义了逆序释放，确保被依赖者在依赖者之前存活（如 WorldRenderer 的 Scene 由 Renderer 管理）。顺序错误可能导致依赖断裂。

### 期望 4: 单步加载模式

**操作**: 连续点击 "单步加载 (Step)" 按钮 8 次。

**量化标准**:

| 点击次数 | 当前阶段 | 进度 |
|:--------:|---------|------|
| 1 | 1/8: Initialize Engine | 15% |
| 2 | 2/8: Load Manifest | 25% |
| 3 | 3/8: Mount FileSystem | 35% |
| 4 | 4/8: Init ModData | 50% |
| 5 | 5/8: Load RuleSet | 65% |
| 6 | 6/8: Create OrderManager | 75% |
| 7 | 7/8: Load Shellmap | 90% |
| 8 | 8/8: Ready | 100% |

每次点击后：
- 阶段圆点立即更新（灰→蓝→绿，50ms 内）
- 进度条文字和百分比同步更新（0ms 延迟）
- 日志追加新条目
- 第 7 次点击后 Shellmap 背景变化；第 8 次后 300ms 内遮罩消失

### 期望 5: 错误处理（Nonexistent Mod）

**操作**: 在下拉菜单中选择 "Nonexistent (error test)"，点击 "启动加载"。

**量化标准**:

| 检查项 | 预期值 |
|--------|--------|
| 初始化阶段 | Initialize Engine 仍完成（阶段 1 亮起，15%） |
| 失败阶段 | Load Manifest 阶段标记错误（红点 #e94560） |
| 进度条变红 | progress bar 背景变为 #e94560 |
| 错误文字 | "Error: Failed to load mod 'NONEXISTENT': HTTP 404" |
| 错误显示时间 | 失败发生 200ms 内显示 |
| 错误子文字 | "fetch('/mods/NONEXISTENT/mod.json') → 404 Not Found" |
| 状态显示 | stateStatus = "ERROR" |
| 恢复提示 | 日志显示 "ModSelector.launchMod() 将在 3s 后自动 hide() 返回选择器" |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch22-game-entry/game-loading/`
2. 确认环境信息栏显示 "纯 DOM (模拟)" 渲染引擎
3. 确认下拉菜单默认选中 "Red Alert (ra)"
4. 确认右侧面板状态显示 IDLE

### 步骤一：自动加载全流程（Auto-Run）

1. 保持默认选中 "Red Alert (ra)"
2. 点击 "启动加载 (Auto-run)" 按钮
3. 观察：
   - 阶段圆点依次从灰色→蓝色→绿色
   - 连接线依次变绿
   - 进度条从 0% 平滑增长到 100%
   - 加载文字依次变化：Loading engine → Loading mod manifest → ... → Ready
4. 确认 8 个阶段全部完成后：
   - 加载遮罩 fade out
   - Shellmap 背景变为深蓝色 (#0d0d1a)
   - 右侧面板自动检查 #1, #2, #3 全部绿色
5. 确认总耗时在 1.6s - 2.2s 范围内
6. 确认日志面板记录了每个阶段的详细信息

**预期**: 符合期望 1+2 → 继续

### 步骤二：Shellmap 背景色验证

1. 加载完成后，观察预览区域的背景色
2. 使用浏览器 DevTools 取色器确认背景色为 rgb(13, 13, 26) / #0d0d1a
3. 确认右下角标签显示完整的颜色信息
4. 确认背景有蓝色调（非纯黑）

**预期**: 符合期望 2 → 继续

### 步骤三：Dispose 清理验证

1. 在加载完成状态下点击 "Dispose (模拟销毁)" 按钮
2. 观察红色 DISPOSING 覆盖层出现
3. 观察子系统逐个出现并标记为删除（红色删除线）：
   - World → WorldRenderer → OrderManager → Sound → ModData → Renderer
4. 确认顺序严格为逆序
5. 确认全部 6 个子系统显示为 "✓ disposed"
6. 确认总时间约 480-600ms
7. 确认右侧面板自动检查 #4 变绿

**预期**: 符合期望 3 → 继续

### 步骤四：单步加载验证

1. 点击 "重置" 按钮
2. 连续点击 "单步加载 (Step)" 按钮 8 次
3. 每点击一次：
   - 确认阶段名称和编码动作文字正确更新
   - 确认进度百分比正确递增
   - 确认阶段圆点颜色正确变化
4. 第 7 次点击后确认 Shellmap 背景变为 #0d0d1a
5. 第 8 次点击后确认进度条到达 100%，遮罩消失
6. 确认右侧面板自动检查 #1, #2, #3 全部绿色

**预期**: 符合期望 4 → 继续

### 步骤五：错误处理验证

1. 点击 "重置" 按钮
2. 下拉菜单选择 "Nonexistent (error test)"
3. 点击 "启动加载 (Auto-run)"
4. 观察：
   - Initialize Engine 阶段完成（阶段 1 亮蓝色，15%）
   - Load Manifest 阶段失败（阶段 2 亮红色 #e94560）
   - 进度条变为红色
   - 错误文字显示 HTTP 404
5. 确认右侧面板自动检查 #5 变绿
6. 确认按钮状态：Dispose 保持 disabled（未成功加载无法 dispose）

**预期**: 符合期望 5 → 继续

### 步骤六：不同 Mod 切换测试

1. 重置后选择 "Tiberian Dawn (td)"
2. 执行自动加载完整流程
3. 确认加载文字中 modId 正确显示
4. 确认右侧面板 Mod ID 显示 "td"
5. 重置后选择 "Test Mod (_test)"
6. 执行自动加载 → 确认 _test mod 也可正确完成流程

### 边界/异常测试

1. **快速 Reset 复载**: 自动加载 → Reset → 自动加载，连续 5 次 → 每次状态正确重置，无残留
2. **Step 溢出**: 自动加载完成后按 Step → 无效果（按钮禁用或无视）
3. **Dispose 重复点击**: Dispose 完成后再次点击 → 日志显示 "已 Dispose，请先 Reset"
4. **加载中 Reset**: 自动加载执行到一半时按 Reset → 所有状态正确归零
5. **快捷键测试**: 按 S → 自动加载；按 R → 重置；按 N → 单步；按 D → Dispose
6. **面板状态同步**: 每次操作后确认右侧面板状态与视觉一致

---

## 结果判定

- [ ] 期望 1 通过（8 阶段进度条序列完整且正确）
- [ ] 期望 2 通过（Shellmap 背景色 #0d0d1a 正确）
- [ ] 期望 3 通过（6 个子系统逆序 dispose，总时间 480-600ms）
- [ ] 期望 4 通过（单步加载 8 次完整覆盖全部阶段）
- [ ] 期望 5 通过（Nonexistent mod 触发 HTTP 404 错误流程）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行或浏览器不支持 CSS transition → 记录 UA/视口/时间，重新测试 |

---

## 测试覆盖的 Game.ts 方法映射

| Game.ts 方法 | 模拟阶段 | 验证内容 |
|-------------|---------|---------|
| `initializeEngine(canvas)` | Stage 1 | Engine + Renderer 创建，游戏循环启动 |
| `loadMod(modId)` — fetch manifest | Stage 2 | HTTP fetch → Manifest 解析 |
| `loadMod(modId)` — mount FS | Stage 3 | FileSystem 挂载路径 |
| `loadMod(modId)` — ModData.init | Stage 4 | 依赖验证 + ObjectCreator |
| `loadMod(modId)` — loadRuleSet | Stage 5 | 规则集加载 |
| `loadMod(modId)` — OrderManager | Stage 6 | EchoConnection + OrderManager |
| `loadShellMap()` | Stage 7 | Phase 1 clearColor 设置 |
| (ready state) | Stage 8 | Shellmap 就绪 |
| `dispose()` | Dispose Steps 1-7 | 逆序销毁 + 单例清除 |
| (error: HTTP 404) | Error mode | fetch 失败的期望行为 |

---

## 管线阶段与 ADR 对照

| ADR | 相关阶段 | 说明 |
|-----|---------|------|
| ADR-22.1 (实例化 Game) | All | Game 是实例类，create() 工厂方法 |
| ADR-22.4 (静态文件 Mod) | Stage 2, 3 | mod.json 通过 fetch() 加载 |
| ADR-22.5 (Shellmap 分阶段) | Stage 7 | Phase 1 静态背景回退 |

**审核状态**: 待 Reviewer 审核
