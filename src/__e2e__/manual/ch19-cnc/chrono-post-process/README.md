# 超时空后处理特效 - ChronoshiftPostProcessEffect 验收测试

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.ts`
**OpenRA 对照**: `OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.cs` (56 lines)

## 期望结果 (Expected Results)

1. **Enable() 激活效果**:
   - 调用 Enable() 后 `remainingFrames` 立即设置为 `chronoEffectLength`
   - 可量化指标: 默认 `chronoEffectLength = 60 ticks (2.4s @ 25fps)`
   - 可量化指标: `blendFactor` 从 0.0 变为 1.0

2. **线性衰减 (tick 递减)**:
   - 每调用一次 tick(), remainingFrames 减少 1
   - blendFactor = remainingFrames / chronoEffectLength
   - 可量化指标: 第 0 tick 后 blendFactor = 1.000 (60/60)
   - 可量化指标: 第 30 tick 后 blendFactor = 0.500 (30/60)
   - 可量化指标: 第 59 tick 后 blendFactor = 0.017 (1/60)
   - 可量化指标: 第 60 tick 后 blendFactor = 0.000, enabled = false

3. **全屏色偏视觉表现**:
   - 色偏强度从最大值线性衰减到 0
   - 默认模式为蓝色偏移 (Tiberian Sun 超时空特效), R/G/B 通道偏移量 = blendFactor * 0.4
   - 可量化指标: blendFactor = 1.0 时场景整体偏蓝 (色相偏移约 +0.15 蓝色通道)
   - 可量化指标: blendFactor = 0.0 时场景恢复原始色彩

4. **重复激活重置**:
   - 效果激活期间再次调用 Enable() 重置 remainingFrames
   - 可量化指标: 在第 30 tick (剩余 30) 时再次 Enable(), remainingFrames 重置为 60
   - 可量化指标: blendFactor 跳回 1.000

5. **不同持续时长**:
   - chronoEffectLength = 120: 持续时间 4.8s, 线性衰减斜率减半
   - chronoEffectLength = 15: 持续时间 0.6s, 衰减更快

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch19-cnc/chrono-post-process/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示 5 个彩色方块 (红、绿、蓝、黄、橙) 和一个圆环

### 2. 步骤一: 默认激活 (60 ticks)

- 操作: 点击 "激活超时空特效 (Enable)" 按钮
- 观察点:
  - 场景整体变为蓝色调 (blendFactor = 1.0)
  - 状态栏 "状态" 显示 "激活中"
  - blendFactor 从 1.000 开始逐 tick 递减
  - 进度条从 0% 逐渐增加到 100% (显示已完成的 tick 比例)
  - 色偏强度从最强 (blendFactor=1.000) 线性衰减到无 (blendFactor=0.000)
- 预期: ✅ 色偏逐渐减弱, 60 ticks (约 2.4 秒) 后完全消失, "状态" 变为 "未激活"

### 3. 步骤二: 中途重新激活

- 操作: 点击 "激活超时空特效", 等待约 1 秒 (约 25 ticks), 再次点击 "激活"
- 观察点:
  - remainingFrames 跳回 60
  - blendFactor 跳回 1.000
  - 进度条从约 42% 重置为 0% (从头开始)
- 预期: ✅ 效果被重置, 从头开始衰减

### 4. 步骤三: 不同持续时间

- 操作: 下拉选择 "30 ticks", 点击 "激活"
- 观察点:
  - 持续时间明显缩短 (约 1.2 秒)
  - 衰减速度是默认的 2 倍
- 操作: 选择 "120 ticks", 点击 "激活"
- 观察点:
  - 持续时间明显更长 (约 4.8 秒)
  - 衰减速度是默认的一半
- 预期: ✅ 不同时长设置正确影响衰减斜率

### 5. 步骤四: 色偏模式切换

- 操作: 切换到 "Red-shift", 点击 "激活"
- 观察点: 场景偏红色
- 操作: 切换到 "Green-shift", 点击 "激活"
- 观察点: 场景偏绿色
- 预期: ✅ 三种色偏模式产生明显不同的全屏颜色效果

### 6. 边界/异常测试

- **边界 A - 重置**: 激活效果后点击 "重置"
  - 预期: ✅ 效果立即停止, blendFactor 归 0, remainingFrames 归 0

- **边界 B - 快速连续激活**: 连续快速点击 "激活" 3 次
  - 预期: ✅ blendFactor 保持 1.0, 持续时间从最后一次点击开始计算

- **边界 C - 0 tick 持续时间**: 切换 duration 为最小的 15 ticks 观察
  - 预期: ✅ 色偏快速消失 (约 0.6 秒)

### 7. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据), 提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息, 检查 WebGL 支持
