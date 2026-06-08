# WorldRenderer - renderingGroupId 分层渲染验证

> **人工验收测试页**
> 模块: WorldRenderer (RenderGroup 枚举 + renderingGroupId 分层)
> 测试ID: `world-renderer/world-layer-ordering`
> OpenRA 对照: `WorldRenderer.ts` — RenderGroup.Terrain(0), Actor(1), Overlay(2), Annotation(3)
> 创建日期: 2026-06-06
> 最后更新: 2026-06-08

---

## B. 期望结果

### 期望 1: 层级顺序 terrain < actor < overlay < annotation

**操作**: 观察 4 层重叠圆形。

**观察点**: 当所有图层都显示时，重叠区域的层级为:
- Annotation (3, 红色) 在最前 → 覆盖所有其他层
- Overlay (2, 蓝色) 在前 → 覆盖 Terrain 和 Actor
- Actor (1, 橙色) 在中 → 覆盖 Terrain
- Terrain (0, 绿色) 在最后 → 被所有层覆盖

**量化标准**: 无论圆的 3D Z 位置如何，renderingGroupId 高的始终在上。即使 Terrain 的 3D Z 设置为更靠前，也会被更高 groupId 的层覆盖。

### 期望 2: 图层独立可见性切换即时

**操作**: 取消勾选某层的复选框。

**量化标准**: 该层的所有圆在 **50ms 内** 完全消失。重新勾选后在 50ms 内恢复。

### 期望 3: 偏移时层级关系维持

**操作**: 拖动「重叠圆 X 偏移」滑块改变圆的位置。

**观察点**: 即使圆的 3D 位置发生交叉，renderingGroupId 顺序保持不变。

### 期望 4: FPS ≥ 55

---

## 结果判定

- [x] 期望 1 通过（层级顺序 terrain < actor < overlay < annotation）
- [x] 期望 2 通过（图层独立可见性切换即时）
- [x] 期望 3 通过（偏移时层级关系维持）
- [x] 期望 4 通过（FPS >= 55）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部通过 ✅ |
| ~~ACCEPTED WITH ISSUES~~ | 所有期望通过，边界测试有 1-2 项异常 |
| ~~REJECTED~~ | 任一期望未通过 |

