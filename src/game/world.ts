// Una partida dentro de un nivel: mapa, Xa, objetos, disparos, cámara, HUD y reglas
// (vidas, energía, monedas, vacas, llaves, puntos de salvado, fin de nivel).
// Rendimiento: tiles pre-renderizados por bloques (tilecache), pools de balas/efectos/partículas,
// sin asignaciones por cuadro en el bucle caliente, sólo se actualiza/dibuja lo cercano a la cámara.
// Render interpolado entre pasos fijos (posición anterior → actual) para que se vea suave a cualquier Hz.
import { audio, type Music } from '../core/audio'
import { draw as drawImg, tex } from '../core/assets'
import { drawText } from '../core/font'
import { view } from '../core/stage'
import { save, persist } from '../core/save'
import { Hero, PHYS } from './hero'
import { T, TileMap, type LevelData } from './level'
import { Boss, Cow, Door, Ent, FloatText, Item, Platform, SavePoint, Sign, createEntity, overlap, type Rect } from './entities'
import { BLAST, DOUBLE_JUMP_FX, EXPLOSION, HUD, PICKUP, SPARK, animDone, drawAnim, energyFrame, type Anim } from './sprites'
import { P, particles } from './particles'
import { TileLayer } from './tilecache'
import { vibrate } from '../core/touch'
import { input } from '../core/input'

const STEP = 1 / 120
interface Bullet { x: number; y: number; vx: number; vy: number; g: number; life: number; hero: boolean }
interface Effect { anim: Anim; x: number; y: number; t: number; flip: boolean }

