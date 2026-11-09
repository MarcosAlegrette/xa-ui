// Escenario a pantalla completa, sin barras negras.
// Unidad lógica = 1 píxel del original (512x384, tiles de 32). La escala es la misma para todo:
//   css = min(anchoCSS / 512, altoCSS / 384)
// así el área visible ("view") siempre mide al menos 512x384 lógicos y se EXTIENDE en el eje que sobra
// (16:9 → 683x384, 19.5:9 → 832x384, 4:3 vertical → 512x683): el juego ve más mundo en vez de poner bandas.
// Las pantallas de menú dibujan su arte a sangre completa y su interfaz en un "panel" de 512x384 centrado.
// El canvas se dibuja a devicePixelRatio (tope 2 en móviles) con un presupuesto de píxeles según la calidad.
import { input } from './input'
import { save } from './save'

/** Panel lógico de los menús (resolución del original). */
export const W = 512
export const H = 384

export const view = {
  /** Tamaño visible en unidades lógicas */
  w: W, h: H,
  /** Píxeles CSS por unidad lógica */
  css: 1,
  /** Píxeles del canvas por unidad lógica (css * dpr efectivo) */
  k: 1,
  dpr: 1,
  /** Origen del panel 512x384 centrado */
  px: 0, py: 0,
  /** Márgenes seguros (muesca) en unidades lógicas */
  safe: { l: 0, r: 0, t: 0, b: 0 },
  touch: false,
  /** Teléfono (no tablet): sólo se juega en horizontal */
  phone: false,
  portrait: false,
  /** Teléfono en vertical: se muestra "Gira tu celular" y se pausa todo */
  get blocked() { return this.phone && this.portrait },
  /** Cambia cada vez que se recalcula el tamaño (para cachés dependientes de la escala) */
  epoch: 0,
}

export interface StageInfo { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; root: HTMLElement }

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0

let stage: StageInfo
let doLayout = () => {}
export const relayout = () => doLayout()

/** Presupuesto de píxeles del canvas según la calidad elegida. */
const PIXELS = { alta: 4.2e6, media: 2.4e6, baja: 1.2e6 } as const

export function createStage(root: HTMLElement): StageInfo {
  root.innerHTML = `<canvas id="game" aria-label="Xa contra los Cuatreros Galácticos"></canvas><div id="probe"></div>`
  const canvas = root.querySelector('canvas')!
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings)!
  const probe = root.querySelector<HTMLDivElement>('#probe')!
  stage = { canvas, ctx, root }

  doLayout = () => {
    const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight)
    view.touch = isTouchDevice()
    view.phone = view.touch && Math.min(screen.width, screen.height) < 600
    view.portrait = ch > cw
    document.body.classList.toggle('touch', view.touch)
    document.body.classList.toggle('blocked', view.blocked)
    const css = Math.min(cw / W, ch / H)
    view.css = css
    view.w = cw / css
    view.h = ch / css
    view.px = (view.w - W) / 2
    view.py = (view.h - H) / 2
    const q = save.options.quality
    const cap = q === 'baja' ? 1 : view.phone ? 2 : 2.5
    let dpr = Math.min(window.devicePixelRatio || 1, cap)
    const budget = PIXELS[q] ?? PIXELS.alta
    if (cw * ch * dpr * dpr > budget) dpr = Math.max(q === 'baja' ? 0.75 : 1, Math.sqrt(budget / (cw * ch)))
    view.dpr = dpr
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr)
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
    view.k = pw / view.w
    const cs = getComputedStyle(probe)
    const px = (v: string) => (parseFloat(v) || 0) / css
    view.safe = { l: px(cs.paddingLeft), r: px(cs.paddingRight), t: px(cs.paddingTop), b: px(cs.paddingBottom) }
    view.epoch++
  }
  doLayout()
  input.setMapper((cx, cy) => ({ x: cx / view.css - view.px, y: cy / view.css - view.py }))
  window.addEventListener('resize', doLayout)
  window.addEventListener('orientationchange', () => setTimeout(doLayout, 120))
  screen.orientation?.addEventListener?.('change', () => setTimeout(doLayout, 120))
  return stage
}
