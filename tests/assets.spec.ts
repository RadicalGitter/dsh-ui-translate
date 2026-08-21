import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpusAssetHandler } from '../src/assets.ts'
import { OPUS_ASSET_PREFIX, OPUS_WORKER_REVISION, OPUS_WORKER_URL } from '../src/core/opus.ts'

const servers: Server[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function serveAssets(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ui-translate-assets-'))
  directories.push(directory)
  await Promise.all([
    writeFile(join(directory, 'opus-worker.js'), 'export const ready = true'),
    writeFile(join(directory, 'ort-wasm-simd-threaded.jsep.mjs'), 'export default {}'),
    writeFile(join(directory, 'ort-wasm-simd-threaded.jsep.wasm'), new Uint8Array([0, 97, 115, 109])),
  ])
  const handler = createOpusAssetHandler(pathToFileURL(directory + sep))
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('asset test server did not bind')
  return `http://127.0.0.1:${address.port}`
}

describe('local-model asset route', () => {
  it('uses a fresh immutable URL for the pair-aware Worker protocol', () => {
    expect(OPUS_WORKER_REVISION).toBe('4')
    expect(OPUS_WORKER_URL).toBe(`${OPUS_ASSET_PREFIX}/opus-worker.js?revision=4`)
  })

  it('serves only fixed versioned Worker and WASM assets', async () => {
    const url = await serveAssets()
    const worker = await fetch(`${url}${OPUS_ASSET_PREFIX}/opus-worker.js`)
    expect(worker.status).toBe(200)
    expect(worker.headers.get('content-type')).toContain('text/javascript')
    expect(worker.headers.get('cache-control')).toContain('immutable')
    expect(await worker.text()).toContain('ready')

    const wasm = await fetch(`${url}${OPUS_ASSET_PREFIX}/ort-wasm-simd-threaded.jsep.wasm`, { method: 'HEAD' })
    expect(wasm.status).toBe(200)
    expect(wasm.headers.get('content-type')).toBe('application/wasm')
    expect(await wasm.text()).toBe('')
  })

  it('rejects unknown paths, traversal attempts, and write methods', async () => {
    const url = await serveAssets()
    expect((await fetch(`${url}${OPUS_ASSET_PREFIX}/unknown.js`)).status).toBe(404)
    expect((await fetch(`${url}${OPUS_ASSET_PREFIX}/%2e%2e/package.json`)).status).toBe(404)
    expect((await fetch(`${url}${OPUS_ASSET_PREFIX}/opus-worker.js`, { method: 'POST' })).status).toBe(405)
  })
})
