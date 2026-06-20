# Ch25 Frozen Actor Flash 3D — Acceptance Test

**审核状态**: 待审核 (Pending Review)

## 对应模块
- `src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts` — FrozenActor.Flash(), _applyFlashTint(), _revertFlashTint(), Tick()
- `src/OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.ts` — tickRender() ScreenMap transitions (触发 Flash 的上游)

## 核心机制回顾 (源码分析)

### Flash() 两种重载
| 重载 | 调用示例 | TintModifiers | emissiveColor 计算 | alpha 处理 |
|------|---------|--------------|-------------------|-----------|
| Flash(Color, float) | Flash({r:255,g:0,b:0}, 0.7) | ReplaceColor (1) | emissive = tint (颜色/255) | alpha = 传入值 |
| Flash(float3) | Flash({r:0.2,g:0.2,b:1.0}) | None (0) | emissive = savedOriginal * tint | 不修改 alpha |

### Tick() 闪烁时序 (源码精确追踪)
```
Flash() 调用后: _flashTicks = 5, _savedEmissive = null

Tick 1: 5→4, isFlashing(4)=true  → _applyFlashTint() → ON  (捕获 savedEmissive)
Tick 2: 4→3, isFlashing(3)=false → _revertFlashTint() → OFF (恢复 savedEmissive)
Tick 3: 3→2, isFlashing(2)=true  → _applyFlashTint() → ON
Tick 4: 2→1, isFlashing(1)=false → _revertFlashTint() → OFF
Tick 5: 1→0, isFlashing(0)=false → _revertFlashTint() → OFF (end)
        然后: _flashTicks===0 && _savedEmissive!==null → 清除 _savedEmissive
```

isFlashing 定义: `_flashTicks > 0 && _flashTicks % 2 === 0` (递减后检查)

**结论**: 5 ticks 内产生 2 次 ON 周期 (remaining=4 和 remaining=2)，第 5 tick 结束时 flash 过期。

### _applyFlashTint() 逻辑
- 首次 ON: 捕获当前 material.emissiveColor → _savedEmissive, 捕获 material.alpha → _savedAlpha
- ReplaceColor: emissiveColor = {r: tint.r, g: tint.g, b: tint.b} (直接设置)
- Multiplicative: emissiveColor = {r: saved.r * tint.r, g: saved.g * tint.g, b: saved.b * tint.b} (分量相乘)
- 有 alpha: material.alpha = flashAlpha

### _revertFlashTint() 逻辑
- emissiveColor = _savedEmissive (恢复为捕获的原始值)
- 仅当 flashAlpha !== null 时: material.alpha = _savedAlpha

---

## 期望行为

### 1. ReplaceColor Flash — 颜色直接替换 + alpha 覆盖

