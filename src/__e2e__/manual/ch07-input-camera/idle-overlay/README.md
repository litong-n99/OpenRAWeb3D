# WithIdleOverlay — Acceptance Test

**Module**: Idle Animation Overlay (Chapter 7 Phase G)
**Test Case ID**: `ch07-input-camera/idle-overlay`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.cs`
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Render/WithIdleOverlay.ts`
**审核状态**: ✅ 审核通过 (Review R1 — 3 MAJOR fixed)

---

## 期望结果 (Expected Results)

### E1. 播放阶段 Overlay 可见 (Overlay Visible During Play Phase)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E1.1 | Actor IDLE + Play 阶段时，overlay 网格完全可见 | `overlayGroup.isVisible === true`，disc 和 ring 子网格均渲染 |
| E1.2 | Overlay 有可见的动画效果（脉冲缩放 + 旋转 + 发光颜色变化） | disc scale 在 1.0-1.3 之间正弦振荡，emissiveColor 周期性变化 |
| E1.3 | 从 Pause 切换到 Play 时，overlay 在 ≤1 tick (≤40ms) 内变为可见 | 相位切换后立即调用 `applyOverlayVisibility()` |

### E2. 暂停阶段 Overlay 隐藏 (Overlay Hidden During Pause Phase)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E2.1 | Actor IDLE + Pause 阶段时，overlay 网格完全隐藏 | `overlayGroup.isVisible === false` |
| E2.2 | Pause 阶段偏移连线也隐藏 | offsetLine mesh 不渲染 |
| E2.3 | 状态栏 Overlay 可见性显示 "HIDDEN"（灰色徽章） | DOM 元素 `#overlay-vis-badge` 文本为 "HIDDEN"，class 含 `status-hidden` |

### E3. 播放阶段时长准确 (Play Phase Duration Accuracy)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E3.1 | 默认配置下，Play 阶段持续 60 ticks (2.4s @ 25tps) | 实测持续 ticks 在 [58, 62] 范围内（±2 ticks 容差） |
| E3.2 | 修改 Play Ticks 为 120 后，Play 阶段持续 120 ±2 ticks | 通过 test harness 设置 `setCycleDurations(120, 30)` 后验证 |
| E3.3 | 相位切换瞬间，elapsedTicksInPhase 归零 | 使用 `getElapsedTicksInPhase()` 查询，切换后首次查询 ≤1 |
| E3.4 | 相位进度条平滑填充 0%-100%，颜色正确 | Play 阶段绿色填充 (`#4caf50`)，Pause 阶段橙色填充 (`#ff9800`) |

### E4. 暂停阶段时长准确 (Pause Phase Duration Accuracy)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E4.1 | 默认配置下，Pause 阶段持续 30 ticks (1.2s @ 25tps) | 实测持续 ticks 在 [28, 32] 范围内（±2 ticks 容差） |
| E4.2 | 修改 Pause Ticks 为 90 后，Pause 阶段持续 90 ±2 ticks | 通过 test harness 设置 `setCycleDurations(60, 90)` 后验证 |
| E4.3 | Play → Pause 切换时事件日志记录 | 日志显示 "Pause 阶段开始" 条目，类型为 `phase` |

### E5. Actor 非空闲时 Overlay 立即停止 (Overlay Stops Immediately When Busy)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E5.1 | IDLE → BUSY 切换后，overlay 在 ≤2 ticks (≤80ms) 内隐藏 | `getOverlayHideLatency() ≤ 2` |
| E5.2 | BUSY 状态下 overlay 保持隐藏，不受 play/pause 循环影响 | 等待 2 个完整循环周期后 `isOverlayVisible()` 仍返回 false |
| E5.3 | BUSY → IDLE 切换后，overlay 恢复（从当前相位继续） | phase 和 elapsedTicksInPhase 在 busy 期间被保留 |
| E5.4 | 状态栏 Actor 状态在 IDLE 时显示绿色 "IDLE" 徽章，BUSY 时显示红色 "BUSY" 徽章 | DOM class 切换正确 |

