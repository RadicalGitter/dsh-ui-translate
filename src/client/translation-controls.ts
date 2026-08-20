import type { TranslationMarkerStyle } from '../core/appearance.ts'

export type TranslationDisplayState = 'translated' | 'original'
export const TRANSLATION_HOVER_DELAY_MS = 650

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

interface HighlightWindow extends Window {
  Highlight?: new (...ranges: Range[]) => unknown
}

interface LegacyCaretDocument {
  caretRangeFromPoint?(x: number, y: number): Range | null
}

export interface TranslationControlsOptions {
  markerStyle: TranslationMarkerStyle
  getState(node: Text): TranslationDisplayState | undefined
  toggle(node: Text): void
  retranslate(node: Text): void
}

const HIGHLIGHT_NAME = 'dsh-ui-translate-visible'

export class TranslationControls {
  private readonly bar: HTMLDivElement
  private readonly actionButton: HTMLButtonElement
  private readonly style: HTMLStyleElement
  private readonly fallbackMarkers = new Set<HTMLElement>()
  private active: Text | undefined
  private hoverNode: Text | undefined
  private hideTimer: number | undefined
  private hoverTimer: number | undefined
  private markerStyle: TranslationMarkerStyle

  constructor(private readonly document: Document, private readonly options: TranslationControlsOptions) {
    this.markerStyle = options.markerStyle
    this.style = document.createElement('style')
    this.style.dataset.dshUiTranslateControls = 'true'
    this.renderMarkerStyle()

    this.bar = document.createElement('div')
    this.bar.dataset.dshPlugin = 'ui-translate'
    this.bar.dataset.dshUiTranslateControls = 'true'
    this.bar.setAttribute('translate', 'no')
    this.bar.setAttribute('role', 'toolbar')
    this.bar.setAttribute('aria-label', 'Translation controls')
    Object.assign(this.bar.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'none',
      gap: '4px',
      padding: '4px',
      border: '1px solid rgba(124, 58, 237, .75)',
      borderRadius: '7px',
      background: 'rgba(17, 24, 39, .96)',
      boxShadow: '0 4px 14px rgba(0, 0, 0, .3)',
      font: '12px/1.2 system-ui, sans-serif',
    })

    this.actionButton = this.createButton('translation-action')
    this.bar.append(this.actionButton)

