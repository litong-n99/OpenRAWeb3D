# Missile Trajectory — Acceptance Test

**Module**: Missile Projectile (Chapter 8 Phase B)
**Test Case ID**: `ch08-weapons-combat/missile-trajectory`
**OpenRA Source**: `OpenRA.Mods.Common/Projectiles/Missile.cs`
**TypeScript Target**: `src/OpenRA.Mods.Common/Projectiles/Missile.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 22/22 通过, 100%)

---

## 期望结果 (Expected Results)

### M1. Straight Flight — 直线飞行（无制导）

**上下文**: 设置 `homingActivationDelay=999`（永不进入 Homing）且 `gravity=0`，导弹保持初始速度方向直线飞行。导弹仅通过 `_freefallTick()` 移动（velocity 不变，无重力加速度）。当飞行距离超过 `rangeLimit` 时，因 `explodeWhenEmpty=true` 而引爆。

坐标约定: WAngle 0=北（WPos -Y方向），逆时针递增。facing=64=东（WPos +X方向）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| M1.1 | 导弹从 source=(1024, 5120, 0) 出发，朝向 facing=64（东/+X方向）飞行 | 初始 pos.X=1024，后续每 tick pos.X 单调递增约 300 units |
| M1.2 | 导弹飞行路径为直线，pos.Y 和 pos.Z 保持不变（无制导修正，无重力） | 全程 `pos.Y` 偏差 ≤ 10 su，`pos.Z` 偏差 ≤ 10 su |
| M1.3 | 导弹到达目标位置偏差 ≤ 256 su（closeEnough=256） | 引爆时 `|pos - target|` ≤ 256 su |
| M1.4 | 尾迹/contrail 从 source 位置开始沿飞行路径延伸，trail dots 数量 ≥ 10 | 每个 trail interval (3 ticks) 创建一个 dot |
| M1.5 | 导弹在命中后 3 tick 内自我销毁（frame-end task 执行后 `isDestroyed=true`） | `simulateTick()` 检测到 `isDestroyed===true` 后停止模拟 |
| M1.6 | 尾迹透明度（dot 颜色）随时间从 cyan → white → red 渐变（piecewise: 前50% cyan→white，后50% white→red） | 早期 dot RGB≈(0,1,1)，中期≈(1,1,1)，末期≈(1,0,0) |
| M1.7 | 尾迹 dot 材质透明度（emissive 强度）随时间进度递减，alpha 衰减率等效每秒 ~10% | t=0 时 emissive=(0,0.3,0.2)，t=0.5 时 emissive=(0.5,0.3,0.2)，t=1 时 emissive=(0.5,0,0) — G/B 通道在第二阶段降至 0 |

### M2. Homing — 制导追踪（跟踪移动目标）

**上下文**: `homingActivationDelay=5`，5 ticks 后进入 Homing 状态，导弹根据 `horizontalRateOfTurn=25` 和 `verticalRateOfTurn=20` 逐步修正航向以跟踪移动目标（红色立方体在场景中沿正弦波振荡）。每 tick 航向修正量 ≤ turn rate。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| M2.1 | 前 5 ticks 导弹处于 Freefall 状态，沿初始方向直线飞行 | T0-T4: `missile.state === MissileState.Freefall (0)` |
| M2.2 | T5 时状态切换到 Homing（`ticks === homingActivationDelay + 1`） | 事件日志显示 "Freefall → Homing" 在 T5 |
| M2.3 | 制导期间每 tick hFacing 修正量 ≤ horizontalRateOfTurn (25 facing units) | `|hFacing(t) - hFacing(t-1)| ≤ 25` |
| M2.4 | 制导期间每 tick vFacing 修正量 ≤ verticalRateOfTurn (20 facing units) | `|vFacing(t) - vFacing(t-1)| ≤ 20` |
| M2.5 | 导弹轨迹向移动目标弯曲（视觉可见的弧线追赶路径） | 从上方俯视时，轨迹呈明显曲线而非直线 |
| M2.6 | 当 relTarDist < closeEnough (350 su) 时导弹引爆，`weapon.impact` 至少被调用 1 次 | 引爆后 `isDestroyed===true`，impactCount ≥ 1 |

### M3. Arcing — 弧线弹道（抛物线高抛）

**上下文**: `homingActivationDelay=999`（永不制导），`gravity=10`。导弹以较高初始仰角发射，受重力影响形成抛物线弹道。此为 `_freefallTick()` 实现的纯欧拉积分弹道：`velocity += gravity` 每 tick，`pos += velocity` 每 tick。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| M3.1 | 导弹初始有向上的 velocity 分量（vFacing > 0），pos.Z 先增加后减少 | 弹道最高点 Z > 初始 Z，轨迹呈抛物线形状 |
| M3.2 | 弹道顶点高度由初始速度垂直分量和重力决定：`apex_Z = source_Z + v0_z² / (2*gravity)` | 实测顶点高度与理论值偏差 ≤ 5% |
| M3.3 | 导弹最终触地（pos.Z ≤ 0 或 closeEnough 触发）时引爆 | 引爆时 `isDestroyed===true`，impactCount ≥ 1 |
| M3.4 | 弹道 XZ 平面投影为直线（无制导修正） | pos.Y 保持基本不变（偏差 ≤ 10 su） |
| M3.5 | 尾迹 dots 形成明显的弧形分布（从侧面观察时） | 轨迹从侧面可见向上弯曲再下落 |

### M4. 通用行为

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| M4.1 | Reset 后所有 trail dots 和 markers 被清除，导弹状态重置，目标回到初始位置 | 场景中无可视残留，日志清空，诊断面板显示 "-" |
| M4.2 | 重复发射（3 次 Straight 模式）结果一致 | 每次飞行路径长度差异 ≤ 5%，引爆位置偏差 ≤ 50 su |
| M4.3 | FPS 在仿真运行期间保持 ≥ 30（无内存泄漏或渲染卡顿） | 环境信息栏 FPS 读数 ≥ 30 |
| M4.4 | 目标移动速度滑杆调整后，Homing 弹道曲率相应变化 | 速度=0 时轨迹接近直线，速度=3 时轨迹明显弯曲 |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/missile-trajectory/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 确认 3D 场景已加载（可见灰色地面带网格线，红色立方体为移动目标）
5. 视角操作：鼠标左键拖拽旋转，滚轮缩放，右键平移

### 步骤一：Straight Flight — 直线飞行

1. 点击 **"Straight"** 按钮
2. 观察 3D 场景：
   - 绿色球体 = 发射位置 (1, 5, 0)
   - 红色球体 = 目标位置 (9, 5, 0)
   - 青色→红色渐变的轨迹点从发射点向目标延伸
3. 从上方俯视（调整相机到垂直视角），观察轨迹是否为直线
4. **预期**:
   - [x] 轨迹呈直线从绿点指向红点（M1.2）✅
   - [x] 轨迹点数 ≥ 10（M1.4）✅
   - [x] 导弹在目标附近引爆（M1.3）✅
   - [x] 事件日志显示最终 "MISSILE DESTROYED"（M1.5）✅
   - [x] 早期轨迹点是蓝青色，晚期是红色（M1.6）✅

### 步骤二：Homing — 制导追踪

1. 点击 **"Homing"** 按钮
2. 观察红色立方体（移动目标）沿正弦轨迹振荡
3. 观察导弹轨迹：
   - 前 5 ticks 直线飞行（Freefall 阶段）
   - 之后轨迹弯曲，追踪移动的红色立方体
4. 调整 **Target Speed** 滑杆到不同值（0, 1.5, 3），重新点击 Homing 观察弹道变化
5. **预期**:
   - [x] 事件日志显示 T5 "Freefall → Homing"（M2.2）✅
   - [x] 轨迹呈明显曲线，追向移动目标方向（M2.5）✅
   - [x] 导弹最终在目标附近引爆（M2.6）✅
   - [x] Target Speed=0 时轨迹接近直线，Speed=3 时轨迹曲率最大（M4.4）✅

### 步骤三：Arcing — 弧线弹道

1. 点击 **"Arcing"** 按钮
2. 使用鼠标旋转视角到侧面（观察 YZ 平面，即高度剖面）
3. 观察导弹轨迹从低到高再下降的抛物线形状
4. 从上方俯视确认 XZ 平面投影为直线
5. **预期**:
   - [x] 轨迹从侧面可见向上弯曲再下落（M3.1, M3.5）✅
   - [x] 最高点 Z > 初始 Z（M3.1）✅
   - [x] 弹道 XZ 平面投影为直线（M3.4）✅
   - [x] 导弹最终触地引爆（M3.3）✅

### 步骤四：Reset 与可重复性

1. 点击 **"Reset Scene"** 按钮
2. 验证所有轨迹点、标记被清除
3. 连续点击 "Straight" 3 次，观察每次轨迹是否一致
4. **预期**:
   - [x] Reset 后场景干净，无可视残留（M4.1）✅
   - [x] 3 次 Straight 发射轨迹基本一致（M4.2）✅
   - [x] FPS 在测试期间保持 ≥ 30（M4.3）✅

### 边界/异常测试

1. **快速切换模式**: 依次快速点击 Straight → Homing → Arcing → Straight
   - [x] 每次点击后前一次导弹的轨迹被清除，新轨迹正确显示 ✅
2. **窗口缩放**: 将浏览器窗口从 1920x1080 缩小到 1280x720
   - [x] 3D 场景正确适应新尺寸，环境信息栏同步更新 ✅
3. **目标速度极值**: 将 Target Speed 设为 0，点击 Homing → 目标静止
   - [x] 导弹直接飞向静止目标，轨迹接近直线 ✅
4. **目标速度极值**: 将 Target Speed 设为 3，点击 Homing → 目标快速移动
   - [x] 弹道曲率明显增大，但导弹仍在追踪 ✅

### 结果判定

- [ ] 所有期望结果 (M1-M4) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异（位置偏差值、状态切换 tick、轨迹点数），提交 issue
- [ ] 测试环境异常（WebGL 不可用 / 渲染错误）→ 记录 UA / 视口 / 引擎信息

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

### Missile 状态机 (MissileState)

| 值 | 状态 | 含义 |
|----|------|------|
| 0 | Freefall | 未进入制导，直线飞行 + 重力 |
| 1 | Homing | 主动追踪目标，每 tick 修正 hFacing/vFacing |
| 2 | Hitting | 最终接近阶段，close enough 后引爆 |

### Facing 角度编码

- 0-255 编码整圆 (360°)
- 0 = 北 (WPos -Y), 64 = 东 (WPos +X), 128 = 南 (WPos +Y), 192 = 西 (WPos -X)
- turn rate 单位: facing units/tick（如 20 = 约 28.1°/tick）

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 — 3 种飞行模式可视化 | acceptance-test-assistant |
