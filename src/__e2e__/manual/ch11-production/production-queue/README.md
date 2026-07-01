# Production Queue — Acceptance Test

**Module**: ProductionQueue.ts + ClassicProductionQueue.ts (Chapter 11 Phase B)
**Test Case ID**: `ch11-production/production-queue`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Player/ProductionQueue.cs` (813 lines), `ClassicProductionQueue.cs` (161 lines)
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Player/ProductionQueue.ts`, `ClassicProductionQueue.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-01, 10/10 通过, 100%)

---

## 期望结果

### E1. Progress Bar Fills Linearly from 0% to 100%

| # | 期望 | 量化指标 |
|---|------|---------|
| E1.1 | 队首物品的生产进度条从 0% 开始，随时间线性增长至 100% | `getProgressPercent()` 在 1x 速度下每秒增加 100/time 个百分点。以 Medium Tank (15s) 为例：3s 时 ≈20.0%，7.5s 时 ≈50.0%，12s 时 ≈80.0% |
| E1.2 | 进度条颜色随进度变化：0-30% 蓝色 (#3498db)，30-70% 黄色 (#f39c12)，70-100% 绿色 (#2ecc71) | 目测进度条颜色在阈值处切换 |
| E1.3 | 进度条宽度更新≤300ms 延迟（含渲染帧） | 视觉上感觉连续渐变，无跳变/卡顿 |

### E2. Countdown Timer Shows Correct Remaining Seconds

| # | 期望 | 量化指标 |
|---|------|---------|
| E2.1 | 每个队列物品显示剩余秒数，精确到 0.1s | `getTimeRemaining()` 返回值与理论值偏差 ≤0.5s。例如 Infantry (5s) 在开始时显示 `5.0s`，在 2.5s 后显示 `2.5s` |
| E2.2 | 倒计时颜色为红色 (#e74c3c)，表示紧迫感 | 目测 timer 文字为红色 |
| E2.3 | 物品完成后 timer 消失，显示 "READY" 标签 | `remainingTime === 0` 时 UI 显示 READY 而非计时器 |

### E3. Ready Item Pulses with Glow Oscillating Every 1 Second

| # | 期望 | 量化指标 |
|---|------|---------|
| E3.1 | 物品完成后，工厂 3D 模型开始脉冲发光，周期为 2 秒（1 秒亮→1 秒暗） | `isReadyPulsing()` 在 sin 值 > 0.1 时返回 true，每 2 秒切换 2 次 |
| E3.2 | 脉冲期间工厂散发绿色发光 (#2ecc71 色调)，chimney 顶部散发橙红色 | 目测工厂边缘呈现绿色发光，chimney 有橙红色光晕 |
| E3.3 | 脉冲在无 ready 物品时立即停止 | 取消最后一个 ready 物品后，`isReadyPulsing()` 返回 false |

### E4. Cancel Triggers Cost Refund

| # | 期望 | 量化指标 |
|---|------|---------|
| E4.1 | 取消未完成的物品时，Feedback 栏显示 "Refunded $N"，N = cost × (1 - progress) × 0.75 | 例如 Medium Tank ($800), 进度 50%: 退款 $800 × 0.5 × 0.75 = $300 |
| E4.2 | 已完成的物品取消时不退款（显示 "no refund"） | Feedback 栏显示 "already complete, no refund" |
| E4.3 | 退款后物品从队列中消失，不再占据位置 | `getQueueItems().length` 减少 1 |

### E5. Cancel Head-of-Queue Triggers Reorder; Next Item Starts Progressing

| # | 期望 | 量化指标 |
|---|------|---------|
| E5.1 | 取消队首物品后，原第 2 项变为队首，其进度开始推进 | `getProgressPercent()` 从新队首的剩余进度开始增长 |
| E5.2 | 取消操作后 UI 立即重排（300ms 内），旧队首消失，新队首移至顶部 | 目测列表重排无闪烁 |
| E5.3 | 取消队中物品（非队首）不影响队首的进度 | `getProgressPercent()` 不受中间取消影响，连续增长 |

---

## 检验流程

### 准备工作

- 打开测试页面：`http://localhost:5173/test/ch11-production/production-queue/`
- 确认环境信息栏显示 "WebGL 2.0" 引擎
- 确认屏幕分辨率至少 1280x900，侧栏可见
- 确认 Sim Speed 为 1.0x

