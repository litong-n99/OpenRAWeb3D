# Nuke Launch — Acceptance Test

**Module**: NukeLaunch Projectile (Chapter 8 Phase B)
**Test Case ID**: `ch08-weapons-combat/nuke-launch`
**OpenRA Source**: `OpenRA.Mods.Common/Projectiles/NukeLaunch.ts`
**TypeScript Target**: `src/OpenRA.Mods.Common/Projectiles/NukeLaunch.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果 (Expected Results)

### N1. Ascent Speed Matches Configured Velocity

**上下文**: `NukeLaunch` 在 ascent 阶段调用 `WPos.lerpQuadratic(ascendSource, ascendTarget, WAngle.Zero, t, turn)`。由于 `pitch.angle === 0`，`lerpQuadratic` 内部跳过二次项直接调用 `WPos.lerpLong`（线性插值），因此爬升为纯线性。`ascendTarget = launchPos + (0, 0, velocity.length * turn)`。每 tick 高度增加 `velocity.length` su。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| N1.1 | 默认 config (velocity=200, impactDelay=60, turn=30) 下，升空阶段 Z 高度线性增长 200 su/tick（因为 WAngle.Zero 跳过二次项） | tick 15 时 Z = 3000 su (±5% = ±150 su)，即约 5.86 wu |
| N1.2 | 升空阶段 X/Y 坐标保持不变（纯垂直爬升） | tick 0-tick 29 间 X = 2048, Y = 5120 不变 |
| N1.3 | velocity slider 调至 300 su/t 后，升空速率相应加快 | tick 10 时 Z = 3000 su（vs 默认 2000 su），maxAlt = 300*30 = 9000 su |
| N1.4 | 爬升轨迹在 3D 场景中呈现为竖直线（带橙色 trail dots） | 肉眼可见垂直 trail，无水平偏移 |

### N2. Detonation at Configured Altitude

**上下文**: 下降阶段（ticks ≥ turn）每 tick 检查 `pos.Z <= targetPos.Z + detonationAltitude.length`。一旦满足条件立即引爆，不等 `impactDelay`。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| N2.1 | detonationAltitude=1024 su 时，引爆发生在 Z ∈ [0, 1024] su 范围内（满足 `pos.Z ≤ targetPos.Z + detAlt` 即 ≤ 1024） | 实测 tick 55 时 Z = 1000 su (≈1.95 wu) 落入范围，引爆。接受范围: Z ∈ [0, 1024] su，偏差无下限，上限为 detAlt 值 |
| N2.2 | 引爆点位于 targetPos 正上方（X/Y 接近 targetPos） | |X - targetX| ≤ 500 su, |Y - targetY| ≤ 10 su |
| N2.3 | detonationAltitude=0 时，引爆发生在 Z ≤ 0（贴地引爆） | 引爆高度 ≈ 0 su，totalFlight ≈ impactDelay |
| N2.4 | 诊断面板 "Detonated" 在引爆瞬间从 "no" 变为 "YES" | 事件日志记录 DETONATED! + impact count |

### N3. Flash Peak and Fade

**上下文**: 引爆时触发全屏白色闪光效果（HTML overlay + 3D blast sphere）。闪光在 3 tick 内保持 100% 强度，随后在 20 tick 内线性衰减到 0。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| N3.1 | 引爆瞬间（ticksSinceDet=0）闪屏强度 = 1.0（100%） | `getFlashIntensity() === 1.0` |
| N3.2 | ticksSinceDet=0,1,2 三个 tick 内闪屏强度保持 1.0 | `getFlashIntensity()` 连续 3 次返回 1.0 |
| N3.3 | ticksSinceDet=13（fade 过半）闪屏强度 ≈ 0.5 | `|getFlashIntensity() - 0.5| ≤ 0.05` |
| N3.4 | ticksSinceDet≥22 闪屏强度 = 0（完全消失） | `getFlashIntensity() === 0`，页面无白屏残留 |
| N3.5 | Blast sphere 在引爆时从直径 0.5 膨胀到 5.0，随后扩大到 15.0 并淡出 | 视觉可观察白色球体膨胀 |

### N4. All 3 Phases Without Pop-in

**上下文**: 导弹（emissive sphere）在 ascent 和 descent 阶段全程可见，中途无消失/闪现。trail dots 持续生成，trail line 连接飞行路径。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| N4.1 | 导弹球体从 launch 到 detonation 持续可见（无 pop-in） | `missileSphere.isEnabled() === true` 在整个飞行期间 |
| N4.2 | Trail dots 每 3 ticks 生成一个（trailInterval=3） | 55 tick 飞行约生成 55/3 ≈ 18 个 dots |
| N4.3 | Trail line（LinesMesh）连接所有 trail dots，在引爆时完成最终重绘 | 引爆后 trail line 显示完整飞行路径 |
| N4.4 | 导弹 emissive 颜色在 descent 阶段逐渐增强（接近目标时更亮） | 视觉可观察颜色从暗橙 → 亮橙黄变化 |

### N5. Total Flight Time

**上下文**: `NukeLaunch` 在满足引爆条件时立即停止。总飞行时间 = 发射 tick 到引爆 tick 的间隔。由于 `detonationAltitude` 大于 0，引爆发生在 `impactDelay` 之前。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| N5.1 | 默认 config 下飞行时间 ≈ 55 ticks | 55 ≤ totalFlight ≤ 65（vs impactDelay=60，偏差 ≤ 5 tick） |
| N5.2 | detonationAltitude=0 时飞行时间 = impactDelay（贴地引爆） | totalFlight ≈ impactDelay，偏差 ≤ 2 tick |
| N5.3 | Flight phase 顺序: ascent → descent → detonation → done | 事件日志显示 4 个 phase 依次出现 |

### N6. Config Slider Responsiveness

**上下文**: 用户调整 velocity / impactDelay / detonationAltitude slider 后，下次 Launch 使用新配置。turn 和 maxAlt 实时更新显示。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| N6.1 | Velocity slider 调整为 300 后 Launch → maxAlt 显示从 6000 变为 9000 su | 诊断面板和 info 区数值同步更新 |
| N6.2 | ImpactDelay slider 调整为 40 后 Launch → turn 变为 20 | ascent phase 20 ticks 后进入 descent |
| N6.3 | Det.Altitude slider 调整为 0 后 Launch → 贴地引爆，totalFlight ≈ impactDelay | 闪光在地面触发，无空中引爆 |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/nuke-launch/`
2. 确认环境信息栏显示 "WebGL 2.0"
3. 设置屏幕分辨率 1920x1080（1x 缩放）
4. 确认 3D 场景加载（灰色地面 + 网格 + 坐标轴）

