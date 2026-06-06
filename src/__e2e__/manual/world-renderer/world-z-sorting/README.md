# WorldRenderer - Y-Sort 排序验证

> **人工验收测试页**
> 模块: WorldRenderer (renderableZPositionComparisonKey)
> 测试ID: `world-renderer/world-z-sorting`
> OpenRA 对照: `WorldRenderer.ts` — `Z_key = Pos.Y + Pos.Z + ZOffset`
> 创建日期: 2026-06-06

---

## B. 期望结果

### 期望 1: 默认状态下 sortKey 越大越靠前

**操作**: 默认状态下观察 3 个精灵（A=红, B=绿, C=蓝）。

**观察点**: 精灵 C（蓝色，Y=1.0，sortKey=1.0）覆盖精灵 B（绿色，Y=0，sortKey=0），精灵 B 覆盖精灵 A（红色，Y=-1.0，sortKey=-1.0）。

**量化标准**: 绘制顺序 A→B→C，sortKey 最小的 A 在最后面。

### 期望 2: Y 偏移影响排序

**操作**: 调节 Y 偏移滑块使 A 移动到 B 之上。

**观察点**: 当 A 的 sortKey 超过 B 时，A 应显示在 B 前面。

### 期望 3: Z 高度和 ZOffset 影响排序

**操作**: 调整 Z 高度或 ZOffset 滑块。

**观察点**: sortKey 公式 `Y + Z + ZOffset` 中每个分量对最终排序的贡献相同。Z=0.3 的精灵会排在 Y=0 的精灵前面。

### 期望 4: FPS ≥ 55

---

## 结果判定

- [ ] 期望 1 通过
- [ ] 期望 2 通过
- [ ] 期望 3 通过
- [ ] 期望 4 通过

