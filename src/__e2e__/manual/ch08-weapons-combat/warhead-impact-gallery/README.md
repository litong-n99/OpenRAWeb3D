# Warhead Impact Gallery — Multi-Effect Showcase

**Module**: SpreadDamageWarhead + FireClusterWarhead + FlashEffectWarhead + ShakeScreenWarhead (Ch8 Phase A)
**Test Case ID**: `ch08-weapons-combat/warhead-impact-gallery`
**审核状态**: ⏳ 待审核

---

## 期望结果

### W1. AOE Radius Circle

| # | 期望 | 量化指标 |
|---|------|---------|
| W1.1 | Spread warhead 产生 AOE ring 在撞击点 | `getAOERadius()` = 配置的 radius ±0.5 wu |
| W1.2 | AOE ring 随时间扩展 + 淡出 | 40 ticks 后 ring alpha → 0，mesh disposed |

### W2. Cluster Sub-Explosions Within Radius

| # | 期望 | 量化指标 |
|---|------|---------|
| W2.1 | 所有 sub-explosion 位置在 spread radius 内 | `getSubExplosionPositions()` 所有点到 center 距离 ≤ radius |
| W2.2 | Sub-explosion 数量 = 配置的 clusterCount | 默认 8 个 sphere meshes |
| W2.3 | Sub-explosion 25 ticks 后淡出 | alpha → 0, meshes disposed |

### W3. Screen Flash

| # | 期望 | 量化指标 |
|---|------|---------|
| W3.1 | Flash 触发后 intensity = 1.0 | `getFlashIntensity() === 1.0` |
| W3.2 | Flash 在 30 ticks 内从 1.0 衰减到 0 | 30 ticks 后 `getFlashIntensity() ≤ 0.05` |
| W3.3 | Flash 使用 HTML overlay，不影响 3D 场景 | overlay opacity 与 flash intensity 同步 |

### W4. Camera Shake

| # | 期望 | 量化指标 |
|---|------|---------|
| W4.1 | Shake 触发后 camera 产生随机偏移 | `getCameraShakeAmplitude() > 0` |
| W4.2 | Shake 振幅指数衰减 (×0.85/tick) | 5 ticks 后振幅降至初始的 44% |

### W5. Stacking Effects

| # | 期望 | 量化指标 |
|---|------|---------|
| W5.1 | 多个 warhead 同时触发，效果叠加 | `getActiveEffectCount() > 1`，flash+shake 同时激活 |
| W5.2 | MASS DETONATION 按钮触发全部 4 种效果 | AOE ring + sub-explosions + flash + shake 同时可见 |

---

## 检验流程

1. 打开 `http://localhost:5173/test/ch08-weapons-combat/warhead-impact-gallery/`
2. 点击 SPREAD → 红色 AOE ring 出现在撞击点 (W1)
3. 点击 CLUSTER → 橙色子爆炸球体在半径内 (W2)
4. 点击 FLASH → 全屏白色闪光逐渐消退 (W3)
5. 点击 SHAKE → 相机抖动并衰减 (W4)
6. 点击 MASS DETONATION → 全部 4 种效果叠加 (W5)

- [ ] W1-W5 通过 → **ACCEPTED**
