# ScreenMap - 空间查询与选择框可视化验证

> **人工验收测试页**
> 模块: ScreenMap (SpatialPartitioned grid, ActorsInMouseBox, ActorsAtMouse)
> 测试ID: `screenmap/spatial-query`
> OpenRA 对照: `ScreenMap.ts` — SpatiallyPartitioned<T> spatial hash, mouse hit-test, box selection
> 创建日期: 2026-06-09
> 状态: **PENDING (Round 5: 高亮修复 + Camera 键盘控制)**
>
> **调试轮次**:
> - Round 1 (504758a): 修复 unit mesh 遮挡 scene.pick()
> - Round 2 (c6fe9ac): 替换 scene.pick() 为 createPickingRay() + XZ plane intersection
> - Round 3 (f77dbad): Canvas focus outline 白框修复 + 全面诊断日志
> - Round 4 (f77dbad): 将业务逻辑从 mousedown/mouseup 迁移到 pointerdown/pointerup
> - **Round 5 (本次): 修复选中高亮不可见 + Camera 改为键盘控制**
>
> ### Round 5 修复
>
> **问题 1 - 选中单元未出现亮青色高亮**:
> 根因: `highlightSelected()` 使用 `emissiveColor` 乘法调色。单元材质启用了
> `disableLighting=true`，输出 = `emissiveColor × emissiveTexture`。将
> emissiveColor 设为青色 (0.4,0.9,1.0) 乘以红色/蓝色纹理后结果近乎黑色或暗色，
> 肉眼无法辨认高亮变化。
>
> 修复: 高亮时移除 emissiveTexture，让 emissiveColor 直接作为纯色输出。
> - 选中: 纯青色 emissiveColor(0,1,1)，无纹理
> - 悬停: 纯黄色 emissiveColor(1,1,0)，无纹理
> - 普通: 恢复纹理 + emissiveColor(1,1,1)
>
> **问题 2 - 拖拽鼠标时 Camera 乱动**:
> 根因: `camera.attachControl(canvas, true)` 使 Camera 响应鼠标拖拽进行
> 旋转/平移/缩放，与框选拖拽冲突。
>
> 修复: 移除 attachControl，改用键盘 + 滚轮控制。
> - Insert 键: Camera 左转 (alpha += 0.15 rad, ~8.6°)
> - Delete 键: Camera 右转 (alpha -= 0.15 rad, ~8.6°)
> - 滚轮: 缩放 (radius ± 0.01 * deltaY)

---

## 测试目标

本测试页面验证 ScreenMap 的空间索引核心行为：

1. SpatiallyPartitioned 空间哈希网格正确分区
2. ActorsInMouseBox（矩形框选）正确检测与选择框相交的所有单元
3. ActorsAtMouse（精确点击）仅命中点击点下的单元
4. binSize 变化时分区粒度正确调整
5. ScreenBounds 和 MouseBounds 可视化正确

---

## B. 期望结果（可量化验收标准）

### 期望 1: 精确点击 (ActorsAtMouse) 只命中一个单元

**操作**: 对场景中的某个单元执行精确点击（单击，不拖拽）。

**量化标准**:
- 仅被点击的单元高亮（纯青色 emissiveColor(0,1,1)，纹理被移除）
- 其他所有单元保持原始颜色（有编号纹理）
- 状态栏「选中」计数应显示 **1 个**
- 如果点击空白区域，选中计数应显示 **0 个**

**失败判定**: 单击空白处选中单元或单击单元时选中多个 → **MAJOR** 点查询精度错误

### 期望 2: 矩形框选 (ActorsInMouseBox) 正确检测相交单元

**操作**: 从空白区域拖拽鼠标绘制覆盖 3-5 个单元的矩形选择框。

**量化标准**:
- 选择框边界内（含部分重叠）的所有单元均被高亮选中
- 选择框外的单元不被选中
- 选中计数与选择框覆盖的单元数一致
- 选择框实时绘制在 Canvas 上（蓝色 `#58a6ff` 边框 + 透明蓝色填充）

**失败判定**: 框选后选中计数与实际覆盖单元数不一致 → **BLOCKER** 框选查询逻辑错误

### 期望 3: 包圍盒可视化 (ScreenBounds) 位置准确

