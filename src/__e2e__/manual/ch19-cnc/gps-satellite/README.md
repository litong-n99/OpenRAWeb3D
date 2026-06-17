# GPS卫星升空效果 - GpsSatellite 验收测试

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Effects/GpsSatellite.ts`
**OpenRA 对照**: `OpenRA.Mods.Cnc/Effects/GpsSatellite.cs` (60 lines)

## 期望结果 (Expected Results)

1. **发射 (创建时)**:
   - 卫星在发射设施上方创建
   - 可量化指标: 初始 pos.Z = 0 WDist (发射点高度)
   - 可量化指标: `_tickCounter` 初始为 0
   - 可量化指标: `_reachedOrbit` 初始为 false

2. **升空阶段 (每 tick)**:
   - 每 tick 位置 `Z += 427` WDist
   - 可量化指标: 第 1 tick 后 Z = 427 WDist
   - 可量化指标: 第 10 tick 后 Z = 4270 WDist
   - 可量化指标: 第 60 tick 后 Z = 25620 WDist (60 × 427)
   - 可量化指标: 在 3D 场景中, 卫星的 Y 坐标 = 1.6 + Z / 1024 (世界空间)

3. **入轨 (tick > revealDelay)**:
   - 当 _tickCounter > revealDelay 时, reachedOrbit = true
   - 调用 GpsWatcher.reachedOrbit() 激活 GPS
   - 可量化指标: 默认 revealDelay = 60, 在第 61 个 tick 时入轨
   - 可量化指标: 入轨高度 Z = 61 × 427 = 26047 WDist (约 25.4 世界单位)
   - 可量化指标: 入轨后卫星变为绿色发光 (GPS_ACTIVATED_COLOR)

4. **入轨后 (reachedOrbit = true)**:
   - tick() 立即返回 (不再移动)
   - 可量化指标: 卫星位置不再变化
   - 可量化指标: reachedOrbit 保持 true
   - 可量化指标: 状态栏显示 "GPS 已激活!"

5. **生命周期结束后**:
   - 效果被世界移除 (frameEndTask → w.Remove + w.ScreenMap.Remove)
   - 可量化指标: reachedOrbit 保持 true (不继续处理)

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch19-cnc/gps-satellite/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示一座 GPS 上行站 (基地 + 碟形天线)
- 卫星初始隐藏 (scaling 极小)

### 2. 步骤一: 默认参数发射 (revealDelay = 60)

- 操作: 点击 "发射卫星 (Launch)" 按钮
- 观察点:
  - 卫星出现在发射设施上方 (Y ≈ 1.6 世界单位)
  - 卫星开始向上移动, 每 tick Z += 427 WDist
  - 蓝色轨迹线 (trail) 显示上升路径
  - tick 计数器递增
  - 当前位置 Z 从 0 开始持续增加
- 预期: ✅ 卫星持续上升, 轨迹竖直, 无横向偏移

### 3. 步骤二: 入轨时刻 (tick = 61)

- 操作: 继续观察 (或使用 5x 加速)
- 观察点 (tick > 60):
  - reachedOrbit 变为 true
  - 状态栏出现 "GPS 已激活!" 黄色提示
  - 卫星变为绿色发光
  - 卫星停止上升 (位置不再变化)
  - "当前位置 Z" 停留在约 26047 WDist
- 预期: ✅ 卫星在 revealDelay + 1 时刻入轨, GPS 激活

### 4. 步骤三: 不同 revealDelay

- 操作: 将 revealDelay 设置为 30, 点击 "重置", 然后 "发射卫星"
- 观察点:
  - 入轨更快 (约 31 tick, 1.24 秒 @ 25fps 1x)
  - 入轨高度约 Z = 31 × 427 = 13237 WDist
- 操作: 设置 revealDelay = 120, 再测试
- 观察点:
  - 入轨更慢 (约 121 tick, 4.84 秒 @ 1x)
  - 入轨高度约 Z = 121 × 427 = 51667 WDist
- 预期: ✅ revealDelay 正确控制入轨时间

### 5. 步骤四: 加速模拟

- 操作: 选择 "2x (50 ticks/s)" 速率, 点击 "发射"
- 观察点:
  - 卫星上升速度视觉上变为 2 倍
  - tick 计数以 50/s 速率增加
  - 入轨时间减半
- 操作: 尝试 "5x" 和 "10x"
- 预期: ✅ 不同速率下 tick 逻辑保持不变, 仅模拟时间压缩

### 6. 边界/异常测试

- **边界 A - 重置**: 卫星上升中点击 "重置"
  - 预期: ✅ 卫星归位隐藏, 所有状态重置, 轨迹清除

- **边界 B - 重新发射**: 卫星入轨后再次点击 "发射"
  - 预期: ✅ 新卫星从发射点重新开始, 旧状态被覆盖

- **边界 C - 极短 revealDelay**: revealDelay = 10
  - 预期: ✅ 卫星快速入轨 (11 tick), 高度较低

- **边界 D - 入轨后不再移动**: 观察入轨后 10+ 秒
  - 预期: ✅ 卫星位置完全不变, reachedOrbit 保持 true

### 7. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据), 提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息, 检查 WebGL 支持
