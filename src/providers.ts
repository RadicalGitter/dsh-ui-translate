import type { ResolvedConfig, TargetLanguage } from './config.ts'

export interface TranslateRequest {
  texts: readonly string[]
  targetLanguage: TargetLanguage
  signal: AbortSignal
}

export interface TranslationProvider {
  readonly id: string
  translate(request: TranslateRequest, config: ResolvedConfig): Promise<readonly string[]>
}

export class TranslationProviderRegistry {
  private readonly providers = new Map<string, TranslationProvider>()

  register(provider: TranslationProvider): () => void {
    if (this.providers.has(provider.id)) throw new Error(`translation provider already registered: ${provider.id}`)
    this.providers.set(provider.id, provider)
    return () => { this.providers.delete(provider.id) }
  }

  require(id: string): TranslationProvider {
    const provider = this.providers.get(id)
    if (provider === undefined) throw new Error(`translation backend is not available: ${id}`)
    return provider
  }
}

const LANGUAGE_NAMES: Record<TargetLanguage, string> = {
  en: 'English',
  sv: 'Swedish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ja: 'Japanese',
  ko: 'Korean',
}

export function isPrivateEndpointHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === 'host.docker.internal') return true
  if (host.endsWith('.local')) return true
  const octets = host.split('.').map(part => Number(part))
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = octets
  return a === 127
    || a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
}

export function resolveChatCompletionsUrl(config: ResolvedConfig): URL {
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint)
  } catch {
    throw new Error('translation endpoint must be a valid URL')
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('translation endpoint must use http or https')
  if (endpoint.username !== '' || endpoint.password !== '') throw new Error('translation endpoint must not contain credentials')
  endpoint.hash = ''
  const isPrivate = isPrivateEndpointHostname(endpoint.hostname)
  if (!isPrivate && !config.allowRemoteEndpoint) {
    throw new Error('public translation endpoints require explicit allowRemoteEndpoint opt-in')
  }
  if (!isPrivate && endpoint.protocol !== 'https:') throw new Error('public translation endpoints must use https')
  if (!endpoint.pathname.replace(/\/$/, '').endsWith('/chat/completions')) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/chat/completions`
  }
  return endpoint
}

export function extractTranslationArray(content: string, expected: number): string[] {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('translation provider did not return a JSON array')
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
  if (!Array.isArray(parsed) || parsed.length !== expected || parsed.some(item => typeof item !== 'string')) {
    throw new Error(`translation provider returned ${Array.isArray(parsed) ? parsed.length : 'an invalid value'} results; expected ${expected}`)
  }
  return parsed
}

export async function readBoundedResponseText(response: Response, maxBytes = 1_000_000): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel('response too large')
        throw new Error(`translation provider response exceeded ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export class OpenAICompatibleProvider implements TranslationProvider {
  readonly id = 'openai-compatible'

  async translate(request: TranslateRequest, config: ResolvedConfig): Promise<readonly string[]> {
    const url = resolveChatCompletionsUrl(config)
    if (config.model.trim() === '') throw new Error('translation model is not configured')
    const apiKey = process.env[config.apiKeyEnv]
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        ...(apiKey === undefined || apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'system',
            content: `Translate each Chinese UI label into ${LANGUAGE_NAMES[request.targetLanguage]}. Return only a JSON array of strings in the same order and length. Preserve placeholders, shortcut keys, product names, punctuation, and leading/trailing whitespace. Do not explain.`,
          },
          { role: 'user', content: JSON.stringify(request.texts) },
        ],
      }),
    })
    const body = await readBoundedResponseText(response)
    if (!response.ok) throw new Error(`translation provider returned HTTP ${response.status}`)
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      throw new Error('translation provider returned invalid JSON')
    }
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('translation provider response did not contain message content')
    return extractTranslationArray(content, request.texts.length)
  }
}
