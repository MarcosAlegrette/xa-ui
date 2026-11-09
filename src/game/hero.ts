// Xa: correr, saltar, doble salto, disparar, escudo, escaleras.
// Física "moderna" a paso fijo (120 Hz, render interpolado):
//  · aceleración / frenado / giro con curvas distintas en el piso y en el aire (control ágil pero preciso)
//  · coyote time (saltar un instante después de salir de un borde) y búfer de salto (apretar justo antes de caer)
//  · salto variable (soltar corta el salto, con altura mínima garantizada) y "colgado" suave en el vértice
//  · doble salto con detección por FLANCO (cada pulsación nueva, nunca la misma que el primer salto),
//    disponible después de caer de un borde, que se repone al tocar el piso, una escalera o pisar un enemigo
//  · corrección de esquinas al chocar la cabeza y subpasos anti-túnel en moveBody.
// Distancias: salto completo ≈ 3,1 tiles de alto y ≈ 4,6 de largo (como la reconstrucción anterior, que es la
// que los mapas originales necesitan); doble salto ≈ +2,6 tiles.
import { audio } from '../core/audio'
import { input } from '../core/input'
import { vibrate } from '../core/touch'
import { F, T, moveBody, type Body } from './level'
import { HERO, animDone, drawAnim, flashAnim, type Anim } from './sprites'
import type { World } from './world'

export const PHYS = {
  run: 180,
  accGround: 2400, decGround: 2900, turnGround: 4600,
  accAir: 1700, decAir: 520, turnAir: 2800,
  gravity: 1150, gravityFall: 1400, apexGravity: 0.55, apexBand: 70, maxFall: 620,
  jump: 480, doubleJump: 440,
  /** Al soltar el botón subiendo: vy *= cut (después de minHold s) */
  jumpCut: 0.45, jumpMinHold: 0.05, djCut: 0.6, djMinHold: 0.09,
  coyote: 0.1, buffer: 0.13,
  climb: 115, shotEvery: 0.2, bulletSpeed: 460, bulletLife: 0.75,
  invuln: 1.5, maxEnergy: 10,
}

export type HeroState = 'entrance' | 'normal' | 'climb' | 'block' | 'hurt' | 'dead' | 'exit'

export class Hero implements Body {
  x = 0; y = 0; vx = 0; vy = 0
  /** Posición del paso anterior (render interpolado) */
  px = 0; py = 0
  bw = 20; bh = 46
  onGround = false
  dir: 1 | -1 = 1
  state: HeroState = 'entrance'
  energy = PHYS.maxEnergy
  /** Puede usar doble salto en este nivel (siempre, salvo con "doble salto clásico" sin yogur) */
  canDouble = true
  usedDouble = false
  invuln = 0
  anim: Anim = HERO.entrance
  t = 0
  shotT = 9
  cool = 0
  coyote = 0
  buffer = 0
  stepT = 0
  stepI = 0
  hurtT = 0
  deadT = 0
  airT = 0
  /** Tiempo desde el último salto (para la altura mínima del salto variable) */
  jumpT = 0
  jumpKind: 0 | 1 | 2 = 0 // 0 = sin salto activo, 1 = salto, 2 = doble
  /** Squash & stretch (1 = normal) */
  sq = 1
  flash = 0
  platform: { dx: number; dy: number } | null = null
  fallStartY = 0

  get box() { return { x: this.x - this.bw / 2, y: this.y - this.bh, w: this.bw, h: this.bh } }
  get alive() { return this.state !== 'dead' }

  spawn(x: number, y: number) {
    this.x = this.px = x; this.y = this.py = y; this.vx = 0; this.vy = 0
    this.state = 'entrance'; this.setAnim(HERO.entrance)
    this.energy = PHYS.maxEnergy; this.invuln = 0; this.dir = 1; this.usedDouble = false; this.jumpKind = 0; this.sq = 1
    audio.fx('init_fall')
  }

  setAnim(a: Anim, restart = false) {
    if (this.anim !== a || restart) { this.anim = a; this.t = 0 }
  }

  hurt(w: World, dmg: number, fromX: number) {
    if (this.state === 'dead' || this.state === 'exit' || this.invuln > 0) return
    this.energy -= dmg
    w.stats.energyLost = 0.4
    w.shake(0.42)
    w.hitStop(0.05)
    vibrate([25, 30, 25])
    this.flash = 0.12
    if (this.energy <= 0) { this.die(w); return }
    audio.fx('hurt')
    this.invuln = PHYS.invuln
    this.state = 'hurt'
    this.hurtT = 0.32
    const away = this.x < fromX ? -1 : 1
    this.vx = away * 210
    this.vy = -260
    this.jumpKind = 0
    this.setAnim(HERO.hurt, true)
  }

