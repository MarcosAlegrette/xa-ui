// Historia inicial (5 páginas de historieta), "Perdiste" y "¡Ganaste!" — a pantalla completa.
import { app, type Screen } from '../core/app'
import { audio } from '../core/audio'
import { loadAll, loadImage } from '../core/assets'
import { drawText } from '../core/font'
import { input } from '../core/input'
import { START_LIVES, persist, save } from '../core/save'
import { view } from '../core/stage'
import { drawCursor, scene } from './ui'
import { MapScreen } from './map'
import { ImageScreen, MenuScreen } from './menus'

export class IntroScreen implements Screen {
  page = 1
  t = 0
  prev = 0
  enter() {
    audio.music('xa_intro')
    void loadAll([1, 2, 3, 4, 5].map((i) => `screens/page_${i}`)).catch(() => {})
  }
  update(dt: number) {
    this.t += dt
    if (input.pressed('back')) return this.done()
    if (this.t > 0.4 && input.any()) {
      if (this.page < 5) { this.prev = this.page; this.page++; this.t = 0; audio.fx('click', 0.6) } else this.done()
    }
  }
  done() {
    save.seenIntro = true
    persist()
    app.go(new MapScreen(), 'slide')
  }
  render(ctx: CanvasRenderingContext2D) {
    // Pasa de página deslizando
    const k = this.prev ? Math.min(1, this.t / 0.35) : 1
    const e = 1 - Math.pow(1 - k, 3)
    if (k < 1) {
      ctx.save(); ctx.translate(-e * view.w, 0); scene(ctx, `screens/page_${this.prev}`, 0.1); ctx.restore()
      ctx.save(); ctx.translate((1 - e) * view.w, 0); scene(ctx, `screens/page_${this.page}`, 0.1); ctx.restore()
    } else scene(ctx, `screens/page_${this.page}`, 0.1)
    // Indicador de páginas
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath(); ctx.arc(view.w / 2 + (i - 3) * 16, view.h - view.safe.b - 10, i === this.page ? 4.5 : 3, 0, Math.PI * 2)
      ctx.fillStyle = i === this.page ? '#fff' : 'rgba(255,255,255,0.45)'; ctx.fill()
    }
    drawText(ctx, 'Esc: saltar', view.w - view.safe.r - 8, view.h - view.safe.b - 22, { align: 'right', scale: 0.4, font: 'fuente_blanca', alpha: 0.6 })
    drawCursor(ctx)
  }
}

export class GameOverScreen implements Screen {
  t = 0
  enter() { audio.music('lose'); void loadImage('screens/game_over').catch(() => {}) }
  update(dt: number) {
    this.t += dt
    if (this.t > 1.2 && input.any()) {
      save.lives = START_LIVES
      persist()
      app.go(new MapScreen())
    }
  }
  render(ctx: CanvasRenderingContext2D) { scene(ctx, 'screens/game_over', 0.12) }
}

export class WinScreen implements Screen {
  t = 0
  enter() {
    audio.music('xa_win')
    save.finished = true
    persist()
    void loadAll(['screens/screen_win', 'screens/creditos']).catch(() => {})
  }
  update(dt: number) {
    this.t += dt
    if (this.t > 1.5 && input.any()) {
      const m = new MenuScreen()
      app.go(m)
      setTimeout(() => { if (app.screen === m) app.push(new ImageScreen('screens/creditos')) }, 500)
    }
  }
  render(ctx: CanvasRenderingContext2D) { scene(ctx, 'screens/screen_win', 0.12) }
}
