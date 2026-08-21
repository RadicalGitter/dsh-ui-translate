import { describe, expect, it } from 'vitest'
import { VETTED_LOCAL_PAIRS, type VettedLocalPair } from '../src/core/language-pairs.ts'
import {
  assembleTranslatedText,
  containsSourceLanguage,
  splitTextForPair,
} from '../src/core/text-segmentation.ts'

const zhEn = VETTED_LOCAL_PAIRS['zh-en']
const enZh: VettedLocalPair = {
  ...zhEn,
  id: 'en-zh',
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  modelId: 'Xenova/opus-mt-en-zh',
  revision: '86e3ede49e2d00ac8d34a476834930964ac74be5',
  sourceMatcher: 'latin',
  targetJoinStrategy: 'cjk',
  sourceModelUrl: 'https://huggingface.co/Helsinki-NLP/opus-mt-en-zh',
  conversionModelUrl: 'https://huggingface.co/Xenova/opus-mt-en-zh',
}

describe('pair-aware text segmentation', () => {
  it('matches source scripts through pair metadata', () => {
    expect(containsSourceLanguage('正在加载', zhEn)).toBe(true)
    expect(containsSourceLanguage('English only', zhEn)).toBe(false)
    expect(containsSourceLanguage('English only', enZh)).toBe(true)
    expect(containsSourceLanguage('123…', enZh)).toBe(false)
  })

  it('segments English periods and preserves exact surrounding whitespace', () => {
    const parts = splitTextForPair('  First sentence.\nSecond sentence!  ', enZh, 320)
    expect(parts.map(part => part.core).join('')).toContain('First sentence.')
    expect(parts.map(part => part.core).join('')).toContain('Second sentence!')
    expect(parts[0].prefix).toBe('  ')
    expect(parts.at(-1)?.suffix).toBe('  ')
    expect(parts.filter(part => part.translate).every(part => part.core.length <= 320)).toBe(true)
  })

  it('uses target-aware joining for bounded continuation chunks', () => {
    const zhParts = splitTextForPair('长消息'.repeat(80), zhEn, 40)
    const enParts = splitTextForPair('longword '.repeat(80), enZh, 40)
    const zhTranslations = new Map(zhParts.filter(part => part.translate).map((part, index) => [part.core, `chunk${index}`]))
    const enTranslations = new Map(enParts.filter(part => part.translate).map((part, index) => [part.core, `片段${index}`]))

    expect(assembleTranslatedText(zhParts, zhTranslations, zhEn)).toContain(' chunk')
    expect(assembleTranslatedText(enParts, enTranslations, enZh)).not.toMatch(/片段\d+ 片段/u)
  })

  it('never splits surrogate pairs beyond the configured bound', () => {
    const parts = splitTextForPair(`中文${'🙂'.repeat(80)}`, zhEn, 31)
    expect(parts.every(part => part.core.length <= 31)).toBe(true)
    expect(parts.map(part => part.prefix + part.core + part.suffix).join('')).toBe(`中文${'🙂'.repeat(80)}`)
  })
})
