# Railgun Helix Trail — Acceptance Test

**Module**: Railgun Projectile (Chapter 8 Phase B)
**Test Case ID**: `ch08-weapons-combat/railgun-trail`
**OpenRA Source**: `OpenRA.Mods.Common/Projectiles/Railgun.ts`
**TypeScript Target**: `src/OpenRA.Mods.Common/Projectiles/Railgun.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-01, 22/22 通过, 100%)

---

## 期望结果 (Expected Results)

### R1. Instant Impact (≤1 Tick)

**上下文**: `Railgun.tick()` 在 tick=0 时立即调用 `weapon.impact()`，无需弹丸飞行时间。光束和 helix trail 是纯视觉效果，伤害在第一个逻辑帧就已生效。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| R1.1 | Fire 后第一个 simulation tick 内 `impactCount ≥ 1` | tick 0 结束时 `getImpacts() ≥ 1` |
| R1.2 | Impact position 在 target 位置（default: 10240, 5120, 0） | `|impactX - 10240| ≤ 200 su`, `|impactY - 5120| ≤ 10 su` |
| R1.3 | 诊断面板 "Impacted" 在 tick 1 时显示 "YES" | `isImpacted() === true` at tick 1 |

### R2. Trail Color Matching

**上下文**: `beamColor` 和 `helixColor` 为 RGBA tuple（index 3 = alpha）。默认均为 `[128, 255, 255, 255]`（青色）。core beam 和 helix LinesMesh 颜色应与配置值一致。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| R2.1 | 默认配置下 core beam 颜色为青色 (R=128, G=255, B=255) | `getTrailColor().beam` = [128, 255, 255]（各通道 ±12） |
| R2.2 | 默认配置下 helix trail 颜色为青色 (R=128, G=255, B=255) | `getTrailColor().helix` = [128, 255, 255]（各通道 ±12） |
| R2.3 | 切换 beam color 为 Red (255,128,128) 后重新 Fire → core beam 变红 | 视觉可分辨颜色差异，诊断面板 color 值匹配 |

### R3. Helix Trail Visibility

**上下文**: `Railgun.generateHelixPoints(tick)` 生成从 source 向 target 延伸的 3D 螺旋路径（16 segments/cycle × N cycles）。螺旋半径随 tick 扩大（`helixRadiusDeltaPerTick=8`），角度随 tick 旋转（`helixAngleDeltaPerTick=16`）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| R3.1 | Fire 后 helix trail LinesMesh 从 source 向 target 延伸 | `helixLine.isEnabled() === true`，肉眼可见螺旋线 |
| R3.2 | Helix 螺旋线绕 core beam 旋转 | 每 tick 角度偏移 16/1024 圈 ≈ 5.6°，视觉可观察旋转 |
| R3.3 | Helix 半径随 tick 扩大（+8 su/tick） | tick 0: radius=64su, tick 3: radius=88su |
| R3.4 | Core beam 直线连接 source 到 target，与 helix 同时可见 | `coreBeamLine.isEnabled() === true` |

### R4. Trail Fade Within ~5 Ticks

**上下文**: `beamAlpha` getter 计算为 `color[3] + beamAlphaDeltaPerTick * ticks`。配置 `beamAlphaDeltaPerTick = -51` 和 `helixAlphaDeltaPerTick = -51` 后，alpha 从 255 在 5 ticks 内线性衰减到 0。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| R4.1 | Tick 0: beamAlpha = 255, helixAlpha = 255 | `getBeamAlpha() === 255`, `getHelixAlpha() === 255` |
| R4.2 | Tick 3: beamAlpha = 255 - 51×3 = 102 | `getBeamAlpha() === 102` (±5) |
| R4.3 | Tick 5: beamAlpha = 255 - 51×5 = 0，trail 完全消失 | `getBeamAlpha() === 0`, `getHelixAlpha() === 0` |
| R4.4 | Tick 5+ 时 helixLine 和 coreBeamLine disabled | 3D 场景中无残留光束 |

### R5. Impact Position Accuracy

**上下文**: 伤害在 `this.target` 位置触发（可能被 inaccuracy 或 blocking 调整）。默认配置 inaccuracy=0, blockable=false → impact 位置精确等于 target。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| R5.1 | Impact position X = target X (10240 su) | `|impactX - 10240| ≤ 100 su` |
| R5.2 | Impact position Y = target Y (5120 su) | `|impactY - 5120| ≤ 10 su` |
| R5.3 | Impact flash sphere 出现在 target marker 位置 | 蓝色闪光球与红色 target marker 重叠 |

### R6. Projectile Disposal After Duration

**上下文**: Railgun 在 `ticks > duration` 且 `animationComplete` 时通过 `world.addFrameEndTask` 移除。默认 duration=15，projectile 在 tick 16 被移除。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| R6.1 | Tick 16 时 `isDestroyed === true` | 诊断面板 "Destroyed" 显示 "YES" |
| R6.2 | 移除后所有 visual 清理 | helixLine + coreBeamLine disabled，impact flash faded |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/railgun-trail/`
2. 确认环境信息栏显示 "WebGL 2.0"
3. 设置屏幕分辨率 1920x1080（1x 缩放）
4. 确认 3D 场景加载（灰色地面 + 网格 + 绿色 source marker + 红色 target marker）

