import './styles/game.css'
import { app } from './core/app'
import { ALL_FX, ALL_MUSIC, audio, audioUrls } from './core/audio'
import { allUrls, loadAll } from './core/assets'
import { FONT_IMAGES } from './core/font'
import { initInput, input, pollGamepads } from './core/input'
import { onFirstGesture, registerSW } from './core/platform'
import { save } from './core/save'
import { createStage, view } from './core/stage'
import { initTouch } from './core/touch'
import { LogoScreen } from './screens/menus'
import { RotateScreen, initRotateButton } from './screens/rotate'

const stage = createStage(document.getElementById('app')!)
initTouch(stage.root)
audio.setVolumes(save.options)
initInput(stage.canvas, (e) => { audio.unlock(); onFirstGesture(e) })
app.setBlocker(new RotateScreen())
initRotateButton(stage.root)

// Bucle de paso fijo (120 Hz) con render interpolado: misma física a 60, 90, 120 o 144 Hz.
const STEP = 1 / 120
let acc = 0
let last = performance.now()
const perf = { frames: 0, t0: performance.now(), fps: 0, ms: 0 }

function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  acc += dt
  pollGamepads()
  let steps = 0
  while (acc >= STEP && steps < 12) {
    app.update(STEP)
    input.endFrame()
    acc -= STEP
    steps++
  }
  if (steps >= 12) acc = 0
  const t0 = performance.now()
  const { ctx } = stage
  ctx.setTransform(view.k, 0, 0, view.k, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  app.render(ctx, acc / STEP)
  perf.ms = perf.ms * 0.95 + (performance.now() - t0) * 0.05
  perf.frames++
  if (now - perf.t0 > 1000) { perf.fps = (perf.frames * 1000) / (now - perf.t0); perf.frames = 0; perf.t0 = now }
}

void loadAll(['screens/logo_batovi', 'screens/logo_calcar', 'ui/cargando', ...FONT_IMAGES]).catch(() => {}).finally(() => {
  app.go(new LogoScreen('logo_batovi'), 'instant')
  requestAnimationFrame((t) => { last = t; frame(t) })
})

// PWA: después de la primera carga descarga en segundo plano todo para jugar sin conexión
registerSW(() => [...allUrls(), ...audioUrls({ music: ALL_MUSIC, fx: ALL_FX })])

// Sólo en desarrollo: estado del juego accesible desde la consola para pruebas.
if (import.meta.env.DEV) {
  void Promise.all([import('./screens/play'), import('./screens/map')]).then(([m, map]) => {
    Object.assign(window, {
      xa: {
        app, save, input, audio, view, perf,
        get world() { return m.currentWorld },
        level(n: number) { audio.unlock(); app.go(new map.LevelIntroScreen(n)) },
      },
    })
  })
}
