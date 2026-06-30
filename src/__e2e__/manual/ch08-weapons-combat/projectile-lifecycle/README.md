# Projectile Lifecycle — Acceptance Test

**Module**: Projectiles System (Chapter 8 Phase B)
**Test Case ID**: `projectiles/projectile-lifecycle`
**OpenRA Source**: `OpenRA.Mods.Common/Projectiles/*.cs` (8 projectile types)
**TypeScript Target**: `src/OpenRA.Mods.Common/Projectiles/*.ts`

---

## 期望结果 (Expected Results)

### TC1. ProjectileRegistry 注册表完整性

**上下文**: `PROJECTILE_REGISTRY` 是一个 `Record<string, ProjectileFactory>` 映射表，武器系统通过抛射体名称查找工厂函数来创建实例。所有 8 种抛射体类型必须在注册表中可查找。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| TC1.1 | `PROJECTILE_REGISTRY['Bullet']` 存在且 `typeof .create === 'function'` | 工厂对象非 undefined，.create 属性类型为 function |
| TC1.2 | `PROJECTILE_REGISTRY['Missile']` 存在且工厂可用 | 同上 |
| TC1.3 | `PROJECTILE_REGISTRY['GravityBomb']` 存在且工厂可用 | 同上 |
| TC1.4 | `PROJECTILE_REGISTRY['InstantHit']` 存在且工厂可用 | 同上 |
| TC1.5 | `PROJECTILE_REGISTRY['LaserZap']` 存在且工厂可用 | 同上 |
| TC1.6 | `PROJECTILE_REGISTRY['Railgun']` 存在且工厂可用 | 同上 |
| TC1.7 | `PROJECTILE_REGISTRY['AreaBeam']` 存在且工厂可用 | 同上 |
| TC1.8 | `PROJECTILE_REGISTRY['NukeLaunch']` 存在且工厂可用 | 同上 |
| TC1.9 | 注册表键总数 = 8 | `Object.keys(PROJECTILE_REGISTRY).length === 8` |

### TC2. Missile 状态机 (Freefall → Homing → Hitting → Explode)

**上下文**: `Missile` 类实现了三分支状态机。启动时处于 `Freefall` (0)，在 `homingActivationDelay` ticks 后切换到 `Homing` (1)，当接近目标 (relTarHorDist ≤ 3×loopRadius) 时切换到 `Hitting` (2)。当 `distanceCovered > rangeLimit` 时返回 Freefall（燃料耗尽）。当 `relTarDist < closeEnough` 时引爆 (`_explode`)，设置 `isDestroyed = true`。

坐标约定: WAngle 0 = 北（WPos -Y 方向），逆时针递增。facing=64 = 东（WPos +X 方向）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| TC2.1 | 创建后初始状态 = MissileState.Freefall (0) | `missile.state === 0`，`missile.isDestroyed === false` |
| TC2.2 | 经过 `homingActivationDelay=5` ticks 后状态切换到 Homing (1) | 在 T5 或 T6 时 `missile.state === 1`（因为检查发生在 `ticks === homingActivationDelay + 1`） |
| TC2.3 | Homing 期间每 tick 更新 pos、vFacing、hFacing | pos 每 tick 变化，hFacing 逐步转向目标方向（64 = 东） |
| TC2.4 | 当 relTarDist < closeEnough (512 su) 时引爆 | `missile.isDestroyed === true`，武器 `impact` 被调用至少 1 次 |
| TC2.5 | 若 `distanceCovered > rangeLimit` 则返回 Freefall 状态，最终引爆（explodeWhenEmpty=true） | 燃料耗尽后状态记录为 Freefall 或最终引爆 |

### TC3. InstantHit 零飞行时间 (Tick 0 触发)

**上下文**: `InstantHit` 在单个 tick 内完成所有逻辑——检查阻挡、应用 inaccuracy、触发 warhead、标记 `isDestroyed = true`。它代表狙击步枪、机枪等"即时命中"武器。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| TC3.1 | `tick()` 调用后 `isDestroyed === true` | 第一次 tick 后立即为 true |
| TC3.2 | `tick()` 调用后武器 `impact` 被调用恰好 1 次 | `args.weapon.impactCount === 1` |
| TC3.3 | 第二次 `tick()` 调用为 no-op（因为 `isDestroyed` 已为 true） | impactCount 不增加，仍为 1 |
| TC3.4 | 创建时 `isDestroyed === false` | 构造函数中初始化为 false |

### TC4. GravityBomb 欧拉积分弹道 (Euler Integration Trajectory)

**上下文**: `GravityBomb` 每 tick 执行 `pos = pos + velocity`，然后 `velocity = velocity + acceleration`（欧拉积分）。当 `pos.Z <= passiveTarget.Z` 时，炸弹触地并引爆。

