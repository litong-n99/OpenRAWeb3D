# Ch25 Actor Visibility Toggle 3D — Acceptance Test

> **人工验收测试页**
> 模块: Ch25 Fog Visibility Trait Integration (mesh.setEnabled / detection pulse)
> 测试ID: `ch25-shroud/actor-visibility`
> OpenRA 对照: `HiddenUnderShroud.cs`, `HiddenUnderFog.cs`, `Cloak.ts` (DetectCloaked)
> 创建日期: 2026-06-20

---

## 对应模块

| 文件 | 功能 | 验证点 |
|------|------|--------|
| `HiddenUnderShroud.ts` | `_setActorMeshVisibility()`, `modifyRender()` | mesh.setEnabled(false) 隐藏 / mesh.setEnabled(true) 恢复 |
| `Cloak.ts` | `_applyDetectionPulse()`, `_isDetectedByAnyEnemy()` | emissiveColor 白色脉冲，持续 5 ticks |

## 测试目标

验证 Ch25 Phase C 的 Fog Visibility Trait Integration:

1. **Mesh Visibility Toggle**: Actor 在雾/Shroud 边界进出时，通过 `mesh.setEnabled()` 正确隐藏/显示
2. **Detection Pulse**: Cloak 被 `DetectCloaked` 发现时的白色闪烁效果 (emissiveColor 脉冲)
3. **独立 Actor 控制**: 各 Actor 的 visibility / pulse 状态互不干扰
4. **位置保持**: setEnabled 切换后 mesh 位置/朝向不变

---

## B. 期望结果（可量化验收标准）

### 期望 1: Mesh Visibility Toggle (Actor B)

**操作**: 点击 "Toggle Actor B Visibility" 按钮。

**观察点**:
- 首次点击: 蓝色方块 Actor B（位置原点）**立即从场景中消失**（连同其下方支柱）
- 红色 Actor A 和绿色 Actor C 保持可见不变
- 再次点击: 蓝色方块**立即重新出现**，位置保持不变（原点 (0, 0, 0)）
- 消失/出现对场景中其他元素无影响（无闪烁、无重排）

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 隐藏延迟 | 点击后 < 1 帧 (~16ms) 内蓝色方块消失 | 肉眼即时 |
| 恢复延迟 | 再次点击后 < 1 帧内蓝色方块重现 | 肉眼即时 |
| 位置保持 | 恢复后蓝色方块精确位于原点 (0, 0, 0) | 无位置跳变 |
| 独立控制 | Actor A (红色) 和 Actor C (绿色) 保持渲染不变 | 无干扰 |
| 状态显示 | C2 面板 "Actor B" 行显示对应状态 | `Visible (setEnabled=true)` / `Hidden (setEnabled=false)` |

### 期望 2: Detection Pulse on Actor C (Cloaked)

**操作**: 点击 "Trigger Detection Pulse on Actor C" 按钮。

**观察点**:
- 点击后绿色方块 Actor C **立即发出白色闪光**（emissiveColor 从 (0,0,0) 变为 (~0.8,0.8,0.8)）
- 白色闪光持续显示（5 个 tick = 5 秒，tick 间隔 1000ms）
- 5 秒后白色闪光消失，绿色方块恢复正常的半透明外观（alpha=0.5 的绿色）
- 脉冲期间 Actor A (红色) 和 Actor B (蓝色) 不受影响

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 脉冲启动 | 点击按钮后 emissiveColor 立即变为 (0.80, 0.80, 0.80) | C3 面板确认数值 |
| 脉冲持续时间 | 白色闪光持续恰好 5 个 tick (5 秒) | 肉眼观察 5 秒后消失 |
| 脉冲结束 | emissiveColor 恢复为 (0.00, 0.00, 0.00) | C3 面板确认数值 |
| 脉冲期间独立 | Actor A 和 B 的视觉效果不变化 | 无污染 |
| 状态显示 | C2 面板 "Actor C" 行显示 "DETECTED!" 及剩余 tick 数 | 文本含 "DETECTED!" |

### 期望 3: Re-trigger During Active Pulse

**操作**: 在脉冲进行中再次点击 "Trigger Detection Pulse on Actor C"。

