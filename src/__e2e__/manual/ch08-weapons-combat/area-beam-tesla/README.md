# Area Beam Tesla — Acceptance Test

**Module**: AreaBeam Projectile (Chapter 8 Phase B)
**Test Case ID**: `ch08-weapons-combat/area-beam-tesla`
**OpenRA Source**: `OpenRA.Mods.Common/Projectiles/AreaBeam.ts`
**TypeScript Target**: `src/OpenRA.Mods.Common/Projectiles/AreaBeam.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果 (Expected Results)

### A1. Beam Opacity Reaches 1.0 Within FadeIn (Head Travel) ±1 Tick

**上下文**: `AreaBeam` 在构造时计算 `length = Math.trunc(headDist / speed.length)`，head 沿 `WPos.lerpLong` 从 source 到 target 插值移动，耗时 `length` ticks。测试页面将 head 行进期间的 opacity 映射为 `headTicks / length`（0→1 线性淡入）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| A1.1 | 默认 config (speed=512, dist=9216su) 下，`length = 18` ticks | head 恰好在 tick 18 到达 target |
| A1.2 | Tick 17 时 opacity ≈ 0.94（17/18），Tick 18 时 opacity = 1.0 | `getBeamOpacity()` 在 tick 18 返回 1.0，偏差 ≤ 0.02 |
| A1.3 | 调整 speed=256 后 length=36，opacity 在 tick 36 达 1.0 | fade-in 时间随 speed 反比缩放 |
| A1.4 | 淡入期间 beam visual（cylinder + glow line）从不透明过渡到完全可见 | 肉眼可见 cylinder alpha 从 0 渐增至 0.3 |

### A2. Beam Midpoint Width Matches Configured WDist (≤5%)

**上下文**: `width: WDist` 控制光束直径。在 3D 场景中渲染为 cylinder 的 diameter 和 width indicator ring（torus）的直径。worldWidth = WDist.length / 1024。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| A2.1 | 默认 width=512 su → cylinder diameter = 0.5 wu | `getBeamWidth() === 0.5`（偏差 ≤ 0.025 wu，即 5%） |
| A2.2 | 调整 width=1024 su → cylinder diameter = 1.0 wu | diameter 翻倍，width ring 明显更大 |
| A2.3 | Width ring（青色 torus）在光束中点可见，直径匹配配置值 | 肉眼观察 ring 直径与 grid 刻度对比，误差 ≤ 0.05 wu |
| A2.4 | 调整 width=256 → 光束明显变细 | width slider 最小值时 cylinder 直径 = 0.25 wu |

### A3. Actors Within width/2 Receive Damage

**上下文**: `findActorsOnLine` 回调计算 actor 到 beam 中心线（XY 平面）的垂直距离。若 `dist ≤ width/2`，actor 被纳入 damage 计算并标记为 hit（变红）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| A3.1 | "A_center" (on centerline, dist=0) → hit | `getMockActorStates()[A_center].hit === true` |
| A3.2 | "B_inside" (offset 0.6*radius ≈ 154su) → hit | 距离 154su < 256su(radius)，hit=true |
| A3.3 | "D_edge" (offset 0.98*radius ≈ 251su) → hit | 距离 251su < 256su，hit=true（边界内） |
| A3.4 | 被命中的 actor 模型从蓝色变为红色 | 材料从 `actorNormalMat`(蓝) 切换到 `actorHitMat`(红) |

### A4. Actors Outside width/2 Receive No Damage

**上下文**: 距离 beam 中心线超过 `width/2` 的 actor 不应被命中。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| A4.1 | "C_outside" (offset 1.5*radius ≈ 384su) → NOT hit | 距离 384su > 256su，hit=false |
| A4.2 | "E_farOutside" (offset 3*radius ≈ 768su) → NOT hit | 距离 768su >> 256su，hit=false |
| A4.3 | 未被命中的 actor 保持蓝色（正常材料） | 模型颜色不变 |
| A4.4 | `getActorsInBeam()` 返回的 ID 列表不包含 C_outside 和 E_farOutside | ID list 仅含 {A_center, B_inside, D_edge} |

### A5. Beam Fully Disposed After FadeOut (Tail Travel)

**上下文**: `_stopTargeting()` 被调用后（`headTicks >= duration` 或 source dead/out-of-range），`isTailTravelling = true`，tail 开始沿 beam path 移动。tail 到达后 `isBeamComplete` 为 true，beam 通过 `world.removeEffect` 移除。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| A5.1 | 默认 config 下 tail 在 tick 30 开始移动（duration=30） | `isFadingOut()` 在 tick 30 变为 true |
| A5.2 | Tail 在 `length` ticks 内到达 target（tick 48） | tail 在 tick 48 到达，beam complete |
| A5.3 | Beam complete 后 visual 完全隐藏 | `getBeamOpacity() === 0`，cylinder + line + ring disabled |
| A5.4 | `isFadingOut()` 在 fadeOut 期间返回 true，完成后返回 false | 事件日志记录 "DESTROYED" + impact count |

### A6. Config Slider Responsiveness

**上下文**: 用户调整 speed/duration/width/color slider 后，下次 Fire 使用新配置。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| A6.1 | speed slider 调至 256 → length 变为 36，fadeIn 延长 | beam length 显示从 18→36 |
| A6.2 | duration slider 调至 15 → sustain 阶段缩短或消失（直接进入 fadeOut） | stopTargeting 在 tick 15 触发 |
| A6.3 | width slider 调至 2048 → 更多 actor 被命中（宽度扩大） | 原本在外的 actor 可能被纳入 |
| A6.4 | color 下拉切换 → 下一次 Fire 光束颜色改变 | cylinder + glow line 颜色与所选一致 |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/area-beam-tesla/`
2. 确认环境信息栏显示 "WebGL 2.0"
3. 设置屏幕分辨率 1920x1080（1x 缩放）
4. 确认 3D 场景加载：灰色地面 + 网格

