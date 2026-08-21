import type { VettedLocalPair } from './language-pairs.ts'

export interface TranslationTextPart {
  prefix: string
  core: string
  suffix: string
  translate: boolean
  continuation: boolean
}

interface BoundedPart {
  value: string
  continuation: boolean
}

const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const LATIN_RE = /\p{Script=Latin}/u
const FALLBACK_SENTENCE_RE = /.*?(?:[。！？!?；;.]|\n+|$)/gsu

type SegmentGranularity = 'sentence' | 'word' | 'grapheme'
interface SegmentData { segment: string }
interface SegmenterLike { segment(value: string): Iterable<SegmentData> }
interface SegmenterConstructor {
  new (locale?: string, options?: { granularity?: SegmentGranularity }): SegmenterLike
}

function segmenter(locale: string, granularity: SegmentGranularity): SegmenterLike | undefined {
  const Constructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
  if (Constructor === undefined) return undefined
  try {
    return new Constructor(locale, { granularity })
  } catch {
    return undefined
  }
}

function sourceLocale(pair: VettedLocalPair): string {
  return pair.sourceLanguage === 'zh' ? 'zh-CN' : pair.sourceLanguage
}

export function containsSourceLanguage(value: string, pair: VettedLocalPair): boolean {
  if (pair.sourceMatcher === 'han') return HAN_RE.test(value)
  if (pair.sourceMatcher === 'latin') return LATIN_RE.test(value)
  return false
}

function sentenceSegments(value: string, pair: VettedLocalPair): string[] {
  const iterator = segmenter(sourceLocale(pair), 'sentence')?.segment(value)
  if (iterator !== undefined) return [...iterator].map(item => item.segment).filter(Boolean)
  return value.match(FALLBACK_SENTENCE_RE)?.filter(Boolean) ?? [value]
}

function hardUnits(value: string, pair: VettedLocalPair): string[] {
  const wordIterator = segmenter(sourceLocale(pair), 'word')?.segment(value)
  if (wordIterator !== undefined) return [...wordIterator].map(item => item.segment).filter(Boolean)
  return [...value]
}

function splitOversizedUnit(value: string, maximumLength: number): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const character of value) {
    if (chunk.length > 0 && chunk.length + character.length > maximumLength) {
      chunks.push(chunk)
      chunk = ''
    }
    chunk += character
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

function splitBounded(value: string, pair: VettedLocalPair, maximumLength: number): BoundedPart[] {
  if (value.length <= maximumLength) return [{ value, continuation: false }]
  const chunks: string[] = []
  let chunk = ''
  const append = (unit: string): void => {
    if (chunk.length > 0 && chunk.length + unit.length > maximumLength) {
      chunks.push(chunk)
      chunk = ''
    }
    if (unit.length <= maximumLength) {
      chunk += unit
      return
    }
    const pieces = splitOversizedUnit(unit, maximumLength)
    for (const piece of pieces) {
      if (chunk.length > 0) chunks.push(chunk)
      chunk = piece
      if (chunk.length === maximumLength) {
        chunks.push(chunk)
        chunk = ''
      }
    }
  }
  for (const unit of hardUnits(value, pair)) append(unit)
  if (chunk.length > 0) chunks.push(chunk)
  return chunks.map((chunkValue, index) => ({ value: chunkValue, continuation: index > 0 }))
}

export function splitTextForPair(value: string, pair: VettedLocalPair, maximumLength: number): TranslationTextPart[] {
  return sentenceSegments(value, pair)
    .flatMap(sentence => splitBounded(sentence, pair, maximumLength))
    .filter(part => part.value.length > 0)
    .map(part => {
      const match = /^(\s*)(.*?)(\s*)$/su.exec(part.value)
      const prefix = match?.[1] ?? ''
      const core = match?.[2] ?? part.value
      const suffix = match?.[3] ?? ''
      return {
        prefix,
        core,
        suffix,
        translate: core.length > 0 && containsSourceLanguage(core, pair),
        continuation: part.continuation,
      }
    })
}

export function assembleTranslatedText(
  parts: readonly TranslationTextPart[],
  translatedSegments: ReadonlyMap<string, string>,
  pair: VettedLocalPair,
): string {
  return parts.map((part, index) => {
    const translated = part.translate ? translatedSegments.get(part.core) ?? part.core : part.core
    const changed = translated !== part.core
    const next = parts[index + 1]
    const nextTranslated = next?.translate ? translatedSegments.get(next.core) ?? next.core : next?.core
    const nextChanged = next !== undefined && nextTranslated !== next.core
    const startsHardContinuation = part.translate && part.continuation && changed
    const endsAtHardBoundary = part.translate && changed && next?.continuation === true && nextChanged
    const separator = startsHardContinuation && pair.targetJoinStrategy === 'spaced' ? ' ' : ''
    const prefix = startsHardContinuation ? '' : part.prefix
    const suffix = endsAtHardBoundary ? '' : part.suffix
    return prefix + separator + translated + suffix
  }).join('')
}
