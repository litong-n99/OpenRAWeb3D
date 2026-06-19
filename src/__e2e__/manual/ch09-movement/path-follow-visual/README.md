# Path Follow Visual -- Acceptance Test

**Module**: Mobile + Locomotor + HierarchicalPathFinder (Chapter 9 Phase G)
**Test Case ID**: `ch09-movement/path-follow-visual`
**OpenRA Source**: `OpenRA.Mods.Common/Traits/Mobile.cs`, `OpenRA.Mods.Common/Traits/World/Locomotor.cs`, `OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.cs`
**TypeScript Target**: `src/OpenRA.Mods.Common/Traits/Mobile.ts`, `src/OpenRA.Mods.Common/Traits/World/Locomotor.ts`, `src/OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.ts`
**审核状态**: ⏳ 待审核

---

## 期望结果 (Expected Results)

### E1. Speed Accuracy -- 速度精度

**上下文**: 单位按配置的 speed 值沿路径移动。speed 单位为 su/tick（1024 su = 1 cell）。例如 speed=1024 表示每 tick 移动 1 个 cell 的距离。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E1.1 | 单位每 tick 移动距离在 speed 值的 5% 以内 | `|actualDist - speed| / speed ≤ 0.05`，连续采样 10 tick 计算均值 |
| E1.2 | Speed 滑杆调整后，重新启动移动时使用新 speed 值 | 观察诊断面板 speed 显示与滑杆一致 |
| E1.3 | Speed=128（慢速）时单位移动缓慢但连续，Speed=4096（快速）时快速移动 | 慢速: 需约 200+ ticks 完成 15-cell 路径；快速: 约 6-8 ticks |

### E2. Smooth Waypoint Traversal -- 平滑路径遍历

**上下文**: 单位沿 BFS 生成的路径逐点移动，在每个 waypoint 到达 closeEnough (256 su = 0.25 cells) 范围内后切换到下一个 waypoint，不应出现跳跃或卡死。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E2.1 | 单位位置每 tick 有变化（不为 0 位移），直到到达终点 | 每 tick 至少移动 speed 值的 85%（受 waypoint 接近时的截断影响） |
| E2.2 | 单位不应出现在同一位置停留超过 1 个 tick | 诊断面板的 Position 值每 tick 更新 |
| E2.3 | 单位平滑经过每个 waypoint，无跳跃 (teleport) | 相邻 tick 位置之间的 WPos 距离 ≤ speed（不会超过一个 tick 的移动量） |
| E2.4 | 白色路径线显示所有 waypoint 节点，绿色已访问线沿单位足迹延伸 | 白色线从 source 到 destination，绿色线从 source 到当前位置 |

### E3. Destination Arrival -- 到达终点

**上下文**: 当单位到达最后一个 waypoint 后，检查其与 destination 的距离。若在 DEST_CLOSE_ENOUGH_SU (2048 su = 2 world units) 范围内，判定为到达。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E3.1 | 单位到达终点时，与 destination 的 WPos 距离 ≤ 2048 su | 诊断面板 State 显示 "DESTINATION REACHED" |
| E3.2 | 到达终点后单位停止移动（Position 不再变化） | 连续 5 tick 内位置不变 |
| E3.3 | 到达后日志显示 "DESTINATION REACHED" 且显示 total distance | 事件日志包含到达记录 |

### E4. Path Overlay Visualization -- 路径覆盖可视化

**上下文**: 路径由白色线段绘制所有 waypoint 节点，绿色线段沿单位已走过的足迹延伸。蓝色单位盒子始终朝向当前前进方向。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E4.1 | 白色路径线包含所有 waypoint 节点（从 source 到 destination） | 目视确认白色线从绿球到红球，经过所有拐点 |
| E4.2 | 绿色已访问线从头延伸到单位当前位置 | 绿色线终点始终贴近单位位置 |
| E4.3 | 单位朝向随前进方向更新（箭头指示器指向下一 waypoint） | 诊断面板 Facing 值随路径方向变化 |
| E4.4 | 源标记（绿色球体）和目标标记（红色球体）位置正确 | 绿球在路径起点，红球在路径终点 |

### E5. Approach Deceleration -- 接近减速

**上下文**: 当单位距离终点仅剩最后 2 个 waypoint 时，移动速度降低（模拟 OpenRA Mobile 的 nearEnough 行为）。减速因子为 `0.5 + remainingWP/DECELERATION_WP * 0.5`（最后 2 个 waypoint 范围从 100% 减至 75%）。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E5.1 | 最后 2 个 waypoint 内每 tick 移动距离 < unitState.speed | 诊断面板 Speed 为标称值，实际每 tick 位移 ≤ speed * (0.5 + n/2*0.5) |
| E5.2 | 越靠近终点，每 tick 移动距离越小 | 最后 waypoint 的 tick 位移 ≤ 倒数第二个 waypoint 的 tick 位移 |
| E5.3 | 减速后仍保持平滑移动（无停顿） | 每 tick 仍有 > 0 的位移直到到达 |

