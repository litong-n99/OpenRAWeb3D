# Turret Rotation — Acceptance Test

**Module**: Turreted + AttackTurreted (Chapter 8 Phase D/E)
**Test Case ID**: `ch08-weapons-combat/turret-rotation`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Turreted.ts`, `OpenRA.Mods.Common/Traits/Attack/AttackTurreted.ts`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-01, 11/11 通过, 100%)

---

## 期望结果

### T1. Turn Rate Limit

| # | 期望 | 量化指标 |
|---|------|---------|
| T1.1 | 炮塔以配置的 turnRate 旋转（°/tick） | 默认 25°/t，每 tick 角变化 25° |
| T1.2 | 调整 slider 改变旋转速率 | turnRate=10→慢, turnRate=90→快 |
| T1.3 | 不超速：角变化 ≤ turnRate/tick | `|angle(t+1) - angle(t)| ≤ turnRate` |

### T2. Shortest Path Rotation (No Flipping)

| # | 期望 | 量化指标 |
|---|------|---------|
| T2.1 | 炮塔走最短路径到达目标方向 | 从不旋转 >180°（always ≤180°） |
| T2.2 | 目标 270°→0°: 转 90°（非 270°） | angle 递增 90°，非递减 270° |
| T2.3 | 无 flip/回弹 | 旋转方向单调，不来回摆动 |

### T3. Target Tracking

| # | 期望 | 量化指标 |
|---|------|---------|
| T3.1 | 炮塔跟踪移动目标 | moving=ON 时 angle 持续更新 |
| T3.2 | 存在 angular lag（因 turn rate 限制） | 目标快速移动时 diff 不为 0 |
| T3.3 | 目标静止后炮塔 catch up | 最终 `isTurretFacingTarget() === true` |

### T4. Multi-Turret Independence

| # | 期望 | 量化指标 |
|---|------|---------|
| T4.1 | 两个炮塔独立旋转 | turret0, turret1 可不同角度 |
| T4.2 | 不同颜色区分 | t0=blue, t1=orange |
| T4.3 | 各炮塔独立 facing 状态 | `isTurretFacingTarget(0)` 和 `isTurretFacingTarget(1)` 独立 |

### T5. No Oscillation When Facing Target

| # | 期望 | 量化指标 |
|---|------|---------|
| T5.1 | 到达目标方向后停止旋转 | diff ≤ 1° 时 angle 不变 |
| T5.2 | 无 overshoot 振荡 | 到达后 `|angle(t+1)-angle(t)| ≈ 0` |
| T5.3 | 长时间保持 facing 状态 | 10 ticks 静止目标后仍 facing=true |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch08-weapons-combat/turret-rotation/`
2. 点击 Set Target (90°) → 炮塔旋转 90° (T1, T2)
3. 点击 Set Target (270°) → 转 180°（走最短路径）(T2)
4. 勾选 Moving → 炮塔跟踪移动目标 (T3)
5. 观察两个炮塔独立颜色和旋转 (T4)
6. 目标静止 → 炮塔精确对准后停止 (T5)

- [ ] T1-T5 通过 → **ACCEPTED**