### 步骤一：Basic Beam Fire (FadeIn + Sustain + FadeOut)

1. 保持默认配置（speed=512, duration=30, width=512, Tesla Blue）
2. 点击 **"FIRE BEAM"**
3. 观察光束从绿色 source marker 向红色 target marker 延伸
4. **预期**:
   - [ ] 光束在 ~18 ticks 内完成淡入（A1.1, A1.2）
   - [ ] 淡入完成后光束保持完全可见约 12 ticks（sustain 阶段）
   - [ ] 约 tick 30 时 tail 开始移动，光束开始淡出（A5.1）
   - [ ] ~tick 48 时光束完全消失（A5.2, A5.3）
   - [ ] 各阶段事件日志记录完整

### 步骤二：AOE Verification (Actor Hit Detection)

1. 观察 5 个 mock actor 立方体（蓝色 = 未命中，红色 = 命中）
2. Fire 光束后观察哪些 actor 变为红色
3. **预期**:
   - [ ] A_center（中心线上）→ 变红（A3.1）
   - [ ] B_inside（宽度内偏移）→ 变红（A3.2）
   - [ ] D_edge（边缘内）→ 变红（A3.3）
   - [ ] C_outside（宽度外偏移）→ 保持蓝色（A4.1）
   - [ ] E_farOutside（远处）→ 保持蓝色（A4.2）
   - [ ] 诊断面板 "Actors Hit" 显示 ID 列表 [A_center, B_inside, D_edge]（A4.4）

### 步骤三：Width Verification

1. 观察光束中点的青色 torus ring（宽度指示器）
2. 调整 width slider 到不同值，每次 Fire
3. 使用 grid 线作为参考（每格 1 wu）
4. **预期**:
   - [ ] width=512 → ring 直径约 0.5 wu（A2.1）
   - [ ] width=1024 → ring 直径约 1.0 wu（A2.2）
   - [ ] width=256 → ring 明显变小（A2.4）
   - [ ] `getBeamWidth()` 返回值与 slider 设定值一致（±5%）

### 步骤四：Config Variation — Speed

1. Speed slider 调至 256，Fire
2. 观察光束延伸更慢（fadeIn 更长）
3. **预期**:
   - [ ] length 显示从 18→36（A6.1）
   - [ ] fadeIn 耗时约 36 ticks

### 步骤五：Config Variation — Duration

1. Duration slider 调至 15（< length=18），Fire
2. 观察 sustain 阶段是否消失（head 未到达 target 时 tail 已开始移动）
3. **预期**:
   - [ ] stopTargeting 在 tick 15 触发（A6.2）
   - [ ] 光束从 fadeIn 直接进入 fadeOut（无 sustain）

### 边界/异常测试

1. **快速连续发射**: 连续点击 Fire 3 次
   - [ ] 每次发射清除前次所有视觉残留
2. **Width 最小值 (128 su)**: 设置 width=128，Fire
   - [ ] 只有中心线上的 A_center 被命中，其他全部在宽度外
3. **Width 最大值 (2048 su)**: 设置 width=2048，Fire
   - [ ] 所有 5 个 actor 均在宽度内，全部变红（A6.3）
4. **Speed 最大值 (1024)**: 设置 speed=1024，Fire
   - [ ] length=9，fadeIn 非常快（9 ticks）

### 结果判定

- [ ] 所有期望结果 (A1-A6) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异，提交 issue
- [ ] 测试环境异常 → 记录 UA / viewport / engine

---

## 坐标系参考

| WPos 轴 | 语义 | Vector3 轴 | 缩放 |
|---------|------|-----------|------|
| +X | 东 | x | 1/1024 |
| +Y | 南 | z | 1/1024 |
| +Z | 高 | y | 1/512 |

AOE 计算使用 2D 点→线段距离（WPos X/Y 平面 = Vector3 x/z 平面）。

## 光束参数计算（默认 config）

| 参数 | 值 | 公式 |
|------|-----|------|
| speed | 512 su/t | 可调 slider |
| distance | 9216 su | `|target - source|` |
| length | 18 t | `Math.trunc(distance / speed)` |
| duration | 30 t | 可调 slider |
| width | 512 su (radius=256 su) | 可调 slider |
| fadeIn ticks | 0–17 | head travelling |
| sustain ticks | 18–29 | head arrived, pre-stopTargeting |
| fadeOut ticks | 30–47 | tail travelling |
| done tick | 48+ | beam complete, removed |

---

## GLSL / Shader 对照

AreaBeam 不直接使用自定义 GLSL shader。所有视觉效果通过 Babylon.js StandardMaterial 实现：

| 效果 | OpenRA (GLSL) | Babylon.js (WebGL) |
|------|--------------|---------------------|
| 光束颜色 | `uniform vec4 uColor` → `fragColor = uColor` | `StandardMaterial.diffuseColor` + `emissiveColor` |
| 透明度淡入/淡出 | `fragColor.a *= uAlpha` | `StandardMaterial.alpha` 逐帧更新 |
| 圆柱体几何 | 无 (2D sprite 条纹) | `MeshBuilder.CreateCylinder` + `scaling` |
| 发光核心线 | 额外绘制 pass (additive blend) | `MeshBuilder.CreateLines` + `Color4` 高亮 |

**Headless 限制**：无 WebGL 上下文中无法验证颜色精度，建议有头浏览器测试。

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 | acceptance-test-assistant |
| 2026-06-19 | Round 1 修复: B1(LinesMesh dispose), m1(GLS… header), m2(canvas CSS), m3(README 200行) | acceptance-test-assistant |
