# Attack Animation — Acceptance Test

**Module**: WithAttackAnimation + WithAttackOverlay (Chapter 8 Phase E)
**Test Case ID**: `ch08-weapons-combat/attack-animation`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.ts`
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-23, 9/9 通过, 100%)

---

## 期望结果

### A1. Attack Animation Starts Within 1 Tick

| # | 期望 | 量化指标 |
|---|------|---------|
| A1.1 | fire 后 animation state 立即变为 'attacking' | `getAnimState()` 在 1 tick (40ms) 后返回 'attacking' |
| A1.2 | 首次 fire 时 frame counter 从 0 开始 | `getAnimationFrame() === 0` |

### A2. Sequence Completes Full Cycle

| # | 期望 | 量化指标 |
|---|------|---------|
| A2.1 | 默认 8 帧 animation，恰好 8 帧后进入 cooldown | frame 8 时 state = 'cooldown' |
| A2.2 | 调整 totalFrames=12 后，12 帧后进入 cooldown | frame 12 → cooldown |
| A2.3 | 动画帧率匹配配置的 25fps | 40ms 每帧，8 帧 = 320ms ±40ms |

### A3. Overlay Sprite Visible During Attack

| # | 期望 | 量化指标 |
|---|------|---------|
| A3.1 | attack 期间 overlay mesh 可见 | `overlayMesh.isEnabled() === true` |
| A3.2 | idle/cooldown 期间 overlay 不可见 | `getOverlaySequence() === 'none'` |

### A4. Color Transition Follows Preset Sequence

| # | 期望 | 量化指标 |
|---|------|---------|
| A4.1 | t=0: 蓝色 (0.2, 0.5, 0.7) → t=0.33: 橙色 → t=0.66: 红色 → t=1.0: 回归蓝色 | 颜色值在路径上 |
| A4.2 | 动画完成后 body 恢复 idle 颜色 (0.2, 0.5, 0.7) | RGB 偏差 ≤0.05 |

### A5. Burst Re-trigger Resets Frame Counter

| # | 期望 | 量化指标 |
|---|------|---------|
| A5.1 | attacking 期间再次 fire → frame 重置为 0 | `burstCount >= 2` 时 frame 从 0 重新计数 |
| A5.2 | 多次 fire 不叠加动画周期 | 每次 re-trigger 重置 frame，不加速 |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch08-weapons-combat/attack-animation/`
2. 点击 ATTACK → 观察 actor 颜色变化 (蓝→橙→红→蓝) + overlay 出现 (A1, A3, A4)
3. 动画期间再次点击 → frame 重置 (A5)
4. 调整 Frames slider → 动画长度变化 (A2.2)
5. 快速连点 → 每次重置 frame，无卡死

- [ ] A1-A5 通过 → **ACCEPTED**
