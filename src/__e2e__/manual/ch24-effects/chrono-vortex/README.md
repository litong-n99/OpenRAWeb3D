# ChronoVortexRenderable - 3D Spiral Billboard + ShaderMaterial

> **人工验收测试页**
> 模块: ChronoVortexRenderable + ChronoVortexShaderMaterial (Ch24 Phase C Vortex Polish)
> 测试ID: `ch24-effects/chrono-vortex`
> OpenRA 对照: `ChronoVortexRenderable.cs` (OpenRA.Mods.Cnc/Graphics)
> 创建日期: 2026-06-20

---

## 测试目标

验证 ChronoVortexRenderable 在 Ch24 Phase C 完成 Vortex 3D Polish 后的核心渲染路径:

1. **Billboard + BILLBOARDMODE_ALL**: 涡旋平面始终面向摄像机
2. **ChronoVortexShaderMaterial**: 程序化螺旋片段着色器 (atan2 + radius distortion + outer glow ring)
3. **tickUpdate(tickCount)**: 基于游戏 tick 的动画计时 (tickCount * 0.04 = seconds)
4. **Progress fade (0→1)**: Frame 0 (完全可见) → Frame 47 (完全淡出)
5. **renderingGroupId = 1**: Billboard 渲染分组为 RenderGroup.Actor
6. **dispose() 生命周期**: 正确清理 billboard mesh + shader material

---

## B. 期望结果（可量化验收标准）

### 期望 1: Spiral Billboard 可见 (非空白/非品红)

**操作**: 页面加载后，观察场景中央（世界原点 cross-hair 处）。

