// "Gira tu celular": en teléfonos en vertical se pausa todo y se pide girar a horizontal.
// Usa el arte del juego: el fondo del menú, Xa corriendo, una vaca y un teléfono que gira.
import type { Screen } from '../core/app'
import { blurTex, tex } from '../core/assets'
import { drawText } from '../core/font'
import { view } from '../core/stage'
import { roundRect } from '../game/world'
import { enterFullscreen, fullscreenSupported } from '../core/platform'
import { COW, HERO, drawAnim } from '../game/sprites'

/** Botón HTML "Jugar en pantalla completa" (Android: pantalla completa + bloqueo horizontal). */
export function initRotateButton(root: HTMLElement) {
  if (!fullscreenSupported()) return
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'rotate-full'
  b.textContent = 'Jugar en pantalla completa'
  b.addEventListener('click', () => void enterFullscreen())
  root.appendChild(b)
}

/** Recorte del logo "Xa contra los Cuatreros Galácticos" del arte del menú, con bordes difuminados. */
let logoCv: HTMLCanvasElement | null = null
let logoSrc: unknown = null
function logo() {
  const t = tex('screens/menu')
  if (!t) return null
  if (logoSrc === t.src && logoCv) return logoCv
  // Región del logo: en el arte HD (16:9) arriba a la izquierda; en el original, 0..300 x 0..135
  const [x, y, w, h] = t.ai ? [0.12 * t.pw, 0, 0.47 * t.pw, 0.4 * t.ph] : [0, 0, 300 * t.s, 135 * t.s]
  const cv = document.createElement('canvas')
  cv.width = Math.round(w); cv.height = Math.round(h)
  const g = cv.getContext('2d')!
  g.drawImage(t.src, x, y, w, h, 0, 0, cv.width, cv.height)
  g.globalCompositeOperation = 'destination-in'
  const rg = g.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.3, cv.width / 2, cv.height / 2, cv.width * 0.55)
  rg.addColorStop(0, '#000'); rg.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, cv.width, cv.height)
  logoCv = cv; logoSrc = t.src
  return cv
}

export class RotateScreen implements Screen {
  t = 0
  update(dt: number) { this.t += dt }
  render(ctx: CanvasRenderingContext2D) {
    const W = view.w, H = view.h
    const b = blurTex('screens/menu') ?? tex('screens/menu')
    if (b) {
      const bw = b.pw, bh = b.ph, s = Math.max(W / bw, H / bh)
      ctx.drawImage(b.src, (W - bw * s) / 2, (H - bh * s) / 2, bw * s, bh * s)
    }
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, 'rgba(10,30,5,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0.8)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    const lg = logo()
    if (lg) { const lw = Math.min(W * 0.92, 360), lh = (lw * lg.height) / lg.width; ctx.drawImage(lg, (W - lw) / 2, H * 0.03, lw, lh) }
    const cx = W / 2, cy = H * 0.42
    const u = Math.max(1, Math.min(W, H) / 300) // escala de la composición
    // Teléfono que gira de vertical a horizontal (y vuelve)
    const c = (this.t % 2.6) / 2.6
    const k = c < 0.2 ? 0 : c < 0.55 ? (c - 0.2) / 0.35 : c < 0.85 ? 1 : 1 - (c - 0.85) / 0.15
    const ang = -(Math.PI / 2) * (k * k * (3 - 2 * k))
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(u, u)
    ctx.rotate(ang)
    const pw = 70, ph = 130
    ctx.fillStyle = '#111'; roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 12); ctx.fill()
    ctx.strokeStyle = '#9fdc3c'; ctx.lineWidth = 3; roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 12); ctx.stroke()
    ctx.fillStyle = '#2f6e14'; roundRect(ctx, -pw / 2 + 6, -ph / 2 + 12, pw - 12, ph - 24, 4); ctx.fill()
    // Xa adentro de la pantalla del teléfono
    ctx.rotate(-ang)
    drawAnim(ctx, HERO.run, this.t, 0, 22, false)
    ctx.restore()
    // Flecha curva
    ctx.save()
    ctx.translate(cx, cy); ctx.scale(u, u); ctx.translate(-cx, -cy)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(cx, cy, 98, -Math.PI * 0.95, -Math.PI * 0.6); ctx.stroke()
    const ax = cx + Math.cos(-Math.PI * 0.6) * 98, ay = cy + Math.sin(-Math.PI * 0.6) * 98
    ctx.beginPath(); ctx.moveTo(ax - 10, ay - 6); ctx.lineTo(ax + 2, ay); ctx.lineTo(ax - 4, ay + 12); ctx.stroke()
    ctx.restore()
    // Vaca
    if (tex('sprites/cow1')) { ctx.save(); ctx.translate(W * 0.74, H * 0.95); ctx.scale(u, u); drawAnim(ctx, COW.happy, this.t, 0, 0, true); ctx.restore() }
    drawText(ctx, '¡Gira tu celular!', cx, cy + 120 * u, { align: 'center', scale: 1.05 * u, font: 'fuente_blanca', maxWidth: W * 0.9 })
    drawText(ctx, 'Xa se juega en horizontal', cx, cy + 120 * u + 34 * u, { align: 'center', scale: 0.62 * u, font: 'fuente_blanca', alpha: 0.85, maxWidth: W * 0.9 })
  }
}
