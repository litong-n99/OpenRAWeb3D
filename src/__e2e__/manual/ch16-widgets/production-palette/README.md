# Widgets / ProductionPalette — 生产图标网格测试

## Test Purpose

Verify that the ProductionPaletteWidget correctly renders a grid of production icons with clock progress overlays, overlay text (READY/HOLD/time/queue count), hotkey labels, and state-dependent visual styling (buildable/queued/locked).

**OpenRA 对照**: OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs (649 lines)

## Expected Behavior (Quantifiable Criteria)

1. **Icon grid layout**: 12 icons laid out in a 4-column grid (4 rows). Each icon cell is exactly 72px x 56px with 4px margin. Cells are positioned in reading order (left-to-right, top-to-bottom). The palette widget dimensions are approximately 308px wide x 260px tall.

2. **Clock overlay angles**: Items with progress show a CSS conic-gradient clock overlay. The clock angle corresponds to `remainingCost / totalCost` ratio:
   - Item `e1` (remainingCost=20, totalCost=100): angle = 20/100 * 360 = 72 degrees → shows a thin wedge
   - Item `e3` (remainingCost=100, totalCost=150): angle = 100/150 * 360 = 240 degrees → shows mostly full
   - Item `shok` (remainingCost=450, totalCost=500): angle = 450/500 * 360 = 324 degrees → almost full circle
   - Items at 0 remaining: angle = 0 → shows "READY" overlay instead of clock
   - Items at full cost: angle = 360 → full circle (opaque overlay)

3. **Overlay text states**:
   - `e2` shows "READY" (item.done=true) — white text with dark text-shadow contrast
   - `e3` shows "HOLD" (item.paused=true) — white text
   - `e1` shows time remaining (e.g., "0:40") — white text
   - `shok` shows time remaining (e.g., "7:30") — white text
   - `e1` position 2 (second queue) shows queue count "2" in bottom-left corner
   - `e4` shows infinite symbol "∞" (item.infinite=true)

4. **Cell background states**:
   - Buildable items without queue entries: `background-color: #0d2a4a` (dark blue)
   - Queued items (in-progress): `background-color: #1e4d7a` (medium blue) with clock overlay
   - Items with `done` status: `background-color: #1e4d7a` + "READY" text overlay

5. **Hotkey labels**: The first 9 icons display F1-F9 hotkey labels in gold (#FFD700) with text-shadow in the top-left corner of each cell. Icons without hotkeys (index >= 9) show no hotkey label.

6. **Progress button**: Clicking "推进建造进度" reduces `remainingCost` by 15 on all non-done, non-paused items, causing the clock overlays to shrink proportionally. After enough clicks, items reach `remainingCost=0` and transition from clock overlay to "READY" text.

## Verification Steps

### Step 1: Page Load
- Open `http://localhost:5173/test/widgets/production-palette/`
- Confirm the 4x3 icon grid is centered in the viewport
- Verify the status panel on the right shows "图标数量: 12" and "队列项目: 6"
- Verify the legend panel describes the color coding correctly

### Step 2: Visual Inspection of Clock Overlays
- Inspect icon `e1`: a circular clock overlay with a thin wedge (~72 degrees). Verify the wedge starts from the top (0 degrees) and extends clockwise.
- Inspect icon `e3`: "HOLD" text displayed (paused state). No clock animation.
- Inspect icon `e2`: "READY" text displayed (completed state). No clock overlay.
- Inspect icon `shok`: nearly full clock overlay (~324 degrees). Small transparent gap.
- Inspect icon `e4`: infinite symbol "∞" in top-left area.

### Step 3: Overlay Text Verification
- Verify `e2` shows "READY" — text is white with dark shadow halo
- Verify `e3` shows "HOLD" — text is white
- Verify non-done items show time in format "M:SS" or "SS"
- Verify `e1` shows queue count badge (since it has 2 queued items)
- Verify `e4` shows "∞" symbol

### Step 4: Hotkey Labels
- Verify icons 1-9 show F1 through F9 in gold (#FFD700) at top-left
- Verify icons 10-12 (powr, barr, tent, weap) show no hotkey labels

### Step 5: Progress Button
- Click "推进建造进度" once: observe clock overlays shrink slightly
- Click "推进建造进度" multiple times (7-8 times for e1): observe e1's clock transitions to empty
- Click until e1 completes: observe "READY" text replaces the clock overlay
- Verify the status panel shows "最后操作: 推进所有建造进度"

### Step 6: Add/Remove Queue Items
- Click "添加排队": a new e1 queue entry is added
- Verify the queue count badge on e1 updates (from "2" to "3")
- Click "移除排队": the last queue entry is removed
- Verify queue count decreases
- Click "完成一个": the first non-done/non-paused item completes immediately

### Step 7: Reset
- Click "重置队列": all items reset to their initial state
- Verify clock overlays return to initial angles
- Verify e3 returns to "HOLD" state (paused)
- Verify e2 shows a clock overlay (done reset to false, showing build progress)

### Step 8: Boundary Tests
- Resize the browser window: palette re-centers
- All 12 icons remain visible and properly spaced
- Clock overlays maintain aspect ratio (circular within cell bounds)

### Result Determination
- [ ] All 12 icons render in correct grid positions → PASS
- [ ] Clock overlays show correct angles for each progress state → PASS
- [ ] READY/HOLD/time/queue-count overlays display correctly → PASS
- [ ] Hotkey labels F1-F9 visible in gold → PASS
- [ ] Progress button updates clock angles correctly → PASS
- [ ] Partially failed → document specific issues

## Known Limitations

- Icon sprites/sprite sheets are not loaded (cells use background color as placeholder)
- ProductionQueue logic (cost deduction, tech tree, power) is not tested
- Left/right/middle-click interactions are mocked (no world order issuance)
- Tooltip integration is not tested (no TooltipContainerWidget)
- Pause/resume via right-click is not tested
- Building placement pickup is not tested
- Sound notifications are disabled

---

**审核状态**: ✅ 全部审核通过 (R1, 1 BLOCKER + 2 MAJOR 已修复, ebe3807)
