import { describe, expect, it } from 'vitest'
import { isKnownStaticPhrase, translateKnownStaticPhraseToEnglish } from '../src/core/static-phrases.ts'

describe('shared static phrase policy', () => {
  it.each([
    ['技能中心', 'Skills Center'],
    ['亲密度 幼鲸', 'Affinity Calf'],
    ['小鱼干 ×0', 'Treats ×0'],
    ['17 点', '17 pts'],
    ['喂食', 'Feed'],
    ['改名', 'Rename'],
    ['隐藏', 'Hide'],
  ])('translates approved UI phrase %s', (source, expected) => {
    expect(isKnownStaticPhrase(source)).toBe(true)
    expect(translateKnownStaticPhraseToEnglish(source)).toBe(expected)
  })

  it.each([
    '我的秘密项目',
    '小鱼干 ×private',
    '17 点 personal note',
    '亲密度 自定义等级',
  ])('rejects novel or user-controlled text %s', (source) => {
    expect(isKnownStaticPhrase(source)).toBe(false)
    expect(translateKnownStaticPhraseToEnglish(source)).toBeUndefined()
  })
})
