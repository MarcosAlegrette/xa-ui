// Pipeline de assets (sólo local; el resultado SE COMMITEA porque Amplify no tiene ffmpeg ni ../original).
//
// Imágenes → public/assets/img/<clave>.<set><ancho>.<ext> + src/data/assets.json (manifiesto):
//  · set "o" (original): el arte original, recortado y en WebP (opción "Gráficos originales").
//  · set "h" (HD): para cada imagen, en este orden:
//      1. art-src/hd/<misma ruta que en original/assets, sin importar la extensión>.png|jpg|webp
//         (arte regenerado en alta resolución). Si conserva la proporción del original se usa con la
//         misma composición (las coordenadas del código siguen valiendo); si es arte nuevo (p. ej. 16:9)
//         sólo se acepta para pantallas "escénicas" (fondos, menú, mapa, historieta), que se dibujan
//         a pantalla completa con "cover" + punto focal.
//      2. si no hay arte nuevo: super-resolución ESRGAN x2 (UpscalerJS esrgan-medium, en tools/upscale,
//         TensorFlow.js + WASM) con el alfa escalado aparte (lanczos3) y los colores "sangrados" hacia
//         los píxeles transparentes para que no queden halos. Los tilesets se escalan tile por tile con
//         bordes replicados (sin costuras). Si el modelo no está instalado: lanczos3 + enfoque suave.
//    Las escénicas llevan variantes por ancho (≈960/1600/2560, nunca más que la fuente) en AVIF + WebP
//    y una versión mini desenfocada para el fondo extendido.
// Audio → Opus/WebM (música 96 kb/s, efectos 64 kb/s) + MP3 de respaldo (Safari viejo).
// Íconos PWA → public/icons (de los cuadros originales de Xa).
//   node scripts/build-assets.mjs [--force] [--no-ai] [--only=clave1,clave2]
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const A = path.resolve(root, '../original/assets')
const HD = path.join(root, 'art-src/hd')
const CACHE = path.join(root, 'art-src/.cache')
const OUT = path.join(root, 'public/assets')
const IMG = path.join(OUT, 'img')
const MANIFEST = path.join(root, 'src/data/assets.json')
const force = process.argv.includes('--force')
const noAi = process.argv.includes('--no-ai')
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
if (!fs.existsSync(A)) { console.error(`No se encuentra ${A}`); process.exit(1) }
sharp.concurrency(Math.max(2, os.cpus().length - 2))

const mk = (f) => fs.mkdirSync(path.dirname(f), { recursive: true })
const hash = (...parts) => { const h = crypto.createHash('sha1'); for (const p of parts) h.update(p); return h.digest('hex').slice(0, 10) }
let made = 0

