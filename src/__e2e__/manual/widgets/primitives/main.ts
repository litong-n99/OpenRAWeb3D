/**
 * widgets/primitives/main.ts — Primitive UI Controls Gallery acceptance test
 *
 * Renders all Phase A widgets in a gallery layout, allowing interactive
 * verification of rendering, state transitions, and event handling.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/*.cs (all Phase A widgets)
 */
import { Ui, type WidgetEvent } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ButtonWidget } from '../../../../OpenRA.Mods.Common/Widgets/ButtonWidget.js'
import { LabelWidget } from '../../../../OpenRA.Mods.Common/Widgets/LabelWidget.js'
import { TextFieldWidget } from '../../../../OpenRA.Mods.Common/Widgets/TextFieldWidget.js'
import { CheckboxWidget } from '../../../../OpenRA.Mods.Common/Widgets/CheckboxWidget.js'
import { SliderWidget } from '../../../../OpenRA.Mods.Common/Widgets/SliderWidget.js'
import { ScrollPanelWidget, ScrollBar } from '../../../../OpenRA.Mods.Common/Widgets/ScrollPanelWidget.js'
import { ImageWidget } from '../../../../OpenRA.Mods.Common/Widgets/ImageWidget.js'
import { ColorBlockWidget } from '../../../../OpenRA.Mods.Common/Widgets/ColorBlockWidget.js'
import { GradientColorBlockWidget } from '../../../../OpenRA.Mods.Common/Widgets/GradientColorBlockWidget.js'
import { DropDownButtonWidget } from '../../../../OpenRA.Mods.Common/Widgets/DropDownButtonWidget.js'
import { TextAlign } from '../../../../OpenRA.Mods.Common/Widgets/TextAlign.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-fps')!.textContent = '-'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}
updateInfoBar()
setInterval(updateInfoBar, 1000)

// ---------------------------------------------------------------------------
// Gallery container
// ---------------------------------------------------------------------------

const gallery = document.getElementById('gallery')!

function createSection(title: string, desc: string): { container: HTMLDivElement; sandboxRows: HTMLDivElement[]; statusEl: HTMLElement } {
  const section = document.createElement('div')
  section.className = 'widget-section'
  section.innerHTML = `<h3>${title}</h3><div class="desc">${desc}</div>`
  const sandboxArea = document.createElement('div')
  sandboxArea.className = 'sandbox-area'
  section.appendChild(sandboxArea)
  const statusEl = document.createElement('div')
  statusEl.className = 'status-text'
  section.appendChild(statusEl)
  gallery.appendChild(section)
  return { container: sandboxArea, sandboxRows: [], statusEl }
}

function createSandboxRow(parent: HTMLElement, height: number): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'sandbox-row'
  row.style.minHeight = `${height}px`
  parent.appendChild(row)
  return row
}

// ---------------------------------------------------------------------------
// Helper: mount a widget tree into a DOM element and set up event routing
// ---------------------------------------------------------------------------

// Track all mounted widgets for direct event routing and per-frame tick
const mountedWidgets: Widget[] = []