### E6. Overlay 偏移定位 (Overlay Offset Positioning)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E6.1 | 默认偏移 WVec(0, 512, 1024) 时，overlay 在 body 上方偏南位置 | 视觉：金色 disc 悬浮在棕色 box 的右后方（+Y = 南方 = 屏幕下方-远离相机方向） |
| E6.2 | 拖动 X 滑块改变 X 偏移，overlay 实时沿 X 轴移动 | 每步 64 su = 0.0625 Babylon 单位，肉眼可见位移 |
| E6.3 | 拖动 Z 滑块改变高度偏移，overlay 实时沿 Y 轴（Babylon up）移动 | 每步 64 su = 0.125 Babylon 单位 |
| E6.4 | 偏移连线随 overlay 位置实时更新 | 白色虚线始终连接 body 中心到 overlay 中心 |
| E6.5 | testHarness `getOverlayOffset()` 返回的 WVec 值与 UI 显示一致 | `{ x, y, z }` 值与滑块值匹配 |

### E7. 序列名可查询 (Sequence Name Queryable)

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E7.1 | `getOverlaySequence()` 返回 `"idle-overlay"` | 在任何状态下（IDLE/BUSY/Play/Pause），序列名恒为 `"idle-overlay"` |
| E7.2 | 序列名在状态栏中显示 | DOM 元素 `#stat-sequence` 文本为 "idle-overlay" |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch07-input-camera/idle-overlay/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 确认左面板 Actor 状态显示 "IDLE"（绿色徽章）
5. 确认左面板 Overlay 可见性显示 "VISIBLE"（蓝色徽章）
6. 确认左面板当前阶段显示 "PLAY"（绿色徽章）
7. 打开浏览器开发者工具 (F12)，在 Console 中输入 `window.__testHarness` 确认 test harness 可用

### 步骤一：验证播放阶段 Overlay 可见 (E1)

1. 观察 3D 场景中央的 Actor（棕色 box + 绿色炮塔）
2. 确认 Actor 上方悬浮着金色 disc + 环（overlay），带有脉冲动画
3. 在 Console 中执行：`window.__testHarness.getOverlayVisibility()`
4. **预期**:
   - [ ] 返回 `true`（E1.1）✅
   - [ ] 金色 disc 在脉冲缩放（E1.2）✅
5. 点击 "强制 Pause 阶段" 按钮，再点击 "强制 Play 阶段" 按钮
6. **预期**:
   - [ ] Overlay 在点击 Play 后立即可见（E1.3）✅

### 步骤二：验证暂停阶段 Overlay 隐藏 (E2)

1. 点击 "强制 Pause 阶段" 按钮
2. **预期**:
   - [ ] 金色 overlay 立即消失（E2.1）✅
   - [ ] 白色偏移连线也消失（E2.2）✅
   - [ ] 左面板 Overlay 可见性显示 "HIDDEN"（灰色）（E2.3）✅
3. 在 Console 中执行：`window.__testHarness.getOverlayVisibility()`
4. **预期**:
   - [ ] 返回 `false` ✅

### 步骤三：验证播放阶段时长 (E3)

1. 点击 "重置" 按钮
2. 观察左面板 "已过 Ticks" 计数器从 0 递增
3. 等待 Play 阶段结束（观察相位徽章从 PLAY 变为 PAUSE）
4. 记录 Play 阶段实际持续的 ticks 数
5. **预期**:
   - [ ] 默认配置 Play 持续 60 ticks，实测在 58-62 范围内（E3.1）✅
6. 点击 "重置"，将 Play Ticks 滑块设为 120，Pause Ticks 设为 30
7. 将速度设为 4.0x 加速观察
8. **预期**:
   - [ ] Play 阶段持续约 120 ticks（E3.2）✅