// ---------------------------------------------------------------- catálogo de imágenes
// kind: 'scene' (pantalla completa / fondo; acepta arte nuevo), 'sprite' (atlas con alfa), 'tiles', 'ui'
const SCREEN = [0, 0, 512, 384]
const CATALOG = [
  ...fs.readdirSync(path.join(A, 'images/background')).map((f) => ({ key: `bg/${f.replace('.jpg', '')}`, src: `images/background/${f}`, kind: 'scene', focal: [0.5, 0.6] })),
  ...fs.readdirSync(path.join(A, 'images/tiles/win')).map((f) => ({ key: `tiles/${f.replace('.png', '')}`, src: `images/tiles/win/${f}`, kind: 'tiles' })),
  ...[
    ['images/menuElements/menu.jpg', 'menu', [0.45, 0.45]], ['images/menuElements/menu_night.jpg', 'menu_night', [0.45, 0.45]],
    ['images/menuElements/screen_logo_batovi.jpg', 'logo_batovi'], ['images/menuElements/screen_logo_calcar.jpg', 'logo_calcar'],
    ['lang/images/credits/creditos.jpg', 'creditos'], ['lang/images/help/ayuda.jpg', 'ayuda'],
    ['lang/images/intros/game_over.jpg', 'game_over'], ['lang/images/intros/screen_win.jpg', 'screen_win'],
    ['images/menuElements/map.png', 'map', [0.5, 0.42]],
    ...[1, 2, 3, 4, 5].map((i) => [`lang/images/intros/page_${i}.jpg`, `page_${i}`]),
  ].map(([src, d, focal]) => ({ key: `screens/${d}`, src, crop: SCREEN, kind: 'scene', focal: focal ?? [0.5, 0.5], flatten: '#000' })),
  // Piezas sueltas del menú original (el arte nuevo no las trae: las dibuja el juego)
  { key: 'ui/record_box', src: 'images/menuElements/menu.jpg', crop: [393, 0, 106, 40], kind: 'ui', ai: false },
  { key: 'ui/calcar_logo', src: 'images/menuElements/menu.jpg', crop: [426, 335, 73, 44], kind: 'ui', ai: false, mask: 'calcar' },
  ...[
    ['images/menuElements/map.png', 'map'], ['images/menuElements/cargando_tile.png', 'cargando'],
    ['images/menuElements/options_win.png', 'options'], ['images/menuElements/exit_confirmation.png', 'exit_confirmation'],
    ['lang/images/intros/fondo_niveles.png', 'fondo_niveles'], ['lang/images/intros/preview_levels_tile.jpg', 'preview_levels'],
    ['lang/images/menu/banner.png', 'banner'], ['lang/images/menu/press_any_key.png', 'press_any_key'],
    ['images/menuElements/buttons_tile.png', 'buttons'], ['images/menuElements/items_tile.png', 'items'],
    ['images/menuElements/info_map.png', 'info_map'], ['images/menuElements/hud_message_back.png', 'hud_message_back'],
    ['images/menuElements/cursor.png', 'cursor'],
    ...['fuente_blanca', 'fuente_negra', 'fuente_negra_2'].map((f) => [`lang/images/${f}.png`, f]),
  ].map(([src, d]) => ({ key: `ui/${d}`, src, kind: 'ui' })),
  ...[
    ['images/hero/Xa_animaciones.png', 'hero'], ['images/hero/Xa_animaciones_red.png', 'hero_red'],
    ['images/hero/efecto_doble_salto_tile.png', 'double_jump_fx'],
    ['images/enemies/plantilla_enemigos_xa.png', 'enemies'], ['images/enemies/plantilla_enemigos_xa_red.png', 'enemies_red'],
    ['images/enemies/jefe_tile.png', 'boss'], ['images/enemies/jefe_tile_verde.png', 'boss_green'],
    ['images/elements/gate.png', 'gate'], ['images/elements/items_effect_tile.png', 'items_effect'],
    ['images/elements/mega_power.png', 'mega_power'], ['images/elements/planilla_blasts_xa_512x512_24bits.png', 'blasts'],
    ['images/elements/plantilla-vaca-1.png', 'cow1'], ['images/elements/plantilla-vaca-2.png', 'cow2'],
    ['images/elements/plataformas.png', 'platforms'], ['images/elements/save_tile.png', 'save'], ['images/elements/signs_tile.png', 'signs'],
  ].map(([src, d]) => ({ key: `sprites/${d}`, src, kind: 'sprite' })),
]

// ---------------------------------------------------------------- utilidades de imagen
async function rgba(input, crop) {
  let s = sharp(input).ensureAlpha()
  if (crop) s = s.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] })
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), w: info.width, h: info.height }
}
const toSharp = (im) => sharp(Buffer.from(im.data.buffer, im.data.byteOffset, im.data.byteLength), { raw: { width: im.w, height: im.h, channels: 4 } })
const hasAlpha = (im) => { for (let i = 3; i < im.data.length; i += 4) if (im.data[i] < 250) return true; return false }

