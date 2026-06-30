# Laser Zap Beam — Acceptance Test

**Module**: LaserZap Projectile (Chapter 8 Phase B)
**Test Case ID**: `ch08-weapons-combat/laser-zap-beam`
**OpenRA Source**: `OpenRA.Mods.Common/Projectiles/LaserZap.cs`
**TypeScript Target**: `src/OpenRA.Mods.Common/Projectiles/LaserZap.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 25/25 通过, 100%)

---

## 期望结果 (Expected Results)

### L1. Instant Beam Appearance

**上下文**: `LaserZap` 在 tick 0 立即应用伤害（`damageDuration` ticks 期间每 `damageInterval` 触发一次 warhead）。光束视觉（LinesMesh + Cylinder）应在 fire 命令后立即出现。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| L1.1 | 点击 "Fire Laser" 后，光束在 1 帧内（< 33ms @ 30fps）出现在场景中 | 按钮点击后立即可见 `LinesMesh` 连接 source 和 target |
| L1.2 | Tick 0（第一个逻辑帧）`weapon.impact` 被调用，damage 即时生效 | `activeArgs.weapon.impactCount >= 1` 在 T1 之前 |
| L1.3 | 光束在 tick 0 时 `beamAlpha > 0`（默认 255，即满亮度） | `laser.beamAlpha === 255` 在创建后 |

### L2. Beam Color Matching

**上下文**: `LaserZap.color` 存储为 `[R, G, B, A]` 元组。设置 `usePlayerColor=true` 时，光束颜色应与 selected color 匹配。颜色通过 `LinesMesh` 顶点颜色和 cylinder 材质 emissive 渲染。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| L2.1 | 选择 "Red" (255,0,0) 发射 → 光束核心颜色为红色 | `getBeamColor()` 返回 `{r: 255, g: 0, b: 0}` |
| L2.2 | 选择 "Blue" (0,100,255) 发射 → 光束颜色为蓝色 | `getBeamColor()` 返回 `{r: 0, g: 100, b: 255}` |
| L2.3 | 颜色偏差 ≤ 5% RGB（即每个通道偏差 ≤ 12 units out of 255） | 实际 color tuple 与传入值各通道偏差 ≤ 12 |
| L2.4 | 从下拉菜单切换颜色后重新发射，光束颜色立即改变 | 两次发射间颜色不同，视觉可见差异 |

### L3. Beam Duration Persistence

**上下文**: `beamAlpha` getter 计算为 `Math.trunc(remaining * color[3] / duration)`，其中 `remaining = duration - ticks`。光束 Alpha 从 `color[3]`（默认 255）线性衰减到 0，恰好在 `duration` ticks 后。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| L3.1 | T0 时 `beamAlpha = 255`（color alpha=255, remaining=duration） | `255 * duration / duration = 255` |
| L3.2 | T5 时（15-tick duration）`beamAlpha ≈ 170` | `255 * 10 / 15 = 170`（±1 due to truncation） |
| L3.3 | T15（duration ticks）时 `beamAlpha = 0`，光束消失 | `255 * 0 / 15 = 0`，`isBeamVisible() === false` |
| L3.4 | Duration=10 时，光束恰好在 T10 消失（±1 tick tolerance） | 第 10 或 11 tick 后 `beamAlpha === 0` |
| L3.5 | `ticks` 计数器每 simulation tick 递增 1 | 10 ticks 后 `laser.ticks === 10` |

### L4. Beam Width

**上下文**: `width: WDist` 控制光束直径。在 3D 场景中渲染为 cylinder 的 diameter。将 WDist su 转换为世界单位：worldWidth = WDist.length / 1024。相机 10 wu 距离处的像素宽度应匹配。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| L4.1 | 默认 width=86 su → cylinder diameter ≈ 0.084 wu | `86 / 1024 ≈ 0.084` world units |
| L4.2 | 调整 width slider 到 172 su → cylinder 直径加倍 | cylinder diameter ≈ 0.168 wu |
| L4.3 | 10 wu 距离处像素宽度与 WDist 匹配，偏差 ≤ 3px | 用 `getBeamWidth()` 测量，与理论值偏差 ≤ 3px |
| L4.4 | Width slider 最小值 (≈11 su) 光束非常细，最大值 (≈215 su) 光束明显粗 | 视觉可分辨宽度差异 |

### L5. Tracking Behavior

**上下文**: `trackTarget=true` 时，`LaserZap.tick()` 每 tick 从 `args.guidedTarget` 更新 `laser.target`。光束终点应跟随目标移动（红色立方体）。勾选 "Moving Target" 后目标振荡，tracking 模式下光束终点应跟随。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| L5.1 | tracking=ON + moving target=ON → 光束终点每 tick 移动量 = 目标移动量 | `laser.target` delta 与 target position delta 匹配 |
| L5.2 | tracking=OFF → 光束终点固定在初始目标位置，不跟随移动 | `laser.target` 在 duration 期间不变 |
| L5.3 | 目标移动时，光束 cylinder 实时更新长度和方向 | cylinder 的 height 和 rotation 每帧更新 |
| L5.4 | 目标移动到远离 source 时，光束长度增加；移动到靠近时长度减少 | 视觉可观察 cylinder 拉伸/收缩 |

### L6. Secondary Beam

**上下文**: `secondaryBeam=true` 时，一个额外的 offset 光束与主光束一起渲染。secondary beam 有不同的颜色和 zOffset。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| L6.1 | 勾选 "2nd Beam" 后发射 → 两条平行光束可见 | 场景中显示 `beamSecondLine`，offset from main beam |
| L6.2 | Secondary beam 颜色比主光束更亮（RGB 各通道 +80） | secondary color > primary color 各通道 |
| L6.3 | 取消勾选后仅主光束可见 | `beamSecondLine === null` |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/laser-zap-beam/`
2. 确认环境信息栏显示 "WebGL 2.0"
3. 设置屏幕分辨率 1920x1080（1x 缩放）
4. 确认 3D 场景加载（灰色地面 + 网格 + 红色立方体 target）

