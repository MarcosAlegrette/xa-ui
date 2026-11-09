// Logos → pantalla de carga ("Ingresando a la atmósfera terrestre") → menú principal,
// opciones, ayuda, créditos y confirmación de salida. Todo a pantalla completa en cualquier proporción.
import { app, type Screen } from '../core/app'
import { audio } from '../core/audio'
import { draw as drawImg, loadAll, tex } from '../core/assets'
import { drawText, FONT_IMAGES } from '../core/font'
import { input, pointer } from '../core/input'
import { fullscreenSupported, isFullscreen, isIOS, standalone, toggleFullscreen } from '../core/platform'
import { persist, save, totalStars, type Quality } from '../core/save'
import { relayout, view, W, H } from '../core/stage'
import { applyTouchOptions } from '../core/touch'
import { roundRect } from '../game/world'
import { Menu, box, choice, dim, drawCursor, edges, panel, panelImage, scene, slider, star, toggle } from './ui'

export const MENU_IMAGES = ['screens/menu', 'screens/menu_night', 'ui/banner', 'ui/press_any_key', 'ui/buttons', 'ui/options', 'ui/exit_confirmation', 'ui/cursor', 'ui/record_box', 'ui/calcar_logo', ...FONT_IMAGES]

// ---------------------------------------------------------------- logos (Batoví, Calcar)
export class LogoScreen implements Screen {
  t = 0
  constructor(readonly logo: 'logo_batovi' | 'logo_calcar') {}
  enter() { void loadAll([`screens/${this.logo === 'logo_batovi' ? 'logo_calcar' : 'menu'}`]).catch(() => {}) }
  update(dt: number) {
    this.t += dt
    if (this.t > 2.4 || (this.t > 0.4 && input.any())) app.go(this.logo === 'logo_batovi' ? new LogoScreen('logo_calcar') : new LoadingScreen())
  }
  render(ctx: CanvasRenderingContext2D) {
    scene(ctx, `screens/${this.logo}`, 0.5)
  }
}

// ---------------------------------------------------------------- carga inicial (con barra de progreso)
export class LoadingScreen implements Screen {
  t = 0
  p = 0
  ready = false
  enter() {
    void loadAll([...MENU_IMAGES, 'screens/page_1', 'screens/map', 'ui/map', 'ui/info_map', 'ui/items'], (k) => { this.p = k }).catch(() => {}).finally(() => { setTimeout(() => { this.ready = true }, 300) })
  }
  update(dt: number) {
    this.t += dt
    if (this.ready && (input.any() || this.t > 6)) { audio.unlock(); app.go(new MenuScreen()) }
  }
  render(ctx: CanvasRenderingContext2D) {
    panelImage(ctx, 'ui/cargando')
    panel(ctx, () => {
      if (!tex('ui/cargando')) return
      if (!this.ready) {
        const f = Math.floor(this.t * 3) % 3
        drawImg(ctx, 'ui/cargando', 1, 388 + f * 40, 259, 32, 253, 288, 259, 32)
      } else if (Math.floor(this.t * 2) % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(253, 293, 259, 26)
      }
    })
    progressBar(ctx, view.w / 2, view.h - view.safe.b - 14, Math.min(360, view.w * 0.6), this.p)
  }
}

export function progressBar(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, p: number) {
  const h = 8
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  roundRect(ctx, cx - w / 2 - 2, y - 2, w + 4, h + 4, 6); ctx.fill()
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#d8ff8a'); g.addColorStop(1, '#3f8f1c')
  ctx.fillStyle = g
  roundRect(ctx, cx - w / 2, y, Math.max(h, w * p), h, 4); ctx.fill()
}

// ---------------------------------------------------------------- menú principal
const night = () => { const h = new Date().getHours(); return h >= 20 || h < 7 }

