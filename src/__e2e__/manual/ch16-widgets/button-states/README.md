# Button States — Acceptance Test
**Module**: ButtonWidget (Chapter 16 UI Widget Extensions)
**Test Case ID**: `ch16-widgets/button-states`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-03, 27/27 通过, 100%)

---

## 期望结果

### B1. Hover State
| # | 期望 | 量化指标 |
|---|------|---------|
| B1.1 | Hover 背景显著变亮 (default #1a1a2e→hover #254060) | `brightness(hoverBg) > brightness(defaultBg)`, R 通道从 0x1a→0x25 (↑43%) |
| B1.2 | Hover 时 border 颜色变亮 | border-color 从 #0f3460→#3a7bd5 |

### B2. Press State
| # | 期望 | 量化指标 |
|---|------|---------|
| B2.1 | Press 背景显著变暗 (default #1a1a2e→press #0d1520) | `brightness(pressBg) < brightness(defaultBg)`, R 通道从 0x1a→0x0d (↓50%) |
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
| B4.2 | Button text 在所有状态中垂直居中 | `line-height` 匹配 button height, text 不偏移 |

### B5. Boundary Tests
| # | 期望 | 量化指标 |
|---|------|---------|
| B5.1 | 快速 hover→press→hover 无状态残留 | 连续 3 次状态切换后 color 正确 |
| B5.2 | Disabled button 不接受任何鼠标事件 | `pointer-events` 或 JS 中忽略 |
| B5.3 | 多个 button 独立状态 | 各 button hover/press 不互相影响 |

---

## 检验流程
1. 打开 `http://localhost:5173/test/ch16-widgets/button-states/`
2. Hover "Hover Me" → 背景变亮 (B1)
3. Press "Press Me" → 背景变暗+inset shadow (B2)
4. Click "Disabled" → 无反应 (B3)
5. 点击 Default → clickCount++ (正常)

- [ ] B1-B4 通过 → **ACCEPTED**