9. 观察相位进度条
10. **预期**:
    - [ ] Play 阶段绿色填充条从 0% 到 100%（E3.4）✅

### 步骤四：验证暂停阶段时长 (E4)

1. 继续观察或重置后观察
2. 记录 Pause 阶段实际持续的 ticks 数
3. **预期**:
   - [ ] 默认配置 Pause 持续 30 ticks，实测在 28-32 范围内（E4.1）✅
4. 修改 Pause Ticks 为 90，Play Ticks 为 60，速度 4.0x
5. **预期**:
   - [ ] Pause 阶段持续约 90 ticks（E4.2）✅
   - [ ] 事件日志记录 "Pause 阶段开始"（E4.3）✅

### 步骤五：验证 Actor 非空闲时 Overlay 停止 (E5)

1. 点击 "重置" 按钮，确认 Actor 为 IDLE，overlay 可见
2. 点击 "设置为 BUSY" 按钮
3. **预期**:
   - [ ] Overlay 立即隐藏（视觉上无明显延迟）（E5.1）✅
   - [ ] 左面板 Actor 状态显示红色 "BUSY"（E5.4）✅
4. 在 Console 中检查延迟：
   ```
   const h = window.__testHarness
   h.getOverlayHideLatency()  // 应 ≤ 2
   ```
5. **预期**:
   - [ ] 返回值 ≤ 2（E5.1）✅
6. 等待 10 秒（让多个 play/pause 循环完成）
7. 在 Console 中：`h.getOverlayVisibility()`
8. **预期**:
   - [ ] 仍返回 `false`（E5.2）✅
9. 点击 "设置为 IDLE" 按钮
10. **预期**:
    - [ ] Overlay 恢复可见，从 busy 之前的相位继续（E5.3）✅

### 步骤六：验证偏移定位 (E6)

1. 确保 Actor 为 IDLE + Play 阶段
2. 拖动 X 偏移滑块到 1024 su
3. **预期**:
   - [ ] Overlay 沿 X 轴正方向（屏幕右侧）移动（E6.2）✅
   - [ ] 白色偏移连线跟随移动（E6.4）✅
4. 拖动 Z 偏移滑块到 2048 su
5. **预期**:
   - [ ] Overlay 垂直升高（E6.3）✅
6. 拖动 Y 偏移滑块到 1024 su
7. **预期**:
   - [ ] Overlay 沿 Z 轴正方向（屏幕下方/南方）移动 ✅
8. 在 Console 中查询偏移值：
   ```
   window.__testHarness.getOverlayOffset()
   ```
9. **预期**:
   - [ ] 返回 `{ x: 1024, y: 1024, z: 2048 }` 与 UI 滑块一致（E6.5）✅

### 步骤七：验证序列名 (E7)

1. 在各种状态（IDLE Play、IDLE Pause、BUSY）之间切换
2. 每次切换后在 Console 执行：`window.__testHarness.getOverlaySequence()`
3. **预期**:
   - [ ] 始终返回 `"idle-overlay"`（E7.1）✅
   - [ ] 状态栏 `#stat-sequence` 始终显示 "idle-overlay"（E7.2）✅

### 边界/异常测试

1. **极速切换**: 快速交替点击 "IDLE" 和 "BUSY" 按钮 10 次
   - [ ] Overlay 可见性正确跟随最终状态，无闪烁残留
   - [ ] FPS 保持 > 30

2. **极值偏移**: 将 X/Y/Z 偏移都设为最大值（2048/2048/4096 su）
   - [ ] Overlay 显示在远处偏移位置
   - [ ] 偏移连线正确连接

3. **负偏移**: 将 X 设为 -1024，Y 设为 -512
   - [ ] Overlay 移动到 body 左侧偏北
   - [ ] `getOverlayOffset()` 返回负值

