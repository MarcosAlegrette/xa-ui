// Capa de tiles pre-renderizada en bloques de 8x8 tiles (256x256 lógicos) en canvas fuera de pantalla,
// a la resolución de la textura (x2 en HD). Por cuadro se dibujan ~15 bloques en vez de ~300 tiles,
// y no aparecen costuras entre tiles al escalar. Caché LRU acotada (memoria estable en niveles largos).
import { blit, tex, type Tex } from '../core/assets'
import { view } from '../core/stage'
import { F, T, type TileMap } from './level'

const CH = 8 // tiles por lado de bloque
const PX = CH * T
const MAX_CHUNKS = 40

interface Chunk { cv: HTMLCanvasElement | OffscreenCanvas; used: number; empty: boolean }

export class TileLayer {
  private chunks = new Map<number, Chunk>()
  private texRef: Tex | null = null
  private frame = 0
  private pool: (HTMLCanvasElement | OffscreenCanvas)[] = []
  constructor(readonly map: TileMap, readonly tileset: string, readonly cols: number) {}

  private make(cx: number, cy: number, t: Tex): Chunk {
    const s = t.s
    const size = Math.round(PX * s)
    let cv = this.pool.pop()
    if (!cv) cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size })
    if (cv.width !== size) { cv.width = size; cv.height = size }
    const g = cv.getContext('2d') as CanvasRenderingContext2D
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, size, size)
    g.imageSmoothingEnabled = false // copia 1:1 de la textura
    g.setTransform(s, 0, 0, s, 0, 0)
    const map = this.map
    let empty = true
    for (let ty = cy * CH; ty < Math.min(map.h, cy * CH + CH); ty++) {
      for (let tx = cx * CH; tx < Math.min(map.w, cx * CH + CH); tx++) {
        const i = ty * map.w + tx
        const gid = map.tiles[i]
        if (!gid || map.flagsOf[i] & F.INVISIBLE) continue
        const id = gid - 1
        blit(g, t, (id % this.cols) * T, Math.floor(id / this.cols) * T, T, T, (tx - cx * CH) * T, (ty - cy * CH) * T, T, T)
        empty = false
      }
    }
    return { cv, used: this.frame, empty }
  }

  /** Dibuja los bloques visibles. (x0, y0) = esquina de la cámara; w, h = tamaño de la vista. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
    const t = tex(`tiles/${this.tileset}`)
    if (!t) return
    if (t !== this.texRef) { this.flush(); this.texRef = t }
    this.frame++
    const map = this.map
    const cx0 = Math.max(0, Math.floor(x0 / PX)), cx1 = Math.min(Math.ceil(map.w / CH) - 1, Math.floor((x0 + w) / PX))
    const cy0 = Math.max(0, Math.floor(y0 / PX)), cy1 = Math.min(Math.ceil(map.h / CH) - 1, Math.floor((y0 + h) / PX))
    let built = 0
    const ov = 1.2 / view.k // solapa ~1 píxel real entre bloques: sin costuras con escalas fraccionarias
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * 4096 + cx
        let c = this.chunks.get(key)
        if (!c) {
          if (built > 6) continue // repartir el trabajo entre cuadros si se entra de golpe a una zona nueva
          c = this.make(cx, cy, t)
          this.chunks.set(key, c)
          built++
        }
        c.used = this.frame
        if (!c.empty) ctx.drawImage(c.cv as CanvasImageSource, 0, 0, c.cv.width, c.cv.height, cx * PX, cy * PX, PX + ov, PX + ov)
      }
    }
    if (this.chunks.size > MAX_CHUNKS) this.evict()
  }

  /** Pre-genera los bloques alrededor de un punto (al aparecer / reaparecer). */
  warm(x: number, y: number, w: number, h: number) {
    const t = tex(`tiles/${this.tileset}`)
    if (!t) return
    if (t !== this.texRef) { this.flush(); this.texRef = t }
    const map = this.map
    for (let cy = Math.max(0, Math.floor((y - PX) / PX)); cy <= Math.min(Math.ceil(map.h / CH) - 1, Math.floor((y + h + PX) / PX)); cy++)
      for (let cx = Math.max(0, Math.floor((x - PX) / PX)); cx <= Math.min(Math.ceil(map.w / CH) - 1, Math.floor((x + w + PX) / PX)); cx++) {
        const key = cy * 4096 + cx
        if (!this.chunks.has(key)) this.chunks.set(key, this.make(cx, cy, t))
      }
  }

  private evict() {
    const arr = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used)
    for (let i = 0; i < arr.length - MAX_CHUNKS * 0.75; i++) {
      this.chunks.delete(arr[i][0])
      if (this.pool.length < 8) this.pool.push(arr[i][1].cv)
    }
  }
  flush() { for (const c of this.chunks.values()) if (this.pool.length < 8) this.pool.push(c.cv); this.chunks.clear() }
  dispose() { this.chunks.clear(); this.pool.length = 0 }
}
