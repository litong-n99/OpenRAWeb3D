# Slider Control — Acceptance Test
**Module**: SliderWidget (Chapter 16 UI Widget Extensions)
**Test Case ID**: `ch16-widgets/slider-control`
**审核状态**: ⏳ 待审核

---

## 期望结果

### S1. Thumb Linear Mapping
| # | 期望 | 量化指标 |
|---|------|---------|
| S1.1 | Thumb X = trackWidth × (value-min)/(max-min) | 偏差 ≤2px |
| S1.2 | value=0 → thumb at left edge | X ≈ 0 |
| S1.3 | value=100 → thumb at right edge | X ≈ trackWidth |

### S2. Track Fill Width
| # | 期望 | 量化指标 |
|---|------|---------|
| S2.1 | Fill width = thumb position ±2px | `|fillWidth - thumbX| ≤ 2` |
| S2.2 | Fill 颜色 = #3a7bd5 (blue) | track 未填充部分 = #0f3460 |

### S3. Step Snap
| # | 期望 | 量化指标 |
|---|------|---------|
| S3.1 | 松开鼠标后 value snap to step | value = round(raw/step)*step |
| S3.2 | step=5 → values 始终为 5 的倍数 | 0,5,10,...,100 |

### S4. Bounds
| # | 期望 | 量化指标 |
|---|------|---------|
| S4.1 | 不能拖出左边界 | value ≥ min (0) |
| S4.2 | 不能拖出右边界 | value ≤ max (100) |

---

## 检验流程
1. 打开 `http://localhost:5173/test/ch16-widgets/slider-control/`
2. 拖拽 thumb → value 实时更新 (S1)
3. 观察 track fill 跟随 thumb (S2)
4. 松开 → value snap to step 5 (S3)
5. 尝试拖出边界 → 限制在 0-100 (S4)

- [ ] S1-S4 通过 → **ACCEPTED**
