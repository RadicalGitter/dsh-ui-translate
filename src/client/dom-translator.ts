import type { ClientBackendRegistry } from './backends.ts'
import { isKnownStaticPhrase } from '../core/static-phrases.ts'
import type { ResolvedUITranslateSettings } from './settings-model.ts'
import { TranslationControls, type TranslationDisplayState } from './translation-controls.ts'

const CHINESE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const MAX_STATIC_TEXT_LENGTH = 160
const MAX_CACHE_TEXT_LENGTH = 20_000
const CACHE_LIMIT = 800

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
  if (parent.isContentEditable || parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false
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
  private readonly records = new WeakMap<Text, TranslationRecord>()
  private readonly translatedNodes = new Set<Text>()
  private readonly pendingRoots = new Set<Node>()
  private observer: MutationObserver | undefined
  private flushTimer: number | undefined
  private readonly activeRequests = new Set<AbortController>()
  private readonly controls: TranslationControls
  private generation = 0

  constructor(
    private readonly document: Document,
    private readonly backends: ClientBackendRegistry,
    initialSettings: ResolvedUITranslateSettings,
  ) {
    this.settings = initialSettings
    this.controls = new TranslationControls(document, {
      getState: node => this.displayState(node),
      toggle: node => this.toggleNode(node),
      retranslate: node => this.retranslateNode(node),
    })
  }

  start(): void {
    this.controls.start()
    this.syncObserver()
  }

  update(settings: ResolvedUITranslateSettings): void {
    const changed = JSON.stringify(settings) !== JSON.stringify(this.settings)
    if (!changed) return
    this.generation += 1
    this.abortActiveRequests()
    this.restore()
    this.settings = settings
    this.syncObserver()
  }

  dispose(): void {
    this.generation += 1
    this.abortActiveRequests()
    this.observer?.disconnect()
    this.observer = undefined
    if (this.flushTimer !== undefined) this.document.defaultView?.clearTimeout(this.flushTimer)
    this.flushTimer = undefined
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
    this.controls.sync(this.translatedNodes)
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
    this.controls.sync(this.translatedNodes)
  }

  private retranslateNode(node: Text): void {
    const record = this.records.get(node)
    if (record === undefined || !node.isConnected) return
    const { core } = splitWhitespace(record.original)
    node.data = record.original
    this.records.delete(node)
    this.translatedNodes.delete(node)
    for (const key of this.cache.keys()) if (key.endsWith(`\u0000${core}`)) this.cache.delete(key)
    this.controls.sync(this.translatedNodes)
    this.queue(node)
  }

  private abortActiveRequests(): void {
    for (const controller of this.activeRequests) controller.abort()
    this.activeRequests.clear()
  }

  private syncObserver(): void {
    this.observer?.disconnect()
    this.observer = undefined
    if (!this.settings.enabled || this.document.body === null) return
    const MutationObserverCtor = this.document.defaultView?.MutationObserver
    if (MutationObserverCtor === undefined) return
    this.observer = new MutationObserverCtor((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') this.queue(mutation.target)
        else for (const node of mutation.addedNodes) this.queue(node)
      }
    })
    this.observer.observe(this.document.body, { subtree: true, childList: true, characterData: true })
    this.queue(this.document.body)
  }

  private queue(root: Node): void {
    if (!this.settings.enabled) return
    this.pendingRoots.add(root)
    if (this.flushTimer !== undefined) return
    this.flushTimer = this.document.defaultView?.setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, 40)
  }

  private collect(root: Node): Text[] {
    const view = this.document.defaultView
    if (view === null) return []
    const allowBrowserLocalModelText = this.settings.backend === 'browser-opus-mt'
    if (root.nodeType === view.Node.TEXT_NODE) return isSafeLeafTextNode(root as Text, allowBrowserLocalModelText) ? [root as Text] : []
    const walker = this.document.createTreeWalker(root, view.NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let current = walker.nextNode()
    while (current !== null) {
      if (isSafeLeafTextNode(current as Text, allowBrowserLocalModelText)) nodes.push(current as Text)
      current = walker.nextNode()
    }
    return nodes
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
      const cached = source.length <= MAX_CACHE_TEXT_LENGTH ? this.cache.get(prefix + source) : undefined
      if (cached === undefined) missing.push(source)
      else translated.set(source, cached)
    }

    if (missing.length > 0) {
      const controller = new AbortController()
      this.activeRequests.add(controller)
      try {
        const values = await this.backends.require(this.settings.backend).translate(missing, this.settings, controller.signal)
        if (values.length !== missing.length) throw new Error('translation backend returned the wrong number of results')
        values.forEach((value, index) => {
          const source = missing[index]
          translated.set(source, value)
          if (source.length <= MAX_CACHE_TEXT_LENGTH) this.cache.set(prefix + source, value)
        })
        while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string)
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[dsh-ui-translate] translation skipped:', error)
        return
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
    this.controls.sync(this.translatedNodes)
  }
}
