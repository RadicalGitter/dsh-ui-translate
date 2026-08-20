import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProviderRegistry, type TranslationProvider } from '../src/providers.ts'
import { createTranslateHandler } from '../src/route.ts'
import type { Config } from '../src/config.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

async function serve(provider: TranslationProvider, token = 'test-token'): Promise<{ url: string; token: string }> {
  const registry = new TranslationProviderRegistry()
  registry.register(provider)
  const config: Config = {
    enabled: true,
    targetLanguage: 'en',
    backend: 'openai-compatible',
    endpoint: 'http://127.0.0.1:11434/v1',
    model: 'test',
  }
  const handler = createTranslateHandler(() => config, registry, token)
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not bind')
  return { url: `http://127.0.0.1:${address.port}`, token }
}

function requestHeaders(url: string, token: string): Record<string, string> {
  return {
    origin: url,
    'sec-fetch-site': 'same-origin',
    'x-dsh-ui-translate-token': token,
    'content-type': 'application/json',
  }
}

function body(text = '设置'): string {
  return JSON.stringify({ texts: [text], targetLanguage: 'en' })
}

describe('translation route controls', () => {
  it('accepts an authenticated same-origin loopback request', async () => {
    const provider: TranslationProvider = { id: 'openai-compatible', translate: async () => ['Settings'] }
    const { url, token } = await serve(provider)
    const response = await fetch(`${url}/ui-translate/api/translate`, {
      method: 'POST', headers: requestHeaders(url, token), body: body(),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, translations: ['Settings'] })
  })

  it.each([
    ['missing token', (url: string, token: string) => ({ ...requestHeaders(url, token), 'x-dsh-ui-translate-token': '' })],
    ['cross-site fetch metadata', (url: string, token: string) => ({ ...requestHeaders(url, token), 'sec-fetch-site': 'cross-site' })],
    ['foreign origin', (url: string, token: string) => ({ ...requestHeaders(url, token), origin: 'http://localhost.invalid' })],
    ['wrong content type', (url: string, token: string) => ({ ...requestHeaders(url, token), 'content-type': 'text/plain' })],
  ])('rejects %s', async (_name, makeHeaders) => {
    const provider: TranslationProvider = { id: 'openai-compatible', translate: async () => ['Settings'] }
    const { url, token } = await serve(provider)
    const response = await fetch(`${url}/ui-translate/api/translate`, {
      method: 'POST', headers: makeHeaders(url, token), body: body(),
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects authenticated novel Chinese text before invoking a provider', async () => {
    let calls = 0
    const provider: TranslationProvider = { id: 'openai-compatible', translate: async () => { calls += 1; return ['Private'] } }
    const { url, token } = await serve(provider)
    const response = await fetch(`${url}/ui-translate/api/translate`, {
      method: 'POST', headers: requestHeaders(url, token), body: body('我的秘密项目'),
    })
    expect(response.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('caps concurrent provider requests', async () => {
    const releases: Array<() => void> = []
    const provider: TranslationProvider = {
      id: 'openai-compatible',
      translate: ({ texts }) => new Promise(resolve => releases.push(() => resolve(texts.map(() => 'Translated')))),
    }
    const { url, token } = await serve(provider)
    const start = (text: string) => fetch(`${url}/ui-translate/api/translate`, {
      method: 'POST', headers: requestHeaders(url, token), body: body(text),
    })
    const first = start('设置')
    const second = start('关闭')
    while (releases.length < 2) await new Promise(resolve => setTimeout(resolve, 1))
    const third = await start('保存')
    expect(third.status).toBe(429)
    releases.forEach(release => release())
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
  })

  it('propagates a disconnected browser request to the provider signal', async () => {
    let providerSignal: AbortSignal | undefined
    const provider: TranslationProvider = {
      id: 'openai-compatible',
      translate: (_request) => {
        providerSignal = _request.signal
        return new Promise((_, reject) => _request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      },
    }
    const { url, token } = await serve(provider)
    const controller = new AbortController()
    const request = fetch(`${url}/ui-translate/api/translate`, {
      method: 'POST', headers: requestHeaders(url, token), body: body(), signal: controller.signal,
    }).catch(() => undefined)
    while (providerSignal === undefined) await new Promise(resolve => setTimeout(resolve, 1))
    controller.abort()
    await request
    for (let attempts = 0; attempts < 20 && providerSignal.aborted === false; attempts += 1) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    expect(providerSignal.aborted).toBe(true)
  })

  it('rate-limits valid requests before unbounded provider use', async () => {
    const provider: TranslationProvider = { id: 'openai-compatible', translate: async ({ texts }) => texts.map(() => 'Translated') }
    const { url, token } = await serve(provider)
    const statuses: number[] = []
    for (let index = 0; index < 31; index += 1) {
      const response = await fetch(`${url}/ui-translate/api/translate`, {
        method: 'POST', headers: requestHeaders(url, token), body: body('设置'),
      })
      statuses.push(response.status)
    }
    expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })
})
