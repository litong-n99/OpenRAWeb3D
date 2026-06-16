# Animation - 高级播放模式: PlayFetchIndex、ReplaceAnim 验证

> **人工验收测试页** | **状态: ACCEPTED** (验收日期: 2026-06-09)
> 模块: Animation (PlayFetchIndex, ReplaceAnim, GetRandomExistingSequence)
> 测试ID: `animation/animation-play-modes`
> OpenRA 对照: `Animation.ts` — PlayFetchIndex (tickAlways), ReplaceAnim (mod), GetRandomExistingSequence
> 创建日期: 2026-06-08 | 验收日期: 2026-06-09

---

## 测试目标

本测试页面验证 Animation 系统中 `animation-frame-switching` 未覆盖的 2 种播放模式。全 6 种模式覆盖状态：

| 模式 | 覆盖测试页 | 状态 |
|------|----------|------|
| PlayRepeating | animation-frame-switching | ACCEPTED |
| PlayThen | animation-frame-switching | ACCEPTED |
| PlayBackwardsThen | animation-frame-switching | ACCEPTED |
| PlayFetchDirection | animation-frame-switching | (部分) |
| **PlayFetchIndex** | **本测试页** | **待验收** |
| **ReplaceAnim** | **本测试页** | **待验收** |

关键验证点：

1. **PlayFetchIndex (tickAlways=true)**：每次 `Tick()` 直接调用外部函数获取帧索引，不累积时间。用于需要外部精确控制帧位置的场景（如构建进度条、血量条分段渲染）。正确性依赖于 tickAlways 标志和 func 的即时执行。
2. **ReplaceAnim**：切换序列时保持帧索引的相对位置（`frame %= newSequence.length`）。用于单位切换武器/状态时保持动画进度连续性。

---

## B. 期望结果（可量化验收标准）

### 期望 1: PlayFetchIndex — tickAlways=true，外部帧控制即时响应

**操作**: 默认模式（PlayFetchIndex），观察主动画面板。

**观察点**:
- 主面板显示序列标签（如 "WALK"）+ 帧编号（1-15）
- 帧编号每 **500ms** 自动前进一格（2 帧/秒自动推进）
- 帧切换时**不累积时间**：每 500ms 准时切换，不受帧间隔 40ms 限制
- 切换到「手动控制」模式后，拖动滑块，主面板帧应**即时跟随**滑块位置（<50ms）

**量化标准**:
| 检查项 | 预期行为 | 容差 |
|--------|---------|------|
| 自动推进周期 | 15 帧循环 = 7.5s (±0.5s) | 肉眼可辨循环节奏均匀 |
| 手动滑块响应 | < 50ms | 拖动滑块时帧同步切换 |
| tickAlways 行为 | 不等时间累积 | 与普通 Tick 的 40ms 间隔行为明显不同 |

**失败判定**: 若自动推进忽快忽慢 → 时间累积逻辑错误（MAJOR）。若手动滑块有可见延迟 → 事件处理阻塞（MAJOR）。

### 期望 2: ReplaceAnim — 序列替换保持帧位置（取模）

**操作**: 切换到「ReplaceAnim」模式，当前序列为 walk (15帧)，帧自动循环播放。点击「替换为 attack (8帧)」。

**观察点**:
- 若当前帧为 12（walk），替换后帧应为 `12 % 8 = 4`（attack）
- 预览条应**立即**从 15 个方块变为 8 个方块
- 活跃帧（高亮方块）位置应按比例调整
- 新序列的帧间隔从 40ms 变为 60ms（attack 的 tick）= 可见帧切换节奏变化

**量化标准**:
| 操作 | walk 帧 | 预期 attack 帧 | 验证方法 |
|------|---------|---------------|---------|
| walk(12) → attack | 12 | 4 (12%8=4) | 预览条高亮位置 + 主动画面板帧编号 |
| walk(7) → attack | 7 | 7 (7%8=7) | 同上 |
| walk(15) → attack | 15 (末帧) | 7 (15%8=7) | 同上 |
| attack(5) → idle | 5 | 1 (5%4=1) | idle 仅 4 帧 |

