// Texturas con varias resoluciones (manifiesto generado por scripts/build-assets.mjs).
// Cada imagen tiene un tamaño de "diseño" (lw x lh, el del original: las coordenadas de los atlas en el
// código están en esas unidades) y variantes en píxeles reales:
//   set "o": original 1x   ·   set "h": HD (ESRGAN x2, o arte nuevo con variantes por ancho en AVIF/WebP)
// Se elige la variante según la escala real de la pantalla (view.k) y la opción "Gráficos originales";
// las texturas se decodifican a ImageBitmap y se mejoran solas en segundo plano si cambia la escala.
import manifest from '../data/assets.json'
import { save } from './save'
import { view } from './stage'

export interface Entry {
  lw: number; lh: number
  o: [number, string][]
  h: [number, string][]
  /** Arte nuevo (composición distinta): tamaño en píxeles de la fuente */
  ai?: [number, number]
  /** Punto focal (0..1) para recortar con "cover" */
  f?: [number, number]
  /** Hash de la mini desenfocada (sólo escénicas) */
  b?: string
}
export interface Tex {
  src: CanvasImageSource
  /** Píxeles de la textura por unidad de diseño */
  s: number
  /** Tamaño en píxeles */
  pw: number; ph: number
  e: Entry
  /** true = arte nuevo (sólo se dibuja con drawScene) */
  ai: boolean
}

const M = manifest as unknown as { img: Record<string, Entry>; audio?: Record<string, string> }
export const entry = (key: string): Entry | undefined => M.img[key]
export const audioHash = (name: string) => M.audio?.[name] ?? ''

// ---------------------------------------------------------------- formatos
let avif = false
const avifProbe: Promise<void> = (async () => {
  try {
    const im = new Image()
    im.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A='
    await im.decode()
    avif = im.width > 0
  } catch { avif = false }
})()

// ---------------------------------------------------------------- elección de variante
type Pick = { set: 'o' | 'h'; w: number; hash: string; ext: 'webp' | 'avif' }

/** Ancho en píxeles que conviene para dibujar `key` a la escala actual. */
function wantedWidth(key: string, e: Entry) {
  if (e.ai || e.b) {
    // Escénica: se dibuja cubriendo la pantalla (o casi)
    const aspect = e.ai ? e.ai[0] / e.ai[1] : e.lw / e.lh
    const isBg = key.startsWith('bg/')
    const coverW = Math.max(view.w * (isBg ? 1.3 : 1), view.h * (isBg ? 1.15 : 1) * aspect)
    return coverW * view.k
  }
  return e.lw * view.k
}

function pick(key: string): Pick | null {
  const e = M.img[key]
  if (!e) return null
  const useOrig = save.options.originalArt
  if (useOrig || (!e.ai && !e.b && view.k < 1.25 && e.o.length)) {
    const [w, hash] = e.o[0]
    return { set: 'o', w, hash, ext: 'webp' }
  }
  const need = wantedWidth(key, e)
  const list = e.h.length ? e.h : e.o
  let best = list[list.length - 1]
  for (const v of list) if (v[0] >= need * 0.9) { best = v; break }
  const set = e.h.length ? 'h' : 'o'
  return { set, w: best[0], hash: best[1], ext: set === 'h' && e.b && avif ? 'avif' : 'webp' }
}

const url = (key: string, p: Pick) => `/assets/img/${key}.${p.set}${p.w}.${p.ext}?v=${p.hash}`

// ---------------------------------------------------------------- carga
const loaded = new Map<string, Tex>() // url → tex
const current = new Map<string, Tex>() // key → mejor tex cargada para la elección actual
const pending = new Map<string, Promise<Tex>>()

async function decode(u: string): Promise<{ src: CanvasImageSource; w: number; h: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(u)
      if (!res.ok) throw new Error(String(res.status))
      const bmp = await createImageBitmap(await res.blob())
      return { src: bmp, w: bmp.width, h: bmp.height }
    } catch { /* cae al <img> */ }
  }
  const im = new Image()
  im.decoding = 'async'
  im.src = u
  await im.decode()
  return { src: im, w: im.naturalWidth, h: im.naturalHeight }
}

function loadPick(key: string, p: Pick): Promise<Tex> {
  const u = url(key, p)
  const ready = loaded.get(u)
  if (ready) return Promise.resolve(ready)
  let pr = pending.get(u)
  if (!pr) {
    const e = M.img[key]
    pr = decode(u).then(({ src, w, h }) => {
      const t: Tex = { src, s: e.ai && p.set === 'h' ? w / e.ai[0] : w / e.lw, pw: w, ph: h, e, ai: !!e.ai && p.set === 'h' }
      loaded.set(u, t)
      pending.delete(u)
      return t
    }, (err) => { pending.delete(u); throw err })
    pending.set(u, pr)
  }
  return pr
}

const chosen = new Map<string, string>() // key → url elegida
let epochSeen = -1
let artSeen = save.options.originalArt

/** Carga (o mejora) una textura. */
export async function loadImage(key: string): Promise<Tex> {
  await avifProbe
  const p = pick(key)
  if (!p) throw new Error(`Imagen desconocida: ${key}`)
  const u = url(key, p)
  chosen.set(key, u)
  const t = await loadPick(key, p)
  if (chosen.get(key) === u) current.set(key, t)
  return t
}

