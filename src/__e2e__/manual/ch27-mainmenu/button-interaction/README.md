# Ch27 Main Menu - 按钮交互行为

> **人工验收测试页**
> 模块: Game.ts 主菜单按钮 — hover/click/disabled 交互
> 测试ID: `ch27-mainmenu/button-interaction`
> OpenRA 对照: `Game.ts` — _showMainMenuDomOverlay() 按钮 onClick 处理器, _wireMainMenuButtonsOnWidgetTree()
> 创建日期: 2026-06-20
> **审核状态**: ✅ 全部审核通过

---

## 测试目标

验证主菜单按钮的完整交互行为链：hover 视觉反馈、active 按下反馈、disabled 无交互、点击事件路由到正确的游戏状态转换。这是 ADR-27.1 中按钮交互的核心验收点——无论 Widget 还是 DOM 路径，按钮的行为必须一致。

关键验证点：
1. **hover 反馈**: background 渐变变化 + border 高亮 + box-shadow 辉光，150ms 内完成
2. **active 反馈**: transform scale(0.98) + 背景变暗
3. **disabled 状态**: Multiplayer 按钮 pointer-events: none + cursor: not-allowed
4. **点击路由**: Skirmish → _openSkirmishSetup(), Settings → _openSettingsPanel(), Exit → _exitToModSelector()
5. **Escape 键**: 触发返回 Mod 选择器的导航

---

## B. 期望结果（可量化验收标准）

### 期望 1: hover 视觉反馈

**操作**: 将鼠标悬停在 Skirmish 按钮上。

**量化标准**:

