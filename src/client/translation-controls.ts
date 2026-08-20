export type TranslationDisplayState = 'translated' | 'original'

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
  getState(node: Text): TranslationDisplayState | undefined
  toggle(node: Text): void
  retranslate(node: Text): void
}

const HIGHLIGHT_NAME = 'dsh-ui-translate-visible'

export class TranslationControls {
  private readonly bar: HTMLDivElement
  private readonly actionButton: HTMLButtonElement
  private readonly style: HTMLStyleElement
  private readonly fallbackElements = new Set<Element>()
  private active: Text | undefined
  private hideTimer: number | undefined

  constructor(private readonly document: Document, private readonly options: TranslationControlsOptions) {
    this.style = document.createElement('style')
    this.style.dataset.dshUiTranslateControls = 'true'
    this.style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        background: color-mix(in srgb, #7c3aed 14%, transparent);
        text-decoration: underline 2px dashed #7c3aed;
        text-decoration-skip-ink: none;
      }
      .dsh-ui-translate-fallback-highlight {
        outline: 1px dashed #7c3aed !important;
        outline-offset: 1px;
      }
    `

    this.bar = document.createElement('div')
    this.bar.dataset.dshPlugin = 'ui-translate'
    this.bar.dataset.dshUiTranslateControls = 'true'
    this.bar.setAttribute('translate', 'no')
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
        this.hide()
        this.options.retranslate(node)
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
    this.document.defaultView?.addEventListener('scroll', this.hide, true)
    this.document.defaultView?.addEventListener('resize', this.hide)
  }

  dispose(): void {
    this.cancelHide()
    this.hide()
    this.document.removeEventListener('pointermove', this.onPointerMove, true)
    this.document.defaultView?.removeEventListener('scroll', this.hide, true)
    this.document.defaultView?.removeEventListener('resize', this.hide)
    this.registry()?.delete(HIGHLIGHT_NAME)
    this.clearFallbackHighlights()
    this.bar.remove()
    this.style.remove()
  }

  sync(nodes: Iterable<Text>): void {
    const activeNodes = [...nodes].filter(node => node.isConnected && this.options.getState(node) !== undefined)
    const registry = this.registry()
    const HighlightCtor = (this.document.defaultView as HighlightWindow | null)?.Highlight
    this.clearFallbackHighlights()
    if (registry === undefined || HighlightCtor === undefined) {
      for (const node of activeNodes) {
        const parent = node.parentElement
        if (parent === null) continue
        parent.classList.add('dsh-ui-translate-fallback-highlight')
        this.fallbackElements.add(parent)
      }
      return
    }
    const ranges = activeNodes.map(node => {
      const range = this.document.createRange()
      range.selectNodeContents(node)
      return range
    })
    if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME)
    else registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges))
  }

  showFor(node: Text): void {
    if (!node.isConnected || this.options.getState(node) === undefined) return
    this.cancelHide()
    this.active = node
    this.updateButtonLabel()
    this.bar.style.display = 'flex'
    this.position(node)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const target = event.target
    if (target !== null && typeof target === 'object' && 'nodeType' in target && this.bar.contains(target as Node)) return
    const node = this.textAtPoint(event.clientX, event.clientY) ?? this.textFromTarget(target)
    if (node !== undefined && this.options.getState(node) !== undefined) this.showFor(node)
    else this.scheduleHide()
  }

  private readonly hide = (): void => {
    this.active = undefined
    this.bar.style.display = 'none'
  }

  private scheduleHide(): void {
    this.cancelHide()
    this.hideTimer = this.document.defaultView?.setTimeout(this.hide, 250)
  }

  private cancelHide(): void {
    if (this.hideTimer !== undefined) this.document.defaultView?.clearTimeout(this.hideTimer)
    this.hideTimer = undefined
  }

  private textAtPoint(x: number, y: number): Text | undefined {
    const position = this.document.caretPositionFromPoint?.(x, y)
    const candidate = position?.offsetNode ?? (this.document as unknown as LegacyCaretDocument).caretRangeFromPoint?.(x, y)?.startContainer
    return candidate?.nodeType === this.document.defaultView?.Node.TEXT_NODE ? candidate as Text : undefined
  }

  private textFromTarget(target: EventTarget | null): Text | undefined {
    if (target === null || typeof target !== 'object' || !('nodeType' in target)) return undefined
    const node = target as Node
    if (node.nodeType === this.document.defaultView?.Node.TEXT_NODE) return node as Text
    const walker = this.document.createTreeWalker(node, this.document.defaultView?.NodeFilter.SHOW_TEXT ?? 4)
    let current = walker.nextNode()
    while (current !== null) {
      if (this.options.getState(current as Text) !== undefined) return current as Text
      current = walker.nextNode()
    }
    return undefined
  }

  private updateButtonLabel(): void {
    if (this.active === undefined) return
    this.actionButton.textContent = this.options.getState(this.active) === 'original' ? 'Re-translate' : 'Show original'
  }

  private position(node: Text): void {
    const range = this.document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    const view = this.document.defaultView
    const width = this.bar.offsetWidth || 180
    const left = Math.max(4, Math.min(rect.left, (view?.innerWidth ?? 1024) - width - 4))
    const top = Math.max(4, Math.min(rect.bottom + 3, (view?.innerHeight ?? 768) - 34))
    this.bar.style.left = `${left}px`
    this.bar.style.top = `${top}px`
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

  private clearFallbackHighlights(): void {
    for (const element of this.fallbackElements) element.classList.remove('dsh-ui-translate-fallback-highlight')
    this.fallbackElements.clear()
  }

  private registry(): HighlightRegistryLike | undefined {
    return (this.document.defaultView?.CSS as (typeof CSS & { highlights?: HighlightRegistryLike }) | undefined)?.highlights
  }
}
