# Support Powers -- Airstrike Directional Targeting Test

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-02, 12/12 通过, 100%)
**创建日期**: 2026-06-15
**对应模块**: `src/OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.ts`

## 期望结果 (Expected Results)

1. **8方向箭头渲染**: 以目标点为中心，8个箭头标签均匀分布。
   - 可量化指标: 箭头间距 = 360°/8 = 45°
   - 可量化指标: N=0° (正上方), NW=45°, W=90°, SW=135°, S=180°, SE=225°, E=270°, NE=315° (CCW 顺序, 从 (0,-1) 开始)
   - 可量化指标: 选中箭头高亮为黄色 (#FF8)，未选中为灰色半透明

2. **拖拽距离阈值**:
   - MinDragThreshold = 20px: 拖拽距离 < 20px 时，释放鼠标产生 `ExtraData = 0xFFFFFFFF` (NO_DIRECTION)，结果框显示红色 "无方向"
   - MaxDragThreshold = 75px: 拖拽距离 > 75px 时，方向向量**反转** (OpenRA 行为: `dragDirection = -MaxDragThreshold * float2.FromAngle(...)`)，方向线长度截断至 75px 但指向相反方向
   - 可量化指标: 红色虚线圆半径 = 20px (内圈)，白色虚线圆半径 = 75px (外圈)
   - 可量化指标: 绿色方向线 = 已超过阈值 (将产生有效方向)，红色方向线 = 未超过阈值

3. **Cursor 切换**: 鼠标在有效地形 (canvas 前 9/14 约 64% 区域) 上显示 `crosshair` (Cursor)，在阻塞区域 (canvas 后 5/14 约 36% 红色区域) 显示 `not-allowed` (BlockedCursor)。地图外模式强制显示 `not-allowed`。

4. **角度计算 (angleOf)**:
   - 正上方拖拽 (0,-1): 返回 0° (North)
   - 正右方拖拽 (1,0): 返回 270° → Arrow[6]="E" → facing ~768
   - 正下方拖拽 (0,1): 返回 180° → Arrow[4]="S" → facing ~512
   - 正左方拖拽 (-1,0): 返回 90° → Arrow[2]="W" → facing ~256

5. **16/32方向模式**: 切换方向数时箭头数量变化，单个箭头覆盖的扇形角度 = 360/N。32方向模式下每个箭头覆盖 11.25°。

---

## 检验流程

### 1. 准备工作

- 打开测试页面: `http://localhost:5173/test/support-powers/airstrike/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 设置屏幕分辨率为 1920x1080 (1x 缩放)
- 确认页面显示绿色地形网格，右侧约 36% 为红色 "BLOCKED" 区域
- 确认右下角面板显示期望结果

### 2. 步骤一: Cursor 切换验证

- 操作: 移动鼠标到绿色区域 (前 9/14)
- 观察点: 鼠标样式变为 `crosshair` (crosshair)
- 操作: 移动鼠标到红色 BLOCKED 区域 (后 5/14)
- 观察点: 鼠标样式变为 `not-allowed`
- 操作: 在下拉框中选择 "地图外 (Blocked)"
- 观察点: 任何位置鼠标样式均为 `not-allowed`
- 预期: ✅ cursor 样式根据地形正确切换

### 3. 步骤二: 拖拽方向瞄准

- 操作: 在绿色区域点击并按住左键，向上方 (12点钟方向) 拖动
- 观察点:
  - 出现红绿虚线圆 (阈值环)
  - 方向线从目标点向上延伸
  - 上方 "N" 标签高亮为黄色
  - 状态面板: 拖拽状态=拖拽中, 角度≈0°
- 操作: 继续拖拽直到超过 20px (方向线变绿)
- 观察点: 方向线变绿 (表明超过 MinDragThreshold)
- 操作: 释放鼠标
- 观察点: 屏幕中央显示绿色结果 "方向: N (拖拽 XXpx, ExtraData=0)"
- 预期: ✅ N 方向箭头被选中，ExtraData=0 (WAngle 0)

### 4. 步骤三: 所有 8 方向逐一测试

- 操作: 依次向 N, NW, W, SW, S, SE, E, NE 方向拖拽 (每次 > 20px)
- 观察点:
  - 每次对应的箭头标签高亮
  - 角度值在 ±22.5° 范围内 (45° 扇形)
  - ExtraData 值: N=0, NW=128, W=256, SW=384, S=512, SE=640, E=768, NE=896
- 预期: ✅ 所有 8 方向正确映射，ExtraData 值匹配 WAngle facing

### 5. 步骤四: MinDragThreshold 验证

- 操作: 点击并轻微拖动 (< 10px)，释放鼠标
- 观察点:
  - 方向线为红色 (未超过阈值)
  - 释放后弹出红色结果 "无方向 (拖拽 Xpx < 20px)"
  - 控制台输出 ExtraData=0xFFFFFFFF
- 预期: ✅ 短拖拽不产生方向，ExtraData=uint.MaxValue

### 6. 步骤五: MaxDragThreshold 验证（方向反转）

- 操作: 点击并向任意方向大量拖动 (> 100px)
- 观察点:
  - 方向线长度不超过 75px (白色虚线圆半径)
  - **方向反转**: 当拖拽超过 75px 时，方向线瞬间翻转到相反方向 (OpenRA 原始行为: 超出阈值时 `dragDirection = -MaxDragThreshold * float2.FromAngle(...)`)
- 预期: ✅ 拖拽距离 > 75px 时方向反转，长度截断至 75px

### 7. 边界/异常测试

- **边界 A - 16/32 方向模式**: 切换下拉框到 "16 方向" 或 "32 方向"
  - 预期: ✅ 箭头数量变化 (16 或 32)，标签正确，扇形角度相应缩小

- **边界 B - 快速点击 (无拖拽)**: 快速点击并立即释放 (几乎无移动)
  - 预期: ✅ 无方向产生，ExtraData=0xFFFFFFFF

- **边界 C - 地图外模式**: 选择 "地图外 (Blocked)"
  - 预期: ✅ 鼠标始终 not-allowed，拖拽仍可检测方向但 cursor 提示不可用

- **边界 D - 指针离开画布**: 拖拽过程中移出 canvas 边界
  - 预期: ✅ 拖拽自动取消，状态重置

### 8. 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据)，提交 issue
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息，检查 WebGL 支持
