import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { resolveSettings } from '../src/client/settings-model.ts'

describe('privacy defaults', () => {
  it('starts disabled with an offline backend and English target', () => {
    expect(resolveConfig()).toMatchObject({ enabled: false, backend: 'offline-glossary', targetLanguage: 'en', allowRemoteEndpoint: false })
    expect(resolveSettings(undefined)).toMatchObject({ enabled: false, backend: 'offline-glossary', targetLanguage: 'en', allowRemoteEndpoint: false })
  })

  it('accepts the explicit browser-local backend without changing the private default', () => {
    expect(resolveConfig({ backend: 'browser-opus-mt', targetLanguage: 'en' })).toMatchObject({ backend: 'browser-opus-mt', targetLanguage: 'en' })
    expect(resolveSettings({ backend: 'browser-opus-mt', targetLanguage: 'en' })).toMatchObject({ backend: 'browser-opus-mt', targetLanguage: 'en' })
  })
})
