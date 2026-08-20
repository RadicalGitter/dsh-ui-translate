import { translateKnownStaticPhraseToEnglish } from '../core/static-phrases.ts'
import { BrowserLocalOpusBackend } from './opus-backend.ts'
import type { ResolvedUITranslateSettings } from './settings-model.ts'

export interface ClientTranslationBackend {
  readonly id: string
  translate(texts: readonly string[], settings: ResolvedUITranslateSettings, signal: AbortSignal): Promise<readonly string[]>
  dispose?(): void
}

export class OfflineGlossaryBackend implements ClientTranslationBackend {
  readonly id = 'offline-glossary'

  async translate(texts: readonly string[], settings: ResolvedUITranslateSettings): Promise<readonly string[]> {
    if (settings.targetLanguage !== 'en') return texts
    return texts.map(text => translateKnownStaticPhraseToEnglish(text) ?? text)
  }
}

interface TranslateResponse {
  ok?: unknown
  translations?: unknown
  error?: unknown
}

export class HostOpenAICompatibleBackend implements ClientTranslationBackend {
  readonly id = 'openai-compatible'

  async translate(texts: readonly string[], settings: ResolvedUITranslateSettings, signal: AbortSignal): Promise<readonly string[]> {
    const result: string[] = []
    for (let offset = 0; offset < texts.length; offset += 48) {
      const chunk = texts.slice(offset, offset + 48)
      const token = document.querySelector<HTMLMetaElement>('meta[name="dsh-ui-translate-token"]')?.content
      if (token === undefined || token === '') throw new Error('translation Host token is unavailable; reload the page')
      const response = await fetch('/ui-translate/api/translate', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-dsh-ui-translate-token': token,
        },
        body: JSON.stringify({ texts: chunk, targetLanguage: settings.targetLanguage }),
      })
      const payload = await response.json() as TranslateResponse
      if (!response.ok || payload.ok !== true || !Array.isArray(payload.translations) || payload.translations.some(item => typeof item !== 'string')) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `translation request failed with HTTP ${response.status}`)
      }
      result.push(...payload.translations as string[])
    }
    return result
  }
}

export class ClientBackendRegistry {
  private readonly backends = new Map<string, ClientTranslationBackend>()

  register(backend: ClientTranslationBackend): this {
    if (this.backends.has(backend.id)) throw new Error(`client translation backend already registered: ${backend.id}`)
    this.backends.set(backend.id, backend)
    return this
  }

  require(id: string): ClientTranslationBackend {
    const backend = this.backends.get(id)
    if (backend === undefined) throw new Error(`translation backend is not available: ${id}`)
    return backend
  }

  dispose(): void {
    for (const backend of this.backends.values()) backend.dispose?.()
    this.backends.clear()
  }
}

export function createDefaultClientBackends(): ClientBackendRegistry {
  return new ClientBackendRegistry()
    .register(new OfflineGlossaryBackend())
    .register(new BrowserLocalOpusBackend())
    .register(new HostOpenAICompatibleBackend())
}
