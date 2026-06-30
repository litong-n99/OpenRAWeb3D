# Instant Hit (Hitscan) — 零飞行时间即时命中

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 22/22 通过, 100%)

**ID**: `ch08-weapons-combat/instant-hit-hitscan`
**URL**: `http://localhost:5173/test/ch08-weapons-combat/instant-hit-hitscan/`
**测试点**: 验证 InstantHit 抛射体零飞行时间、LOS 阻挡检测、单 tick 自销毁、无视觉 mesh

---

## 期望结果

### H1. 零飞行时间（tick 0 即时生效）

| # | 期望 | 可量化标准 |
|---|------|-----------|
| H1.1 | `weapon.impact()` 在 fire 同一 tick 被调用 | `getTickCount()` = 1（fire 后仅需 1 个 tick 即完成），`getImpactCount()` = 1 |
| H1.2 | 不存在逐 tick 飞行过程 | fire 调用后，`hasDisposed()` 立即返回 true（单 tick 完成） |
| H1.3 | Tick 计数精确为 1（非 2、非 0） | fire 后 `tick()` 仅被调用 1 次，同 tick 检查 IsDestroyed=false 并通过 → impact → destroy |

### H2. 单 tick 自销毁

| # | 期望 | 可量化标准 |
|---|------|-----------|
| H2.1 | `isDestroyed` 在同一次 `tick()` 调用后变为 true | `hasDisposed()` 在 fire 后立即返回 true |
| H2.2 | `world.addFrameEndTask` 注册了 `removeEffect` 回调 | 刷新 frameEndTasks 后 world.effects 不包含此 projectile |
| H2.3 | 再次调用 `tick()` 无效 | `isDestroyed` 为 true 时 `tick()` 直接 return（不影响 impactCount） |

### H3. 无视觉 projectile mesh

| # | 期望 | 可量化标准 |
|---|------|-----------|
| H3.1 | `render()` 返回空数组 | `render().length` = 0，不创建任何 IRenderable |
| H3.2 | 3D 场景中不存在 projectile 专属 mesh | 仅有 source/target/blocker 标记和 shot line，无 projectile 球体/圆柱体 |

### H4. LOS 阻挡检测（blockable=true 时有阻挡）

| # | 期望 | 可量化标准 |
|---|------|-----------|
| H4.1 | 阻挡 actor 在 source→target 连线上时 shot 被重定向 | 默认配置（blocker at WPos(4100,0,0)，width=1）：blocker 距离 line < width/2=0.5su → `isBlocked()` = true |
| H4.2 | Impact position 被 redirect 到 blocking actor 的 position | `getImpactPosition()` 返回 blocker 的 WPos 坐标（而非 target 的 WPos） |
| H4.3 | `isTargetHit()` 返回 false（目标未受击） | 有阻挡时 isTargetHit=false |
| H4.4 | Shot line 颜色变为红色（#FF4D4D），从 source 到 blocker | 视觉上红线，非绿线 |
| H4.5 | weapon.impact() 仍被精确调用 1 次（即使被阻挡） | `getImpactCount()` = 1 |

### H5. 无阻挡时直接命中（blockable=true 但无阻挡 actor）

| # | 期望 | 可量化标准 |
|---|------|-----------|
| H5.1 | Impact position 为目标位置 | 清除所有 blocker 后 fire，`getImpactPosition()` = target pos（默认 (8192,0,0)，偏差 ≤2 su） |
| H5.2 | `isTargetHit()` 返回 true | 无阻挡时 isTargetHit=true |
| H5.3 | `isBlocked()` 返回 false | wasBlocked=false |
| H5.4 | Shot line 颜色为绿色（#4DE066），从 source 到 target | 视觉上绿线 |

### H6. 边界行为

