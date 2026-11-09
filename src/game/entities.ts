// Objetos del nivel (los "type" del objectgroup de cada .tmx) y su comportamiento.
// Las propiedades (pLives, pxVel, pDuration, pMinTime...) vienen tal cual de los mapas originales;
// la forma de usarlas está reconstruida a partir de sus nombres, de los carteles y de los gráficos.
import { audio, type Fx } from '../core/audio'
import { drawText } from '../core/font'
import { draw as drawImg } from '../core/assets'
import { T, moveBody, groundAt, type LevelObject } from './level'
import { BOSS, COW, ENEMY, ITEM, PLATFORM, SIGN, animDone, drawAnim, drawFrame, flashAnim, type Anim } from './sprites'
import type { World } from './world'

export interface Rect { x: number; y: number; w: number; h: number }
export const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export abstract class Ent {
  x = 0; y = 0
  /** Posición del paso anterior (render interpolado) */
  px = 0; py = 0
  protected _b: Rect = { x: 0, y: 0, w: 0, h: 0 }
  bw = 26; bh = 26
  /** 'feet' = (x, y) es el apoyo abajo al centro; 'center' = centro del cuerpo */
  anchor: 'feet' | 'center' = 'feet'
  removed = false
  t = 0
  /** Enemigos */
  enemy = false
  lives = 1
  shootable = false
  stompable = false
  harmful = false
  contactDmg = 2
  dying = false
  flash = 0
  team = 1
  points = 200
  /** Se actualiza aunque esté lejos de la cámara */
  always = false
  constructor(readonly o: LevelObject) {}

  /** Caja de colisión (objeto reutilizado: no guardarlo) */
  get box(): Rect {
    const b = this._b
    b.x = this.x - this.bw / 2; b.y = this.anchor === 'feet' ? this.y - this.bh : this.y - this.bh / 2; b.w = this.bw; b.h = this.bh
    return b
  }
  get cx() { return this.x }
  get cy() { return this.anchor === 'feet' ? this.y - this.bh / 2 : this.y }

  update(w: World, dt: number) { void w; this.t += dt; if (this.flash > 0) this.flash -= dt }
  abstract draw(ctx: CanvasRenderingContext2D, w: World): void
  onHero(w: World) { void w }

  /** Recibe un disparo. */
  hit(w: World, dmg = 1, dir = 0) {
    if (this.dying || !this.shootable) return
    this.lives -= dmg
    this.flash = 0.12
    this.knock = dir * 70
    w.sparks(this.cx - dir * 6, this.cy, 4, 0xfff27a)
    if (this.lives <= 0) this.kill(w, false)
    else audio.fx(`m_${1 + Math.floor(Math.random() * 6)}` as Fx, 0.8)
  }
  /** Empujón al recibir un disparo (se aplica en update de los que caminan) */
  knock = 0
  kill(w: World, stomped: boolean) {
    if (this.dying) return
    this.dying = true
    this.removed = true
    audio.fx('enemy_death')
    w.addFx('explosion', this.cx, this.cy)
    w.sparks(this.cx, this.cy, 10, 0x9df03a)
    w.shake(0.16)
    w.addPoints(this.points, this.cx, this.cy - 10)
    // Algunos enemigos explotan en balas al morir por disparo ("¡la explosión podría dañarte!")
    if (!stomped && this.team >= 2) w.pattern(TEAM_PATTERN[this.team] ?? '8_BULLETS', this.cx, this.cy)
  }
}
const TEAM_PATTERN: Record<number, string> = { 2: '8_BULLETS', 3: '3_FALL', 4: '4_FALL', 5: '4_FALL_RAND', 6: '8_BULLETS' }

/** Base de enemigos con animación de la plantilla. */
abstract class Enemy extends Ent {
  anim: Anim
  dir: 1 | -1 = 1
  constructor(o: LevelObject, anim: string) {
    super(o)
    this.enemy = true
    this.harmful = true
    this.shootable = true
    this.anim = ENEMY[anim] ?? ENEMY.DUCK_ROBOT
    this.lives = num(o.p.Lives, 3)
    this.team = num(o.p.Team, 1)
  }
  shootTimer = 0
  nextShot(w: World) {
    void w
    this.shootTimer = rand(num(this.o.p.MinTime, 1.5), num(this.o.p.MaxTime, 3))
  }
  draw(ctx: CanvasRenderingContext2D) {
    const x = Math.round(this.x), y = Math.round(this.y)
    drawAnim(ctx, this.anim, this.t, x, y, this.dir < 0, 1, this.flash > 0.06)
    if (this.flash > 0) flashAnim(ctx, this.anim, this.t, x, y, this.dir < 0, this.flash * 5)
  }
}

