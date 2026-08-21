import {
  OPUS_MAX_TEXT_LENGTH,
  OPUS_MAX_TEXTS,
  OPUS_WORKER_URL,
  type OpusTranslateRequest,
  type OpusWorkerMessage,
} from '../core/opus.ts'
import { translateKnownStaticPhraseToEnglish } from '../core/static-phrases.ts'
import { VETTED_LOCAL_PAIRS, requireVettedLocalPair, resolveVettedLocalPair, type LocalPairId } from '../core/language-pairs.ts'
import { assembleTranslatedText, splitTextForPair, type TranslationTextPart } from '../core/text-segmentation.ts'
import type { ClientTranslationBackend } from './backends.ts'
import { opusModelStatus } from './opus-status.ts'
import type { ResolvedUITranslateSettings } from './settings-model.ts'

export interface WorkerLike {
  onmessage: ((event: MessageEvent<OpusWorkerMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: OpusTranslateRequest): void
  terminate(): void
}

export type OpusWorkerFactory = () => WorkerLike

interface PendingRequest {
  pairId: LocalPairId
  expected: number
  sources: string[]
  resolve(value: string[]): void
  reject(error: Error): void
}

function abortError(): Error {
  const error = new Error('local translation was cancelled')
  error.name = 'AbortError'
  return error
}

export type OpusTextPart = TranslationTextPart

export function splitOpusText(value: string): OpusTextPart[] {
  return splitTextForPair(value, VETTED_LOCAL_PAIRS['zh-en'], OPUS_MAX_TEXT_LENGTH)
}

export function sanitizeOpusTranslation(value: string, source: string): string {
  const normalized = value.trim().replace(/([.!?。！？…])\1{3,}/gu, '$1$1$1')
  const maximum = Math.max(120, [...source].length * 8)
  if (normalized.length === 0 || normalized.length > maximum || !/[\p{L}\p{N}]/u.test(normalized)) return source
  return normalized
}

export class BrowserLocalOpusBackend implements ClientTranslationBackend {
  readonly id = 'browser-opus-mt'
  private worker: WorkerLike | undefined
  private workerPairId: LocalPairId | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly createWorker: OpusWorkerFactory = () => new Worker(OPUS_WORKER_URL, {
    type: 'module',
    name: 'dsh-ui-translate-opus',
  }) as WorkerLike) {}

  async translate(texts: readonly string[], settings: ResolvedUITranslateSettings, signal: AbortSignal): Promise<readonly string[]> {
    const pair = requireVettedLocalPair(settings.sourceLanguage, settings.targetLanguage)
    if (signal.aborted) throw abortError()

    const direct = texts.map(text => pair.id === 'zh-en' ? translateKnownStaticPhraseToEnglish(text) : undefined)
    const plans = texts.map((text, index) => direct[index] === undefined ? splitTextForPair(text, pair, OPUS_MAX_TEXT_LENGTH) : [])
    const uniqueSegments = new Set<string>()
    for (const parts of plans) for (const part of parts) if (part.translate) uniqueSegments.add(part.core)

    const translatedSegments = new Map<string, string>()
    const sources = [...uniqueSegments]
    for (let offset = 0; offset < sources.length; offset += OPUS_MAX_TEXTS) {
      const chunk = sources.slice(offset, offset + OPUS_MAX_TEXTS)
      const values = await this.request(chunk, pair.id as LocalPairId, signal)
      values.forEach((value, index) => translatedSegments.set(chunk[index], value))
    }

    return texts.map((text, index) => {
      if (direct[index] !== undefined) return direct[index] as string
      const parts = plans[index]
      if (parts.length === 0) return text
      return assembleTranslatedText(parts, translatedSegments, pair)
    })
  }