**观察点**:
- 脉冲计数器重置为 5（不是叠加到更长的时间）
- 白色闪光继续显示（不中断）
- 从重新点击开始再持续 5 个 tick

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 重新计时 | 第 3 秒重新触发后，脉冲再持续 5 秒（总计约 8 秒可见） | 计时器重置 |
| Pulse count | C3 面板 "Total pulses triggered" 递增 | 数字正确 |
| 无视觉抖动 | 重新触发时白色闪光无闪烁/中断 | 平滑过渡 |

### 期望 4: Reset All

**操作**: 在 Actor B 隐藏 + Actor C 脉冲激活状态下，点击 "Reset All" 按钮。

**观察点**:
- Actor B 立即恢复可见
- Actor C 脉冲立即停止，emissiveColor 恢复为 (0, 0, 0)
- 所有状态指示器恢复正常
- Toggle 按钮恢复为 "active" 状态

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| B 恢复 | Actor B 蓝色方块立即重新出现 | 即时 |
| C 脉冲清除 | emissiveColor 恢复为 (0, 0, 0) | C3 面板确认 |
| 状态复位 | C2 面板所有行显示正常状态 | 无 "DETECTED" / "Hidden" |

### 期望 5: Camera Independent Rendering

**操作**: 鼠标拖拽旋转摄像机，从不同角度观察。

**观察点**:
- 所有三个 Actor 方块在旋转时保持正确渲染
- 标签 Billboard 始终面向摄像机
- 隐藏 Actor B 后旋转摄像机，被隐藏的 mesh 仍然不可见
- 地面网格线和网格平面保持正常

**量化标准**:
| 检查项 | 预期行为 | 判定 |
|--------|---------|------|
| 旋转无残影 | 拖拽旋转时无 ghost mesh 残留 | 清洁渲染 |
| Billboard 标签 | 标签始终面对摄像机 | 无侧面视角 |
| Hidden 持久 | Actor B 隐藏后旋转，仍然不可见 | 无闪现 |

---

## 验证步骤

### 准备工作

1. 启动 dev server: `npm run dev`
2. 打开测试页面: `http://localhost:5173/test/ch25-shroud/actor-visibility/`
3. 确认环境信息栏显示 WebGL 2.0 引擎
4. 确认页面加载后可见 3 个彩色方块 + 标签在灰色地面上

### 步骤一: 验证 Mesh Visibility Toggle（期望 1）

- 观察初始状态: 3 个彩色方块全部可见（红/蓝/绿）
- 确认蓝色方块位于场景原点，红色在左侧 (-3,0,0)，绿色在右侧 (3,0,0)
- 点击 "Toggle Actor B Visibility" 按钮
- 蓝色方块应立即消失
- 检查 C2 面板: Actor B 状态为 "Hidden (setEnabled=false)"
- 红色和绿色方块应无任何变化
- 再次点击 "Toggle Actor B Visibility"
- 蓝色方块应立即在原位置重新出现
- 检查 C2 面板: Actor B 状态为 "Visible (setEnabled=true)"
- 预期: ✅ 切换即时，位置保持，无干扰

### 步骤二: 验证 Detection Pulse（期望 2）

- 确认 Actor C (绿色半透明方块) 初始 emissiveColor = (0.00, 0.00, 0.00)
- 点击 "Trigger Detection Pulse on Actor C" 按钮
- **立即观察** : 绿色方块应发出明显的白色光晕（白色闪光叠加在绿色上）
- 检查 C3 面板: emissiveColor 应显示 (~0.80, 0.80, 0.80)，pulse ticks 显示 5
- 等待 1 秒: ticks 显示 4，白色闪光仍可见
- 等待 5 秒总时间: ticks 显示 0，白色闪光消失
- 检查 C3 面板: emissiveColor 恢复为 (0.00, 0.00, 0.00)
- 预期: ✅ 脉冲启动即时，持续 5 ticks，结束后恢复

### 步骤三: 验证 Re-trigger（期望 3）

- 点击 "Trigger Detection Pulse on Actor C"
- 等待 3 秒（ticks 降至 2）
- 再次点击 "Trigger Detection Pulse on Actor C"
- 检查 C3 面板: pulse ticks 应重置为 5
- 白色闪光应持续 5 秒后才消失（总约 8 秒）
- 检查 "Total pulses triggered" = 2
- 预期: ✅ 重新触发时计时器重置，无闪烁

