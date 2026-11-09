// Controles táctiles estilo "shooter móvil": joystick FLOTANTE en la mitad izquierda (aparece donde se
// apoya el pulgar; analógico con zona muerta) y botones redondos grandes a la derecha (Saltar el más
// grande, Disparar, Escudo) + Pausa arriba. Multitáctil por pointerId (moverse + saltar + disparar a la vez);
// se puede deslizar el pulgar de un botón a otro. Tamaño, opacidad y vibración se ajustan en Opciones.
import { input, type Action } from './input'
import { save } from './save'
import { tex } from './assets'

interface Btn { id: string; acts: Action[]; el: HTMLDivElement; cx: number; cy: number; r: number }

const ICONS: Record<string, string> = {
  jump: '<svg viewBox="0 0 48 48"><path d="M24 9 L39 26 H30 V39 H18 V26 H9 Z" fill="currentColor"/></svg>',
  shoot: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="9" fill="currentColor"/><circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M24 2v9M24 37v9M2 24h9M37 24h9" stroke="currentColor" stroke-width="3.5"/></svg>',
  shield: '<svg viewBox="0 0 48 48"><path d="M24 5 L40 11 V23 C40 33 33 40 24 44 C15 40 8 33 8 23 V11 Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M24 13 L33 16.5 V23.5 C33 29 29.5 33 24 35.5 Z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 48 48"><rect x="13" y="10" width="8" height="28" rx="2" fill="currentColor"/><rect x="27" y="10" width="8" height="28" rx="2" fill="currentColor"/></svg>',
}

let layer: HTMLDivElement
let joyBase: HTMLDivElement, joyKnob: HTMLDivElement
const buttons: Btn[] = []
let joyId: number | null = null
const joy = { ox: 0, oy: 0, x: 0, y: 0, r: 60 }
const fingers = new Map<number, string>() // pointerId → id de botón
let visible = false

export const vibrate = (ms: number | number[]) => { if (save.options.vibrate) try { navigator.vibrate?.(ms) } catch { /* sin vibración */ } }

