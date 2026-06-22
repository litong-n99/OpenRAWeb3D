# WorldRenderer - Y-Sort 排序验证

> **人工验收测试页**
> 模块: WorldRenderer (renderableZPositionComparisonKey)
> 测试ID: `world-renderer/world-z-sorting`
> OpenRA 对照: `WorldRenderer.ts` — `Z_key = Pos.Y + Pos.Z + ZOffset`
> 创建日期: 2026-06-06
> 最后更新: 2026-06-08

---

## B. 期望结果

### 期望 1: 默认状态下 sortKey 越大越靠前

**操作**: 默认状态下观察 3 个精灵（A=红, B=绿, C=蓝）。

**观察点**: 精灵 C（蓝色，Y=1.0，sortKey=1.0）覆盖精灵 B（绿色，Y=0，sortKey=0），精灵 B 覆盖精灵 A（红色，Y=-1.0，sortKey=-1.0）。

**量化标准**: 绘制顺序 A→B→C，sortKey 最小的 A 在最后面。

### 期望 2: Y 偏移影响视觉位置，排序键随之更新

**操作**: 拖动 Y 偏移滑块改变所有精灵的 Y 坐标。

**观察点**: 三个精灵在屏幕上同步上下移动，右侧「排序结果」面板中的
sortKey 值随 Y 偏移实时更新。公式 `Z_key = Pos.Y + Pos.Z + ZOffset` 中
Y 分量与 Z/ZOffset 分量等权重贡献。

**量化标准**: sortKey 变化量 = Y 偏移变化量（如 Y +0.1 → 每个精灵 sortKey +0.1）。
三个精灵的相对顺序（A < B < C）保持不变，因为它们的 Y 基础值间距固定。

### 期望 3: Z 高度和 ZOffset 以等权重影响排序键

**操作**: 分别调整 Z 高度和 ZOffset 滑块，观察右侧 sortKey 数值。

**观察点**: sortKey 公式 `Y + Z + ZOffset` 中，Z 和 ZOffset 对最终排序键的
贡献与 Y 完全相同（1:1 权重）。例如 Z +0.1 与 Y +0.1 使 sortKey 增加相同的量。

注：当前 Z/ZOffset 为全局参数（同时作用于 A、B、C），因此无法在同一页面中直接
构造"Z=0.3 vs Y=0"的精灵对比。Z 分量等权贡献通过 sortKey 数值变化间接验证。

### 期望 4: FPS ≥ 55

---

## 结果判定

- [x] 期望 1 通过
- [x] 期望 2 通过
- [x] 期望 3 通过
- [x] 期望 4 通过

| 判定 | 日期 |
|--------|------------|
| **ACCEPTED** | 2026-06-08 |

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-22, 6/6 通过, 100%)