**操作**: 启用「Show Bounds」按钮（默认已启用）。

**量化标准**:
- 每个单元周围显示绿色 (R=76, G=179, B=76) 包圍盒线框
- 包圍盒精确包裹单元边界，**无偏移**（线框与单元纹理对齐）
- 包圍盒大小为 `unitSize x unitSize`（默认 1.5 x 1.5 单位）
- 如果单元被选中，线条颜色不变（bounds 独立于选中状态）

**失败判定**: 包圍盒线框偏离单元 → **MINOR** bounds 计算偏移

### 期望 4: 鼠标命中边界 (MouseBounds) 显示正确

**操作**: 启用「Show Mouse Bounds」按钮。

**量化标准**:
- 每个单元周围显示橙色 (R=229, G=153, B=51) 的 mouse bounds 多边形
- Mouse bounds 多边形也精确对齐单元边界（默认方形，与 ScreenBounds 一致）
- Mouse bounds 线条与 ScreenBounds 线条可见且可区分（绿色 vs 橙色）

**失败判定**: Mouse bounds 缺失或位置错误 → **MINOR** 命中测试边界配置错误

### 期望 5: 分区网格 (Bin Grid) 粒度随 binSize 调整

**操作**: 启用「Show Grid」按钮，然后切换 binSize 下拉菜单。

**量化标准**:
- binSize = 5: 30x30 世界被切分为 **6x6 网格** (30/5=6)
- binSize = 10: 网格变为 **3x3** (30/10=3)
- binSize = 15: 网格变为 **2x2** (30/15=2)
- 网格线颜色为深蓝色 (R=51, G=77, B=128)，位于 Y ≈ 0.01 高度
- 切换 binSize 后网格线立即更新（**200ms 内**）

**失败判定**: binSize 变化后网格线数量不符 → **MINOR** 分区计算错误

### 期望 6: Hover 检测即时响应

**操作**: 启用「Hover Test」按钮，缓慢移动鼠标经过多个单元。

**量化标准**:
- 鼠标悬停时，当前单元高亮为纯黄色 (emissiveColor(1,1,0)，纹理被移除)
- 鼠标离开时，高亮立即消失（**50ms 内**），恢复原始纹理
- 左上角 overlay 显示当前鼠标的世界坐标 (x, z)
- Hover 检测仅在单元边界内触发（不在空白处误触发）

**失败判定**: Hover 延迟 > 200ms → **MAJOR** 空间查询性能问题

### 期望 7: 随机位置后查询正确

**操作**: 点击「Randomize Positions」3 次，每次之后执行框选测试。

**量化标准**:
- 随机化后所有单元位置 100% 在 30x30 世界范围内
- 包圍盒线框随单元移动正确更新位置
- 框选查询结果始终与可视化覆盖一致
- bin 网格覆盖范围不变，但单元在不同 bin 间重新分布

