import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers'
import {
  OPUS_MAX_TEXT_LENGTH,
  OPUS_MAX_TEXTS,
  OPUS_MODEL_ID,
  OPUS_MODEL_REVISION,
  OPUS_WASM_BASE_URL,
  type OpusTranslateRequest,
  type OpusWorkerMessage,
} from '../core/opus.ts'

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: OpusWorkerMessage): void
}

interface ProgressInfo {
  status?: unknown
  file?: unknown
  progress?: unknown
}

const CHINESE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const scope = globalThis as unknown as WorkerScope
const wasm = env.backends.onnx.wasm
if (wasm === undefined) throw new Error('ONNX WebAssembly backend is unavailable')
Object.assign(wasm, { wasmPaths: OPUS_WASM_BASE_URL, numThreads: 1 })
env.allowLocalModels = false
env.allowRemoteModels = true
env.useBrowserCache = true

type CreateTranslationPipeline = (task: 'translation', model: string, options: Record<string, unknown>) => Promise<TranslationPipeline>
type RunTranslation = (texts: string[], options: { max_new_tokens: number }) => Promise<unknown>

const createTranslationPipeline = pipeline as unknown as CreateTranslationPipeline
let translatorPromise: Promise<TranslationPipeline> | undefined
let activeRequestId = 0

function progressFor(id: number, value: ProgressInfo): void {
  const status = typeof value.status === 'string' ? value.status : 'loading'
  const file = typeof value.file === 'string' ? value.file.split('/').pop() : undefined
  const progress = typeof value.progress === 'number' && Number.isFinite(value.progress)
    ? Math.max(0, Math.min(100, value.progress))
    : undefined
  scope.postMessage({ type: 'progress', id, status, file, progress })
}

async function getTranslator(id: number): Promise<TranslationPipeline> {
  translatorPromise ??= createTranslationPipeline('translation', OPUS_MODEL_ID, {
    revision: OPUS_MODEL_REVISION,
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (value: unknown) => progressFor(activeRequestId || id, value as ProgressInfo),
  })
  return translatorPromise
}

function validateRequest(value: unknown): OpusTranslateRequest {
  if (typeof value !== 'object' || value === null) throw new Error('invalid local translation request')
  const request = value as Partial<OpusTranslateRequest>
  if (request.type !== 'translate' || !Number.isSafeInteger(request.id) || !Array.isArray(request.texts)) {
    throw new Error('invalid local translation request')
  }
  if (request.texts.length === 0 || request.texts.length > OPUS_MAX_TEXTS) throw new Error('local translation batch is out of bounds')
  if (request.texts.some(text => typeof text !== 'string' || text.length === 0 || text.length > OPUS_MAX_TEXT_LENGTH || !CHINESE_RE.test(text))) {
    throw new Error('local translation text is out of bounds')
  }
  return request as OpusTranslateRequest
}

function extractTranslations(value: unknown, expected: number): string[] {
  if (!Array.isArray(value)) throw new Error('local model returned an invalid result')
  const rows = value.length === expected ? value : expected === 1 ? [value] : []
  if (rows.length !== expected) throw new Error('local model returned the wrong number of translations')
  return rows.map((row) => {
    const candidate = Array.isArray(row) ? row[0] : row
    if (typeof candidate !== 'object' || candidate === null || typeof (candidate as { translation_text?: unknown }).translation_text !== 'string') {
      throw new Error('local model returned an invalid translation')
    }
    const translated = (candidate as { translation_text: string }).translation_text.trim()
    if (translated.length === 0 || translated.length > 1_000) throw new Error('local model returned an invalid translation')
    return translated
  })
}

async function handle(value: unknown): Promise<void> {
  let id = 0
  try {
    const request = validateRequest(value)
    id = request.id
    activeRequestId = id
    const translator = await getTranslator(id)
    const output = await (translator as unknown as RunTranslation)(request.texts, { max_new_tokens: 512 })
    const translations = extractTranslations(output, request.texts.length)
    scope.postMessage({ type: 'result', id, translations })
  } catch (error) {
    scope.postMessage({ type: 'error', id, error: error instanceof Error ? error.message : 'local translation failed' })
  } finally {
    if (activeRequestId === id) activeRequestId = 0
  }
}

let queue = Promise.resolve()
scope.onmessage = (event) => {
  queue = queue.then(() => handle(event.data), () => handle(event.data))
}