  configure(settings: ResolvedUITranslateSettings): void {
    const pair = settings.backend === this.id
      ? resolveVettedLocalPair(settings.sourceLanguage, settings.targetLanguage)
      : undefined
    const nextPairId = pair?.id as LocalPairId | undefined
    if (this.worker !== undefined && this.workerPairId !== nextPairId) this.failWorker(abortError(), false)
  }

  dispose(): void {
    this.failWorker(abortError(), false)
    opusModelStatus.set({ phase: 'idle' })
  }

  private ensureWorker(pairId: LocalPairId): WorkerLike {
    if (this.worker !== undefined && this.workerPairId === pairId) return this.worker
    if (this.worker !== undefined) this.failWorker(abortError(), false)
    const worker = this.createWorker()
    worker.onmessage = event => this.handleMessage(event.data)
    worker.onerror = () => this.failWorker(new Error('local model worker failed'))
    this.worker = worker
    this.workerPairId = pairId
    return worker
  }

  private request(texts: string[], pairId: LocalPairId, signal: AbortSignal): Promise<string[]> {
    const id = this.nextId++
    opusModelStatus.set({ phase: 'loading', pairId, progress: 0, detail: 'Preparing the local translation model' })
    return new Promise<string[]>((resolve, reject) => {
      const onAbort = (): void => this.failWorker(abortError(), false)
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        pairId,
        expected: texts.length,
        sources: [...texts],
        resolve: (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
      try {
        this.ensureWorker(pairId).postMessage({ type: 'translate', id, pairId, texts })
      } catch {
        this.failWorker(new Error('local model worker could not start'))
      }
    })
  }

  private handleMessage(value: unknown): void {
    if (typeof value !== 'object' || value === null) {
      this.failWorker(new Error('local model worker returned an invalid message'))
      return
    }
    const message = value as Partial<OpusWorkerMessage>
    if (!Number.isSafeInteger(message.id) || typeof message.type !== 'string' || typeof message.pairId !== 'string') {
      this.failWorker(new Error('local model worker returned an invalid message'))
      return
    }
    const pending = this.pending.get(message.id as number)
    if (message.type === 'progress') {
      if (pending === undefined || message.pairId !== pending.pairId || typeof message.status !== 'string') return
      const file = typeof message.file === 'string' ? message.file : undefined
      const progress = typeof message.progress === 'number' && Number.isFinite(message.progress) ? message.progress : undefined
      const detail = file === undefined ? message.status : `${message.status}: ${file}`
      opusModelStatus.set({ phase: 'loading', pairId: pending.pairId, progress, detail })
      return
    }
    if (pending === undefined || message.pairId !== pending.pairId) return
    this.pending.delete(message.id as number)
    if (message.type === 'result') {
      if (!Array.isArray(message.translations) || message.translations.length !== pending.expected || message.translations.some(item => typeof item !== 'string')) {
        const error = new Error('local model worker returned invalid translations')
        opusModelStatus.set({ phase: 'error', pairId: pending.pairId, detail: error.message })
        pending.reject(error)
        return
      }
      const translations = (message.translations as string[]).map((item, index) => sanitizeOpusTranslation(item, pending.sources[index]))
      opusModelStatus.set({ phase: 'ready', pairId: pending.pairId, progress: 100, detail: 'Local model ready' })
      pending.resolve(translations)
    } else if (message.type === 'error' && typeof message.error === 'string') {
      const error = new Error(message.error)
      opusModelStatus.set({ phase: 'error', pairId: pending.pairId, detail: error.message })
      pending.reject(error)
    } else {
      const error = new Error('local model worker returned an invalid message')
      opusModelStatus.set({ phase: 'error', pairId: pending.pairId, detail: error.message })
      pending.reject(error)
    }
  }

  private failWorker(error: Error, exposeError = true): void {
    const worker = this.worker
    const pairId = this.workerPairId
    this.worker = undefined
    this.workerPairId = undefined
    if (worker !== undefined) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    opusModelStatus.set(exposeError ? { phase: 'error', pairId, detail: error.message } : { phase: 'idle' })
  }
}
