// Super-resolución ESRGAN (modelos de UpscalerJS, entrenados en DIV2K) corriendo en Node con
// TensorFlow.js + backend WASM (tfjs-node no tiene binarios para darwin-arm64 / Node 24).
// Uso desde scripts/build-assets.mjs:  const up = await createUpscaler({ model: 'medium', scale: 2 })
//                                       const rgbOut = await up(rgbUint8, w, h)   // Uint8 RGB w*h*3 → (w*s)*(h*s)*3
// Procesa por parches con margen (para no dejar costuras) y devuelve exactamente w*s x h*s.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export async function createUpscaler({ model = 'medium', scale = 2, patch = 96, pad = 8, log = () => {} } = {}) {
  const tf = await import('@tensorflow/tfjs')
  const wasm = await import('@tensorflow/tfjs-backend-wasm')
  const wasmDir = path.join(here, 'node_modules/@tensorflow/tfjs-backend-wasm/dist/')
  wasm.setWasmPaths(wasmDir)
  // En Node, tfjs-backend-wasm lee los .wasm del disco
  try { wasm.setThreadsCount?.(Math.max(1, (await import('node:os')).cpus().length - 1)) } catch { /* sin hilos */ }
  if (!(await tf.setBackend('wasm'))) await tf.setBackend('cpu')
  await tf.ready()
  log(`tfjs backend: ${tf.getBackend()}`)

  const pkg = `@upscalerjs/esrgan-${model}`
  const dir = path.join(here, 'node_modules', pkg, `models/x${scale}`)
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'))
  const rdn = !JSON.stringify(json.modelTopology).includes('PixelShuffle')

  if (!rdn) {
    // Capas propias de los modelos "thick"/"slim" (ver @upscalerjs/shared esrgan.js)
    const Layer = tf.layers.Layer
    const first = (x) => (Array.isArray(x) ? x[0] : x)
    class MultiplyBeta extends Layer { constructor() { super({}) } call(i) { return tf.mul(first(i), 0.2) } static className = 'MultiplyBeta' }
    class PixelShuffle extends Layer {
      constructor() { super({}) }
      computeOutputShape(s) { return [s[0], s[1] * scale, s[2] * scale, 3] }
      call(i) { return tf.depthToSpace(first(i), scale, 'NHWC') }
      static className = `PixelShuffle${scale}x`
    }
    tf.serialization.registerClass(MultiplyBeta)
    tf.serialization.registerClass(PixelShuffle)
  }
  const specs = json.weightsManifest.flatMap((g) => g.weights)
  const bufs = json.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(path.join(dir, p))))
  const all = Buffer.concat(bufs)
  const weightData = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength)
  const net = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: specs, weightData }))
  log(`modelo ${pkg} x${scale} (${rdn ? 'RDN 0..255' : 'RRDN 0..1'}) cargado`)
  const k = rdn ? 1 : 1 / 255

  /** rgb: Uint8Array(w*h*3). Devuelve Uint8Array((w*s)*(h*s)*3). */
  return async function upscale(rgb, w, h) {
    const S = scale
    const out = new Uint8Array(w * S * h * S * 3)
    const src = tf.tensor3d(rgb, [h, w, 3], 'int32')
    // Relleno espejado para que los bordes de la imagen también tengan contexto
    const padded = tf.tidy(() => tf.mirrorPad(src.toFloat(), [[pad, pad], [pad, pad], [0, 0]], 'symmetric'))
    src.dispose()
    for (let y0 = 0; y0 < h; y0 += patch) {
      for (let x0 = 0; x0 < w; x0 += patch) {
        const pw = Math.min(patch, w - x0), ph = Math.min(patch, h - y0)
        const res = tf.tidy(() => {
          const tile = padded.slice([y0, x0, 0], [ph + 2 * pad, pw + 2 * pad, 3]).mul(k).expandDims(0)
          let y = net.predict(tile)
          y = y.squeeze([0]).div(k).clipByValue(0, 255)
          return y.slice([pad * S, pad * S, 0], [ph * S, pw * S, 3]).round().toInt()
        })
        const data = await res.data()
        res.dispose()
        for (let yy = 0; yy < ph * S; yy++) {
          const o = ((y0 * S + yy) * w * S + x0 * S) * 3
          for (let i = 0; i < pw * S * 3; i++) out[o + i] = data[yy * pw * S * 3 + i]
        }
      }
    }
    padded.dispose()
    return out
  }
}

// Prueba rápida: node esrgan.mjs entrada.png salida.png [medium|thick|slim]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sharp = (await import('sharp')).default
  const [, , inp, outp, model = 'medium'] = process.argv
  const { data, info } = await sharp(inp).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const up = await createUpscaler({ model, scale: 2, log: console.log })
  const t0 = Date.now()
  const o = await up(new Uint8Array(data), info.width, info.height)
  console.log(`${info.width}x${info.height} en ${Date.now() - t0} ms`)
  await sharp(Buffer.from(o), { raw: { width: info.width * 2, height: info.height * 2, channels: 3 } }).png().toFile(outp)
}
