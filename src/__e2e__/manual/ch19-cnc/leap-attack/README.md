# 跳跃攻击抛物线 — Leap + LeapAttack 验收测试

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Activities/Leap.ts` (319 lines), `src/OpenRA.Mods.Cnc/Activities/LeapAttack.ts` (448 lines)
**OpenRA 对照**: `OpenRA.Mods.Cnc/Activities/Leap.cs` (126 lines), `OpenRA.Mods.Cnc/Activities/LeapAttack.cs` (176 lines)

## 期望结果 (Expected Results)

1. **XY 平面线性插值 (WPos.lerp)**:
   - 跳跃者在起点和目标之间的 XY 坐标使用线性插值
   - 可量化指标: 在 t=0 时位置为原点 (0,0), 在 t=1 时位置为目标位置 (0, -10*cells WDist)
   - 可量化指标: 中距跳跃 (10 cells = 10240 WDist) 在 speed=300 时: totalLength = floor(10240/300) = 34 ticks

2. **Z 轴正弦抛物线 (Sin-based Height Curve)**:
   - 高度 = sin(t * PI) * maxHeight, 其中 t = ticks / (totalLength - 1)
   - 可量化指标: t=0 时高度 = 0
   - 可量化指标: t=0.5 时高度达到峰值 = maxHeight (默认 256 WDist ≈ 0.25 世界单位)
   - 可量化指标: t=1 时高度回到 0
   - 可量化指标: 高度曲线完全对称 (前半段与后半段镜像)

3. **速度控制 (Speed)**:
   - totalLength = max(floor(distance / speed), 1)
   - 可量化指标: speed=100 时同一距离需要更多 ticks (10 cells → 10240/100 = 102 ticks)
   - 可量化指标: speed=800 时同一距离需要较少 ticks (10 cells → 10240/800 = 12 ticks)
   - 可量化指标: 最少 1 tick (当 distance < speed 时)

4. **攻击触发 (Attack Trigger)**:
   - 跳跃到达终点 (ticks >= totalLength) 时目标变红闪烁
   - 可量化指标: 目标 emissive 颜色变为 (1, 0.2, 0), 持续 200ms 后恢复
   - 可量化指标: 跳跃完成标志 jumpComplete = true

5. **轨迹可视化 (Trajectory Visualization)**:
   - 粉红色 (#FF66CC) 线条显示 64 个采样点的完整抛物线轨迹
   - 可量化指标: 弧线从原点开始, 在中点达到最高, 在目标结束
   - 可量化指标: 弧线是平滑的正弦曲线 (无折角)

6. **不同目标距离**:
   - 近距 (5 cells ≈ 5120 WDist): 弧线短, tick 数少
   - 中距 (10 cells ≈ 10240 WDist): 弧线中等
   - 远距 (18 cells ≈ 18432 WDist): 弧线长, tick 数多
   - 可量化指标: speed=300 时: 近=17 ticks, 中=34 ticks, 远=61 ticks

---

## 检验流程

### 1. 准备工作
- 打开测试页面: `http://localhost:5173/test/ch19-cnc/leap-attack/`
- 确认页面显示红色跳跃者、黄色目标和粉红抛物线轨迹

### 2. 步骤一: 默认参数跳跃
- 点击 "执行跳跃"
- 观察跳跃者沿粉红轨迹从原点跳向目标
- 观察高度先增加后减少 (对称抛物线)
- 观察到达后目标变红闪烁
- 预期: ✅ 抛物线在 t=0.5 处达到最高点 (256 WDist)

### 3. 步骤二: 速度变化
- 调整速度为 100, 点击跳跃
- 观察跳跃变慢 (102 ticks = ~4.1 秒)
- 调整速度为 800, 点击跳跃
- 观察跳跃变快 (12 ticks = ~0.48 秒)
- 预期: ✅ speed 与 duration 成反比

### 4. 步骤三: 高度变化
- 调整最大高度为 800 WDist, 点击跳跃
- 观察弧线明显更高
- 调整最大高度为 100 WDist, 点击跳跃
- 观察几乎是平飞
- 预期: ✅ maxHeight 参数正确影响峰值高度

### 5. 步骤四: 目标距离
- 分别选择近距、中距、远距
- 观察弧线长度变化
- 预期: ✅ 弧线长度与距离成正比

### 6. 步骤五: 自动连续跳跃
- 点击 "自动连续跳跃"
- 观察每隔约 30 ticks 自动跳跃一次
- 预期: ✅ 自动跳跃正常循环

### 7. 边界测试
- **极端速度**: speed=800 远距 (18 cells)
  - 预期: ✅ 总 tick 数 = floor(18432/800) = 23
- **极端高度**: height=800 且 speed=100
  - 预期: ✅ 轨迹曲线极高且平缓

### 8. 结果判定
- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异