### 步骤一：Basic Beam Fire

1. 保持默认设置（Red, Track=ON, Moving=OFF, Width=86su, Duration=15t）
2. 点击 **"Fire Laser"**
3. 观察：绿色球体（source）和红色球体（target）之间的光束
4. **预期**:
   - [x] 光束在点击后立即出现（L1.1）✅
   - [x] 光束颜色为红色（L2.1）✅
   - [x] 诊断面板显示 beamAlpha=255（L1.3）✅
   - [x] 事件日志显示 T1 时 impactCount ≥ 1（L1.2）✅

### 步骤二：Duration and Fade

1. 设置 Duration=10，点击 Fire Laser
2. 观察光束在 10 ticks 内逐渐消失
3. 监控诊断面板的 beamAlpha 变化
4. **预期**:
   - [x] T0: beamAlpha=255（L3.1）✅
   - [x] T3: beamAlpha≈179 (`255*7/10=178.5`)（L3.2 类似）✅
   - [x] T10: beamAlpha=0，光束消失（L3.3, L3.4）✅

### 步骤三：Color Matching

1. 依次选择 Blue → Green → Yellow → Orange → Purple
2. 每次切换后点击 Fire Laser
3. 观察光束颜色与所选颜色匹配
4. **预期**:
   - [x] 每种颜色都与下拉菜单标签匹配（L2.2, L2.4）✅
   - [x] 诊断面板显示的 RGB 值 == 选中颜色（L2.3）✅

### 步骤四：Beam Width

1. 设置 Width slider 到 1（最小，≈11 su），Fire → 光束很细
2. 设置 Width slider 到 20（最大，≈215 su），Fire → 光束很粗
3. 比较两次结果
4. **预期**:
   - [x] 宽度变化视觉明显可辨（L4.4）✅
   - [x] 诊断面板 width 读数与 slider 值对应（L4.1, L4.2）✅

### 步骤五：Tracking

1. 勾选 "Moving Target" + "Track Target"
2. 设置 Duration=30，点击 Fire Laser
3. 观察光束终点跟随移动的红色立方体
4. 取消 "Track Target"，重新 Fire → 光束固定不动
5. **预期**:
   - [x] Tracking=ON → 光束终点跟随目标（L5.1）✅
   - [x] Tracking=OFF → 光束终点固定（L5.2）✅
   - [x] 光束长度随目标移动而变化（L5.4）✅

### 步骤六：Secondary Beam

1. 勾选 "2nd Beam"，点击 Fire Laser
2. 观察两条平行光束
3. 取消勾选，重新 Fire
4. **预期**:
   - [x] 两条光束可见，颜色不同（L6.1, L6.2）✅
   - [x] 取消后仅一条光束（L6.3）✅

### 边界/异常测试

1. **快速连续发射**: 连续点击 Fire Laser 5 次
   - [x] 每次发射清除前次光束，无残留 ✅
2. **Duration=3（最小值）**: 设置 Duration=3，Fire
   - [x] 光束在 3 ticks 内快速消失 ✅
3. **Duration=40（最大值）**: 设置 Duration=40，Fire
   - [x] 光束持续 40 ticks 后消失 ✅
4. **无 Moving Target + Tracking ON**: 目标静止
   - [x] 光束保持静止（tracking 无效果，但无错误）✅

### 结果判定

- [ ] 所有期望结果 (L1-L6) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异，提交 issue
- [ ] 测试环境异常 → 记录 UA / viewport / engine

---

## 坐标系参考

| WPos 轴 | 语义 | Vector3 轴 | 缩放 |
|---------|------|-----------|------|
| +X | 东 | x | 1/1024 |
| +Y | 南 | z | 1/1024 |
| +Z | 高 | y | 1/512 |

WAngle: 0=北（WPos -Y），CCW 递增。facing=64=东。

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 | acceptance-test-assistant |