  die(w: World) {
    if (this.state === 'dead') return
    this.energy = 0
    this.state = 'dead'
    this.deadT = 0
    this.vx = 0
    this.vy = -260
    this.setAnim(HERO.dead, true)
    audio.fx('player_death')
    w.shake(0.6)
    vibrate(120)
    w.onHeroDeath()
  }

  /** Salto desde el piso / coyote / escalera. */
  private jump(w: World, v: number) {
    this.vy = -v
    this.coyote = 0
    this.buffer = 0
    this.jumpT = 0
    this.jumpKind = 1
    this.onGround = false
    this.sq = 1.18
    this.setAnim(HERO.jump, true)
    audio.fx('jump_hero')
    w.dust(this.x, this.y, 5, 0.8)
  }
  private doubleJump(w: World) {
    this.vy = -PHYS.doubleJump
    this.usedDouble = true
    this.buffer = 0
    this.jumpT = 0
    this.jumpKind = 2
    this.sq = 1.22
    this.setAnim(HERO.jump, true)
    audio.fx('double_jump')
    w.addFx('dj', this.x, this.y + 2)
    w.ring(this.x, this.y, 0xb6f04a)
    vibrate(10)
  }

  update(w: World, dt: number) {
    const map = w.map
    this.px = this.x; this.py = this.y
    this.t += dt
    this.shotT += dt
    this.cool -= dt
    this.jumpT += dt
    if (this.flash > 0) this.flash -= dt
    this.sq += (1 - this.sq) * Math.min(1, dt * 14)
    if (this.invuln > 0) this.invuln -= dt
    const L = input.down('left'), R = input.down('right'), U = input.down('up'), D = input.down('down')
    const shield = input.down('shield')
    // Búfer de salto por flanco: cada pulsación nueva abre una ventana corta
    if (input.pressed('jump')) this.buffer = PHYS.buffer
    else if (this.buffer > 0) this.buffer -= dt
    const jumpDown = input.down('jump') || input.pressed('jump')

    // Arrastre de plataformas móviles
    if (this.platform && this.state !== 'climb') { this.x += this.platform.dx; this.y += this.platform.dy }
    this.platform = null

    switch (this.state) {
      case 'dead': {
        this.deadT += dt
        this.vy = Math.min(this.vy + PHYS.gravity * dt, PHYS.maxFall)
        if (this.deadT > 0.5) this.y += this.vy * dt
        return
      }
      case 'exit': {
        this.vx = 140 * this.dir
        this.vy = Math.min(this.vy + PHYS.gravity * dt, PHYS.maxFall)
        moveBody(map, this, dt)
        this.setAnim(HERO.run)
        return
      }
      case 'entrance': {
        this.vy = Math.min(this.vy + PHYS.gravity * dt, PHYS.maxFall)
        moveBody(map, this, dt)
        if (animDone(this.anim, this.t)) this.state = 'normal'
        return
      }
      case 'climb': return this.updateClimb(w, dt, U, D, L, R)
      default: break
    }

    // Escudo: Abajo en el piso (si no hay escalera para bajar) o el botón de escudo
    if (this.state === 'hurt') {
      this.hurtT -= dt
      if (this.hurtT <= 0 && this.onGround) this.state = 'normal'
      if (this.hurtT <= -0.5) this.state = 'normal'
    } else if (this.onGround && (shield || (D && !this.ladderBelow(w)))) {
      if (this.state !== 'block') { this.state = 'block'; this.setAnim(HERO.block, true); audio.fx(Math.random() < 0.5 ? 's_1' : 's_2') }
    } else if (this.state === 'block') this.state = 'normal'

    // Escaleras: subir (Arriba frente a una) o bajar (Abajo parado encima)
    if (this.state === 'normal') {
      if (U && this.ladderAt(w, this.x, this.y - this.bh / 2)) { this.startClimb(); return }
      if (D && this.onGround && this.ladderBelow(w)) { this.startClimb(); this.y += 4; return }
    }

    // ---- Movimiento horizontal con curvas de aceleración
    const control = this.state === 'normal'
    let ax = control ? input.axisX() : 0
    if (control && ax === 0) ax = (R ? 1 : 0) - (L ? 1 : 0)
    const want = Math.sign(ax)
    if (want) this.dir = want as 1 | -1
    const target = want * PHYS.run * Math.max(0.45, Math.min(1, Math.abs(ax)))
    const g = this.onGround
    let rate: number
    if (!want) rate = g ? PHYS.decGround : this.state === 'hurt' ? 200 : PHYS.decAir
    else if (Math.sign(this.vx) !== want && Math.abs(this.vx) > 1) rate = g ? PHYS.turnGround : PHYS.turnAir
    else rate = Math.abs(target) > Math.abs(this.vx) ? (g ? PHYS.accGround : PHYS.accAir) : (g ? PHYS.decGround : PHYS.decAir)
    if (this.state === 'block') { this.vx = 0 } else {
      const d = target - this.vx, m = rate * dt
      this.vx += Math.abs(d) <= m ? d : Math.sign(d) * m
    }

    // ---- Salto, coyote time y doble salto
    if (g) { this.coyote = PHYS.coyote; this.usedDouble = false; this.airT = 0 } else { this.coyote -= dt; this.airT += dt }
    if (control && this.buffer > 0) {
      if (this.coyote > 0) this.jump(w, PHYS.jump)
      else if (this.canDouble && !this.usedDouble && input.pressed('jump')) this.doubleJump(w)
    }
    // Salto variable: al soltar mientras sube se corta (después de una altura mínima)
    if (this.jumpKind && !jumpDown && this.vy < 0) {
      const minHold = this.jumpKind === 2 ? PHYS.djMinHold : PHYS.jumpMinHold
      if (this.jumpT >= minHold) { this.vy *= this.jumpKind === 2 ? PHYS.djCut : PHYS.jumpCut; this.jumpKind = 0 }
    }
    if (this.vy >= 0) this.jumpKind = 0
    // Gravedad: más suave cerca del vértice si se mantiene el salto, más fuerte al caer
    let grav = this.vy > 0 ? PHYS.gravityFall : PHYS.gravity
    if (jumpDown && Math.abs(this.vy) < PHYS.apexBand && !g) grav *= PHYS.apexGravity
    this.vy = Math.min(this.vy + grav * dt, PHYS.maxFall)

    const wasGround = g
    const vyBefore = this.vy
    if (!g && this.vy < 0) this.fallStartY = this.y
    moveBody(map, this, dt, { corner: 7 })
    if (w.platformUnder(this)) this.onGround = true
    if (!wasGround && this.onGround) this.land(w, vyBefore)
    if (wasGround && !this.onGround && this.vy >= 0) this.fallStartY = this.y

    // ---- Disparo
    if (control && input.down('shoot') && this.cool <= 0) {
      this.cool = PHYS.shotEvery
      this.shotT = 0
      const sx = this.x + this.dir * 24, sy = this.y - (this.onGround ? 27 : 30)
      w.heroShoot(sx, sy, this.dir)
      if (this.onGround && Math.abs(this.vx) < 10) this.setAnim(HERO.shotStand, true)
    }

    // ---- Pasos y polvo al correr
    if (this.onGround && Math.abs(this.vx) > 40) {
      this.stepT -= dt
      if (this.stepT <= 0) {
        this.stepT = 0.27
        this.stepI = (this.stepI + 1) % 4
        audio.fx((['foot_1', 'foot_2', 'foot_3', 'foot_4'] as const)[this.stepI], 0.45)
        w.dust(this.x - this.dir * 8, this.y, 1, 0.5)
      }
      // Derrape al girar
      if (Math.sign(this.vx) !== this.dir && Math.abs(this.vx) > 90 && Math.random() < 0.5) w.dust(this.x, this.y, 1, 0.6)
    }

    // ---- Tiles mortales (pinchos, agua) y caída fuera del mapa
    const bx = this.x - this.bw / 2, by = this.y - this.bh
    if (map.rectFlag(bx + 4, by + 8, this.bw - 8, this.bh - 8, F.KILLING)) this.die(w)
    else if (this.y - this.bh > map.pxH + 8) this.die(w)

    this.pickAnim()
  }