| # | 期望 | 可量化标准 |
|---|------|-----------|
| H6.1 | blockable=false 时阻挡 actor 不影响 shot | 有 blocker 但 blockable=OFF → shot 直接命中 target，isTargetHit=true |
| H6.2 | 无阻挡 actor 时 blockable=true 不影响 shot | 清除所有 blocker → shot 直接命中，isBlocked=false |
| H6.3 | Blocker 精确在 source 位置（距离=0）也会阻挡 | blocker at source → shot 被阻挡，impact 回到 blocker/source 位置 |
| H6.4 | Inaccuracy>0 时 impact 位置偏移，但仍在 maxInaccuracyOffset 范围内 | inaccuracy=1024 su 时偏移 ≤1024 su/1024 = 1 wu from target |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch08-weapons-combat/instant-hit-hitscan/`
2. 确认环境信息栏显示 "WebGL 2.0" 或 "Babylon.js" 引擎
3. 设置屏幕分辨率为 1920×1080（1x 缩放）
4. 确认默认配置：Source=(0,0,0), Target=(8192,0,0), Blocker at (4100,0,0), Blockable=ON

### 步骤一：零飞行时间验证（H1）

1. 点击 **FIRE HITSCAN** 按钮
2. 观察右侧 `Travel Time` 显示 `0 ticks (instant)`
3. 观察 `Tick` 显示 `1`（仅 1 个 tick 即完成）
4. 观察 `Impact Count` 显示 `1`（非 0，非 2+）
5. 控制台验证：
   ```js
   __testHarness.resetScene()
   __testHarness.fireHitscan()
   // 验证零飞行时间
   __testHarness.getTickCount() === 1        // true
   __testHarness.hasDisposed() === true      // true
   __testHarness.getImpactCount() === 1      // true
   ```
6. 预期：✅ 1 tick 完成，impact count = 1，已销毁（H1.1-H1.3, H2.1）

### 步骤二：阻挡检测验证（H4）

1. 默认配置下（1 个 blocker at (4100,0,0)），点击 **FIRE HITSCAN**
2. 观察 `Shot Result` 显示 `BLOCKED`（橙色高亮）
3. 观察 `Blocked By` 显示 `(4100, 0)`（blocker 坐标，非 target 坐标）
4. 观察 `Impact Position` 显示的坐标接近 (4100, 0, 0) 而非 (8192, 0, 0)
5. 观察 3D 场景中的 shot line 为**红色**（从绿色 source 球到灰色 blocker 立方体）
6. 观察被击中的 blocker 立方体变为**红色**（高亮）
7. 控制台验证：
   ```js
   __testHarness.isBlocked()         // true
   __testHarness.isTargetHit()       // false
   __testHarness.getBlockingPosition()  // {X: 4100, Y: 0, Z: 0}
   ```
8. 预期：✅ shot 被阻挡，redirect 到 blocker（H4.1-H4.5）

### 步骤三：直接命中验证（H5）

1. 点击 **Clear All Blockers** 按钮
2. 确认 `Blockers Count` 显示 `0`
3. 点击 **FIRE HITSCAN**
4. 观察 `Shot Result` 显示 `DIRECT HIT`（绿色或白色）
5. 观察 `Blocked By` 显示 `none`
6. 观察 `Impact Position` 显示 (8192, 0, 0)（target 坐标）
7. 观察 shot line 为**绿色**
8. 控制台验证：
   ```js
   __testHarness.isBlocked()         // false
   __testHarness.isTargetHit()       // true
   __testHarness.getImpactPosition() // {X: 8192, Y: 0, Z: 0}
   ```
9. 预期：✅ 直接命中 target（H5.1-H5.4）

### 步骤四：无视觉 mesh 验证（H3）

1. 观察 3D 场景：不存在额外的 projectile 球体/圆柱体/导弹模型
2. 场景中仅有：绿色 source 球、红色 target 球、灰色 blocker 立方体、shot line、ground plane
3. 控制台验证：代码中 `render()` 返回空数组（通过源码审查）
4. 预期：✅ 无 projectile 专属 mesh（H3.1-H3.2）

### 步骤五：blockable 开关测试（H6.1）

1. 重新添加 1 个 blocker（blocker 列表非空）
2. 点击 **Blockable: ON** 按钮切换为 **Blockable: OFF**
3. 确认按钮显示 `Blockable: OFF`
4. 点击 **FIRE HITSCAN**
5. 观察 `Shot Result` 显示 `DIRECT HIT`（blockable OFF 时阻挡被跳过）
6. 控制台验证：`__testHarness.isBlocked() === false`
7. 预期：✅ blockable=false 时阻挡无效（H6.1）

### 步骤六：Inaccuracy 验证（H6.4）

1. 清除 blocker，blockable=OFF
2. 设置 inaccuracy slider 到 1024 su
3. FIRE HITSCAN
4. 观察 impact position 与 target (8192,0,0) 的偏差
5. 偏差应在 ±1024/1024 = ±1 wu 范围内（约 ±1024 su）
6. 预期：✅ impact 偏移在 inaccuracy 范围内（H6.4）

### 结果判定

- [ ] 所有 H1-H6 量化指标通过 → **ACCEPTED**
- [ ] 部分失败 → 记录具体差异（期望 vs 实测），提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息
