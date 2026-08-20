export const BACKENDS = ['offline-glossary', 'openai-compatible'] as const
export type BackendId = typeof BACKENDS[number]

export const TARGET_LANGUAGES = ['en', 'sv', 'de', 'fr', 'es', 'ja', 'ko'] as const
export type TargetLanguage = typeof TARGET_LANGUAGES[number]

export interface UITranslateSettings {
  enabled?: boolean
  targetLanguage?: TargetLanguage
  backend?: BackendId
  endpoint?: string
  model?: string
  allowRemoteEndpoint?: boolean
  apiKeyEnv?: string
}

export interface ResolvedUITranslateSettings {
  enabled: boolean
  targetLanguage: TargetLanguage
  backend: BackendId
  endpoint: string
  model: string
  allowRemoteEndpoint: boolean
  apiKeyEnv: string
}

export function resolveSettings(value: UITranslateSettings | undefined): ResolvedUITranslateSettings {
  return {
    enabled: value?.enabled ?? false,
    targetLanguage: value?.targetLanguage ?? 'en',
    backend: value?.backend ?? 'offline-glossary',
    endpoint: value?.endpoint ?? 'http://127.0.0.1:11434/v1',
    model: value?.model ?? 'qwen2.5:7b',
    allowRemoteEndpoint: value?.allowRemoteEndpoint ?? false,
    apiKeyEnv: value?.apiKeyEnv ?? 'DSH_UI_TRANSLATE_API_KEY',
  }
}
