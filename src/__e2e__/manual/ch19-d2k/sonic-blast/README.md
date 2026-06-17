# 音波爆炸 - SonicBlast 弹道 + 环扩展 + 光束段 验收测试

**审核状态**: 审核中 (R1 Review → NEEDS FIXES → R2)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.D2k/Projectiles/SonicBlast.ts`, `src/OpenRA.Mods.D2k/Traits/World/SonicBlastRenderer.ts`, `src/OpenRA.Mods.D2k/Graphics/SonicBlastRenderable.ts`

## 期望结果 (Expected Results)

1. **直线弹道 (lerpQuadratic)**:
   - 音波从 Source 沿直线传播到 Target，轨迹使用 `WPos.lerpQuadratic(source, target, WAngle.Zero, ticks, length)`。
   - 可量化指标: 弹道严格沿 Source→Target 直线，横向偏差 < `8 WDist` (约 0.008 世界单位)。
   - 可量化指标: 每 tick 前进约 `speed` WDist。默认 speed=128，即每 tick 移动约 0.125 世界单位。
   - 可量化指标: WAngle 坐标系: 0 = 北 (负 Z)，逆时针递增。弹道朝向与 Source→Target 向量一致。

2. **环扩展效果 (SonicBlastRenderer)**:
   - 可量化指标: 每个 `DamageInterval` (默认 1 tick) 位置渲染一个扩展环，环初始直径 = `Size` (默认 16)，每 tick 扩大 `Zoom` (默认 2.5) 倍。
   - 可量化指标: 环颜色随距离渐变: 源端 (0%) = 亮橙 `#FF6600`，远端 (100%) = 暗红 `#660000`。
   - 可量化指标: 环在约 10 ticks 内完全淡出 (alpha 1.0 → 0.0)。

3. **伤害衰减 (Falloff)**:
   - 可量化指标: 衰减在 `range[]` 数组定义的区间内线性插值。默认 `falloff = [100, 100]`, `range = [0, 0]` (无衰减，全伤害)。
   - 可量化指标: 验证自定义 falloff 曲线: 设置 `falloff = [100, 50, 0]`, `range = [0, 5000, 10000]`。在 0 距离衰减 100%，5000 处 50%，10000 处 0%。
   - 可量化指标: 环的颜色 alpha 随 falloff 值变化: 100% = 完全不透明，0% = 几乎不可见。

4. **散布 (Inaccuracy)**:
   - 可量化指标: Maximum 模式: 散布 = `min(range * 2/3, inaccuracy)`，散布为世界空间矩形区域。
   - 可量化指标: PerCellIncrement 模式: 散布 = `min(round(range/1024)*1024, inaccuracy)`，散布按 cell 步进增大。
   - 可量化指标: Absolute 模式: 散布 = `inaccuracy`，散布为固定大小的矩形区域。
   - 可量化指标: 散布通过 `WVec.FromPDF` 生成 (两个均匀分布样本取平均)，直接作为 `WVec(offsetX, offsetY, 0)` 加到 Target 上，为世界空间直接偏移。

5. **最小距离 (MinDistance)**:
   - 可量化指标: 若 Source→Target 距离 < MinDistance，弹道延长到 MinDistance 长度。
   - 可量化指标: 延长的弹道超出 Target，在延长段继续应用伤害衰减。

6. **光束段 (SonicBlastRenderable)**:
   - 可量化指标: 每个 tick 位置生成一个光束可渲染段，位置通过 `worldRenderer.Screen3DPxPosition(pos)` 投影。
   - 可量化指标: 光束段 bounds = 以 pos 为中心的矩形，半宽 = `Size/2 = 8` 像素。
   - 可量化指标: 光束段叠加时呈现连续波束效果，无可见间断。

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch19-d2k/sonic-blast/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示深色地形网格、绿色 Source 球体、红色 Target 球体

### 2. 步骤一: 基础弹道

- 操作: 点击 "发射音波" 按钮
- 观察点:
  - 音波从 Source (绿色) 沿直线向 Target (红色) 传播
  - 弹道严格为直线，无弯曲
  - 在传播路径上留下扩展环序列
  - 环颜色从源端的亮橙渐变到远端的暗红
- 预期: ✅ 音波沿直线传播，环序列均匀分布，颜色随距离渐变

### 3. 步骤二: 速度调整

- 操作: 拖动 "速度" 滑块到 64，点击 "重置" 然后 "发射音波"
- 观察点:
  - 音波移动更慢，环更密集 (间距更小)
- 操作: 拖动 "速度" 滑块到 512，点击 "重置" 然后 "发射音波"
- 观察点:
  - 音波移动更快，环更稀疏 (间距更大)
  - 弹道仍为直线
- 预期: ✅ 速度影响环间距和总 travel ticks，不影响弹道直线性

### 4. 步骤三: 散布

- 操作: 拖动 "散布" 到 256，选择类型 "Absolute"，点击 "显示散布区域"，然后 "发射音波"
- 观察点:
  - 在 Target 周围显示矩形散布区域 (四条边框 + Source→Target 连线)
  - 音波终点在 Target 附近偏移 (在散布范围内)
- 操作: 切换散布类型为 "Maximum"，观察散布区域大小变化
- 预期: ✅ 散布区域大小和形状随类型变化，实际弹道终点在区域内

### 5. 步骤四: 单步调试

- 操作: 点击 "单步前进" 按钮逐 tick 查看
- 观察点:
  - 每点击一次，音波前进一个 tick 距离
  - 每个新位置出现一个新环
  - 旧环逐渐淡出
- 预期: ✅ 每一步位置精确对应 speed 距离，环按序生成和淡出

### 6. 边界/异常测试

- **边界 A - 暂停/恢复**: 发射后点击 "暂停/恢复"
  - 预期: ✅ 音波在原地暂停，恢复后继续沿弹道前进

- **边界 B - 最小距离**: 将 Target 移近 Source (距离 < 2000 WDist)
  - 预期: ✅ 弹道延长到 MinDistance 长度，超出 Target

- **边界 C - 重置**: 发射中途点击 "重置"
  - 预期: ✅ 所有环清除，音波回到 Source

- **边界 D - 多次发射**: 连续点击 "发射音波" 3 次
  - 预期: ✅ 3 个音波同时沿弹道传播，各自管理独立的环序列

### 7. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据)，提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息，检查 WebGL 支持