### 步骤一：Basic Launch and 3 Phases

1. 保持默认 config（v=200, delay=60, detAlt=1024）
2. 点击 **"LAUNCH NUKE"**
3. 观察导弹球体（橙黄色发光球）从绿色 marker 位置垂直爬升
4. 观察 trail dots 在飞行路径上生成
5. 观察引爆瞬间全屏白色闪光 + blast sphere 膨胀
6. **预期**:
   - [ ] 导弹球体从发射到引爆全程可见（N4.1）
   - [ ] 飞行路径: 垂直上升 → 斜向下降 → 引爆（N5.3）
   - [ ] Trail dots 在路径上均匀分布（N4.2）
   - [ ] Trail line (橙色线) 连接所有 dots（N4.3）
   - [ ] 引爆时全屏变白，blast sphere 膨胀（N3.1, N3.5）

### 步骤二：Altitude Verification

1. 在 launch 过程中观察诊断面板 "Altitude" 字段
2. 记录 Ascent→Descent 切换时的 Z 高度
3. 记录 Detonation 时的 Z 高度
4. **预期**:
   - [ ] Turn 时刻（tick 30）Z ≈ 6000 su（N1.1）
   - [ ] 引爆时 Z ≤ 1024 su（N2.1）
   - [ ] 事件日志显示 Phase 切换消息

