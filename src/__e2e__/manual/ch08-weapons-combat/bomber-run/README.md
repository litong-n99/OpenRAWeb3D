# Bomber Run — Acceptance Test

**Module**: AttackBomber + Aircraft (Chapter 8 Phase E)
**Test Case ID**: `ch08-weapons-combat/bomber-run`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Air/AttackBomber.ts`, `OpenRA.Mods.Common/Traits/Air/Aircraft.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果

### B1. Aircraft Straight-Line Flight

| # | 期望 | 量化指标 |
|---|------|---------|
| B1.1 | 飞机从左侧直线飞越 target area 到右侧 | 飞行路径 Y=5 直线，偏差 ≤0.1wu |
| B1.2 | 飞行高度恒定 | altitude = FLIGHT_ALTITUDE (0.5wu) ±0.02 |
| B1.3 | 飞机速度 = 配置值 | 每 tick 水平位移 = acSpeed/1024 wu |

### B2. Bomb Drop Interval

| # | 期望 | 量化指标 |
|---|------|---------|
| B2.1 | 炸弹按配置间隔释放 | 默认 interval=12t，dropCount 每 12t 递增 |
| B2.2 | 炸弹总数 = 配置的 bombCount | 默认 4 颗，全部释放后不再 drop |
| B2.3 | 首颗炸弹在首次间隔结束时释放 | tick = interval 时 dropCount=1 |

### B3. Ballistic Trajectory

| # | 期望 | 量化指标 |
|---|------|---------|
| B3.1 | 炸弹受重力加速度下落 | vel.y 每 tick 减少 GRAVITY*0.05 |
| B3.2 | 炸弹命中地面 (Y≤impactY) 时 detonate | detCount 递增，mesh 隐藏 |
| B3.3 | 无炸弹间碰撞 | 所有炸弹存活期间 mesh 不重叠 |

### B4. Return to Base

| # | 期望 | 量化指标 |
|---|------|---------|
| B4.1 | 飞机飞越地图右边界后消失 | acPos.x > 18 → aircraft.setEnabled(false) |
| B4.2 | Run complete 标记 | `isRunComplete() === true` |
| B4.3 | 所有炸弹已释放或引爆 | dropCount ≥ bombCount 或所有炸弹 detonated |

### B5. Configurable Parameters

| # | 期望 | 量化指标 |
|---|------|---------|
| B5.1 | Speed slider 改变飞行速度 | acSpeed=200→缓慢，acSpeed=800→快速飞越 |
| B5.2 | Interval slider 改变投放间隔 | interval=5→密集，interval=30→稀疏 |
| B5.3 | Count slider 改变炸弹数量 | 1-8 颗可配置 |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch08-weapons-combat/bomber-run/`
2. 点击 START BOMBER RUN → 飞机从左侧飞入 (B1)
3. 观察炸弹按间隔投放 → 抛物线落地 (B2, B3)
4. 飞机飞出右侧 → run complete (B4)
5. 调整参数重复测试 (B5)

- [ ] B1-B5 通过 → **ACCEPTED**
