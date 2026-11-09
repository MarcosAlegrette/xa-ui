// Pantalla de juego (InGame), pausa y resumen de nivel completado.
import meta from '../data/meta.json'
import { app, type Screen } from '../core/app'
import { audio } from '../core/audio'
import { drawText } from '../core/font'
import { input } from '../core/input'
import { persist, recordLevel, save, starsFor } from '../core/save'
import { view } from '../core/stage'
import { refreshTouchIcons, showTouch, setTouchState } from '../core/touch'
import type { LevelData } from '../game/level'
import { World } from '../game/world'
import { ConfirmScreen, ImageScreen, OptionsScreen } from './menus'
import { MapScreen } from './map'
import { GameOverScreen, WinScreen } from './story'
import { Menu, box, dim, drawCursor, panel, star } from './ui'

export let currentWorld: World | null = null

export class PlayScreen implements Screen {
  world: World
  constructor(readonly data: LevelData) { this.world = new World(data) }
  enter() { currentWorld = this.world; audio.music(this.world.music); showTouch(true); refreshTouchIcons(); input.releaseAll() }
  exit() { if (currentWorld === this.world) currentWorld = null; showTouch(false); this.world.dispose() }
  focus() { return this.world.heroOnScreen() }
  onBlock() { if (this.world.doneT < 0 && app.screen === this) app.push(new PauseScreen(this)) }
  update(dt: number) {
    const w = this.world
    showTouch(app.screen === this)
    if (input.pressed('pause') && w.doneT < 0) { app.push(new PauseScreen(this)); return }
    w.update(dt)
    const h = w.hero
    setTouchState(h.canDouble && !h.usedDouble && !h.onGround && h.state === 'normal')
    if (w.event === 'gameover') { w.event = null; app.go(new GameOverScreen()); return }
    if (w.event === 'complete') {
      w.event = null
      const s = w.stats
      const stars = starsFor(s.cows, s.cowsTotal, s.coins, s.coinsTotal)
      recordLevel(w.level.n, { cows: s.cows, coins: s.coins, points: s.points, stars })
      app.push(new LevelDoneScreen(this, stars))
    }
  }
  render(ctx: CanvasRenderingContext2D, a: number) { this.world.render(ctx, a) }
}

export class PauseScreen implements Screen {
  overlay = true
  menu: Menu
  t = 0
  constructor(readonly play: PlayScreen) {
    this.menu = new Menu([
      { id: 'continuar', x: 256, y: 168, onClick: () => this.resume() },
      { id: 'opciones', x: 256, y: 206, onClick: () => app.push(new OptionsScreen()) },
      { id: 'ayuda', x: 256, y: 242, onClick: () => app.push(new ImageScreen('screens/ayuda')) },
      { id: 'salir', x: 256, y: 280, onClick: () => app.push(new ConfirmScreen(() => { app.pop(); persist(); app.go(new MapScreen()) })) },
    ])
  }
  enter() { audio.pause(true); input.releaseAll(); showTouch(false) }
  exit() { audio.pause(false) }
  resume() { app.pop(); input.releaseAll() }
  update(dt: number) {
    this.t += dt
    if (view.blocked) return
    if (input.pressed('pause') || input.pressed('back')) { this.resume(); return }
    this.menu.update(dt)
  }
  render(ctx: CanvasRenderingContext2D) {
    dim(ctx, Math.min(0.6, this.t * 4))
    const w = this.play.world
    panel(ctx, () => {
      box(ctx, 146, 92, 220, 222)
      drawText(ctx, 'Pausa', 256, 100, { align: 'center', scale: 0.9, font: 'fuente_blanca' })
      drawText(ctx, `${w.level.n}. ${meta.names[w.level.n - 1]}`, 256, 126, { align: 'center', scale: 0.48, font: 'fuente_blanca', maxWidth: 200 })
      this.menu.draw(ctx)
    })
    drawCursor(ctx)
  }
}

/** Resumen al terminar un nivel: estrellas, vacas, monedas y puntos. */
export class LevelDoneScreen implements Screen {
  overlay = true
  t = 0
  menu: Menu
  constructor(readonly play: PlayScreen, readonly stars: number) {
    this.menu = new Menu([{ id: 'continuar', x: 256, y: 290, onClick: () => this.next() }])
  }
  enter() { showTouch(false); audio.music('xa_win') }
  next() {
    const n = this.play.world.level.n
    if (n === 16) app.go(new WinScreen())
    else app.go(new MapScreen(), 'slide')
  }
  update(dt: number) {
    const before = Math.floor(this.t / 0.35)
    this.t += dt
    const after = Math.floor(this.t / 0.35)
    if (after !== before && after >= 2 && after - 2 < this.stars) audio.fx('coin', 0.9, 1 + (after - 2) * 0.12)
    if (this.t > 0.8) this.menu.update(dt)
  }
  render(ctx: CanvasRenderingContext2D) {
    const k = Math.min(1, this.t * 3)
    dim(ctx, 0.55 * k)
    const s = this.play.world.stats
    panel(ctx, () => {
      const pop = 0.8 + 0.2 * (1 - Math.pow(1 - k, 3))
      ctx.save(); ctx.translate(256, 190); ctx.scale(pop, pop); ctx.translate(-256, -190)
      box(ctx, 116, 70, 280, 250)
      drawText(ctx, '¡Nivel completado!', 256, 80, { align: 'center', scale: 0.8, font: 'fuente_blanca', maxWidth: 250 })
      for (let i = 0; i < 3; i++) {
        const st = this.t - 0.7 - i * 0.35
        const on = i < this.stars && st > 0
        const sc = on ? 1 + Math.max(0, 0.6 - st * 3) : 1
        star(ctx, 206 + i * 50, 140, 19, on, sc)
      }
      const row = (label: string, v: string, y: number) => {
        drawText(ctx, label, 150, y, { scale: 0.56, font: 'fuente_blanca' })
        drawText(ctx, v, 362, y, { scale: 0.6, font: 'fuente_blanca', align: 'right' })
      }
      row('Vacas', `${s.cows} / ${s.cowsTotal}`, 172)
      row('Monedas', `${s.coins} / ${s.coinsTotal}`, 196)
      row('Puntos', String(s.points), 220)
      const best = save.levels[this.play.world.level.n]?.points ?? 0
      if (best <= s.points) drawText(ctx, '¡Nuevo récord!', 256, 246, { align: 'center', scale: 0.5, font: 'fuente_blanca', alpha: 0.6 + 0.4 * Math.sin(this.t * 6) })
      if (this.t > 0.8) this.menu.draw(ctx)
      ctx.restore()
    })
    drawCursor(ctx)
  }
}
