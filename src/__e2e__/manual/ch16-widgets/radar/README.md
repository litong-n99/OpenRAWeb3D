# Widgets / Radar — 雷达小地图测试

## Test Purpose

Verify that the RadarWidget Canvas minimap correctly renders terrain colors, actor position dots, shroud/fog overlays, and an interactive viewport rectangle. Verify coordinate output on minimap click and viewport rectangle drag behavior.

**OpenRA 对照**: OpenRA.Mods.Common/Widgets/RadarWidget.cs (530 lines)

## Expected Behavior (Quantifiable Criteria)

1. **Terrain color rendering**: A 64x48 cell map rendered at 4x scale (256x192 pixel canvas). Each terrain type maps to a specific color:
   - Clear: RGB(74, 124, 63) — green
   - Rough: RGB(139, 115, 85) — brown
   - Water: RGB(74, 109, 140) — blue-gray (horizontal river band, rows 22-26)
   - Road: RGB(160, 136, 74) — tan (two horizontal lines at rows 10 and 38, two vertical at cols 15 and 48)
   - Ore: RGB(85, 85, 85) — dark gray (two patches at (26-34, 9-13) and (41-49, 36-41))
   - Cliff: RGB(100, 60, 40) — dark brown (row 20)
   - Beach: RGB(180, 170, 140) — sand color (rows 21 and 27 adjacent to water)

2. **Shroud layers**: Three visibility states with distinct visual appearance:
   - Visible cells (VIS_VISIBLE = 2): full terrain color, no dimming
   - Fog cells (VIS_FOG = 1): terrain color multiplied by 0.5, creating a 50% darkened effect
   - Shroud cells (VIS_NONE = 0): fully black RGB(0, 0, 0), terrain completely hidden

3. **Actor position dots**: 10 colored dots at specific cell positions:
   - Player units: yellow dots (RGB 200,200,50, radius 2) at (10,10), (50,10)
   - Player infantry: green dots (RGB 50,200,50, radius 1.5) at (12,12), (14,8)
   - Player vehicle: blue dot (RGB 50,100,200, radius 2) at (16,10)
   - Player structure: cyan dot (RGB 100,200,200, radius 3) at (30,30)
   - Enemy units: red dots at (45,40), (48,38), (46,42)
   - Neutral: yellow dot at (20,42)
   - Dots in shroud-covered cells are hidden

4. **Viewport rectangle**: A white outline rectangle (1.5px stroke, 0.08 alpha fill) representing the current camera viewport. Initial position at cells (15, 10) with dimensions 8x6 cells (32x24 radar pixels). The rectangle is draggable via mouse.

5. **Minimap click coordinate output**: Clicking anywhere on the minimap canvas outputs two values:
   - Click coordinate: `cell(cx, cy)` — the cell under the cursor
   - World coordinate: `WPos(cx*1024, cy*1024)` — matching OpenRA's 1024 units per cell convention
   - The viewport rectangle re-centers on the click location

6. **Viewport rectangle drag**: Dragging the white viewport rectangle moves it to a new position. The rectangle stays clamped within map bounds (0 to MAP_CELLS_W/H minus viewport dimensions). Cursor changes to `grab` when hovering over the viewport rectangle and `grabbing` during drag.

## Verification Steps

### Step 1: Page Load
- Open `http://localhost:5173/test/widgets/radar/`
- Confirm the radar canvas (256x192 pixels) is centered in the viewport
- Verify the status panel shows "地图尺寸: 64 x 48 cells" and "小地图像素: 256 x 192 px (4x scale)"
- Verify the legend panel shows all terrain/visibility color mappings

### Step 2: Visual Inspection of Terrain
- Verify the green/brown background represents Clear and Rough terrain
- Verify the horizontal blue-gray band (rows 22-26) represents the Water river
- Verify the tan horizontal lines (rows 10, 38) represent Road paths
- Verify the two dark gray patches represent Ore resource fields
- Verify the dark brown line (row 20) represents a Cliff
- Verify the sand-colored strips (rows 21, 27) represent Beach transition zones