export function initTouch(root: HTMLElement) {
  layer = document.createElement('div')
  layer.id = 'touch'
  layer.innerHTML = `
    <div class="joy-zone"></div>
    <div class="joy-base ghost"><div class="joy-knob"></div></div>
    <div class="tb jump" data-id="jump">${ICONS.jump}</div>
    <div class="tb shoot" data-id="shoot">${ICONS.shoot}</div>
    <div class="tb shield" data-id="shield">${ICONS.shield}</div>
    <div class="tb pause" data-id="pause">${ICONS.pause}</div>`
  root.appendChild(layer)
  joyBase = layer.querySelector('.joy-base')!
  joyKnob = layer.querySelector('.joy-knob')!
  const defs: [string, Action[]][] = [['jump', ['jump']], ['shoot', ['shoot']], ['shield', ['shield']], ['pause', []]]
  for (const [id, acts] of defs) buttons.push({ id, acts, el: layer.querySelector(`.tb.${id}`)!, cx: 0, cy: 0, r: 0 })

  const measure = () => {
    for (const b of buttons) {
      const r = b.el.getBoundingClientRect()
      b.cx = r.left + r.width / 2; b.cy = r.top + r.height / 2; b.r = r.width / 2
    }
    const jr = joyBase.getBoundingClientRect()
    joy.r = jr.width / 2 || 60
  }
  const hitButton = (x: number, y: number, slack = 1.35) => {
    let best: Btn | null = null, bd = Infinity
    for (const b of buttons) {
      const d = Math.hypot(x - b.cx, y - b.cy) / (b.r * (b.id === 'pause' ? 1.25 : slack))
      if (d < 1 && d < bd) { bd = d; best = b }
    }
    return best
  }
  const setButton = (pid: number, b: Btn | null) => {
    const old = fingers.get(pid)
    if (old === b?.id) return
    if (old) { input.set(`t${pid}`, []); layer.querySelector(`.tb.${old}`)?.classList.remove('on') }
    if (b) {
      fingers.set(pid, b.id)
      b.el.classList.add('on')
      if (b.id === 'pause') input.tap('pause')
      else input.set(`t${pid}`, b.acts)
      if (b.id === 'jump') vibrate(8)
    } else fingers.delete(pid)
  }
  const updateJoy = () => {
    let dx = joy.x - joy.ox, dy = joy.y - joy.oy
    const d = Math.hypot(dx, dy), max = joy.r
    if (d > max) {
      // El joystick "persigue" al pulgar si se va muy lejos (como en los shooters móviles)
      const k = (d - max) / d
      joy.ox += dx * k; joy.oy += dy * k
      dx = joy.x - joy.ox; dy = joy.y - joy.oy
    }
    const nx = dx / max, ny = dy / max
    joyBase.style.transform = `translate(${joy.ox - joy.r}px, ${joy.oy - joy.r}px)`
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`
    const dead = 0.22
    const acts: Action[] = []
    const mag = Math.hypot(nx, ny)
    if (mag > dead) {
      // Horizontal generoso; vertical exige más inclinación (escaleras / escudo) para no activarlo sin querer
      if (nx < -dead) acts.push('left')
      if (nx > dead) acts.push('right')
      const ang = Math.abs(Math.atan2(ny, Math.abs(nx)))
      if (ny < -0.55 && ang > 0.75) acts.push('up')
      if (ny > 0.55 && ang > 0.75) acts.push('down')
    }
    input.set('joy', acts)
    const ax = Math.abs(nx) < dead ? 0 : Math.sign(nx) * Math.min(1, (Math.abs(nx) - dead) / (0.75 - dead))
    input.setAxis('joy', ax)
  }
  const endJoy = () => {
    joyId = null
    input.set('joy', [])
    input.setAxis('joy', 0)
    joyBase.classList.add('ghost')
    joyBase.style.transform = ''
    joyKnob.style.transform = ''
  }

  layer.addEventListener('pointerdown', (e) => {
    if (!visible) return
    e.preventDefault()
    measure()
    try { layer.setPointerCapture(e.pointerId) } catch { /* sin captura */ }
    const b = hitButton(e.clientX, e.clientY)
    if (b) { setButton(e.pointerId, b); return }
    if (e.clientX < window.innerWidth * 0.5 && joyId === null) {
      joyId = e.pointerId
      const m = joy.r + 8
      joy.ox = Math.max(m, Math.min(window.innerWidth * 0.5 - m * 0.3, e.clientX))
      joy.oy = Math.max(m, Math.min(window.innerHeight - m, e.clientY))
      joy.x = e.clientX; joy.y = e.clientY
      joyBase.classList.remove('ghost')
      updateJoy()
    }
  })
  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId === joyId) { joy.x = e.clientX; joy.y = e.clientY; updateJoy(); return }
    if (fingers.has(e.pointerId) && fingers.get(e.pointerId) !== 'pause') {
      const b = hitButton(e.clientX, e.clientY, 1.05)
      if (b && b.id !== 'pause') setButton(e.pointerId, b)
    }
  })
  const up = (e: PointerEvent) => {
    if (e.pointerId === joyId) endJoy()
    if (fingers.has(e.pointerId)) setButton(e.pointerId, null)
  }
  layer.addEventListener('pointerup', up)
  layer.addEventListener('pointercancel', up)
  layer.addEventListener('lostpointercapture', up)
  // iOS: sin lupa, menú contextual ni doble toque para zoom
  layer.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
  layer.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  layer.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('resize', () => setTimeout(measure, 50))
  applyTouchOptions()
}

export function applyTouchOptions() {
  if (!layer) return
  layer.style.setProperty('--ctl-size', String(save.options.ctlSize))
  layer.style.setProperty('--ctl-opacity', String(save.options.ctlOpacity))
}

/** Muestra u oculta los controles (sólo en pantallas de juego, en dispositivos táctiles). */
export function showTouch(on: boolean) {
  if (on === visible || !layer) return
  visible = on
  document.body.classList.toggle('playing', on)
  if (!on) {
    for (const pid of [...fingers.keys()]) { input.set(`t${pid}`, []); fingers.delete(pid) }
    for (const b of buttons) b.el.classList.remove('on')
    if (joyId !== null) { joyId = null; input.set('joy', []); input.setAxis('joy', 0); joyBase.classList.add('ghost'); joyBase.style.transform = ''; joyKnob.style.transform = '' }
  }
}

/** Brillo en el botón de salto cuando el doble salto está listo en el aire. */
let djReady = false
export function setTouchState(dj: boolean) {
  if (dj === djReady || !layer) return
  djReady = dj
  buttons.find((b) => b.id === 'jump')?.el.classList.toggle('ready', dj)
}

/** Íconos de los botones dibujados con los sprites del juego (Xa saltando, disparando, con el escudo). */
let iconsDone = false
export function refreshTouchIcons() {
  if (iconsDone || !layer) return
  const hero = tex('sprites/hero'), blasts = tex('sprites/blasts')
  if (!hero || !blasts) return
  iconsDone = true
  const make = (fn: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas')
    c.width = c.height = 140
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 6; g.shadowOffsetY = 3
    fn(g)
    return c.toDataURL('image/png')
  }
  const frame = (g: CanvasRenderingContext2D, i: number, x: number, y: number, s: number) => {
    const sx = (i % 7) * 70, sy = Math.floor(i / 7) * 70
    g.drawImage(hero.src, sx * hero.s, sy * hero.s, 70 * hero.s, 70 * hero.s, x, y, 70 * s, 70 * s)
  }
  const icons: Record<string, string> = {
    jump: make((g) => { frame(g, 5, 5, 8, 1.85) }),
    shoot: make((g) => {
      frame(g, 22, -12, 10, 1.8)
      g.drawImage(blasts.src, 442 * blasts.s, 82 * blasts.s, 16 * blasts.s, 17 * blasts.s, 96, 52, 34, 36)
    }),
    shield: make((g) => { frame(g, 25, 2, 8, 1.85) }),
  }
  for (const [id, url] of Object.entries(icons)) {
    const el = layer.querySelector(`.tb.${id}`)
    if (!el) continue
    el.querySelector('svg')?.remove()
    el.querySelector('img')?.remove()
    const im = document.createElement('img')
    im.src = url
    im.alt = ''
    im.draggable = false
    el.appendChild(im)
  }
}
