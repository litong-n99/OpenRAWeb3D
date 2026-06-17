# 混凝土放置 - 建筑预览 + 崩塌覆盖 + 投送覆盖 验收测试

**审核状态**: 审核中 (R1 Review → NEEDS FIXES → R2)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.D2k/Traits/World/BuildableTerrainLayer.ts`, `src/OpenRA.Mods.D2k/Traits/Buildings/D2kActorPreviewPlaceBuildingPreview.ts`, `src/OpenRA.Mods.D2k/Traits/Render/WithCrumbleOverlay.ts`, `src/OpenRA.Mods.D2k/Traits/Render/WithDeliveryOverlay.ts`

## 期望结果 (Expected Results)

1. **混凝土板渲染 (BuildableTerrainLayer)**:
   - 可量化指标: 混凝土板渲染为灰色半透明方块，颜色 `#808080` (RGB 128, 128, 128)，alpha = `0.6`。
   - 可量化指标: 混凝土板放置在地形格网上方，Y 偏移 = `0.04` 世界单位 (约 41 WDist，1 世界单位 = 1024 WDist)。
   - 可量化指标: 每个混凝土单元格显示强度数字标签，初始值 = `MaxStrength = 9000`。
   - 可量化指标: 混凝土通过 `AddTile(cell, tile)` 放置，使用 `ITiledTerrainRenderer.tileSprite(tile)` 获取精灵。

2. **建筑放置预览 (D2kActorPreviewPlaceBuildingPreview)**:
   - 可量化指标: 有效单元格 (有混凝土) = 绿色 `#00FF00` (RGB 0, 255, 0)，alpha = `0.5`。
   - 可量化指标: 无效单元格 (无混凝土/被阻挡) = 红色 `#FF0000` (RGB 255, 0, 0)，alpha = `0.5`。
   - 可量化指标: 不安全单元格 (Rock 地形, RequiresPrerequisites 满足) = 橙色 `#FF8800` (RGB 255, 136, 0)，alpha = `0.5`。
   - 可量化指标: 预览使用序列 `build-valid` / `build-invalid` / `build-unsafe`，默认 image = `overlay`, palette = `terrain`。
   - 可量化指标: FootprintAlpha = `1.0` (有效/不安全)，LineBuildFootprintAlpha = `1.0` (线性建造)。

3. **崩塌覆盖 (WithCrumbleOverlay)**:
   - 可量化指标: 当建筑 HP 低于阈值时，在建筑上方显示半透明裂纹纹理。
   - 可量化指标: 裂纹颜色 `#888888` (RGB 136, 136, 136)，alpha = `0.7`。
   - 可量化指标: 覆盖动画 `sequence = crumble-overlay`，播放一次后 auto-remove (通过 `playThen` 回调)。
   - 可量化指标: SkipMakeAnimsInit 存在时不显示覆盖 (建筑创建动画干净)。

4. **投送覆盖 (WithDeliveryOverlay)**:
   - 可量化指标: Carryall 开始投送时 (`IncomingDelivery`)，单位上方显示活动动画 `sequence = active`。
   - 可量化指标: 覆盖位置由 `BodyOrientation.localToWorld(offset)` 计算，offset 默认 `WVec.Zero`。
   - 可量化指标: 投送完成后 (`Delivered`)，覆盖隐藏 (`_delivering = false`)。
   - 可量化指标: 覆盖标记为 `IsDecoration = true`，不受高亮闪光影响。

5. **混凝土伤害 (DamagesConcreteWarhead)**:
   - 可量化指标: `HitTile(cell, damage)` 减少混凝土强度，默认伤害 3000/次。
   - 可量化指标: 强度低于 1 时触发 `RemoveTile(cell)`，恢复默认地形 (customTerrain = 255)。
   - 可量化指标: `Building` 存在时阻止对下方单元格的伤害 (building footprint protection)。