**失败判定**: 随机化后查询结果不一致 → **MAJOR** 空间索引更新 bug

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/screenmap/spatial-query/`
2. 确认环境信息栏显示 WebGL 2.0
3. 确认场景中有 20 个彩色方块（带白色编号）随机分布
4. 默认应显示绿色包圍盒线框
5. **Camera 控制**: Insert 左转 / Delete 右转 / 滚轮缩放 (不再支持鼠标拖拽 Camera)

### 步骤一：精确点击验证

1. 单击任意一个单元（不要拖拽）
2. 确认该单元高亮（亮青色）
3. 确认「选中」计数 = 1
4. 单击空白区域 → 确认计数 = 0

**预期**: ✅ 符合期望 1

### 步骤二：矩形框选验证

1. 在单元密集区域拖拽鼠标绘制选择框
2. 确认选择框为蓝色边框透明填充
3. 记录「选中」计数
4. 逐一确认被选中的单元都在选择框边界内
5. 重复 3 次从不同方向框选

**预期**: ✅ 符合期望 2

### 步骤三：包圍盒可视化

1. 确认所有单元有绿色线框包围
2. 点击 "Randomize Positions" → 线框跟随移动
3. 点击 "Show Bounds" 关闭 → 线框消失
4. 再次点击 → 线框重新出现

**预期**: ✅ 符合期望 3

### 步骤四：Mouse Bounds 可视化

1. 点击 "Show Mouse Bounds" → 橙色多边形出现
2. 确认与 ScreenBounds (绿色) 在相同位置
3. 同时关闭/开启两者 → 确认颜色可区分

**预期**: ✅ 符合期望 4

### 步骤五：分区网格测试

1. 点击 "Show Grid" → 显示网格
2. 切换 binSize = 5 → 确认 6x6 网格
3. 切换 binSize = 10 → 确认 3x3 网格
4. 切换 binSize = 15 → 确认 2x2 网格
5. 每个 binSize 下执行框选 → 确认查询仍然正确

**预期**: ✅ 符合期望 5

### 步骤六：Hover 检测

1. 点击 "Hover Test (on)" → 按钮变亮
2. 缓慢移动鼠标经过多个单元
3. 确认黄色高亮跟随鼠标
4. 将鼠标停在单元间空白处 → 高亮消失
5. 观察 overlay 的坐标显示

**预期**: ✅ 符合期望 6

### 步骤七：随机化与一致性

1. 点击 "Randomize Positions" 3 次
2. 每次后执行框选 → 确认结果一致
3. 每次后检查包圍盒线框位置

**预期**: ✅ 符合期望 7

### 边界/异常测试

1. **选择框覆盖整个场景**: 从角落拖到对角 → 应选中 20 个全部单元
2. **选择框覆盖 0 个单元**: 在场景外空白区域框选 → 选中计数 = 0
3. **快速重复操作**: 快速点击 Randomize + 框选 5 次 → 无崩溃
4. **极端 Camera 缩放**: 滚轮 zoom 到最近 (radius=5) → 单元和线框仍正确渲染
5. **重叠单元**: 如果单元重叠，框选应选中重叠的所有单元

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 7 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [ ] 期望 1 通过（精确点击）
- [ ] 期望 2 通过（矩形框选）
- [ ] 期望 3 通过（包圍盒可视化）
- [ ] 期望 4 通过（Mouse Bounds）
- [ ] 期望 5 通过（分区网格粒度）
- [ ] 期望 6 通过（Hover 检测）
- [ ] 期望 7 通过（随机化一致性）

**最终判定: _______________**

**设备信息**:
- GPU: __________
- 浏览器: __________
- 操作系统: __________
- 视口: __________

---

## 调试日志收集指南 (Round 5)

打开浏览器 DevTools 控制台 (F12 → Console)，执行以下操作并**截图或复制全部控制台输出**：

### 步骤 1: 页面加载后检查
- 确认控制台中出现 `[screenmap] === Setup complete, ready for interaction ===`
- 确认 Canvas Dimensions 组中 `canvas.width` 和 `engine.getRenderWidth()` 值相等
- 确认没有红色错误

### 步骤 2: 单击一个可见单元
- 在控制台中观察应出现:
  - `[EVENT #N] pointerdown START` — 含 pick 诊断
  - `[EVENT #N] pointerup START` — 含最终选中计数
- **关键检查**:
  - pointerdown 组中 `→ pick SUCCESS` 是否出现？坐标是否合理？
  - `→ Point query preview at this position: N unit(s)` N 是否 > 0？
  - pointerup 组中 `→ final selected count: N` N 是否 > 0？
- 如果任何一步出现 FAILED、SKIP 或 N=0，截图该部分日志

### 步骤 3: 如果点击后无高亮
- 重点检查 pointerup 日志组:
  - `isSelecting=true` 还是 `false`？
  - `selStartWorld` 是否为 `null`？
  - 是否出现了 `SKIP` 提示？
- **空白处右键** 触发诊断日志（包含 scene.pick、createPickingRay、所有 unit 位置状态）
- 确认高亮逻辑: 选中单元应显示纯青色 (无纹理)，未选中单元有编号纹理

### 步骤 4: Camera 键盘控制
- 按 Insert 键: Camera 应向左旋转 (alpha 增加，视图向左平移)
- 按 Delete 键: Camera 应向右旋转 (alpha 减少，视图向右平移)
- 滚轮缩放: 向前放大 (radius 减小)，向后缩小 (radius 增大)
- 拖拽鼠标: Camera 不应移动

### 提交日志
将所有控制台日志复制到文本文件，标注：
- 哪个操作产生了哪些日志
- 哪些步骤的结果与预期不符
