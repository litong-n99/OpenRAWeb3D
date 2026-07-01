# Rally Point — Acceptance Test

**Module**: RallyPoint (Chapter 11 Production & Building)
**Test Case ID**: `ch11-production/rally-point`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Buildings/RallyPoint.ts`
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Buildings/RallyPoint.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-02, 13/13 通过, 100%)

---

## 期望结果

### R1. Flag at Target Cell Center

| # | 期望 | 量化指标 |
|---|------|---------|
| R1.1 | Rally flag 出现在目标 cell center | `getRallyPosition()` 偏差 ≤ 0.1 world units |
| R1.2 | 点击空 cell 将 rally point 移至新位置 | flag position 在 1 tick 内更新 |
| R1.3 | Multi-rally 每个 slot 独立 flag | `getRallyFlags().length === slotCount` |

### R2. Dashed Line from Building Exit to Rally Flag

| # | 期望 | 量化指标 |
|---|------|---------|
| R2.1 | 虚线从 building exit 连到 rally flag | `getRallyLine()` 返回两个端点 (±0.05wu) |
| R2.2 | 线在 rally point 变化后 ≤1 frame 更新 | 位置变化后下一帧线端点更新 |
| R2.3 | 虚线视觉样式: 短划间隔 | visible dash pattern, alpha ≥ 0.5 |

### R3. Flag Animation

| # | 期望 | 量化指标 |
|---|------|---------|
| R3.1 | Flag 上下浮动动画 ≥15 distinct positions/s | bob 周期 ≥30fps 渲染 |
| R3.2 | 动画在 flag 可见时持续播放 | 无间断、无暂停 |

### R4. Multi-Rally Per-Slot Numbered Flags

| # | 期望 | 量化指标 |
|---|------|---------|
| R4.1 | 每个 slot 显示编号 label | flags numbered 1..N |
| R4.2 | 不同 slot 有区分颜色 | slot 0=cyan, slot 1=yellow, slot 2=magenta |
| R4.3 | `clearRallyPoint()` 清除指定 flag | flag 从场景移除，线消失 |

### R5. Line Updates Within 1 Frame

| # | 期望 | 量化指标 |
|---|------|---------|
| R5.1 | Rally point 移动后线在 ≤1 frame (50ms) 更新 | 视觉延迟不可察觉 |
| R5.2 | 快速连续移动 rally point 无闪烁 | 连续 5 次移动，线始终连接正确 |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch11-production/rally-point/`
2. **步骤一**: 点击 ground 设置 rally point → flag 出现 (R1.1)
3. **步骤二**: 观察虚线连接 building exit → flag (R2)
4. **步骤三**: 添加多个 rally slot → 编号旗 + 不同颜色 (R4)
5. **步骤四**: 移动 rally point → 线即时更新 (R5)
6. **边界**: 快速连续点击 5 次 → 无闪烁

- [x] R1-R5 通过 → **ACCEPTED**

## Test Harness API

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `setRallyPoint(slot, cell)` | void | 设置 rally point |
| `getRallyPosition(slot)` | `{x,y,z}` | 获取 flag 3D 位置 |
| `getRallyLine(slot)` | `{from,to}` | 获取线端点 |
| `getRallyFlags()` | `[{slot,position,color}]` | 所有 flags |
| `clearRallyPoint(slot?)` | void | 清除 flag |
| `reset()` | void | 重置全部 |
