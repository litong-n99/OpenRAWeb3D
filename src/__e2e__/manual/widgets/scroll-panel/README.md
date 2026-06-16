# Widgets / ScrollPanel — 滚动面板测试

## Test Purpose

Verify that the ScrollPanelWidget correctly handles scroll offset management, proportional thumb sizing, smooth scrolling physics, mouse wheel input, thumb drag, keyboard navigation, and scroll position clamping. This is the most complex Phase A widget with scrollbar geometry calculations, smooth scrolling interpolation, and button state management.

**OpenRA 对照**: OpenRA.Mods.Common/Widgets/ScrollPanelWidget.cs (527 lines)

## Expected Behavior (Quantifiable Criteria)

1. **Proportional thumb sizing**: With 50 items at 32px each (total content ~1600px) in a ~400px visible area, the scrollbar thumb height must be approximately `(visible_height / content_height) * track_height`. With scrollbarWidth=24px, track height = visible_height - 48px. For 400px visible, thumb height should be approximately 90-100px. The exact formula is `Math.max(minimumThumbSize, trackHeight * visibleHeight / contentHeight)`.

2. **Scroll position clamping**: When scrolled to the top, `currentListOffset` must be exactly 0. When scrolled to the bottom, `currentListOffset` must equal `visibleHeight - contentHeight` (a negative value). The offset must never be positive (content above visible area) or less than the bottom limit.

3. **Smooth scrolling decay**: When `scrollToTop(true)` or `scrollToBottom(true)` is called with smooth=true, the `currentListOffset` must approach `targetListOffset` via exponential decay with factor `smoothScrollSpeed=0.333`. After 200ms, the remaining distance should be less than 20% of the initial distance.

4. **Mouse wheel response**: Scrolling the mouse wheel by one notch (deltaY ≈ 100) scrolls the content by approximately `deltaY * uiScrollSpeed` pixels, with smooth interpolation. The direction matches: scroll down on mouse wheel = content moves up (more negative offset).

5. **Thumb drag tracking**: Dragging the scrollbar thumb maps the vertical mouse movement proportionally to scroll offset changes. Dragging the thumb from the center of the track to the bottom scrolls the content to the bottom. The scroll offset change is `(mouseDelta * scrollRange) / trackTravelRange`.

6. **Keyboard navigation**: ArrowUp scrolls up by 1 item height. ArrowDown scrolls down by 1 item height. PageUp scrolls up by one viewport height. PageDown scrolls down by one viewport height. Home scrolls to top. End scrolls to bottom.

## Verification Steps

### Step 1: Page Load
- Open `http://localhost:5173/test/widgets/scroll-panel/`
- Confirm the scroll panel fills the left portion of the screen
- Confirm the status panel on the right shows all scroll metrics
- Verify 50 items are rendered (Item #1 through Item #50 with section headers at #1, #11, #21, #31, #41)
- Item #25 is highlighted in yellow with contrast effect

### Step 2: Mouse Wheel Scrolling
- Hover over the scroll panel content area
- Scroll mouse wheel down slowly: observe content scrolls smoothly upward
- Scroll mouse wheel up slowly: observe content scrolls smoothly downward
- Verify: status panel shows "scroll down/up" in the last operation field
- Verify: scroll offset (st-offset) changes continuously, not in jumps
- Rapidly scroll: verify smooth scrolling catches up (exponential decay)

### Step 3: Scrollbar Thumb Drag
- Locate the scrollbar thumb on the right side
- Click and drag the thumb downward: content scrolls to the bottom
- Verify: `st-thumb-state` changes to "拖拽中" during drag
- Release the thumb: `st-thumb-state` returns to "释放"
- Drag the thumb upward: content scrolls to the top
- Verify: `st-offset` reaches exactly 0 at the top

### Step 4: Scrollbar Arrow Buttons
- Click the down-arrow button (bottom of scrollbar): content scrolls down by 1 item
- Click and hold the down-arrow: content continues scrolling (repeat via tick())
- Click the up-arrow button (top of scrollbar): content scrolls up by 1 item
- Verify: arrow buttons disable at scroll extremes (st-up-btn / st-down-btn show "禁用")

### Step 5: Keyboard Navigation
- Click the scroll panel area to focus it
- Press ArrowDown: scrolls down by 1 item
- Press ArrowUp: scrolls up by 1 item
- Press PageDown: scrolls down by one viewport height
- Press PageUp: scrolls up by one viewport height
- Press Home: scrolls to top (offset = 0)
- Press End: scrolls to bottom (offset = visibleHeight - contentHeight)

### Step 6: Programmatic Scroll Commands
- Click "Scroll To Top": content smoothly scrolls to the top
- Click "Scroll To Bottom": content smoothly scrolls to the bottom
- Click "Scroll To Item #25": content scrolls to make Item #25 visible
- Verify Item #25 (the yellow-highlighted row) is visible in the viewport
- Click "Scroll Up (5 items)": content scrolls up by 5 item heights
- Click "Scroll Down (5 items)": content scrolls down by 5 item heights

### Step 7: Thumb Proportion Verification
- At the top (all content visible starts at item #1): thumb height ≈ 90-100px
- Scroll to middle: thumb position moves proportionally
- Verify: `st-thumb-h` value is always >= minimumThumbSize (10px)
- Verify: thumb is not visible (or very small) if content fits entirely in viewport

### Step 8: Boundary Tests
- Rapid scroll up at the top: offset stays clamped at 0 (does not go positive)
- Rapid scroll down at the bottom: offset stays clamped at `visibleHeight - contentHeight`
- Drag thumb past top/bottom: offset clamps correctly
- Click up-arrow at top: button is disabled, no scroll occurs
- Click down-arrow at bottom: button is disabled, no scroll occurs

### Result Determination
- [ ] Scrolling works via mouse wheel, thumb drag, buttons, and keyboard → PASS
- [ ] Thumb height is proportional to visible/content ratio → PASS
- [ ] Scroll position clamps correctly at boundaries → PASS
- [ ] Smooth scrolling is visually smooth (no jumps or stutter) → PASS
- [ ] Partially failed → document specific issues with scroll offset values

## Known Limitations

- ScrollPanel binding to IObservableCollection is not tested (no dynamic data source)
- Item selection tracking (ScrollItemWidget.isSelected) is mocked with visual highlighting
- Performance with 1000+ items is not tested (uses 50 items)
- Touch/gesture scrolling is not tested (desktop-only verification)
- ScrollPanel nested inside another ScrollPanel is not tested