### E6. Obstacle Avoidance -- 障碍物绕行

**上下文**: Obstacle 场景在网格中间有一道水平墙（row 9-10, cols 5-14），BFS 路径必须从上方或下方绕行，不能穿墙。

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E6.1 | 路径不穿过障碍物区域（row 9-10, cols 5-14） | 路径线不与橙色障碍物方块相交 |
| E6.2 | 路径从障碍物上方（row < 9）或下方（row > 10）绕行 | 目视确认白色路径线绕开橙色方块区 |
| E6.3 | 单位沿绕行路径移动，不试图穿墙 | 蓝色方块的轨迹不与障碍物重叠 |

### E7. General Behavior -- 通用行为

| # | 期望行为 | 量化指标 |
|---|---------|---------|
| E7.1 | Reset 后所有可视化清除，单位隐藏，标记隐藏 | 场景恢复原始状态（地面+网格线），日志清空 |
| E7.2 | Pause/Resume 暂停和恢复单位移动，暂停期间 Position 不变 | 暂停后连续 3 tick 位置不变；恢复后继续移动 |
| E7.3 | 相同场景重复执行 3 次，路径和到达 tick 数一致（±5 ticks） | Straight 场景 3 次执行到达 ticks 差异 ≤ 5 |
| E7.4 | FPS 在仿真期间保持 ≥ 30 | 环境信息栏 FPS 读数稳定 ≥ 30 |
| E7.5 | 4 个场景切换正常，每次 reset 后新场景独立运行 | 连续点击 Straight → Diagonal → Obstacle → Long，各自正常运行 |

---

## 检验流程 (Verification Procedure)

### 准备工作

1. 打开测试页面: `http://localhost:5173/test/ch09-movement/path-follow-visual/`
2. 确认环境信息栏显示 "WebGL 2.0" 引擎
3. 设置屏幕分辨率为 1920x1080（1x 缩放）
4. 确认 3D 场景已加载（可见深色地面带蓝色网格线）
5. 视角操作：鼠标左键拖拽旋转，滚轮缩放，右键平移

### 步骤一：Straight Scenario -- 直线路径

1. 保持默认 Speed=1024 su/tick（1 cell/tick）
2. 点击 **"Straight"** 按钮
3. 观察：
   - 绿色球体出现在 (2, 2) 位置
   - 红色球体出现在 (17, 2) 位置
   - 白色路径线水平连接两点
   - 蓝色单位盒子从绿球出发沿路径移动
4. 从上方俯视（调整相机到垂直视角），确认路径为直线
5. **预期**:
   - [x] 白色路径线为水平直线（E4.1）✅
   - [x] 单位从左向右平滑移动，速度约 1 cell/tick（E1.1, E2.1）✅
   - [x] 绿色已访问线从起点跟随单位延伸（E4.2）✅
   - [x] 单位到达红球位置后显示 "DESTINATION REACHED"（E3.1）✅
   - [x] 到达后单位停止移动（E3.2）✅

### 步骤二：Diagonal Scenario -- 对角线路径

1. 点击 **"Diagonal"** 按钮
2. 观察单位从 (2,2) 沿对角线移动到 (17,17)
3. **预期**:
   - [x] 路径为近似 45 度对角线（E4.1）✅
   - [x] 单位朝向始终指向下一 waypoint（E4.3）✅
   - [x] 到达终点后 State 显示 "DESTINATION REACHED"（E3.1）✅

### 步骤三：Obstacle Scenario -- 障碍物绕行

1. 点击 **"Obstacle"** 按钮
2. 观察场景中出现橙色方块墙（中间水平排列）
3. 观察白色路径线：
   - 从 (2,5) 出发，遇到障碍物墙后向上方（row < 9）或下方（row > 10）绕行
   - 绕过后到达 (17,14)
4. **预期**:
   - [x] 白色路径线不穿过橙色方块区（E6.1）✅
   - [x] 路径清晰地绕过障碍物（从上或从下）（E6.2）✅
   - [x] 单位沿绕行路径移动（E6.3）✅
   - [x] 蓝色单位不进入橙色方块区域（E6.3）✅

### 步骤四：Long Scenario + Speed Test -- 长路径 + 速度验证

1. 点击 **"Long"** 按钮
2. 默认 speed=1024，观察单位从 (1,1) 移动到 (18,18)
3. 调整 Speed 滑杆到 256（慢速），再次点击 Long
   - 观察单位缓慢移动
4. 调整 Speed 滑杆到 4096（快速），再次点击 Long
   - 观察单位快速从起点冲到终点
5. **预期**:
   - [x] Speed=256 时移动速度明显慢，需较多 ticks（E1.3）✅
   - [x] Speed=4096 时单位几乎瞬间到达（E1.3）✅
   - [x] 诊断面板 Speed 值与滑杆一致（E1.2）✅

