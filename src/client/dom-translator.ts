import type { ClientBackendRegistry } from './backends.ts'
import { isKnownStaticPhrase } from '../core/static-phrases.ts'
import type { ResolvedUITranslateSettings } from './settings-model.ts'
import { TranslationControls, type TranslationDisplayState } from './translation-controls.ts'

const CHINESE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const MAX_STATIC_TEXT_LENGTH = 160
const MAX_CACHE_TEXT_LENGTH = 20_000
const CACHE_LIMIT = 800
const DOM_SOURCE_BATCH_SIZE = 8
const FLUSH_DELAY_MS = 40
const RETRY_DELAY_MS = 750
const NEGATIVE_CACHE_MS = 30_000

// These surfaces are never mutated. They are either actively editable or
// executable/verbatim content where translation would corrupt user input.
export const ALWAYS_SKIP_SELECTOR = [
  'textarea',
  'input',
  'select',
  'option',
  'code',
  'pre',
  'kbd',
  'samp',
  'script',
  'style',
  'noscript',
  '[contenteditable]',
  '[role="textbox"]',
  '[aria-multiline="true"]',
  '[data-input-backdrop]',
  '[translate="no"]',
  '.notranslate',
  '[data-dsh-plugin="ui-translate"]',
  '[data-dsh-composer]',
  '[data-composer]',
  '[data-slot*="composer" i]',
  '[data-dsh-part*="composer" i]',
  '[class*="composer" i]',
  '[class*="prompt-editor" i]',
  '[class*="contenteditable" i]',
].join(',')

// Network-backed and glossary modes retain the original private-content
// boundary. Only the explicitly selected browser-local model may translate
// these visible content surfaces.
export const REMOTE_CONTENT_SKIP_SELECTOR = [
  '[data-message-role]',
  '[data-message-id]',
  '[data-dsh-message]',
  '[data-session-id]',
  '[data-workspace-id]',
  '[data-search-result]',
  '[data-slot^="conversation."]',
  '[class*="message-content" i]',
  '[class*="session-title" i]',
  '[class*="workspace-name" i]',
  '[class*="search-result" i]',
  '[class*="history-item" i]',
  '[class*="nameCell" i]',
  '.markdown-body',
].join(',')

export function containsChinese(text: string): boolean {
  return CHINESE_RE.test(text)
}

export function isSafeLeafTextNode(node: Text, allowBrowserLocalModelText = false): boolean {
  const parent = node.parentElement
  if (parent === null || !node.isConnected) return false
  const text = node.data.trim()
  if (text.length === 0 || (!allowBrowserLocalModelText && text.length > MAX_STATIC_TEXT_LENGTH) || !containsChinese(text)) return false
  if (parent.isContentEditable || parent.closest('[hidden],[aria-hidden="true"],[inert]') !== null) return false
  if (parent.closest(ALWAYS_SKIP_SELECTOR) !== null) return false

  // The local model is deliberately comprehensive: messages, session and
  // workspace titles, search results, forms, live status text, and mixed
  // formatted prose are all visible presentation data and stay in-browser.
  if (allowBrowserLocalModelText) return true

  // Network-capable and glossary modes remain conservative and accept only
  // compile-time-known leaf UI phrases outside private/dynamic surfaces.
  if (!isKnownStaticPhrase(text)) return false
  if (parent.children.length > 0) return false
  if (parent.closest(REMOTE_CONTENT_SKIP_SELECTOR) !== null) return false
  if (parent.closest('form') !== null || parent.closest('[aria-live]') !== null) return false
  return true
}

function splitWhitespace(value: string): { prefix: string; core: string; suffix: string } {
  const match = /^(\s*)(.*?)(\s*)$/su.exec(value)
  return { prefix: match?.[1] ?? '', core: match?.[2] ?? value, suffix: match?.[3] ?? '' }
}

interface TranslationRecord {
  original: string
  translated: string
  showingOriginal: boolean
}

export class StaticDomTranslator {
  private settings: ResolvedUITranslateSettings
  private readonly cache = new Map<string, string>()
  private readonly negativeCache = new Map<string, number>()
  private readonly records = new WeakMap<Text, TranslationRecord>()
  private readonly translatedNodes = new Set<Text>()
  private readonly pendingRoots = new Set<Node>()
  private observer: MutationObserver | undefined
  private flushTimer: number | undefined
  private flushing = false
  private readonly activeRequests = new Set<AbortController>()
  private readonly retryCounts = new Map<string, number>()
  private readonly retryTimers = new Set<number>()
  private readonly controls: TranslationControls
  private generation = 0