export class MenuScreen implements Screen {
  t = 0
  panel = false
  menu: Menu
  constructor() {
    const items: { id: string; on: () => void }[] = []
    if (save.unlocked > 1 || save.levels[1]) items.push({ id: 'continuar', on: () => this.continue() })
    items.push(
      { id: 'jugar', on: () => this.play() },
      { id: 'opciones', on: () => app.push(new OptionsScreen()) },
      { id: 'ayuda', on: () => app.push(new ImageScreen('screens/ayuda')) },
      { id: 'creditos', on: () => app.push(new ImageScreen('screens/creditos')) },
      { id: 'salir', on: () => app.push(new ConfirmScreen(() => { this.panel = false })) },
    )
    const gap = items.length > 5 ? 28 : 33
    const y0 = 316 - gap * (items.length - 1)
    this.menu = new Menu(items.map((it, i) => ({ id: it.id, x: 256, y: y0 + i * gap, onClick: it.on })))
  }
  enter() { audio.music('xa_menu') }
  continue() {
    const n = Math.max(1, Math.min(save.unlocked, save.last || save.unlocked))
    void import('./map').then((m) => app.go(new m.LevelIntroScreen(n)))
  }
  play() {
    if (!save.seenIntro) void import('./story').then((m) => app.go(new m.IntroScreen()))
    else void import('./map').then((m) => app.go(new m.MapScreen(), 'slide'))
  }
  update(dt: number) {
    this.t += dt
    if (!this.panel) { if (input.any() && this.t > 0.3) { this.panel = true; this.menu.focus = 0; this.openT = 0 }; return }
    this.openT += dt
    if (input.pressed('back')) { this.panel = false; return }
    this.menu.update(dt)
  }
  openT = 0
  render(ctx: CanvasRenderingContext2D) {
    const key = night() ? 'screens/menu_night' : 'screens/menu'
    const r = scene(ctx, key, 0.3)
    const e = edges()
    // Récord y logo de Calcar (el arte nuevo no los trae; en el original están pintados)
    if (r?.ai || !r) {
      panel(ctx, () => {
        const bx = e.r - 112, by = e.t + 2
        drawImg(ctx, 'ui/record_box', 0, 0, 106, 40, bx, by, 106, 40)
        drawText(ctx, String(save.record), bx + 54, by + 17, { scale: 0.62, align: 'center', font: 'fuente_negra' })
        drawImg(ctx, 'ui/calcar_logo', 0, 0, 73, 44, e.r - 80, e.b - 50, 73, 44)
      })
    } else panel(ctx, () => drawText(ctx, String(save.record), r.x - view.px + 447 * r.s, r.y - view.py + 19 * r.s, { scale: 0.75 * r.s, align: 'center' }))
    const stars = totalStars()
    if (stars) panel(ctx, () => { star(ctx, e.l + 18, e.b - 18, 11, true); drawText(ctx, `${stars}/48`, e.l + 34, e.b - 31, { scale: 0.62, font: 'fuente_blanca' }) })
    if (!this.panel) {
      const a = 0.65 + 0.35 * Math.sin(this.t * 4)
      ctx.globalAlpha = a
      panel(ctx, () => drawImg(ctx, 'ui/press_any_key', 0, 0, 512, 64, 0, e.b - 66, 512, 64))
      ctx.globalAlpha = 1
    } else {
      // El cartel del menú entra con un pequeño rebote
      const k = Math.min(1, this.openT / 0.35)
      const s = 0.85 + 0.15 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.04
      dim(ctx, 0.25 * k)
      panel(ctx, () => {
        ctx.save()
        ctx.translate(256, 240); ctx.scale(s, s); ctx.translate(-256, -240)
        ctx.globalAlpha = k
        drawImg(ctx, 'ui/banner', 0, 0, 512, 384, 0, 0, 512, 384)
        this.menu.draw(ctx)
        ctx.restore()
        ctx.globalAlpha = 1
      })
    }
    if (app.screen === this) drawCursor(ctx)
  }
}

// ---------------------------------------------------------------- opciones (también en la pausa)
interface Row { label: string; kind: 'slider' | 'toggle' | 'choice' | 'button'; get: () => number; set: (v: number) => void; opts?: string[]; disabled?: () => boolean; note?: () => string }
const QUALS: Quality[] = ['alta', 'media', 'baja']