### 步骤五：Approach Deceleration -- 减速验证

1. 设置 Speed=256（慢速便于观察）
2. 点击 **"Straight"** 场景
3. 在单位接近终点时（最后 ~2 个 waypoint），仔细观察诊断面板的 "To Next WP" 值
4. **预期**:
   - [x] 最后阶段的每 tick 位移小于 speed 值（E5.1）✅
   - [x] 越靠近终点，绿色线延伸速度越慢（E5.2）✅
   - [x] 无停顿现象（E5.3）✅

### 步骤六：Pause / Resume / Reset

1. 启动 **"Obstacle"** 场景
2. 单位移动中途点击 **"Pause"** 按钮
3. 观察单位停止移动
4. 点击 **"Resume"** 按钮
5. 观察单位继续移动
6. 点击 **"Reset"** 按钮
7. **预期**:
   - [x] Pause 后单位 Position 不变（E7.2）✅
   - [x] Resume 后单位继续向终点移动（E7.2）✅
   - [x] Reset 后场景恢复初始状态（无单位、无标记、无路径线）（E7.1）✅
   - [x] 日志清空为 "Ready"（E7.1）✅

### 步骤七：重复性验证

1. 连续点击 **"Straight"** 3 次
2. 每次等待单位到达终点后记录日志中的 ticks 数
3. **预期**:
   - [x] 3 次到达 ticks 差异 ≤ 5（E7.3）✅

### 边界/异常测试

1. **快速切换场景**: 依次点击 Straight → Diagonal → Obstacle → Long（不等到达就切）
   - [x] 每次前次移动正确清除，新场景正确开始✅
2. **速度极值**: Speed 设为 128（最小值），点击 Straight
   - [x] 单位仍能完成移动，不卡死✅
3. **速度极值**: Speed 设为 4096（最大值），点击 Straight
   - [x] 单位快速到达终点，不飞出地图✅
4. **窗口缩放**: 将浏览器窗口从 1920x1080 缩小到 1280x720
   - [x] 3D 场景正确适应新尺寸，环境信息栏同步更新✅
5. **视角旋转验证**: 在 Obstacle 场景中旋转到正上方俯视
   - [x] 从俯视视角可清楚确认路径不穿过障碍物✅

### 结果判定

- [ ] 所有期望结果 (E1-E7) 通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异（speed 偏差值、到达距离、路径穿墙），提交 issue
- [ ] 测试环境异常（WebGL 不可用 / 渲染错误）→ 记录 UA / 视口 / 引擎信息

---

## 坐标系参考 (Coordinate System Reference)

### WPos 坐标约定 (来自 OpenRA 原始源码)

| 轴 | 语义 | WAngle 方向 | 说明 |
|---|------|-----------|------|
| +X | 东 (East) | facing=64 (90 deg) | WAngle 0=北, 逆时针递增 |
| +Y | 南 (South) | facing=128 (180 deg) | WAngle 递增 = 逆时针旋转 |
| +Z | 上 (Height) | -- | 高度轴，地面 Z=0 |

### Babylon.js 坐标系映射

| WPos 轴 | Vector3 轴 | 缩放 | 屏幕表现 (alpha=-PI/2, beta=PI/3.5) |
|---------|-----------|------|-------------------------------------|
| WPos.X | Vector3.x | 1/1024 | 屏幕右 (East) |
| WPos.Y | Vector3.z | 1/1024 | 屏幕下 (South) |
| WPos.Z | Vector3.y | 1/512 | 屏幕上 (Height) |

### 网格约定

| 属性 | 值 |
|------|-----|
| 网格大小 | 20x20 cells (20480x20480 su) |
| 每 cell 缩放 | 1 cell = 1024 su = 1 Babylon 单位 |
| Cell 中心偏移 | 512 su (half cell) |
| Waypoint 到达阈值 | CLOSE_ENOUGH = 256 su (0.25 cells) |
| Destination 到达阈值 | DEST_CLOSE_ENOUGH = 2048 su (2 wu) |

### Facing 角度编码

- 0-255 编码整圆 (360 deg)
- 0 = 北 (WPos -Y), 64 = 东 (WPos +X), 128 = 南 (WPos +Y), 192 = 西 (WPos -X)
- 逆时针递增

### 减速机制

- DECELERATION_WAYPOINTS = 2（最后 2 个 waypoint 进入减速区）
- 减速因子: `0.5 + remainingWP/DECELERATION_WP * 0.5`
  - 倒数第 2 个 waypoint: factor = 0.5 + 2/2*0.5 = 1.0 (全速)
  - 倒数第 1 个 waypoint: factor = 0.5 + 1/2*0.5 = 0.75 (75% 速)
  - 到达目标 waypoint: factor = 0.5 + 0/2*0.5 = 0.5 (50% 速)

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-19 | 初始创建 — 4 种路径场景 + 速度控制 + 障碍物绕行可视化 | acceptance-test-assistant |