**触发**: 点击 "Flash Red (ReplaceColor)" (网状物 #1)

**预期**:
- 立即 (下一个 Tick, <=1000ms): material.emissiveColor 变为 (1.00, 0.00, 0.00) 纯红色
- material.alpha 变为 0.70
- 网状物 #1 视觉表现为红色自发光 + 70% 不透明度
- 状态面板 #1 显示: badge=ON, tick=4, emissive=(1.00, 0.00, 0.00), alpha=0.70, mode=ReplaceColor

**闪烁时序**:
| Tick | flashTicks (递减后) | isFlashing | emissiveColor | alpha |
|------|---------------------|-----------|---------------|-------|
| 1    | 4 | ON  | (1.00, 0.00, 0.00) | 0.70 |
| 2    | 3 | OFF | (0.30, 0.10, 0.10) | 1.00 |
| 3    | 2 | ON  | (1.00, 0.00, 0.00) | 0.70 |
| 4    | 1 | OFF | (0.30, 0.10, 0.10) | 1.00 |
| 5    | 0 | OFF | (0.30, 0.10, 0.10) | 1.00 |

**到期后**: emissiveColor 精确恢复为原始值 (0.30, 0.10, 0.10), alpha 精确恢复为 1.00

### 2. Multiplicative Flash — 分量乘积着色

**触发**: 点击 "Flash Blue (Multiplicative)" (网状物 #2)

**原始 emissive**: (0.10, 0.10, 0.30)
**tint**: (0.2, 0.2, 1.0)

**预期**:
- ON 时 emissiveColor = (0.02, 0.02, 0.30) — 红色和绿色分量被压低，蓝色保持
- alpha 不受影响，保持 1.00
- 网状物 #2 视觉上变暗，蓝色调保持

**闪烁时序**:
| Tick | flashTicks | isFlashing | emissiveColor | alpha |
|------|-----------|-----------|---------------|-------|
| 1    | 4 | ON  | (0.02, 0.02, 0.30) | 1.00 |
| 2    | 3 | OFF | (0.10, 0.10, 0.30) | 1.00 |
| 3    | 2 | ON  | (0.02, 0.02, 0.30) | 1.00 |
| 4    | 1 | OFF | (0.10, 0.10, 0.30) | 1.00 |
| 5    | 0 | OFF | (0.10, 0.10, 0.30) | 1.00 |

**到期后**: emissiveColor 精确恢复 (0.10, 0.10, 0.30), alpha 保持 1.00

### 3. Flash 到期后精确恢复

- emissiveColor 的 r, g, b 分量精确等于触发 Flash 前的值 (允许浮点误差 ±0.01)
- alpha 精确等于原始 alpha 值 (±0.01)
- 状态面板显示 badge=EXPIRED, tick=0
- 无残留着色

### 4. 多次 Flash — 旧 Flash 被替换

- 在一次 Flash 进行中触发新的 Flash:
  - _flashTicks 重置为 5
  - _savedEmissive 重置为 null (下次 ON 时从当前 emissiveColor 重新捕获)
  - _flashTint, _flashModifiers, _flashAlpha 更新为新值
- 如果旧 Flash 处于 ON 状态时触发新 Flash (ReplaceColor → 新 emissive 已被写入):
  - 新 Flash 的 _savedEmissive 将从已被修改的 emissive 捕获 (即前一个 Flash 的 tint 值)
  - 到期后恢复的是捕获时的值 (即新 tint)，而非最初的原始值
- 如果旧 Flash 处于 OFF 状态时触发新 Flash:
  - emissiveColor 当前为原始值，_savedEmissive 正确捕获原始值
  - 到期后恢复原始值

### 5. 多网格独立闪烁

- 3 个网状物有各自独立的 Flash 状态 (flashTicks, flashTint, flashAlpha, flashModifiers, savedEmissive)
- 触发某个网状物的 Flash 不影响其他网状物
- "Flash All" 同时触发全部 3 个网状物，各自使用对应的 tint 和模式

---

## 验证步骤

### 准备工作
1. 打开测试页面: `http://localhost:5173/test/ch25-shroud/frozen-actor-flash/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920×1080 (1x 缩放)
4. 使用 ArcRotateCamera (鼠标拖拽旋转, 滚轮缩放) 调整视角到合适的观察位置
5. 确认看到 3 个彩色立方体排列在暗色地面上 (从左到右: 红基础色、蓝基础色、绿基础色)

### 步骤一: ReplaceColor Flash 测试
1. 点击 "Flash Red (ReplaceColor)" 按钮
2. 观察网状物 #1 (左侧红色基础立方体)
3. 预期: Tick 1 时立方体立即变为纯红色发光 (emissive)，透明度降低
4. 等待约 5 秒，观察闪烁模式: 红 → 原色 → 红 → 原色 → 原色 (2 次 ON)
5. 对照状态面板 #1 确认 emissiveColor 数值与期望时序一致
6. **预期**: 所有期望结果 #1 通过

### 步骤二: Multiplicative Flash 测试
1. 等待网状物 #1 的 Flash 完全到期 (EXPIRED)
2. 点击 "Flash Blue (Multiplicative)" 按钮
3. 观察网状物 #2 (中间蓝色基础立方体)
4. 预期: ON 时 emissiveColor 变为深暗蓝色 (约 0.02, 0.02, 0.30)，立方体明显变暗
5. 注意: 立方体不透明度不变 (alpha 保持 1.00)
6. 对照状态面板 #2 确认 emissiveColor 数值
7. **预期**: 所有期望结果 #2 通过

### 步骤三: Flash 到期恢复测试
1. 等待所有 Flash 到期
2. 确认状态面板 #1 emissive 显示 (0.30, 0.10, 0.10)
3. 确认状态面板 #2 emissive 显示 (0.10, 0.10, 0.30)
4. 确认状态面板 #3 emissive 显示 (0.10, 0.30, 0.10)
5. 所有 alpha 显示 1.00
6. **预期**: 所有期望结果 #3 通过

### 步骤四: Flash All 同时触发测试
1. 点击 "Flash All" 按钮
2. 观察 3 个立方体同时进入闪烁状态
3. #1 应显示红色 (ReplaceColor), #2 显示暗蓝色 (Multiplicative), #3 显示暗绿色 (Multiplicative)
4. 确认状态面板各自显示正确的模式、emissiveColor、alpha 值
5. **预期**: 所有期望结果 #5 通过

### 步骤五: Flash 替换测试
1. 等待所有 Flash 到期
2. 点击 "Flash Red (ReplaceColor)" — 网状物 #1 开始红色闪烁
3. 立即 (在第一个 ON tick 期间，约 1 秒) 点击 "Flash Blue (Multiplicative)" — 网状物 #2 开始蓝色闪烁 (不影响 #1)
4. 等待约 3 秒后，点击 "Flash Green (Multiplicative)" — 网状物 #3 开始绿色闪烁 (不影响 #1/#2)
5. 确认 3 个网状物各自独立闪烁，互不干扰
6. **预期**: 所有期望结果 #5 通过

### 边界测试: 快速重触发
1. 点击 "Flash Red (ReplaceColor)" 触发网状物 #1 闪烁
2. 在红色 ON 状态期间 (约 1 秒内)，再次点击 "Flash Red (ReplaceColor)"
3. 观察: 新 Flash 的 _savedEmissive 将从已被替换为红色的 emissive (1.00, 0.00, 0.00) 捕获
4. 到期后 emissiveColor 恢复为 (1.00, 0.00, 0.00) — 这是捕获时的值，而非初始 (0.30, 0.10, 0.10)
5. 这符合 FrozenActor 源码的行为 (新 Flash 重置 savedEmissive 为 null，首次 ON 从当前 emissive 快照)
6. **预期**: 期望结果 #4 通过

---

## 结果判定

- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (哪个 tick 的 emissiveColor/alpha 与期望不符)，提交 issue
- [ ] 测试环境异常 → 记录 UA / 视口 / 引擎版本 / FPS 信息

---

## 技术说明

本测试页面**未导入 FrozenActorLayer.ts**，而是自包含地重新实现了 Flash 状态机的核心逻辑：
- `isFlashing(state)` = `flashTicks > 0 && flashTicks % 2 === 0`
- `_applyFlashTint()` / `_revertFlashTint()` 通过直接操作 Babylon.js `StandardMaterial.emissiveColor` 和 `alpha` 实现
- 使用 `setInterval(1000ms)` 模拟 tick 节奏，便于肉眼观察闪烁序列
- 不使用 `@babylonjs/core` 之外的任何运行时依赖

如果源码 `FrozenActorLayer.ts` 的 Tick() / Flash() / _applyFlashTint / _revertFlashTint 实现发生变化，本测试页面的模拟逻辑应同步更新。