### 步骤 1: 验证 Progress Bar 线性填充 (E1)

1. 从 Unit 下拉选择 "Medium Tank (15s, $800)"，点击 **+ Enqueue**
2. 观察侧栏队列列表：队首出现 Medium Tank，进度条从 0% 开始
3. 等待约 3 秒：进度条应约为 20%，颜色为蓝色 → 验证 E1.1
4. 将 Speed 滑块拉到 2.0x：进度条移动速度加倍
5. 等待至进度超过 30%（约 2-3s real time）：进度条颜色应切换为黄色
6. 等待至进度超过 70%：进度条颜色应切换为绿色
7. 预期: ✅ E1.1, E1.2, E1.3 通过

### 步骤 2: 验证 Countdown Timer (E2)

1. 重置队列 (Reset)，添加 "Rifle Infantry (5s, $100)"
2. 观察 timer：显示 5.0s（红色）
3. 每 1 秒检查一次：timer 值以 ~1s/s 递减（4.0 → 3.0 → 2.0 → 1.0 → 0.0）
4. Timer 到达 0.0 时物品变为 "READY" 状态
5. 预期: ✅ E2.1, E2.2, E2.3 通过

### 步骤 3: 验证 Ready Pulse 发光 (E3)

1. 确保队列中有至少 1 个 ready 物品
2. 切换到 Babylon.js 3D 视图（左侧），观察工厂模型
3. 工厂应每 1 秒变亮一次（绿色发光），然后变暗
4. chimney 顶部应同步发出橙红色光
5. 侧栏 ready 物品行应有绿色脉冲边框动画
6. 取消 ready 物品：脉冲立即停止
7. 预期: ✅ E3.1, E3.2, E3.3 通过

### 步骤 4: 验证 Cancel 退款 (E4)

1. Enqueue "Medium Tank ($800)"，等 3-4 秒后（进度约 20-25%），点 **X** 取消
2. 观察 Feedback 栏：显示 "Refunded $N"（N ≈ $440-480）
3. 等待 "Rifle Infantry" 完成（变 READY），点 ✅ deploy
4. 观察 Feedback 栏：显示 "already complete, no refund"
5. 预期: ✅ E4.1, E4.2, E4.3 通过

### 步骤 5: 验证队首取消后重排 (E5)

1. Reset，依次 Enqueue：Infantry (5s), Rocket Soldier (8s), Light Tank (10s)
2. 等待约 2 秒让 Infantry 有进度，然后点 **Cancel Head**
3. 验证 Infantry 消失，Rocket Soldier 成为新队首
4. 新队首的进度条应从其剩余时间对应进度开始（如果 Rocket 尚未被 tick 则从 0% 开始）
5. 中间取消一个非队首物品：点 Light Tank 的 X
6. 验证 Rocket Soldier 队首进度不受影响
7. 预期: ✅ E5.1, E5.2, E5.3 通过

### 边界测试

1. **空队列取消**: 队列为空时点 Cancel Head → Feedback 显示 "Queue empty — nothing to cancel."
2. **高速模拟**: Speed 设为 10x → 所有物品快速完成，UI 更新不卡顿
3. **多物品同类型**: Enqueue 3x Infantry → 同名物品正确显示，各自独立进度
4. **暂停/恢复**: Pause → 进度停止 → Resume → 进度恢复

### 结果判定

- [ ] E1-E5 全部通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异（截图 + 期望值 vs 实测值），提交 issue
- [ ] 测试环境异常 → 记录 UA / VP / Engine / 时间戳

---

## Test Harness API

```js
const h = window.__testHarness

h.enqueueItem('medTank')        // => boolean (success)
h.getQueueItems()               // => Array<{type, name, progressPct, remainingTime, isReady}>
h.getProgressPercent()          // => number (0.00..100.00) — head item progress
h.getTimeRemaining()            // => number (seconds remaining) — head item
h.isReadyPulsing()              // => boolean — is pulse glow currently active
h.cancelItem(0)                 // => boolean — cancel item at index
h.reset()                       // => void — reset everything
h.getSimulationSpeed()          // => number — current sim speed multiplier
h.setSimulationSpeed(5)         // => void — set sim speed
h.getCompletedCount()           // => number — total completed items
h.getRefundedTotal()            // => number — total refunded amount in $
```