function mountWidget(widget: Widget, container: HTMLElement): void {
  const el = widget.renderOuter()
  container.appendChild(el)
  mountedWidgets.push(widget)

  // Route DOM events directly to the widget (NOT via Ui.handleInput, which
  // dispatches through Ui.root — a 0×0 bounds widget with no children).
  const eventTypes = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'keydown', 'keyup']
  for (const type of eventTypes) {
    container.addEventListener(type, (e: Event) => {
      const me = e as MouseEvent
      // Transform screen-absolute clientX/Y to container-relative coordinates
      const rect = container.getBoundingClientRect()
      const widgetEvent: WidgetEvent = {
        type,
        stopPropagation: () => e.stopPropagation(),
        target: me.target as HTMLElement | null,
        clientX: me.clientX - rect.left,
        clientY: me.clientY - rect.top,
        button: me.button,
        deltaY: (e as WheelEvent).deltaY,
        key: (e as KeyboardEvent).key,
        ctrlKey: (e as KeyboardEvent).ctrlKey,
        altKey: (e as KeyboardEvent).altKey,
        shiftKey: (e as KeyboardEvent).shiftKey,
        metaKey: (e as KeyboardEvent).metaKey,
        repeat: (e as KeyboardEvent).repeat,
      }
      const handled = widget.handleEventOuter(widgetEvent)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// 1. ButtonWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'ButtonWidget',
    '状态: normal / disabled / pressed / highlighted。文本对齐: left / center / right。'
  )
  statusEl.innerHTML = '最后点击: <span class="val" id="btn-status">(无)</span>'

  // Normal button
  {
    const row = createSandboxRow(container, 44)
    const btn = new ButtonWidget()
    btn.id = 'btn-normal'
    btn.text = 'Normal Button'
    btn.bounds = { x: 8, y: 6, width: 150, height: 32 }
    btn.onClick = () => {
      document.getElementById('btn-status')!.textContent = 'Normal 被点击'
    }
    mountWidget(btn, row)
  }

  // Disabled button
  {
    const row = createSandboxRow(container, 44)
    const btn = new ButtonWidget()
    btn.id = 'btn-disabled'
    btn.text = 'Disabled Button'
    btn.disabled = true
    btn.bounds = { x: 8, y: 6, width: 150, height: 32 }
    btn.onClick = () => {
      document.getElementById('btn-status')!.textContent = 'Disabled (不应触发)'
    }
    mountWidget(btn, row)
  }

  // Highlighted button
  {
    const row = createSandboxRow(container, 44)
    const btn = new ButtonWidget()
    btn.id = 'btn-highlighted'
    btn.text = 'Highlighted'
    btn.highlighted = true
    btn.bounds = { x: 8, y: 6, width: 150, height: 32 }
    btn.onClick = () => {
      document.getElementById('btn-status')!.textContent = 'Highlighted 被点击'
    }
    mountWidget(btn, row)
  }

  // Alignment variants
  {
    const row = createSandboxRow(container, 44)
    const btnL = new ButtonWidget()
    btnL.text = 'Left'
    btnL.align = TextAlign.Left
    btnL.bounds = { x: 8, y: 6, width: 90, height: 32 }
    btnL.onClick = () => { document.getElementById('btn-status')!.textContent = 'Left 被点击' }
    mountWidget(btnL, row)

    const btnC = new ButtonWidget()
    btnC.text = 'Center'
    btnC.align = TextAlign.Center
    btnC.bounds = { x: 106, y: 6, width: 90, height: 32 }
    btnC.onClick = () => { document.getElementById('btn-status')!.textContent = 'Center 被点击' }
    mountWidget(btnC, row)

    const btnR = new ButtonWidget()
    btnR.text = 'Right'
    btnR.align = TextAlign.Right
    btnR.bounds = { x: 204, y: 6, width: 90, height: 32 }
    btnR.onClick = () => { document.getElementById('btn-status')!.textContent = 'Right 被点击' }
    mountWidget(btnR, row)
  }
}

// ---------------------------------------------------------------------------
// 2. LabelWidget Section
// ---------------------------------------------------------------------------

{
  const { container } = createSection(
    'LabelWidget',
    '对齐: left / center / right。效果: contrast / shadow。'
  )

  // Standard labels
  {
    const row = createSandboxRow(container, 36)
    const lbl = new LabelWidget()
    lbl.text = 'Left aligned label'
    lbl.align = TextAlign.Left
    lbl.textColor = '#cccccc'
    lbl.bounds = { x: 8, y: 4, width: 300, height: 28 }
    mountWidget(lbl, row)
  }

  {
    const row = createSandboxRow(container, 36)
    const lbl = new LabelWidget()
    lbl.text = 'Center aligned label'
    lbl.align = TextAlign.Center
    lbl.textColor = '#88ccff'
    lbl.bounds = { x: 8, y: 4, width: 300, height: 28 }
    mountWidget(lbl, row)
  }

  {
    const row = createSandboxRow(container, 36)
    const lbl = new LabelWidget()
    lbl.text = 'Right aligned label'
    lbl.align = TextAlign.Right
    lbl.textColor = '#ffcc88'
    lbl.bounds = { x: 8, y: 4, width: 300, height: 28 }
    mountWidget(lbl, row)
  }

  // Contrast and shadow
  {
    const row = createSandboxRow(container, 40)
    const lblC = new LabelWidget()
    lblC.text = 'Contrast text'
    lblC.contrast = true
    lblC.align = TextAlign.Center
    lblC.textColor = '#ffffff'
    lblC.contrastColorDark = '#000000'
    lblC.contrastColorLight = '#444444'
    lblC.bounds = { x: 8, y: 4, width: 140, height: 32 }
    mountWidget(lblC, row)

    const lblS = new LabelWidget()
    lblS.text = 'Shadow text'
    lblS.shadow = true
    lblS.align = TextAlign.Center
    lblS.textColor = '#ffffff'
    lblS.contrastColorDark = '#000000'
    lblS.bounds = { x: 160, y: 4, width: 140, height: 32 }
    mountWidget(lblS, row)
  }
}

// ---------------------------------------------------------------------------
// 3. TextFieldWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'TextFieldWidget',
    '状态: 空/有文本/placeholder/disabled。'
  )
  statusEl.innerHTML = '当前文本: <span class="val" id="tf-value">(空)</span>'

  // Normal text field
  {
    const row = createSandboxRow(container, 44)
    const tf = new TextFieldWidget()
    tf.bounds = { x: 8, y: 6, width: 250, height: 32 }
    tf.textColor = '#ffffff'
    tf.caretColor = '#ffffff'
    tf.onTextEdited = () => {
      document.getElementById('tf-value')!.textContent = tf.text || '(空)'
    }
    mountWidget(tf, row)

    // Label
    const lbl = new LabelWidget()
    lbl.text = 'Type here ->'
    lbl.textColor = '#888'
    lbl.bounds = { x: 270, y: 10, width: 100, height: 24 }
    mountWidget(lbl, row)
  }

  // With placeholder
  {
    const row = createSandboxRow(container, 44)
    const tf = new TextFieldWidget()
    tf.bounds = { x: 8, y: 6, width: 250, height: 32 }
    tf.placeholder = 'Enter your name...'
    tf.textColor = '#ffffff'
    mountWidget(tf, row)
  }

  // Disabled
  {
    const row = createSandboxRow(container, 44)
    const tf = new TextFieldWidget()
    tf.bounds = { x: 8, y: 6, width: 250, height: 32 }
    tf.textColor = '#ffffff'
    tf.text = 'Disabled - cannot edit'
    tf.disabled = true
    mountWidget(tf, row)
  }
}