/** "Sangra" el color de los píxeles opacos hacia los transparentes (evita halos oscuros al escalar). */
function bleed(im, passes = 12) {
  const { w, h } = im
  const d = new Uint8Array(im.data)
  let known = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) known[i] = d[i * 4 + 3] > 8 ? 1 : 0
  for (let p = 0; p < passes; p++) {
    const next = known.slice()
    let changed = false
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (known[i]) continue
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (!known[j]) continue
        r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++
      }
      if (n) { d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; next[i] = 1; changed = true }
    }
    known = next
    if (!changed) break
  }
  return { data: d, w, h }
}

let upscaler = null, upscalerName = 'lanczos3'
async function getUpscaler() {
  if (upscaler !== null || noAi) return upscaler
  const tool = path.join(root, 'tools/upscale/esrgan.mjs')
  if (!fs.existsSync(path.join(root, 'tools/upscale/node_modules/@upscalerjs/esrgan-medium'))) {
    console.warn('⚠ tools/upscale sin instalar (cd tools/upscale && npm install): se usa lanczos3 + enfoque')
    return (upscaler = false)
  }
  try {
    const { createUpscaler } = await import(tool)
    upscaler = await createUpscaler({ model: 'medium', scale: 2, log: (m) => console.log('  ' + m) })
    upscalerName = 'ESRGAN medium x2 (UpscalerJS/tfjs-wasm)'
  } catch (e) {
    console.warn('⚠ ESRGAN no pudo cargarse, se usa lanczos3:', e.message)
    upscaler = false
  }
  return upscaler
}

/** Escala RGB x2 con el modelo (o lanczos). rgb Uint8 w*h*3. */
async function upRgb(rgb, w, h) {
  const up = await getUpscaler()
  if (up) return up(rgb, w, h)
  const { data } = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
    .resize(w * 2, h * 2, { kernel: 'lanczos3' }).sharpen({ sigma: 0.6, m1: 0.6, m2: 1.2 }).raw().toBuffer({ resolveWithObject: true })
  return new Uint8Array(data)
}

/** x2 de una imagen RGBA respetando el alfa. */
async function up2(im) {
  const alpha = hasAlpha(im)
  const src = alpha ? bleed(im) : im
  const rgb = new Uint8Array(im.w * im.h * 3)
  for (let i = 0; i < im.w * im.h; i++) { rgb[i * 3] = src.data[i * 4]; rgb[i * 3 + 1] = src.data[i * 4 + 1]; rgb[i * 3 + 2] = src.data[i * 4 + 2] }
  const big = await upRgb(rgb, im.w, im.h)
  const W2 = im.w * 2, H2 = im.h * 2
  const out = new Uint8Array(W2 * H2 * 4)
  let a2 = null
  if (alpha) {
    const a = new Uint8Array(im.w * im.h)
    for (let i = 0; i < im.w * im.h; i++) a[i] = im.data[i * 4 + 3]
    a2 = new Uint8Array(await sharp(Buffer.from(a), { raw: { width: im.w, height: im.h, channels: 1 } }).resize(W2, H2, { kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer())
    if (a2.length !== W2 * H2) throw new Error(`alfa ${a2.length} != ${W2 * H2}`)
  }
  for (let i = 0; i < W2 * H2; i++) {
    out[i * 4] = big[i * 3]; out[i * 4 + 1] = big[i * 3 + 1]; out[i * 4 + 2] = big[i * 3 + 2]
    out[i * 4 + 3] = a2 ? a2[i] : 255
  }
  return { data: out, w: W2, h: H2 }
}

/** x2 de un tileset: cada tile de 32 px se escala con 8 px de borde replicado (sin costuras entre tiles). */
async function up2Tiles(im, T = 32, P = 8) {
  const cols = im.w / T, rows = im.h / T, C = T + 2 * P
  const pad = { data: new Uint8Array(cols * C * rows * C * 4), w: cols * C, h: rows * C }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const sx = c * T + Math.min(T - 1, Math.max(0, x - P)), sy = r * T + Math.min(T - 1, Math.max(0, y - P))
      const s = (sy * im.w + sx) * 4, d = ((r * C + y) * pad.w + c * C + x) * 4
      pad.data[d] = im.data[s]; pad.data[d + 1] = im.data[s + 1]; pad.data[d + 2] = im.data[s + 2]; pad.data[d + 3] = im.data[s + 3]
    }
  }
  const big = await up2(pad)
  const out = { data: new Uint8Array(im.w * 2 * im.h * 2 * 4), w: im.w * 2, h: im.h * 2 }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (let y = 0; y < T * 2; y++) {
      const s = ((r * C * 2 + P * 2 + y) * big.w + c * C * 2 + P * 2) * 4
      const d = ((r * T * 2 + y) * out.w + c * T * 2) * 4
      out.data.set(big.data.subarray(s, s + T * 2 * 4), d)
    }
  }
  return out
}

