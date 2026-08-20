import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config, ResolvedConfig, TargetLanguage } from './config.ts'
import { resolveConfig } from './config.ts'
import type { TranslationProviderRegistry } from './providers.ts'
import { isKnownStaticPhrase } from './core/static-phrases.ts'

export const TRANSLATE_ROUTE = '/ui-translate/api/translate'
const MAX_BODY_BYTES = 32 * 1024
const MAX_TEXTS = 48
const MAX_TEXT_LENGTH = 240
const CACHE_LIMIT = 600
const RATE_WINDOW_MS = 60_000
const RATE_WINDOW_REQUESTS = 30
const MAX_CONCURRENT_REQUESTS = 2
const CHINESE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1'
}

export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host && parsed.origin === origin
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function validateRequest(value: unknown, config: ResolvedConfig): { texts: string[]; targetLanguage: TargetLanguage } {
  if (typeof value !== 'object' || value === null) throw new Error('request must be an object')
  const input = value as { texts?: unknown; targetLanguage?: unknown }
  if (!Array.isArray(input.texts) || input.texts.length === 0 || input.texts.length > MAX_TEXTS) {
    throw new Error(`texts must contain 1-${MAX_TEXTS} items`)
  }
  const texts = input.texts.map((text) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH || !CHINESE_RE.test(text) || !isKnownStaticPhrase(text)) {
      throw new Error('each text must be an allowlisted Chinese UI label')
    }
    return text
  })
  if (input.targetLanguage !== config.targetLanguage) throw new Error('target language does not match the active settings')
  return { texts, targetLanguage: config.targetLanguage }
}

export function createTranslateHandler(
  current: () => Config,
  providers: TranslationProviderRegistry,
  requestToken: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const cache = new Map<string, string>()
  let rateWindowStartedAt = Date.now()
  let rateWindowRequests = 0
  let activeRequests = 0

  return async (req, res) => {
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      writeJson(res, 403, { ok: false, error: 'translation requests are loopback-only' })
      return
    }
    if (req.headers['sec-fetch-site'] !== 'same-origin' || !isSameOriginRequest(req)) {
      writeJson(res, 403, { ok: false, error: 'same-origin browser request required' })
      return
    }
    if (req.headers['x-dsh-ui-translate-token'] !== requestToken) {
      writeJson(res, 403, { ok: false, error: 'translation request token is invalid' })
      return
    }
    const contentType = req.headers['content-type']
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      writeJson(res, 415, { ok: false, error: 'application/json content type required' })
      return
    }

    const now = Date.now()
    if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
      rateWindowStartedAt = now
      rateWindowRequests = 0
    }
    if (rateWindowRequests >= RATE_WINDOW_REQUESTS || activeRequests >= MAX_CONCURRENT_REQUESTS) {
      writeJson(res, 429, { ok: false, error: 'translation request limit reached' })
      return
    }
    rateWindowRequests += 1
    activeRequests += 1

    try {
      const config = resolveConfig(current())
      if (!config.enabled) throw new Error('UI translation is disabled')
      if (config.backend !== 'openai-compatible') throw new Error('the active backend does not use the Host translation route')
      const { texts, targetLanguage } = validateRequest(await readJson(req), config)
      const prefix = `${config.backend}\u0000${config.endpoint}\u0000${config.model}\u0000${targetLanguage}\u0000`
      const results = new Array<string>(texts.length)
      const missing = new Map<string, number[]>()
      texts.forEach((text, index) => {
        const cached = cache.get(prefix + text)
        if (cached !== undefined) results[index] = cached
        else missing.set(text, [...(missing.get(text) ?? []), index])
      })

      if (missing.size > 0) {
        const controller = new AbortController()
        const abortOnDisconnect = (): void => controller.abort(new Error('browser request disconnected'))
        req.once('aborted', abortOnDisconnect)
        res.once('close', abortOnDisconnect)
        const timer = setTimeout(() => controller.abort(new Error('translation request timed out')), 15_000)
        try {
          const sources = [...missing.keys()]
          const translated = await providers.require(config.backend).translate({ texts: sources, targetLanguage, signal: controller.signal }, config)
          translated.forEach((text, sourceIndex) => {
            const source = sources[sourceIndex]
            cache.set(prefix + source, text)
            for (const resultIndex of missing.get(source) ?? []) results[resultIndex] = text
          })
          while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
        } finally {
          clearTimeout(timer)
          req.off('aborted', abortOnDisconnect)
          res.off('close', abortOnDisconnect)
        }
      }
      writeJson(res, 200, { ok: true, translations: results })
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      activeRequests -= 1
    }
  }
}