  private land(w: World, vy: number) {
    this.stepT = 0.1
    const k = Math.min(1, vy / PHYS.maxFall)
    if (k > 0.35) {
      this.sq = 1 - 0.28 * k
      w.dust(this.x, this.y, Math.round(3 + k * 6), 0.6 + k)
      if (k > 0.8) w.shake(0.12)
    }
    this.jumpKind = 0
    this.usedDouble = false
  }

  private pickAnim() {
    if (this.state === 'hurt') { this.setAnim(HERO.hurt); return }
    if (this.state === 'block') { this.setAnim(HERO.block); return }
    const shooting = this.shotT < 0.3
    if (!this.onGround) {
      if (shooting) this.setAnim(this.vy < 0 ? HERO.shotJump : HERO.shotFall)
      else if (this.vy < 0) { if (this.anim !== HERO.jump) this.setAnim(HERO.jump) }
      else if (this.anim !== HERO.fall) this.setAnim(HERO.fall)
    } else if (Math.abs(this.vx) > 20) {
      if (shooting) { if (this.anim !== HERO.shotRun) { const t = this.t; this.setAnim(HERO.shotRun); this.t = t } } else if (this.anim !== HERO.run) { const t = this.anim === HERO.shotRun ? this.t : 0; this.setAnim(HERO.run); this.t = t }
    } else if (shooting) { if (this.anim !== HERO.shotStand) this.setAnim(HERO.shotStand, true) }
    else this.setAnim(HERO.stand)
  }

