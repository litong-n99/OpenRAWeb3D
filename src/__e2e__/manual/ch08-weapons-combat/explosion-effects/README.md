# Explosion Effects — Acceptance Test

**Module**: CreateEffectWarhead + SpriteEffect (Chapter 8 Phase A/C)
**Test Case ID**: `ch08-weapons-combat/explosion-effects`
**OpenRA Source**: `OpenRA.Mods.Common/Warheads/CreateEffectWarhead.cs`, `OpenRA.Mods.Common/Effects/SpriteEffect.cs`
**TypeScript Target**: `src/OpenRA.Mods.Common/Warheads/CreateEffectWarhead.ts`, `src/OpenRA.Mods.Common/Effects/SpriteEffect.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 24/24 通过, 100%)

---

## 期望结果 (Expected Results)

### E1. Billboard 爆炸精灵 — 生命周期

**上下文**: 爆炸 billboard 是一个相机朝向的 Disc 网格，经历 EXPAND（膨胀）→ FADE（淡出）两个阶段。使用 `StandardMaterial` + `disableLighting=true` + 高 `emissiveColor` 模拟 OpenRA 的 additive blend 效果。颜色从亮白/橙黄渐变到暗橙。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E1.1 | Large 爆炸 billboard 在 24±2 ticks 内从直径 0.05 wu 膨胀到峰值 3.0 wu（EXPAND 阶段） | 阶段诊断显示 "expand"，progress 从 0% → ~37%（expand 占总周期的 66.7%），billboard 直径单调递增至 3.0 wu |
| E1.2 | Large 爆炸 billboard 在 12±2 ticks 内 alpha 从 1.0 线性衰减到 0（FADE 阶段），期间保持峰值尺寸 | 阶段诊断显示 "fade"，progress 从 ~37% → 100%，billboard `material.alpha` 从 1.0 → 0 |
| E1.3 | Small 爆炸 billboard 在 16±2 ticks 内膨胀到峰值 1.2 wu，随后 8±2 ticks 内淡出 | 总周期 24 ticks，expand 占 66.7%，fade 占 33.3%，峰值直径为 1.2 wu |
| E1.4 | Billboard 始终面向相机（`billboardMode = BILLBOARDMODE_ALL`），任意旋转视角后 billboard 法线与相机方向夹角 < 5° | `Vector3.Dot(forward, toCamera) > 0.95`，诊断栏显示 "Billboard → Cam: YES (>0.95)" |
| E1.5 | Billboard 材料 `disableLighting = true`，场景光照不影响爆炸颜色，视觉上呈自发光效果 | 旋转视角时爆炸 disc 亮度不变，无阴影面 |

### E2. 碎片粒子 — 物理模拟

**上下文**: 碎片是小型球体，从爆炸中心以随机速度向外抛出。每 tick 进行速度积分（欧拉方法）：`velocity.y -= GRAVITY_PER_TICK`，`position += velocity`。碰到地面时反弹（restitution=0.35, friction=0.5），alpha 随生命周期线性衰减。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E2.1 | Large 爆炸生成 18 个碎片粒子 | `getParticleCount()` 在触发后第 0 tick 返回 18 |
| E2.2 | Small 爆炸生成 8 个碎片粒子 | `getParticleCount()` 在触发后第 0 tick 返回 8 |
| E2.3 | 碎片受重力影响下落，初始速度以半球面分布向外+向上 | 碎片 Y 坐标先增加后减少，约 50% 碎片在 15 ticks 内触地 |
| E2.4 | 碎片触地后反弹，反弹高度逐渐减小（restitution=0.35），水平速度逐次衰减（friction=0.5） | 同一碎片的第二次反弹高度 ≤ 第一次反弹高度的 35%，水平位移增量递减 |
| E2.5 | 碎片 alpha 从 baseline (~0.7-1.0) 线性衰减到 0，同时 scale 从 1.0 缩小到 0.3 | 生命周期 35-60 ticks，末期碎片几乎不可见且缩小至 30% |
| E2.6 | 碎片生命周期结束后自动 dispose，粒子总数归零 | 所有碎片在 ~60 ticks 内全部清除，`getParticleCount() === 0` |

### E3. 地面烧痕

**上下文**: 地面爆炸在撞击点周围随机散布深色半透明 Disc 网格（scorch marks），平贴在地面上。水面爆炸不生成烧痕。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E3.1 | 地面爆炸生成 4 个烧痕（`scorchCount = 4`） | `getScorchCells()` 返回 4 |
| E3.2 | 烧痕为深色（RGB ≈ 0.05, 0.04, 0.03），alpha=0.4，平贴在地面上（rotation.x = π/2） | 从俯视角度可见 4 个深暗色不规则圆斑，散布在爆炸点 0.2-1.5 wu 范围内 |
| E3.3 | 烧痕无 billboard 模式，固定在原地不随相机旋转 | 旋转视角时烧痕形状因透视变形但不跟随相机朝向 |

### E4. 水面爆炸变体

**上下文**: 水面爆炸不生成烧痕，而是生成 3 个蓝色波纹环（Torus 网格）。波纹环从中心向外扩展，同时 alpha 从 0.7 渐隐到 0。爆炸位置在水面区域（Z ≈ -5，蓝色半透明平面）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E4.1 | 水面爆炸生成 3 个波纹环，无烧痕 | `getScorchCells() === 0`，诊断栏 Ripple Rings = 3，`isWaterVariant() === true` |
| E4.2 | 波纹环为蓝色（RGB ≈ 0.2, 0.55, 0.95），初始直径 0.2 wu，扩展至最大 1.8-3.4 wu | 俯视可见 3 个同心的蓝色 Torus，从内到外依次出现（stagger 各 4 ticks） |
| E4.3 | 波纹环 alpha 随扩展从 0.7 线性衰减到 0 | 环从清晰蓝色到完全透明，最大环最后淡出 |
| E4.4 | 水面爆炸仍有 billboard 和 debris（与地面爆炸相同），只是 scorch 替换为 ripples | billboard + debris 行为与 E1/E2 一致 |

### E5. 尺寸预设对比

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E5.1 | Large 预设：peakSize=3.0 wu, expandDuration=24t, fadeDuration=12t, debrisCount=18, scorchCount=4 | `getActivePreset() === 'large'`，诊断栏显示相应数值 |
| E5.2 | Small 预设：peakSize=1.2 wu, expandDuration=16t, fadeDuration=8t, debrisCount=8, scorchCount=4 | `getActivePreset() === 'small'`，Small 峰值直径约为 Large 的 40% |
| E5.3 | 从上方俯视，Large 爆炸 billboard 覆盖面积约为 Small 的 6.25 倍 | Large 峰值面积 π×(1.5)² ≈ 7.07 wu²，Small 峰值面积 π×(0.6)² ≈ 1.13 wu² |

### E6. 通用行为

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E6.1 | Reset 后所有爆炸、碎片、烧痕、波纹环被清除 | 场景中无可视残留，诊断栏所有数值归零 |
| E6.2 | 多次连续触发爆炸（5 次 Large）不产生内存泄漏，FPS 保持 ≥ 30 | 环境信息栏 FPS 读数 ≥ 30，浏览器内存无持续增长 |
| E6.3 | 同时存在的多个爆炸独立运行，互不干扰 | 触发 3 次爆炸后 Active 显示 3，各自 phase/progress 独立变化 |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/explosion-effects/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 确认 3D 场景已加载（可见灰绿色地面带网格线，北侧蓝色水域）
5. 视角操作：鼠标左键拖拽旋转，滚轮缩放，右键平移
6. 确认右侧诊断面板显示初始状态（Active=0, Phase=none）

### 步骤一：Large 地面爆炸 — 基础生命周期

1. 确保 Preset 选择 "Large (3.0 wu)"
2. 确保 Target X=0, Z=0（点击 "Center" 按钮）
3. 点击 **"Ground Explosion"** 按钮
4. 观察 3D 场景中央：
   - 橙色 disc 从微小点快速膨胀到大型光圈
   - 棕色小球体从中心向外飞散
   - 地面上出现深色圆形斑块
5. 旋转视角（鼠标左键拖拽），确认 billboard 始终面向相机
6. 观察右侧诊断面板数值变化
7. **预期**:
   - [ ] Billboard 在约 1.2 秒内（24 ticks / ~20 TPS, SIM_TICK_INTERVAL=3 at 60fps）膨胀到峰值尺寸（E1.1）✅
   - [ ] 膨胀完成后 alpha 开始衰减，约 0.6 秒后完全消失（E1.2）✅
   - [ ] Debris 计数初始为 18（E2.1）✅
   - [ ] 碎片从中心向外+向上飞散，随后下落触地反弹（E2.3, E2.4）✅
   - [ ] 地面上可见 4 个深色烧痕（E3.1）✅
   - [ ] Billboard → Cam 始终显示 "YES (>0.95)"（E1.4）✅

### 步骤二：Small 预设对比

1. 选择 Preset "Small (1.2 wu)"
2. 设置 Target X=2, Z=0
3. 点击 **"Ground Explosion"** 按钮
4. 对比 Small 与 Large（上一次/或重新触发 Large）：
   - Billboard 峰值直径明显更小
   - 碎片数量更少（8 vs 18）
   - 膨胀/淡出时间更短
5. **预期**:
   - [ ] Small billboard 峰值直径约为 Large 的 40%（E5.2）✅
   - [ ] Debris 计数初始为 8（E2.2）✅
   - [ ] 总周期约 24 ticks（16+8），比 Large 的 36 ticks 快约 33%（E1.3）✅

### 步骤三：水面爆炸变体

1. 选择 Preset "Large (3.0 wu)"
2. 点击 **"Water Zone"** 按钮（设置 Z=-5 指向水域）
3. 点击 **"Water Explosion"** 按钮
4. 从上方俯视（调整相机到近乎垂直）
5. 观察水面区域：
   - 橙色 billboard 在水面上方展开
   - 碎片从水面位置飞散
   - 3 个蓝色同心 Torus 环从中心向外扩展
   - 水面上没有深色烧痕
6. **预期**:
   - [ ] Water Variant 诊断显示 "YES"（E4.1）✅
   - [ ] Ripple Rings 初始为 3，Scorch Marks 为 0（E4.1）✅
   - [ ] 3 个蓝色波纹环依次出现（stagger 间隔约 4 ticks），从内到外扩展（E4.2）✅
   - [ ] 波纹环 alpha 逐渐降低，最终完全透明消失（E4.3）✅
   - [ ] Billboard + debris 行为与地面爆炸一致（E4.4）✅

### 步骤四：Billboard 相机朝向验证

1. 触发一次 Large 地面爆炸
2. 在 explosion 膨胀阶段，快速旋转相机（鼠标左键拖拽 360 度）
3. 观察 billboard disc 是否始终正面朝向观察者
4. 从极端角度观察（侧面近乎平行于 disc 平面）
5. **预期**:
   - [ ] 无论相机角度如何，disc 始终呈现为完整圆形（非椭圆）（E1.4）✅
   - [ ] 诊断栏 "Billboard → Cam" 持续显示 "YES (>0.95)"（E1.4）✅
   - [ ] Disc 亮度不随相机角度变化（`disableLighting=true` 效果）（E1.5）✅

### 步骤五：Reset 与可重复性

1. 点击 **"Reset Scene"** 按钮
2. 验证所有 billboard、碎片、烧痕、波纹环被清除
3. 连续点击 "Ground Explosion" 5 次（每次等前一个完成后）
4. **预期**:
   - [ ] Reset 后场景干净，无可视残留（E6.1）✅
   - [ ] 诊断栏所有数值归零（E6.1）✅
   - [ ] 5 次爆炸行为一致：debris 数量 = 18，scorch = 4，phase 转换正常（E6.2）✅
   - [ ] FPS 在整个测试期间保持 ≥ 30（E6.2）✅

### 步骤六：多爆炸并发

1. 快速连续点击 "Ground Explosion" 3 次（间隔 < 0.5 秒）
2. 观察多个爆炸同时运行
3. **预期**:
   - [ ] 诊断栏 Active 显示 3（E6.3）✅
   - [ ] 各爆炸独立膨胀/淡出，互不干扰（E6.3）✅
   - [ ] 所有爆炸结束后 debris/scorch 正确归零（E6.3）✅

### 边界/异常测试

1. **极端位置**: 设置 X=10, Z=10，触发 Ground Explosion
   - [ ] 爆炸在预期位置（远处）正常显示 ✅
2. **窗口缩放**: 将浏览器窗口从 1920x1080 缩小到 1280x720
   - [ ] 3D 场景正确适应新尺寸，billboard 仍然面向相机 ✅
3. **快速切换预设**: Large → Small → Large（每次触发新的）
   - [ ] 前一次爆炸的 billboard/debris 正确清理，新爆炸使用正确的预设参数 ✅
4. **水面非水域位置**: 设置 X=3, Z=3（不在水域），点击 Water Explosion
   - [ ] 水面爆炸仍在点击位置生成（注意：按钮强制 Z=-5 作为水面中心），这是预期行为 ✅

### 结果判定

- [ ] 所有期望结果 (E1-E6) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异（phase 切换时间、debris 数量、alpha 衰减速率），提交 issue
- [ ] 测试环境异常（WebGL 不可用 / 渲染错误）→ 记录 UA / 视口 / 引擎信息

---

## Test Harness API Reference

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `triggerExplosion(pos?, size?, water?)` | `pos: {x,y,z}`, `size: 'large'\|'small'`, `water: boolean` | `void` | Trigger an explosion at given position |
| `triggerWaterExplosion(pos?)` | `pos: {x,y,z}` | `void` | Shortcut for water-variant explosion |
| `getParticleCount()` | none | `number` | Total active debris particles |
| `getScorchCells()` | none | `number` | Total scorch marks on ground |
| `getExplosionProgress()` | none | `number` (0-1) | Progress of most recent explosion |
| `getExplosionPhase()` | none | `string` | Phase: 'expand', 'fade', 'done', 'none' |
| `isBillboardFacingCamera()` | none | `boolean` | Dot product > 0.95 check |
| `isWaterVariant()` | none | `boolean` | Whether most recent is water variant |
| `getActivePreset()` | none | `string` | Preset name: 'large', 'small', 'none' |
| `getActiveExplosionCount()` | none | `number` | Number of concurrently active explosions |
| `reset()` | none | `void` | Clear all explosions and effects |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 — 爆炸特效可视化（billboard + debris + scorch + water ripples） | acceptance-test-assistant |
