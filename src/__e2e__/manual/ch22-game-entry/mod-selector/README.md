# Ch22 Game Entry - Mod 选择器首页

> **人工验收测试页**
> 模块: ModSelector (Mod 选择首页，纯 DOM)
> 测试ID: `ch22-game-entry/mod-selector`
> OpenRA 对照: `ModSelector.ts` — show(), createModCard(), launchMod(), hide()
> 创建日期: 2026-06-18

---

## 测试目标

本测试页面验证 Chapter 22 Phase A 的 Mod 选择器首页。ModSelector 是一个纯 DOM 组件（不依赖 Babylon.js），负责获取 `public/mods/_index.json` 并渲染 Mod 卡片网格。关键验证点包括：卡片渲染完整性、CSS 样式正确性、悬停动画效果、阵营标签、不可用 Mod 的视觉处理。

---

## B. 期望结果（可量化验收标准）

### 期望 1: 标题和副标题渲染

**观察点**: 页面加载后，Mod 选择器区域顶部应显示标题和副标题。

**量化标准**:
| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 标题文本 | "OpenRAWeb3D" | 精确匹配 |
| 标题字号 | 2.5rem (40px，基于浏览器默认字号 16px) | - |
| 标题颜色 | #f0f0f0 (白色) | - |
| 副标题文本 | "Select a mod to launch" | 精确匹配 |
| 副标题颜色 | #8888aa (灰紫色) | - |
| 渲染时间 | fetch 完成后 500ms 内完成 | ±200ms |

> **字号说明**: 2.5rem = 40px 基于浏览器默认根字号 16px。若用户在浏览器设置中修改了默认字号（如 20px），则实际渲染字号可能为 50px。测试前请确认浏览器默认字号为 16px。

### 期望 2: 4 张 Mod 卡片渲染

**观察点**: 卡网格应包含 4 张卡片，对应 RA、TD、D2K、TS。

**量化标准**:
| Mod ID | 标题 | 阵营标签 | Play 按钮 | Coming Soon 丝带 | 透明度 |
|--------|------|---------|-----------|-----------------|--------|
| ra | "Red Alert" | Soviet, Allies | 可见 (#4466cc) | 无 | 1.0 |
| td | "Tiberian Dawn" | GDI, Nod | 可见 (#4466cc) | 无 | 1.0 |
| d2k | "Dune 2000" | Atreides, Harkonnen, Ordos | 可见 (#4466cc) | 无 | 1.0 |
| ts | "Tiberian Sun" | GDI, Nod | 无 | 可见 (#cc8800, 45°) | 0.5 |

- Play 按钮文本必须包含 "Play →"
- Coming Soon 丝带位于卡片右上角，旋转 45°
- 阵营标签总计 9 个 (2+2+3+2)

### 期望 3: 悬停动画效果

**操作**: 鼠标悬停在可用卡片（RA、TD、D2K）上。

**量化标准**:
| 检查项 | 预期值 | 容差 |
|--------|--------|------|
| 上浮距离 | translateY(-3px) | - |
| 边框颜色变化 | #333355 → #5555aa | - |
| 过渡时间 | 200ms ease | - |
| box-shadow | 0 8px 24px rgba(0,0,0,0.4) | - |

### 期望 4: 不可用卡片行为

**操作**: 观察 Tiberian Sun 卡片。

**量化标准**:
| 检查项 | 预期值 |
|--------|--------|
| 透明度 | opacity: 0.5 |
| CSS class | `mod-card unavailable` |
| Play 按钮 | 不存在 (querySelector 返回 null) |
| 悬停动画 | 无（transform: none, border-color 不变, box-shadow: none） |
| 点击行为 | 无 Play 按钮可点击 |

### 期望 5: hide() 清理行为

**操作**: 点击 "隐藏 (测试 hide())" 按钮。

**量化标准**:
| 检查项 | 预期值 |
|--------|--------|
| 容器内容 | innerHTML === '' |
| 容器 display | ''（恢复默认） |
| loading-overlay display | 'none' |
| loading-bar width | '0%' |
| loading-text | 'Loading...' |

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch22-game-entry/mod-selector/`
2. 确认环境信息栏显示 "纯 DOM" 渲染引擎
3. 设置屏幕分辨率为 1920x1080（1x 缩放）

### 步骤一：确认基本渲染

1. 观察沙盒区域
2. 确认顶部显示 "OpenRAWeb3D" 标题
3. 确认 "Select a mod to launch" 副标题
4. 确认 4 张卡片以网格布局排列

**预期**: 符合期望 1+2 → 继续

### 步骤二：验证卡片内容

1. 检查每张卡片的标题、版本号、描述文本
2. 检查 Red Alert 卡片：显示 Soviet + Allies 标签
3. 检查 Tiberian Dawn 卡片：显示 GDI + Nod 标签
4. 检查 Dune 2000 卡片：显示 Atreides + Harkonnen + Ordos 标签
5. 检查 Tiberian Sun 卡片：显示 GDI + Nod 标签

**预期**: 符合期望 2 → 继续

### 步骤三：验证 Play 按钮

1. 确认 RA、TD、D2K 卡片右下角显示 "Play →" 按钮
2. 确认按钮颜色为蓝色 (#4466cc)
3. 鼠标悬停按钮 → 颜色应变暗 (#5577dd)
4. 点击 RA 的 "Play →" → 观察面板日志记录点击事件

**预期**: 符合期望 2 → 继续

### 步骤四：验证 Coming Soon 丝带

1. 确认 TS 卡片右上角有橙色 (#cc8800) 丝带
2. 确认丝带文本为 "COMING SOON"（全部大写）
3. 确认丝带旋转 45°

**预期**: 符合期望 4 → 继续

### 步骤五：验证悬停动画

1. 鼠标悬停在 Red Alert 卡片上
2. 观察卡片上浮动画（向上移动 3px）
3. 观察边框颜色从 #333355 变为 #5555aa
4. 观察 shadow 出现
5. 鼠标移开 → 卡片恢复原位（200ms 过渡）
6. 重复对 TD、D2K 卡片测试
7. 鼠标悬停 TS 卡片 → 应无动画变化

**预期**: 符合期望 3+4 → 继续

### 步骤六：验证 hide() 清理

1. 点击右侧面板 "隐藏 (测试 hide())" 按钮
2. 确认沙盒区域内容清空
3. 确认交互日志显示 "hide() 后容器内容为空"
4. 点击 "刷新 Mod 选择器" 恢复显示

**预期**: 符合期望 5 → 继续

### 边界/异常测试

1. **刷新测试**: 连续点击 "刷新 Mod 选择器" 5 次 → 无卡顿，每次都正确渲染
2. **Hide/Show 循环**: hide() → show() 循环 3 次 → 无残留 DOM
3. **快速悬停**: 在 4 张卡片间快速移动鼠标 → 动画跟随正常，无闪烁

---

## 结果判定

- [ ] 期望 1 通过（标题和副标题渲染正确）
- [ ] 期望 2 通过（4 张卡片，Play/丝带/阵营标签正确）
- [ ] 期望 3 通过（悬停动画效果正确）
- [ ] 期望 4 通过（TS 不可用卡片行为正确）
- [ ] 期望 5 通过（hide() 清理行为正确）

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部通过 |
| **REJECTED** | 任一期望未通过 |
| **环境异常** | dev server 未运行或 /mods/_index.json 获取失败（fetch 错误）→ 记录 UA/视口/时间，重新启动 dev server 后复测 |

**审核状态**: NEEDS FIXES → 等待 Reviewer 复审