**失败判定**: 若换序列后帧索引从 0 重新开始（非取模）→ ReplaceAnim 逻辑错误（BLOCKER）。若序列长度不更新 → 状态管理错误（MAJOR）。

### 期望 3: ReplaceAnim 长序列到短序列取模

**操作**: 当前序列为 walk (15帧)，替换为 idle (4帧)。

**观察点**:
- walk 帧 10 → idle 帧 `10 % 4 = 2`
- walk 帧 14 → idle 帧 `14 % 4 = 2`
- 序列标签从 "WALK" 变为 "IDLE"
- 帧间隔从 40ms 变为 120ms（idle 的 tick = 3 倍慢）

**量化标准**: 取模结果精确匹配公式 `oldFrame % newLength`。

### 期望 4: 事件日志正确记录所有切换

**操作**: 执行一系列 ReplaceAnim 操作。

**观察点**:
- 每次替换都应产生日志条目
- 日志格式: `ReplaceAnim: walk(12/14) → attack(4/7) [12 % 8 = 4]`
- 日志区不溢出（最多 50 条），滚动到最新条目

**量化标准**:
| 检查项 | 预期 |
|--------|------|
| 日志格式 | 包含源序列名、旧帧/长度、目标序列名、新帧/长度、取模公式 |
| 响应延迟 | < 100ms（日志写入到显示） |

### 期望 5: FPS 稳定性

**操作**: 任意模式运行 10 秒。