export class OptionsScreen implements Screen {
  overlay = true
  row = 0
  rows: Row[]
  drag = -1
  constructor() {
    const o = save.options
    const apply = () => { audio.setVolumes(o); applyTouchOptions(); persist() }
    this.rows = [
      { label: 'Música', kind: 'slider', get: () => o.music, set: (v) => { o.music = v; apply() } },
      { label: 'Efectos', kind: 'slider', get: () => o.fx, set: (v) => { o.fx = v; apply(); audio.fx('coin', 0.6) } },
      {
        label: 'Pantalla completa', kind: 'toggle', get: () => (isFullscreen() ? 1 : 0),
        set: () => { o.fullscreen = !isFullscreen(); apply(); void toggleFullscreen() },
        disabled: () => !fullscreenSupported(),
        note: () => (!fullscreenSupported() && isIOS && !standalone ? 'Compartir > Agregar a inicio' : ''),
      },
      { label: 'Calidad', kind: 'choice', opts: ['Alta', 'Media', 'Baja'], get: () => QUALS.indexOf(o.quality), set: (v) => { o.quality = QUALS[v]; apply(); relayout() } },
      { label: 'Gráficos originales', kind: 'toggle', get: () => (o.originalArt ? 1 : 0), set: () => { o.originalArt = !o.originalArt; apply(); relayout() } },
      { label: 'Doble salto clásico', kind: 'toggle', get: () => (o.classicDoubleJump ? 1 : 0), set: () => { o.classicDoubleJump = !o.classicDoubleJump; apply() }, note: () => (o.classicDoubleJump ? 'Sólo con el yogur' : 'Siempre disponible') },
    ]
    if (view.touch) this.rows.push(
      { label: 'Tamaño controles', kind: 'slider', get: () => (o.ctlSize - 0.7) / 0.6, set: (v) => { o.ctlSize = 0.7 + v * 0.6; apply() } },
      { label: 'Opacidad controles', kind: 'slider', get: () => (o.ctlOpacity - 0.25) / 0.7, set: (v) => { o.ctlOpacity = 0.25 + v * 0.7; apply() } },
      { label: 'Vibración', kind: 'toggle', get: () => (o.vibrate ? 1 : 0), set: () => { o.vibrate = !o.vibrate; apply(); if (o.vibrate) navigator.vibrate?.(30) } },
    )
    this.rows.push({ label: 'Volver', kind: 'button', get: () => 0, set: () => { audio.fx('click'); app.pop() } })
  }
  private geom() {
    const n = this.rows.length
    const rh = Math.min(30, (view.h - 90) / n)
    const h = rh * n + 62, w = 440
    return { x: 256 - w / 2, y: 192 - h / 2, w, h, rh, top: 192 - h / 2 + 48 }
  }
  private rowAt(x: number, y: number) {
    const g = this.geom()
    if (x < g.x || x > g.x + g.w) return -1
    const i = Math.floor((y - g.top + g.rh / 2) / g.rh)
    return i >= 0 && i < this.rows.length ? i : -1
  }
  private ctlX() { return this.geom().x + 250 }
  update(dt: number) {
    void dt
    if (input.pressed('back') || input.pressed('pause')) { app.pop(); return }
    const n = this.rows.length
    if (input.pressed('up')) { this.row = (this.row + n - 1) % n; audio.fx('click', 0.4) }
    if (input.pressed('down')) { this.row = (this.row + 1) % n; audio.fx('click', 0.4) }
    const r = this.rows[this.row]
    const step = (d: number) => {
      if (r.disabled?.()) return
      if (r.kind === 'slider') r.set(Math.max(0, Math.min(1, Math.round((r.get() + d * 0.1) * 10) / 10)))
      else if (r.kind === 'choice') r.set(Math.max(0, Math.min(r.opts!.length - 1, r.get() + d)))
      else if (r.kind === 'toggle' && (d > 0) !== !!r.get()) r.set(0)
      audio.fx('click', 0.4)
    }
    if (input.pressed('left')) step(-1)
    if (input.pressed('right')) step(1)
    if (input.pressed('confirm')) {
      if (r.kind === 'toggle' || r.kind === 'button') { if (!r.disabled?.()) { r.set(0); audio.fx('click') } }
      else if (r.kind === 'choice') r.set((r.get() + 1) % r.opts!.length)
    }
    const cx = this.ctlX()
    for (const c of input.clicks()) {
      const i = this.rowAt(c.x, c.y)
      if (i < 0) { const g = this.geom(); if (c.x < g.x || c.x > g.x + g.w || c.y < g.y || c.y > g.y + g.h) { app.pop(); return } continue }
      this.row = i
      const rr = this.rows[i]
      if (rr.disabled?.()) continue
      if (rr.kind === 'slider') { this.drag = i; rr.set(Math.max(0, Math.min(1, (c.x - cx) / 150))) }
      else if (rr.kind === 'choice') { const k = Math.floor((c.x - cx) / 54); if (k >= 0 && k < rr.opts!.length) rr.set(k) }
      else { rr.set(0); if (rr.kind === 'toggle') audio.fx('click') }
      if (rr.kind === 'button') return
    }
    if (this.drag >= 0) {
      if (pointerDown) this.rows[this.drag].set(Math.max(0, Math.min(1, (dragX - cx) / 150)))
      else this.drag = -1
    }
    if (pointer.active) { const i = this.rowAt(pointer.x, pointer.y); if (i >= 0) this.row = i }
  }
  render(ctx: CanvasRenderingContext2D) {
    dim(ctx, 0.55)
    panel(ctx, () => {
      const g = this.geom()
      box(ctx, g.x, g.y, g.w, g.h)
      drawText(ctx, 'Opciones', 256, g.y + 10, { align: 'center', scale: 0.95, font: 'fuente_blanca' })
      const cx = this.ctlX()
      this.rows.forEach((r, i) => {
        const y = g.top + i * g.rh
        const f = i === this.row
        if (f) { ctx.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(ctx, g.x + 12, y - g.rh / 2 + 1, g.w - 24, g.rh - 2, 8); ctx.fill() }
        if (r.kind === 'button') { drawText(ctx, r.label, 256, y - 10, { align: 'center', scale: 0.72, font: f ? 'fuente_negra' : 'fuente_blanca' }); return }
        drawText(ctx, r.label, g.x + 26, y - 9, { scale: 0.6, font: 'fuente_blanca', alpha: r.disabled?.() ? 0.5 : 1 })
        if (r.kind === 'slider') slider(ctx, cx, y, 150, r.get(), f)
        else if (r.kind === 'toggle') toggle(ctx, cx, y, !!r.get(), f, r.disabled?.())
        else choice(ctx, cx, y, r.opts!, r.get(), f)
        const note = r.note?.()
        if (note) drawText(ctx, note, cx + 48, y - 7, { scale: 0.42, font: 'fuente_blanca', alpha: 0.85 })
      })
    })
    drawCursor(ctx)
  }
}