/** Máscara del logo de Calcar (rectángulo + cúpula) sobre su recorte. */
async function applyMask(im, mask) {
  if (mask !== 'calcar') return im
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${im.w}" height="${im.h}">
    <rect x="1" y="17" width="${im.w - 2}" height="${im.h - 19}" rx="3" fill="#fff"/>
    <ellipse cx="${im.w / 2}" cy="19" rx="18.5" ry="17.5" fill="#fff"/></svg>`
  const m = await sharp(Buffer.from(svg)).resize(im.w, im.h).blur(0.6).ensureAlpha().raw().toBuffer()
  const d = new Uint8Array(im.data)
  for (let i = 0; i < im.w * im.h; i++) d[i * 4 + 3] = Math.min(d[i * 4 + 3], m[i * 4 + 3])
  return { data: d, w: im.w, h: im.h }
}

async function findOverride(src) {
  const base = path.join(HD, src.replace(/\.(png|jpe?g)$/i, ''))
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) if (fs.existsSync(base + ext)) return base + ext
  return null
}

/** Escribe variantes; devuelve [[ancho, hash]...]. */
async function writeVariants(key, set, im, widths, { formats = ['webp'], q = 86, lossless = false }) {
  const out = []
  const s0 = toSharp(im)
  for (const wpx of widths) {
    const hpx = Math.round((im.h * wpx) / im.w)
    const buf = wpx === im.w ? await s0.clone().png().toBuffer() : await s0.clone().resize(wpx, hpx, { kernel: 'lanczos3' }).png().toBuffer()
    const hsh = hash(buf)
    for (const f of formats) {
      const file = path.join(IMG, `${key}.${set}${wpx}.${f}`)
      mk(file)
      const s = sharp(buf)
      if (f === 'webp') await s.webp({ quality: q, alphaQuality: 100, effort: 6, lossless, smartSubsample: true }).toFile(file)
      else await s.avif({ quality: 76, effort: 6, chromaSubsampling: '4:4:4' }).toFile(file) // AVIF casi sin pérdida visible
      made++
    }
    out.push([wpx, hsh])
  }
  return out
}

const near = (a, b, tol = 0.02) => Math.abs(a / b - 1) < tol

async function buildImage(e, prev) {
  const srcFile = path.join(A, e.src)
  const meta0 = await sharp(srcFile).metadata()
  const crop = e.crop ?? [0, 0, meta0.width, meta0.height]
  const override = e.ai === false ? null : await findOverride(e.src)
  const sig = hash(fs.readFileSync(srcFile), override ? fs.readFileSync(override) : '', JSON.stringify(e), noAi ? 'noai' : 'ai', 'v4')
  if (!force && prev && prev.sig === sig && fs.existsSync(path.join(IMG, `${e.key}.o${prev.lw}.webp`))) return prev

  let orig = await rgba(srcFile, crop)
  if (e.mask) orig = await applyMask(orig, e.mask)
  const entry = { lw: crop[2], lh: crop[3], sig }
  const scene = e.kind === 'scene'
  const fmt = scene ? ['avif', 'webp'] : ['webp']
  const q = 92 // calidad visual máxima (WebP ≥ 90, alfa 100, effort 6)
  const lossless = e.key.includes('fuente_')
  entry.o = await writeVariants(e.key, 'o', orig, [orig.w], { q, lossless })

  // --- HD
  let hd = null, newArt = false
  if (override) {
    const om = await sharp(override).metadata()
    const k = om.width / meta0.width
    if (near(om.height / k, meta0.height) && om.width > meta0.width) {
      hd = await rgba(override, crop.map((v) => Math.round(v * k)))
    } else if (near(om.width / om.height, crop[2] / crop[3])) {
      hd = await rgba(override)
    } else if (scene) {
      hd = await rgba(override); newArt = true
    } else console.warn(`  ⚠ ${path.relative(root, override)}: proporción distinta y ${e.key} no es escénica → se ignora`)
    if (hd) console.log(`  ${e.key}: arte HD ${hd.w}x${hd.h}${newArt ? ' (composición nueva)' : ''}`)
  }
  if (!hd) {
    const cacheFile = path.join(CACHE, `${e.key}.${hash(fs.readFileSync(srcFile), JSON.stringify(e.crop ?? ''), e.mask ?? '', 'esrgan-medium')}.png`)
    if (fs.existsSync(cacheFile) && !noAi) hd = await rgba(cacheFile)
    else {
      const t0 = Date.now()
      hd = e.kind === 'tiles' ? await up2Tiles(orig) : await up2(orig)
      console.log(`  ${e.key}: x2 ${upscalerName} en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      if (upscaler) { mk(cacheFile); await toSharp(hd).png().toFile(cacheFile) }
    }
  }
  let widths
  if (scene) {
    widths = [960, 1600, 2560].filter((x) => x < hd.w * 0.97)
    if (!widths.length || hd.w < 2560) widths.push(hd.w)
    widths = [...new Set(widths)].filter((x) => x > orig.w || x === hd.w)
  } else widths = [hd.w]
  entry.h = await writeVariants(e.key, 'h', hd, widths, { formats: fmt, q, lossless })
  if (newArt) { entry.ai = [hd.w, hd.h]; entry.f = e.focal }
  if (scene) {
    // Mini desenfocada para extender el fondo cuando no conviene recortar (contain + fondo borroso)
    const small = 192
    const buf = await toSharp(hd).resize(small).blur(4).webp({ quality: 70 }).toBuffer()
    const file = path.join(IMG, `${e.key}.blur.webp`)
    mk(file); fs.writeFileSync(file, buf); made++
    entry.b = hash(buf)
    if (!newArt) entry.f = e.focal
  }
    return entry
}

