import { describe, expect, it } from 'vitest'
import { BrowserLocalOpusBackend, splitOpusText, type WorkerLike } from '../src/client/opus-backend.ts'
import { opusModelStatus } from '../src/client/opus-status.ts'
import { resolveSettings } from '../src/client/settings-model.ts'
import type { OpusTranslateRequest, OpusWorkerMessage } from '../src/core/opus.ts'

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<OpusWorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: OpusTranslateRequest[] = []
  terminated = false

  postMessage(message: OpusTranslateRequest): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(message: OpusWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<OpusWorkerMessage>)
  }
}

const settings = resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'en' })

describe('BrowserLocalOpusBackend', () => {
  it('uses the built-in glossary without starting the model worker', async () => {
    let created = 0
    const backend = new BrowserLocalOpusBackend(() => { created += 1; return new FakeWorker() })
    await expect(backend.translate(['设置'], settings, new AbortController().signal)).resolves.toEqual(['Settings'])
    expect(created).toBe(0)
    backend.dispose()
  })

  it('sends unknown safe copy only to the dedicated local worker', async () => {
    const worker = new FakeWorker()
    const backend = new BrowserLocalOpusBackend(() => worker)
    const promise = backend.translate(['嗯……让我捋捋'], settings, new AbortController().signal)
    expect(worker.messages).toHaveLength(1)
    expect(worker.messages[0].texts).toEqual(['嗯……让我捋捋'])
    worker.respond({ type: 'progress', id: worker.messages[0].id, status: 'download', progress: 25 })
    expect(opusModelStatus.getSnapshot()).toMatchObject({ phase: 'loading', progress: 25 })
    worker.respond({ type: 'result', id: worker.messages[0].id, translations: ['Hmm... let me think.'] })
    await expect(promise).resolves.toEqual(['Hmm... let me think.'])
    expect(opusModelStatus.getSnapshot().phase).toBe('ready')
    backend.dispose()
  })

  it('segments long messages and preserves non-Chinese spans', async () => {
    const worker = new FakeWorker()
    const backend = new BrowserLocalOpusBackend(() => worker)
    const source = `${'长消息'.repeat(140)}。English only.\n第二句！`
    const parts = splitOpusText(source)
    expect(parts.filter(part => part.translate).every(part => part.core.length <= 320)).toBe(true)

    const promise = backend.translate([source], settings, new AbortController().signal)
    const request = worker.messages[0]
    expect(request.texts.length).toBeGreaterThan(1)
    expect(request.texts.every(text => text.length <= 320)).toBe(true)
    worker.respond({ type: 'result', id: request.id, translations: request.texts.map((_text, index) => `Translated ${index}.`) })
    const [translated] = await promise
    expect(translated).toContain('English only.\n')
    expect(translated).not.toContain('长消息')
    backend.dispose()
  })

  it('rejects blank model output instead of erasing a UI label', async () => {
    const worker = new FakeWorker()
    const backend = new BrowserLocalOpusBackend(() => worker)
    const promise = backend.translate(['嗯……让我捋捋'], settings, new AbortController().signal)
    worker.respond({ type: 'result', id: worker.messages[0].id, translations: ['   '] })
    await expect(promise).rejects.toThrow(/invalid translations/)
    backend.dispose()
  })

  it('terminates local inference when the translation is cancelled', async () => {
    const worker = new FakeWorker()
    const backend = new BrowserLocalOpusBackend(() => worker)
    const controller = new AbortController()
    const promise = backend.translate(['正在整理本地状态'], settings, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    backend.dispose()
  })

  it('rejects unsupported target languages before starting a worker', async () => {
    let created = 0
    const backend = new BrowserLocalOpusBackend(() => { created += 1; return new FakeWorker() })
    await expect(backend.translate(
      ['设置'],
      resolveSettings({ enabled: true, backend: 'browser-opus-mt', targetLanguage: 'sv' }),
      new AbortController().signal,
    )).rejects.toThrow(/supports English only/)
    expect(created).toBe(0)
    backend.dispose()
  })
})