// Estado del puntero para arrastrar deslizadores
let pointerDown = false, dragX = 0
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { pointerDown = true; dragX = input.toLogical(e.clientX, e.clientY).x })
  window.addEventListener('pointermove', (e) => { if (pointerDown) dragX = input.toLogical(e.clientX, e.clientY).x })
  window.addEventListener('pointerup', () => { pointerDown = false })
  window.addEventListener('pointercancel', () => { pointerDown = false })
}

// ---------------------------------------------------------------- ayuda y créditos
export class ImageScreen implements Screen {
  overlay = false
  back = new Menu([{ id: 'atras', x: 448, y: 356, onClick: () => app.pop() }])
  constructor(readonly name: string) {}
  enter() { void loadAll([this.name]).catch(() => {}) }
  update(dt: number) {
    if (input.pressed('back') || input.pressed('pause')) { app.pop(); return }
    const e = edges()
    this.back.buttons[0].x = e.r - 56
    this.back.buttons[0].y = e.b - 28
    this.back.update(dt)
  }
  render(ctx: CanvasRenderingContext2D) {
    scene(ctx, this.name, 0.06)
    panel(ctx, () => this.back.draw(ctx))
    drawCursor(ctx)
  }
}

// ---------------------------------------------------------------- "¿Seguro que quieres volver al menú principal?"
export class ConfirmScreen implements Screen {
  overlay = true
  menu: Menu
  t = 0
  constructor(onYes: () => void) {
    this.menu = new Menu([
      { id: 'si', x: 190, y: 318, onClick: () => { app.pop(); onYes() } },
      { id: 'no', x: 326, y: 318, onClick: () => app.pop() },
    ], false)
    this.menu.focus = 1
  }
  update(dt: number) {
    this.t += dt
    if (input.pressed('back')) { app.pop(); return }
    this.menu.update(dt)
  }
  render(ctx: CanvasRenderingContext2D) {
    dim(ctx, 0.55 * Math.min(1, this.t * 6))
    panel(ctx, () => {
      drawImg(ctx, 'ui/exit_confirmation', 0, 0, W, H, 0, 0, W, H)
      this.menu.draw(ctx)
    })
    drawCursor(ctx)
  }
}