  constructor(
    private readonly document: Document,
    private readonly backends: ClientBackendRegistry,
    initialSettings: ResolvedUITranslateSettings,
  ) {
    this.settings = initialSettings
    this.controls = new TranslationControls(document, {
      markerStyle: initialSettings.markerStyle,
      getState: node => this.displayState(node),
      toggle: node => this.toggleNode(node),
      retranslate: node => this.retranslateNode(node),
    })
  }

  start(): void {
    this.controls.start()
    this.document.addEventListener('scroll', this.onViewportChanged, true)
    this.document.addEventListener('pointerup', this.onViewportChanged, true)
    this.document.defaultView?.addEventListener('resize', this.onViewportChanged)
    this.syncObserver()
  }

  update(settings: ResolvedUITranslateSettings): void {
    const changed = JSON.stringify(settings) !== JSON.stringify(this.settings)
    if (!changed) return
    const { markerStyle: previousMarkerStyle, ...previousBehavior } = this.settings
    const { markerStyle: nextMarkerStyle, ...nextBehavior } = settings
    if (previousMarkerStyle !== nextMarkerStyle && JSON.stringify(previousBehavior) === JSON.stringify(nextBehavior)) {
      this.settings = settings
      this.controls.setMarkerStyle(nextMarkerStyle)
      this.syncControls()
      return
    }
    this.generation += 1
    this.abortActiveRequests()
    this.cancelScheduledFlush()
    this.cancelRetries()
    this.pendingRoots.clear()
    this.restore()
    this.settings = settings
    this.controls.setMarkerStyle(settings.markerStyle)
    this.syncObserver()
  }

  dispose(): void {
    this.generation += 1
    this.abortActiveRequests()
    this.observer?.disconnect()
    this.observer = undefined
    this.document.removeEventListener('scroll', this.onViewportChanged, true)
    this.document.removeEventListener('pointerup', this.onViewportChanged, true)
    this.document.defaultView?.removeEventListener('resize', this.onViewportChanged)
    this.cancelScheduledFlush()
    this.cancelRetries()
    this.pendingRoots.clear()
    this.restore()
    this.controls.dispose()
  }

  restore(): void {
    for (const node of this.translatedNodes) {
      const record = this.records.get(node)
      if (record !== undefined && node.isConnected && node.data === record.translated) node.data = record.original
      this.records.delete(node)
    }
    this.translatedNodes.clear()
    this.syncControls()
  }

  private displayState(node: Text): TranslationDisplayState | undefined {
    const record = this.records.get(node)
    if (record === undefined || !this.translatedNodes.has(node)) return undefined
    return record.showingOriginal ? 'original' : 'translated'
  }

  private toggleNode(node: Text): void {
    const record = this.records.get(node)
    if (record === undefined || !node.isConnected) return
    if (record.showingOriginal) {
      node.data = record.translated
      record.showingOriginal = false
    } else {
      node.data = record.original
      record.showingOriginal = true
    }
    this.syncControls()
  }

  private retranslateNode(node: Text): void {
    const record = this.records.get(node)
    if (record === undefined || !node.isConnected) return
    const { core } = splitWhitespace(record.original)
    node.data = record.original
    this.records.delete(node)
    this.translatedNodes.delete(node)
    for (const key of this.cache.keys()) if (key.endsWith(`\u0000${core}`)) this.cache.delete(key)
    for (const key of this.negativeCache.keys()) if (key.endsWith(`\u0000${core}`)) this.negativeCache.delete(key)
    this.syncControls()
    this.queue(node)
  }

  private readonly onViewportChanged = (): void => {
    if (this.document.body !== null) this.queue(this.document.body)
  }

  private abortActiveRequests(): void {
    for (const controller of this.activeRequests) controller.abort()
    this.activeRequests.clear()
  }