/** Carga varias imágenes informando el progreso (0..1). */
export function loadAll(keys: string[], onProgress?: (k: number) => void): Promise<Tex[]> {
  let done = 0
  onProgress?.(keys.length ? 0 : 1)
  return Promise.all(keys.map((k) => loadImage(k).finally(() => { done++; onProgress?.(done / keys.length) })))
}

/** Textura lista para dibujar (o undefined). Si cambió la escala/opción, pide la variante nueva y mientras
 *  tanto devuelve la anterior. */
export function tex(key: string): Tex | undefined {
  if (epochSeen !== view.epoch || artSeen !== save.options.originalArt) {
    epochSeen = view.epoch
    artSeen = save.options.originalArt
    for (const k of current.keys()) { const p = pick(k); if (p && url(k, p) !== chosen.get(k)) void loadImage(k).catch(() => {}) }
  }
  return current.get(key)
}

/** Libera texturas que ya no se usan (al cambiar de nivel). */
export function release(keys: string[]) {
  for (const k of keys) {
    const t = current.get(k)
    current.delete(k)
    chosen.delete(k)
    for (const [u, x] of loaded) if (x === t || u.includes(`/img/${k}.`)) { (x.src as ImageBitmap).close?.(); loaded.delete(u) }
  }
}

/** Mini desenfocada de una escénica (para extender el fondo). */
const blurs = new Map<string, Tex | null>()
export function blurTex(key: string): Tex | undefined {
  const e = M.img[key]
  if (!e?.b) return undefined
  if (!blurs.has(key)) {
    blurs.set(key, null)
    void decode(`/assets/img/${key}.blur.webp?v=${e.b}`).then(({ src, w, h }) => blurs.set(key, { src, s: w / e.lw, pw: w, ph: h, e, ai: false })).catch(() => {})
  }
  return blurs.get(key) ?? undefined
}

/** URLs de todas las variantes que este dispositivo usaría (para el modo sin conexión). */
export function allUrls(): string[] {
  const out: string[] = []
  for (const key of Object.keys(M.img)) {
    const p = pick(key)
    if (p) out.push(url(key, p))
    const e = M.img[key]
    if (e.b) out.push(`/assets/img/${key}.blur.webp?v=${e.b}`)
  }
  return out
}

// ---------------------------------------------------------------- dibujo
/** drawImage con coordenadas de origen en unidades de diseño. */
export function blit(ctx: CanvasRenderingContext2D, t: Tex, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw = sw, dh = sh) {
  const s = t.s
  ctx.drawImage(t.src, sx * s, sy * s, sw * s, sh * s, dx, dy, dw, dh)
}

/** Dibuja una imagen de diseño por clave (si está cargada). */
export function draw(ctx: CanvasRenderingContext2D, key: string, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw = sw, dh = sh) {
  const t = tex(key)
  if (t) blit(ctx, t, sx, sy, sw, sh, dx, dy, dw, dh)
  return !!t
}

export interface SceneRect { x: number; y: number; w: number; h: number; /** escala diseño→pantalla (sólo arte original) */ s: number; ai: boolean }

/**
 * Dibuja una pantalla "escénica" ocupando el rectángulo (x, y, w, h) SIN barras negras:
 * "cover" con punto focal, recortando como mucho `maxCrop` del lado que sobra; si para cubrir hiciera falta
 * recortar más, el resto se rellena con la misma imagen desenfocada (fondo extendido).
 */
export function drawScene(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number, maxCrop = 0.18, focal?: [number, number]): SceneRect | null {
  const t = tex(key)
  const e = M.img[key]
  if (!e) return null
  const iw = t?.ai ? e.ai![0] : e.lw, ih = t?.ai ? e.ai![1] : e.lh
  const contain = Math.min(w / iw, h / ih), cover = Math.max(w / iw, h / ih)
  const s = Math.min(cover, contain / (1 - maxCrop))
  const dw = iw * s, dh = ih * s
  const [fx, fy] = focal ?? e.f ?? [0.5, 0.5]
  const ox = dw > w ? Math.min(0, Math.max(w - dw, w / 2 - fx * dw)) : (w - dw) / 2
  const oy = dh > h ? Math.min(0, Math.max(h - dh, h / 2 - fy * dh)) : (h - dh) / 2
  if (dw < w - 0.5 || dh < h - 0.5 || !t) {
    const b = blurTex(key)
    if (b) {
      const bs = Math.max(w / b.pw, h / b.ph)
      ctx.drawImage(b.src, x + (w - b.pw * bs) / 2, y + (h - b.ph * bs) / 2, b.pw * bs, b.ph * bs)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(x, y, w, h)
    } else { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h) }
  }
  if (!t) return null
  ctx.drawImage(t.src, 0, 0, t.ai ? t.pw : e.lw * t.s, t.ai ? t.ph : e.lh * t.s, x + ox, y + oy, dw, dh)
  if (dw < w - 0.5 || dh < h - 0.5) {
    // Bordes suaves entre la imagen y el fondo extendido
    const E = 14
    const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1)
      g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(rx, ry, rw, rh)
    }
    const L = x + ox, T = y + oy
    if (dw < w - 0.5) { edge(L, 0, L + E, 0, L, T, E, dh); edge(L + dw, 0, L + dw - E, 0, L + dw - E, T, E, dh) }
    else { edge(0, T, 0, T + E, L, T, dw, E); edge(0, T + dh, 0, T + dh - E, L, T + dh - E, dw, E) }
  }
  return { x: x + ox, y: y + oy, w: dw, h: dh, s, ai: !!t.ai }
}