async function images() {
  const prevAll = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).img ?? {} : {}
  const img = {}
  for (const e of CATALOG) {
    if (only && !only.includes(e.key)) { if (prevAll[e.key]) img[e.key] = prevAll[e.key]; continue }
    img[e.key] = await buildImage(e, prevAll[e.key])
  }
  // Borra variantes viejas que ya no están en el manifiesto
  const keep = new Set()
  for (const [k, v] of Object.entries(img)) {
    for (const [wpx] of v.o) keep.add(`${k}.o${wpx}.webp`)
    for (const [wpx] of v.h) { keep.add(`${k}.h${wpx}.webp`); keep.add(`${k}.h${wpx}.avif`) }
    if (v.b) keep.add(`${k}.blur.webp`)
  }
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]) : []
  for (const f of walk(IMG)) if (!keep.has(path.relative(IMG, f))) fs.rmSync(f)
  return img
}

// ---------------------------------------------------------------- íconos PWA (cuadro "parado" de Xa)
async function icons() {
  const dir = path.join(root, 'public/icons')
  fs.mkdirSync(dir, { recursive: true })
  const heroSrc = (await findOverride('images/hero/Xa_animaciones.png')) ?? path.join(A, 'images/hero/Xa_animaciones.png')
  const k = (await sharp(heroSrc).metadata()).width / 512
  const frame = await sharp(heroSrc).extract({ left: 0, top: 0, width: Math.round(70 * k), height: Math.round(66 * k) }).png().toBuffer()
  for (const [name, size, pad] of [['icon-192.png', 192, 0.14], ['icon-512.png', 512, 0.14], ['maskable-512.png', 512, 0.26], ['apple-touch-icon.png', 180, 0.12]]) {
    const inner = Math.round(size * (1 - pad * 2))
    const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#b6f04a"/><stop offset="0.55" stop-color="#3f9d1c"/><stop offset="1" stop-color="#123b0a"/></radialGradient></defs><rect width="100%" height="100%" ${name.startsWith('icon') ? `rx="${size * 0.22}"` : ''} fill="url(#g)"/></svg>`
    const fig = await sharp(frame).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toBuffer()
    await sharp(Buffer.from(bg)).composite([{ input: fig, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(path.join(dir, name))
  }
}

// ---------------------------------------------------------------- audio
function ffmpegAll(jobs) {
  return new Promise((resolve) => {
    let i = 0, running = 0, failed = 0
    const next = () => {
      if (i >= jobs.length && running === 0) return resolve(failed)
      while (running < Math.max(2, os.cpus().length - 1) && i < jobs.length) {
        const args = jobs[i++]
        running++
        const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'ignore' })
        p.on('close', (c) => { if (c) failed++; running--; made++; next() })
        p.on('error', () => { failed++; running--; next() })
      }
    }
    next()
  })
}
const fresh = (src, dst) => !force && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs

async function audio() {
  const jobs = []
  for (const [dir, opus, mp3] of [['music', '96k', '96k'], ['fx', '64k', '80k']]) {
    const src = path.join(A, `audio/${dir}/win`)
    for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.ogg'))) {
      const s = path.join(src, f), base = path.join(OUT, `audio/${dir}/${f.replace(/\.ogg$/, '')}`)
      mk(base)
      if (!fresh(s, base + '.webm')) jobs.push(['-i', s, '-vn', '-c:a', 'libopus', '-b:a', opus, '-vbr', 'on', base + '.webm'])
      if (!fresh(s, base + '.mp3')) jobs.push(['-i', s, '-vn', '-codec:a', 'libmp3lame', '-b:a', mp3, base + '.mp3'])
      if (fs.existsSync(base + '.ogg')) fs.rmSync(base + '.ogg') // el OGG Vorbis original ya no se sirve
    }
  }
  const failed = await ffmpegAll(jobs)
  if (failed) console.warn(`ffmpeg falló en ${failed} archivo(s) (¿está instalado?)`)
}

// Limpieza de la estructura vieja (public/assets/{bg,tiles,sprites,ui,screens})
for (const d of ['bg', 'tiles', 'sprites', 'ui', 'screens']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true })

await getUpscaler()
const img = await images()
if (!only) { await icons(); await audio() }
// Hash de cada audio (webm + mp3) para la URL ?v= (caché inmutable)
const audioHashes = {}
for (const dir of ['music', 'fx']) {
  const d = path.join(OUT, 'audio', dir)
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.webm'))) {
    const base = f.replace(/\.webm$/, '')
    const mp3 = path.join(d, base + '.mp3')
    audioHashes[`${dir}/${base}`] = hash(fs.readFileSync(path.join(d, f)), fs.existsSync(mp3) ? fs.readFileSync(mp3) : '')
  }
}
mk(MANIFEST)
fs.writeFileSync(MANIFEST, JSON.stringify({ upscaler: upscalerName, img, audio: audioHashes }))
console.log(`assets listos (${made} archivos generados; HD por ${upscalerName})`)
