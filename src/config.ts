import z from 'schemastery'
import { DEFAULT_TRANSLATION_MARKER_STYLE, TRANSLATION_MARKER_STYLES, type TranslationMarkerStyle } from './core/appearance.ts'
import { BACKENDS, type BackendId } from './core/backend-contract.ts'
import {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  type SourceLanguage,
  type TargetLanguage,
} from './core/language-pairs.ts'

export { BACKENDS, SOURCE_LANGUAGES, TARGET_LANGUAGES }
export type { BackendId, SourceLanguage, TargetLanguage }

export const DEFAULT_API_KEY_ENV = 'DSH_UI_TRANSLATE_API_KEY'
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1'
export const DEFAULT_MODEL = 'qwen2.5:7b'

export interface Config {
  /** Master switch. Disabled by default so installation never mutates the page silently. */
  enabled?: boolean
  /** Source language for translation; defaults to Chinese for backward compatibility. */
  sourceLanguage?: SourceLanguage
  /** BCP-47-ish target language id supported by the settings UI. */
  targetLanguage?: TargetLanguage
  /** Translation backend. Offline glossary is the no-network default. */
  backend?: BackendId
  /** OpenAI-compatible base URL, used only when that backend is selected. */
  endpoint?: string
  /** OpenAI-compatible model id. */
  model?: string
  /** Permit public endpoint hosts. Private/loopback endpoints need no opt-in. */
  allowRemoteEndpoint?: boolean
  /** Environment variable containing the optional bearer token. */
  apiKeyEnv?: string
  /** Visual marker applied to translated text. */
  markerStyle?: TranslationMarkerStyle
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  sourceLanguage: z.union(SOURCE_LANGUAGES).default(DEFAULT_SOURCE_LANGUAGE),
  targetLanguage: z.union(TARGET_LANGUAGES).default(DEFAULT_TARGET_LANGUAGE),
  backend: z.union(BACKENDS).default('offline-glossary'),
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  model: z.string().default(DEFAULT_MODEL),
  allowRemoteEndpoint: z.boolean().default(false),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  markerStyle: z.union(TRANSLATION_MARKER_STYLES).default(DEFAULT_TRANSLATION_MARKER_STYLE),
})

export interface ResolvedConfig {
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

export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    enabled: config.enabled ?? false,
    sourceLanguage: config.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: config.targetLanguage ?? DEFAULT_TARGET_LANGUAGE,
    backend: config.backend ?? 'offline-glossary',
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    model: config.model ?? DEFAULT_MODEL,
    allowRemoteEndpoint: config.allowRemoteEndpoint ?? false,
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    markerStyle: config.markerStyle ?? DEFAULT_TRANSLATION_MARKER_STYLE,
  }
}