// ---------------------------------------------------------------- caminantes
/** Enemy (DUKI, el pato robot) y Ultraton: caminan, giran en paredes y bordes. Android además dispara. */
class Walker extends Enemy {
  vx: number; vy = 0; onGround = false
  shoots: boolean
  constructor(o: LevelObject, anim: string, opts: { stomp: boolean; shoots?: boolean }) {
    super(o, anim)
    this.x = o.x + 16; this.y = o.y + 32
    this.bw = 26; this.bh = anim === 'ULTRATON' || anim === 'ANDROID' ? 54 : 36
    const v = num(o.p.xVel, 120)
    this.vx = Math.abs(v) * 0.6 // velocidad de paseo
    this.dir = v < 0 ? -1 : 1
    this.stompable = opts.stomp
    this.shoots = !!opts.shoots
    this.points = opts.stomp ? 200 : 300
    if (this.shoots) this.nextShot(null as unknown as World)
  }
  shootPose = 0
  private body = { x: 0, y: 0, vx: 0, vy: 0, bw: 0, bh: 0, onGround: false }
  update(w: World, dt: number) {
    super.update(w, dt)
    const body = this.body
    body.x = this.x; body.y = this.y; body.vx = this.dir * this.vx + this.knock; body.vy = this.vy; body.bw = this.bw; body.bh = this.bh; body.onGround = this.onGround
    this.knock *= Math.max(0, 1 - dt * 10)
    if (this.shootPose > 0) { this.shootPose -= dt; body.vx = this.knock }
    body.vy = Math.min(body.vy + 1150 * dt, 560)
    const hit = moveBody(w.map, body, dt)
    this.x = body.x; this.y = body.y; this.vy = body.vy; this.onGround = body.onGround
    if (hit.left) this.dir = 1
    else if (hit.right) this.dir = -1
    else if (this.onGround && this.o.p.CollidesFloor !== false && !groundAt(w.map, this.x + this.dir * (this.bw / 2 + 2), this.y)) this.dir = -this.dir as 1 | -1
    if (this.shoots) {
      this.shootTimer -= dt
      const h = w.hero
      if (this.shootTimer <= 0) {
        this.nextShot(w)
        if (Math.abs(h.x - this.x) < 300 && Math.abs(h.y - this.y) < 120 && h.alive) {
          this.dir = h.x < this.x ? -1 : 1
          this.shootPose = 0.45
          w.enemyShoot(this.x + this.dir * 22, this.y - 38, this.dir * 230, 0)
        }
      }
      this.anim = this.shootPose > 0 ? ENEMY.ANDROID_SHOOT : ENEMY.ANDROID
    }
  }
}

/** Jumper (Cobra) y Jumper2 (CobraTiradora): avanzan a saltos (pyVel = impulso, pyAccel = gravedad). */
class Hopper extends Enemy {
  vx: number; vy = 0; onGround = false; wait = 0
  private body = { x: 0, y: 0, vx: 0, vy: 0, bw: 0, bh: 0, onGround: false }
  shoots: boolean
  constructor(o: LevelObject, anim: string, shoots: boolean) {
    super(o, anim)
    this.x = o.x + 16; this.y = o.y + 32
    this.bw = 26; this.bh = 40
    const v = num(o.p.xVel, -120)
    this.vx = Math.abs(v)
    this.dir = v < 0 ? -1 : 1
    this.stompable = true
    this.shoots = shoots
    this.wait = rand(0.1, 0.8)
    if (shoots) this.nextShot(null as unknown as World)
  }
  update(w: World, dt: number) {
    super.update(w, dt)
    const g = Math.max(150, num(this.o.p.yAccel, 300))
    const jump = Math.max(60, num(this.o.p.yVel, 100))
    if (this.onGround) {
      this.wait -= dt
      if (this.wait <= 0) { this.vy = -jump; this.onGround = false; this.wait = rand(0.25, 0.7); if (w.onScreen(this, 0)) audio.fx('jump_enemy', 0.5) }
    }
    const body = this.body
    body.x = this.x; body.y = this.y; body.vx = (this.onGround ? 0 : this.dir * this.vx) + this.knock; body.vy = this.vy + g * dt; body.bw = this.bw; body.bh = this.bh; body.onGround = this.onGround
    this.knock *= Math.max(0, 1 - dt * 10)
    const hit = moveBody(w.map, body, dt)
    this.x = body.x; this.y = body.y; this.vy = body.vy; this.onGround = body.onGround
    if (hit.left) this.dir = 1
    else if (hit.right) this.dir = -1
    if (this.shoots) {
      this.shootTimer -= dt
      if (this.shootTimer <= 0) {
        this.nextShot(w)
        if (w.onScreen(this, 32)) { const d = w.hero.x < this.x ? -1 : 1; w.enemyShoot(this.x + d * 18, this.y - 26, d * 200, 0) }
      }
    }
    this.t = this.onGround ? 0 : this.t // la animación corre en el aire
  }
  draw(ctx: CanvasRenderingContext2D) {
    // La plantilla mira a la izquierda en COBRA
    const x = Math.round(this.x), y = Math.round(this.y), t = this.onGround ? 0 : this.t
    drawAnim(ctx, this.anim, t, x, y, this.dir > 0, 1, this.flash > 0.06)
    if (this.flash > 0) flashAnim(ctx, this.anim, t, x, y, this.dir > 0, this.flash * 5)
  }
}

