// Partículas con pool fijo (sin asignaciones por cuadro): polvo, chispas, anillos, destellos de monedas.
// Se dibujan con un sprite de "punto suave" pre-renderizado y teñido por color.
export const P = { Dust: 0, Spark: 1, Ring: 2, Star: 3 } as const

const MAX = 384
const kind = new Uint8Array(MAX)
const x = new Float32Array(MAX), y = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX)
const life = new Float32Array(MAX), max = new Float32Array(MAX), size = new Float32Array(MAX), grav = new Float32Array(MAX)
const color = new Uint32Array(MAX)
let n = 0

// Sprites de punto suave por color (cacheados)
const dots = new Map<number, HTMLCanvasElement>()
function dot(c: number) {
  let cv = dots.get(c)
  if (!cv) {
    cv = document.createElement('canvas')
    cv.width = cv.height = 32
    const g = cv.getContext('2d')!
    const r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grd.addColorStop(0, `rgba(${r},${gg},${b},1)`)
    grd.addColorStop(0.45, `rgba(${r},${gg},${b},0.75)`)
    grd.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    g.fillStyle = grd
    g.fillRect(0, 0, 32, 32)
    dots.set(c, cv)
  }
  return cv
}

export const particles = {
  get count() { return n },
  clear() { n = 0 },
  add(k: number, px: number, py: number, pvx: number, pvy: number, l: number, s: number, c: number, g = 0) {
    if (n >= MAX) return
    const i = n++
    kind[i] = k; x[i] = px; y[i] = py; vx[i] = pvx; vy[i] = pvy; life[i] = l; max[i] = l; size[i] = s; color[i] = c; grav[i] = g
  },
  update(dt: number) {
    for (let i = 0; i < n; i++) {
      life[i] -= dt
      if (life[i] <= 0) {
        // quitar por intercambio con el último
        const j = --n
        kind[i] = kind[j]; x[i] = x[j]; y[i] = y[j]; vx[i] = vx[j]; vy[i] = vy[j]; life[i] = life[j]; max[i] = max[j]; size[i] = size[j]; color[i] = color[j]; grav[i] = grav[j]
        i--
        continue
      }
      vy[i] += grav[i] * dt
      if (kind[i] === P.Dust) { vx[i] *= 1 - 3 * dt; vy[i] *= 1 - 2 * dt }
      x[i] += vx[i] * dt
      y[i] += vy[i] * dt
    }
  },
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const op = ctx.globalCompositeOperation
    for (let i = 0; i < n; i++) {
      if (x[i] < x0 || x[i] > x1 || y[i] < y0 || y[i] > y1) continue
      const t = life[i] / max[i]
      const k = kind[i]
      if (k === P.Ring) {
        const r = size[i] * (1 - t) + 4
        ctx.globalAlpha = t * 0.9
        ctx.strokeStyle = `#${color[i].toString(16).padStart(6, '0')}`
        ctx.lineWidth = 3 * t + 0.5
        ctx.beginPath(); ctx.arc(x[i], y[i], r, 0, Math.PI * 2); ctx.stroke()
        continue
      }
      const s = k === P.Dust ? size[i] * (1.6 - t * 0.6) : size[i] * (0.4 + t * 0.6)
      ctx.globalAlpha = k === P.Dust ? t * 0.55 : Math.min(1, t * 1.4)
      ctx.globalCompositeOperation = k === P.Dust ? 'source-over' : 'lighter'
      ctx.drawImage(dot(color[i]), x[i] - s, y[i] - s, s * 2, s * 2)
      if (k === P.Star) { ctx.fillStyle = '#fff'; ctx.fillRect(x[i] - 0.75, y[i] - s * 0.9, 1.5, s * 1.8); ctx.fillRect(x[i] - s * 0.9, y[i] - 0.75, s * 1.8, 1.5) }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = op
  },
}
