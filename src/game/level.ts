// Datos de un nivel (generados desde levelN.tmx) y consultas de colisión contra la grilla de tiles.
export interface LevelObject { type: string; name: string; x: number; y: number; w: number; h: number; p: Record<string, string | number | boolean | undefined> & { text?: string } }
export interface LevelData {
  n: number; width: number; height: number; tile: number
  background: string; music: string; tileset: string; tilesetCols: number
  flags: number[]; tiles: string; objects: LevelObject[]
}

export const T = 32
export const F = { HARD: 1, PLATFORM: 2, LADDER: 4, LADDER_END: 8, KILLING: 16, INVISIBLE: 32 } as const

// Cada nivel es un chunk aparte (se descarga sólo al jugarlo).
const loaders = import.meta.glob<LevelData>('../data/levels/level*.json', { import: 'default' })
export async function loadLevelData(n: number): Promise<LevelData> {
  const fn = loaders[`../data/levels/level${n}.json`]
  if (!fn) throw new Error(`Nivel ${n} inexistente`)
  return fn()
}

export class TileMap {
  readonly w: number
  readonly h: number
  readonly tiles: Uint16Array
  readonly flagsOf: Uint8Array
  /** Tiles abiertos por puertas u otros objetos sólidos dinámicos (índice → sólido) */
  readonly solidOverride = new Map<number, boolean>()

  constructor(readonly data: LevelData) {
    this.w = data.width
    this.h = data.height
    const bin = atob(data.tiles)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    this.tiles = new Uint16Array(bytes.buffer)
    this.flagsOf = new Uint8Array(this.tiles.length)
    for (let i = 0; i < this.tiles.length; i++) {
      const g = this.tiles[i]
      this.flagsOf[i] = g ? (data.flags[g - 1] ?? 0) : 0
    }
  }

  get pxW() { return this.w * T }
  get pxH() { return this.h * T }

  flags(tx: number, ty: number): number {
    if (tx < 0 || tx >= this.w) return F.HARD // bordes laterales del mapa: pared
    if (ty < 0 || ty >= this.h) return 0
    return this.flagsOf[ty * this.w + tx]
  }
  solid(tx: number, ty: number) {
    if (this.solidOverride.size) {
      const o = this.solidOverride.get(ty * this.w + tx)
      if (o !== undefined) return o
    }
    return (this.flags(tx, ty) & F.HARD) !== 0
  }
  /** Plataforma de un solo sentido (se atraviesa desde abajo). Los extremos de escalera también lo son. */
  oneWay(tx: number, ty: number) { return (this.flags(tx, ty) & (F.PLATFORM | F.LADDER_END)) !== 0 }
  ladder(tx: number, ty: number) { return (this.flags(tx, ty) & (F.LADDER | F.LADDER_END)) !== 0 }

  /** ¿Algún tile sólido dentro del rectángulo? */
  rectSolid(x: number, y: number, w: number, h: number) {
    const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 0.001) / T)
    const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 0.001) / T)
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solid(tx, ty)) return true
    return false
  }
  rectFlag(x: number, y: number, w: number, h: number, flag: number) {
    const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 0.001) / T)
    const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 0.001) / T)
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.flags(tx, ty) & flag) return true
    return false
  }
}

/** Cuerpo que se mueve contra el mapa (pies en (x, y) — abajo al centro). */
export interface Body { x: number; y: number; vx: number; vy: number; bw: number; bh: number; onGround: boolean }

export interface Hit { left: boolean; right: boolean; up: boolean; down: boolean }
const HIT: Hit = { left: false, right: false, up: false, down: false }

/**
 * Mueve un cuerpo con colisión por ejes contra tiles sólidos y plataformas de un solo sentido.
 * Se subdivide en pasos de como mucho 6 px (nunca atraviesa tiles aunque vaya muy rápido).
 * `corner` (px) = corrección de esquinas: si la cabeza roza el borde de un techo, se desliza al costado.
 * Devuelve qué lados chocaron (objeto reutilizado: no guardarlo).
 */
export function moveBody(map: TileMap, b: Body, dt: number, opts: { oneWay?: boolean; dropThrough?: boolean; corner?: number } = {}): Hit {
  HIT.left = HIT.right = HIT.up = HIT.down = false
  const dist = Math.max(Math.abs(b.vx), Math.abs(b.vy)) * dt
  const n = Math.max(1, Math.ceil(dist / 6))
  const h = dt / n
  for (let i = 0; i < n; i++) step(map, b, h, opts)
  return HIT
}

function step(map: TileMap, b: Body, dt: number, opts: { oneWay?: boolean; dropThrough?: boolean; corner?: number }) {
  // Horizontal
  let nx = b.x + b.vx * dt
  const top = b.y - b.bh, hh = b.bh
  if (b.vx > 0) {
    const edge = nx + b.bw / 2
    if (map.rectSolid(edge - 0.01, top + 1, 0.02, hh - 2)) { nx = Math.floor(edge / T) * T - b.bw / 2 - 0.01; HIT.right = true }
  } else if (b.vx < 0) {
    const edge = nx - b.bw / 2
    if (map.rectSolid(edge - 0.01, top + 1, 0.02, hh - 2)) { nx = (Math.floor(edge / T) + 1) * T + b.bw / 2 + 0.01; HIT.left = true }
  }
  b.x = nx
  if (HIT.left || HIT.right) b.vx = 0
  // Vertical
  const ny = b.y + b.vy * dt
  const x0 = b.x - b.bw / 2 + 1, w = b.bw - 2
  b.onGround = false
  if (b.vy >= 0) {
    const ty0 = Math.floor((b.y - 0.01) / T), ty1 = Math.floor(ny / T)
    let landed = false
    for (let ty = Math.max(ty0, 0); ty <= ty1 && !landed; ty++) {
      const surf = ty * T
      if (surf < b.y - 0.5 || surf > ny + 0.001) continue
      const tx0 = Math.floor(x0 / T), tx1 = Math.floor((x0 + w) / T)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (map.solid(tx, ty) || (opts.oneWay !== false && !opts.dropThrough && map.oneWay(tx, ty) && !map.solid(tx, ty - 1))) {
          b.y = surf
          b.vy = 0
          b.onGround = true
          HIT.down = true
          landed = true
          break
        }
      }
    }
    if (!landed) b.y = ny
  } else {
    const headNew = ny - b.bh
    if (map.rectSolid(x0, headNew, w, 0.02)) {
      // Corrección de esquinas: probar desplazarse unos píxeles hacia el lado libre
      const c = opts.corner ?? 0
      if (c > 0) {
        for (let d = 1; d <= c; d++) {
          if (!map.rectSolid(x0 + d, headNew, w, 0.02) && !map.rectSolid(x0 + d, headNew, w, b.bh - 2)) { b.x += d; b.y = ny; return }
          if (!map.rectSolid(x0 - d, headNew, w, 0.02) && !map.rectSolid(x0 - d, headNew, w, b.bh - 2)) { b.x -= d; b.y = ny; return }
        }
      }
      b.y = (Math.floor(headNew / T) + 1) * T + b.bh + 0.01
      b.vy = 0
      HIT.up = true
    } else b.y = ny
  }
}

/** ¿Hay piso justo debajo del punto (x, y)? */
export function groundAt(map: TileMap, x: number, y: number) {
  const tx = Math.floor(x / T), ty = Math.floor((y + 1) / T)
  return map.solid(tx, ty) || map.oneWay(tx, ty)
}