// ---------------------------------------------------------------------------
// 4. CheckboxWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'CheckboxWidget',
    '状态: checked / unchecked / disabled。'
  )
  statusEl.innerHTML = '复选框值: <span class="val" id="cb-status">-</span>'

  function updateCheckboxStatus(): void {
    const parts: string[] = []
    const checks = document.querySelectorAll('[data-cb-id]')
    for (const el of checks) {
      const id = el.getAttribute('data-cb-id')
      const checked = el.getAttribute('data-checked')
      parts.push(`${id}=${checked}`)
    }
    document.getElementById('cb-status')!.textContent = parts.join(', ') || '-'
  }

  // Checked
  {
    const row = createSandboxRow(container, 44)
    const cb = new CheckboxWidget()
    cb.id = 'cb-checked'
    cb.text = 'Checked Option'
    cb.setValue(true)
    cb.bounds = { x: 8, y: 6, width: 200, height: 32 }
    cb.onCheckboxChange = () => {
      setTimeout(updateCheckboxStatus, 50)
    }
    mountWidget(cb, row)
  }

  // Unchecked
  {
    const row = createSandboxRow(container, 44)
    const cb = new CheckboxWidget()
    cb.id = 'cb-unchecked'
    cb.text = 'Unchecked Option'
    cb.setValue(false)
    cb.bounds = { x: 8, y: 6, width: 200, height: 32 }
    cb.onCheckboxChange = () => {
      setTimeout(updateCheckboxStatus, 50)
    }
    mountWidget(cb, row)
  }

  // Disabled checked
  {
    const row = createSandboxRow(container, 44)
    const cb = new CheckboxWidget()
    cb.id = 'cb-disabled'
    cb.text = 'Disabled (checked)'
    cb.disabled = true
    cb.setValue(true)
    cb.bounds = { x: 8, y: 6, width: 200, height: 32 }
    mountWidget(cb, row)
  }

  // Update status after initial render
  setTimeout(updateCheckboxStatus, 100)
}