### 步骤四: 验证 Reset（期望 4）

- 设置场景: 隐藏 Actor B + 激活 Actor C 脉冲
- 点击 "Reset All"
- Actor B 应立即恢复可见
- Actor C 白色闪光应立即消失，emissiveColor = (0, 0, 0)
- C2 面板全部显示正常状态
- 预期: ✅ 一键复位所有状态

### 步骤五: 验证 Camera Independent（期望 5）

- 鼠标左键拖拽旋转摄像机
- 从不同角度观察 3 个方块
- 确认红色和绿色始终可见
- 现在隐藏 Actor B (点击 Toggle)
- 旋转摄像机 360°
- 确认蓝色方块在任何角度都不可见（无背面闪现）
- 确认标签 Billboard 始终面向摄像机
- 预期: ✅ 渲染恒定，Hidden 状态跨角度持久

### 边界/异常测试

- **快速连续 Toggle**: 快速连续点击 "Toggle Actor B Visibility" 10 次 → 状态不应混乱，最终可见/隐藏与实际点击次数奇偶一致
- **脉冲中 Reset**: 脉冲激活期间点击 Reset → 脉冲立即停止
- **多个脉冲叠加**: 连续点击 "Trigger Detection Pulse" 多次 → 计数器重置但 timing 正确
- **F5 刷新**: 刷新浏览器 → 页面恢复正常初始状态（3 个方块可见，无脉冲）
- **Tab 切换**: 打开其他浏览器标签页再切回 → 页面状态保持不变

### 结果判定

- [ ] 所有 5 项期望通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异和截图，提交 issue
- [ ] 测试环境异常 → 记录 UA / 视口 / 引擎 / FPS 信息

---

## 技术备注

### mesh.setEnabled() 机制

在 Babylon.js 中，`mesh.setEnabled(false)` 会将 mesh 从渲染流程中排除:
- Mesh 不会被提交到 GPU 绘制
- Mesh 的子节点也一同被禁用（如果使用的是 `setEnabled` 而非单独的 `isVisible`）
- 位置、朝向、材质等属性保持不变
- 重新 `setEnabled(true)` 后 mesh 在下一帧立即恢复渲染，无重建开销

对应 OpenRA 的 `_setActorMeshVisibility()`:
```typescript
// HiddenUnderShroud.ts (conceptual)
_setActorMeshVisibility(visible: boolean): void {
  for (const mesh of this._actorMeshes) {
    mesh.setEnabled(visible)
  }
}
```

### Detection Pulse 机制

对应 OpenRA 的 `_applyDetectionPulse()`:
```typescript
// Cloak.ts (conceptual)
_applyDetectionPulse(): void {
  this._pulseRemaining = 5  // 5 ticks
  this._mesh.material.emissiveColor = new Color3(0.8, 0.8, 0.8)
}

// Per tick:
_tickPulse(): void {
  if (this._pulseRemaining <= 0) return
  this._pulseRemaining--
  if (this._pulseRemaining === 0) {
    this._mesh.material.emissiveColor = new Color3(0, 0, 0)
  }
}
```

### 自包含设计

本测试页面不依赖任何实际 trait 实现：
- 所有 mesh/material 使用 Babylon.js 原生 API 直接创建
- 脉冲计时使用 `setInterval` 模拟 tick (1000ms = 1 tick)
- 没有导入 `HiddenUnderShroud`、`Cloak`、`FrozenActor` 等实际模块
- 这允许在 trait 实现完成前就建立验收基线

### 颜色值参考

| 元素 | 颜色 | RGBA / Emissive |
|------|------|-----------------|
| Actor A diffuse | 红色 | (0.90, 0.15, 0.15) |
| Actor B diffuse | 蓝色 | (0.15, 0.30, 0.90) |
| Actor C diffuse | 绿色 | (0.15, 0.80, 0.30) |
| Actor C alpha (Cloaked) | 半透明 | 0.5 |
| Detection pulse emissive | 白色 | (0.80, 0.80, 0.80) |
| Idle emissive | 黑色（无自发光） | (0.00, 0.00, 0.00) |
| Ground | 深灰蓝 | (0.12, 0.14, 0.18) |

---

| 审核状态 | 审核人 | 审核日期 | 审核结果 |
|---------|--------|---------|---------|
| PENDING | - | - | - |
