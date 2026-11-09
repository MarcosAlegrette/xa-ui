// Piezas de interfaz: botones originales (buttons_tile.png), panel 512x384 centrado, fondos a pantalla
// completa y controles modernos (deslizadores, interruptores) dibujados con la paleta del juego.
import { audio } from '../core/audio'
import { blurTex, draw as drawImg, drawScene, tex } from '../core/assets'
import { drawText } from '../core/font'
import { input, pointer } from '../core/input'
import { H, W, view } from '../core/stage'
import { roundRect } from '../game/world'

type R = [number, number, number, number]
export const BTN: Record<string, { n: R; h: R }> = {
  si: { n: [14, 6, 31, 37], h: [68, 0, 42, 49] },
  no: { n: [128, 8, 43, 35], h: [182, 2, 55, 47] },
  jugar: { n: [16, 59, 73, 29], h: [114, 52, 90, 43] },
  salir: { n: [239, 63, 52, 25], h: [337, 55, 68, 38] },
  opciones: { n: [14, 112, 78, 24], h: [112, 106, 94, 36] },
  ayuda: { n: [238, 113, 54, 22], h: [337, 107, 68, 35] },
  creditos: { n: [13, 161, 80, 27], h: [111, 154, 97, 40] },
  continuar: { n: [222, 163, 85, 23], h: [319, 157, 104, 35] },
  atras: { n: [16, 208, 74, 33], h: [113, 201, 92, 47] },
}

export interface Button { id: string; x: number; y: number; onClick: () => void }

/** Ejecuta `fn` con el origen en el panel 512x384 centrado. */
export function panel(ctx: CanvasRenderingContext2D, fn: () => void) {
  ctx.save()
  ctx.translate(view.px, view.py)
  fn()
  ctx.restore()
}

/** Esquinas visibles de la pantalla en coordenadas del panel. */
export const edges = () => ({ l: -view.px + view.safe.l, r: W + view.px - view.safe.r, t: -view.py + view.safe.t, b: H + view.py - view.safe.b })

/** Grupo de botones navegable con flechas + Z/Enter, mouse y toque (coordenadas del panel). */
export class Menu {
  focus = 0
  t = 0
  private anim: number[] = []
  constructor(public buttons: Button[], readonly vertical = true, readonly keyboard = true) { if (!keyboard) this.focus = -1 }
  private rect(b: Button) {
    const r = BTN[b.id].h
    return { x: b.x - r[2] / 2 - 6, y: b.y - r[3] / 2 - 2, w: r[2] + 12, h: r[3] + 4 }
  }
  private inside(b: Button, x: number, y: number) {
    const r = this.rect(b)
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  }
  update(dt = 1 / 120) {
    this.t += dt
    const n = this.buttons.length
    for (let i = 0; i < n; i++) this.anim[i] = Math.max(0, Math.min(1, (this.anim[i] ?? 0) + (i === this.focus ? dt * 8 : -dt * 8)))
    if (!this.keyboard) {
      this.focus = pointer.active ? this.buttons.findIndex((b) => this.inside(b, pointer.x, pointer.y)) : -1
      for (const c of input.clicks()) {
        const i = this.buttons.findIndex((b) => this.inside(b, c.x, c.y))
        if (i >= 0) { audio.fx('click'); this.buttons[i].onClick(); return true }
      }
      return false
    }
    const prev = this.vertical ? 'up' : 'left', nxt = this.vertical ? 'down' : 'right'
    if (input.pressed(prev)) { this.focus = (this.focus + n - 1) % n; audio.fx('click', 0.5) }
    if (input.pressed(nxt)) { this.focus = (this.focus + 1) % n; audio.fx('click', 0.5) }
    if (pointer.active) this.buttons.forEach((b, i) => { if (this.inside(b, pointer.x, pointer.y)) this.focus = i })
    for (const c of input.clicks()) {
      const i = this.buttons.findIndex((b) => this.inside(b, c.x, c.y))
      if (i >= 0) { this.focus = i; audio.fx('click'); this.buttons[i].onClick(); return true }
    }
    if (input.pressed('confirm') && this.focus >= 0) { audio.fx('click'); this.buttons[this.focus]?.onClick(); return true }
    return false
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (!tex('ui/buttons')) return
    const order = this.buttons.map((_, i) => i).sort((a, b) => (a === this.focus ? 1 : 0) - (b === this.focus ? 1 : 0))
    for (const i of order) {
      const b = this.buttons[i]
      const k = this.anim[i] ?? 0
      const r = k > 0.5 ? BTN[b.id].h : BTN[b.id].n
      // Botón resaltado con un leve "latido"
      const s = k > 0.5 ? 1 + 0.03 * Math.sin(this.t * 6) : 1
      drawImg(ctx, 'ui/buttons', r[0], r[1], r[2], r[3], b.x - (r[2] * s) / 2, b.y - (r[3] * s) / 2, r[2] * s, r[3] * s)
    }
  }
}

