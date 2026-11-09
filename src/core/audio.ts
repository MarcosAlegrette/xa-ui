// Música y efectos originales, recodificados a Opus/WebM (MP3 de respaldo donde no hay Opus).
// La música se transmite (no se descarga entera) con un único <audio> conectado a WebAudio, así el
// volumen funciona también en iOS; los efectos se decodifican a buffers y se precargan.
import { audioHash } from './assets'

const probe = typeof Audio !== 'undefined' ? new Audio() : null
const EXT = probe && probe.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'mp3'
const url = (dir: string, name: string, ext = EXT) => `/assets/audio/${dir}/${name}.${ext}?v=${audioHash(`${dir}/${name}`)}`
export const audioUrls = (names: { music: string[]; fx: string[] }) => [...names.music.map((n) => url('music', n)), ...names.fx.map((n) => url('fx', n))]

export type Music = 'xa_menu' | 'xa_intro' | 'xa_1' | 'xa_2' | 'xa_3' | 'xa_4' | 'xa_boss' | 'xa_win' | 'lose' | 'intro_piano'
export const ALL_MUSIC: Music[] = ['xa_menu', 'xa_intro', 'xa_1', 'xa_2', 'xa_3', 'xa_4', 'xa_boss', 'xa_win', 'lose', 'intro_piano']
export type Fx =
  | 'bullet_cannon' | 'bullet_wall_1' | 'bullet_wall_2' | 'bullet' | 'click' | 'coin' | 'door_1' | 'double_jump' | 'end_level'
  | 'enemy_death' | 'enemy_shot' | 'energy' | 'extra_life' | 'foot_1' | 'foot_2' | 'foot_3' | 'foot_4' | 'gracias_01' | 'guillotina'
  | 'hurt' | 'info' | 'init_fall' | 'jump_enemy' | 'jump_hero' | 'key' | 'm_1' | 'm_2' | 'm_3' | 'm_4' | 'm_5' | 'm_6'
  | 'player_death' | 'powerup' | 's_1' | 's_2' | 'save' | 'stair_1' | 'stair_2'
export const ALL_FX: Fx[] = ['bullet_cannon', 'bullet_wall_1', 'bullet_wall_2', 'bullet', 'click', 'coin', 'door_1', 'double_jump', 'end_level',
  'enemy_death', 'enemy_shot', 'energy', 'extra_life', 'foot_1', 'foot_2', 'foot_3', 'foot_4', 'gracias_01', 'guillotina',
  'hurt', 'info', 'init_fall', 'jump_enemy', 'jump_hero', 'key', 'm_1', 'm_2', 'm_3', 'm_4', 'm_5', 'm_6',
  'player_death', 'powerup', 's_1', 's_2', 'save', 'stair_1', 'stair_2']

const ONE_SHOT: Music[] = ['lose', 'xa_win', 'intro_piano']
const vol = { music: 0.7, fx: 0.85 }
let unlocked = false
let el: HTMLAudioElement | null = null
let wanted: Music | null = null
let current: Music | null = null
let paused = false
let ctx: AudioContext | null = null
let fxGain: GainNode | null = null
let musicGain: GainNode | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
const lastPlayed = new Map<string, number>()

function setMusicLevel(v: number, ms: number) {
  if (musicGain && ctx) {
    const g = musicGain.gain, t = ctx.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(v, t + ms / 1000)
  } else if (el) el.volume = Math.max(0, Math.min(1, v))
}

function startMusic() {
  if (!unlocked || wanted === current) return
  current = wanted
  if (!el) return
  const a = el
  setMusicLevel(0, 250)
  const token = wanted
  setTimeout(() => {
    if (current !== token) return
    if (!token || vol.music <= 0) { a.pause(); return }
    a.src = url('music', token)
    a.loop = !ONE_SHOT.includes(token)
    a.currentTime = 0
    if (!paused) a.play().then(() => setMusicLevel(vol.music, 450)).catch(() => { if (current === token) current = null })
  }, el.paused ? 0 : 260)
}

function load(name: string) {
  let p = buffers.get(name)
  if (!p && ctx) {
    const c = ctx
    const get = (ext: string) => fetch(url('fx', name, ext)).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer() }).then((b) => c.decodeAudioData(b))
    p = get(EXT).catch(() => (EXT === 'mp3' ? null : get('mp3').catch(() => null)))
    buffers.set(name, p)
  }
  return p ?? Promise.resolve(null)
}

export const audio = {
  /** Los navegadores sólo dejan sonar audio después de la primera interacción. */
  unlock() {
    if (unlocked) { if (ctx?.state === 'suspended') void ctx.resume(); return }
    unlocked = true
    el = new Audio()
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ latencyHint: 'interactive' })
      fxGain = ctx.createGain()
      fxGain.gain.value = vol.fx
      fxGain.connect(ctx.destination)
      musicGain = ctx.createGain()
      musicGain.gain.value = 0
      ctx.createMediaElementSource(el).connect(musicGain).connect(ctx.destination)
      for (const f of ['jump_hero', 'bullet', 'coin', 'click', 'hurt', 'enemy_death', 'double_jump', 'm_1', 'm_2', 'm_3', 'enemy_shot', 'jump_enemy', 'foot_1', 'foot_2', 'foot_3', 'foot_4'] as Fx[]) void load(f)
    } catch { ctx = null; musicGain = null }
    startMusic()
  },
  music(track: Music | null) {
    wanted = track
    startMusic()
  },
  get track() { return wanted },
  preload(names: Fx[]) { for (const n of names) void load(n) },
  fx(name: Fx, gain = 1, rate = 1) {
    if (!unlocked || !ctx || !fxGain || vol.fx <= 0) return
    const now = performance.now()
    if (now - (lastPlayed.get(name) ?? 0) < 40) return // evita apilar el mismo sonido en el mismo cuadro
    lastPlayed.set(name, now)
    if (ctx.state === 'suspended') void ctx.resume()
    void load(name).then((buf) => {
      if (!buf || !ctx || !fxGain) return
      const src = ctx.createBufferSource(), g = ctx.createGain()
      src.buffer = buf
      src.playbackRate.value = rate
      g.gain.value = gain
      src.connect(g).connect(fxGain)
      src.start()
    })
  },
  setVolumes(o: { music: number; fx: number }) {
    const wasOff = vol.music <= 0
    vol.music = o.music
    vol.fx = o.fx
    if (fxGain) fxGain.gain.value = o.fx
    if (!unlocked) return
    if (o.music <= 0) { setMusicLevel(0, 150); el?.pause() }
    else if (wasOff) { current = null; startMusic() }
    else setMusicLevel(o.music, 80)
  },
  pause(p: boolean) {
    paused = p
    if (!el || !current) return
    if (p) { setMusicLevel(vol.music * 0.25, 200) }
    else { setMusicLevel(vol.music, 300); if (el.paused && vol.music > 0) void el.play().catch(() => {}) }
  },
  /** Silencia todo cuando la pestaña no se ve. */
  suspend(s: boolean) {
    if (!el) return
    if (s) { el.pause(); void ctx?.suspend() }
    else { void ctx?.resume(); if (current && vol.music > 0) void el.play().catch(() => {}) }
  },
  get unlocked() { return unlocked },
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => audio.suspend(document.hidden))
