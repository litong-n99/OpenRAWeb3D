# Script-Driven Effects — Acceptance Test
**Module**: Lua Scripting API (Chapter 20 Scripting System)
**Test Case ID**: `ch20-scripting/script-driven-effects`
**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-02, 9/9 通过, 100%)

---

## 期望结果

### S1. Camera Movement
| # | 期望 | 量化指标 |
|---|------|---------|
| S1.1 | Script camera.move() 到达目标位置 | `getCameraPosition()` 偏差 ≤1 wu |
| S1.2 | 相机在脚本执行后立即更新 | target 在 processNextStep 中同步更新 |

### S2. Actor Animation
| # | 期望 | 量化指标 |
|---|------|---------|
| S2.1 | Script actor.animate() 播放正确序列名 | `getActorAnimation()==='attack'` after script |
| S2.2 | 颜色随动画类型变化 | attack=红色(1,0.3,0.1), move=绿色(0.2,0.7,0.3) |

### S3. Dialogue Text
| # | 期望 | 量化指标 |
|---|------|---------|
| S3.1 | 对话文本 ≤1 tick 出现 | `isDialogueVisible()===true` within 50ms |
| S3.2 | 文本匹配脚本内容 | "Hello Commander!" 精确匹配 |

### S4. Timed Sequence
| # | 期望 | 量化指标 |
|---|------|---------|
| S4.1 | 顺序命令按次序执行 | camera→delay→dialogue→anim→delay→anim→dialogue |
| S4.2 | Delay 正确等待 | 500ms delay + 1000ms delay 在预期时间内完成 |
| S4.3 | 序列完成标记 | `getScriptStatus()==='idle'` after all steps |

### S5. Error Handling
| # | 期望 | 量化指标 |
|---|------|---------|
| S5.1 | 脚本错误不崩溃渲染器 | unknown step type 被 default case 跳过 |
| S5.2 | Reset 正确清除状态 | camera/anim/dialogue 全部重置 |

### S6. Boundary Tests
| # | 期望 | 量化指标 |
|---|------|---------|
| S6.1 | 快速连续触发脚本 | runScript 忽略重叠调用 |
| S6.2 | 空脚本队列无副作用 | scriptRunning=false 立即返回 |
| S6.3 | 长时间 delay 不阻塞 UI | delay 使用 setTimeout 非同步阻塞 |

---

## 检验流程
1. 打开 `http://localhost:5173/test/ch20-scripting/script-driven-effects/`
2. 点击 Camera Move → 相机移向 (6,1,6) (S1)
3. 点击 Actor Animation → actor 变红 (S2)
4. 点击 Dialogue → 底部显示 "Hello Commander!" (S3)
5. 点击 Timed Sequence → 完整 7 步序列执行 (S4)
6. 点击 Reset → 全部恢复 (S5)

### 结果判定

| 状态 | 判定 | 操作 |
|------|------|------|
| 所有 S1-S6 通过 | ✅ **ACCEPTED** | 提交 |
| 部分未通过 | ⚠️ **需修复** | 记录具体差异，提交 issue |
| 环境异常 (WebGL不可用) | ❌ **环境异常** | 记录 UA / VP / engine |

- [ ] S1-S6 通过 → **ACCEPTED**
