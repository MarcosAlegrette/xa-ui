// "Seleccionar nivel" y presentación de cada nivel (con barra de carga).
// Con el mapa original (map.png) los niveles van sobre los platillos rojos del dibujo; con arte nuevo
// (otra composición) se dibuja un camino propio de 16 paradas por encima, sin depender de píxeles del arte.
import meta from '../data/meta.json'
import { app, type Screen } from '../core/app'
import { audio } from '../core/audio'
import { draw as drawImg, loadAll, release, tex } from '../core/assets'
import { drawText } from '../core/font'
import { input, pointer } from '../core/input'
import { save } from '../core/save'
import { view } from '../core/stage'
import { roundRect } from '../game/world'
import { loadLevelData, type LevelData } from '../game/level'
import { GAME_SHEETS } from '../game/sprites'
import { levelImages } from '../game/world'
import { Menu, drawCursor, edges, panel, panelImage, scene, star } from './ui'
import { MenuScreen, progressBar } from './menus'

/** Posición de cada nivel en el mapa original (centro de los platillos rojos de map.png). */
export const LEVEL_POS: [number, number][] = [
  [260, 266], [435, 305], [287, 231], [411, 194], [330, 172], [415, 113], [364, 108], [428, 42],
  [276, 54], [224, 95], [150, 236], [77, 243], [35, 94], [83, 83], [139, 49], [92, 11],
]
const M = 384 // las piezas sueltas están debajo del mapa en la misma textura
const SPR = {
  locked: [64, M + 2, 33, 25], open: [104, M + 2, 33, 25], done: [144, M + 2, 33, 25], hover: [184, M + 2, 33, 25],
  arrow: [230, M, 21, 30], star: [263, M + 2, 35, 27],
  sel: [[9, M + 82, 42, 22], [64, M + 81, 52, 28], [124, M + 81, 52, 28]],
}
let lastLevelImages: string[] = []
/** Lugares equivalentes en el mapa nuevo (map.png HD 16:9, sin marcadores): fracción del ancho/alto de la imagen. */
const LEVEL_POS_HD: [number, number][] = [
  [0.47, 0.72], [0.76, 0.84], [0.55, 0.60], [0.79, 0.56], [0.60, 0.43], [0.81, 0.33], [0.67, 0.30], [0.76, 0.18],
  [0.53, 0.17], [0.42, 0.30], [0.31, 0.56], [0.16, 0.73], [0.11, 0.27], [0.19, 0.20], [0.25, 0.11], [0.17, 0.08],
]