// ---------------------------------------------------------------------------
// 5. SliderWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'SliderWidget',
    '连续滑块 + 带刻度滑块。拖拽手柄或点击轨道调整值。'
  )
  statusEl.innerHTML = '滑块值: <span class="val" id="sl-value">-</span>'

  // Continuous slider
  {
    const row = createSandboxRow(container, 50)
    const lbl = new LabelWidget()
    lbl.text = '连续:'
    lbl.textColor = '#888'
    lbl.bounds = { x: 8, y: 10, width: 50, height: 28 }
    mountWidget(lbl, row)

    const sl = new SliderWidget()
    sl.bounds = { x: 60, y: 12, width: 240, height: 24 }
    sl.minimumValue = 0
    sl.maximumValue = 100
    sl.value = 50
    sl.onChange = (v: number) => {
      document.getElementById('sl-value')!.innerHTML =
        `连续: ${v.toFixed(1)}`
    }
    mountWidget(sl, row)
  }

  // Ticked slider
  {
    const row = createSandboxRow(container, 50)
    const lbl = new LabelWidget()
    lbl.text = '刻度:'
    lbl.textColor = '#888'
    lbl.bounds = { x: 8, y: 10, width: 50, height: 28 }
    mountWidget(lbl, row)

    const sl = new SliderWidget()
    sl.bounds = { x: 60, y: 12, width: 240, height: 24 }
    sl.minimumValue = 0
    sl.maximumValue = 10
    sl.value = 5
    sl.ticks = 11
    sl.onChange = (v: number) => {
      document.getElementById('sl-value')!.innerHTML =
        `刻度: ${v.toFixed(0)} (${(sl as any)._isMoving ? '拖拽中' : '已释放'})`
    }
    mountWidget(sl, row)
  }
}

// ---------------------------------------------------------------------------
// 6. ScrollPanelWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'ScrollPanelWidget',
    '50 个条目列表。滚动条可见，滑块按比例缩放。'
  )
  statusEl.innerHTML = '滚动位置: <span class="val" id="sp-scroll">0px</span> | 滑块高度: <span class="val" id="sp-thumb">-</span>'

  const row = createSandboxRow(container, 200)
  const sp = new ScrollPanelWidget()
  sp.id = 'sp-demo'
  sp.bounds = { x: 8, y: 4, width: 300, height: 192 }
  sp.scrollBar = ScrollBar.Right
  sp.scrollbarWidth = 20
  sp.topBottomSpacing = 2
  sp.itemSpacing = 2

  // Create 50 label items
  for (let i = 0; i < 50; i++) {
    const item = new LabelWidget()
    item.text = i % 2 === 0
      ? `Item #${i + 1} — this is a scrollable row entry`
      : `Row ${i + 1}: Lorem ipsum dolor sit amet consectetur`
    item.textColor = i % 5 === 0 ? '#f9a825' : '#cccccc'
    item.font = '13px Arial'
    item.align = TextAlign.Left
    item.bounds = { x: 0, y: i * 28, width: 280, height: 26 }
    sp.addChild(item)
  }
  sp.contentHeight = 50 * 28

  mountWidget(sp, row)

  // Monitor scroll state
  const monitorScroll = (): void => {
    const offset = (sp as any)._currentListOffset ?? 0
    const thumbH = (sp as any)._thumbHeight ?? 0
    document.getElementById('sp-scroll')!.textContent = `${offset.toFixed(0)}px`
    document.getElementById('sp-thumb')!.textContent = `${thumbH.toFixed(0)}px`
    requestAnimationFrame(monitorScroll)
  }
  requestAnimationFrame(monitorScroll)
}

// ---------------------------------------------------------------------------
// 7. ImageWidget Section
// ---------------------------------------------------------------------------

{
  const { container } = createSection(
    'ImageWidget',
    '通过 CSS background-image 渲染占位图像区域。'
  )

  {
    const row = createSandboxRow(container, 60)
    const img = new ImageWidget()
    img.imageCollection = ''
    img.imageName = ''
    img.bounds = { x: 8, y: 8, width: 48, height: 48 }
    // When no image URL is available, show a colored placeholder via DOM manipulation
    img.getImageUrl = () => ''
    mountWidget(img, row)

    const lbl = new LabelWidget()
    lbl.text = 'ImageWidget (no image set) — shows empty bounds area'
    lbl.textColor = '#888'
    lbl.font = '12px Arial'
    lbl.bounds = { x: 64, y: 14, width: 260, height: 32 }
    mountWidget(lbl, row)
  }
}

// ---------------------------------------------------------------------------
// 8. ColorBlockWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'ColorBlockWidget',
    '纯色矩形。多种颜色展示。'
  )
  statusEl.innerHTML = '最后点击: <span class="val" id="cb-color">-</span>'

  const colors = ['#e53935', '#43a047', '#1e88e5', '#f9a825', '#8e24aa', '#00acc1']
  const row = createSandboxRow(container, 50)
  for (let i = 0; i < colors.length; i++) {
    const block = new ColorBlockWidget()
    block.color = colors[i]
    block.bounds = { x: 8 + i * 52, y: 8, width: 44, height: 32 }
    block.clickSound = null // No sound in test
    block.onMouseUp = () => {
      document.getElementById('cb-color')!.textContent = colors[i]
    }
    mountWidget(block, row)
  }
}

