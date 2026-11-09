// Máquina de pantallas con transiciones (fundido, "iris" de entrada/salida de nivel y deslizamiento)
// y diálogos apilados. Todas las pantallas dibujan en coordenadas lógicas de `view` (pantalla completa).
import { view } from './stage'

export interface Screen {
  enter?(): void
  exit?(): void
  update(dt: number): void
  render(ctx: CanvasRenderingContext2D, alpha: number): void
  /** Si es true, la pantalla de abajo se sigue dibujando (diálogos) */
  overlay?: boolean
  /** Para el iris: punto (en coordenadas de view) hacia donde se cierra */
  focus?(): { x: number; y: number } | null
  /** Se llama cuando aparece "Gira tu celular" (p. ej. para pausar el juego) */
  onBlock?(): void
}

export type Transition = 'fade' | 'iris' | 'slide'

let current: Screen | null = null
let next: Screen | null = null
let kind: Transition = 'fade'
let t = 0 // >0 saliendo (de DUR a 0), <0 entrando (de -DUR a 0)
const DUR: Record<Transition, number> = { fade: 0.22, iris: 0.45, slide: 0.32 }
const stack: Screen[] = []
/** Pantalla que se dibuja encima de todo (p. ej. "Gira tu celular") cuando corresponde */
let blocker: Screen | null = null
let wasBlocked = false

const clearStack = () => { for (let i = stack.length - 1; i >= 0; i--) stack[i].exit?.(); stack.length = 0 }
const ease = (x: number) => x * x * (3 - 2 * x)

export const app = {
  get screen() { return current },
  go(s: Screen, how: Transition | 'instant' = 'fade') {
    if (how === 'instant' || !current) { current?.exit?.(); clearStack(); current = s; s.enter?.(); t = how === 'instant' ? 0 : -DUR.fade; kind = 'fade'; return }
    next = s
    if (t <= 0) { kind = how; t = DUR[how] }
  },
  /** Abre un diálogo encima de la pantalla actual. */
  push(s: Screen) { if (current) stack.push(current); current = s; s.enter?.() },
  pop() { current?.exit?.(); current = stack.pop() ?? current },
  /** ¿Está `s` en la pila (debajo de un diálogo)? */
  below(s: Screen) { return stack.includes(s) },
  get busy() { return t !== 0 },
  setBlocker(s: Screen) { blocker = s },
  update(dt: number) {
    if (view.blocked && blocker) {
      if (!wasBlocked) { wasBlocked = true; current?.onBlock?.() }
      blocker.update(dt)
      return
    }
    wasBlocked = false
    if (t > 0) {
      t -= dt
      if (t <= 0) {
        current?.exit?.()
        clearStack()
        current = next
        next = null
        current?.enter?.()
        t = -DUR[kind]
      }
      return
    }
    if (t < 0) t = Math.min(0, t + dt)
    current?.update(dt)
  },
  render(ctx: CanvasRenderingContext2D, alpha: number) {
    if (view.blocked && blocker) { blocker.render(ctx, alpha); return }
    if (current?.overlay) {
      let i = stack.length - 1
      while (i > 0 && stack[i].overlay) i--
      for (let j = Math.max(0, i); j < stack.length; j++) stack[j].render(ctx, alpha)
    }
    current?.render(ctx, alpha)
    if (t !== 0) {
      const d = DUR[kind]
      const k = ease(Math.max(0, Math.min(1, t > 0 ? 1 - t / d : -t / d))) // 1 = cubierto
      const W = view.w, H = view.h
      if (kind === 'iris') {
        const f = current?.focus?.() ?? { x: W / 2, y: H / 2 }
        const R = Math.hypot(Math.max(f.x, W - f.x), Math.max(f.y, H - f.y)) * (1 - k)
        ctx.fillStyle = '#000'
        ctx.beginPath()
        ctx.rect(0, 0, W, H)
        if (R > 0.5) ctx.arc(f.x, f.y, R, 0, Math.PI * 2, true)
        ctx.fill('evenodd')
      } else if (kind === 'slide') {
        const x = t > 0 ? W * (1 - k) : -W * (1 - k)
        ctx.fillStyle = '#0b1a06'
        ctx.fillRect(x, 0, W, H)
        ctx.fillStyle = '#7ec02a'
        ctx.fillRect(t > 0 ? x : x + W - 6, 0, 6, H)
      } else {
        ctx.fillStyle = `rgba(0,0,0,${k})`
        ctx.fillRect(0, 0, W, H)
      }
    }
  },
}
