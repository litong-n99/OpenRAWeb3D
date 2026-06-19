# Chrome Theme — Acceptance Test

**Module**: ChromeProvider + ChromeMetrics (Chapter 5 Phase D)
**Test Case ID**: `ch05-ui/chrome-theme`
**OpenRA Source**: `OpenRA.Game/Graphics/ChromeProvider.ts`, `OpenRA.Game/Widgets/ChromeMetrics.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果

### C1. Panel Border Matches ChromeMetrics

| # | 期望 | 量化指标 |
|---|------|---------|
| C1.1 | Panel border 颜色 = theme 配置值 | `getPanelStyle().border` 匹配 theme (`ra=#0f3460`) |
| C1.2 | Header 背景色 = theme headerBg | `getPanelStyle().headerBg` 匹配 (`ra=#16213e`) |
| C1.3 | Panel body 背景色 = theme panelBg | `#2B2B2B` for RA, `#2B2000` for CNC |

### C2. Button State Colors

| # | 期望 | 量化指标 |
|---|------|---------|
| C2.1 | Hover: 背景亮度增加 20% | `getButtonStyle('hover')` R 通道 ≈ normal×1.2 |
| C2.2 | Press: 背景暗 20% | `getButtonStyle('press')` R 通道 ≈ normal×0.8 |
| C2.3 | Disabled: opacity 45% | btn:disabled { opacity: 0.45 } |

### C3. Scrollbar Proportional

| # | 期望 | 量化指标 |
|---|------|---------|
| C3.1 | Thumb 大小 proportional to content | `getScrollbarStyle().thumbRatio ≈ clientH/scrollH` |
| C3.2 | RA scrollbar: track #1a1a2e, thumb #0f3460 | color match |

### C4. Theme Switch Within 1 Frame

| # | 期望 | 量化指标 |
|---|------|---------|
| C4.1 | `loadTheme('cnc')` 立即更新所有样式 | panel+border+button+scrollbar 同步变化 |
| C4.2 | 切换到 D2K theme: desert palette | border=#8B4513, text=#DEB887 |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch05-ui/chrome-theme/`
2. 观察默认 RA theme → panel #2B2B2B, border #0f3460 (C1)
3. Hover Primary button → 背景变亮 20% (C2.1)
4. 切换到 CNC → gold/brown 主题 (C4)
5. 切换到 D2K → desert 主题 (C4.2)
6. 滚动 scroll demo → thumb proportional (C3)

- [ ] C1-C4 通过 → **ACCEPTED**