  // ---------------------------------------------------------------- escaleras
  private ladderAt(w: World, x: number, y: number) { return w.map.ladder(Math.floor(x / T), Math.floor(y / T)) }
  private ladderBelow(w: World) {
    const tx = Math.floor(this.x / T), ty = Math.floor((this.y + 2) / T)
    return w.map.ladder(tx, ty) && !w.map.solid(tx, ty)
  }
  private startClimb() {
    this.state = 'climb'
    this.x = Math.floor(this.x / T) * T + T / 2
    this.vx = 0; this.vy = 0
    this.usedDouble = false
    this.jumpKind = 0
    this.setAnim(HERO.climb, true)
  }
  private stairT = 0
  private updateClimb(w: World, dt: number, U: boolean, D: boolean, L: boolean, R: boolean) {
    const map = w.map
    const dy = (D ? 1 : 0) - (U ? 1 : 0)
    if (input.pressed('jump')) {
      this.state = 'normal'
      this.jump(w, PHYS.jump * 0.75)
      this.vx = ((R ? 1 : 0) - (L ? 1 : 0)) * PHYS.run
      this.usedDouble = false
      return
    }
    if (dy) {
      this.stairT -= dt
      if (this.stairT <= 0) { this.stairT = 0.3; audio.fx(Math.random() < 0.5 ? 'stair_1' : 'stair_2', 0.6) }
    }
    const tx = Math.floor(this.x / T)
    const ny = this.y + dy * PHYS.climb * dt
    if (dy < 0) {
      // Llegó arriba: los pies pasaron el borde superior del tile final de la escalera
      const endTile = Math.floor((this.y - 0.5) / T)
      if ((map.flags(tx, endTile) & (F.LADDER_END | F.PLATFORM)) && ny <= endTile * T + 0.5) { this.y = endTile * T; this.state = 'normal'; this.onGround = true; this.setAnim(HERO.climbEnd, true); return }
      if (!map.ladder(tx, Math.floor((ny - 0.5) / T)) && !map.ladder(tx, Math.floor((ny - this.bh / 2) / T))) { this.state = 'normal'; this.vy = -230; return }
      if (!map.rectSolid(this.x - this.bw / 2 + 2, ny - this.bh, this.bw - 4, 1)) this.y = ny
    } else if (dy > 0) {
      const below = Math.floor((ny) / T)
      if (map.solid(tx, below)) { this.y = below * T; this.state = 'normal'; this.onGround = true; return }
      if (!map.ladder(tx, below) && !map.ladder(tx, Math.floor((ny - 8) / T))) { this.state = 'normal'; return }
      this.y = ny
    }
    if (!this.ladderAt(w, this.x, this.y - 0.5) && !this.ladderAt(w, this.x, this.y - this.bh / 2)) { this.state = 'normal'; return }
    // La animación sólo avanza cuando se mueve
    if (!dy) this.t -= dt
    this.setAnim(HERO.climb)
  }

  draw(ctx: CanvasRenderingContext2D, a: number) {
    if (this.invuln > 0 && this.state !== 'dead' && Math.floor(this.invuln * 14) % 2 === 0) return // parpadeo de invulnerabilidad
    const x = Math.round(this.px + (this.x - this.px) * a), y = Math.round(this.py + (this.y - this.py) * a)
    const red = this.state === 'hurt' && this.hurtT > 0.2
    const flip = this.dir < 0 && this.state !== 'climb'
    drawAnim(ctx, this.anim, this.t, x, y, flip, 1, red, this.sq)
    if (this.flash > 0) flashAnim(ctx, this.anim, this.t, x, y, flip, this.flash * 6)
  }
}
