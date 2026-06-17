# 多部件Voxel模型层级 — Body+Turret+Barrel 验收测试

**审核状态**: 待审核 (Pending Review)
**创建日期**: 2026-06-17
**对应模块**: `src/OpenRA.Mods.Cnc/Traits/Render/{RenderVoxels,WithVoxelBody,WithVoxelTurret,WithVoxelBarrel}.ts`
**OpenRA 对照**: `OpenRA.Mods.Cnc/Traits/Render/RenderVoxels.cs` (189 lines), `WithVoxelBody.cs` (68 lines), `WithVoxelTurret.cs` (67 lines), `WithVoxelBarrel.cs` (105 lines)

## 期望结果 (Expected Results)

1. **层级结构正确 (TransformNode Parent-Child Hierarchy)**:
   - Body 是根节点 (TransformNode), Turret 是 Body 的子节点, Barrel 是 Turret 的子节点
   - 可量化指标: Body mesh 青色 (#19B2B3), Turret mesh 橙色 (#CC731A), Barrel mesh 红色 (#D91A1A)
   - 可量化指标: 白色线条连接 Body→Turret, 黄色线条连接 Turret→Barrel
   - 可量化指标: Turret 始终跟随 Body 旋转, Barrel 始终跟随 Turret 旋转

2. **身体朝向映射 (Body Facing — WAngle system)**:
   - WAngle 0=北 (面向负Z方向), 角度逆时针递增 (从上方俯视)
   - 可量化指标: WAngle 0 → body.rotation.y = 0 rad (面向 -Z)
   - 可量化指标: WAngle 256 (东) → body.rotation.y = π/2 rad (面向 +X)
   - 可量化指标: WAngle 512 (南) → body.rotation.y = π rad (面向 +Z)
   - 可量化指标: WAngle 768 (西) → body.rotation.y = 3π/2 rad (面向 -X)
   - 可量化指标: 方位指示球显示 N=蓝(负Z), E=橙(正X), S=红(正Z), W=黄(负X)

3. **炮塔偏航 (Turret Yaw)**:
   - 炮塔偏航是相对于身体的局部旋转
   - 可量化指标: 正偏航=顺时针旋转 (从上方俯视), 与WAngle同方向
   - 可量化指标: turretYaw=0 时炮塔指向身体正前方 (无偏转)
   - 可量化指标: turretYaw=256 时炮塔相对身体右转90度 (指向右侧)
   - 可量化指标: turretYaw=-256 时炮塔相对身体左转90度 (指向左侧)

4. **炮管反冲偏移链 (Barrel Recoil Offset Chain)**:
   - 炮管偏移链: 局部偏移(LocalOffset + Recoil) → 炮塔旋转变换 → 身体旋转变换 → 世界坐标
   - 可量化指标: recoil=0 时炮管在炮塔前方 (默认 LocalOffset.X=0.6 WDist)
   - 可量化指标: recoil=120 时炮管后移 120/1024 ≈ 0.117 世界单位 (沿炮管指向方向后退)
   - 可量化指标: 点击"开火"按钮 recoil 立即设为 120, 然后每 tick 衰减 8, 约 0.6 秒恢复

5. **自动演示模式 (Auto Animation)**:
   - 身体持续旋转: 每tick +8 WAngle (完整一圈需 128 ticks = 5.12s @ 25fps)
   - 炮塔偏航正弦摆动: ±64 WAngle 范围, 周期约 78 ticks
   - 每 50 ticks (2s) 自动开火一次
   - 可量化指标: 炮管世界位置随身体和炮塔旋转而变化, 层级线随动画更新

6. **层级旋转传播验证**:
   - 当 body=256 (东) 且 turret=0 (无偏转) 时, 炮塔实际指向东 (身体方向)
   - 当 body=0 (北) 且 turret=256 (右转90度) 时, 炮塔实际指向东 (身体北+炮塔右=东)
   - 可量化指标: 炮管世界偏移在 body=512 (南) 时 Z 分量为正, 在 body=0 (北) 时 Z 分量为负

---

## 检验流程

### 1. 准备工作
- 打开测试页面: `http://localhost:5173/test/ch19-cnc/voxel-body/`
- 确认环境信息栏显示 "引擎: WebGL 2.0"
- 确认页面显示三色模型部件和方位标记球

### 2. 步骤一: 手动调整身体朝向
- 拖动"身体朝向"滑块到 0 (N), 观察青色身体指向负Z
- 拖动到 256 (E), 观察身体指向正X
- 拖动到 512 (S), 观察身体指向正Z
- 拖动到 768 (W), 观察身体指向负X
- 预期: ✅ 所有4个主方向映射正确, 炮塔和炮管随身体旋转

### 3. 步骤二: 手动调整炮塔偏航
- 设置身体朝向为 0 (N)
- 拖动炮塔偏航 0 → 256 → 0 → -256 → 0
- 观察橙色炮塔相对身体旋转
- 预期: ✅ 炮塔偏航是局部旋转, 不影响身体方向

### 4. 步骤三: 反冲效果
- 点击"开火"按钮
- 观察红色炮管瞬间后移约 0.117 世界单位
- 观察炮管位置自动恢复 (每tick衰减8, 约15 ticks = 0.6秒)
- 预期: ✅ 反冲效果可见且自动恢复

### 5. 步骤四: 自动演示
- 点击"自动旋转演示"按钮
- 观察身体持续旋转, 炮塔正弦摆动
- 每约2秒自动开火一次
- 点击"暂停", 再点击"继续"
- 预期: ✅ 整个层级旋转传播正确, 无分离或错位

### 6. 边界/异常测试
- **边界 A - 旋转叠加**: 设置 body=256 (东), turret=256 (炮塔右转90度)
  - 预期: ✅ 炮管指向南 (身体东 + 炮塔右90度 = 南, 正Z)
- **边界 B - 最大反冲**: 反冲滑块拖到最大值 200
  - 预期: ✅ 炮管明显后移 200/1024 ≈ 0.195 世界单位
- **边界 C - 重置**: 任意状态下点击"重置"
  - 预期: ✅ 所有朝向归零, 反冲清零, 自动动画停止

### 7. 结果判定
- [ ] 所有期望结果通过 → **ACCEPTED**
- [ ] 部分未通过 → 记录具体差异 (附截图和环境信息栏数据)
- [ ] 测试环境异常 → 记录 UA/视口/引擎信息