6. **自定义地形变化**:
   - 可量化指标: 混凝土放置修改 `map.customTerrain[mposIdx]` 为 `tileInfo.terrainType`。
   - 可量化指标: 混凝土移除恢复 `map.customTerrain[mposIdx] = 255`。

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/ch19-d2k/concrete-placement/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示深色地形网格、绿色预览覆盖方块、一个灰色建筑模型

### 2. 步骤一: 混凝土放置

- 操作: 点击 "放置混凝土" 按钮，在下方的建筑位置放置混凝土板
- 观察点:
  - 建筑位置下方的地形格显示灰色半透明方块
  - 混凝土方块略微凸起于地形 (Y 偏移 ~0.04 世界单位, ~41 WDist)
  - 每个混凝土块上显示强度值 "9000"
- 预期: ✅ 混凝土板为灰色半透明，Y 偏移可见，强度标签显示 9000

### 3. 步骤二: 放置预览 (绿/红/不安全)

- 操作: 点击 "显示放置预览" 按钮 (默认已激活)
- 观察点:
  - 有混凝土的单元格显示绿色 (有效)
  - 无混凝土的单元格显示红色 (无效)
  - 状态栏显示 "预览状态: 显示中"
- 操作: 点击 "切换不安全地形"，将一些单元格标记为 Rock
- 观察点:
  - 标记为 Rock 的单元格预览变为橙色
  - 状态栏显示 "不安全地形: 启用"
- 预期: ✅ 绿色 (混凝土)、红色 (无混凝土)、橙色 (Rock 不安全) 三种预览颜色正确显示

### 4. 步骤三: 崩塌覆盖

- 操作: 点击 "崩塌覆盖 (Crumble)" 按钮
- 观察点:
  - 建筑模型上方出现半透明裂纹纹理
  - 裂纹为灰色 `#888888`, alpha 0.7
  - 裂纹播放一次后自动消失
  - 状态栏显示 "崩塌覆盖: 活跃"
- 预期: ✅ 裂纹覆盖在建筑上，播放后自动消失

### 5. 步骤四: 投送覆盖

- 操作: 点击 "投送覆盖 (Delivery)" 按钮
- 观察点:
  - 单位上方出现活动动画 (旋转或脉冲效果)
  - 覆盖标记为装饰 (不受高亮影响)
  - 状态栏显示 "投送覆盖: 投送中"
- 操作: 再次点击 "投送覆盖 (Delivery)" (模拟 Delivered)
- 观察点:
  - 覆盖消失
  - 状态栏显示 "投送覆盖: 已完成"
- 预期: ✅ 投送覆盖在单位上方显示，完成投送后消失

### 6. 步骤五: 混凝土伤害

- 操作: 选中一个有混凝土的单元格，点击 "伤害混凝土 (-3000)"
- 观察点:
  - 强度从 9000 降到 6000
  - 数字标签更新
- 操作: 点击 3 次 (累计伤害 12000 > 9000)
- 观察点:
  - 混凝土板消失，恢复为默认地形颜色
  - 该单元格预览从绿色变为红色
- 预期: ✅ 混凝土强度递减，低于 1 时自动移除

### 7. 边界/异常测试

- **边界 A - 建筑保护**: 在建筑下方有混凝土时点击 "伤害混凝土"
  - 预期: ✅ 建筑下方的混凝土不受伤害，强度保持不变

- **边界 B - 无混凝土时预览**: 移除所有混凝土后查看预览
  - 预期: ✅ 所有预览单元格显示红色 (无效)

- **边界 C - 重置**: 点击 "重置" 按钮
  - 预期: ✅ 所有混凝土清除，预览重置，覆盖清除

- **边界 D - 多次切换**: 快速切换崩塌覆盖和投送覆盖
  - 预期: ✅ 覆盖正确叠加，无视觉闪烁或残留

### 8. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据)，提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息，检查 WebGL 支持
