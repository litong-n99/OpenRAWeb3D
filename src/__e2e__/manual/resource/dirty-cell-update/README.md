# ResourceRenderer - 脏 Cell 增量更新渲染验证

> **人工验收测试页**
> 模块: ResourceRenderer (脏 cell 跟踪与增量精灵更新)
> 测试ID: `resource/dirty-cell-update`
> OpenRA 对照: `ResourceRenderer._addDirtyCell()` + `tickRender()` dirty queue (lines 534-904)
> 创建日期: 2026-06-14

---

## 测试目标

本测试页面验证 ResourceRenderer 的脏 cell 增量更新机制。在 OpenRA 中，当 ResourceLayer 的资源状态发生变化（CellChanged 事件），ResourceRenderer 将受影响的 cell 加入 `_dirty: Set<number>`。在每个渲染 tick 中，`tickRender()` 方法遍历脏 cell，仅更新那些密度或类型发生变化的 cell 的 sprite。这是关键的性能优化——避免每帧更新整个 map 的所有 cell。

自动化单元测试可以验证 `_addDirtyCell()` 的正确入队、`_cellKey()` 的位打包、`tickRender()` 的队列管理，但以下关键行为必须由人工肉眼判断：

1. **脏标记准确性**：采集某个 cell 后，仅该 cell 被标记为脏，相邻 cell 保持原样。
2. **密度帧更新正确**：重复采集同一 cell，密度逐步下降（10→9→...→1→0），视觉表现也随之逐步变小变暗。
3. **cell 清空行为**：当密度降为 0 时，精灵应清除（变为灰暗的空 cell 外观）。
4. **批量处理性能**：大量脏 cell 同时处理时不应有可见卡顿。
5. **脏 cell 队列生命周期**：处理完成后脏 cell 集合应清空，无残留。

---

## B. 期望结果（可量化验收标准）

### 期望 1: 单 cell 采集仅影响目标 cell

**操作**: 选择目标 cell（X=7, Y=5），点击「采集一次 (-1 密度)」。

**量化标准**:
| 检查项 | 预期值 |
|--------|--------|
| 目标 cell 变化 | cell (7,5) 的精灵应缩小并变暗 |
| 相邻 cell 不变 | cell (6,5), (8,5), (7,4), (7,6) 保持原始外观 |
| 脏 cell 计数 | 0（自动处理后立即清零） |
| 处理延迟 | < 100ms（肉眼无感知延迟） |
| 处理总数 | +1 |

**失败判定**: 若相邻 cell 也发生变化 → 脏 cell 索引计算错误（BLOCKER）。若处理延迟 > 500ms → 性能退化（MAJOR）。

### 期望 2: 密度逐步下降视觉渐变

**操作**: 对同一 cell 连续点击「采集一次」10 次（从密度 10 降到 0）。

**量化标准**:
| 步骤 | 密度 | 预期视觉变化 |
|------|------|-------------|
| 1 | 10→9 | 精灵略微缩小变暗（差异肉眼可辨） |
| 5 | 6→5 | 精灵大小约 50%（中等密度） |
| 9 | 2→1 | 精灵很小，颜色接近深绿（几乎不可见） |
| 10 | 1→0 | 精灵消失，cell 变为灰暗空 cell |
| 每步变化 | — | 肉眼可辨差异，无跳跃（相邻密度差异 < 15% 尺寸） |

**失败判定**: 若密度 10 和密度 1 的 cell 视觉完全相同 → 密度→帧映射未生效（BLOCKER）。若某步密度变化导致精灵变大（逆序）→ lerp 错误（BLOCKER）。

### 期望 3: Cell 清空正确清除精灵

**操作**: 点击「清空此 Cell」或执行采集直到密度为 0。

**量化标准**:
| 检查项 | 预期值 |
|--------|--------|
| 空 cell 外观 | 灰色半透明（alpha < 0.3），尺寸 < 15% 满 cell |
| 空 cell 颜色 | RGB 与原始资源颜色不同（应为灰/棕中性色调） |
| 地形底板 | 空 cell 处应能透过看到下方的深棕色底板 |
| 含资源 cell 计数 | -1 |
| 已枯竭 cell 计数 | +1 |
| 重新点击空 cell | 无效果（已枯竭，不再触发更新）|

