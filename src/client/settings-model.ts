import { DEFAULT_TRANSLATION_MARKER_STYLE, type TranslationMarkerStyle } from '../core/appearance.ts'
import { BACKENDS, type BackendId } from '../core/backend-contract.ts'
import {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  type SourceLanguage,
  type TargetLanguage,
} from '../core/language-pairs.ts'

export { BACKENDS, SOURCE_LANGUAGES, TARGET_LANGUAGES }
export type { BackendId, SourceLanguage, TargetLanguage }

export interface UITranslateSettings {
  enabled?: boolean
  sourceLanguage?: SourceLanguage
  targetLanguage?: TargetLanguage
  backend?: BackendId
  endpoint?: string
  model?: string
  allowRemoteEndpoint?: boolean
  apiKeyEnv?: string
  markerStyle?: TranslationMarkerStyle
}

export interface ResolvedUITranslateSettings {
  enabled: boolean
  sourceLanguage: SourceLanguage
  targetLanguage: TargetLanguage
  backend: BackendId
  endpoint: string
  model: string
  allowRemoteEndpoint: boolean
  apiKeyEnv: string
  markerStyle: TranslationMarkerStyle
}

export function resolveSettings(value: UITranslateSettings | undefined): ResolvedUITranslateSettings {
  return {
    enabled: value?.enabled ?? false,
    sourceLanguage: value?.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: value?.targetLanguage ?? DEFAULT_TARGET_LANGUAGE,
    backend: value?.backend ?? 'offline-glossary',
    endpoint: value?.endpoint ?? 'http://127.0.0.1:11434/v1',
    model: value?.model ?? 'qwen2.5:7b',
    allowRemoteEndpoint: value?.allowRemoteEndpoint ?? false,
    apiKeyEnv: value?.apiKeyEnv ?? 'DSH_UI_TRANSLATE_API_KEY',
    markerStyle: value?.markerStyle ?? DEFAULT_TRANSLATION_MARKER_STYLE,
  }
}
