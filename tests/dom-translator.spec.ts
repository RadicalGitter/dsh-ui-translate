import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientBackendRegistry, createDefaultClientBackends, type ClientTranslationBackend } from '../src/client/backends.ts'
import { isSafeLeafTextNode, StaticDomTranslator } from '../src/client/dom-translator.ts'
import { resolveSettings } from '../src/client/settings-model.ts'

class MockBackend implements ClientTranslationBackend {
  readonly id = 'offline-glossary'
  calls: string[][] = []

  async translate(texts: readonly string[]): Promise<readonly string[]> {
    this.calls.push([...texts])
    return texts.map(text => text === '设置' ? 'Settings' : `EN:${text}`)
  }
}

const windows: JSDOM[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const dom of windows.splice(0)) dom.window.close()
})

function createDom(html: string): JSDOM {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://127.0.0.1:3080/' })
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
  ])('rejects protected subtree: %s', (html) => {
    const dom = createDom(html)
    const walker = dom.window.document.createTreeWalker(dom.window.document.body, dom.window.NodeFilter.SHOW_TEXT)
    expect(isSafeLeafTextNode(walker.nextNode() as Text)).toBe(false)
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
    expect(dom.window.document.body.textContent).toBe('设置')
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
