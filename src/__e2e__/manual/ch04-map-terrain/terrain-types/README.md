# TerrainInfo / TileSet 地形类型分类与颜色验证

**OpenRA 对照**: `TerrainInfo.ts` (TerrainTypeInfo + TerrainTileInfo + TileSet + Riser + color utilities)  
**测试重点**: 地形类型 ARGB 颜色正确性、TileSet 注册与查找、getColor() 随机化插值、parseColorHex() 精度

## 期望结果

### 1. 地形类型颜色与定义一致

10 种 C&C TD 模拟地形类型在 3D 场景和侧面板中以正确的颜色显示：

| 类型 | 定义颜色 (hex) | 预期 RGBA | 观察点 |
|------|---------------|-----------|--------|
| Clear | #90EE90 | R=144, G=238, B=144, A=255 | 淡绿色，草地色调 |
| Rough | #D2B48C | R=210, G=180, B=140, A=255 | 棕褐色，沙土色调 |
| Road | #708090 | R=112, G=128, B=144, A=255 | 深灰蓝色，道路色 |
| Water | #4169E1 | R=65, G=105, B=225, A=255 | 皇家蓝，水面色 |
| Rock | #808080 | R=128, G=128, B=128, A=255 | 中灰色，岩石色 |
| Wall | #A0522D | R=160, G=82, B=45, A=255 | 赭色，墙壁色 |
| Tiberium | #00FF7F | R=0, G=255, B=127, A=255 | 翠绿色，泰矿色 |
| Beach | #F5DEB3 | R=245, G=222, B=179, A=255 | 小麦色，沙滩色 |
| River | #1E90FF | R=30, G=144, B=255, A=255 | 道奇蓝，河流色 |
| Cliff | #A9A9A9 | R=169, G=169, B=169, A=255 | 深灰色，悬崖色 |

**可量化标准**:
- 每个地形类型的 3D 面片颜色与侧面板色块颜色肉眼一致（在 sRGB 显示器上偏差不超过 Delta-E 5）
- 侧面板中每个色块下方显示的十六进制颜色与上表一致
- 3D 场景中 Clear 的面片肉眼观察为淡绿色，Water 的面片肉眼观察为蓝色
- parseColorHex('#90EE90') 返回 0xFF90EE90（A=0xFF，R=0x90, G=0xEE, B=0x90）

### 2. TileSet 正确加载模板和 Tile

8 个模板 + 8 个 Tile 在 TileSet 中正确注册：

**可量化标准**:
- 侧面板统计显示: "地形类型数: 10", "模板数: 8", "总 Tile 数: 8"
- Side panel tile list 显示所有 8 个 tile 条目，每个有 Template ID、tile index、height、rampType、颜色
- Tpl#5[0] 显示 height=2, ramp=5（岩石带斜坡）
- Tpl#10[0] 显示 riser="LD=4" 信息（悬崖带 Riser 边高）
- 调用 TileSet.getTileInfo(new TerrainTile(0, 0)) 返回 Clear 类型的 TerrainTileInfo（不抛异常）

### 3. getColor() 颜色插值可见

当 minColor 和 maxColor 不同时，getColor() 返回插值颜色：

**可量化标准**:
- 点击"随机化 Tile 颜色"按钮 10 次，Tpl#0[0] (Clear, minColor=#88E088, maxColor=#98F898) 的色块在淡绿到翠绿之间变化
- Tpl#4[0] (Water, minColor=#3060D0, maxColor=#5070F0) 的色块在深蓝到浅蓝之间变化
- 当 minColor === maxColor 时（如 Tpl#3 Road），点击按钮颜色不变
- colorLerp(0.5, minColor, maxColor) 的结果为两颜色的精确算术平均（每个通道独立取整）

### 4. 3D 渲染性能

**可量化标准**:
- 10 个地形类型面片 + 地面面片同时渲染 FPS 稳定在 55-60
- 摄像机旋转时无画面闪烁
- 侧面板 10 个色块在页面加载后 500ms 内全部显示

---

## 检验流程

### 准备工作

1. 打开测试页面: `http://localhost:5173/test/map/terrain-types/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920x1080 (1x 缩放)

### 步骤一: 验证地形类型颜色

1. 观察 3D 场景中的彩色面片（10 个，以网格形式排列）
2. 在侧面板"地形类型颜色"区域，逐个对比每个色块与 3D 场景中对应面片的颜色
3. 检查每个色块下方的十六进制颜色值是否与期望表一致
4. 将浏览器缩放至 150%，确认色块颜色在缩放后无异常
5. 预期: 所有 10 种地形类型的颜色与上表一致

### 步骤二: 验证 TileSet 数据正确性

1. 检查侧面板"TileSet 统计信息"区域
2. 确认: 地形类型数=10, 模板数=8, 总 Tile 数=8
3. 检查"模板 Tile 详情"列表
4. 找到 Tpl#5[0]，确认其 ramp=5、height=2（本页面仅验证颜色，不显示 3D 斜坡几何）
5. 找到 Tpl#10[0]，确认侧面板显示 `riser` badge，表示该 tile 数据层包含 riser 信息
6. 预期: 所有统计数据与源码定义一致

### 步骤三: 验证 getColor 随机化

1. 点击"随机化 Tile 颜色"按钮 5 次
2. 观察 Tpl#0[0] (Clear) 的色块变化: 颜色在淡绿色范围内波动
3. 观察 Tpl#4[0] (Water) 的色块变化: 颜色在蓝色范围内波动
4. 观察 Tpl#3[0] (Road, min=max): 色块颜色始终不变（无插值空间）
5. 预期: 有 min/max 色差的 tile 颜色在一定范围内随机变化，无范围时不变

### 步骤四: 边界测试

1. 旋转 3D 摄像机到极端角度（从正上方俯视、从侧面平视），确认面片始终可见无裁切
2. 快速滚动侧面板，确认无布局崩溃
3. 切换到移动端视口 (375x812)，确认侧面板可正常滚动
4. 在控制台执行: `TileSet.getTileInfo(new TerrainTile(0,0))` 确认返回值不为空（需先刷新页面确保脚本加载完成）

### 结果判定

- [x] 10 种地形类型颜色与上表定义一致 → **通过颜色验证**
- [x] TileSet 统计数据和 Tile 详情与源码定义一致 → **通过数据验证**
- [x] getColor 随机化在合理范围内变化 → **通过插值验证**
- [x] 60 FPS 稳定，无渲染异常 → **通过性能验证**
- [x] 全部通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异，提交 issue

### 验收状态

- **状态**: ACCEPTED (re-verified)
- **审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-23, 7/7 通过, 100%)
- **首次验收日期**: 2026-06-10
- **测试环境**: Chromium headless / 1920x1080 / WebGL 2.0 / Playwright + Kimi MCP 视觉验证