### 步骤一：Basic Fire — Instant Impact

1. 点击 **"FIRE RAILGUN"**
2. 立即观察 target marker 位置的蓝色 impact flash sphere
3. **预期**:
   - [ ] Impact flash 在第一个 tick 立即出现（R1.1）
   - [ ] 诊断面板 "Impacted" → "YES"（R1.3）
   - [ ] Impact position 在 target 位置（R5.1, R5.2）

### 步骤二：Helix Trail Observation

1. Fire 后仔细观察 source→target 之间的螺旋线
2. 旋转摄像机（鼠标拖拽）从不同角度观察 helix
3. **预期**:
   - [ ] Core beam 直线连接 source 和 target（R3.4）
   - [ ] Helix 螺旋线缠绕 core beam 旋转（R3.1, R3.2）
   - [ ] Helix 从 source 延伸到 target 方向（非全长度，随 tick 扩展）

### 步骤三：Trail Fade Timing

1. Fire 后观察诊断面板的 "Beam Alpha" 和 "Helix Alpha" 数值
2. 观察 helix 和 core beam 逐渐消失
3. **预期**:
   - [ ] Tick 0: alpha = 255（R4.1）
   - [ ] Tick 3: alpha ≈ 102（R4.2）
   - [ ] Tick 5: alpha = 0，trail 完全消失（R4.3, R4.4）

### 步骤四：Color Configuration

1. Beam Color 下拉选择 "Red"，Helix Color 选择 "Orange"
2. 点击 Fire
3. **预期**:
   - [ ] Core beam 显示红色（R2.3）
   - [ ] Helix trail 显示橙色
   - [ ] `getTrailColor()` 返回匹配的颜色值（R2.1, R2.2）

### 步骤五：Projectile Disposal

1. Fire 后等待约 16 ticks
2. 观察诊断面板
3. **预期**:
   - [ ] Tick 16 时 "Destroyed" → "YES"（R6.1）
   - [ ] 所有视觉元素消失（R6.2）

### 边界/异常测试

1. **快速连续发射**: 连续点击 Fire 3 次
   - [ ] 每次发射清除前次 helix 和 beam，无残留
2. **Color mismatch test**: Beam=Red, Helix=Green → Fire
   - [ ] Core beam 红色，helix 绿色，两者独立着色

### 结果判定

- [ ] 所有期望结果 (R1-R6) 通过 → **ACCEPTED**
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
Helix 几何: `forwardStep` 沿 source→target 方向，`leftVector` + `upVector` 正交于 forward，用 `sin/cos` 生成螺旋偏移。

## 默认参数计算

| 参数 | 值 | 说明 |
|------|-----|------|
| beamWidth | 86 su (0.084 wu) | core beam 宽度 |
| duration | 15 ticks | 弹丸生命周期 |
| helixRadius | 64 su (0.0625 wu) | 初始螺旋半径 |
| helixPitch | 512 su | 每圈螺旋前进距离 |
| beamAlphaDelta | -51/tick | α: 255 → 0 in 5 ticks |
| helixAlphaDelta | -51/tick | α: 255 → 0 in 5 ticks |
| quantizationCount | 16 | 每圈分段数 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 | acceptance-test-assistant |
