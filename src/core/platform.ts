// Pantalla completa (Fullscreen API + bloqueo de orientación horizontal donde existe, p. ej. Android),
// PWA (service worker para jugar sin conexión) y detección de iOS (no permite ninguna de las dos cosas
// en Safari del iPhone: ahí se usa el aviso "Gira tu celular" y "Agregar a pantalla de inicio").
import { save } from './save'
import { view } from './stage'

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }

export const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export const fullscreenSupported = () => !!(document.documentElement.requestFullscreen || (document.documentElement as FsEl).webkitRequestFullscreen)
export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement)

export async function enterFullscreen() {
  const el = document.documentElement as FsEl
  try {
    if (!isFullscreen()) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else await el.webkitRequestFullscreen?.()
    }
  } catch { /* el navegador no lo permite */ }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    if (view.phone && o?.lock) await o.lock('landscape')
  } catch { /* sin bloqueo de orientación */ }
}
export async function exitFullscreen() {
  try {
    const d = document as FsDoc
    if (document.fullscreenElement) await document.exitFullscreen()
    else if (d.webkitFullscreenElement) await d.webkitExitFullscreen?.()
  } catch { /* nada */ }
}
export const toggleFullscreen = () => (isFullscreen() ? exitFullscreen() : enterFullscreen())

/** Primer toque en móvil: pedir pantalla completa + horizontal (si la opción está activa). */
let tried = false
export function onFirstGesture(e: Event) {
  if (tried || !view.touch || standalone) return
  if (e.type !== 'pointerdown' && e.type !== 'touchend' && e.type !== 'click') return
  tried = true
  if (save.options.fullscreen && fullscreenSupported()) void enterFullscreen()
}

// ---------------------------------------------------------------- PWA
export function registerSW(precache: () => string[]) {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(async () => {
      const reg = await navigator.serviceWorker.ready
      // Cuando el navegador está libre, descarga en segundo plano todo lo necesario para jugar sin conexión
      const go = () => reg.active?.postMessage({ type: 'precache', urls: precache() })
      const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback
      setTimeout(() => (idle ? idle(go, { timeout: 8000 }) : go()), 6000)
    }).catch(() => {})
  })
}