    this.actionButton.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const node = this.active
      if (node === undefined) return
      if (this.options.getState(node) === 'original') {
        const owner = node.parentElement
        this.hide()
        this.options.retranslate(node)
        const HTMLElementCtor = this.document.defaultView?.HTMLElement
        if (HTMLElementCtor !== undefined && owner instanceof HTMLElementCtor && owner.tabIndex >= 0) owner.focus({ preventScroll: true })
      } else {
        this.options.toggle(node)
        this.updateButtonLabel()
        this.position(node)
      }
    })
    this.bar.addEventListener('pointerenter', () => this.cancelHide())
    this.bar.addEventListener('pointerleave', () => this.scheduleHide())
  }

  start(): void {
    this.document.head?.append(this.style)
    this.document.body?.append(this.bar)
    this.document.addEventListener('pointermove', this.onPointerMove, true)
    this.document.addEventListener('contextmenu', this.onContextMenu, true)
    this.document.addEventListener('focusin', this.onFocusIn, true)
    this.document.addEventListener('focusout', this.onFocusOut, true)
    this.document.defaultView?.addEventListener('scroll', this.reset, true)
    this.document.defaultView?.addEventListener('resize', this.reset)
  }

  setMarkerStyle(markerStyle: TranslationMarkerStyle): void {
    if (this.markerStyle === markerStyle) return
    this.markerStyle = markerStyle
    this.renderMarkerStyle()
  }

  dispose(): void {
    this.cancelHide()
    this.cancelHover()
    this.hide()
    this.document.removeEventListener('pointermove', this.onPointerMove, true)
    this.document.removeEventListener('contextmenu', this.onContextMenu, true)
    this.document.removeEventListener('focusin', this.onFocusIn, true)
    this.document.removeEventListener('focusout', this.onFocusOut, true)
    this.document.defaultView?.removeEventListener('scroll', this.reset, true)
    this.document.defaultView?.removeEventListener('resize', this.reset)
    this.registry()?.delete(HIGHLIGHT_NAME)
    this.clearFallbackHighlights()
    this.bar.remove()
    this.style.remove()
  }

  sync(nodes: Iterable<Text>): void {
    if (this.hoverNode !== undefined && (!this.hoverNode.isConnected || this.options.getState(this.hoverNode) === undefined)) this.cancelHover()
    if (this.active !== undefined && (!this.active.isConnected || this.options.getState(this.active) === undefined)) this.hide()
    const activeNodes = [...nodes].filter(node => node.isConnected && this.options.getState(node) !== undefined)
    const registry = this.registry()
    const HighlightCtor = (this.document.defaultView as HighlightWindow | null)?.Highlight
    this.clearFallbackHighlights()
    if (this.markerStyle === 'none') {
      registry?.delete(HIGHLIGHT_NAME)
      return
    }
    if (registry === undefined || HighlightCtor === undefined) {
      for (const node of activeNodes) this.createFallbackMarkers(node)
      return
    }
    const ranges = activeNodes.map(node => this.visibleRange(node))
    if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME)
    else registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges))
  }

  showFor(node: Text): void {
    if (!node.isConnected || this.options.getState(node) === undefined) return
    this.cancelHover()
    this.cancelHide()
    this.active = node
    this.updateButtonLabel()
    this.bar.style.display = 'flex'
    this.position(node)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const target = event.target
    if (target !== null && typeof target === 'object' && 'nodeType' in target && this.bar.contains(target as Node)) return
    const node = this.textAtPoint(event.clientX, event.clientY) ?? this.textFromTarget(target, event.clientX, event.clientY)
    if (node === undefined || this.options.getState(node) === undefined) {
      this.cancelHover()
      this.scheduleHide()
      return
    }
    this.cancelHide()
    if (this.active === node && this.bar.style.display !== 'none') return
    if (this.active !== undefined) this.hide()
    this.scheduleShow(node)
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    const node = this.textAtPoint(event.clientX, event.clientY) ?? this.textFromTarget(event.target, event.clientX, event.clientY)
    if (node === undefined || this.options.getState(node) === undefined) return
    event.preventDefault()
    event.stopPropagation()
    this.showFor(node)
  }

  private readonly onFocusIn = (event: FocusEvent): void => {
    if (event.target !== null && typeof event.target === 'object' && 'nodeType' in event.target && this.bar.contains(event.target as Node)) return
    const node = this.firstTranslatedText(event.target)
    if (node !== undefined) this.showFor(node)
  }

  private readonly onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget
    if (next !== null && typeof next === 'object' && 'nodeType' in next && this.bar.contains(next as Node)) return
    this.reset()
  }

  private readonly hide = (): void => {
    this.active = undefined
    this.bar.style.display = 'none'
  }

  private readonly reset = (): void => {
    this.cancelHover()
    this.cancelHide()
    this.hide()
    if (this.registry() === undefined) this.clearFallbackHighlights()
  }

  private scheduleShow(node: Text): void {
    if (this.hoverNode === node && this.hoverTimer !== undefined) return
    this.cancelHover()
    this.hoverNode = node
    this.hoverTimer = this.document.defaultView?.setTimeout(() => {
      this.hoverTimer = undefined
      this.hoverNode = undefined
      this.showFor(node)
    }, TRANSLATION_HOVER_DELAY_MS)
  }

  private cancelHover(): void {
    if (this.hoverTimer !== undefined) this.document.defaultView?.clearTimeout(this.hoverTimer)
    this.hoverTimer = undefined
    this.hoverNode = undefined
  }

  private scheduleHide(): void {
    if (this.hideTimer !== undefined || this.active === undefined) return
    this.hideTimer = this.document.defaultView?.setTimeout(() => {
      this.hideTimer = undefined
      this.hide()
    }, 250)
  }

  private cancelHide(): void {
    if (this.hideTimer !== undefined) this.document.defaultView?.clearTimeout(this.hideTimer)
    this.hideTimer = undefined
  }

  private textAtPoint(x: number, y: number): Text | undefined {
    const position = this.document.caretPositionFromPoint?.(x, y)
    const candidate = position?.offsetNode ?? (this.document as unknown as LegacyCaretDocument).caretRangeFromPoint?.(x, y)?.startContainer
    if (candidate?.nodeType !== this.document.defaultView?.Node.TEXT_NODE) return undefined
    const text = candidate as Text
    return this.options.getState(text) !== undefined && this.containsPoint(text, x, y) ? text : undefined
  }

  private firstTranslatedText(target: EventTarget | null): Text | undefined {
    if (target === null || typeof target !== 'object' || !('nodeType' in target)) return undefined
    const node = target as Node
    if (node.nodeType === this.document.defaultView?.Node.TEXT_NODE) {
      const text = node as Text
      return this.options.getState(text) !== undefined ? text : undefined
    }
    const walker = this.document.createTreeWalker(node, this.document.defaultView?.NodeFilter.SHOW_TEXT ?? 4)
    let current = walker.nextNode()
    while (current !== null) {
      if (this.options.getState(current as Text) !== undefined) return current as Text
      current = walker.nextNode()
    }
    return undefined
  }

  private textFromTarget(target: EventTarget | null, x: number, y: number): Text | undefined {
    if (target === null || typeof target !== 'object' || !('nodeType' in target)) return undefined
    const node = target as Node
    if (node.nodeType === this.document.defaultView?.Node.TEXT_NODE) {
      const text = node as Text
      return this.options.getState(text) !== undefined && this.containsPoint(text, x, y) ? text : undefined
    }
    const walker = this.document.createTreeWalker(node, this.document.defaultView?.NodeFilter.SHOW_TEXT ?? 4)
    let current = walker.nextNode()
    while (current !== null) {
      const text = current as Text
      if (this.options.getState(text) !== undefined && this.containsPoint(text, x, y)) return text
      current = walker.nextNode()
    }
    return undefined
  }

  private containsPoint(node: Text, x: number, y: number): boolean {
    const range = this.visibleRange(node)
    const rects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : [range.getBoundingClientRect()]
    return rects.some(rect => rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  }

  private updateButtonLabel(): void {
    if (this.active === undefined) return
    this.actionButton.textContent = this.options.getState(this.active) === 'original' ? 'Re-translate' : 'Show original'
  }

  private visibleRange(node: Text): Range {
    const range = this.document.createRange()
    const start = node.data.length - node.data.trimStart().length
    const end = node.data.trimEnd().length
    range.setStart(node, Math.min(start, node.data.length))
    range.setEnd(node, Math.max(start, end))
    return range
  }

  private position(node: Text): void {
    const range = this.visibleRange(node)
    const rect = range.getBoundingClientRect()
    const view = this.document.defaultView
    const width = this.bar.offsetWidth || 180
    const left = Math.max(4, Math.min(rect.left, (view?.innerWidth ?? 1024) - width - 4))
    const top = Math.max(4, Math.min(rect.bottom + 3, (view?.innerHeight ?? 768) - 34))
    this.bar.style.left = `${left}px`
    this.bar.style.top = `${top}px`
  }

  private renderMarkerStyle(): void {
    const overlay = this.markerStyle === 'overlay' || this.markerStyle === 'both'
    const underline = this.markerStyle === 'underline' || this.markerStyle === 'both'
    this.style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        ${overlay ? 'background: color-mix(in srgb, #7c3aed 14%, transparent);' : ''}
        ${underline ? 'text-decoration: underline 2px dashed #7c3aed; text-decoration-skip-ink: none;' : ''}
      }
      .dsh-ui-translate-fallback-marker {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        box-sizing: border-box;
        ${overlay ? 'background: color-mix(in srgb, #7c3aed 14%, transparent); border-radius: 2px;' : ''}
        ${underline ? 'border-bottom: 2px dashed #7c3aed;' : ''}
      }
    `
  }

  private createButton(action: string): HTMLButtonElement {
    const button = this.document.createElement('button')
    button.type = 'button'
    button.dataset.action = action
    Object.assign(button.style, {
      border: '1px solid rgba(167, 139, 250, .65)',
      borderRadius: '5px',
      padding: '3px 7px',
      color: '#f5f3ff',
      background: 'rgba(124, 58, 237, .35)',
      cursor: 'pointer',
      font: 'inherit',
    })
    return button
  }

  private createFallbackMarkers(node: Text): void {
    const range = this.visibleRange(node)
    const rects = typeof range.getClientRects === 'function'
      ? [...range.getClientRects()]
      : typeof range.getBoundingClientRect === 'function' ? [range.getBoundingClientRect()] : []
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue
      const marker = this.document.createElement('span')
      marker.dataset.dshPlugin = 'ui-translate'
      marker.dataset.dshUiTranslateFallbackMarker = 'true'
      marker.className = 'dsh-ui-translate-fallback-marker'
      Object.assign(marker.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      this.document.body?.append(marker)
      this.fallbackMarkers.add(marker)
    }
  }

  private clearFallbackHighlights(): void {
    for (const marker of this.fallbackMarkers) marker.remove()
    this.fallbackMarkers.clear()
  }

  private registry(): HighlightRegistryLike | undefined {
    return (this.document.defaultView?.CSS as (typeof CSS & { highlights?: HighlightRegistryLike }) | undefined)?.highlights
  }
}
