# 光照色板旋转特效 - LightPaletteRotator 验收测试

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.ts`
**OpenRA 对照**: `OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.cs` (66 lines)

## 期望结果 (Expected Results)

1. **tick() 累加计时器**:
   - 每次调用 tick(), t 增加 timeStep
   - 可量化指标: 默认 timeStep = 0.5, 每 2 个 tick 后 currentRotationIndex 切换一次
   - 可量化指标: 第 0 tick: t = 0.0, rotationIndex = 0 (source = 230)
   - 可量化指标: 第 1 tick: t = 0.5, rotationIndex = 0 (不变, floor(0.5) = 0)
   - 可量化指标: 第 2 tick: t = 1.0, rotationIndex = 1 (source = 231)
   - 可量化指标: 第 36 tick: t = 18.0, rotationIndex = 0 (完整循环, 回到起点)

2. **rotationIndices 序列**:
   - 默认序列: `[230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 238, 237, 236, 235, 234, 233, 232, 231]`
   - 可量化指标: 序列长度 = 18
   - 可量化指标: 索引顺序: 先递增 (230→239, 10 个), 后递减 (239→231, 8 个)
   - 可量化指标: 完整循环 = 18 次索引切换 = 18 × (1/timeStep) = 36 ticks
   - 可量化指标: @25fps, 完整循环耗时 = 36/25 = 1.44 秒

3. **adjustPalette 修改 index 103**:
   - 将 `rotationIndices[currentRotationIndex]` 的颜色复制到 `modifyIndex` (默认 103)
   - 可量化指标: 第 5 个方块 (palette index 103) 的颜色应周期性变化
   - 可量化指标: 第 0 tick: index 103 = 颜色 230 (深蓝, RGB ≈ 30, 100, 200)
   - 可量化指标: 第 18 tick: index 103 = 颜色 239 (白色偏蓝, RGB ≈ 230, 255, 150)
   - 可量化指标: 第 36 tick: index 103 = 颜色 230 (回到起点)

4. **参考方块不变**:
   - palette index 0, 1, 2, 3 的方块颜色始终不变
   - 可量化指标: 方块 0 (index:0) 始终为红色 #FF3333
   - 可量化指标: 方块 1 (index:1) 始终为绿色 #33FF33
   - 可量化指标: 方块 2 (index:2) 始终为蓝色 #3333FF
   - 可量化指标: 方块 3 (index:3) 始终为黄色 #FFCC00

5. **排除色板 (excludePalettes)**:
   - 如果色板名在 excludePalettes 中, adjustPalette 跳过处理
   - 可量化指标: 测试中无排除色板, 所有修改正常进行

6. **速度调整**:
   - timeStep 越大, 颜色切换越快
   - 可量化指标: timeStep = 1.0: 每 tick 切换一次, 完整循环 = 18 ticks
   - 可量化指标: timeStep = 2.0: 每 tick 切换 2 次, 完整循环 = 9 ticks
   - 可量化指标: timeStep = 0.1: 10 个 tick 切换一次

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch19-cnc/palette-rotator/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示 5 个彩色方块, 前 4 个为参考色 (红/绿/蓝/黄), 第 5 个 (白色边框高亮) 为受修改的 index 103

### 2. 步骤一: 默认速度旋转 (timeStep = 0.5)

- 操作: 确认 "开始旋转" 按钮高亮, 观察约 5 秒
- 观察点:
  - 左侧 4 个参考方块颜色完全不变
  - 第 5 个方块 (白色边框) 颜色周期性变化
  - 颜色从深蓝 → 浅蓝 → 白色 → 浅蓝 → 深蓝 循环
  - 状态栏 rotationIndex 从 0 慢慢增加到 17, 然后回到 0
  - t 累加器持续增加
- 预期: ✅ 约 1.44 秒完成一个完整颜色循环, 循环平滑

### 3. 步骤二: 色板可视化验证

- 操作: 观察底部状态栏中的 "rotationIndices" 序列显示
- 观察点:
  - `*` 星号标记当前 sourceIndex 位置
  - 星号在序列中来回移动: 230→231→...→239→238→...→231→230...
  - 微型色板 (228-241 色块) 显示对应颜色
  - index 103 处的色块颜色与 sourceIndex 处的色块一致
- 预期: ✅ 色板可视化与状态栏数据一致

### 4. 步骤三: 不同速度

- 操作: 调整速度滑块到 1.0, 点击 "重置" 然后 "开始旋转"
- 观察点:
  - 颜色切换频率加倍 (每 tick 切换一次)
  - 完整循环约 18 tick = 0.72 秒
- 操作: 调整到 2.0
- 观察点:
  - 颜色切换非常快 (每 tick 切换 2 次)
  - 完整循环约 9 tick = 0.36 秒
- 操作: 调整到 0.1
- 观察点:
  - 颜色切换非常慢 (10 tick 才切换一次)
  - 完整循环约 180 tick = 7.2 秒
- 预期: ✅ timeStep 正确影响旋转速度

### 5. 步骤四: 暂停/恢复

- 操作: 旋转运行中点击 "暂停"
- 观察点:
  - t 停止累加
  - rotationIndex 保持不变
  - index 103 颜色停止变化
- 操作: 点击 "开始旋转"
- 观察点:
  - 从暂停处继续
  - t 继续累加
- 预期: ✅ 暂停/恢复功能正常

### 6. 步骤五: 重置

- 操作: 点击 "重置"
- 观察点:
  - t 归零, rotationIndex 归 0
  - index 103 颜色恢复初始值
  - 色板恢复初始状态
- 预期: ✅ 重置后所有状态恢复初始值

### 7. 边界/异常测试

- **边界 A - 极慢速度**: timeStep = 0.1
  - 预期: ✅ 颜色切换间隔 10 tick (0.4s), 可以清晰观察到每次切换

- **边界 B - 极快速度**: timeStep = 3.0
  - 预期: ✅ 颜色切换每 3 tick 一次, 完整循环约 6 tick (0.24s), 肉眼看到快速闪烁

- **边界 C - 修改非标准 modifyIndex**: 输入 modifyIndex = 200
  - 预期: ✅ 颜色复制到 index 200 位置 (不影响显示的方块)

### 8. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据), 提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息, 检查 WebGL 支持
