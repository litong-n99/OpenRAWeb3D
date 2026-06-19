# Dropdown Menu — Acceptance Test
**Module**: DropDownWidget (Chapter 16 UI Widget Extensions)
**Test Case ID**: `ch16-widgets/dropdown-menu`
**审核状态**: ⏳ 待审核

---

## 期望结果

### D1. Open/Close Animation
| # | 期望 | 量化指标 |
|---|------|---------|
| D1.1 | 打开动画 ≤200ms | `transition: max-height .2s` |
| D1.2 | 箭头旋转 180° on open | `.arrow { transform: rotate(180deg) }` |

### D2. Item Selection
| # | 期望 | 量化指标 |
|---|------|---------|
| D2.1 | 选中项 ≤1 frame 更新显示 | label 立即更新为选中项文本 |
| D2.2 | 选中项有 `.selected` 样式 | background=#0f3460, color=#7ec8e3 |

### D3. Hover Highlight
| # | 期望 | 量化指标 |
|---|------|---------|
| D3.1 | Hover 背景 ≠ 默认背景 | hover=#254060 vs default=#1a1a2e |
| D3.2 | Hover 后移出恢复 | 离开 item 后背景复原 |

### D4. Outside Click Close
| # | 期望 | 量化指标 |
|---|------|---------|
| D4.1 | 点击 dropdown 外部 → 关闭 | `isMenuOpen()===false` |
| D4.2 | 点击 toggle 不触发 document click | stopPropagation 正确 |

### D5. Scroll on Overflow
| # | 期望 | 量化指标 |
|---|------|---------|
| D5.1 | 8 项超过 max-height → 滚动条 | `overflow-y:auto` 激活 |
| D5.2 | max-height=200px, scrollHeight > 200px | `getMenuHeight() > 200` |

---

## 检验流程
1. 打开 `http://localhost:5173/test/ch16-widgets/dropdown-menu/`
2. 点击 toggle → 菜单展开 (D1)
3. 点击 Option Gamma → 选中+关闭 (D2)
4. 再次打开 → hover items (D3)
5. 点击外部空白 → 关闭 (D4)
6. 滚动 8 项列表 (D5)

- [ ] D1-D5 通过 → **ACCEPTED**
