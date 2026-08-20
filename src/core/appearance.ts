export const TRANSLATION_MARKER_STYLES = ['overlay', 'underline', 'both', 'none'] as const
export type TranslationMarkerStyle = typeof TRANSLATION_MARKER_STYLES[number]
export const DEFAULT_TRANSLATION_MARKER_STYLE: TranslationMarkerStyle = 'overlay'
