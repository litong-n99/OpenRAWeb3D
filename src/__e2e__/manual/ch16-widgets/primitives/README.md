# Widgets / Primitives — UI Controls Gallery

## Test Purpose

Verify that all Phase A UI widget primitives (Button, Label, TextField, Checkbox, Slider, ScrollPanel, Image, ColorBlock, GradientColorBlock, DropDownButton) render correctly in DOM, respond to user interaction, and maintain correct visual state transitions.

**OpenRA 对照**: OpenRA.Mods.Common/Widgets/*.cs (all Phase A widget implementations)

## Expected Behavior (Quantifiable Criteria)

1. **Button state transitions**: Clicking a normal ButtonWidget changes its `data-state` attribute from `"normal"` to `"pressed"` within 50ms of mousedown, and back to `"normal"` on mouseup. The `data-state="disabled"` attribute persists on disabled buttons regardless of clicks. The `data-state="hover"` attribute appears when the mouse enters the button bounds. Highlighted buttons have `data-highlighted="true"` set permanently.

2. **TextField input responsiveness**: Typing in the TextFieldWidget updates the status bar text within 50ms of each keystroke. The placeholder text "Enter your name..." displays in a grayed-out color when the field is empty (typically #888888 or similar; the exact shade is browser-dependent for native placeholder styling). The disabled field shows `cursor: not-allowed` and rejects all input.

3. **Checkbox toggle**: Clicking an unchecked CheckboxWidget toggles `data-checked` from `"false"` to `"true"` and the checkmark character ("✓") appears. Clicking again toggles back. The disabled checkbox does not respond to clicks and shows opacity at 0.5.

4. **Slider value tracking**: Dragging the SliderWidget thumb changes the `data-slider-value` attribute continuously. The filled track bar width updates in real-time during drag (no visible lag). On the ticked slider (11 ticks, values 0-10), the thumb snaps to exact tick positions.

5. **ScrollPanel geometry**: The 50-item ScrollPanelWidget shows a scrollbar thumb whose height is proportional to `(visible_height / content_height)` - approximately 20-30px for 200px visible / 1400px content. The thumb position changes smoothly during mouse wheel scroll. The scroll offset clamps correctly at top (0px) and bottom (negative value).

6. **Gradient rendering**: The four-corner GradientColorBlockWidget shows distinct colors at each corner (red top-left, blue top-right, green bottom-left, yellow-orange bottom-right) with smooth bilinear interpolation on a canvas element. The simple vertical gradient renders using CSS `linear-gradient` without canvas.

7. **DropDownButton panel**: Clicking the DropDownButtonWidget opens a panel with 4 options within 100ms. A full-screen transparent mask overlay captures clicks outside the panel. Clicking an option closes the panel and updates the button text. Pressing Escape also closes the panel.

## Verification Steps

### Step 1: Page Load
- Open `http://localhost:5173/test/widgets/primitives/`
- Confirm the info bar at the bottom shows UA, viewport, and timestamp
- Verify the expected results panel is visible in the top-right corner
- All 10 widget sections should be visible without horizontal overflow at 1280px width

### Step 2: ButtonWidget Verification
- Click the "Normal Button": observe `data-state="pressed"` appears briefly, status bar shows "Normal 被点击"
- Hover over "Normal Button": observe `data-state="hover"` and blue highlight
- Click "Disabled Button": observe no state change, status bar does NOT update
- Observe "Highlighted" button has `data-highlighted="true"` and persistent glow
- Click "Left", "Center", "Right" alignment buttons: text position matches alignment

### Step 3: LabelWidget Verification
- Observe: "Left aligned label" is flush-left in its bounds
- Observe: "Center aligned label" is centered, color #88ccff
- Observe: "Right aligned label" is flush-right, color #ffcc88
- Observe: "Contrast text" has a visible 4-directional text-shadow halo
- Observe: "Shadow text" has a diagonal bottom-right text-shadow

### Step 4: TextFieldWidget Verification
- Click in the first text field, type "Hello": status bar updates to "Hello" in real-time
- Observe the second field shows placeholder "Enter your name..." in gray
- Attempt to click/edit the disabled field: cursor shows `not-allowed`, no input accepted

### Step 5: CheckboxWidget Verification
- Click "Unchecked Option": checkmark appears, `data-checked="true"`
- Click again: checkmark disappears, `data-checked="false"`
- Click "Checked Option": checkmark disappears
- Click "Disabled (checked)": no change, checkmark stays with 50% opacity
- Verify status bar reflects all checkbox states

### Step 6: SliderWidget Verification
- Drag the continuous slider thumb left/right: value updates in real-time
- Click the track (not the thumb): value jumps to that position
- Drag the ticked slider: value snaps to integer positions 0-10
- Use Left/Right arrow keys on a focused slider: value changes by step

### Step 7: ScrollPanelWidget Verification
- Scroll the 50-item list using mouse wheel: content moves vertically
- Drag the scrollbar thumb up/down: content scrolls proportionally
- Click the scrollbar up/down arrow buttons: content scrolls one item at a time
- Verify thumb height changes if content changes (currently ~38px for 50 items)
- Verify scroll position clamps at top (0) and bottom (negative max)

### Step 8: Color & Gradient Widgets
- Observe 6 ColorBlockWidget instances with distinct colors: red, green, blue, yellow, purple, teal
- Click each color block: status bar updates with the clicked color
- Observe vertical gradient block: smooth blue-to-dark gradient (CSS)
- Observe four-corner gradient: distinct red/blue/green/yellow corners with smooth interpolation

### Step 9: DropDownButtonWidget
- Click "Select Option ▼": panel opens below with 4 options
- Click "Option Beta": panel closes, button text changes to "Option Beta"
- Click the button again, click the dark overlay area outside the panel: panel closes
- Open the panel, press Escape: panel closes

### Step 10: Boundary Tests
- Resize browser to 1024x768: all sections remain readable, no content cut off
- Rapidly click buttons: no double-event firing issues, each click registers once
- Scroll the ScrollPanel rapidly with mouse wheel: no visual tearing or stutter

### Result Determination
- [ ] All 10 widget types render without visual errors → PASS
- [ ] All interactive widgets respond to user input → PASS
- [ ] State transitions (disabled/hover/pressed/checked) are visually distinct → PASS
- [ ] ScrollPanel geometry is proportional → PASS
- [ ] Partially failed → document specific issues with screenshots

## Known Limitations

- Sound callbacks are not tested (no audio system integration)
- TooltipContainer integration is not tested (requires TooltipContainerWidget migration)
- WidgetLoader/YAML-based initialization is not tested (widgets are created programmatically)
- ChromeProvider sprite lookups are not tested (no sprite sheet assets loaded)
- ButtonWidget 9-slice panel backgrounds are approximated with CSS (full border-image TODO-16.A.2)

---

**审核状态**: ✅ 全部审核通过 (R1, 1 BLOCKER + 2 MAJOR 已修复, ebe3807)
