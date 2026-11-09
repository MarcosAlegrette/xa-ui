// Progreso y opciones guardados en el dispositivo (localStorage). El original guardaba en %APPDATA%/Batovi/save.xas.
export interface LevelRecord { done: boolean; cows: number; coins: number; points: number; stars: number }
export type Quality = 'alta' | 'media' | 'baja'
export interface Options {
  /** Volúmenes 0..1 */
  music: number
  fx: number
  /** Controles táctiles */
  ctlSize: number
  ctlOpacity: number
  vibrate: boolean
  /** Resolución del canvas */
  quality: Quality
  /** Arte original sin mejorar */
  originalArt: boolean
  /** Doble salto sólo con el yogur de cada nivel (como el original) */
  classicDoubleJump: boolean
  /** Pedir pantalla completa al tocar (móviles) */
  fullscreen: boolean
}
export interface SaveData {
  version: 2
  unlocked: number // último nivel disponible (1..16)
  lives: number
  record: number
  seenIntro: boolean
  finished: boolean
  /** Último nivel jugado (para "Continuar") */
  last: number
  levels: Record<number, LevelRecord>
  options: Options
}

export const START_LIVES = 3
const KEY = 'xa-cuatreros-save-v1'

const defaultOptions = (): Options => ({
  music: 0.7, fx: 0.85, ctlSize: 1, ctlOpacity: 0.55, vibrate: true, quality: 'alta', originalArt: false, classicDoubleJump: false, fullscreen: true,
})
const fresh = (): SaveData => ({
  version: 2, unlocked: 1, lives: START_LIVES, record: 0, seenIntro: false, finished: false, last: 0, levels: {}, options: defaultOptions(),
})

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData> & { version: number; options?: Record<string, unknown> }
      const out = { ...fresh(), ...d, version: 2 } as SaveData
      const o = { ...defaultOptions() } as Options
      // v1 tenía music/fx booleanos y "stretch"
      for (const [k, v] of Object.entries(d.options ?? {})) {
        if (k === 'music' || k === 'fx') (o[k] = typeof v === 'boolean' ? (v ? o[k] : 0) : Number(v))
        else if (k in o) (o as unknown as Record<string, unknown>)[k] = v
      }
      out.options = o
      for (const r of Object.values(out.levels)) if (r.stars === undefined) r.stars = r.done ? 1 : 0
      return out
    }
  } catch { /* almacenamiento bloqueado: se juega sin guardar */ }
  return fresh()
}

export const save: SaveData = read()

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)) } catch { /* sin almacenamiento */ }
}

/** Puntaje total = suma del mejor puntaje de cada nivel. */
export const totalPoints = () => Object.values(save.levels).reduce((s, l) => s + l.points, 0)
export const totalStars = () => Object.values(save.levels).reduce((s, l) => s + (l.stars ?? 0), 0)

/** Estrellas: terminar el nivel, rescatar todas las vacas, juntar al menos el 80 % de las monedas. */
export const starsFor = (cows: number, cowsTotal: number, coins: number, coinsTotal: number) =>
  1 + (cows >= cowsTotal ? 1 : 0) + (coinsTotal === 0 || coins >= coinsTotal * 0.8 ? 1 : 0)

export function recordLevel(n: number, r: { cows: number; coins: number; points: number; stars: number }) {
  const old = save.levels[n]
  save.levels[n] = {
    done: true,
    cows: Math.max(old?.cows ?? 0, r.cows),
    coins: Math.max(old?.coins ?? 0, r.coins),
    points: Math.max(old?.points ?? 0, r.points),
    stars: Math.max(old?.stars ?? 0, r.stars),
  }
  if (n < 16) save.unlocked = Math.max(save.unlocked, n + 1)
  save.last = Math.min(16, n + 1)
  save.record = Math.max(save.record, totalPoints())
  persist()
}
