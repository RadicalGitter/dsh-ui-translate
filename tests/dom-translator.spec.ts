import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientBackendRegistry, createDefaultClientBackends, type ClientTranslationBackend } from '../src/client/backends.ts'
import { isSafeLeafTextNode, StaticDomTranslator } from '../src/client/dom-translator.ts'
import { resolveSettings } from '../src/client/settings-model.ts'
import { TRANSLATION_HOVER_DELAY_MS } from '../src/client/translation-controls.ts'

class DeferredBackend implements ClientTranslationBackend {
  readonly id = 'browser-opus-mt'
  readonly calls: string[][] = []
  private readonly pending: Array<{ texts: string[]; resolve(value: string[]): void; reject(error: Error): void }> = []
  active = 0
  maximumActive = 0

  translate(texts: readonly string[], _settings: unknown, signal: AbortSignal): Promise<readonly string[]> {
    const values = [...texts]
    this.calls.push(values)
    this.active += 1
    this.maximumActive = Math.max(this.maximumActive, this.active)
    return new Promise<string[]>((resolve, reject) => {
      const settle = (callback: () => void): void => {
        this.active -= 1
        callback()
      }
      const onAbort = (): void => settle(() => reject(new Error('aborted')))
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.push({
        texts: values,
        resolve: translated => {
          signal.removeEventListener('abort', onAbort)
          settle(() => resolve(translated))
        },
        reject: error => {
          signal.removeEventListener('abort', onAbort)
          settle(() => reject(error))
        },
      })
    })
  }

  resolveNext(): void {
    const request = this.pending.shift()
    if (request === undefined) throw new Error('no pending translation')
    request.resolve(request.texts.map((_, index) => `Translated ${this.calls.length}-${index}`))
  }
}

class MockBackend implements ClientTranslationBackend {
  calls: string[][] = []

  constructor(readonly id = 'offline-glossary') {}

  async translate(texts: readonly string[]): Promise<readonly string[]> {
    this.calls.push([...texts])
    const translations: Record<string, string> = {
      设置: 'Settings',
      中文会话标题: 'Translated session title',
      中文工作区: 'Translated workspace',
      '这是一条用户消息。': 'This is a user message.',
      中文搜索结果: 'Translated search result',
    }
    return texts.map(text => translations[text] ?? 'Translated text')
  }
}

const windows: JSDOM[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const dom of windows.splice(0)) dom.window.close()
})

