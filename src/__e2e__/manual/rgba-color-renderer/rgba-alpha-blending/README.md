# RgbaColorRenderer - 预乘 Alpha 混合验证

> **人工验收测试页**
> 模块: RgbaColorRenderer (premultiplyAlpha(), ALPHA_PREMULTIPLIED)
> 测试ID: `rgba-color-renderer/rgba-alpha-blending`
> OpenRA 对照: `RgbaColorRenderer.ts` — `premultiplyAlpha()`, `vertexWithColor()`, `ALPHA_PREMULTIPLIED`
> 创建日期: 2026-06-06

---

## B. 期望结果

### 期望 1: 半透明条正确重叠

**操作**: 默认状态（alpha=1.0），观察三色重叠条。

**观察点**: 红色、绿色、蓝色三个垂直条，每条约 35% 宽度重叠。
- 红-绿重叠区域应呈现黄色混合（而非纯红或纯绿）
- 绿-蓝重叠区域应呈现青色混合
- 重叠区域边界平滑，无硬边

### 期望 2: 全局透明度衰减正确

**操作**: 拖动「全局透明度」滑块从 1.00 到 0.50。

**观察点**: 所有三个条同步变透明。
- alpha=0.5：颜色条半透明，背景可见
- alpha=0.0：颜色条完全不可见
- alpha=1.0：颜色条完全不透明

**量化标准**: alpha=0.5 时，重叠区域的最终颜色约为 alpha=1.0 时的一半亮度。

### 期望 3: 颜色切换即时响应

**操作**: 修改颜色选择器并点击「应用颜色」。

**量化标准**: 颜色变更在 **50ms 内** 完成渲染更新。

### 期望 4: FPS ≥ 55

---

## 结果判定

- [ ] 期望 1 通过（重叠区域颜色混合正确）
- [ ] 期望 2 通过（透明度衰减正确）
- [ ] 期望 3 通过（颜色切换即时响应）
- [ ] 期望 4 通过（FPS ≥ 55）