### Step 3: Shroud Visibility Verification
- Observe the circular visible area around the center-left (roughly cell 20,15 with radius ~12)
- Cells within the visible radius: full color, no darkening
- Cells in the fog ring (radius 12-20): 50% darkened — terrain is visible but dimmed
- Cells beyond the fog ring: completely black — terrain invisible
- Verify: "可见单元格" shows ~450 cells, "迷雾单元格" shows ~600 cells, "黑幕单元格" shows ~2000 cells
- The status panel counters should update when shroud changes

### Step 4: Actor Dot Inspection
- Verify 10 colored dots are visible within the visible + fog area
- Dots in the fully visible area are bright; dots in fog area appear dimmed
- Dots in shroud area should be hidden (not rendered)
- Verify the structure dot at (30,30) is larger (radius 3) than infantry dots (radius 1.5)

### Step 5: Viewport Rectangle
- Verify the white outline rectangle at cells (15, 10) to (23, 16) — 8x6 cells
- The rectangle should have a white border (1.5px) and subtle white fill (8% opacity)

### Step 6: Minimap Click
- Click anywhere on the minimap: verify "点击坐标" updates to `cell(cx, cy)`
- Verify "世界坐标" updates to `WPos(cx*1024, cy*1024)`
- Verify the viewport rectangle moves to center on the clicked location
- Click at the edges: verify clamping prevents the viewport from going off-map

### Step 7: Viewport Dragging
- Hover over the white viewport rectangle: cursor changes to `grab`
- Click and drag the rectangle: cursor changes to `grabbing`
- Drag to a new location: rectangle follows the mouse
- Release: cursor returns to `crosshair`
- Verify the rectangle stays within map bounds during drag

### Step 8: Control Buttons
- Click "视口 ↑": viewport moves up by 2 cells
- Click "视口 ↓": viewport moves down by 2 cells
- Click "视口 ←": viewport moves left by 2 cells
- Click "视口 →": viewport moves right by 2 cells
- Click "随机迷雾": shroud pattern changes randomly
- Click "全部揭示": all cells become visible (VIS_VISIBLE, count = 3072)
- Click "全部黑幕": shroud resets to initial circular visibility pattern

### Step 9: Keyboard Navigation
- Press Arrow keys: viewport moves by 1 cell per keypress
- Hold an arrow key: viewport moves continuously

### Step 10: Boundary Tests
- Click/drag viewport to map edges: verify clamping at 0 and MAP_CELLS_W/H - viewport dims
- Click "全部揭示" then inspect: all terrain colors visible, all actor dots visible
- Click "全部黑幕" then inspect: most cells are black, only the visible circle shows terrain
- Resize browser: canvas pixel-perfect rendering (no blur)

### Result Determination
- [ ] Terrain renders with correct color mapping → PASS
- [ ] Shroud/fog/visible layers are visually distinct → PASS
- [ ] Actor dots render at correct positions and are hidden in shroud → PASS
- [ ] Viewport rectangle is draggable and clamped → PASS
- [ ] Click outputs correct cell and world coordinates → PASS
- [ ] Partially failed → document specific issues

## Known Limitations

- This is a standalone Canvas minimap simulation, not the actual RadarWidget class
- The full RadarWidget's PixelShader-style terrain+shroud compositing is simplified to ImageData pixel operations
- RadarWidget animation (slide in/out of minimap panel) is not tested
- RadarWidget integration with WorldRenderer (dirty rectangle tracking) is not tested
- Shroud updating via Shroud.CellVisibility changes is not live (requires manual button clicks)
- The minimap does not rotate with camera angle — it's always top-down
- Sprite icons for actors are not rendered (colored dots instead)

---

**审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-03, 37/37 通过, 100%)