**失败判定**: 若空 cell 仍显示资源颜色 → 清空逻辑未正确更新 sprite（BLOCKER）。若清空后 cell 仍占据满尺寸 → 缩放重置失败（MAJOR）。

### 期望 4: 批量采集性能稳定

**操作**: 点击「启动自动采集」，观察 FPS 和脏 cell 计数。

**量化标准**:
| 检查项 | 预期 |
|--------|------|
| 192 cell 全满时开始采集 | FPS >= 50 |
| 采集速率 5 次/秒 (200ms) | 每步处理在 50ms 内完成 |
| 采集到 96 cell 枯竭时 | FPS 无明显下降（保持不变或轻微下降 <= 5 fps） |
| 脏 cell 队列 | 每个采集动作后立即处理，队列不堆积 |
| 运行 30 秒 | 无内存泄漏（FPS 稳定），无崩溃 |

**失败判定**: 若自动采集 30 秒后 FPS 下降 > 10 fps → 性能退化（MAJOR）。若脏 cell 计数持续增长（不降）→ 处理逻辑未执行（BLOCKER）。

### 期望 5: 补充资源完整恢复

**操作**: 在多个 cell 枯竭后，点击「补充资源 (恢复所有 Cell)」。

**量化标准**:
| 检查项 | 预期 |
|--------|------|
| 恢复后所有 cell | 密度 = 10（满），绿色亮精灵，尺寸与初始一致 |
| 脏 cell 计数（恢复前） | 192（所有 cell 需要更新） |
| 脏 cell 计数（恢复后） | 0（已处理完毕） |
| 处理延迟 | < 1s（192 个 cell 批量更新） |
| 含资源 cell 计数 | 恢复为 192 |
| 已枯竭 cell 计数 | 恢复为 0 |

