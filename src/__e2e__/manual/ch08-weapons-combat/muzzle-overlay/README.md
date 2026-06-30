# Muzzle Overlay — Weapon Hardpoint Flash Acceptance Test

**Module**: WithMuzzleOverlay (Chapter 8 Phase E)
**Test Case ID**: `ch08-weapons-combat/muzzle-overlay`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.ts`
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-06-30, 26/26 通过, 100%)

---

## 期望结果

### M1. Flash Appears at Weapon Hardpoint

| # | 期望 | 量化指标 |
|---|------|---------|
| M1.1 | 点击 Fire 后 flash 出现在 barrel 末端 | `getMuzzlePosition()` 返回值在 hardpoint 位置 ±0.1 world units |
| M1.2 | Flash 在 fire 后 1 tick (50ms) 内出现 | `isMuzzleVisible()` 在 50ms 后返回 true |
| M1.3 | Flash 为 billboard，始终面向相机 | `Vector3.Dot(flashNormal, cameraForward) > 0.95` |

### M2. Flash Visible for Exactly Configured Duration

| # | 期望 | 量化指标 |
|---|------|---------|
| M2.1 | 默认 `duration=6` ticks，flash 可见恰好 6 ticks | `getRemainingTicks()` 从 6 递减至 0，偏差 0 |
| M2.2 | Flash alpha 线性衰减 | tick 3 时 alpha ≈ 0.5 (3/6)，偏差 ±0.1 |
| M2.3 | Duration slider 调至 10，flash 可见 10 ticks | 可见 tick 数 = slider 值 |
| M2.4 | Duration 结束后 flash mesh 被 dispose | `isMuzzleVisible()` = false, mesh count 归零 |

### M3. Dual-Barrel Mode Alternates Correctly

| # | 期望 | 量化指标 |
|---|------|---------|
| M3.1 | Dual 模式下连续 fire 交替 slot 0→1→0→1 | `getFireCount()` 递增，slot 交替激活 |
| M3.2 | Single 模式下始终使用 slot 0 | 无论 fire 多少次，`slot[1].remainingTicks === 0` |
| M3.3 | Slot 0 手动 fire (btnFireS0) 不影响交替序列 | 手动 fire slot 0 后，下次 auto 仍按原序列 |

### M4. Billboard Always Faces Camera

| # | 期望 | 量化指标 |
|---|------|---------|
| M4.1 | 任意旋转视角后 flash normal 与 camera forward 夹角 < 5° | dot product > 0.95 |
| M4.2 | 多角度验证 (0°, 90°, 180°, 270°) 均满足 dot > 0.95 | 旋转 360° 全程 dot > 0.95 |

### M5. Clean Disposal with No Residual

| # | 期望 | 量化指标 |
|---|------|---------|
| M5.1 | Duration 结束后 flash mesh 完全清除 | `getActiveSlotCount() === 0` |
| M5.2 | Reset 清除所有状态 | fireCount=0, nextSlot=0, 所有 slot visible=false |
| M5.3 | 快速连续 fire (每 2 tick) 不泄漏 mesh | 运行 60 ticks 后 scene.meshes 数量稳定 |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch08-weapons-combat/muzzle-overlay/`
2. **步骤一**: 点击 FIRE WEAPON → 橙色闪光出现在炮管末端 → 6 ticks 后消失 (M1, M2)
3. **步骤二**: 连续点击 5 次 → 交替 slot 0/1 (M3)
4. **步骤三**: 旋转摄像机 → flash 始终面向相机 (M4)
5. **步骤四**: 切换 Single 模式 → 只在 slot 0 闪光 (M3.2)
6. **步骤五**: 调整 Duration slider → flash 可见时间变化 (M2.3)
7. **边界**: 快速连点 (spam) → 无 mesh 泄漏

- [ ] 所有 M1-M5 通过 → **ACCEPTED**
