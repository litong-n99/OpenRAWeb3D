# MAD坦克自爆序列 - MadTank DetonationSequence 验收测试

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Traits/MadTank.ts`
**OpenRA 对照**: `OpenRA.Mods.Cnc/Traits/MadTank.cs` (255 lines)

## 期望结果 (Expected Results)

1. **Initiate (phase = INITIATE, tick 0)**:
   - 调用 onFirstRun() 后, tick() 首次进入时触发 _initiate()
   - _initiate() 执行: grantedCondition → ejectDriver → thumpSequence 循环动画
   - 可量化指标: `isInterruptible` 从 true 变为 false
   - 可量化指标: `initiated` 从 false 变为 true
   - 可量化指标: 引擎开始发光, 颜色从闲置 (0.1, 0.05, 0.0) 开始向充电色 (0.8, 0.3, 0.0) 渐变

2. **Charge Phase (tick 1-96)**:
   - 每 `thumpInterval` (默认 8) tick 触发一次 thump 伤害
   - 屏幕震动强度逐渐增大 (每次 thump +0.02, 上限 0.15)
   - 可量化指标: 默认 chargeDelay=96, 共触发 `floor(96/8) = 12` 次 thump
   - 可量化指标: 第 12 次 thump 时震动强度 = min(0.15, 0.02 * 12) = 0.15
   - 可量化指标: 引擎发光颜色从充电色逐渐过渡到引爆色 (1.0, 0.6, 0.0)
   - 可量化指标: Tank 周围出现膨胀的震荡波环形效果，每次 thump 后重新生成并向外扩展

3. **Charge Sound (tick 96)**:
   - 阶段切换为 CHARGING
   - 可量化指标: 引擎发光变为全强度 (1.0, 0.5, 0.0), emissive 为 (0.6, 0.3, 0.0)

4. **Detonation (tick 138 = 96 + 42)**:
   - 阶段: DETONATING → COMPLETE
   - 可量化指标: tick() 返回 true (序列完成)
   - 可量化指标: 爆炸粒子系统发射 500 particles/sec
   - 可量化指标: Tank 模型缩放到 (0.01, 0.01, 0.01) (消失)
   - 可量化指标: 闪光灯强度跳到 3.0
   - 可量化指标: 画面中央显示 "DETONATE!" 大字

5. **取消流程**:
   - 序列运行中点击 "取消 (Cancel)" 设置 isCancelling = true
   - 可量化指标: tick() 立即返回 true, 序列中止
   - 可量化指标: 阶段变为 CANCELLED

6. **总时长**:
   - 可量化指标: 默认 `chargeDelay + detonationDelay = 96 + 42 = 138 ticks`
   - 可量化指标: @25fps = 5.52 秒

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch19-cnc/mad-tank-detonation/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示一辆 MAD 坦克模型 (橄榄色车体 + 炮塔 + 引擎后部)

### 2. 步骤一: 默认参数启动自爆序列

- 操作: 点击 "启动自爆序列 (Detonate)" 按钮
- 观察点 (时序):
  - t=0: 阶段显示 INITIATE, isInterruptible 变为 false
  - t=1-95: 阶段 CHARGING, 每约 0.32s (8 ticks @ 25fps) 产生一次 thump
  - 每次 thump: 震荡波环从坦克向外扩展, 坦克闪烁, 屏幕微震
  - 引擎发光逐渐从暗红变为亮橙
  - t=96: 阶段变为 CHARGING (保持), 引擎发光达到充电状态
  - t=97-137: 继续充电，屏幕震动保持
  - t=138: DETONATION! 粒子爆炸, 坦克消失, 红色大字浮现
- 预期: ✅ 完整序列约 5.5 秒, 所有阶段正确过渡

### 3. 步骤二: 指向目标引爆

- 操作: 点击 "重置", 然后点击 "指向目标引爆 (DetonateAttack)"
- 观察点: 序列行为与 Detonate 相同 (target 目前是 stub)
- 预期: ✅ 序列正常执行，无崩溃

### 4. 步骤三: 取消序列

- 操作: 点击 "启动自爆序列", 等待约 1 秒 (tick 约 25), 然后点击 "取消 (Cancel)"
- 观察点:
  - 引擎发光停止变化
  - 阶段变为 CANCELLED
  - 序列中止
- 预期: ✅ 取消后序列立即停止, isCancelling = true

### 5. 步骤四: 不同参数配置

- 操作: 调整充电延迟为 48, 引爆延迟为 20 → 总 68 ticks
- 操作: 点击 "启动自爆序列"
- 观察点:
  - 总持续时间明显缩短 (约 2.7 秒)
  - thump 次数减少 (floor(48/8) = 6 次)
- 操作: 调整 thump 间隔为 4
- 观察点: thump 频率加倍 (每 0.16s 一次)
- 预期: ✅ 参数调整正确影响序列时长和 thump 频率

### 6. 边界/异常测试

- **边界 A - 快速取消**: 启动后立即 (100ms 内) 点击取消
  - 预期: ✅ 序列中止, 不进入充电阶段

- **边界 B - 重置后重启**: "重置" → 启动 → 等待几 tick → "重置" → 再次启动
  - 预期: ✅ 每次重置后状态完全恢复, 可以正常重新启动

- **边界 C - 极短延迟**: chargeDelay=24, detonationDelay=10 → 总 34 ticks
  - 预期: ✅ 序列快速完成 (~1.4s), 所有阶段正常执行

### 7. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据), 提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息, 检查 WebGL 支持