export type WorldEvent = 'complete' | 'gameover'

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export class World {
  map: TileMap
  tiles: TileLayer
  hero = new Hero()
  ents: Ent[] = []
  platforms: Platform[] = []
  // Pools: los primeros n están vivos
  bullets: Bullet[] = []
  nb = 0
  fx: Effect[] = []
  nfx = 0
  texts: FloatText[] = []
  cam = { x: 0, y: 0, px: 0, py: 0, look: 0, trauma: 0, sx: 0, sy: 0 }
  stats = { coins: 0, coinsTotal: 0, points: 0, cows: 0, cowsTotal: 0, keys: 0, hasKeys: false, bossKey: false, energyLost: 0 }
  /** Valores mostrados en el HUD (suben suavemente) */
  hud = { points: 0, coinPop: 0, cowPop: 0, keyPop: 0, djPop: 0, livesPop: 0 }
  respawn = { x: 0, y: 0 }
  sign: Sign | null = null
  signT = 0
  savingT = 0
  deadT = 0
  doneT = -1
  music: Music
  boss: Boss | null = null
  bossBar = 0
  event: WorldEvent | null = null
  time = 0
  stopT = 0
  private timers: { t: number; fn: () => void }[] = []
  private removed = false

  constructor(readonly level: LevelData) {
    this.map = new TileMap(level)
    this.tiles = new TileLayer(this.map, level.tileset, level.tilesetCols)
    this.music = level.music as Music
    for (const o of level.objects) {
      if (o.type === 'Hero') { this.respawn = { x: o.x + 16, y: o.y + 32 }; continue }
      const e = createEntity(o, this)
      if (!e) continue
      e.px = e.x; e.py = e.y
      if (e instanceof Platform) this.platforms.push(e)
      else this.ents.push(e)
      if (e instanceof Cow) this.stats.cowsTotal++
      if (e instanceof Item && e.kind === 'COIN') this.stats.coinsTotal++
      if (e instanceof Item && e.kind === 'KEY') this.stats.hasKeys = true
      if (e instanceof Door) this.stats.hasKeys = true
    }
    // Orden de dibujo: carteles y estatuas atrás, después objetos, enemigos adelante
    const z = (e: Ent) => (e instanceof Sign || e instanceof SavePoint ? 0 : e instanceof Cow || e instanceof Door ? 1 : e instanceof Item ? 2 : 3)
    this.ents.sort((a, b) => z(a) - z(b))
    this.hero.canDouble = !save.options.classicDoubleJump
    particles.clear()
    this.spawnHero()
    this.snapCamera()
    audio.music(this.music)
  }

  // ---------------------------------------------------------------- ciclo
  spawnHero() {
    const h = this.hero
    const keep = h.canDouble
    h.spawn(this.respawn.x, this.respawn.y)
    h.canDouble = keep || !save.options.classicDoubleJump
  }

  /** ¿La caja (con margen) está cerca de la vista? Sin asignaciones. */
  near(x: number, y: number, w: number, h: number, margin: number) {
    const c = this.cam
    return x + w > c.x - margin && x < c.x + view.w + margin && y + h > c.y - margin && y < c.y + view.h + margin
  }
  onScreen(e: Ent | Rect, margin: number) {
    const b = e instanceof Ent ? e.box : e
    return this.near(b.x, b.y, b.w, b.h, margin)
  }

  later(t: number, fn: () => void) { this.timers.push({ t, fn }) }
  hitStop(t: number) { this.stopT = Math.max(this.stopT, t) }
  shake(k: number) { this.cam.trauma = Math.min(1, this.cam.trauma + k) }

  update(dt: number) {
    this.time += dt
    // Juice: congelamiento breve en impactos fuertes
    if (this.stopT > 0) { this.stopT -= dt; this.cam.px = this.cam.x; this.cam.py = this.cam.y; this.hero.px = this.hero.x; this.hero.py = this.hero.y; return }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]
      tm.t -= dt
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn() }
    }
    const h = this.hero
    for (const p of this.platforms) { p.px = p.x; p.py = p.y; p.update(this, dt) }
    const prevBottom = h.y
    h.update(this, dt)
    if (this.signT > 0) this.signT -= dt
    if (this.savingT > 0) this.savingT -= dt
    if (this.stats.energyLost > 0) this.stats.energyLost -= dt

    // Objetos activos: cerca de la cámara (o los que siempre se mueven)
    const hb = h.box
    const ents = this.ents
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]
      e.px = e.x; e.py = e.y
      if (e.removed) continue
      const b = e.box
      if (!this.near(b.x, b.y, b.w, b.h, e.always ? 900 : 260)) continue
      e.update(this, dt)
      if (e.removed) { this.removed = true; continue }
      if (!h.alive || h.state === 'exit') continue
      if (!overlap(hb, e.box)) continue
      if (e.enemy) {
        if (e.dying) continue
        const eb = e.box
        if (e.stompable && h.vy > 0 && prevBottom <= eb.y + 12 && h.state !== 'climb') {
          e.kill(this, true)
          h.vy = -(input.down('jump') ? 440 : 320)
          h.jumpKind = 1; h.jumpT = 0
          h.usedDouble = false
          h.sq = 1.2
          this.hitStop(0.035)
          audio.fx('jump_enemy')
          vibrate(12)
        } else if (e.harmful) {
          e.onHero(this)
          if (h.invuln <= 0) h.hurt(this, e.contactDmg, e.cx)
        }
      } else e.onHero(this)
      if (e.removed) this.removed = true
    }
    if (this.removed) {
      let j = 0
      for (let i = 0; i < ents.length; i++) if (!ents[i].removed) ents[j++] = ents[i]
      ents.length = j
      this.removed = false
    }
    if (this.sign && !overlap(hb, this.sign.box)) this.sign = null

    this.updateBullets(dt)
    for (let i = 0; i < this.nfx; i++) {
      const f = this.fx[i]
      f.t += dt
      if (animDone(f.anim, f.t)) { this.nfx--; this.fx[i] = this.fx[this.nfx]; this.fx[this.nfx] = f; i-- }
    }
    particles.update(dt)
    if (this.texts.length) {
      for (const t of this.texts) t.t += dt
      if (this.texts[0].t >= 0.9) this.texts = this.texts.filter((t) => t.t < 0.9)
    }
    this.updateHud(dt)

    // Muerte → reaparecer en el último punto de salvado o fin del juego
    if (!h.alive) {
      this.deadT += dt
      if (this.deadT > 2.2) {
        this.deadT = 0
        if (save.lives <= 0) { this.event = 'gameover'; return }
        this.nb = 0
        this.spawnHero()
        this.snapCamera()
        this.tiles.warm(this.cam.x, this.cam.y, view.w, view.h)
      }
    }
    if (this.doneT >= 0) {
      this.doneT += dt
      if (this.doneT > 2.4) this.event = 'complete'
    }
    this.updateCamera(dt)
  }

  private updateHud(dt: number) {
    const u = this.hud
    const d = this.stats.points - u.points
    u.points = Math.abs(d) < 1 ? this.stats.points : u.points + d * Math.min(1, dt * 9) + Math.sign(d) * 0.5
    for (const k of ['coinPop', 'cowPop', 'keyPop', 'djPop', 'livesPop'] as const) if (u[k] > 0) u[k] = Math.max(0, u[k] - dt * 3)
    if (this.boss) {
      const target = this.boss.lives / this.boss.maxLives
      this.bossBar += (target - this.bossBar) * Math.min(1, dt * 6)
    }
  }

  // ---------------------------------------------------------------- cámara
  // Zona muerta horizontal + anticipación hacia donde mira/corre Xa; vertical "pegada al piso"
  // (sólo se reacomoda al aterrizar o si Xa se sale de una banda), sacudida por "trauma".
  private clampCam() {
    const c = this.cam, mw = this.map.pxW, mh = this.map.pxH
    c.x = mw <= view.w ? (mw - view.w) / 2 : Math.max(0, Math.min(mw - view.w, c.x))
    c.y = mh <= view.h ? (mh - view.h) / 2 : Math.max(0, Math.min(mh - view.h, c.y))
  }
  snapCamera() {
    const h = this.hero, c = this.cam
    c.look = h.dir * 50
    c.x = h.x - view.w / 2 + c.look
    c.y = h.y - view.h * 0.62
    this.clampCam()
    c.px = c.x; c.py = c.y
  }
  private updateCamera(dt: number) {
    const c = this.cam, h = this.hero
    c.px = c.x; c.py = c.y
    c.trauma = Math.max(0, c.trauma - dt * 1.7)
    const s = c.trauma * c.trauma
    c.sx = s * 9 * (Math.random() * 2 - 1)
    c.sy = s * 7 * (Math.random() * 2 - 1)
    if (!h.alive) return
    // Horizontal
    const lookTarget = h.state === 'climb' ? 0 : Math.max(-90, Math.min(90, h.dir * 55 + h.vx * 0.2))
    c.look += (lookTarget - c.look) * Math.min(1, dt * 2.6)
    const fx = h.x + c.look - view.w / 2
    const dz = 20
    let tx = c.x
    if (fx > c.x + dz) tx = fx - dz
    else if (fx < c.x - dz) tx = fx + dz
    c.x += (tx - c.x) * Math.min(1, dt * 9)
    // Vertical
    const anchor = h.y - view.h * 0.62
    const grounded = h.onGround || h.state === 'climb'
    const sy = h.y - c.y // posición en pantalla de los pies
    let ty = c.y
    if (grounded) ty = anchor
    else if (sy < view.h * 0.32) ty = h.y - view.h * 0.32
    else if (sy > view.h * 0.78) ty = h.y - view.h * 0.78
    if (h.vy > 400 && !grounded) ty = Math.max(ty, h.y - view.h * 0.5) // cayendo rápido: mirar hacia abajo
    const k = grounded ? 5 : Math.abs(ty - c.y) > 0 ? 12 : 4
    c.y += (ty - c.y) * Math.min(1, dt * k)
    this.clampCam()
  }
  /** Punto del héroe en pantalla (para la transición "iris") */
  heroOnScreen() { return { x: this.hero.x - this.cam.x, y: this.hero.y - 24 - this.cam.y } }

  // ---------------------------------------------------------------- plataformas móviles
  platformUnder(h: Hero): boolean {
    if (h.vy < 0) return false
    for (const p of this.platforms) {
      if (h.x + h.bw / 2 - 2 < p.x || h.x - h.bw / 2 + 2 > p.x + p.bw) continue
      if (h.y >= p.y - 2 && h.y <= p.y + 10) {
        h.y = p.y
        h.vy = 0
        h.platform = p
        return true
      }
    }
    return false
  }

  // ---------------------------------------------------------------- disparos (pool)
  private bullet(): Bullet {
    let b = this.bullets[this.nb]
    if (!b) { b = { x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, hero: false }; this.bullets.push(b) }
    this.nb++
    return b
  }
  private kill(i: number) {
    const last = --this.nb
    const b = this.bullets[i]
    this.bullets[i] = this.bullets[last]
    this.bullets[last] = b
  }
  heroShoot(x: number, y: number, dir: number) {
    let mine = 0
    for (let i = 0; i < this.nb; i++) if (this.bullets[i].hero) mine++
    if (mine >= 4) return
    const b = this.bullet()
    b.x = x; b.y = y; b.vx = dir * PHYS.bulletSpeed; b.vy = 0; b.g = 0; b.life = PHYS.bulletLife; b.hero = true
    this.addAnim(BLAST.heroMuzzle, x + dir * 4, y, dir < 0)
    audio.fx('bullet', 0.7)
  }
  enemyShoot(x: number, y: number, vx: number, vy: number, g = 0) {
    const b = this.bullet()
    b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.g = g; b.life = 4; b.hero = false
    if (this.near(x - 8, y - 8, 16, 16, 0)) audio.fx('enemy_shot', 0.6)
  }
  /** Patrones de balas enemigas (nombres del ejecutable: 8_BULLETS, 3_FALL, 4_FALL, TO_HERO, PARABLE...). */
  pattern(name: string, x: number, y: number, arg = 1) {
    const h = this.hero
    const aim = (spd: number, spread = 0) => {
      const a = Math.atan2(h.y - 28 - y, h.x - x) + spread
      this.enemyShoot(x, y, Math.cos(a) * spd, Math.sin(a) * spd)
    }
    switch (name) {
      case '8_BULLETS': for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; this.enemyShoot(x, y, Math.cos(a) * 170, Math.sin(a) * 170) } break
      case '3_FALL': for (const vx of [-70, 0, 70]) this.enemyShoot(x, y, vx, 60, 380); break
      case '4_FALL': { const n = Math.max(1, arg); for (let i = 0; i < n; i++) this.enemyShoot(x, y, (i - (n - 1) / 2) * 60, -120, 420) } break
      case '4_FALL_RAND': for (let i = 0; i < 4; i++) this.enemyShoot(x, y, (Math.random() - 0.5) * 260, -150 - Math.random() * 150, 420); break
      case 'DOUBLE_SIDE': this.enemyShoot(x - 30, y, -200, 0); this.enemyShoot(x + 30, y, 200, 0); break
      case 'TO_HERO': aim(210); break
      case 'PARABLE': { const a = (60 * Math.PI) / 180, s = 330; this.enemyShoot(x, y, Math.cos(a) * s * arg, -Math.sin(a) * s, 400); audio.fx('bullet_cannon', 0.6) } break
      case 'UP': this.enemyShoot(x, y, (Math.random() - 0.5) * 120, -380, 420); break
      case 'BOSS_BULLETS': {
        for (const s of [-0.18, 0, 0.18]) aim(250, s)
        if (Math.random() < 0.35) for (let i = 0; i < 4; i++) this.enemyShoot(x, y - 20, arg * (60 + i * 55), -260, 420)
        audio.fx('bullet_cannon', 0.7)
      } break
    }
  }
  private updateBullets(dt: number) {
    const h = this.hero
    const hb = h.box
    const map = this.map
    for (let i = 0; i < this.nb; i++) {
      const b = this.bullets[i]
      b.life -= dt
      b.vy += b.g * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.life <= 0 || b.y > map.pxH + 64 || b.x < -64 || b.x > map.pxW + 64) { this.kill(i--); continue }
      if (map.solid(Math.floor(b.x / T), Math.floor(b.y / T))) {
        this.addAnim(b.hero ? BLAST.heroWall : BLAST.enemyWall, b.x, b.y, b.vx > 0)
        if (this.near(b.x, b.y, 1, 1, 0)) audio.fx(Math.random() < 0.5 ? 'bullet_wall_1' : 'bullet_wall_2', 0.5)
        this.kill(i--)
        continue
      }
      const bx = b.x - 5, by = b.y - 5
      if (b.hero) {
        let hit = false
        for (const e of this.ents) {
          if (!e.enemy || !e.shootable || e.dying || e.removed) continue
          const eb = e.box
          if (bx < eb.x + eb.w && bx + 10 > eb.x && by < eb.y + eb.h && by + 10 > eb.y) {
            e.hit(this, 1, Math.sign(b.vx))
            this.addAnim(BLAST.heroWall, b.x, b.y, b.vx > 0)
            if (e.removed) this.removed = true
            hit = true
            break
          }
        }
        if (hit) { this.kill(i--); continue }
      } else if (h.alive && h.state !== 'exit' && bx < hb.x + hb.w && bx + 10 > hb.x && by < hb.y + hb.h && by + 10 > hb.y) {
        if (h.state === 'block') {
          // El escudo detiene las balas
          audio.fx(Math.random() < 0.5 ? 's_1' : 's_2')
          this.addAnim(BLAST.enemyWall, b.x, b.y, b.vx > 0)
          this.sparks(b.x, b.y, 3, 0x9fdcff)
        } else h.hurt(this, 1, b.x)
        this.kill(i--)
      }
    }
  }

  // ---------------------------------------------------------------- efectos
  private addAnim(anim: Anim, x: number, y: number, flip: boolean) {
    let f = this.fx[this.nfx]
    if (!f) { f = { anim, x, y, t: 0, flip }; this.fx.push(f) }
    f.anim = anim; f.x = x; f.y = y; f.t = 0; f.flip = flip
    this.nfx++
  }
  addFx(kind: 'explosion' | 'dj' | 'pickup' | 'spark', x: number, y: number) {
    this.addAnim(kind === 'explosion' ? EXPLOSION : kind === 'dj' ? DOUBLE_JUMP_FX : kind === 'spark' ? SPARK : PICKUP, x, y, false)
  }
  dust(x: number, y: number, n: number, k = 1) {
    for (let i = 0; i < n; i++) particles.add(P.Dust, x + rnd(-8, 8), y - rnd(0, 4), rnd(-60, 60) * k, rnd(-50, -10) * k, rnd(0.35, 0.6), rnd(4, 7), 0xd8cfb8)
  }
  sparks(x: number, y: number, n: number, color: number) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = rnd(60, 200); particles.add(P.Spark, x, y, Math.cos(a) * v, Math.sin(a) * v - 40, rnd(0.25, 0.5), rnd(2.5, 4.5), color, 500) }
  }
  ring(x: number, y: number, color: number, size = 34) { particles.add(P.Ring, x, y, 0, 0, 0.35, size, color) }
  addPoints(n: number, x: number, y: number) {
    this.stats.points += n
    this.texts.push(new FloatText(String(n), x, y))
  }
  collect(it: Item) {
    const s = this.stats, h = this.hero, u = this.hud
    this.addFx('pickup', it.x, it.y)
    switch (it.kind) {
      case 'COIN':
        s.coins++; s.points += 100; u.coinPop = 1
        audio.fx('coin', 0.6)
        for (let i = 0; i < 5; i++) particles.add(P.Star, it.x + rnd(-6, 6), it.y + rnd(-6, 6), rnd(-50, 50), rnd(-120, -40), rnd(0.3, 0.5), rnd(2.5, 4), 0xffe25a, 300)
        break
      case 'ENERGY': h.energy = Math.min(PHYS.maxEnergy, h.energy + Math.max(1, Number(it.o.p.Count ?? 3))); audio.fx('energy'); this.sparks(it.x, it.y, 8, 0x9df03a); break
      case 'LIVES': save.lives = Math.min(99, save.lives + 1); persist(); u.livesPop = 1; audio.fx('extra_life'); this.addPoints(1000, it.x, it.y - 16); this.ring(it.x, it.y, 0xffffff, 50); break
      case 'ENERGY_DOUBLE_JUMP':
        // Yogur Calcar: con el doble salto clásico lo habilita; si no, es un súper bonus (energía llena + puntos)
        audio.fx('powerup')
        u.djPop = 1
        this.ring(it.x, it.y, 0xb6f04a, 60)
        this.sparks(it.x, it.y, 14, 0xd8ff8a)
        if (!h.canDouble) h.canDouble = true
        else { h.energy = PHYS.maxEnergy; this.addPoints(500, it.x, it.y - 16) }
        break
      case 'KEY': s.keys++; u.keyPop = 1; audio.fx('key'); this.ring(it.x, it.y, 0xffe25a, 44); break
    }
  }
  cowRescued(c: Cow) {
    this.stats.cows++
    this.hud.cowPop = 1
    this.addPoints(1000, c.x, c.y - 90)
    this.sparks(c.x, c.y - 50, 16, 0xfff1a0)
    this.ring(c.x, c.y - 50, 0xffffff, 70)
  }
  showSign(s: Sign) {
    if (this.sign !== s) { this.sign = s; audio.fx('info', 0.7) }
    this.signT = 0.3
  }
  checkpoint(sp: SavePoint) {
    this.respawn = { x: sp.x, y: sp.y }
    this.savingT = 1.6
    audio.fx('save')
    this.ring(sp.x, sp.y - 50, 0xffe98a, 70)
    this.sparks(sp.x, sp.y - 60, 14, 0xffe98a)
    const m = sp.o.p.Music
    if (typeof m === 'string') { this.music = m.replace('.ogg', '') as Music; audio.music(this.music) }
  }
  onHeroDeath() {
    save.lives = Math.max(0, save.lives - 1)
    persist()
    this.deadT = 0
    this.hud.livesPop = 1
  }
  bossStart(b: Boss) { if (!this.boss) { this.boss = b; this.bossBar = 1 } }
  bossDefeated() {
    this.stats.bossKey = true
    audio.fx('key')
  }
  levelComplete() {
    if (this.doneT >= 0 || !this.hero.alive) return
    this.doneT = 0
    this.hero.state = 'exit'
    this.hero.dir = 1
    audio.music(null)
    audio.fx('end_level')
  }

  // ---------------------------------------------------------------- dibujo
  render(ctx: CanvasRenderingContext2D, a: number) {
    const c = this.cam
    const camX = c.px + (c.x - c.px) * a + c.sx, camY = c.py + (c.y - c.py) * a + c.sy
    // Ajuste a píxeles reales (evita temblores de sub-píxel en los tiles)
    const k = view.k
    const cx = Math.round(camX * k) / k, cy = Math.round(camY * k) / k
    this.drawBackground(ctx, cx, cy)

    ctx.save()
    ctx.translate(-cx, -cy)
    this.tiles.draw(ctx, cx, cy, view.w, view.h)
    for (const p of this.platforms) if (this.near(p.x, p.y, p.bw, p.bh, 64)) drawLerp(ctx, p, a, this)
    for (const e of this.ents) { const b = e.box; if (this.near(b.x, b.y, b.w, b.h, 120)) drawLerp(ctx, e, a, this) }
    this.hero.draw(ctx, a)
    const back = (1 - a) * STEP
    for (let i = 0; i < this.nb; i++) {
      const b = this.bullets[i]
      drawAnim(ctx, b.hero ? BLAST.heroBullet : BLAST.enemyBullet, 0, b.x - b.vx * back, b.y - b.vy * back)
    }
    for (let i = 0; i < this.nfx; i++) { const f = this.fx[i]; drawAnim(ctx, f.anim, f.t, f.x, f.y, f.flip) }
    particles.draw(ctx, cx - 40, cy - 40, cx + view.w + 40, cy + view.h + 40)
    for (const t of this.texts) t.draw(ctx)
    ctx.restore()
    // Fundido al morir, antes de reaparecer
    if (!this.hero.alive && this.deadT > 1.6) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (this.deadT - 1.6) / 0.5)})`; ctx.fillRect(0, 0, view.w, view.h) }
    this.drawHud(ctx)
  }

  private drawBackground(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const key = `bg/${this.level.background}`
    const t = tex(key)
    if (!t) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, view.w, view.h); return }
    const mw = this.map.pxW - view.w, mh = this.map.pxH - view.h
    const fy = mh > 0 ? Math.max(0, Math.min(1, cy / mh)) : 0.5
    if (t.ai) {
      // Panorama nuevo (≈3:1, continuo): se ajusta por altura y se repite en horizontal con paralaje
      const dh = view.h * 1.12, dw = (dh * t.pw) / t.ph
      const oy = fy * (dh - view.h)
      let ox = (cx * 0.3) % dw
      if (ox < 0) ox += dw
      const pxPer = t.pw / dw
      for (let x = -ox; x < view.w; x += dw) {
        const sx = Math.max(0, -x), w = Math.min(dw - sx, view.w - Math.max(0, x))
        if (w > 0.5) ctx.drawImage(t.src, sx * pxPer, oy * pxPer, w * pxPer, view.h * pxPer, Math.max(0, x), 0, w + 0.6, view.h)
      }
      return
    }
    // Fondo original (1024x512): cubre la vista con margen y se desplaza en paralaje a lo largo del nivel
    const bh = 512, bw = t.e.lw
    const s = Math.max(1, (view.w * 1.3) / bw, (view.h * 1.15) / bh)
    const dw = bw * s, dh = bh * s
    const fx = mw > 0 ? Math.max(0, Math.min(1, cx / mw)) : 0.5
    const ox = fx * (dw - view.w), oy = fy * (dh - view.h)
    const pxPer = t.pw / dw
    ctx.drawImage(t.src, ox * pxPer, oy * pxPer, view.w * pxPer, view.h * pxPer, 0, 0, view.w, view.h)
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    if (!tex('ui/items')) return
    const s = this.stats, h = this.hero, u = this.hud
    const L = view.safe.l + 4, Tp = view.safe.t + 4
    const R = view.w - view.safe.r - 4 - (view.touch ? 60 / view.css : 0)
    const spr = (r: readonly number[], x: number, y: number, pop = 0) => {
      if (pop > 0) {
        const k = 1 + 0.35 * Math.sin(pop * Math.PI)
        drawImg(ctx, 'ui/items', r[0], r[1], r[2], r[3], x - (r[2] * (k - 1)) / 2, y - (r[3] * (k - 1)) / 2, r[2] * k, r[3] * k)
      } else drawImg(ctx, 'ui/items', r[0], r[1], r[2], r[3], x, y)
    }
    // Vidas
    spr(HUD.avatar, L, Tp, u.livesPop)
    drawText(ctx, String(save.lives), L + 67, Tp + 2, { scale: 1.25 })
    // Energía
    spr(energyFrame(h.energy), L + 8, Tp + 36)
    if (s.energyLost > 0 && Math.floor(s.energyLost * 10) % 2 === 0) spr(HUD.energyLose, L + 10, Tp + 48)
    // Doble salto: encendido si está disponible ahora
    const djReady = h.canDouble && (!h.usedDouble || h.onGround)
    spr(djReady ? HUD.djOn : HUD.djOff, L + 88, Tp - 4, u.djPop)
    // Vacas rescatadas / total (arriba al centro)
    const mx = view.w / 2
    spr(HUD.cows, mx - 50, Tp - 2, u.cowPop)
    drawText(ctx, String(s.cows), mx + 3, Tp + 4, { scale: 1.25, align: 'right' })
    drawText(ctx, String(s.cowsTotal), mx + 24, Tp + 4, { scale: 1.25 })
    // Puntos y monedas (arriba a la derecha)
    spr(HUD.coins, R - 81, Tp, u.coinPop)
    drawText(ctx, String(s.coins), R - 22, Tp + 3, { scale: 1.2 + u.coinPop * 0.15, align: 'right' })
    drawText(ctx, String(Math.round(u.points)).padStart(6, '0'), R - 3, Tp + 36, { scale: 1.1, align: 'right' })
    // Llaves (abajo a la izquierda; con controles táctiles, debajo de la energía)
    if (s.hasKeys) {
      const ky = view.touch ? Tp + 62 : view.h - view.safe.b - 34
      spr(HUD.keys, L + 2, ky, u.keyPop)
      drawText(ctx, String(s.keys), L + 32, ky, { scale: 1.25 })
    }
    // "Guardando..."
    if (this.savingT > 0) spr(HUD.saving[Math.floor((1.6 - this.savingT) * 4) % 3], mx - 45, Tp + 50)
    // Barra de vida del jefe
    if (this.boss && this.boss.deadT < 0) this.drawBossBar(ctx, mx, Tp + 54)
    // Carteles (con controles táctiles van arriba para no quedar bajo los pulgares)
    if (this.sign) {
      const y = view.touch ? Tp + 70 : view.h - view.safe.b - 66
      drawImg(ctx, 'ui/hud_message_back', 0, 0, 512, 64, mx - 256, y, 512, 64)
      drawText(ctx, this.sign.text, mx + 28, y + 7, { align: 'center', scale: 0.72, lineHeight: 21, maxWidth: 420 })
    }
  }

  private drawBossBar(ctx: CanvasRenderingContext2D, mx: number, y: number) {
    const b = this.boss!
    const w = Math.min(320, view.w * 0.5), x = mx - w / 2, hgt = 12
    const k = Math.max(0, b.lives / b.maxLives), lag = Math.max(k, this.bossBar)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    roundRect(ctx, x - 3, y - 3, w + 6, hgt + 6, 6); ctx.fill()
    ctx.fillStyle = '#7a1010'
    roundRect(ctx, x, y, w * lag, hgt, 4); ctx.fill()
    const g = ctx.createLinearGradient(0, y, 0, y + hgt)
    g.addColorStop(0, b.phase === 2 ? '#ff9a3c' : '#ff4a4a'); g.addColorStop(1, b.phase === 2 ? '#c2410c' : '#a8141e')
    ctx.fillStyle = g
    roundRect(ctx, x, y, w * k, hgt, 4); ctx.fill()
    if (b.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${b.flash * 4})`; roundRect(ctx, x, y, w * k, hgt, 4); ctx.fill() }
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5
    roundRect(ctx, x - 1, y - 1, w + 2, hgt + 2, 5); ctx.stroke()
    drawText(ctx, 'MARCOX', mx, y + hgt + 2, { align: 'center', scale: 0.55, font: 'fuente_blanca' })
  }

  dispose() { this.tiles.dispose(); particles.clear() }
}

/** Dibuja una entidad en su posición interpolada (sin tocar la lógica). */
function drawLerp(ctx: CanvasRenderingContext2D, e: Ent, a: number, w: World) {
  const x = e.x, y = e.y
  e.x = e.px + (x - e.px) * a
  e.y = e.py + (y - e.py) * a
  e.draw(ctx, w)
  e.x = x; e.y = y
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Imágenes que necesita un nivel. */
export const levelImages = (l: LevelData) => [`bg/${l.background}`, `tiles/${l.tileset}`, ...(l.objects.some((o) => o.type === 'Boss') ? ['sprites/boss', 'sprites/boss_green'] : [])]
