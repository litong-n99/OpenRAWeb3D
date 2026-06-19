# Widget Layout — Acceptance Test

**Module**: Widget + WidgetLoader (Chapter 5 Phase D)
**Test Case ID**: `ch05-ui/widget-layout`
**OpenRA Source**: `OpenRA.Game/Widgets/Widget.ts`, `OpenRA.Game/Widgets/WidgetLoader.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果

### L1. Child Bounds Clipped to Parent

| # | 期望 | 量化指标 |
|---|------|---------|
| L1.1 | child widget bounds 不超出 parent | `getWidgetBounds(child)` 的 x+w ≤ parent x+width, y+h ≤ parent y+height |
| L1.2 | parent padding 正确缩减 content area | child 起始 offset = parent padding 值 |

### L2. Padding Reduces Content Area

| # | 期望 | 量化指标 |
|---|------|---------|
| L2.1 | `getComputedPadding()` 返回配置值 | 配置 padding=15 → 返回值 15 ±0px |
| L2.2 | 不同 widget 独立 padding | root=15, childA=10, childB=10 |

### L3. Z-Order Render Correct

| # | 期望 | 量化指标 |
|---|------|---------|
| L3.1 | 高 zIndex widget 渲染在上层 | `getWidgetZOrder()` 大者视觉在上 |
| L3.2 | Bring to Top 改变 zOrder | childB zIndex 变为 999 |

### L4. Center Alignment

| # | 期望 | 量化指标 |
|---|------|---------|
| L4.1 | center-aligned widget 在 parent 中居中 | `abs(child.x + child.w/2 - parent.w/2) < 2px` |
| L4.2 | 点击 Align 后位置修正 | child 位置 x 从 300 调整至 parent 水平居中 |

### L5. Depth 5 No Clipping Artifacts

| # | 期望 | 量化指标 |
|---|------|---------|
| L5.1 | 5 层嵌套全部渲染可见 | `getWidgetCount() === 8` (tree5) |
| L5.2 | 最深层 child (l4) 正确嵌套 | parent chain: l4→l3a→l2a→l1a→root |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch05-ui/widget-layout/`
2. 点击 Tree Depth 3 → 3 个 widgets 正确嵌套 (L1)
3. 点击 Bring Child #2 to Top → childB 在上层 (L3.2)
4. 点击 Align: Center → child 居中 (L4)
5. 点击 Tree Depth 5 → 8 widgets 无 clipping (L5)

- [ ] L1-L5 通过 → **ACCEPTED**
