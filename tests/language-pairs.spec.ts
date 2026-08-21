import { describe, expect, it } from 'vitest'
import {
  VETTED_LOCAL_PAIRS,
  pairIdFor,
  requireVettedLocalPair,
  resolveVettedLocalPair,
} from '../src/core/language-pairs.ts'

describe('vetted local language pairs', () => {
  it('migrates the existing browser-local behavior to the zh-en pair', () => {
    expect(pairIdFor('zh', 'en')).toBe('zh-en')
    expect(requireVettedLocalPair('zh', 'en')).toMatchObject({
      id: 'zh-en',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      modelId: 'Xenova/opus-mt-zh-en',
      sourceMatcher: 'han',
      targetJoinStrategy: 'spaced',
    })
    expect(resolveVettedLocalPair('zh', 'sv')).toBeUndefined()
  })

  it('requires immutable provenance and notice metadata for every pair', () => {
    for (const [id, pair] of Object.entries(VETTED_LOCAL_PAIRS)) {
      expect(pair.id).toBe(id)
      expect(pair.sourceLanguage).not.toBe(pair.targetLanguage)
      expect(pair.modelId).toMatch(/^Xenova\/opus-mt-/u)
      expect(pair.revision).toMatch(/^[a-f0-9]{40}$/u)
      expect(pair.approximateDownloadBytes).toBeGreaterThan(0)
      expect(pair.sourceModelUrl).toMatch(/^https:\/\/huggingface\.co\/Helsinki-NLP\//u)
      expect(pair.conversionModelUrl).toMatch(/^https:\/\/huggingface\.co\/Xenova\//u)
      expect(pair.noticeFile).toBe('THIRD_PARTY_NOTICES.md')
    }
  })
})
