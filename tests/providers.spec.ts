import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { extractTranslationArray, isPrivateEndpointHostname, readBoundedResponseText, resolveChatCompletionsUrl, TranslationProviderRegistry } from '../src/providers.ts'

describe('provider endpoint policy', () => {
  it.each(['localhost', '127.0.0.1', '10.0.0.2', '172.20.0.2', '192.168.1.4', 'host.docker.internal'])(
    'accepts private host %s',
    (host) => expect(isPrivateEndpointHostname(host)).toBe(true),
  )

  it('rejects public endpoints unless explicitly allowed', () => {
    expect(() => resolveChatCompletionsUrl(resolveConfig({ endpoint: 'https://api.example.com/v1' }))).toThrow(/explicit/)
    expect(resolveChatCompletionsUrl(resolveConfig({ endpoint: 'https://api.example.com/v1', allowRemoteEndpoint: true })).href)
      .toBe('https://api.example.com/v1/chat/completions')
  })

  it('rejects credentials in endpoint URLs', () => {
    expect(() => resolveChatCompletionsUrl(resolveConfig({ endpoint: 'http://user:secret@localhost:11434/v1' }))).toThrow(/credentials/)
  })
})

describe('provider response parsing', () => {
  it('accepts a fenced JSON array with the exact expected length', () => {
    expect(extractTranslationArray('```json\n["Settings", "Close"]\n```', 2)).toEqual(['Settings', 'Close'])
  })

  it('rejects mismatched output cardinality', () => {
    expect(() => extractTranslationArray('["Settings"]', 2)).toThrow(/expected 2/)
  })
})

describe('bounded provider responses', () => {
  it('stops reading once the byte limit is exceeded', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16))
        controller.enqueue(new Uint8Array(16))
        controller.close()
      },
    }))
    await expect(readBoundedResponseText(response, 24)).rejects.toThrow(/exceeded 24 bytes/)
  })
})

describe('TranslationProviderRegistry', () => {
  it('supports additive provider registration and disposal', () => {
    const registry = new TranslationProviderRegistry()
    const provider = { id: 'test', translate: async () => [] }
    const dispose = registry.register(provider)
    expect(registry.require('test')).toBe(provider)
    dispose()
    expect(() => registry.require('test')).toThrow(/not available/)
  })
})