**失败判定**: 若恢复后仍有 cell 显示为枯竭 → 批量更新遗漏 cell（MAJOR）。

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/resource/dirty-cell-update/`
2. 确认环境信息栏显示 `Babylon.js` + `WebGL 2.0`
3. 默认状态：
   - 16x12 绿色 Tiberium 网格（192 cell，全部满密度 10）
   - 脏 cell 数 = 0，处理总数 = 0
   - 所有 cell 大小均匀，颜色亮绿
4. 确认看到完整均匀的绿色网格

### 步骤一：单 cell 采集验证

1. 将目标 cell 滑块设为 X=7, Y=5
2. 点击「采集一次 (-1 密度)」1 次
3. 观察 cell (7,5)：
   - 精灵尺寸应**略微缩小**
   - 精灵颜色应**略微变暗**
   - 变化应与相邻 cell 对比可见
4. 观察相邻 cell (6,5)、(8,5)、(7,4)、(7,6)：
   - 应**完全不变**
5. 检查状态面板：
   - 脏 cell 数 = 0（已自动处理）
   - 处理总数 = 1
6. 用鼠标悬停在 cell (7,5) 上：
   - 工具提示应显示密度=9

**预期**: 符合期望 1 → 继续

### 步骤二：连续采集渐变验证

1. 对 cell (7,5) 连续点击「采集一次」9 次（总共 10 次，从密度 10 到 0）
2. 每次点击后观察：
   - 第 2-5 次：精灵继续缩小变暗（密度 8→5）
   - 第 6-9 次：精灵很小时仍可见（密度 4→1）
   - 第 10 次：精灵消失，cell 变为灰暗半透明
3. 检查状态面板：
   - 含资源 cell = 191
   - 已枯竭 cell = 1
   - 脏 cell 数 = 0
   - 处理总数 = 10

**预期**: 符合期望 2 + 期望 3 → 继续

### 步骤三：清空 cell 验证

1. 修改目标 cell 为 X=10, Y=3
2. 点击「清空此 Cell」：
   - cell (10,3) 应瞬间变为灰暗空 cell
   - 密度应立即从 10 跳到 0
3. 检查状态：
   - 含资源 cell = 190
   - 已枯竭 cell = 2
4. 再次点击「清空此 Cell」（同一空 cell）：
   - 无任何变化（空 cell 不触发重复更新）

**预期**: 符合期望 3 → 继续

### 步骤四：批量采集性能验证

1. 记下当前含资源 cell 数（应为 ~190）
2. 点击「启动自动采集」
3. 观察 20-30 秒：
   - cell 逐个变暗/消失
   - FPS 保持在 50+
   - 脏 cell 数保持为 0（自动处理）
4. 在自动采集运行期间，点击几个 cell 进行手动采集：
   - 手动采集也应正确工作
5. 当约一半 cell 枯竭时（含资源 = ~95），点击「停止自动采集」
6. 确认处理总数持续增长且无遗漏

**预期**: 符合期望 4 → 继续

### 步骤五：补充资源恢复验证

1. 确认多个 cell 已枯竭（含资源 cell < 192）
2. 点击「补充资源 (恢复所有 Cell)」
3. 观察所有 cell：
   - 瞬间全部恢复为满密度亮绿
   - 无任何 cell 残留枯竭状态
4. 检查状态：
   - 含资源 cell = 192
   - 已枯竭 cell = 0
   - 脏 cell 数 = 0
   - 处理总数增加 192

**预期**: 符合期望 5 → 继续

### 边界/异常测试

1. **边界 cell 采集**：X=0, Y=0（左上角）→ 正确采集，相邻 cell (1,0) 和 (0,1) 不受影响
2. **极端速度采集**：自动采集速度设为「50ms」→ FPS 仍 >= 45
3. **全部枯竭**：让所有 192 cell 枯竭 → 全部显示为灰色，含资源=0
4. **全部恢复**：从全枯竭状态恢复 → 192 cell 全部恢复为满密度
5. **脏 cell 队列手动管理**：
   - 点击「采集一次」后立即点击「清空脏 Cell 队列」→ 脏 cell 数清零但精灵未更新
   - 再点击「处理全部脏 Cell」→ 上一次的脏 cell 已清除，无效果
6. **快速点击**：连续 10 次快速点击「采集一次」→ 无跳过更新，共处理 10 次

---

## 结果判定

- [ ] 期望 1 通过（单 cell 采集仅影响目标 cell）
- [ ] 期望 2 通过（密度逐步下降视觉渐变）
- [ ] 期望 3 通过（Cell 清空正确清除精灵）
- [ ] 期望 4 通过（批量采集性能稳定）
- [ ] 期望 5 通过（补充资源完整恢复）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 所有 5 项期望 + 边界测试全部通过 |
| **ACCEPTED WITH ISSUES** | 所有期望通过，但边界测试有 1-2 项异常（记录为 MINOR） |
| **REJECTED** | 任一期望未通过 → 记录具体差异，提交 issue |

---

## 技术背景

### 脏 Cell 增量更新流程（OpenRA ResourceRenderer 对照）

```
ResourceLayer.CellChanged(cell, resourceType)
  └→ ResourceRenderer._addDirtyCell(cell, resourceType)
      └→ _dirty.add(_cellKey(cell))       // HashSet<int>
         (仅当 resourceType 为空或属于此 renderer 时)

每帧 tickRender(wr, self):
  for each key in _dirty:
    cell = _keyToCell(key)
    if !isVisible(cell) → continue
    contents = resourceLayer.getResource(cell)
    if contents.density != renderContents[cell].density
      or contents.type != renderContents[cell].type:
        newContents = _createRenderCellContents(...)
        renderContents[cell] = newContents
        _updateRenderedSprite(cell, newContents)  // density→frame lerp
    _cleanDirty.push(cell)                 // Queue<CPos>
  while _cleanDirty.length > 0:
    _dirty.delete(_cellKey(_cleanDirty.shift()))
```

### 本测试页模拟的机制

| ResourceRenderer 概念 | 本测试页实现 |
|----------------------|-------------|
| `_dirty: Set<number>` | `dirtySet: Set<number>` |
| `_cellKey(cell) = (Y<<16) | X` | `cellKey(x, y) = (y<<16) | x` |
| `_cleanDirty: CPos[]` | `cleanDirtyQueue: number[]` |
| `tickRender()` | `processOneDirtyCell()` / `processAllDirtyCells()` |
| `_updateRenderedSprite()` | `updateParticle(index)` |
| `lerpFrame(0, length-1, density, maxDensity)` | `lerpFrame(0, 7, density, 10)` |
| `_spriteLayer.update(cell, seq, palette, frame)` | `particle.scaling` + `particle.color` 更新 |
| `_spriteLayer.clear(cell)` | density=0 → alpha=0.25, scale=0.12 |
