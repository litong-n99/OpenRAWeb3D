# Gravity Bomb — 重力炸弹弹道（Euler 积分 + 抛物轨迹）

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 16/16 通过, 100%)

**ID**: `ch08-weapons-combat/gravity-bomb-3d`
**URL**: `http://localhost:5173/test/ch08-weapons-combat/gravity-bomb-3d/`
**测试点**: 验证 GravityBomb 抛射体的 Euler 积分弹道、重力加速度累积、地面碰撞检测、水平匀速不变性

---

## 期望结果

### G1. 水平速度恒定（无空气阻力）

| # | 期望 | 可量化标准 |
|---|------|-----------|
| G1.1 | 水平速度大小（XY 平面）在整个飞行过程中不改变 | `getHorizontalSpeed()` 返回值与初始值 `hypot(vx, vy)` 偏差 ≤ 1 su/tick |
| G1.2 | 仅 Z 方向速度受加速度影响 | `getBombVelocity().Z` 每 tick 增加 `acceleration.Z`（默认 -15 su/t²），`Vz(t) = Vz(0) + Az * t`（t 次 vel+=acc 后） |
| G1.3 | 水平位移线性增长 | `X(t) = X(0) + Vx * t`，实测与理论偏差 ≤ 2 su |

**默认配置验证**: `vel=(384,0,0)`, `acc=(0,0,-15)` → 水平速度恒为 384.0 su/tick

### G2. 垂直位置遵循 Euler 积分（非连续解析解）

| # | 期望 | 可量化标准 |
|---|------|-----------|
| G2.1 | Z 轴位置按逐 tick Euler 积分更新（`pos += vel` 先于 `vel += acc`） | `Z(t) = Z0 - |Az| * t*(t-1)/2`（默认 Az=-15, Z0=2048），偏差 ≤ 3 su/格点精度 |
| G2.2 | 验算点：t=5 时 Z = 2048 - 15·5·4/2 = 1898 su | 实测 Z 值 ∈ [1895, 1901] su |
| G2.3 | 验算点：t=10 时 Z = 2048 - 15·10·9/2 = 1373 su | 实测 Z 值 ∈ [1370, 1376] su |
| G2.4 | 验算点：t=16 时 Z = 2048 - 15·16·15/2 = 248 su | 实测 Z 值 ∈ [245, 251] su（接近地面但未触发检测）|

**公式推导**: 因 Euler 积分 `pos += vel; vel += acc` 在每 tick **先**更新位置**后**更新速度，位置公式为 `Z(t) = Z0 + Σ(i:0→t-1) Az·i = Z0 + Az·t·(t-1)/2`（前 t 次位置的 Z 增速来自过去 t 次速度更新，不含当前速度）

### G3. 地面碰撞检测

| # | 期望 | 可量化标准 |
|---|------|-----------|
| G3.1 | Bomb 在 `pos.Z ≤ passiveTarget.Z` 时触发 detonate | `hasDetonated()` 在条件满足的同一 tick 内返回 true |
| G3.2 | 默认配置下精确在 tick 18 引爆 | t=17 时 Z=8 su（高于地面 0），t=18 时 Z=-247 su（低于 0→引爆），`getTickCount()` = 18 且 `hasDetonated()` = true |
| G3.3 | 引爆后 position.Z 被 snap 到目标 Z（ground = 0 su） | `getImpactPosition().Z` = targetZ（默认 0），浮动 ≤ 1 su |
| G3.4 | `weapon.impact()` 被精确调用 1 次 | `getImpactCount()` = 1，不多不少 |

### G4. 落地位置预测精度

| # | 期望 | 可量化标准 |
|---|------|-----------|
| G4.1 | 落地 XY 位置 = 初始 XY + Vxy * 引爆 tick 数 | `X_impact = 0 + 384·18 = 6912 su`，实测偏差 ≤ 2 su |
| G4.2 | 落地 Y 坐标恒定（VY=0 时） | `getImpactPosition().Y` = 0（源 Y=0, VY=0），偏差 ≤ 2 su |
| G4.3 | 落地位置不受加速度 Z 大小影响（horiz/vert 解耦） | 改变 Az 仅改变引爆 tick 数，X_impact = Vx * new_ticks 仍然成立 |

### G5. 视觉效果

| # | 期望 | 可量化标准 |
|---|------|-----------|
| G5.1 | Bomb 球体沿抛物轨迹移动，视觉上先平移后加速下坠 | 前半段（t=0~8）Z 下降缓慢（182 su/tick 平均），后半段（t=13~17）Z 骤降（→225 su/tick） |
| G5.2 | 轨迹线（橙色 trail）从起点到引爆点连续无断裂 | 轨迹点数 = 引爆 tick + 1（含起点），无 NaN 点 |
| G5.3 | 引爆时出现橙色闪光球（直径 0.5 wu），在 ~500ms 内淡出 | `flashSphere.isVisible` = true 在引爆时，alpha 从 0.7 衰减到 0 在 500±100ms 内 |
| G5.4 | Bomb 球体在引爆后立即隐藏 | `bombMesh.isVisible` = false 在引爆 tick 后 |

### G6. 边界行为