export class MapScreen implements Screen {
  sel: number
  t = 0
  back = new Menu([{ id: 'atras', x: 62, y: 304, onClick: () => app.go(new MenuScreen(), 'slide') }], true, false)
  pos: [number, number][] = [] // posiciones en coordenadas del panel (se recalculan al dibujar)
  constructor() { this.sel = Math.min(16, save.unlocked) - 1 }
  enter() {
    audio.music('xa_menu')
    void loadAll(['screens/map', 'ui/map', 'ui/info_map', 'ui/items', 'ui/buttons', 'ui/cursor']).catch(() => {})
  }
  private start(i: number) {
    if (i + 1 > save.unlocked) { audio.fx('hurt', 0.5); return }
    audio.fx('click')
    app.go(new LevelIntroScreen(i + 1))
  }
  update(dt: number) {
    this.t += dt
    const max = save.unlocked - 1
    if (input.pressed('left') || input.pressed('down')) { this.sel = Math.max(0, this.sel - 1); audio.fx('click', 0.5) }
    if (input.pressed('right') || input.pressed('up')) { this.sel = Math.min(max, this.sel + 1); audio.fx('click', 0.5) }
    if (input.pressed('back') || input.pressed('pause')) { app.go(new MenuScreen(), 'slide'); return }
    const near = (x: number, y: number) => this.pos.findIndex(([px, py]) => Math.abs(px - x) < 22 && Math.abs(py - y) < 20)
    if (pointer.active) { const i = near(pointer.x, pointer.y); if (i >= 0 && i <= max) this.sel = i }
    const e = edges()
    this.back.buttons[0].x = e.r - 58
    this.back.buttons[0].y = e.t + 26
    for (const c of input.clicks()) {
      const i = near(c.x, c.y)
      if (i >= 0) { if (i <= max) { this.sel = i; this.start(i) } else audio.fx('hurt', 0.5); return }
    }
    if (this.back.update(dt)) return
    if (input.pressed('confirm')) this.start(this.sel)
  }
  render(ctx: CanvasRenderingContext2D) {
    const ai = !!tex('screens/map')?.ai
    const r = scene(ctx, 'screens/map', ai ? 0.12 : 0)
    if (!tex('ui/map')) return
    const e = edges()
    if (r && !r.ai) this.pos = LEVEL_POS.map(([x, y]) => [r.x - view.px + x * r.s, r.y - view.py + (y + 4) * r.s])
    else if (r) this.pos = LEVEL_POS_HD.map(([fx, fy]) => [r.x - view.px + fx * r.w, Math.max(e.t + 30, r.y - view.py + fy * r.h)])
    else return
    panel(ctx, () => {
      const spr = (q: readonly number[], x: number, y: number, s = 1) => drawImg(ctx, 'ui/map', q[0], q[1], q[2], q[3], x - (q[2] * s) / 2, y - (q[3] * s) / 2, q[2] * s, q[3] * s)
      if (r.ai) {
        // Sendero punteado entre niveles
        ctx.save()
        ctx.setLineDash([6, 7]); ctx.lineWidth = 4; ctx.lineCap = 'round'
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4
        ctx.beginPath()
        this.pos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
        ctx.restore()
      }
      this.pos.forEach(([x, y], i) => {
        const n = i + 1, rec = save.levels[n]
        const s = r.ai ? 1 : r.s
        if (r.ai) spr(n > save.unlocked ? SPR.locked : rec?.done ? SPR.done : SPR.open, x, y, s)
        else if (n > save.unlocked) spr(SPR.locked, x, y - 4 * s, s)
        else if (rec?.done) spr(SPR.done, x, y - 4 * s, s)
        if (rec?.stars) for (let k = 0; k < 3; k++) star(ctx, x - 11 + k * 11, y + 15 * s, 4.5, k < rec.stars)
      })
      const [sx, sy] = this.pos[this.sel]
      spr(SPR.sel[Math.floor(this.t * 8) % 3], sx, sy + 10)
      spr(SPR.arrow, sx, sy - 30 - Math.abs(Math.sin(this.t * 4)) * 6)
      if (r.ai) {
        // Título "Seleccionar nivel" (el arte nuevo no lo trae)
        const tw = 210, ty = e.t + 6
        ctx.save()
        ctx.translate(256, ty + 14); ctx.rotate(-0.025)
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, -tw / 2 + 3, -12, tw, 30, 6); ctx.fill()
        const g = ctx.createLinearGradient(0, -14, 0, 16); g.addColorStop(0, '#b8323a'); g.addColorStop(1, '#6e1218')
        ctx.fillStyle = g; roundRect(ctx, -tw / 2, -15, tw, 30, 6); ctx.fill()
        ctx.strokeStyle = '#f3d9a0'; ctx.lineWidth = 2; roundRect(ctx, -tw / 2 + 3, -12, tw - 6, 24, 4); ctx.stroke()
        drawText(ctx, 'Seleccionar nivel', 0, -11, { align: 'center', scale: 0.62, font: 'fuente_blanca' })
        ctx.restore()
      }
      this.drawInfo(ctx)
      this.back.draw(ctx)
    })
    drawCursor(ctx)
  }
  private drawInfo(ctx: CanvasRenderingContext2D) {
    const e = edges()
    const y = e.b - 64
    drawImg(ctx, 'ui/info_map', 0, 0, 512, 64, 0, y, 512, 64)
    const n = this.sel + 1, rec = save.levels[n]
    drawText(ctx, meta.names[this.sel], 312, y + 4, { align: 'center', scale: 0.62, maxWidth: 330 })
    const o = { scale: 1.35 }
    drawText(ctx, String(n), 96, y + 26, o)
    drawText(ctx, String(rec?.cows ?? 0), 176, y + 26, { ...o, align: 'right' })
    drawText(ctx, String(meta.levels[this.sel].cows), 194, y + 26, o)
    drawText(ctx, String(rec?.coins ?? 0), 300, y + 26, o)
    drawText(ctx, String(rec?.points ?? 0), 428, y + 26, o)
  }
}