**观察点**:
- 在场景原点 (0, 0, 0) 出现一个**青色螺旋涡旋**效果
- 涡旋不应为空白（完全透明）或品红色（fallback 错误）
- 螺旋从中心向外辐射，可见清晰的多条螺旋臂
- 涡旋中心最亮，边缘逐渐变暗（径向衰减）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Billboard 存在 | 场景中可见 64x64 world-unit 涡旋平面 | 肉眼可见螺旋图案 |
| 螺旋颜色 | 青色 (#33CCFF)，中心明亮 | R 通道 < G 通道 < B 通道 |
| 螺旋臂数 | 可见 3+ 条从中心辐射的螺旋臂 | 旋转时螺旋臂清晰可辨 |
| 外环光晕 | 距离中心约 0.4 半径处有光环 | 肉眼可见外环 |

### 期望 2: Billboard 始终面向摄像机 (BILLBOARDMODE_ALL)

**操作**: 鼠标拖拽旋转摄像机，围绕涡旋从不同角度观察。

**观察点**:
- 涡旋平面**始终正面朝向摄像机**，不会出现侧面（细线）视角
- 无论从上方、下方、左侧、右侧观察，螺旋图案保持圆形不变
- 与地面的 reference grid 对比：grid 在侧面观察时变细，但涡旋保持正面

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| BILLBOARDMODE_ALL | 控件面板显示 BILLBOARDMODE_ALL (7) | 确认为 7 |
| 全角度正面 | 摄像机在 4 个象限旋转均看到完整圆形涡旋 | 无侧面视角 |
| 与 ground plane 对比 | ground plane 侧面变窄，vortex 不变 | 行为差异明显 |

### 期望 3: 螺旋旋转动画 (tickUpdate)

**操作**: 确保播放按钮处于激活状态，观察涡旋转动。

**观察点**:
- 螺旋持续旋转（着色器中 `angle = atan(centered.y, centered.x) + u_time * 3.0`）
- 暂停时螺旋冻结在当前角度
- 恢复播放后螺旋从冻结位置继续旋转
- 涡旋应在 25 ticks/s 速率下平滑旋转，无跳跃/闪烁

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 旋转连续性 | 2 秒内完成约 0.96 圈 (3.0 rad/s * 2s / 2pi) | 约 1 圈 |
| 暂停冻结 | 点击暂停后螺旋角度不再变化 | 无持续旋转 |
| 恢复继续 | 再次播放后从冻结角度继续 | 无跳变 |
| 速度一致性 | 1.0x 速度下旋转速率恒定 | 无加速/减速波动 |

### 期望 4: Progress 淡出效果 (0→1 生命周期)

**操作**: 开启「自动循环」开关，观察涡旋从 Frame 0 到 Frame 47 的完整生命周期。

**观察点**:
- Frame 0 (Progress = 0.00): 涡旋完全不透明，可见完整的螺旋 + 外环光晕
- Frame 23 (Progress ≈ 0.49): 涡旋半透明，螺旋臂变淡但仍可见
- Frame 47 (Progress = 1.00): 涡旋**完全不可见**（alpha 降至 0）
- 淡出过程平滑，无突兀的透明度跳变

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Frame 0 不透明度 | 螺旋完全不透明，清晰可见 | 肉眼判定无透明 |
| Frame 23 半透明 | 螺旋约 50% 透明度，背后参考网格可见 | 肉眼判定半透明 |
| Frame 47 完全透明 | 涡旋完全不可见 (alpha=0) | 肉眼不可见 |
| 淡出平滑度 | 从 0→47 无跳变 | 连续淡出 |

### 期望 5: renderingGroupId = 1

**操作**: 观察控件面板中 renderingGroupId 显示。

**观察点**:
- 控件面板显示 `renderingGroupId: 1`
- 涡旋在场景中正常可见（renderingGroupId=1 在默认渲染范围内）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| renderingGroupId | 1 | 控件面板确认为 1 |
| 可见性 | 涡旋正常渲染 | 非 invisible |

### 期望 6: 颜色切换

**操作**: 使用「涡旋颜色」下拉菜单切换不同颜色预设。

**观察点**:
- 青色 (Cyan): 涡旋呈蓝青色 (#33CCFF)
- 紫色 (Purple): 涡旋呈紫色 (#CC44FF)
- 橙色 (Orange): 涡旋呈橙色 (#FF8833)
- 绿色 (Green): 涡旋呈绿色 (#33FF88)
- 红色 (Red): 涡旋呈红色 (#FF3344)
- 切换颜色后立即生效，无延迟

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 5 种预设 | 每种颜色切换后涡旋呈现对应色调 | 肉眼判定正确 |
| 切换延迟 | < 100ms 内颜色更新 | 即时响应 |

### 期望 7: Dispose / Recreate 生命周期

**操作**: 点击「Dispose」按钮，观察涡旋消失；再点击「Recreate」按钮。

**观察点**:
- Dispose 后涡旋立即从场景中消失
- 控件面板显示所有状态为 "-"（无 billboard 存在）
- Recreate 后涡旋重新出现，从 Frame 0 开始
- 动画从 tickCount=0 重新开始计时
- 无内存泄漏（DevTools Performance Monitor 中 GPU memory 稳定）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| Dispose 消失 | 点击后涡旋立即消失 | < 1 frame 延迟 |
| Recreate 恢复 | 点击后立即重新出现 | < 1 frame 延迟 |
| 动画重置 | tick 从 0 重新累积 | 控件显示 tick=0 |
| 颜色保持 | Recreate 后保持当前选中的颜色预设 | 颜色不变 |

---

## 检验流程

### 准备工作

1. 打开测试页面: `http://localhost:5173/test/ch24-effects/chrono-vortex/`
2. 确认环境信息栏显示 WebGL 2.0 引擎（或更高版本）
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 启动 dev server: `npm run dev`

### 步骤一: 验证螺旋 Billboard 可见性 (期望 1)

- 页面加载后观察场景中央
- 确认原点 cross-hair 处出现青色螺旋涡旋
- 涡旋应为圆形，有 3+ 条螺旋臂从中心辐射
- 预期: ✅ 清晰可见的青色螺旋涡旋图案 (非空白、非品红)

### 步骤二: 验证 Billboard 始终面向摄像机 (期望 2)

- 鼠标左键拖拽，绕涡旋转动摄像机
- 从上方 (beta ≈ 80°)、下方 (beta ≈ 10°)、左侧、右侧观察
- 注意涡旋始终是完整的圆形，不会变成细线
- 对比地面参考网格在不同角度下的变化
- 预期: ✅ 涡旋在所有角度都保持正面圆形

### 步骤三: 验证螺旋旋转动画 (期望 3)

- 保持默认播放状态 (1.0x 速度)
- 观察 2 秒，确认螺旋持续旋转 (约完成 1 圈)
- 点击「暂停」按钮 → 螺旋应立即停止旋转
- 点击「播放」按钮 → 螺旋应从停止位置继续旋转
- 调整速度滑块到 5.0x → 旋转明显加快
- 调整速度滑块到 0.1x → 旋转明显变慢
- 预期: ✅ 播放/暂停/变速工作正常

### 步骤四: 验证 Progress 淡出效果 (期望 4)

- 开启「自动循环」开关
- 观察涡旋从 Frame 0 (完全可见) 渐变到 Frame 47 (完全透明)
- 循环间隔默认 25 tick → 可调到 60 tick 以便更慢观察
- Frame 0: 涡旋完全可见
- Frame ~23: 涡旋约 50% 可见
- Frame 47: 涡旋完全不可见
- 预期: ✅ 淡出平滑连续，帧 47 完全隐形

### 步骤五: 验证 renderingGroupId (期望 5)

- 观察控件面板 C3 区域
- 确认 `renderingGroupId: 1`
- 确认 `BillboardMode: BILLBOARDMODE_ALL (7)`
- 确认 `Alpha Blending: enabled`
- 确认 `BackFace Culling: false (disabled)`
- 预期: ✅ 所有状态值符合预期

### 步骤六: 验证颜色切换 (期望 6)

- 依次选择 5 种颜色预设
- 每次选择后观察涡旋颜色变化
- 切换回青色 (Cyan)
- 预期: ✅ 每种颜色正确渲染，切换即时

### 步骤七: 验证 Dispose / Recreate (期望 7)

- 点击「Dispose」按钮
- 涡旋立即消失，所有状态显示 "-"
- 点击「Recreate」按钮
- 涡旋重新出现，从 Frame 0 青色开始
- 动画重新开始计时 (tick=0)
- 预期: ✅ 销毁/重建周期正常

### 边界测试

- **极速测试**: 速度 5.0x + TPF 60 → 极高 tick 累积速率，螺旋应快速旋转但不崩溃
- **Frame 0 到 47 手动手拖拽**: 拖动 Frame 滑块从 0 到 47 → 涡旋从完全可见平滑过渡到完全透明
- **F5 刷新**: 刷新页面后涡旋从 Frame 0 青色重新开始
- **Dispose 后操作**: Dispose 后拖拽 Frame 滑块应无效果 → 验证安全检查

### 结果判定

- [ ] 所有 7 项期望通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异和截图, 提交 issue
- [ ] 测试环境异常 → 记录 UA / 视口 / 引擎 / FPS 信息

---

## 技术备注

### ChronoVortexShaderMaterial 着色器分析

片段着色器包含以下阶段:

1. **atan2 角度计算**: `atan(centered.y, centered.x)` — 计算当前像素相对于 UV 中心的角度
2. **旋转**: `+ u_time * 3.0` — 随时间旋转螺旋 (3.0 rad/s)
3. **螺旋图案**: `sin(dist * 20.0 - angle * 3.0 + u_time * 5.0)` — 距离调制 + 角度调制 + 时间调制生成螺旋臂
4. **径向衰减**: `1.0 - smoothstep(0.0, 0.5, dist)` — 中心最亮，边缘渐暗
5. **外环光晕**: `smoothstep(0.35, 0.45, dist) * (1.0 - smoothstep(0.45, 0.5, dist))` — 在约 0.4 半径处生成光环
6. **生命周期淡出**: `1.0 - u_progress` — 随 vortex 生命周期从 1→0 线性淡出
7. **颜色/Alpha**: `vec4(vortexColor, alpha)` — 输出带透明度的颜色

### tickUpdate 计时机制

- `tickUpdate(tickCount)` 设置 `_elapsedTime = tickCount * 0.04` (25 ticks/s)
- 如果从不调用 tickUpdate，render3D 会使用 `_elapsedTime += 1/60` 作为降级方案 (假设 60fps)
- 推荐始终使用 tickUpdate 以获得与游戏逻辑同步的时间

### Billboard 属性

- `billboardMode = BILLBOARDMODE_ALL (7)`: 在所有轴上始终面向摄像机
- `isPickable = false`: 不影响射线拾取
- `renderingGroupId = 1 (RenderGroup.Actor)`: 与其他 Actor/特效共享渲染层
- 尺寸: 64 x 64 world units (在 RTS 正交摄像机下合适，可调整摄像机距离时可能需要动态缩放)

### 坐标系说明

- WPos 使用 1024 子格单位 = 1 cell
- 涡旋位于 WPos(0, 0, 0) = 世界原点
- Billboard 位置直接使用 WPos 的 X/Y/Z 坐标，通过 `billboard.position.set(pos.X, pos.Y, pos.Z)` 设置
- 无需 CoordinateTransformer 转换（涡旋在 3D 模式下直接使用世界坐标）

---
| 审核状态 | 审核人 | 审核日期 | 审核结果 |
|---------|--------|---------|---------|
| PENDING | - | - | - |
