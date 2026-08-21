import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers'
import {
  OPUS_MAX_TEXT_LENGTH,
  OPUS_MAX_TEXTS,
  OPUS_WASM_BASE_URL,
  type OpusTranslateRequest,
  type OpusWorkerMessage,
} from '../core/opus.ts'
import { VETTED_LOCAL_PAIRS, type LocalPairId, type VettedLocalPair } from '../core/language-pairs.ts'
import { containsSourceLanguage } from '../core/text-segmentation.ts'

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: OpusWorkerMessage): void
}

interface ProgressInfo {
  status?: unknown
  file?: unknown
  progress?: unknown
}

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
let translatorPairId: LocalPairId | undefined
let activeRequestId = 0
let activePairId = ''

function progressFor(id: number, pairId: string, value: ProgressInfo): void {
  const status = typeof value.status === 'string' ? value.status : 'loading'
  const file = typeof value.file === 'string' ? value.file.split('/').pop() : undefined
  const progress = typeof value.progress === 'number' && Number.isFinite(value.progress)
    ? Math.max(0, Math.min(100, value.progress))
    : undefined
  scope.postMessage({ type: 'progress', id, pairId, status, file, progress })
}

async function getTranslator(id: number, pairId: LocalPairId, pair: VettedLocalPair): Promise<TranslationPipeline> {
  if (translatorPairId !== undefined && translatorPairId !== pairId) throw new Error('local model Worker cannot switch language pairs')
  translatorPairId = pairId
  translatorPromise ??= createTranslationPipeline('translation', pair.modelId, {
    revision: pair.revision,
    device: 'wasm',
    dtype: pair.dtype,
    progress_callback: (value: unknown) => progressFor(activeRequestId || id, activePairId || pairId, value as ProgressInfo),
  })
  return translatorPromise
}

function validateRequest(value: unknown): OpusTranslateRequest {
  if (typeof value !== 'object' || value === null) throw new Error('invalid local translation request')
  const request = value as Partial<OpusTranslateRequest>
  if (request.type !== 'translate' || !Number.isSafeInteger(request.id) || typeof request.pairId !== 'string' || !Array.isArray(request.texts)) {
    throw new Error('invalid local translation request')
  }
  if (!(request.pairId in VETTED_LOCAL_PAIRS)) throw new Error('local translation pair is not vetted')
  const pairId = request.pairId as LocalPairId
  const pair = VETTED_LOCAL_PAIRS[pairId]
  if (request.texts.length === 0 || request.texts.length > OPUS_MAX_TEXTS) throw new Error('local translation batch is out of bounds')
  if (request.texts.some(text => typeof text !== 'string' || text.length === 0 || text.length > OPUS_MAX_TEXT_LENGTH || !containsSourceLanguage(text, pair))) {
    throw new Error('local translation text is out of bounds')
  }
  return { type: 'translate', id: request.id as number, pairId, texts: request.texts as string[] }
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
    return (candidate as { translation_text: string }).translation_text
  })
}

async function handle(value: unknown): Promise<void> {
  let id = typeof value === 'object' && value !== null && Number.isSafeInteger((value as { id?: unknown }).id)
    ? (value as { id: number }).id
    : 0
  let pairId = typeof value === 'object' && value !== null && typeof (value as { pairId?: unknown }).pairId === 'string'
    ? (value as { pairId: string }).pairId
    : ''
  try {
    const request = validateRequest(value)
    id = request.id
    pairId = request.pairId
    const requestPairId = request.pairId
    const pair = VETTED_LOCAL_PAIRS[requestPairId]
    activeRequestId = id
    activePairId = requestPairId
    const translator = await getTranslator(id, requestPairId, pair)
    const longest = Math.max(...request.texts.map(text => [...text].length))
    const maxNewTokens = Math.min(512, Math.max(48, longest * 2 + 24))
    const output = await (translator as unknown as RunTranslation)(request.texts, { max_new_tokens: maxNewTokens })
    const translations = extractTranslations(output, request.texts.length)
    scope.postMessage({ type: 'result', id, pairId, translations })
  } catch (error) {
    scope.postMessage({ type: 'error', id, pairId, error: error instanceof Error ? error.message : 'local translation failed' })
  } finally {
    if (activeRequestId === id) {
      activeRequestId = 0
      activePairId = ''
    }
  }
}

let queue = Promise.resolve()
scope.onmessage = (event) => {
  queue = queue.then(() => handle(event.data), () => handle(event.data))
}