function createDom(html: string): JSDOM {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://127.0.0.1:3080/' })
  const rect = { left: 10, right: 120, top: 10, bottom: 28, width: 110, height: 18, x: 10, y: 10, toJSON: () => ({}) }
  Object.defineProperty(dom.window.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(dom.window.Range.prototype, 'getClientRects', { configurable: true, value: () => [rect] })
  windows.push(dom)
  return dom
}

describe('safe leaf selection', () => {
  it('accepts only connected short Chinese leaf text', () => {
    const dom = createDom('<span id="safe">设置</span><div id="nested">设置<strong>child</strong></div>')
    const document = dom.window.document
    expect(isSafeLeafTextNode(document.querySelector('#safe')!.firstChild as Text)).toBe(true)
    expect(isSafeLeafTextNode(document.querySelector('#nested')!.firstChild as Text)).toBe(false)
  })

  it('rejects unknown Chinese leaf text even without a dynamic-content marker', () => {
    const dom = createDom('<span>我的秘密项目</span>')
    expect(isSafeLeafTextNode(dom.window.document.querySelector('span')!.firstChild as Text)).toBe(false)
  })

  it('allows all visible Chinese content only for the browser-local model', () => {
    const dom = createDom('<div id="mixed">正在整理<strong>本地状态</strong></div><span id="unmarked">未标记用户文本</span>')
    const mixed = dom.window.document.querySelector('#mixed')!.firstChild as Text
    const unmarked = dom.window.document.querySelector('#unmarked')!.firstChild as Text
    expect(isSafeLeafTextNode(mixed)).toBe(false)
    expect(isSafeLeafTextNode(mixed, true)).toBe(true)
    expect(isSafeLeafTextNode(unmarked, true)).toBe(true)

    const long = dom.window.document.createElement('p')
    long.textContent = '长'.repeat(20_001)
    dom.window.document.body.append(long)
    expect(isSafeLeafTextNode(long.firstChild as Text, true)).toBe(true)
  })

  it('includes session, workspace, message, search, pet, and live status content in local mode', () => {
    const dom = createDom(`
      <div data-dsh-plugin="pet">
        <span class="nameCell">中文宠物名</span>
        <button title="Open session">用户会话内容</button>
        <div id="chatter" class="kz2Bea_bubbleWhisper" aria-live="polite">嗯……让我捋捋</div>
        <div id="status" class="kz2Bea_bubbleStatus" aria-live="polite">可能来自会话的状态</div>
      </div>
      <div data-session-id="private"><span id="session">秘密会话标题</span></div>
      <div data-workspace-id="workspace"><span id="workspace">中文工作区</span></div>
      <article data-message-role="user"><p id="message">这是一条用户消息。</p></article>
      <div data-search-result><span id="search">中文搜索结果</span></div>
    `)
    const text = (selector: string) => dom.window.document.querySelector(selector)!.firstChild as Text
    expect(isSafeLeafTextNode(text('.nameCell'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('button'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('#session'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('#workspace'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('#message'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('#search'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('#status'), true)).toBe(true)
    expect(isSafeLeafTextNode(text('#chatter'), true)).toBe(true)
  })

  it.each([
    '<textarea>设置</textarea>',
    '<div contenteditable="true">设置</div>',
    '<code>设置</code>',
    '<pre>设置</pre>',
    '<div data-input-backdrop>设置</div>',
    '<div translate="no"><span>设置</span></div>',
    '<div class="notranslate"><span>设置</span></div>',
    '<div class="conversation-composer"><span>设置</span></div>',
    '<div data-message-role="user"><span>设置</span></div>',
    '<div data-session-id="private"><span>设置</span></div>',
    '<div class="workspace-name"><span>设置</span></div>',
    '<div data-search-result><span>设置</span></div>',
    '<form><span>设置</span></form>',
  ])('rejects protected subtree for non-local backends: %s', (html) => {
    const dom = createDom(html)
    const walker = dom.window.document.createTreeWalker(dom.window.document.body, dom.window.NodeFilter.SHOW_TEXT)
    expect(isSafeLeafTextNode(walker.nextNode() as Text)).toBe(false)
  })

  it.each([
    '<textarea>设置</textarea>',
    '<div contenteditable="true">设置</div>',
    '<code>设置</code>',
    '<pre>设置</pre>',
    '<div data-input-backdrop>设置</div>',
    '<div translate="no"><span>设置</span></div>',
    '<div class="conversation-composer"><span>设置</span></div>',
  ])('keeps editable, verbatim, and explicit opt-out surfaces untouched locally: %s', (html) => {
    const dom = createDom(html)
    const walker = dom.window.document.createTreeWalker(dom.window.document.body, dom.window.NodeFilter.SHOW_TEXT)
    expect(isSafeLeafTextNode(walker.nextNode() as Text, true)).toBe(false)
  })
})

describe('StaticDomTranslator', () => {
  it('translates safe labels, preserves whitespace, and restores on disable', async () => {
    vi.useFakeTimers()
    const dom = createDom('<span id="label">  设置  </span><div class="notranslate"><span id="skip">设置</span></div>')
    const backend = new MockBackend()
    const registry = new ClientBackendRegistry().register(backend)
    const translator = new StaticDomTranslator(dom.window.document, registry, resolveSettings({ enabled: true }))
    translator.start()
    await vi.runAllTimersAsync()

    expect(dom.window.document.querySelector('#label')!.textContent).toBe('  Settings  ')
    expect(dom.window.document.querySelector('#skip')!.textContent).toBe('设置')
    translator.update(resolveSettings({ enabled: false }))
    expect(dom.window.document.querySelector('#label')!.textContent).toBe('  设置  ')
    translator.dispose()
  })

  it('translates comprehensive local content while preserving clickable thread identity and controls', async () => {
    vi.useFakeTimers()
    const dom = createDom(`
      <a id="session" data-session-id="session-123" href="/sessions/session-123">中文会话标题</a>
      <div data-workspace-id="workspace-1"><span id="workspace">中文工作区</span></div>
      <article data-message-role="user"><p id="message">这是一条用户消息。</p></article>
      <div data-search-result><span id="search">中文搜索结果</span></div>
    `)
    const backend = new MockBackend('browser-opus-mt')
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()

    const session = dom.window.document.querySelector('#session') as HTMLAnchorElement
    expect(session.textContent).toBe('Translated session title')
    expect(dom.window.document.querySelector('#workspace')!.textContent).toBe('Translated workspace')
    expect(dom.window.document.querySelector('#message')!.textContent).toBe('This is a user message.')
    expect(dom.window.document.querySelector('#search')!.textContent).toBe('Translated search result')
    expect(session.dataset.sessionId).toBe('session-123')
    expect(session.getAttribute('href')).toBe('/sessions/session-123')
    expect(session.classList.contains('dsh-ui-translate-fallback-highlight')).toBe(false)
    expect(dom.window.document.querySelectorAll('[data-dsh-ui-translate-fallback-marker="true"]')).not.toHaveLength(0)

    let clicked = 0
    session.addEventListener('click', event => { event.preventDefault(); clicked += 1 })
    session.click()
    expect(clicked).toBe(1)

    const textNode = session.firstChild as Text
    const workspaceNode = dom.window.document.querySelector('#workspace')!.firstChild as Text
    textNode.data = '中文会话标题'
    await vi.runAllTimersAsync()
    expect(session.textContent).toBe('Translated session title')

    Object.defineProperty(dom.window.document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: textNode }) })
    const textRect = { left: 10, right: 120, top: 10, bottom: 28, width: 110, height: 18, x: 10, y: 10, toJSON: () => ({}) }
    const workspaceRect = { left: 140, right: 260, top: 10, bottom: 28, width: 120, height: 18, x: 140, y: 10, toJSON: () => ({}) }
    const rangeRect = function (this: Range): typeof textRect { return this.startContainer === workspaceNode ? workspaceRect : textRect }
    Object.defineProperty(dom.window.Range.prototype, 'getBoundingClientRect', { configurable: true, value: rangeRect })
    Object.defineProperty(dom.window.Range.prototype, 'getClientRects', { configurable: true, value: function (this: Range) { return [rangeRect.call(this)] } })
    const controls = dom.window.document.querySelector('[data-dsh-ui-translate-controls="true"]:not(style)') as HTMLDivElement
    session.focus()
    expect(controls.style.display).toBe('flex')
    session.blur()
    expect(controls.style.display).toBe('none')
    const contextMenu = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })
    dom.window.document.dispatchEvent(contextMenu)
    expect(contextMenu.defaultPrevented).toBe(true)
    expect(controls.style.display).toBe('flex')
    dom.window.dispatchEvent(new dom.window.Event('scroll'))
    expect(controls.style.display).toBe('none')

    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 20 }))
    await vi.advanceTimersByTimeAsync(TRANSLATION_HOVER_DELAY_MS)
    expect(controls.style.display).toBe('none')
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 }))
    await vi.advanceTimersByTimeAsync(TRANSLATION_HOVER_DELAY_MS / 2)
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 20 }))
    await vi.advanceTimersByTimeAsync(TRANSLATION_HOVER_DELAY_MS)
    expect(controls.style.display).toBe('none')
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 }))
    await vi.advanceTimersByTimeAsync(TRANSLATION_HOVER_DELAY_MS - 1)
    expect(controls.style.display).toBe('none')
    await vi.advanceTimersByTimeAsync(1)
    expect(controls.style.display).toBe('flex')
    const action = controls.querySelector('[data-action="translation-action"]') as HTMLButtonElement
    expect(action.textContent).toBe('Show original')
    expect(controls.querySelectorAll('button')).toHaveLength(1)

    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 20 }))
    expect(controls.style.display).toBe('none')
    action.click()
    expect(session.textContent).toBe('Translated session title')
    await vi.advanceTimersByTimeAsync(TRANSLATION_HOVER_DELAY_MS)
    expect(controls.style.display).toBe('flex')

    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 }))
    expect(controls.style.display).toBe('none')
    await vi.advanceTimersByTimeAsync(TRANSLATION_HOVER_DELAY_MS)
    expect(controls.style.display).toBe('flex')
    action.click()
    expect(session.textContent).toBe('中文会话标题')
    expect(action.textContent).toBe('Re-translate')
    action.click()
    await vi.runAllTimersAsync()
    expect(session.textContent).toBe('Translated session title')
    expect(backend.calls.filter(call => call.includes('中文会话标题'))).toHaveLength(2)
    session.remove()
    await Promise.resolve()
    expect(controls.style.display).toBe('none')
    translator.dispose()
  })

  it('updates marker appearance without retranslating content', async () => {
    vi.useFakeTimers()
    const dom = createDom('<span id="label">中文会话标题</span>')
    const backend = new MockBackend('browser-opus-mt')
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', markerStyle: 'overlay' }),
    )
    translator.start()
    await vi.runAllTimersAsync()

    const label = dom.window.document.querySelector('#label') as HTMLElement
    const style = dom.window.document.querySelector('style[data-dsh-ui-translate-controls="true"]') as HTMLStyleElement
    expect(style.textContent).not.toContain('underline 2px dashed')
    expect(label.classList.contains('dsh-ui-translate-fallback-highlight')).toBe(false)
    expect(dom.window.document.querySelectorAll('[data-dsh-ui-translate-fallback-marker="true"]')).not.toHaveLength(0)

    translator.update(resolveSettings({ enabled: true, backend: 'browser-opus-mt', markerStyle: 'underline' }))
    expect(style.textContent).toContain('underline 2px dashed #7c3aed')
    expect(style.textContent).not.toContain('background: color-mix')
    expect(backend.calls).toHaveLength(1)

    translator.update(resolveSettings({ enabled: true, backend: 'browser-opus-mt', markerStyle: 'none' }))
    expect(dom.window.document.querySelectorAll('[data-dsh-ui-translate-fallback-marker="true"]')).toHaveLength(0)
    expect(backend.calls).toHaveLength(1)

    translator.update(resolveSettings({ enabled: true, backend: 'browser-opus-mt', markerStyle: 'both' }))
    expect(dom.window.document.querySelectorAll('[data-dsh-ui-translate-fallback-marker="true"]')).not.toHaveLength(0)
    expect(backend.calls).toHaveLength(1)
    translator.dispose()
  })

  it('uses Custom Highlight ranges without mutating translated source elements', async () => {
    vi.useFakeTimers()
    const dom = createDom('<p id="mixed">Prefix <span id="label">中文会话标题</span> suffix</p>')
    const registry = { set: vi.fn(), delete: vi.fn() }
    Object.defineProperty(dom.window, 'CSS', { configurable: true, value: { highlights: registry } })
    Object.defineProperty(dom.window, 'Highlight', { configurable: true, value: class Highlight { constructor(..._ranges: Range[]) {} } })
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(new MockBackend('browser-opus-mt')),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', markerStyle: 'overlay' }),
    )
    translator.start()
    await vi.runAllTimersAsync()

    expect(registry.set).toHaveBeenCalled()
    expect(dom.window.document.querySelector('#mixed')!.getAttribute('class')).toBeNull()
    expect(dom.window.document.querySelector('#label')!.getAttribute('class')).toBeNull()
    expect(dom.window.document.querySelectorAll('[data-dsh-ui-translate-fallback-marker="true"]')).toHaveLength(0)

    translator.update(resolveSettings({ enabled: true, backend: 'browser-opus-mt', markerStyle: 'none' }))
    expect(registry.delete).toHaveBeenCalledWith('dsh-ui-translate-visible')
    translator.dispose()
  })

  it('serializes progressive batches and prioritizes live/sidebar text over conversation backlog', async () => {
    vi.useFakeTimers()
    const messages = Array.from({ length: 12 }, (_, index) => `<article data-message-role="user"><p>消息内容${index}</p></article>`).join('')
    const dom = createDom(`${messages}<div role="treeitem" id="sidebar">中文会话标题</div>`)
    const backend = new DeferredBackend()
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.advanceTimersByTimeAsync(40)

    expect(backend.calls).toHaveLength(1)
    expect(backend.calls[0]).toContain('中文会话标题')
    expect(backend.calls[0].length).toBeLessThanOrEqual(8)

    const live = dom.window.document.createElement('div')
    live.setAttribute('aria-live', 'polite')
    live.textContent = '宠物实时状态'
    dom.window.document.body.append(live)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.calls).toHaveLength(1)

    backend.resolveNext()
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.calls).toHaveLength(2)
    expect(backend.calls[1]).toContain('宠物实时状态')
    expect(backend.maximumActive).toBe(1)
    translator.dispose()
    await Promise.resolve()
  })

  it('defers hidden local text until it becomes visible and the viewport changes', async () => {
    vi.useFakeTimers()
    const dom = createDom('<div id="panel" style="display:none"><span id="label">中文会话标题</span></div>')
    const backend = new MockBackend('browser-opus-mt')
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()
    expect(backend.calls).toHaveLength(0)

    ;(dom.window.document.querySelector('#panel') as HTMLElement).style.display = 'block'
    await vi.runAllTimersAsync()
    expect(dom.window.document.querySelector('#label')!.textContent).toBe('Translated session title')
    translator.dispose()
  })

  it('keeps useful partial local translations that retain a Chinese proper noun', async () => {
    vi.useFakeTimers()
    const dom = createDom('<span id="name">用户 张三</span>')
    const backend: ClientTranslationBackend = {
      id: 'browser-opus-mt',
      translate: async () => ['User 张三'],
    }
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()
    expect(dom.window.document.querySelector('#name')!.textContent).toBe('User 张三')
    translator.dispose()
  })

  it('translates allowlisted pet panel labels and numeric templates offline', async () => {
    vi.useFakeTimers()
    const dom = createDom(`
      <section data-dsh-plugin="pet">
        <span id="rank">亲密度 幼鲸</span>
        <span id="treats">小鱼干 ×0</span>
        <span id="points">17 点</span>
        <button id="feed">喂食</button>
        <button id="rename">改名</button>
        <button id="hide">隐藏</button>
      </section>
    `)
    const translator = new StaticDomTranslator(
      dom.window.document,
      createDefaultClientBackends(),
      resolveSettings({ enabled: true, backend: 'offline-glossary', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()

    const text = (id: string) => dom.window.document.querySelector(id)!.textContent
    expect(text('#rank')).toBe('Affinity Calf')
    expect(text('#treats')).toBe('Treats ×0')
    expect(text('#points')).toBe('17 pts')
    expect(text('#feed')).toBe('Feed')
    expect(text('#rename')).toBe('Rename')
    expect(text('#hide')).toBe('Hide')
    translator.dispose()
  })

  it('retries one transient backend failure instead of stranding stable text', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dom = createDom('<span id="label">中文会话标题</span>')
    let calls = 0
    const backend: ClientTranslationBackend = {
      id: 'browser-opus-mt',
      translate: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary failure')
        return ['Translated session title']
      },
    }
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()
    expect(calls).toBe(2)
    expect(dom.window.document.querySelector('#label')!.textContent).toBe('Translated session title')
    warning.mockRestore()
    translator.dispose()
  })

  it('cooldown-caches persistent backend failures after one retry', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dom = createDom('<span>中文会话标题</span>')
    let calls = 0
    const backend: ClientTranslationBackend = {
      id: 'browser-opus-mt',
      translate: async () => {
        calls += 1
        throw new Error('persistent failure')
      },
    }
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()
    expect(calls).toBe(2)
    dom.window.document.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }))
    dom.window.document.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }))
    dom.window.dispatchEvent(new dom.window.Event('resize'))
    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toBe(2)
    warning.mockRestore()
    translator.dispose()
  })

  it('aborts an active backend request when disabled', async () => {
    vi.useFakeTimers()
    const dom = createDom('<span>设置</span>')
    let observedSignal: AbortSignal | undefined
    const backend: ClientTranslationBackend = {
      id: 'offline-glossary',
      translate: (_texts, _settings, signal) => {
        observedSignal = signal
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      },
    }
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true }),
    )
    translator.start()
    await vi.advanceTimersByTimeAsync(40)
    expect(observedSignal?.aborted).toBe(false)
    translator.update(resolveSettings({ enabled: false }))
    expect(observedSignal?.aborted).toBe(true)
    expect(dom.window.document.querySelector('span')!.textContent).toBe('设置')
    translator.dispose()
  })

  it('temporarily suppresses repeated inference when the model falls back to the source', async () => {
    vi.useFakeTimers()
    const dom = createDom('<span id="label">中文会话标题</span>')
    let calls = 0
    const backend: ClientTranslationBackend = {
      id: 'browser-opus-mt',
      translate: async texts => {
        calls += 1
        return [...texts]
      },
    }
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' }),
    )
    translator.start()
    await vi.runAllTimersAsync()
    dom.window.document.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }))
    dom.window.dispatchEvent(new dom.window.Event('resize'))
    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toBe(1)
    expect(dom.window.document.querySelector('#label')!.textContent).toBe('中文会话标题')
    translator.dispose()
  })

  it('reuses cached translations for later matching nodes', async () => {
    vi.useFakeTimers()
    const dom = createDom('<span id="first">设置</span>')
    const backend = new MockBackend()
    const translator = new StaticDomTranslator(
      dom.window.document,
      new ClientBackendRegistry().register(backend),
      resolveSettings({ enabled: true }),
    )
    translator.start()
    await vi.runAllTimersAsync()
    const second = dom.window.document.createElement('span')
    second.textContent = '设置'
    dom.window.document.body.appendChild(second)
    await vi.runAllTimersAsync()

    expect(second.textContent).toBe('Settings')
    expect(backend.calls).toEqual([['设置']])
    translator.dispose()
  })
})
