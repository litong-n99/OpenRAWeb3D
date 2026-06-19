# Button States — Acceptance Test
**Module**: ButtonWidget (Chapter 16 UI Widget Extensions)
**Test Case ID**: `ch16-widgets/button-states`
**审核状态**: ⏳ 待审核

---

## 期望结果

### B1. Hover State
| # | 期望 | 量化指标 |
|---|------|---------|
| B1.1 | Hover 背景亮度增加 20% | `brightness(hoverBg)/brightness(defaultBg) ≈ 1.2 ±0.05` |
| B1.2 | Hover 时 border 颜色变亮 | border-color 从 #0f3460→#3a7bd5 |

### B2. Press State
| # | 期望 | 量化指标 |
|---|------|---------|
| B2.1 | Press 背景暗 20% | `brightness(pressBg)/brightness(defaultBg) ≈ 0.8 ±0.05` |
| B2.2 | Inset shadow 出现 | `box-shadow: inset 0 2px 4px` |

### B3. Disabled State
| # | 期望 | 量化指标 |
|---|------|---------|
| B3.1 | Disabled opacity 50% | `opacity: 0.5` |
| B3.2 | 点击事件被忽略 | `clickCount` 不变 |
| B3.3 | cursor: not-allowed | pointer 样式改变 |

### B4. Transition
| # | 期望 | 量化指标 |
|---|------|---------|
| B4.1 | 状态转换 ≤150ms | `transition: all .15s ease` |

---

## 检验流程
1. 打开 `http://localhost:5173/test/ch16-widgets/button-states/`
2. Hover "Hover Me" → 背景变亮 (B1)
3. Press "Press Me" → 背景变暗+inset shadow (B2)
4. Click "Disabled" → 无反应 (B3)
5. 点击 Default → clickCount++ (正常)

- [ ] B1-B4 通过 → **ACCEPTED**
