/**
 * Viewport.ts — 视口管理
 * OpenRA 对照: OpenRA.Game/Graphics/Viewport.cs
 *
 * IMPORTANT — Babylon.js 左手坐标系 (LH) 约束:
 * Babylon.js 使用 Matrix.LookAtLH 计算视图矩阵。
 * right = cross(up, forward) 在 LH 下与直觉相反:
 *   - alpha = -PI/2 → 相机在 -Z 侧 → right = (+1,0,0) → 屏幕右 = 世界+X ✅ 正确
 *   - alpha = +PI/2 → 相机在 +Z 侧 → right = (-1,0,0) → 屏幕右 = 世界-X ❌ 左右翻转
 *
 * 实现 ArcRotateCamera 时必须使用 alpha=-PI/2（或等效的 -Z 侧参数）。
 *
 * 参考: src/__e2e__/manual/hardware-palette/color-accuracy/main.ts 的相机调试过程
 *
 * TODO: 视口管理迁移 → ArcRotateCamera + 正交/透视模式
 */
