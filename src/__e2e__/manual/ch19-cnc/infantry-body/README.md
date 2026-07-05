# 多层步兵精灵渲染 — Infantry Body Layers 验收测试

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-05, 12/12 通过, 100%)
**创建日期**: 2026-06-17
**对应模块**:
- `src/OpenRA.Mods.Cnc/Traits/Render/WithDisguisingInfantryBody.ts` (262 lines)
- `src/OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.ts` (276 lines)
- `src/OpenRA.Mods.Cnc/Traits/Render/WithHarvesterSpriteBody.ts` (140 lines)
**OpenRA 对照**:
- `OpenRA.Mods.Cnc/Traits/Render/WithDisguisingInfantryBody.cs` (78 lines)
- `OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.cs` (58 lines)
- `OpenRA.Mods.Cnc/Traits/Render/WithHarvesterSpriteBody.cs` (50 lines)

## 期望结果 (Expected Results)

1. **身体层 (Body Layer - Base Infantry)**:
   - 默认 GDI 步兵: 绿色 #338844
   - 可量化指标: 身体由 6 个子网格组成 (躯干/头部/左臂/右臂/左腿/右腿)
   - 可量化指标: 身体层始终可见 (Z-depth = 0)

2. **伪装层 (Disguise Layer - WithDisguisingInfantryBody)**:
   - 3 种伪装身份循环: 无伪装 → 盟军步兵 (#6688CC) → 苏联步兵 (#CC4444)
   - 可量化指标: 伪装身份切换时身体颜色立即改变 (在 1 帧内)
   - 可量化指标: 伪装叠加 plane 在伪装激活时 alpha=0.7, 无伪装时 alpha=0
   - 可量化指标: 伪装 plane 使用 billboard 模式面向相机
   - 可量化指标: 图像名称随伪装更新 (e1 → e1-disguised-allied → e1-disguised-soviet)

3. **攻击叠加层 (Attack Overlay - WithSplitAttackPaletteInfantryBody)**:
   - 黄色 #FFCC00 半透明 plane 在攻击时出现
   - 可量化指标: 攻击叠加持续 10 ticks (400ms @ 25fps)
   - 可量化指标: alpha 从 0.9 线性衰减到 0
   - 可量化指标: 攻击叠加位置在右臂附近 (枪口火焰位置)
   - 可量化指标: 连续点击攻击按钮会重置计时器

4. **空闲叠加层 (Idle Overlay - WithIdleOverlay)**:
   - 蓝色 #4488FF 半透明 (alpha=0.5) plane
   - 可量化指标: 每 25 ticks (1秒) 切换一次 alpha (0.5 ↔ 0.15), 产生闪烁效果
   - 可量化指标: 可通过按钮关闭/开启空闲叠加层

5. **采集车满载率 (Harvester Fullness - WithHarvesterSpriteBody)**:
   - 身体颜色随满载率从绿色 (空) 渐变到金色 (满)
   - 可量化指标: fullness=0% → 颜色 (0.20, 0.53, 0.27) = #338844
   - 可量化指标: fullness=50% → 颜色 (0.50, 0.60, 0.20) = #809933
   - 可量化指标: fullness=100% → 颜色 (0.80, 0.67, 0.13) = #CCAA22

6. **显示模式 (Display Modes)**:
   - "所有层同时显示": 四层叠加在同位置
   - "仅身体层": 只显示绿色步兵
   - "仅叠加层": 只显示伪装/攻击/空闲 plane
   - "分解视图": 各层在 X 轴偏移显示, 可看清层次关系

---

## 检验流程

### 1. 准备工作
- 打开测试页面: `http://localhost:5173/test/ch19-cnc/infantry-body/`
- 确认页面显示绿色步兵模型 (6 个子网格)
- 确认蓝色空闲叠加层在闪烁

### 2. 步骤一: 伪装身份切换
- 点击 "伪装: 切换身份" 按钮
- 第一次: 切换到盟军步兵 (蓝色)
- 第二次: 切换到苏联步兵 (红色)
- 第三次: 回到无伪装 (绿色)
- 预期: ✅ 颜色在 1 帧内切换, 蓝色平面叠加可见

### 3. 步骤二: 攻击动画
- 点击 "攻击: 枪口火焰" 按钮
- 观察黄色半透明平面在武器位置出现
- 观察约 400ms 后自动消失
- 快速连续点击 3 次
- 预期: ✅ 每次攻击重置计时器, 最后一次后持续 400ms

### 4. 步骤三: 空闲叠加层
- 观察蓝色 plane 以约 1 秒周期闪烁 (alpha 切换)
- 点击 "空闲叠加: 切换" 关闭
- 观察蓝色 plane 消失
- 再点击一次重新打开
- 预期: ✅ 开关正常, 闪烁周期约 1 秒

### 5. 步骤四: 满载率变化
- 拖动满载率滑块到 0%
- 观察步兵颜色为纯绿色 #338844
- 拖动到 100%
- 观察步兵颜色变为金色 #CCAA22
- 拖动到中间值 50%
- 观察中间色 #809933
- 预期: ✅ 颜色连续渐变

### 6. 步骤五: 显示模式
- 切换 "仅身体层" → 只看到绿色步兵
- 切换 "仅叠加层" → 只看到 colored planes
- 切换 "分解视图" → 各层在 X 轴偏移排列
- 预期: ✅ 所有模式正确

### 7. 边界测试
- **多重伪装+攻击**: 伪装到苏联步兵, 立即攻击
  - 预期: ✅ 身体红色保持不变, 攻击叠加黄色独立显示
- **满载率+伪装**: 设置 fullness=100% (金色), 然后伪装到盟军
  - 预期: ✅ 伪装覆盖满载率颜色

### 8. 结果判定
- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异
