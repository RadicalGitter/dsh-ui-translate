import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'node_modules', 'onnxruntime-web', 'dist')
const output = resolve(root, 'lib')
const files = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]

await mkdir(output, { recursive: true })
await Promise.all(files.map(file => copyFile(resolve(source, file), resolve(output, file))))
