import { VETTED_LOCAL_PAIRS, type LocalPairId } from './language-pairs.ts'

export const OPUS_MODEL_ID = VETTED_LOCAL_PAIRS['zh-en'].modelId
export const OPUS_MODEL_REVISION = VETTED_LOCAL_PAIRS['zh-en'].revision
export const OPUS_RUNTIME_VERSION = '0.3.0'
export const OPUS_ASSET_PREFIX = `/ui-translate/assets/v${OPUS_RUNTIME_VERSION}`
export const OPUS_WORKER_REVISION = '3'
export const OPUS_WORKER_URL = `${OPUS_ASSET_PREFIX}/opus-worker.js?revision=${OPUS_WORKER_REVISION}`
export const OPUS_WASM_BASE_URL = `${OPUS_ASSET_PREFIX}/`
export const OPUS_MAX_TEXTS = 16
export const OPUS_MAX_TEXT_LENGTH = 320

export interface OpusTranslateRequest {
  type: 'translate'
  id: number
  pairId: LocalPairId
  texts: string[]
}

export interface OpusProgressMessage {
  type: 'progress'
  id: number
  pairId: string
  status: string
  file?: string
  progress?: number
}

export interface OpusResultMessage {
  type: 'result'
  id: number
  pairId: string
  translations: string[]
}

export interface OpusErrorMessage {
  type: 'error'
  id: number
  pairId: string
  error: string
}

export type OpusWorkerMessage = OpusProgressMessage | OpusResultMessage | OpusErrorMessage