| 属性 | 常态值 | hover 值 | 过渡时间 |
|------|--------|---------|---------|
| background | linear-gradient(135deg, #334488, #4466cc) | linear-gradient(135deg, #4466cc, #5577ee) | 0.15s ease |
| border-color | rgba(100,100,180,0.4) | rgba(120,140,220,0.6) | 0.15s ease |
| box-shadow | none | 0 0 8px rgba(100,140,220,0.3) | 0.15s ease |

> 视觉上可感知的亮度增加（#4466cc → #5577ee 的渐变终点），边框从暗蓝变为亮蓝，并出现蓝色辉光。

### 期望 2: active 按下反馈

**操作**: 鼠标按下 Skirmish 按钮（mousedown）。

**量化标准**:

| 属性 | 常态值 | active 值 |
|------|--------|----------|
| transform | scale(1) | scale(0.98) |
| background | linear-gradient(135deg, #334488, #4466cc) | linear-gradient(135deg, #223366, #334488) |

> 按钮明显向内缩进 2%，背景色变暗约 20%。鼠标松开后立即恢复常态。

### 期望 3: 单击计数

**操作**: 依次点击 Skirmish、Settings、Exit 按钮各 3 次。

**量化标准**:

| 按钮 | 点击 3 次后徽章数字 | 统计面板数字 |
|------|-------------------|------------|
| Skirmish | 3 | stat-skirmish = 3 |
| Settings | 3 | stat-settings = 3 |
| Exit | 3 | stat-exit = 3 |
| Total | - | stat-total = 9 |

> 每点击一次，徽章数字立即 +1（50ms 内更新），同时有点击 pulse 动画。

### 期望 4: disabled 按钮无交互

**操作**: 尝试 hover 和点击 Multiplayer 按钮。

**量化标准**:

| 属性 | 预期值 |
|------|--------|
| pointer-events | none |
| cursor | not-allowed |
| hover 样式变化 | 无变化（background 保持 rgba(40,40,60,0.5)） |
| 点击效果 | 无响应（点击不计入计数器） |

> 鼠标悬停时样式不应有任何变化（无渐变、无辉光、无边框高亮）。

### 期望 5: 事件日志完整性

**操作**: hover 并点击任意按钮。

**量化标准**:

| 日志类型 | 颜色 | 最小字段 |
|---------|------|---------|
| hover | 蓝色 (#88aaff) | 时间戳、按钮名、背景信息 |
| click | 绿色 (#4caf50) | 时间戳、按钮名、目标方法 |
| action | 黄色 (#ffd966) | 时间戳、操作描述 |
| error | 红色 (#e94560) | 时间戳、错误描述 |

> 时间戳格式: HH:MM:SS.mmm，精确到毫秒。

### 期望 6: Escape 键模拟

**操作**: 按 Escape 键或点击 "模拟 Escape 键" 按钮。

**量化标准**:

| 日志条目 | 内容 |
|---------|------|
| 第 1 条 | `[action] Escape 键模拟 → _exitToModSelector()` |
| 第 2 条 | `[action] → history.pushState(null, "", "/")` |
| 第 3 条 | `[action] → window.dispatchEvent(new PopStateEvent("popstate"))` |

> 模拟 Game._exitToModSelector() 的完整导航序列。

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch27-mainmenu/button-interaction/`
2. 确认环境信息栏显示 "纯 DOM + CSS" 引擎
3. 确认 sandbox 区域显示 4 个按钮（Skirmish, Multiplayer, Settings, Exit）
4. 确认 Multiplayer 按钮显示为暗灰色（disabled 状态）

### 步骤一：hover 视觉反馈验证

1. 将鼠标缓慢移动到 Skirmish 按钮上方
2. 观察按钮背景颜色变化：蓝色渐变变亮
3. 观察按钮边框颜色变化：从暗蓝变为亮蓝
4. 观察按钮周围出现蓝色辉光 (box-shadow)
5. 确认变化在瞬间完成（视觉上 < 150ms）
6. 确认事件日志中出现 `[hover] Skirmish — hover enter`
7. 将鼠标移开
8. 确认样式恢复，日志出现 `[hover] Skirmish — hover leave`

**预期**: 符合期望 1 → 继续

### 步骤二：active 按下反馈验证

1. 在 Skirmish 按钮上按下鼠标（不松开）
2. 观察按钮轻微缩小 (scale 0.98)
3. 观察背景色变暗（#223366→#334488）
4. 松开鼠标
5. 确认按钮立即恢复原大小和颜色

**预期**: 符合期望 2 → 继续

### 步骤三：单击计数验证

1. 点击 Skirmish 按钮 1 次
2. 确认按钮上的徽章数字从 "0" 变为 "1"
3. 确认右侧统计面板中 Skirmish 从 0 → 1, Total 从 0 → 1
4. 确认事件日志出现 `[click] Skirmish 按钮被点击 → _openSkirmishSetup()`
5. 再点击 Skirmish 2 次 → 确认徽章数字依次变为 2、3
6. 依次点击 Settings 2 次 → 徽章 0→1→2
7. 点击 Exit 1 次 → 徽章 0→1
8. 确认右侧统计面板: Skirmish=3, Settings=2, Exit=1, Total=6

**预期**: 符合期望 3 → 继续

### 步骤四：disabled 按钮验证

1. 将鼠标移动到 Multiplayer 按钮上方
2. 确认鼠标样式变为 not-allowed（禁止图标）
3. 确认按钮样式没有任何变化（无渐变、无辉光）
4. 点击 Multiplayer 按钮
5. 确认无反应，徽章数字不变，Total 不变
6. 确认日志中如有记录也是 `[error] Multiplayer 按钮被点击（不应该触发）`

**预期**: 符合期望 4 → 继续

### 步骤五：Escape 键验证

1. 按下键盘 Escape 键
2. 确认事件日志出现 3 条 Escape 相关日志
3. 或点击 "模拟 Escape 键" 按钮 → 同样效果

**预期**: 符合期望 6 → 继续

### 步骤六：自动测试序列

1. 点击 "重置计数器" 按钮
2. 点击 "自动测试（模拟 hover + click 序列）"
3. 观察自动测试逐次 hover + click 每个按钮
4. 确认计数器正确递增（每个按钮被自动点击 1 次）
5. 确认自动测试也验证了 disabled 按钮（尝试 hover + click Multiplayer）
6. 结束时确认: Skirmish=1, Settings=1, Exit=1, Total=3
7. 确认自动检查面板全部 6 个指标为绿色

**预期**: 符合期望 1-5 全部 → 继续

### 边界/异常测试

1. **快速连续点击**: 在 1 秒内连续点击 Skirmish 按钮 10 次 → 计数器正确显示 10，无丢帧
2. **快速 hover 切换**: 鼠标在 Skirmish 和 Settings 之间快速移动 → 日志准确记录每次 enter/leave
3. **同时 hover + 按键**: hover 在 Skirmish 上时按 Escape → 两条日志均正常
4. **重置后再操作**: 重置计数器 → 确认所有数字归零 → 再次点击 → 从 1 开始计数
5. **清空日志不影响计数**: 清空日志 → 计数器保持 → 再点击 → 新日志追加，计数器继续累加

---

## 结果判定

- [ ] 期望 1 通过（hover 视觉反馈：渐变 + 高亮 + 辉光，150ms 内）
- [ ] 期望 2 通过（active 按下反馈：scale(0.98) + 背景变暗）
- [ ] 期望 3 通过（单击计数正确，徽章实时更新）
- [ ] 期望 4 通过（disabled 按钮无交互）
- [ ] 期望 5 通过（事件日志完整性：时间戳 + 类型 + 内容）
- [ ] 期望 6 通过（Escape 键模拟正确）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 6 项期望通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行 → 记录 UA/视口/时间，重新测试 |

---

## 按钮交互映射到 Game.ts 方法

| 按钮 | Game.ts 目标方法 | 测试中显示 |
|------|-----------------|----------|
| Skirmish | `_openSkirmishSetup()` | 日志 + 计数 |
| Settings | `_openSettingsPanel()` | 日志 + 计数 |
| Exit | `_exitToModSelector()` | 日志 + 计数 + Escape 键 |
| Multiplayer | N/A (disabled) | 无响应验证 |