// ---------------------------------------------------------------------------
// 9. GradientColorBlockWidget Section
// ---------------------------------------------------------------------------

{
  const { container } = createSection(
    'GradientColorBlockWidget',
    '四角渐变矩形: canvas 双线性插值。'
  )

  // Horizontal gradient (simple CSS path)
  {
    const row = createSandboxRow(container, 50)
    const grad = new GradientColorBlockWidget()
    grad.topLeftColor = '#1e3a5f'
    grad.topRightColor = '#1e3a5f'
    grad.bottomLeftColor = '#0d1f33'
    grad.bottomRightColor = '#0d1f33'
    grad.bounds = { x: 8, y: 8, width: 150, height: 32 }
    mountWidget(grad, row)

    const lbl = new LabelWidget()
    lbl.text = 'Vertical gradient (CSS linear-gradient)'
    lbl.textColor = '#888'
    lbl.font = '12px Arial'
    lbl.bounds = { x: 168, y: 12, width: 180, height: 24 }
    mountWidget(lbl, row)
  }

  // Four-corner gradient (canvas path)
  {
    const row = createSandboxRow(container, 50)
    const grad = new GradientColorBlockWidget()
    grad.topLeftColor = '#e53935'
    grad.topRightColor = '#1e88e5'
    grad.bottomLeftColor = '#43a047'
    grad.bottomRightColor = '#f9a825'
    grad.bounds = { x: 8, y: 8, width: 150, height: 32 }
    mountWidget(grad, row)

    const lbl = new LabelWidget()
    lbl.text = 'Four-corner (canvas bilinear)'
    lbl.textColor = '#888'
    lbl.font = '12px Arial'
    lbl.bounds = { x: 168, y: 12, width: 180, height: 24 }
    mountWidget(lbl, row)
  }
}

// ---------------------------------------------------------------------------
// 10. DropDownButtonWidget Section
// ---------------------------------------------------------------------------

{
  const { container, statusEl } = createSection(
    'DropDownButtonWidget',
    '下拉按钮: 点击展开选项面板，遮罩关闭。'
  )
  statusEl.innerHTML = '状态: <span class="val" id="dd-status">关闭</span>'

  const row = createSandboxRow(container, 50)
  const dd = new DropDownButtonWidget()
  dd.id = 'dd-demo'
  dd.text = 'Select Option ▼'
  dd.bounds = { x: 8, y: 8, width: 180, height: 32 }
  dd.onClick = () => {
    if (dd.isOpen) {
      dd.removePanel()
      document.getElementById('dd-status')!.textContent = '关闭'
      return
    }
    const options = ['Option Alpha', 'Option Beta', 'Option Gamma', 'Option Delta']
    dd.showDropDown('dropdown-panel-template', 200, options, (opt: string, _tmpl: unknown) => {
      const itemEl = document.createElement('div')
      itemEl.className = 'dropdown-item'
      itemEl.style.padding = '8px 12px'
      itemEl.style.cursor = 'pointer'
      itemEl.style.color = '#fff'
      itemEl.style.fontSize = '14px'
      itemEl.textContent = opt
      itemEl.addEventListener('pointerenter', () => { itemEl.style.backgroundColor = '#3a3a4a' })
      itemEl.addEventListener('pointerleave', () => { itemEl.style.backgroundColor = '' })
      itemEl.addEventListener('click', () => {
        dd.removePanel()
        dd.text = opt
        document.getElementById('dd-status')!.textContent = `已选择: ${opt}`
      })
      return { itemEl }
    })
    document.getElementById('dd-status')!.textContent = '打开'
  }
  mountWidget(dd, row)
}

// ---------------------------------------------------------------------------
// Periodic tick (simulate game loop)
// ---------------------------------------------------------------------------

function gameLoopTick(): void {
  // Tick each mounted widget directly (Ui.root has 0x0 bounds with no children,
  // so Ui.tick() alone would not reach any test widget).
  for (const w of mountedWidgets) {
    w.tickOuter()
  }
  Ui.tick()
  requestAnimationFrame(gameLoopTick)
}
requestAnimationFrame(gameLoopTick)

// ---------------------------------------------------------------------------
// Dev console access
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  Ui,
  getGallery: () => gallery,
}
