import {
  OPUS_MAX_TEXT_LENGTH,
  OPUS_MAX_TEXTS,
  OPUS_WORKER_URL,
  type OpusTranslateRequest,
  type OpusWorkerMessage,
} from '../core/opus.ts'
import { translateKnownStaticPhraseToEnglish } from '../core/static-phrases.ts'
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
  expected: number
  resolve(value: string[]): void
  reject(error: Error): void
}

function abortError(): Error {
  const error = new Error('local translation was cancelled')
  error.name = 'AbortError'
  return error
}

const CHINESE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

interface OpusTextPart {
  prefix: string
  core: string
  suffix: string
  translate: boolean
  continuation: boolean
}

interface BoundedPart {
  value: string
  continuation: boolean
}

function splitBounded(value: string): BoundedPart[] {
  if (value.length <= OPUS_MAX_TEXT_LENGTH) return [{ value, continuation: false }]
  const chunks: BoundedPart[] = []
  let chunk = ''
  for (const character of value) {
    if (chunk.length > 0 && chunk.length + character.length > OPUS_MAX_TEXT_LENGTH) {
      chunks.push({ value: chunk, continuation: chunks.length > 0 })
      chunk = ''
    }
    chunk += character
  }
  if (chunk.length > 0) chunks.push({ value: chunk, continuation: chunks.length > 0 })
  return chunks
}

export function splitOpusText(value: string): OpusTextPart[] {
  const sentences = value.split(/(?<=[。！？!?；;\n])/u)
  return sentences.flatMap(sentence => splitBounded(sentence)).filter(part => part.value.length > 0).map(part => {
    const match = /^(\s*)(.*?)(\s*)$/su.exec(part.value)
    const prefix = match?.[1] ?? ''
    const core = match?.[2] ?? part.value
    const suffix = match?.[3] ?? ''
    return { prefix, core, suffix, translate: core.length > 0 && CHINESE_RE.test(core), continuation: part.continuation }
  })
}

export class BrowserLocalOpusBackend implements ClientTranslationBackend {
  readonly id = 'browser-opus-mt'
  private worker: WorkerLike | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly createWorker: OpusWorkerFactory = () => new Worker(OPUS_WORKER_URL, {
    type: 'module',
    name: 'dsh-ui-translate-opus',
  }) as WorkerLike) {}

  async translate(texts: readonly string[], settings: ResolvedUITranslateSettings, signal: AbortSignal): Promise<readonly string[]> {
    if (settings.targetLanguage !== 'en') throw new Error('browser-local OPUS-MT currently supports English only')
    if (signal.aborted) throw abortError()

    const direct = texts.map(text => translateKnownStaticPhraseToEnglish(text))
    const plans = texts.map((text, index) => direct[index] === undefined ? splitOpusText(text) : [])
    const uniqueSegments = new Set<string>()
    for (const parts of plans) for (const part of parts) if (part.translate) uniqueSegments.add(part.core)

    const translatedSegments = new Map<string, string>()
    const sources = [...uniqueSegments]
    for (let offset = 0; offset < sources.length; offset += OPUS_MAX_TEXTS) {
      const chunk = sources.slice(offset, offset + OPUS_MAX_TEXTS)
      const values = await this.request(chunk, signal)
      values.forEach((value, index) => translatedSegments.set(chunk[index], value))
    }

    return texts.map((text, index) => {
      if (direct[index] !== undefined) return direct[index] as string
      const parts = plans[index]
      if (parts.length === 0) return text
      return parts.map(part => part.prefix + (part.translate && part.continuation ? ' ' : '') + (part.translate ? translatedSegments.get(part.core) ?? part.core : part.core) + part.suffix).join('')
    })
  }

  dispose(): void {
    this.failWorker(abortError(), false)
    opusModelStatus.set({ phase: 'idle' })
  }

  private ensureWorker(): WorkerLike {
    if (this.worker !== undefined) return this.worker
    const worker = this.createWorker()
    worker.onmessage = event => this.handleMessage(event.data)
    worker.onerror = () => this.failWorker(new Error('local model worker failed'))
    this.worker = worker
    return worker
  }

  private request(texts: string[], signal: AbortSignal): Promise<string[]> {
    const id = this.nextId++
    opusModelStatus.set({ phase: 'loading', progress: 0, detail: 'Preparing the local translation model' })
    return new Promise<string[]>((resolve, reject) => {
      const onAbort = (): void => this.failWorker(abortError(), false)
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        expected: texts.length,
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
        this.ensureWorker().postMessage({ type: 'translate', id, texts })
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
    if (!Number.isSafeInteger(message.id) || typeof message.type !== 'string') {
      this.failWorker(new Error('local model worker returned an invalid message'))
      return
    }
    const pending = this.pending.get(message.id as number)
    if (message.type === 'progress') {
      if (pending === undefined || typeof message.status !== 'string') return
      const file = typeof message.file === 'string' ? message.file : undefined
      const progress = typeof message.progress === 'number' && Number.isFinite(message.progress) ? message.progress : undefined
      const detail = file === undefined ? message.status : `${message.status}: ${file}`
      opusModelStatus.set({ phase: 'loading', progress, detail })
      return
    }
    if (pending === undefined) return
    this.pending.delete(message.id as number)
    if (message.type === 'result') {
      if (!Array.isArray(message.translations) || message.translations.length !== pending.expected || message.translations.some(item => typeof item !== 'string' || item.trim().length === 0 || item.length > 1_000)) {
        const error = new Error('local model worker returned invalid translations')
        opusModelStatus.set({ phase: 'error', detail: error.message })
        pending.reject(error)
        return
      }
      opusModelStatus.set({ phase: 'ready', progress: 100, detail: 'Local model ready' })
      pending.resolve(message.translations as string[])
    } else if (message.type === 'error' && typeof message.error === 'string') {
      const error = new Error(message.error)
      opusModelStatus.set({ phase: 'error', detail: error.message })
      pending.reject(error)
    } else {
      const error = new Error('local model worker returned an invalid message')
      opusModelStatus.set({ phase: 'error', detail: error.message })
      pending.reject(error)
    }
  }

  private failWorker(error: Error, exposeError = true): void {
    const worker = this.worker
    this.worker = undefined
    if (worker !== undefined) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    opusModelStatus.set(exposeError ? { phase: 'error', detail: error.message } : { phase: 'idle' })
  }
}