**量化标准**: FPS >= 55（60Hz 显示器），无明显帧率波动（±5 fps 以内）。

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/animation/animation-play-modes/`
2. 确认环境信息栏显示 WebGL 2.0
3. 默认状态：PlayFetchIndex 模式，walk 序列，15 帧，自动推进（2 fps）

### 步骤一：PlayFetchIndex 自动推进验证

1. 观察主面板（左侧大方形区域）：
   - 显示绿色调 "WALK" 标签 + 帧编号（1, 2, 3, ...）
2. 用秒表或心中读秒，确认帧每秒切换两次（每 500ms）
3. 观察进度条（滑块下方红色条）：
   - 随帧推进从左到右填充
4. 观察预览条（右侧横向排列的小方块）：
   - 当前帧方块 **放大 1.4x**，非当前帧方块缩小到 **0.75x 且半透明**
5. 持续观察至少 2 个完整循环（30 帧 = 约 15 秒）
6. 确认帧编号在 15→1 时无缝衔接（无停顿）

**预期**: 符合期望 1 前半部分 → 继续

### 步骤二：PlayFetchIndex 手动控制验证

1. 点击「手动控制」按钮
2. 拖动帧索引滑块从 0 到 14
3. 主面板帧应**即时跟随**滑块位置（< 50ms）
4. 进度条与滑块位置一致
5. 预览条高亮跟随
6. 将滑块拖到最大值 14 → 主面板显示帧 15（walk 最末帧）
7. 将滑块拖到 0 → 主面板显示帧 1
8. 切回「自动推进」

**预期**: 符合期望 1 后半部分 → 继续

### 步骤三：ReplaceAnim — walk → attack

1. 模式切换到「ReplaceAnim」
2. 观察帧自动循环（walk 序列，15 帧，40ms 间隔 = 快速）
3. 等待当前帧到达约第 10 帧（观察预览条高亮位置）
4. 点击「替换为 attack (8帧)」
5. 验证：
   - 主面板标签变为红色 "ATK"
   - 帧编号变化：原 walk 帧 10 → attack 帧 `10 % 8 = 2`
   - 预览条从 15 个方块缩减为 8 个
   - 帧切换节奏变慢（attack tick=60ms vs walk tick=40ms）
6. 检查事件日志：应有 ReplaceAnim 条目，格式正确

**预期**: 符合期望 2 → 继续

### 步骤四：ReplaceAnim — attack → idle

1. 当前 attack 序列运行中，等待帧约在第 5 帧
2. 点击「替换为 idle (4帧)」
3. 验证：
   - attack 帧 5 → idle 帧 `5 % 4 = 1`
   - 预览条缩减为 4 个方块
   - 帧切换更慢（idle tick=120ms）
4. 点击「当前序列: walk」回到 walk
   - idle 帧 N → walk 帧 `N % 15`
   - 预览条恢复 15 个方块

**预期**: 符合期望 3 → 继续

### 步骤五：连续快速替换

1. 快速连续点击：attack → idle → deploy → walk → attack（每个间隔约 0.5 秒）
2. 验证每次替换后帧索引都正确取模
3. 检查事件日志：每次替换均有记录
4. 不应出现崩溃或帧显示异常

### 边界/异常测试

1. **取模边界 0**：walk 帧 0 → attack 帧 `0 % 8 = 0`（首帧）
2. **取模边界 N-1**：walk 帧 15（=length）在循环中不会出现，但测试 walk 帧 14 → attack 帧 `14 % 8 = 6`
3. **同序列替换**：attack → attack（同序列）→ 无变化，无崩溃
4. **无 tickAlways 的 replaceAnim**：确认序列替换后 tickAlways=false 不变
5. **滑块越界**：在 fetchIndex 模式，帧索引滑块卡在 max，拖动不超出

---

## 结果判定

- [x] 期望 1 通过（PlayFetchIndex tickAlways + 手动滑块即时响应）
- [x] 期望 2 通过（ReplaceAnim walk→attack 取模正确）
- [x] 期望 3 通过（ReplaceAnim 长→短序列取模）
- [x] 期望 4 通过（事件日志格式正确）
- [x] 期望 5 通过（FPS >= 55）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 所有 5 项期望 + 边界测试全部通过 |
| ~~ACCEPTED WITH ISSUES~~ | ~~所有期望通过，但边界测试有 1-2 项异常（记录为 MINOR）~~ |
| ~~REJECTED~~ | ~~任一期望未通过 → 记录具体差异，提交 issue~~ |

### 验收结论

**ACCEPTED** -- 所有 5 项期望全部通过，边界测试（取模边界 0、取模边界 N-1、同序列替换、无 tickAlways 的 replaceAnim、滑块越界）均表现正常。

验收日期: 2026-06-09 | 验收人: Acceptance Tester

---

## 技术背景

### Animation 6 种播放模式覆盖总表

| # | 模式 | 关键行为 | tickAlways | 测试页 |
|:---:|:---|:---|:---:|:---|
| 1 | PlayRepeating | 正向循环，末尾归零 | false | animation-frame-switching |
| 2 | PlayThen | 正向一次，末帧停止+回调 | false | animation-frame-switching |
| 3 | PlayBackwardsThen | 反向一次，首帧停止+回调 | false | animation-frame-switching |
| 4 | PlayFetchIndex | 每 Tick 调用 func 获取帧索引 | **true** | **本页** |
| 5 | PlayFetchDirection | 根据方向回调前进/后退 | false | animation-frame-switching |
| 6 | ReplaceAnim | 切换序列，frame %= newLen | 保持 | **本页** |

### PlayFetchIndex 的 Tick 行为差异

```
// tickAlways=false (普通模式):
Tick(dt): timeUntilNextFrame -= dt; while (<=0) { tickFunc(); += seqTick }

// tickAlways=true (PlayFetchIndex):
Tick(dt): tickFunc()  // 直接调用，不等时间累积
```

这意味在 60fps 渲染循环下，PlayFetchIndex 每 16.67ms 调用一次 func，帧切换频率**完全由外部函数控制**，与序列的 tick 参数无关。