// ---------------------------------------------------------------- voladores
/** Bird (platillo), UFO (suelta 4 balas hacia abajo): recorren pxDelta ida y vuelta en pDuration, ondulando pyDelta. */
class Flyer extends Enemy {
  x0: number; y0: number; dx: number; dy: number; period: number; drops: boolean
  constructor(o: LevelObject, anim: string, drops: boolean) {
    super(o, anim)
    this.anchor = 'center'
    this.x0 = this.x = o.x + 16; this.y0 = this.y = o.y + 16
    this.dx = num(o.p.xDelta, 100); this.dy = num(o.p.yDelta, 20); this.period = Math.max(1, num(o.p.Duration, 6))
    this.bw = 40; this.bh = 26
    this.stompable = true
    this.drops = drops
    this.points = drops ? 300 : 200
    if (drops) this.nextShot(null as unknown as World)
    this.always = true
  }
  update(w: World, dt: number) {
    super.update(w, dt)
    const k = (this.t / this.period) * Math.PI * 2
    const nx = this.x0 + this.dx * (0.5 - 0.5 * Math.cos(k))
    this.dir = nx >= this.x ? 1 : -1
    this.x = nx
    this.y = this.y0 + this.dy * Math.sin(k * 2)
    if (this.drops) {
      this.shootTimer -= dt
      if (this.shootTimer <= 0) { this.nextShot(w); if (w.onScreen(this, 0)) w.pattern('4_FALL', this.x, this.y + 10, num(this.o.p.Count, 4)) }
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    const x = Math.round(this.x), y = Math.round(this.y)
    drawAnim(ctx, this.anim, this.t, x, y, false, 1, this.flash > 0.06)
    if (this.flash > 0) flashAnim(ctx, this.anim, this.t, x, y, false, this.flash * 5)
  }
}

/** Double (DOUBLE_SIDE): flota arriba/abajo y dispara a ambos lados. */
class Hover extends Enemy {
  x0: number; y0: number
  constructor(o: LevelObject, anim: string, readonly kind: 'double' | 'down3' | 'smart') {
    super(o, anim)
    this.anchor = 'center'
    this.x0 = this.x = o.x + 16; this.y0 = this.y = o.y + 16
    this.bw = kind === 'down3' ? 30 : 44; this.bh = 28
    this.stompable = kind === 'down3'
    this.points = 300
    this.nextShot(null as unknown as World)
    this.always = true
  }
  burst = 0; burstT = 0
  update(w: World, dt: number) {
    super.update(w, dt)
    const p = Math.max(1, num(this.o.p.Duration, 6))
    const k = (this.t / p) * Math.PI * 2
    if (this.kind === 'smart') {
      // SmartUFO: se acerca al héroe dentro de su zona (pxDelta, pyDelta)
      const h = w.hero
      const tx = Math.max(this.x0 - num(this.o.p.xDelta, 100), Math.min(this.x0 + num(this.o.p.xDelta, 100), h.x))
      const ty = this.y0 + num(this.o.p.yDelta, 60) * Math.sin(k)
      this.x += Math.sign(tx - this.x) * Math.min(Math.abs(tx - this.x), 60 * dt)
      this.y += (ty - this.y) * Math.min(1, dt * 2)
    } else {
      this.y = this.y0 + num(this.o.p.yDelta, 60) * (0.5 - 0.5 * Math.cos(k))
    }
    this.shootTimer -= dt
    if (this.shootTimer <= 0) {
      this.nextShot(w)
      if (w.onScreen(this, 0)) {
        if (this.kind === 'double') w.pattern('DOUBLE_SIDE', this.x, this.y)
        else if (this.kind === 'down3') w.pattern('3_FALL', this.x, this.y + 12)
        else { this.burst = num(this.o.p.Count, 4); this.burstT = 0 }
      }
    }
    if (this.burst > 0) {
      this.burstT -= dt
      if (this.burstT <= 0) { this.burst--; this.burstT = 0.18; w.pattern('TO_HERO', this.x, this.y) }
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    const x = Math.round(this.x), y = Math.round(this.y)
    drawAnim(ctx, this.anim, this.t, x, y, false, 1, this.flash > 0.06)
    if (this.flash > 0) flashAnim(ctx, this.anim, this.t, x, y, false, this.flash * 5)
  }
}

// ---------------------------------------------------------------- torretas
/** Thrower (WALLE), Cannon (CANNON_60, tiro parabólico), FloorCannon (se desliza y dispara hacia arriba),
 *  PiranhaRobot (salta desde abajo y dispara al héroe). */
class Turret extends Enemy {
  x0: number; y0: number
  constructor(o: LevelObject, anim: string, readonly kind: 'thrower' | 'cannon' | 'floor' | 'piranha') {
    super(o, anim)
    this.x0 = this.x = o.x + o.w / 2
    this.y0 = this.y = o.y + o.h
    if (kind === 'thrower') {
      // pxVel > 0 dispara a la derecha; la plantilla apunta a la derecha
      this.dir = num(o.p.xVel, 1) < 0 ? -1 : 1
      this.x = o.x + 16; this.y = o.y + 32
      this.bw = 40; this.bh = 44
    } else if (kind === 'cannon') { this.dir = num(o.p.xVel, 1) < 0 ? -1 : 1; this.x = o.x + 16; this.y = o.y + 32; this.bw = 50; this.bh = 44 }
    else if (kind === 'floor') { this.x = this.x0 = o.x + 16; this.y = o.y + 32; this.bw = 28; this.bh = 24 }
    else { this.x = this.x0 = o.x + 16; this.y = this.y0 = o.y + 32; this.bw = 36; this.bh = 36 }
    this.points = 300
    this.nextShot(null as unknown as World)
  }
  update(w: World, dt: number) {
    super.update(w, dt)
    const p = this.o.p
    if (this.kind === 'floor') {
      const d = Math.max(1, num(p.Duration, 5))
      this.x = this.x0 + num(p.xDelta, 0) * (0.5 - 0.5 * Math.cos((this.t / d) * Math.PI * 2))
    } else if (this.kind === 'piranha') {
      // Sube pyDelta (negativo = hacia arriba) y vuelve a bajar, en pDuration
      const d = Math.max(0.5, num(p.Duration, 1.5))
      const cyc = this.t % (d * 2)
      const k = cyc < d ? Math.sin((cyc / d) * Math.PI) : 0
      this.y = this.y0 + num(p.yDelta, -250) * k
    }
    this.shootTimer -= dt
    if (this.shootTimer <= 0) {
      this.nextShot(w)
      if (!w.onScreen(this, 32)) return
      if (this.kind === 'thrower') {
        const off = num(p.xOffset, this.dir > 0 ? 55 : -20)
        w.enemyShoot(this.o.x + off, this.o.y + num(p.yOffset, 16), num(p.xVel, 350), num(p.yVel, 0))
      } else if (this.kind === 'cannon') w.pattern('PARABLE', this.x + this.dir * 20, this.y - 40, this.dir)
      else if (this.kind === 'floor') w.pattern('UP', this.x, this.y - 24)
      else if (this.y < this.y0 - 20) w.pattern('TO_HERO', this.x, this.y - 20)
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    const flip = this.kind === 'thrower' ? this.dir < 0 : this.kind === 'cannon' ? this.dir < 0 : false
    const x = Math.round(this.x), y = Math.round(this.y)
    drawAnim(ctx, this.anim, this.t, x, y, flip, 1, this.flash > 0.06)
    if (this.flash > 0) flashAnim(ctx, this.anim, this.t, x, y, flip, this.flash * 5)
  }
}

/** Stub (UFO_SPIKY): obstáculo con pinchos, no se puede destruir. */
class Stub extends Enemy {
  constructor(o: LevelObject) {
    super(o, String(o.p.Asset ?? 'UFO_SPIKY'))
    this.anchor = 'center'
    this.x = o.x + 16; this.y = o.y + 16
    this.bw = 26; this.bh = 26
    this.shootable = false
    this.contactDmg = 2
  }
  draw(ctx: CanvasRenderingContext2D) { drawAnim(ctx, this.anim, this.t, Math.round(this.x), Math.round(this.y)) }
}

/** Bomb (BOMBA): mina flotante; al destruirla (o tocarla) estalla en balas según pTeam. */
class Bomb extends Enemy {
  x0: number; y0: number; exploding = -1
  constructor(o: LevelObject) {
    super(o, 'BOMBA')
    this.anchor = 'center'
    this.x0 = this.x = o.x + o.w / 2; this.y0 = this.y = o.y + o.h / 2
    this.bw = 30; this.bh = 30
    this.points = 100
    this.always = false
    this.t = Math.random() * 4
  }
  update(w: World, dt: number) {
    super.update(w, dt)
    if (this.exploding >= 0) { this.exploding += dt; if (animDone(ENEMY.BOMBA_DEATH, this.exploding)) this.removed = true; return }
    const d = Math.max(1, num(this.o.p.Duration, 4)), k = (this.t / d) * Math.PI * 2
    this.x = this.x0 + num(this.o.p.xDelta, 0) * Math.sin(k)
    this.y = this.y0 + num(this.o.p.yDelta, 10) * Math.sin(k * 2)
  }
  kill(w: World) {
    if (this.dying) return
    this.dying = true
    this.harmful = false
    this.exploding = 0
    audio.fx('bullet_cannon')
    w.shake(0.22)
    w.sparks(this.x, this.y, 12, 0xffb040)
    w.addPoints(this.points, this.x, this.y - 10)
    w.pattern(TEAM_PATTERN[this.team] ?? '8_BULLETS', this.x, this.y)
  }
  onHero(w: World) { if (!this.dying) { w.hero.hurt(w, 2, this.x); this.kill(w) } }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.exploding >= 0) drawAnim(ctx, ENEMY.BOMBA_DEATH, this.exploding, Math.round(this.x), Math.round(this.y))
    else drawAnim(ctx, this.anim, 0, Math.round(this.x), Math.round(this.y), false, 1, this.flash > 0)
  }
}

/** Guillotine: la cuchilla baja pyDelta en pDuration, espera pWait y vuelve a subir. */
class Guillotine extends Ent {
  y0: number; off = 0; phase = 0; pt = 0
  constructor(o: LevelObject) {
    super(o)
    this.enemy = true
    this.harmful = true
    this.contactDmg = 4
    this.x = o.x + 16; this.y0 = this.y = o.y
    this.anchor = 'center'
    this.t = 0
  }
  get box(): Rect { const b = this._b; b.x = this.x - 14; b.y = this.y0 + 104 + this.off; b.w = 28; b.h = 50; return b }
  update(w: World, dt: number) {
    const p = this.o.p, dur = Math.max(0.1, num(p.Duration, 0.5)), wait = num(p.Wait, 1), dy = num(p.yDelta, 100)
    this.pt += dt
    if (this.phase === 0 && this.pt > wait) { this.phase = 1; this.pt = 0; if (w.onScreen(this, 64)) audio.fx('guillotina', 0.8) }
    else if (this.phase === 1) { this.off = dy * Math.min(1, this.pt / dur); if (this.pt >= dur) { this.phase = 2; this.pt = 0 } }
    else if (this.phase === 2 && this.pt > wait * 0.5) { this.phase = 3; this.pt = 0 }
    else if (this.phase === 3) { this.off = dy * (1 - Math.min(1, this.pt / (dur * 3))); if (this.pt >= dur * 3) { this.phase = 0; this.pt = 0 } }
  }
  draw(ctx: CanvasRenderingContext2D) { drawAnim(ctx, ENEMY.GUILLOTINE, 0, this.x, this.y0 + this.off - 0) }
}

/** Jefe final: MARCOX. El mapa le da 200 vidas; con el disparo actual eso eran ~5 minutos de pelea, así que
 *  se reequilibra a 120 (≈2-3 minutos para un chico) con tres fases cada vez más agresivas, barra de vida
 *  visible y saltos que sacuden la pantalla. Al morir deja la llave de la puerta final (BOSS_KEY). */
export const BOSS_HP_SCALE = 0.6
export class Boss extends Ent {
  vx = 90; vy = 0; dir: 1 | -1 = -1; active = false; shootTimer = 1.5; pose = 0; deadT = -1; onGround = false
  maxLives: number
  jumpT = 4
  private body = { x: 0, y: 0, vx: 0, vy: 0, bw: 0, bh: 0, onGround: false }
  constructor(o: LevelObject) {
    super(o)
    this.enemy = true; this.harmful = true; this.shootable = true; this.contactDmg = 3
    this.x = o.x + 16; this.y = o.y + 32
    this.bw = 96; this.bh = 160
    this.lives = this.maxLives = Math.round(num(o.p.Lives, 200) * BOSS_HP_SCALE)
    this.points = 10000
    this.always = true
  }
  /** 0, 1 o 2 según la vida que le queda */
  get phase() { const k = this.lives / this.maxLives; return k > 0.66 ? 0 : k > 0.33 ? 1 : 2 }
  update(w: World, dt: number) {
    super.update(w, dt)
    const h = w.hero
    if (this.deadT >= 0) { this.deadT += dt; return }
    if (!this.active) {
      if (Math.abs(h.x - this.x) < 380 && Math.abs(h.y - this.y) < 260) { this.active = true; w.bossStart(this) }
      return
    }
    const ph = this.phase
    if (this.pose > 0) this.pose -= dt
    const want = h.x < this.x ? -1 : 1
    const body = this.body
    body.x = this.x; body.y = this.y; body.bw = this.bw; body.bh = this.bh; body.onGround = this.onGround
    body.vy = Math.min(this.vy + 1150 * dt, 620)
    body.vx = 0
    if (this.pose <= 0 || !this.onGround) {
      // Mantiene distancia: se aleja si el héroe está muy cerca, se acerca si está lejos
      const dist = Math.abs(h.x - this.x)
      if (this.onGround) this.dir = want
      const mv = dist < 120 ? -want : dist > 220 ? want : 0
      body.vx = this.onGround ? mv * this.vx * (1 + ph * 0.2) : this.dir * 150
    }
    // Fases 2 y 3: salta hacia Xa
    this.jumpT -= dt
    if (ph > 0 && this.onGround && this.jumpT <= 0 && h.alive) {
      this.jumpT = rand(3.5, 6) - ph
      body.vy = -520
      this.dir = want
      audio.fx('jump_enemy')
    }
    const was = this.onGround
    moveBody(w.map, body, dt)
    this.x = body.x; this.y = body.y; this.vy = body.vy; this.onGround = body.onGround
    if (!was && this.onGround) { w.shake(0.35); w.dust(this.x - 30, this.y, 5, 1.4); w.dust(this.x + 30, this.y, 5, 1.4); audio.fx('bullet_cannon', 0.6) }
    this.shootTimer -= dt
    if (this.shootTimer <= 0 && h.alive) {
      this.shootTimer = rand(num(this.o.p.MinTime, 0.5), num(this.o.p.MaxTime, 1.5)) * (1 + 0.3 * (1 - ph * 0.5)) * (ph === 2 ? 0.75 : 1)
      this.pose = 0.35
      this.dir = want
      w.pattern('BOSS_BULLETS', this.x + this.dir * 88, this.y - 92, this.dir)
      if (ph === 2 && Math.random() < 0.35) w.pattern('8_BULLETS', this.x, this.y - 100)
    }
  }
  hit(w: World, dmg = 1) {
    if (this.deadT >= 0) return
    if (!this.active) { this.active = true; w.bossStart(this) }
    this.lives -= dmg
    this.flash = 0.1
    w.shake(0.07)
    w.sparks(this.x - this.dir * 20, this.y - 90, 3, 0xfff27a)
    if (this.lives <= 0) {
      this.lives = 0
      this.deadT = 0
      this.harmful = false
      this.shootable = false
      audio.fx('enemy_death')
      w.shake(1)
      w.hitStop(0.25)
      for (let i = 0; i < 8; i++) w.later(i * 0.18, () => { w.addFx('explosion', this.x + rand(-60, 60), this.y - rand(20, 150)); w.shake(0.3); audio.fx('bullet_cannon', 0.7) })
      w.addPoints(this.points, this.x, this.y - 180)
      w.bossDefeated()
    } else if (Math.random() < 0.3) audio.fx(`m_${1 + Math.floor(Math.random() * 6)}` as Fx, 0.8)
  }
  kill() { /* sólo muere a disparos */ }
  get cy() { return this.y - 90 }
  draw(ctx: CanvasRenderingContext2D) {
    const x = Math.round(this.x), y = Math.round(this.y)
    // La plantilla del jefe mira a la derecha
    const flip = this.dir < 0
    if (this.deadT >= 0) {
      if (!animDone(BOSS.dying, this.deadT)) drawAnim(ctx, BOSS.dying, this.deadT, x, y, flip)
      else drawAnim(ctx, BOSS.dead, this.deadT, x, y, flip)
      return
    }
    const a = this.pose > 0 ? BOSS.shoot : BOSS.walk, t = this.pose > 0 ? 0 : this.active ? this.t : 0
    drawAnim(ctx, a, t, x, y, flip, 1, this.flash > 0.05)
    if (this.flash > 0) flashAnim(ctx, a, t, x, y, flip, this.flash * 6)
  }
}

// ---------------------------------------------------------------- objetos
export class Item extends Ent {
  kind: string
  anim: Anim | null
  taken = false
  constructor(o: LevelObject) {
    super(o)
    this.kind = String(o.p.Asset ?? 'COIN')
    this.anim = ITEM[this.kind] ?? null
    this.anchor = 'center'
    if (this.kind === 'ENDING') { this.x = o.x + o.w / 2; this.y = o.y + o.h / 2; this.bw = o.w; this.bh = o.h }
    else { this.x = o.x + 16; this.y = o.y + 16; this.bw = 26; this.bh = 26 }
    this.t = (o.x * 0.013) % 1
  }
  onHero(w: World) {
    if (this.taken) return
    if (this.kind === 'ENDING') { w.levelComplete(); this.taken = true; return }
    this.taken = true
    this.removed = true
    w.collect(this)
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.anim) return
    const bob = this.kind === 'COIN' ? 0 : Math.sin(this.t * 3) * 2.5
    drawAnim(ctx, this.anim, this.t, Math.round(this.x), Math.round(this.y + bob))
    if (this.kind === 'ENERGY_DOUBLE_JUMP' || this.kind === 'LIVES' || this.kind === 'KEY') {
      // Destello que llama la atención sobre los objetos especiales
      const k = 0.5 + 0.5 * Math.sin(this.t * 4)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.25 + 0.25 * k
      const g = ctx.createRadialGradient(this.x, this.y + bob, 2, this.x, this.y + bob, 26)
      g.addColorStop(0, '#fff6b0'); g.addColorStop(1, 'rgba(255,240,120,0)')
      ctx.fillStyle = g
      ctx.fillRect(this.x - 26, this.y + bob - 26, 52, 52)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

export class Cow extends Ent {
  state: 'caged' | 'breaking' | 'free' = 'caged'
  st = 0
  constructor(o: LevelObject) {
    super(o)
    this.x = o.x + 16; this.y = o.y + 32
    this.bw = 50; this.bh = 70
  }
  onHero(w: World) {
    if (this.state !== 'caged') return
    this.state = 'breaking'
    this.st = 0
    audio.fx('gracias_01')
    w.cowRescued(this)
  }
  update(w: World, dt: number) {
    super.update(w, dt)
    this.st += dt
    if (this.state === 'breaking' && animDone(COW.breaking, this.st)) { this.state = 'free'; this.st = 0 }
    if (this.state === 'free' && animDone(COW.rescued, this.st)) this.removed = true
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.state === 'caged') drawAnim(ctx, COW.caged, 0, this.x, this.y)
    else if (this.state === 'breaking') drawAnim(ctx, COW.breaking, this.st, this.x, this.y)
    else drawAnim(ctx, COW.rescued, this.st, this.x, this.y - this.st * 40, false, Math.max(0, 1 - this.st / 1.2))
  }
}

export class Sign extends Ent {
  text: string
  reading = false
  constructor(o: LevelObject) {
    super(o)
    this.x = o.x + 16; this.y = o.y + 32
    this.bw = 40; this.bh = 60
    this.text = String(o.p.text ?? '')
  }
  onHero(w: World) { w.showSign(this) }
  draw(ctx: CanvasRenderingContext2D) {
    const [sx, sy, sw, sh] = SIGN.info
    drawImg(ctx, 'sprites/signs', sx, sy, sw, sh, Math.round(this.x - sw / 2), Math.round(this.y - sh + 2), sw, sh)
  }
}

export class SavePoint extends Ent {
  active = false
  constructor(o: LevelObject) {
    super(o)
    this.x = o.x + 16; this.y = o.y + 32
    this.bw = 40; this.bh = 90
  }
  onHero(w: World) {
    if (this.active) return
    this.active = true
    this.glow = 1.2
    w.checkpoint(this)
  }
  glow = 0
  update(w: World, dt: number) { super.update(w, dt); if (this.glow > 0) this.glow -= dt }
  draw(ctx: CanvasRenderingContext2D) {
    // Estatua dorada de Xa (save_tile.png): 2 cuadros; brilla (SHINE) cuando está activada
    const f = this.active && Math.floor(this.t * 4) % 2 === 1 ? 1 : 0
    if (this.glow > 0) {
      // Columna de luz al activarse
      const k = this.glow / 1.2
      const g = ctx.createLinearGradient(0, this.y - 220, 0, this.y)
      g.addColorStop(0, 'rgba(255,240,140,0)'); g.addColorStop(1, `rgba(255,240,140,${0.55 * k})`)
      ctx.fillStyle = g
      ctx.fillRect(this.x - 26 * (0.6 + k * 0.4), this.y - 220, 52 * (0.6 + k * 0.4), 220)
    }
    drawFrame(ctx, 'sprites/save', [f ? 61 : 1, 1, 57, 102, 28, 100], Math.round(this.x), Math.round(this.y))
  }
}

export class Door extends Ent {
  open = 0 // 0 cerrada → 1 abierta (sube)
  opening = false
  tiles: number[] = []
  constructor(o: LevelObject, w: World) {
    super(o)
    this.x = o.x; this.y = o.y
    this.bw = o.w; this.bh = o.h
    this.always = true
    const map = w.map
    for (let ty = Math.floor(o.y / T); ty < Math.ceil((o.y + o.h) / T); ty++)
      for (let tx = Math.floor(o.x / T); tx < Math.ceil((o.x + o.w) / T); tx++) { const i = ty * map.w + tx; this.tiles.push(i); map.solidOverride.set(i, true) }
  }
  get box(): Rect { const b = this._b; b.x = this.o.x - 6; b.y = this.o.y; b.w = this.o.w + 12; b.h = this.o.h; return b }
  onHero(w: World) {
    if (this.opening) return
    const need = String(this.o.p.RequiredItem ?? 'KEY')
    if (need === 'BOSS_KEY' ? w.stats.bossKey : w.stats.keys >= num(this.o.p.RequiredCount, 1)) {
      if (need !== 'BOSS_KEY') w.stats.keys -= num(this.o.p.RequiredCount, 1)
      this.opening = true
      audio.fx('door_1')
      w.shake(0.15)
    }
  }
  update(w: World, dt: number) {
    if (this.opening && this.open < 1) {
      this.open = Math.min(1, this.open + dt / 0.8)
      if (this.open >= 1) for (const i of this.tiles) w.map.solidOverride.set(i, false)
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.open >= 1) return
    const h = 128 * (1 - this.open)
    if (h > 0.5) drawImg(ctx, 'sprites/gate', 0, 128 - h, 32, h, this.o.x, this.o.y, 32, h)
  }
}

/** PlatformInterp: va de su posición a (pxDest, pyDest) en pDuration, espera pWait y vuelve. */
export class Platform extends Ent {
  x0: number; y0: number; dx = 0; dy = 0; look: string
  constructor(o: LevelObject, look: string) {
    super(o)
    this.x0 = this.x = o.x; this.y0 = this.y = o.y
    this.bw = o.w; this.bh = 16
    this.look = look
    this.always = true
  }
  get box(): Rect { const b = this._b; b.x = this.x; b.y = this.y; b.w = this.bw; b.h = this.bh; return b }
  update(w: World, dt: number) {
    void w
    this.t += dt
    const p = this.o.p, d = Math.max(0.2, num(p.Duration, 2)), wait = num(p.Wait, 0.5)
    const cyc = 2 * (d + wait), c = this.t % cyc
    let k: number
    if (c < wait) k = 0
    else if (c < wait + d) k = (c - wait) / d
    else if (c < 2 * wait + d) k = 1
    else k = 1 - (c - 2 * wait - d) / d
    k = k * k * (3 - 2 * k)
    const nx = this.x0 + num(p.xDest, 0) * k, ny = this.y0 + num(p.yDest, 0) * k
    this.dx = nx - this.x; this.dy = ny - this.y
    this.x = nx; this.y = ny
  }
  draw(ctx: CanvasRenderingContext2D) {
    const [sx, sy, sw, sh] = PLATFORM[this.look] ?? PLATFORM.GREEN
    const n = Math.max(1, Math.round(this.bw / 64))
    for (let i = 0; i < n; i++) drawImg(ctx, 'sprites/platforms', sx, sy, sw, sh, Math.round(this.x + i * 64 - 1), Math.round(this.y - 2), sw, sh)
  }
}

/** Plataformas por nivel (el exe elegía el aspecto según el nivel; reconstruido por el tema de cada mapa). */
const PLATFORM_LOOK: Record<number, string> = { 3: 'GREEN', 5: 'BROWN', 6: 'CAVE', 9: 'CITY', 10: 'CITY', 11: 'SKYBLUE', 12: 'ICE', 13: 'MOON', 14: 'MOON', 15: 'SPACE', 16: 'SPACE' }

/** Crea la entidad de un objeto del mapa. */
export function createEntity(o: LevelObject, w: World): Ent | null {
  const p = o.p
  switch (o.type) {
    case 'Enemy': return new Walker(o, String(p.Anim ?? 'DUCK_ROBOT'), { stomp: true })
    case 'Ultraton': return new Walker(o, 'ULTRATON', { stomp: false })
    case 'Android': return new Walker(o, 'ANDROID', { stomp: true, shoots: true })
    case 'Jumper': return new Hopper(o, 'COBRA', false)
    case 'Jumper2': return new Hopper(o, 'COBRA_SHOOT', true)
    case 'Bird': return new Flyer(o, 'FLYING_SAUCER', false)
    case 'UFO': return new Flyer(o, 'UFO', true)
    case 'Double': return new Hover(o, 'DOUBLE_SIDE', 'double')
    case 'SmartUFO': return new Hover(o, 'DOUBLE_SIDE', 'smart')
    case 'Down3': return new Hover(o, 'UFO_3', 'down3')
    case 'Thrower': return new Turret(o, 'WALLE', 'thrower')
    case 'Cannon': return new Turret(o, 'CANNON_60', 'cannon')
    case 'FloorCannon': return new Turret(o, 'FLOOR_CANNON', 'floor')
    case 'PiranhaRobot': return new Turret(o, 'UFO_CANNON', 'piranha')
    case 'Stub': return new Stub(o)
    case 'Bomb': return new Bomb(o)
    case 'Guillotine': return new Guillotine(o)
    case 'Boss': return new Boss(o)
    case 'Item': return new Item(o)
    case 'Cow': return new Cow(o)
    case 'Information': return new Sign(o)
    case 'SavePoint': return new SavePoint(o)
    case 'Door': return new Door(o, w)
    case 'PlatformInterp': return new Platform(o, PLATFORM_LOOK[w.level.n] ?? 'GREEN')
    default: return null
  }
}

// ---------------------------------------------------------------- puntos flotantes
export class FloatText {
  t = 0
  constructor(readonly text: string, public x: number, public y: number) {}
  draw(ctx: CanvasRenderingContext2D) {
    drawText(ctx, this.text, Math.round(this.x), Math.round(this.y - this.t * 30), { align: 'center', scale: 0.6, alpha: Math.max(0, 1 - this.t / 0.9), font: 'fuente_blanca' })
  }
}