4. **速度极端**: 将速度设为 0.25x 和 4.0x
   - [ ] 0.25x 时 Play/Pause 循环明显变慢（4x 时长）
   - [ ] 4.0x 时循环明显加速（1/4 时长）
   - [ ] 时长仍在配置值 ±2 ticks 范围内

5. **极短周期**: 设置 Play Ticks=10, Pause Ticks=5
   - [ ] 循环正常执行，无跳帧或状态错误
   - [ ] Overlay 可见/隐藏正常切换

6. **窗口大小调整**: 将浏览器窗口从 1920x1080 调整为 1280x720
   - [ ] 场景正确缩放，overlay 位置不受影响

7. **键盘快捷键**: 按 `I` 键（IDLE）、`B` 键（BUSY）、`P` 键（强制 Play）、`A` 键（强制 Pause）、`R` 键（重置）
   - [ ] 所有快捷键正确触发对应操作

8. **Camera 交互**: 鼠标左键拖拽旋转场景，滚轮缩放
   - [ ] Overlay 和 body 保持正确的相对位置关系
   - [ ] 偏移线在旋转后仍正确连接

### 结果判定

- [ ] 所有期望结果 (E1-E7) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异（ticks 数、可见性状态、位置偏差），提交 issue
- [ ] 测试环境异常（WebGL 不可用 / 渲染错误）→ 记录 UA / 视口 / 引擎信息

---

## Test Harness API

以下函数可通过浏览器 Console 的 `window.__testHarness` 访问：

| 函数 | 返回值 | 说明 |
|------|--------|------|
| `setActorIdle()` | `{ actorIdle, overlayVisible }` | 将 actor 设为空闲 |
| `setActorBusy()` | `{ actorIdle, overlayVisible }` | 将 actor 设为忙碌 |
| `getOverlayVisibility()` | `boolean` | Overlay 当前是否可见 |
| `getOverlaySequence()` | `string` | 当前序列名 |
| `getOverlayOffset()` | `{ x, y, z }` | 当前 WVec 偏移 (su) |
| `isActorIdle()` | `boolean` | Actor 是否空闲 |
| `getCurrentPhase()` | `string` | 当前相位 "play" / "pause" |
| `getElapsedTicksInPhase()` | `number` | 当前相位已过 ticks |
| `getCycleConfig()` | `{ playTicks, pauseTicks }` | 当前周期配置 |
| `getTotalTicksElapsed()` | `number` | 模拟总 ticks |
| `getTotalCycles()` | `number` | 已完成的总循环数 |
| `getBusyTransitionTick()` | `number` | 上一次 BUSY 转换时的 tick |
| `getOverlayHideLatency()` | `number \| null` | BUSY 转换后隐藏延迟 (ticks) |
| `setOverlayOffset(x, y, z)` | `void` | 设置偏移 (su) |
| `setCycleDurations(play, pause)` | `void` | 设置周期时长 (ticks) |
| `setSimSpeed(speed)` | `void` | 设置模拟速度倍率 |
| `getOverlayWorldPosition()` | `{ x, y, z }` | Overlay 在 Babylon 空间的位置 |
| `getBodyCenter()` | `{ x, y, z }` | Body 在 Babylon 空间的中心 |
| `getElapsedWallClock()` | `number` | 已过挂钟时间 (秒) |
| `reset()` | `void` | 重置所有状态 |

---

## 坐标系参考

```text
WVec (X, Y, Z) → Babylon Vector3
  X (东+/西-)  → Vector3.x = X / 1024
  Y (南+/北-)  → Vector3.z = Y / 1024  (注意: WPos.Y → Vector3.z)
  Z (高度+)    → Vector3.y = Z / 512   (注意: WPos.Z → Vector3.y)

默认偏移 WVec(0, 512, 1024):
  Babylon 偏移 = (0.0, 2.0, 0.5)
  Overlay 在 body 上方 2.0 Babylon 单位 (≈4 cells),
  偏南 0.5 Babylon 单位 (≈512 su)
```

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 | acceptance-test-assistant |