// ---------------------------------------------------------------- presentación del nivel
/** Cuadro de preview_levels_tile.jpg de cada nivel (13-14 comparten la luna; 15-16 la nave). */
const PREVIEW = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13]

export class LevelIntroScreen implements Screen {
  t = 0
  data: LevelData | null = null
  ready = false
  failed = false
  p = 0
  constructor(readonly n: number) {}
  enter() {
    audio.music(null)
    save.last = this.n
    void loadAll(['ui/fondo_niveles', 'ui/preview_levels']).catch(() => {})
    loadLevelData(this.n)
      .then(async (d) => {
        this.data = d
        const imgs = levelImages(d)
        // Libera los fondos/tiles del nivel anterior
        release(lastLevelImages.filter((k) => !imgs.includes(k)))
        lastLevelImages = imgs
        this.p = 0.15
        await Promise.all([loadAll([...imgs, ...GAME_SHEETS], (k) => { this.p = 0.15 + k * 0.85 }), import('./play')])
      })
      .then(() => { this.ready = true; this.p = 1; audio.fx('info', 0.6) })
      .catch(() => { this.failed = true })
  }
  update(dt: number) {
    this.t += dt
    if (input.pressed('back')) { app.go(new MapScreen()); return }
    if (this.ready && this.t > 0.6 && input.any() && this.data) {
      const d = this.data
      void import('./play').then((m) => app.go(new m.PlayScreen(d), 'iris'))
    }
  }
  render(ctx: CanvasRenderingContext2D) {
    panelImage(ctx, 'ui/fondo_niveles', this.data ? `bg/${this.data.background}` : 'screens/map')
    panel(ctx, () => {
      const k = PREVIEW[this.n - 1], col = k < 8 ? 0 : 1, row = k < 8 ? k : k - 8
      if (!tex('ui/fondo_niveles')) return
      drawImg(ctx, 'ui/preview_levels', col * 512, row * 115, 512, 115, 0, 130, 512, 115)
      drawImg(ctx, 'ui/fondo_niveles', 0, 0, 512, 384, 0, 0, 512, 384)
      drawText(ctx, meta.descriptions[this.n - 1], 256, 19, { align: 'center', scale: 0.66, lineHeight: 26, maxWidth: 392 })
      drawText(ctx, meta.names[this.n - 1], 256, 259, { align: 'center', scale: 0.85, maxWidth: 244 })
      drawText(ctx, `Nivel ${this.n}`, 470, 214, { align: 'center', scale: 0.62, font: 'fuente_blanca' })
      const rec = save.levels[this.n]
      if (rec?.stars) for (let i = 0; i < 3; i++) star(ctx, 46 + i * 24, 214, 9, i < rec.stars)
      if (this.failed) drawText(ctx, 'Error de carga', 384, 362, { align: 'center', scale: 0.6, font: 'fuente_blanca' })
      else if (!this.ready) drawImg(ctx, 'ui/fondo_niveles', 5, 477, 255, 23, 257, 361, 255, 23)
      else {
        const f = Math.floor(this.t * 2.5) % 2
        if (f) drawImg(ctx, 'ui/fondo_niveles', 3, 415, 259, 27, 253, 358, 259, 27)
        else drawImg(ctx, 'ui/fondo_niveles', 5, 387, 255, 23, 257, 361, 255, 23)
      }
    })
    if (!this.ready) progressBar(ctx, view.w / 2, view.h - view.safe.b - 12, Math.min(300, view.w * 0.5), this.p)
  }
}