### 步骤三：Flash Timing

1. Launch 后立即开始计时
2. 观察引爆瞬间（闪屏出现）
3. 观察闪屏淡出过程
4. 通过 `window.__testHarness.getFlashIntensity()` 验证数值
5. **预期**:
   - [ ] 闪屏峰值持续约 3 次 tick（~0.2s @ 15 logic-tick/s）（N3.2）
   - [ ] 闪屏约 20 tick 后完全消失（~1.3s）（N3.4）
   - [ ] Fade 曲线为线性（N3.3）

### 步骤四：Config Variation — Velocity

1. 调整 Velocity slider 到 300 su/t
2. 点击 Launch
3. 观察爬升速度明显加快
4. **预期**:
   - [ ] Turn 时刻 Z ≈ 9000 su（vs 默认 6000 su）（N1.3）
   - [ ] Max Alt 显示值为 9000 su

### 步骤五：Config Variation — detonationAltitude

1. 调整 Det.Altitude slider 到 0 su
2. 恢复其他 slider 到默认值
3. 点击 Launch
4. 观察引爆发生在贴近地面位置
5. **预期**:
   - [ ] 引爆高度 ≈ 0 su（N2.3）
   - [ ] 总飞行时间 ≈ 60 ticks（N5.2）

### 步骤六：ImpactDelay Variation

1. 调整 ImpactDelay slider 到 40 t
2. 点击 Launch
3. 观察更短的飞行时间
4. **预期**:
   - [ ] Turn = 20 ticks（N6.2）
   - [ ] 总飞行时间 ≤ 40 ticks

### 边界/异常测试

1. **快速连续发射**: 连续点击 Launch 3 次
   - [ ] 每次发射清除前次所有痕迹（trail、markers、flash），无残留
2. **Velocity 最小值 (50 su/t)**: 设置 v=50，Launch
   - [ ] 缓慢爬升，maxAlt = 50 * turn su
3. **Velocity 最大值 (400 su/t)**: 设置 v=400，Launch
   - [ ] 快速爬升，maxAlt = 400 * turn su
4. **ImpactDelay 最小值 (10 t)**: 设置 delay=10，Launch
   - [ ] 快速 ascent(5t) → descent(5t) → 引爆
5. **detonationAltitude 很大 (4000 su)**: 设置 detAlt=4000，delay=60，Launch
   - [ ] 在高空提前引爆，总飞行时间显著小于 60

### 结果判定

- [ ] 所有期望结果 (N1-N6) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异，提交 issue
- [ ] 测试环境异常 → 记录 UA / viewport / engine

---

## 坐标系参考

| WPos 轴 | 语义 | Vector3 轴 | 缩放 |
|---------|------|-----------|------|
| +X | 东 | x | 1/1024 |
| +Y | 南 | z | 1/1024 |
| +Z | 高 | y | 1/512 |

WAngle: 0=北（WPos -Y），CCW 递增。
`WPos.lerpLong(a, b, mul, div)` 执行线性插值: `a + (b-a) * mul/div`。

## 飞行参数计算（默认 config）

| 参数 | 值 | 公式 |
|------|-----|------|
| velocity | 200 su/t | 可调 slider |
| impactDelay | 60 t | 可调 slider |
| turn | 30 t | `Math.trunc(impactDelay / 2)` |
| maxAltitude | 6000 su | `velocity * turn` |
| detAltitude | 1024 su | 可调 slider |
| 预计引爆 tick | ~55 t | descent 中 Z ≤ 1024 时 |
| 预计引爆高度 | ~1000 su | ≈ 1.95 wu |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 | acceptance-test-assistant |
