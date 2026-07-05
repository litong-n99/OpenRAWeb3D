# Tesla闪电电弧 — TeslaZap + ChargeOverlay 验收测试

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-05, 17/17 通过, 100%)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts` (384 lines), `src/OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts` (317 lines)
**OpenRA 对照**: `OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.cs` (167 lines), `OpenRA.Mods.Cnc/Projectiles/TeslaZap.cs` (99 lines)

## 期望结果 (Expected Results)

1. **闪电弧生成 (Lightning Arc Generation)**:
   - 使用 Babylon.js LinesMesh 绘制锯齿形闪电
   - 可量化指标: 闪电路径由 2 或 3 段组成 (随机选择), 每段细分为 >= 3 个顶点
   - 可量化指标: 顶点锯齿偏移 ±0.075 世界单位 (与段距离成正比)
   - 可量化指标: 从 Tesla 塔顶 (Y=2.55) 到目标球 (Y=0.8) 的闪电

2. **Dim/Bright 分层渲染**:
   - Bright 闪电: 颜色 #FFFFFF (纯白), 数量由 brightZaps 参数控制 (默认 1)
   - Dim 闪电: 颜色 #80B3FF (淡蓝), 数量由 dimZaps 参数控制 (默认 2)
   - 可量化指标: brightZaps=2 时可见 2 条白色主线, dimZaps=4 时可见 4 条蓝色边缘线
   - 可量化指标: brightZaps=0 时只有 Dim 闪电, dimZaps=0 时只有 Bright 闪电

3. **持续时间管理 (Duration)**:
   - 默认 duration=2 ticks (80ms @ 25fps)
   - 可量化指标: 持续时间 1-10 ticks 可通过滑块调整
   - 可量化指标: 闪电到期后 LinesMesh 被 dispose (消失)
   - 可量化指标: 连续发射模式下每隔 400ms (~10 ticks) 自动发射一次

4. **充能叠加动画 (Charge Overlay Animation)**:
   - 点击"触发充能"后, 塔顶出现蓝色电弧球
   - 可量化指标: 球体直径从 0.05 增长到 0.5 世界单位 (10 倍增长), 持续 8 ticks (320ms)
   - 可量化指标: emissive 颜色从 (0.1, 0.3, 0.5) 线性增长到 (1.0, 1.0, 1.0)
   - 可量化指标: 充能完成后自动开火 (fireZap)

5. **随机分支 (Random Branching)**:
   - 每次发射的闪电形状不同 (使用 seeded random 保证可复现)
   - 可量化指标: 连续点击"发射闪电"10 次, 应观察到 >= 5 种不同的闪电形状

---

## 检验流程

### 1. 准备工作
- 打开测试页面: `http://localhost:5173/test/ch19-cnc/tesla-zap/`
- 确认页面显示左侧 Tesla 塔 (白色圆柱+线圈环) 和右侧红色目标球
- 确认环境信息栏显示 "引擎: WebGL 2.0"

### 2. 步骤一: 默认发射
- 点击 "发射闪电" 按钮
- 观察白色/蓝色闪电弧从塔顶连接到目标球
- 观察闪电持续约 80ms 后消失
- 预期: ✅ 闪电可见, dim=2 蓝色边缘 + bright=1 白色核心

### 3. 步骤二: 调整闪电数量
- 设置 Bright=4, Dim=4
- 点击"发射闪电"
- 观察 8 条闪电同时出现
- 设置 Bright=0, Dim=4
- 观察只有 4 条蓝色边缘闪电
- 预期: ✅ 闪电数量与选择值匹配

### 4. 步骤三: 连续发射
- 点击 "连续发射" 按钮
- 观察每隔约 400ms 自动发射一次
- 观察每次闪电形状不同
- 点击 "连续发射" 停止
- 预期: ✅ 连续发射正常, 每次形状随机变化

### 5. 步骤四: 充能动画
- 点击 "触发充能" 按钮
- 观察塔顶蓝色球体从无到有, 逐渐增大
- 观察球体发光逐渐变亮
- 充能完成后自动发射闪电
- 预期: ✅ 充能过程持续约 320ms, 完成后自动开火

### 6. 步骤五: 持续时间调整
- 设置持续时间为 10 ticks
- 点击"发射闪电"
- 观察闪电持续约 400ms (10 ticks * 40ms)
- 设置持续时间为 1 tick
- 观察闪电几乎瞬间消失
- 预期: ✅ 持续时间与滑块值成正比

### 7. 结果判定
- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异