/** Cursor original (cursor.png) en los menús, sólo con mouse. Coordenadas del panel. */
export function drawCursor(ctx: CanvasRenderingContext2D) {
  if (!pointer.active || !pointer.mouse) return
  panel(ctx, () => drawImg(ctx, 'ui/cursor', 0, 0, 32, 32, pointer.x, pointer.y))
}

/** Pantalla escénica a sangre completa (cover con punto focal; fondo desenfocado si recortaría demasiado). */
export function scene(ctx: CanvasRenderingContext2D, key: string, maxCrop = 0.15) {
  return drawScene(ctx, key, 0, 0, view.w, view.h, maxCrop)
}

/**
 * Imagen de 512x384 que tiene que verse entera (atlas de interfaz): se dibuja centrada en el panel y el resto
 * de la pantalla se rellena con la misma imagen agrandada, desenfocada y oscurecida.
 */
export function panelImage(ctx: CanvasRenderingContext2D, key: string, backdrop?: string) {
  const t = tex(key)
  const bk = backdrop ? blurTex(backdrop) ?? tex(backdrop) : undefined
  if (view.px > 0.5 || view.py > 0.5) {
    if (bk) {
      const bw = bk.ai ? bk.pw : bk.e.lw * bk.s, bh = bk.ai ? bk.ph : bk.e.lh * bk.s
      const s = Math.max(view.w / bw, view.h / bh) * 1.04
      ctx.drawImage(bk.src, 0, 0, bw, bh, (view.w - bw * s) / 2, (view.h - bh * s) / 2, bw * s, bh * s)
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
    } else if (t) {
      const s = Math.max(view.w / W, view.h / H) * 1.08
      ctx.globalAlpha = 0.5
      drawImg(ctx, key, 0, 0, W, H, (view.w - W * s) / 2, (view.h - H * s) / 2, W * s, H * s)
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
    } else ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, view.w, view.h)
  }
  if (t) panel(ctx, () => drawImg(ctx, key, 0, 0, W, H, 0, 0, W, H))
}

/** Oscurece toda la pantalla (diálogos). */
export function dim(ctx: CanvasRenderingContext2D, a = 0.6) {
  ctx.fillStyle = `rgba(0,0,0,${a})`
  ctx.fillRect(0, 0, view.w, view.h)
}

// ---------------------------------------------------------------- widgets modernos (panel)
export const GREEN = { dark: '#163d0b', mid: '#3f8f1c', light: '#9fdc3c', glow: '#d8ff8a' }

/** Caja redondeada con el verde del juego. */
export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 14) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#5fb52a'); g.addColorStop(0.5, '#3d8a19'); g.addColorStop(1, '#245c0e')
  ctx.fillStyle = g
  roundRect(ctx, x, y, w, h, r); ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1); ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5
  roundRect(ctx, x + 5, y + 5, w - 10, h - 10, r - 4); ctx.stroke()
}

export function slider(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, v: number, focus: boolean) {
  const h = 8
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  roundRect(ctx, x, y - h / 2, w, h, 4); ctx.fill()
  ctx.fillStyle = GREEN.light
  roundRect(ctx, x, y - h / 2, Math.max(h, w * v), h, 4); ctx.fill()
  ctx.beginPath(); ctx.arc(x + w * v, y, focus ? 9 : 7.5, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.lineWidth = 2; ctx.strokeStyle = GREEN.dark; ctx.stroke()
}

export function toggle(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean, focus: boolean, disabled = false) {
  const w = 40, h = 20
  ctx.globalAlpha = disabled ? 0.4 : 1
  ctx.fillStyle = on ? GREEN.light : 'rgba(0,0,0,0.45)'
  roundRect(ctx, x, y - h / 2, w, h, h / 2); ctx.fill()
  if (focus) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; roundRect(ctx, x - 2, y - h / 2 - 2, w + 4, h + 4, h / 2 + 2); ctx.stroke() }
  ctx.beginPath(); ctx.arc(on ? x + w - h / 2 : x + h / 2, y, h / 2 - 3, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.globalAlpha = 1
}

export function choice(ctx: CanvasRenderingContext2D, x: number, y: number, opts: string[], sel: number, focus: boolean) {
  const w = 50, h = 20
  opts.forEach((o, i) => {
    const bx = x + i * (w + 4)
    ctx.fillStyle = i === sel ? GREEN.light : 'rgba(0,0,0,0.4)'
    roundRect(ctx, bx, y - h / 2, w, h, 6); ctx.fill()
    if (focus && i === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; roundRect(ctx, bx - 1, y - h / 2 - 1, w + 2, h + 2, 7); ctx.stroke() }
    drawText(ctx, o, bx + w / 2, y - 8, { align: 'center', scale: 0.5, font: i === sel ? 'fuente_negra' : 'fuente_blanca' })
  })
}

/** Estrella dibujada (para puntajes por nivel). */
export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, on: boolean, k = 1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(k, k)
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fillStyle = on ? '#ffd83a' : 'rgba(0,0,0,0.35)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = on ? '#8a5a00' : 'rgba(255,255,255,0.5)'
  ctx.stroke()
  ctx.restore()
}
