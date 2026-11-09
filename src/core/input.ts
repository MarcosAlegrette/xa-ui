// Entrada unificada: teclado (como el original: flechas, Z salta, X dispara, Abajo = escudo),
// controles táctiles (joystick flotante + botones, ver touch.ts), mando (Gamepad API, stick analógico)
// y puntero/toque para los menús.
// Los "pressed" se acumulan hasta que un paso lógico los consume (input.endFrame), así un toque
// rapidísimo entre dos cuadros nunca se pierde.
export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'shoot' | 'shield' | 'pause' | 'confirm' | 'back'

const KEYS: Record<string, Action[]> = {
  ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ArrowUp: ['up'], KeyW: ['up'],
  ArrowDown: ['down'], KeyS: ['down'],
  KeyZ: ['jump', 'confirm'], Space: ['jump', 'confirm'], KeyK: ['jump'],
  KeyX: ['shoot'], KeyJ: ['shoot'], ControlLeft: ['shoot'], ControlRight: ['shoot'],
  KeyC: ['shield'], KeyL: ['shield'],
  Enter: ['confirm'], NumpadEnter: ['confirm'],
  Escape: ['pause', 'back'], KeyP: ['pause'], Backspace: ['back'],
}

const held = new Set<Action>()
const sources = new Map<string, Set<Action>>() // quién mantiene apretada cada acción
const pressedQ = new Set<Action>()
const releasedQ = new Set<Action>()
const axes = new Map<string, number>() // ejes analógicos horizontales por fuente
let anyQ = false
const clicks: { x: number; y: number }[] = []
export const pointer = { x: -1, y: -1, active: false, mouse: false }
let toLogical: (cx: number, cy: number) => { x: number; y: number } = (x, y) => ({ x, y })
/** Último dispositivo usado (para mostrar u ocultar ayudas) */
export let lastDevice: 'keyboard' | 'touch' | 'pad' | 'mouse' = 'keyboard'

function press(src: string, acts: Action[]) {
  let s = sources.get(src)
  if (!s) sources.set(src, (s = new Set()))
  for (const a of acts) {
    if (!held.has(a)) pressedQ.add(a)
    s.add(a)
    held.add(a)
  }
}
function release(src: string) {
  const s = sources.get(src)
  if (!s) return
  sources.delete(src)
  for (const a of s) {
    let still = false
    for (const o of sources.values()) if (o.has(a)) still = true
    if (!still) { held.delete(a); releasedQ.add(a) }
  }
}
/** Hace que la fuente `src` mantenga exactamente estas acciones. */
function setSource(src: string, acts: Action[]) {
  const s = sources.get(src)
  if (s && s.size === acts.length && acts.every((a) => s.has(a))) return
  release(src)
  if (acts.length) press(src, acts)
}

export const input = {
  down: (a: Action) => held.has(a),
  pressed: (a: Action) => pressedQ.has(a),
  released: (a: Action) => releasedQ.has(a),
  /** Eje horizontal analógico -1..1 (teclado = ±1). */
  axisX(): number {
    let v = 0
    for (const x of axes.values()) if (Math.abs(x) > Math.abs(v)) v = x
    if (v === 0) v = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
    return v
  },
  /** "Presiona cualquier tecla" */
  any: () => anyQ,
  clicks: () => clicks as readonly { x: number; y: number }[],
  /** Debe llamarse al final de cada paso lógico que consumió la entrada. */
  endFrame() { pressedQ.clear(); releasedQ.clear(); anyQ = false; clicks.length = 0 },
  /** Controles táctiles / virtuales */
  set(src: string, acts: Action[]) { const had = sources.has(src); setSource(src, acts); if (acts.length && !had) { anyQ = true; lastDevice = 'touch' } },
  setAxis(src: string, v: number) { if (v) axes.set(src, v); else axes.delete(src) },
  /** Pulso (apretar y soltar en el próximo paso) */
  tap(a: Action) { pressedQ.add(a); anyQ = true },
  setMapper(fn: typeof toLogical) { toLogical = fn },
  toLogical: (cx: number, cy: number) => toLogical(cx, cy),
  releaseAll() { for (const k of [...sources.keys()]) release(k); axes.clear() },
}

export function initInput(target: HTMLElement, onGesture: (e: Event) => void) {
  window.addEventListener('keydown', (e) => {
    onGesture(e)
    const acts = KEYS[e.code]
    if (acts) e.preventDefault()
    lastDevice = 'keyboard'
    if (e.repeat) return
    anyQ = true
    if (acts) press(`k:${e.code}`, acts)
  })
  window.addEventListener('keyup', (e) => release(`k:${e.code}`))
  window.addEventListener('blur', () => input.releaseAll())
  document.addEventListener('visibilitychange', () => { if (document.hidden) input.releaseAll() })
  target.addEventListener('pointerdown', (e) => {
    onGesture(e)
    const p = toLogical(e.clientX, e.clientY)
    clicks.push(p)
    anyQ = true
    pointer.mouse = e.pointerType === 'mouse'
    lastDevice = pointer.mouse ? 'mouse' : 'touch'
    Object.assign(pointer, p, { active: pointer.mouse })
  })
  target.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    pointer.mouse = true
    Object.assign(pointer, toLogical(e.clientX, e.clientY), { active: true })
  })
  target.addEventListener('pointerleave', () => { pointer.active = false })
  window.addEventListener('pointerdown', onGesture, { capture: true })
}

// ---------------------------------------------------------------- mando
const PAD: [number, Action[]][] = [
  [0, ['jump', 'confirm']], [1, ['shoot', 'back']], [2, ['shoot']], [3, ['jump']], [4, ['shield']], [5, ['shield']], [6, ['shield']], [7, ['shoot']],
  [9, ['pause']], [8, ['back']], [12, ['up']], [13, ['down']], [14, ['left']], [15, ['right']],
]
const DEAD = 0.22
export function pollGamepads() {
  const pads = navigator.getGamepads?.() ?? []
  for (const gp of pads) {
    if (!gp) continue
    for (const [b, acts] of PAD) {
      const id = `g${gp.index}:${b}`
      const on = !!gp.buttons[b]?.pressed
      if (on && !sources.has(id)) { press(id, acts); anyQ = true; lastDevice = 'pad' }
      else if (!on && sources.has(id)) release(id)
    }
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0
    const acts: Action[] = []
    if (ax < -0.5) acts.push('left')
    if (ax > 0.5) acts.push('right')
    if (ay < -0.6) acts.push('up')
    if (ay > 0.6) acts.push('down')
    setSource(`g${gp.index}:stick`, acts)
    const mag = Math.abs(ax) < DEAD ? 0 : Math.sign(ax) * Math.min(1, (Math.abs(ax) - DEAD) / (1 - DEAD - 0.15))
    input.setAxis(`g${gp.index}`, mag)
    if (acts.length) lastDevice = 'pad'
  }
}