| # | 期望 | 可量化标准 |
|---|------|-----------|
| G6.1 | 加速度为 0 时 bomb 匀速直线运动，最终因 Z 不变而永不引爆（Z0 > 0 时） | Az=0 时 `hasDetonated()` 在 100 ticks 后仍为 false |
| G6.2 | 高加速度（Az ≤ -30）时 bomb 快速坠落，引爆 tick 显著减少 | Az=-30, Z0=2048 → 引爆 tick ≈ 13（验证：Z(12) = 2048 - 30·12·11/2 = 68, Z(13) = 2048 - 30·13·12/2 = -292 ≤ 0） |
| G6.3 | 初始 Z 已在地面时立即引爆 | Z0 ≤ targetZ 时，`hasDetonated()` 在 1 tick 内变为 true |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/gravity-bomb-3d/`
2. 确认环境信息栏显示 "WebGL 2.0" 或 "Babylon.js" 引擎
3. 设置屏幕分辨率为 1920×1080（1x 缩放）
4. 确认默认参数：Vel X=384, Vel Y=0, Accel Z=-15, Altitude=2048, Target X=8192

### 步骤一：水平匀速验证（G1）

1. 点击 **FIRE BOMB** 按钮
2. 观察右侧 Diagnostics 面板的 `Horiz Speed (XY)` 值
3. 在整个飞行过程中（t=0 到 t=17），确认该值始终显示 `384.0 su/t`
4. 打开浏览器控制台，执行：
   ```js
   // 重置后快速步进以验证水平速度恒定
   __testHarness.resetScene()
   __testHarness.dropBomb()
   // 记录初始水平速度
   const h0 = __testHarness.getHorizontalSpeed()
   __testHarness.stepTicks(10)
   const h10 = __testHarness.getHorizontalSpeed()
   // h0 === h10 === 384.0
   ```
5. 预期：✅ h0、h10 均为 384.0，水平速度不变（G1.1）

### 步骤二：垂直 Euler 积分验证（G2）

1. 打开浏览器控制台
2. 执行以下命令逐 tick 验证 Z 值：
   ```js
   __testHarness.resetScene()
   __testHarness.dropBomb()
   __testHarness.stepTicks(5)
   // getBombPosition().Z 应为 ~1898 su
   __testHarness.stepTicks(5)
   // getBombPosition().Z 应为 ~1373 su
   __testHarness.stepTicks(6)
   // getBombPosition().Z 应为 ~248 su (或已引爆)
   ```
3. 记录各 tick 的 Z 值
4. 预期：✅ t=5: Z≈1898, t=10: Z≈1373, t=16: Z≈248 （G2.2-G2.4）

### 步骤三：引爆检测验证（G3）

1. 点击 **FIRE BOMB**，观察 bomb 飞行
2. 注意右侧 `Status` 栏：从 `FALLING` 变为 `DETONATED`（橙色高亮）
3. 确认 `Impact Count` 显示为 `1`（不多不少）
4. 确认 `Tick` 显示 18（默认配置下精确在 tick 18 引爆）
5. 在控制台验证：
   ```js
   __testHarness.hasDetonated()  // true
   __testHarness.getImpactCount()  // 1
   __testHarness.getImpactPosition().Z  // 0 (地面)
   ```
6. 预期：✅ tick 18 引爆，impact count = 1，impact Z = 0（G3.1-G3.4）

### 步骤四：落地位置验证（G4）

1. 在 bomb 引爆后，查看 `Position (WPos)` 显示的值
2. 确认 X ≈ 6912, Y ≈ 0, Z ≈ 0
3. 或在控制台：
   ```js
   const ip = __testHarness.getImpactPosition()
   // ip.X ≈ 6912, ip.Y ≈ 0, ip.Z ≈ 0
   ```
4. 计算水平旅行距离：`6912 - 0 = 6912 su`，飞行时间 18 ticks
5. 验证：`6912 / 18 = 384.0` = 水平速度
6. 预期：✅ 落地 X=6912±2 su, Y=0±2 su（G4.1-G4.2）

### 步骤五：视觉效果验证（G5）

1. 点击 **FIRE BOMB** 后观察 3D 场景
2. 确认蓝色球体（源标记）在 high altitude 位置
3. 确认红色圆环（目标标记）贴在地面上
4. 确认橙色 bomb 球体从蓝球位置出发，沿抛物轨迹运动
5. 确认橙色轨迹线跟随 bomb，无断裂
6. 引爆瞬间：橙色闪光球出现在地面，bomb 球体消失
7. 闪光球在约 0.5 秒内逐渐透明至消失
8. 预期：✅ 所有视觉效果符合 G5.1-G5.4

### 步骤六：边界测试（G6）

1. **匀速测试**（G6.1）：
   - 将 `Accel Z` 滑块拖到最右边（-3 su/t²）
   - 点击 FIRE BOMB — bomb 缓慢加速下坠
   - 控制台：`__testHarness.stepTicks(100); __testHarness.hasDetonated()` → 检查是否已引爆
   - 如果 100 ticks 后仍飞行中（取决于 altitude 和 az），符合预期
   - 极端情况：Az=0 时永远不会引爆（除非修改代码设置 az=0 输入）

2. **高加速度快速坠落**（G6.2）：
   - 将 `Accel Z` 调到 -30，点击 FIRE BOMB
   - 预期引爆 tick ≈ 12，明显少于默认的 17
   - 验证公式：`Z(12) = 2048 - 30·12·13/2 = 2048 - 2340 = -292 ≤ 0`

3. **零高度起爆**（G6.3）：
   - 控制台执行：`__testHarness.dropBomb({X:0, Y:0, Z:0}, {X:0, Y:0, Z:0}, {X:0, Y:0, Z:0})`
   - `__testHarness.stepTicks(1); __testHarness.hasDetonated()` → true（Z=0 ≤ targetZ=0）

### 结果判定

- [ ] 所有 G1-G4 量化指标通过 → **ACCEPTED**
- [ ] 部分失败 → 记录具体差异（期望 vs 实测），提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息
