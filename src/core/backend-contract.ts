export const BACKENDS = ['offline-glossary', 'browser-opus-mt', 'openai-compatible'] as const
export type BackendId = typeof BACKENDS[number]
