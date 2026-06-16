# Support Powers -- Charge Bar Visual Test

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-15
**对应模块**: `src/OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.ts`

## 期望结果 (Expected Results)

1. **0% 空进度条**: 进度条背景框可见，但填充区域宽度为 0。填充色不可见，仅显示深色背景框和边框。

2. **50% 半进度条**: 进度条左半 (exactly 50% width) 填充配置颜色，右半为空 (深色背景)。进度文字显示 "50%"。
   - 可量化指标: 滑块值 = 50 时，bar fill 宽度 = 252px (BAR_TEX_W=512, padding=4*2, fill = 504 * 0.5 = 252)

3. **100% 满进度条**: 进度条完全填充配置颜色，充满整个背景框。文字显示 "100%"。
   - 可量化指标: 滑块值 = 100 时，bar fill 宽度 = 504px (完整填充)

4. **颜色匹配**: 填充色与颜色选择器/预设值一致。
   - 默认: Magenta #FF00FF (OpenRA Color.Magenta = RGB 255,0,255)
   - 可量化指标: 在 50% 进度下，填充区域 RGB 通道与选择器值偏差 < 5

5. **DisplayWhenEmpty 行为**: DisplayWhenEmpty=false (OpenRA 默认) 且滑块=0% 时，进度条完全不可见 (alpha=0)。切换为 true 后，0% 时显示空进度条背景框。

6. **Disabled/Paused 隐藏**: 建筑状态设为 Disabled 或 Paused 后，进度条立即消失 (isBarVisible()=false)。恢复 Active 后进度条重新显示。
   - 可量化指标: isActive=false 或 isDisabled=true 或 isPaused=true → visible=false
   - 可量化指标: isActive=true && !isDisabled && !isPaused → visible=true (除非 DisplayWhenEmpty 隐藏)

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/support-powers/charge-bar/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认场景显示一个蓝色建筑物，上方悬挂 Magenta 色进度条 (初始 30%)

### 2. 步骤一: 进度变化验证

- 操作: 拖动 "充能进度" 滑块从 0 到 100
- 观察点:
  - 0%: 进度条完全为空 (仅背景框)
  - 50%: 进度条左半填充 Magenta 色，右半为空
  - 100%: 进度条完全填充 Magenta 色
  - 状态面板 "充能进度" 和 "剩余 Tick" 实时更新
- 预期: ✅ 进度条宽度与滑块值成正比，0%→空, 50%→半, 100%→满

### 3. 步骤二: 颜色配置验证

- 操作: 在颜色预设下拉框中选择 "Red" (#FF4444)
- 观察点:
  - 进度条填充色从 Magenta 变为红色
  - 颜色选择器同步更新为 #ff4444
- 操作: 逐一选择 Green, Blue, Orange 预设
- 观察点:
  - 每种颜色切换即时生效 (<100ms)
  - 颜色选择器和进度条颜色完全一致
- 预期: ✅ 颜色匹配，预设与进度条填充色一致

### 4. 步骤三: DisplayWhenEmpty 验证

- 操作: 拖动滑块到 0%
- 观察点: 进度条完全不可见 (因为 DisplayWhenEmpty=false 默认值)
- 操作: 点击 "true (始终显示)" 按钮
- 观察点: 进度条重新出现，显示空的背景框 (无填充色)
- 操作: 点击 "false (空时隐藏)" 恢复默认
- 观察点: 进度条再次消失
- 预期: ✅ DisplayWhenEmpty=true→0%显示空框; false→0%完全隐藏

### 5. 步骤四: 建筑状态切换

- 操作: 点击 "Disabled" 按钮
- 观察点:
  - 建筑变为暗红色 (#402626)
  - 进度条立即消失
  - 状态面板显示 "建筑: Disabled", "进度条可见: 否"
- 操作: 点击 "Paused" 按钮
- 观察点:
  - 建筑变为暗黄色
  - 进度条仍然不可见
- 操作: 点击 "Active" 按钮
- 观察点:
  - 建筑恢复蓝色
  - 进度条重新显示 (如果有进度)
- 预期: ✅ Disabled/Paused→进度条消失, Active→进度条恢复

### 6. 边界/异常测试

- **边界 A - 极端进度**: 滑块=100% → 滑块=0% (快速拖动)
  - 预期: ✅ bar fill 即时缩放，无闪烁或撕裂

- **边界 B - 颜色快速切换**: 连续选择不同颜色预设 (5 次/秒)
  - 预期: ✅ 无 WebGL 纹理泄漏或崩溃，每次切换 <100ms

- **边界 C - 摄像机旋转**: 旋转摄像机到极端角度 (平行于进度条)
  - 预期: ✅ 进度条始终面向摄像机 (Billboard 效果正常)

### 7. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据)，提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息，检查 WebGL 支持