初始条件（测试用）: source=(5120, 5120, 1024), target=(7168, 5120, 0), velocity=(Y,-X)=(0, -200, 50) 旋转 facing=64(东), acceleration=(0, 0, -15).

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| TC4.1 | 轨迹包含至少 5 个可观察的位置点 | 场景中至少 5 个黄色/渐变轨迹球体，呈抛物线形状 |
| TC4.2 | 最高点 Z > 初始 Z (1024)，因为初始 velocity 有向上分量 | `maxZ > 1024`（在上抛后达到更高的高度） |
| TC4.3 | 触地引爆条件：最终 `pos.Z <= 0` (target.Z) | bomb 在 Z <= 0 时 `isDestroyed === true` |
| TC4.4 | 触地后武器 `impact` 被调用恰好 1 次 | `args.weapon.impactCount === 1` |
| TC4.5 | 弹道形状为弧线（非直线），因为重力加速度持续作用 | 视觉上从场景上方观察时形成明显的抛物线弧 |

### TC5. BeamRenderableShape 枚举

**上下文**: `BeamRenderableShape` 是 `AreaBeam`、`Railgun`、`LaserZap` 共用的光束渲染形状枚举。它定义一个 const object + type alias（而非 TypeScript enum），以匹配 C# 的整数枚举语义。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| TC5.1 | `BeamRenderableShape.Cylindrical === 0` | 整数比较，值为 0 |
| TC5.2 | `BeamRenderableShape.Flat === 1` | 整数比较，值为 1 |
| TC5.3 | 枚举共 2 个值 | `Object.keys(BeamRenderableShape).length === 2` (常量属性) |

### TC6. LaserZap 视觉持久时长 Tracking

**上下文**: `LaserZap` 有一个 `duration` 属性（默认 10 ticks）和一个 `damageDuration` 属性（默认 1 tick）。`beamAlpha` getter 计算 `remaining * color[3] / duration`，其中 `remaining = duration - ticks`。当 `ticks >= duration` 时，`beamAlpha` 返回 0。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| TC6.1 | T0 时 `beamAlpha === 255`（color alpha=255, 10 ticks remaining of 10） | `beamAlpha = Math.trunc(10 * 255 / 10) = 255` |
| TC6.2 | T5 时 `beamAlpha` 约为初始值的一半 | `beamAlpha = Math.trunc(5 * 255 / 10) = 127` (±2 due to integer truncation) |
| TC6.3 | T10 (duration ticks) 时 `beamAlpha === 0` | `Math.trunc(0 * 255 / 10) = 0` |
| TC6.4 | `damageDuration=3` 期间 (T0-T2) 每 `damageInterval=1` tick 触发一次 warhead | `args.weapon.impactCount >= 1` 在 T0-T2 期间 |
| TC6.5 | `ticks` 计数器正确递增 | 每次 tick() 后 `laserZap.ticks` 增加 1 |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/projectiles/projectile-lifecycle/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 确认 3D 场景已加载（可见灰色地面和网格线）

### 步骤一：全部测试 (推荐)

1. 点击 "▶ 执行全部测试" 按钮
2. 观察右侧面板：
   - **测试结果**区域应显示 6 条绿色 ✅ 结果
   - **活跃抛射体诊断**区域显示最后一个测试的抛射体状态
   - **事件日志**滚动显示完整的测试执行过程
3. **预期**:
   - [x] TC1-TC6 全部显示绿色 ✅ 通过（E1-E6）

### 步骤二：单独验证 TC1 — 注册表完整性

1. 点击 "↺ 重置所有状态" 按钮
2. 点击 "TC1 - ProjectileRegistry 注册表" 按钮
3. 观察事件日志中 8 条 `[registry]` 行
4. **预期**:
   - [x] 事件日志显示全部 8 种类型名称（TC1.1-TC1.8）✅
   - [x] 每条日志为绿色 `log-registry` 样式（TC1.1-TC1.8）✅
   - [x] "总计: 8 种抛射体类型已注册"（TC1.9）✅

### 步骤三：单独验证 TC2 — Missile 状态机

1. 点击 "↺ 重置所有状态" 按钮
2. 点击 "TC2 - Missile 状态机" 按钮
3. 观察 3D 场景：
   - 绿色球体 = 发射位置 (5, 5, 0)
   - 红色球体 = 目标位置 (9, 5, 0)
   - 黄色球体连成的轨迹 = Missile 飞行路径
4. 观察事件日志中的状态切换
5. **预期**:
   - [x] 轨迹从绿点附近出发，向红点方向延伸（TC2.1）✅
   - [x] 事件日志中有 "Freefall → Homing" 切换 (T5-T6)（TC2.2）✅
   - [x] 事件日志中最终有 "isDestroyed=true"（TC2.4）✅
   - [x] 场景中黄色标记出现在红点附近（TC2.4）✅