  private cancelScheduledFlush(): void {
    if (this.flushTimer !== undefined) this.document.defaultView?.clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private cancelRetries(): void {
    for (const timer of this.retryTimers) this.document.defaultView?.clearTimeout(timer)
    this.retryTimers.clear()
    this.retryCounts.clear()
    this.negativeCache.clear()
  }

  private rememberNegative(key: string): void {
    this.negativeCache.set(key, Date.now() + NEGATIVE_CACHE_MS)
    while (this.negativeCache.size > CACHE_LIMIT) this.negativeCache.delete(this.negativeCache.keys().next().value as string)
  }

  private syncControls(): void {
    for (const node of this.translatedNodes) {
      if (node.isConnected) continue
      this.records.delete(node)
      this.translatedNodes.delete(node)
    }
    this.controls.sync(this.translatedNodes)
  }

  private isOwnControlNode(node: Node): boolean {
    const view = this.document.defaultView
    if (view === null) return false
    const element = node instanceof view.Element ? node : node.parentElement
    return (element?.closest('[data-dsh-plugin="ui-translate"]') ?? null) !== null
  }

  private syncObserver(): void {
    this.observer?.disconnect()
    this.observer = undefined
    if (!this.settings.enabled || this.document.body === null) return
    const MutationObserverCtor = this.document.defaultView?.MutationObserver
    if (MutationObserverCtor === undefined) return
    this.observer = new MutationObserverCtor((mutations) => {
      let removedNodes = false
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          if (!this.isOwnControlNode(mutation.target)) this.queue(mutation.target)
        } else if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) if (!this.isOwnControlNode(node)) this.queue(node)
          if ([...mutation.removedNodes].some(node => !this.isOwnControlNode(node))) removedNodes = true
        } else if (mutation.target instanceof this.document.defaultView!.Element && mutation.target.closest('[data-dsh-plugin="ui-translate"]') === null) {
          this.queue(mutation.target)
        }
      }
      if (removedNodes) this.syncControls()
    })
    this.observer.observe(this.document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'style'],
    })
    this.queue(this.document.body)
  }

  private queue(root: Node): void {
    if (!this.settings.enabled) return
    this.pendingRoots.add(root)
    this.scheduleFlush()
  }

  private scheduleFlush(delay = FLUSH_DELAY_MS): void {
    if (!this.settings.enabled || this.flushTimer !== undefined || this.flushing || this.pendingRoots.size === 0) return
    this.flushTimer = this.document.defaultView?.setTimeout(() => {
      this.flushTimer = undefined
      if (this.flushing || !this.settings.enabled) return
      this.flushing = true
      void this.flush().catch(error => {
        console.warn('[dsh-ui-translate] DOM translation failed:', error)
      }).finally(() => {
        this.flushing = false
        if (this.pendingRoots.size > 0) this.scheduleFlush(0)
      })
    }, delay)
  }

  private isRenderedInViewport(node: Text): boolean {
    const view = this.document.defaultView
    const parent = node.parentElement
    if (view === null || parent === null) return false
    for (let element: Element | null = parent; element !== null; element = element.parentElement) {
      const style = view.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false
      if (element === this.document.body) break
    }
    try {
      const range = this.document.createRange()
      range.selectNodeContents(node)
      const rects = [...range.getClientRects()]
      if (rects.length === 0) return true
      return rects.some(rect => rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= view.innerHeight && rect.left <= view.innerWidth)
    } catch {
      return true
    }
  }

  private sourcePriority(source: string, nodes: Text[]): number {
    const highPriority = nodes.some(node => node.parentElement !== null && node.parentElement.closest([
      'nav',
      'aside',
      '[role="navigation"]',
      '[role="treeitem"]',
      '[aria-live]',
      'button',
      '[data-dsh-plugin="pet"]',
    ].join(',')) !== null)
    if (highPriority) return 0
    const conversationContent = nodes.some(node => node.parentElement !== null && node.parentElement.closest(REMOTE_CONTENT_SKIP_SELECTOR) !== null)
    if (conversationContent) return 2
    return source.length <= MAX_STATIC_TEXT_LENGTH ? 1 : 2
  }

  private collect(root: Node): Text[] {
    const view = this.document.defaultView
    if (view === null) return []
    const allowBrowserLocalModelText = this.settings.backend === 'browser-opus-mt'
    const accepts = (node: Text): boolean => isSafeLeafTextNode(node, allowBrowserLocalModelText)
      && (!allowBrowserLocalModelText || this.isRenderedInViewport(node))
    if (root.nodeType === view.Node.TEXT_NODE) return accepts(root as Text) ? [root as Text] : []
    const walker = this.document.createTreeWalker(root, view.NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let current = walker.nextNode()
    while (current !== null) {
      if (accepts(current as Text)) nodes.push(current as Text)
      current = walker.nextNode()
    }
    return nodes
  }

  private retryFailedSources(prefix: string, sources: string[], bySource: Map<string, Text[]>): void {
    const generation = this.generation
    const retryable = sources.filter(source => {
      const key = prefix + source
      const count = this.retryCounts.get(key) ?? 0
      if (count >= 1) {
        this.rememberNegative(key)
        return false
      }
      this.retryCounts.set(key, count + 1)
      return true
    })
    if (retryable.length === 0) return
    const timer = this.document.defaultView?.setTimeout(() => {
      if (timer !== undefined) this.retryTimers.delete(timer)
      if (generation !== this.generation || !this.settings.enabled) return
      for (const source of retryable) for (const node of bySource.get(source) ?? []) this.queue(node)
    }, RETRY_DELAY_MS)
    if (timer !== undefined) this.retryTimers.add(timer)
  }

  private async flush(): Promise<void> {
    if (!this.settings.enabled) return
    const generation = this.generation
    const roots = [...this.pendingRoots]
    this.pendingRoots.clear()
    const nodes = [...new Set(roots.flatMap(root => this.collect(root)))]
    if (nodes.length === 0) return

    const bySource = new Map<string, Text[]>()
    for (const node of nodes) {
      const record = this.records.get(node)
      const recordIsCurrent = record !== undefined && (
        (!record.showingOriginal && node.data === record.translated)
        || (record.showingOriginal && node.data === record.original)
      )
      if (recordIsCurrent) continue
      if (record !== undefined) {
        this.records.delete(node)
        this.translatedNodes.delete(node)
      }
      const { core } = splitWhitespace(node.data)
      if (!containsChinese(core)) continue
      bySource.set(core, [...(bySource.get(core) ?? []), node])
    }
    if (bySource.size === 0) return

    const prefix = `${this.settings.backend}\u0000${this.settings.targetLanguage}\u0000${this.settings.endpoint}\u0000${this.settings.model}\u0000`
    const translated = new Map<string, string>()
    const missing: string[] = []
    for (const source of bySource.keys()) {
      const key = prefix + source
      const cached = source.length <= MAX_CACHE_TEXT_LENGTH ? this.cache.get(key) : undefined
      const negativeUntil = this.negativeCache.get(key) ?? 0
      if (cached !== undefined) translated.set(source, cached)
      else if (negativeUntil > Date.now()) translated.set(source, source)
      else {
        this.negativeCache.delete(key)
        missing.push(source)
      }
    }

    missing.sort((left, right) => {
      const priority = this.sourcePriority(left, bySource.get(left) ?? []) - this.sourcePriority(right, bySource.get(right) ?? [])
      return priority !== 0 ? priority : left.length - right.length
    })
    const requested = missing.slice(0, DOM_SOURCE_BATCH_SIZE)
    for (const source of missing.slice(DOM_SOURCE_BATCH_SIZE)) {
      for (const node of bySource.get(source) ?? []) this.pendingRoots.add(node)
    }

    if (requested.length > 0) {
      const controller = new AbortController()
      this.activeRequests.add(controller)
      try {
        const values = await this.backends.require(this.settings.backend).translate(requested, this.settings, controller.signal)
        if (values.length !== requested.length) throw new Error('translation backend returned the wrong number of results')
        values.forEach((value, index) => {
          const source = requested[index]
          const key = prefix + source
          translated.set(source, value)
          this.retryCounts.delete(key)
          if (value === source) this.rememberNegative(key)
          else {
            this.negativeCache.delete(key)
            if (source.length <= MAX_CACHE_TEXT_LENGTH) this.cache.set(key, value)
          }
        })
        while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string)
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('[dsh-ui-translate] translation skipped:', error)
          this.retryFailedSources(prefix, requested, bySource)
        }
      } finally {
        this.activeRequests.delete(controller)
      }
    }

    if (generation !== this.generation || !this.settings.enabled) return
    for (const [source, sourceNodes] of bySource) {
      const value = translated.get(source)
      if (value === undefined || value === source) continue
      if (this.settings.backend !== 'browser-opus-mt' && containsChinese(value)) continue
      for (const node of sourceNodes) {
        if (!isSafeLeafTextNode(node, this.settings.backend === 'browser-opus-mt')) continue
        const parts = splitWhitespace(node.data)
        if (parts.core !== source) continue
        const original = node.data
        const next = parts.prefix + value + parts.suffix
        this.records.set(node, { original, translated: next, showingOriginal: false })
        this.translatedNodes.add(node)
        node.data = next
      }
    }
    this.syncControls()
  }
}
