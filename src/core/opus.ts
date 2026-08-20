export const OPUS_MODEL_ID = 'Xenova/opus-mt-zh-en'
export const OPUS_MODEL_REVISION = '39d480d52a9ea3065a1f117adfe4dbc55de10e6f'
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
  texts: string[]
}

export interface OpusProgressMessage {
  type: 'progress'
  id: number
  status: string
  file?: string
  progress?: number
}

export interface OpusResultMessage {
  type: 'result'
  id: number
  translations: string[]
}

export interface OpusErrorMessage {
  type: 'error'
  id: number
  error: string
}

export type OpusWorkerMessage = OpusProgressMessage | OpusResultMessage | OpusErrorMessage