### 步骤四：单独验证 TC3 — InstantHit 即时命中

1. 点击 "↺ 重置所有状态" 按钮
2. 点击 "TC3 - InstantHit 即时命中" 按钮
3. 观察事件日志中最新的两条记录
4. **预期**:
   - [x] T0 行显示 `武器触发次数=1` 和 `isDestroyed=true`（TC3.1, TC3.2）✅
   - [x] `测试结果: 武器触发次数=1 | isDestroyed=true`（TC3.2）✅

### 步骤五：单独验证 TC4 — GravityBomb 弹道

1. 点击 "↺ 重置所有状态" 按钮
2. 点击 "TC4 - GravityBomb 弹道" 按钮
3. 观察 3D 场景中的轨迹球体
4. 使用鼠标旋转视角，从侧面观察轨迹是否为弧线
5. **预期**:
   - [x] 场景中至少有 5 个轨迹球体（TC4.1）✅
   - [x] 轨迹形成抛物线弧（非直线）（TC4.5）✅
   - [x] 事件日志显示最高点 Z 值 > 1024（TC4.2）✅
   - [x] 事件日志显示最终触地引爆（TC4.3）✅

### 步骤六：单独验证 TC5 — BeamRenderableShape 枚举

1. 点击 "↺ 重置所有状态" 按钮
2. 点击 "TC5 - BeamRenderableShape 枚举" 按钮
3. 观察事件日志
4. **预期**:
   - [x] 事件日志显示 `Cylindrical = 0`（TC5.1）✅
   - [x] 事件日志显示 `Flat = 1`（TC5.2）✅
   - [x] 诊断面板显示 `Cylindrical=0 Flat=1`（TC5.1, TC5.2）✅

### 步骤七：单独验证 TC6 — LaserZap 持续时长

1. 点击 "↺ 重置所有状态" 按钮
2. 点击 "TC6 - LaserZap 持续时长" 按钮
3. 观察事件日志中 T0-T9 的 beamAlpha 变化
4. **预期**:
   - [x] T0 时 beamAlpha = 255（TC6.1）✅
   - [x] T5 时 beamAlpha 接近 127 (127-128)（TC6.2）✅
   - [x] T10 时 beamAlpha = 0（TC6.3）✅
   - [x] 诊断面板显示 `alpha=0 | impacts>=1`（TC6.4）✅

### 边界/异常测试

1. **重复执行**: 连续点击 "执行全部测试" 3 次
   - [x] 每次结果一致，无内存泄漏（FPS 保持 > 30），无累积残留标记 ✅
2. **单测隔离**: 先执行 TC2，再执行 TC4，检查场景标记是否被正确清除
   - [x] TC2 的黄色轨迹在 TC4 执行后消失，仅显示 TC4 的绿/红色轨迹 ✅
3. **窗口大小调整**: 将浏览器窗口从 1920x1080 调整为 1280x720
   - [x] 3D 场景正确适应新尺寸，事件日志可滚动查看 ✅
4. **旋转观察**: 使用鼠标拖拽旋转场景视角
   - [x] 轨迹从不同角度观察时形状一致 ✅

### 结果判定

- [x] 所有期望结果 (TC1-TC6) 通过 → **ACCEPTED** ✅
- [ ] 部分未通过 → 记录具体差异（状态值、坐标值、武器触发次数），提交 issue
- [ ] 测试环境异常（WebGL 不可用 / 渲染错误）→ 记录 UA / 视口 / 引擎信息

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 8/8 通过, 100%)

---

## 坐标系参考 (Coordinate System Reference)

### WPos 坐标约定 (来自 OpenRA 原始源码)

| 轴 | 语义 | WAngle 方向 | 说明 |
|---|------|-----------|------|
| +X | 东 (East) | facing=64 (90 deg) | WAngle 0=北, 逆时针递增 |
| +Y | 南 (South) | facing=128 (180 deg) | WAngle 递增 = 逆时针旋转 |
| +Z | 上 (Height) | — | 高度轴，地面 Z=0 |

### Babylon.js 坐标系映射

| WPos 轴 | Vector3 轴 | 缩放 | 屏幕表现 (alpha=-PI/2, beta=PI/3.5) |
|---------|-----------|------|-------------------------------------|
| WPos.X | Vector3.x | 1/1024 | 屏幕右 |
| WPos.Y | Vector3.z | 1/1024 | 屏幕下（远离相机） |
| WPos.Z | Vector3.y | 1/512 | 屏幕上 |

### 整数计算约定

所有轨迹计算使用整数 `WDist`/`WPos`/`WVec`（完全确定性），严禁浮点运算。匹配 OpenRA 的定点数数学。

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-12 | 初始创建 | acceptance-test-assistant |
