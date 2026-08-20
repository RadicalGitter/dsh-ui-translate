import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { OPUS_ASSET_PREFIX } from './core/opus.ts'

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'opus-worker.js': 'text/javascript; charset=utf-8',
  'ort-wasm-simd-threaded.jsep.mjs': 'text/javascript; charset=utf-8',
  'ort-wasm-simd-threaded.jsep.wasm': 'application/wasm',
})

function writeError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(message)
}

export function createOpusAssetHandler(assetBase = new URL('.', import.meta.url)): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeError(res, 405, 'method not allowed')
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const prefix = `${OPUS_ASSET_PREFIX}/`
    const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
    const contentType = ASSET_CONTENT_TYPES[name]
    if (contentType === undefined) {
      writeError(res, 404, 'asset not found')
      return
    }
    try {
      const body = await readFile(new URL(name, assetBase))
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': String(body.byteLength),
        'cache-control': 'public, max-age=31536000, immutable',
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      writeError(res, 503, 'translation asset unavailable')
    }
  }
}
