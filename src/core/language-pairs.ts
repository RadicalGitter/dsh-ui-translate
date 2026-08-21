export const LANGUAGE_IDS = ['zh', 'en', 'sv', 'de', 'fr', 'es', 'ja', 'ko'] as const
export type LanguageId = typeof LANGUAGE_IDS[number]

export const SOURCE_LANGUAGES = ['zh'] as const satisfies readonly LanguageId[]
export type SourceLanguage = typeof SOURCE_LANGUAGES[number]
export const TARGET_LANGUAGES = ['en', 'sv', 'de', 'fr', 'es', 'ja', 'ko'] as const satisfies readonly LanguageId[]
export type TargetLanguage = typeof TARGET_LANGUAGES[number]

export const DEFAULT_SOURCE_LANGUAGE: SourceLanguage = 'zh'
export const DEFAULT_TARGET_LANGUAGE: TargetLanguage = 'en'

export type SourceMatcherId = 'han' | 'latin'
export type TargetJoinStrategy = 'spaced' | 'cjk'

export interface VettedLocalPair {
  id: string
  sourceLanguage: LanguageId
  targetLanguage: LanguageId
  modelId: string
  revision: string
  dtype: 'q8'
  approximateDownloadBytes: number
  sourceMatcher: SourceMatcherId
  targetJoinStrategy: TargetJoinStrategy
  license: 'CC-BY-4.0'
  sourceModelUrl: string
  conversionModelUrl: string
  noticeFile: 'THIRD_PARTY_NOTICES.md'
}

export const VETTED_LOCAL_PAIRS = Object.freeze({
  'zh-en': Object.freeze({
    id: 'zh-en',
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    modelId: 'Xenova/opus-mt-zh-en',
    revision: '39d480d52a9ea3065a1f117adfe4dbc55de10e6f',
    dtype: 'q8',
    approximateDownloadBytes: 110 * 1024 * 1024,
    sourceMatcher: 'han',
    targetJoinStrategy: 'spaced',
    license: 'CC-BY-4.0',
    sourceModelUrl: 'https://huggingface.co/Helsinki-NLP/opus-mt-zh-en',
    conversionModelUrl: 'https://huggingface.co/Xenova/opus-mt-zh-en',
    noticeFile: 'THIRD_PARTY_NOTICES.md',
  } satisfies VettedLocalPair),
})

export type LocalPairId = keyof typeof VETTED_LOCAL_PAIRS

export function pairIdFor(sourceLanguage: LanguageId, targetLanguage: LanguageId): string {
  return `${sourceLanguage}-${targetLanguage}`
}

export function resolveVettedLocalPair(sourceLanguage: LanguageId, targetLanguage: LanguageId): VettedLocalPair | undefined {
  return VETTED_LOCAL_PAIRS[pairIdFor(sourceLanguage, targetLanguage) as LocalPairId]
}

export function requireVettedLocalPair(sourceLanguage: LanguageId, targetLanguage: LanguageId): VettedLocalPair {
  const pair = resolveVettedLocalPair(sourceLanguage, targetLanguage)
  if (pair === undefined) throw new Error(`browser-local translation pair is not available: ${sourceLanguage}→${targetLanguage}`)
  return pair
}
