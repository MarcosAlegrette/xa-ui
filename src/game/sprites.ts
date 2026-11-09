// Cuadros de animación dentro de los atlas originales.
// El ejecutable tenía estos rectángulos compilados (AssetsAnimationsHero/Enemies/General); acá están
// reconstruidos midiendo las imágenes (cajas de alfa de cada dibujo, ver README).
// Frame = [sx, sy, w, h, ax, ay]: (ax, ay) es el punto del cuadro que se apoya en la posición de la entidad.
import { blit, tex } from '../core/assets'

export type Frame = [number, number, number, number, number, number]
export interface Anim { sheet: string; frames: Frame[]; fps: number; loop: boolean }

const grid = (x0: number, y0: number, cw: number, ch: number, cols: number, idx: number[], ax = cw / 2, ay = ch): Frame[] =>
  idx.map((i) => [x0 + (i % cols) * cw, y0 + Math.floor(i / cols) * ch, cw, ch, ax, ay])
/** Cuadros sueltos [x,y,w,h], apoyados abajo al centro. */
const feet = (r: number[][]): Frame[] => r.map(([x, y, w, h]) => [x, y, w, h, w / 2, h])
/** Cuadros sueltos [x,y,w,h], centrados. */
const mid = (r: number[][]): Frame[] => r.map(([x, y, w, h]) => [x, y, w, h, w / 2, h / 2])
const A = (sheet: string, frames: Frame[], fps = 10, loop = true): Anim => ({ sheet, frames, fps, loop })

// ---------------------------------------------------------------- Xa (Xa_animaciones.png: 48 cuadros de 70x70)
const hero = (idx: number[], fps: number, loop = true) => A('sprites/hero', grid(0, 0, 70, 70, 7, idx, 35, 64), fps, loop)
export const HERO = {
  stand: hero([0, 1, 2, 1], 5),
  run: hero([8, 9, 10, 11, 12, 13], 13),
  jump: hero([3, 4, 5, 6, 7], 16, false),
  fall: hero([14, 15, 16], 9),
  land: hero([17], 1, false),
  shotStand: hero([22, 23, 21, 20], 18, false),
  shotRun: hero([29, 30, 31, 32, 33, 34, 35, 36, 37], 14),
  shotJump: hero([26], 1, false),
  shotFall: hero([28], 1, false),
  block: hero([24, 25], 18, false),
  climb: hero([38, 39, 40, 41], 8),
  climbEnd: hero([42], 1, false),
  hurt: hero([44], 1, false),
  dead: hero([18, 43], 3, false),
  entrance: hero([45, 46, 47, 0], 8, false),
}
export const DOUBLE_JUMP_FX = A('sprites/double_jump_fx', mid([[28, 12, 24, 6], [94, 8, 52, 14], [164, 5, 71, 20]]), 18, false)

// ---------------------------------------------------------------- enemigos (plantilla_enemigos_xa.png)
const E = 'sprites/enemies'
export const ENEMY: Record<string, Anim> = {
  DOUBLE_SIDE: A(E, grid(0, 0, 100, 50, 4, [0, 1, 2, 3], 50, 25), 10),
  FLYING_SAUCER: A(E, mid([[2, 52, 60, 50], [66, 52, 60, 50], [130, 52, 60, 50]]), 10),
  UFO_1: A(E, mid([[194, 53, 63, 49]]), 1),
  WALLE: A(E, grid(0, 104, 76, 58, 4, [0, 1, 2, 3], 38, 58), 10),
  ROCKET_H: A(E, mid([[326, 106, 32, 27], [364, 105, 50, 27], [419, 106, 51, 27]]), 12),
  CANNON_60: A(E, grid(0, 165, 80, 57, 4, [0, 1, 2, 3], 40, 57), 10),
  ROCKET_V: A(E, mid([[321, 190, 27, 32], [352, 172, 27, 50], [381, 171, 27, 51]]), 12),
  ULTRATON: A(E, feet([[2, 235, 46, 67], [52, 238, 46, 64], [102, 241, 46, 61], [152, 229, 46, 73]]), 8),
  COBRA: A(E, feet([[203, 246, 45, 56], [253, 252, 42, 50], [303, 255, 41, 47], [353, 256, 46, 46]]), 10),
  COBRA_SHOOT: A(E, feet([[402, 251, 46, 52], [452, 253, 46, 50]]), 6),
  BOMBA: A(E, mid([[4, 308, 48, 48]]), 1),
  BOMBA_DEATH: A(E, mid([[59, 305, 50, 51], [110, 304, 60, 54], [170, 308, 50, 50]]), 14, false),
  UFO_3: A(E, mid([[226, 318, 37, 40], [266, 318, 37, 40]]), 8),
  UFO_SPIKY: A(E, mid([[306, 323, 32, 35], [342, 323, 32, 35]]), 6),
  ANDROID: A(E, feet([[2, 362, 49, 70], [61, 368, 43, 63], [111, 363, 45, 67], [166, 364, 43, 67]]), 8),
  ANDROID_SHOOT: A(E, feet([[224, 363, 38, 69], [275, 365, 44, 67]]), 8, false),
  FLOOR_CANNON: A(E, feet([[337, 404, 32, 28], [372, 406, 32, 26], [407, 408, 32, 24], [442, 403, 32, 29]]), 10),
  DUCK_ROBOT: A(E, feet([[6, 439, 47, 45], [60, 437, 47, 47], [109, 439, 52, 45]]), 9),
  UFO_CANNON: A(E, feet([[163, 439, 48, 45], [213, 441, 48, 43], [263, 443, 48, 41], [313, 437, 48, 47]]), 10),
  UFO: A(E, mid([[364, 447, 32, 37], [399, 449, 32, 35], [434, 451, 32, 33], [469, 446, 32, 38]]), 10),
  GUILLOTINE: A(E, [[473, 0, 38, 154, 19, 0]], 1),
}

// ---------------------------------------------------------------- jefe (jefe_tile.png, cuadros de 200x200)
export const BOSS = {
  walk: A('sprites/boss', feet([[12, 13, 172, 183], [212, 3, 172, 185], [412, 7, 172, 184], [612, 13, 172, 183]]), 7),
  shoot: A('sprites/boss', feet([[804, 13, 180, 183]]), 1, false),
  dying: A('sprites/boss', feet([[16, 201, 189, 209], [256, 243, 152, 167], [493, 277, 122, 133], [712, 336, 140, 73]]), 5, false),
  dead: A('sprites/boss', feet([[46, 546, 140, 73], [268, 547, 140, 72], [490, 546, 140, 73], [712, 546, 140, 73], [46, 756, 140, 73], [268, 756, 140, 73], [490, 756, 140, 73], [712, 756, 140, 73]]), 8),
}

// ---------------------------------------------------------------- disparos y explosiones (planilla_blasts_xa)
const B = 'sprites/blasts'
export const BLAST = {
  heroBullet: A(B, mid([[442, 82, 16, 17]]), 1),
  enemyBullet: A(B, mid([[442, 22, 16, 17]]), 1),
  heroMuzzle: A(B, mid([[23, 83, 14, 14], [73, 78, 34, 24], [122, 72, 56, 36]]), 24, false),
  enemyMuzzle: A(B, mid([[205, 25, 10, 10], [257, 21, 26, 18], [308, 16, 43, 28]]), 24, false),
  heroWall: A(B, mid([[293, 151, 14, 19], [360, 140, 27, 42], [426, 130, 42, 62], [497, 127, 55, 69]]), 20, false),
  enemyWall: A(B, mid([[14, 153, 12, 16], [81, 141, 25, 39], [147, 131, 40, 60], [218, 128, 53, 67]]), 20, false),
  ring: A(B, mid([[9, 373, 6, 6], [29, 369, 14, 14], [51, 367, 18, 18]]), 16, false),
}
/** Explosión verde grande (mega_power.png) para enemigos destruidos. */
export const EXPLOSION = A('sprites/mega_power', mid([[56, 33, 16, 16], [175, 26, 30, 30], [296, 22, 39, 49], [406, 15, 71, 67], [16, 98, 95, 63], [133, 94, 115, 72], [257, 99, 116, 69]]), 16, false)
/** Remolino verde al juntar objetos (items_effect_tile.png, cuadros de 90x90). */
export const PICKUP = A('sprites/items_effect', grid(0, 0, 90, 90, 4, [0, 1, 2, 3, 4, 5, 6, 7], 45, 45), 22, false)
export const SPARK = A('sprites/items_effect', grid(0, 180, 90, 90, 4, [0, 1, 2, 3], 45, 45), 16, false)

// ---------------------------------------------------------------- objetos (items_tile.png)
const I = 'ui/items'
export const ITEM: Record<string, Anim> = {
  COIN: A(I, mid([[101, 101, 32, 32], [139, 100, 28, 34], [176, 100, 23, 34], [208, 100, 29, 34], [246, 100, 23, 34]]), 10),
  ENERGY: A(I, mid([[356, 7, 28, 36]]), 1),
  ENERGY_DOUBLE_JUMP: A(I, mid([[236, 9, 30, 33]]), 1),
  KEY: A(I, mid([[300, 9, 21, 33]]), 1),
  LIVES: A(I, mid([[5, 51, 51, 48]]), 1),
}
export const HUD = {
  avatar: [11, 7, 87, 35], cows: [114, 3, 101, 44], keys: [67, 63, 44, 29], points: [4, 104, 92, 51], coins: [4, 213, 81, 34],
  djOff: [282, 104, 47, 42], djOn: [342, 104, 47, 42], saving: [[124, 62, 91, 26], [224, 62, 91, 26], [324, 62, 91, 26]],
  energyLose: [465, 107, 40, 6],
  energyJump: grid(0, 160, 60, 50, 8, [0, 1, 2, 3, 4, 5, 6, 7], 30, 25),
} as const
/** Barra de energía: 10 cuadros de 44x10 (uno por nivel de energía). */
export const energyFrame = (e: number) => [463, 5 + 10 * (Math.max(1, Math.min(10, e)) - 1), 44, 10] as const

// ---------------------------------------------------------------- elementos del escenario
export const SIGN = { info: [3, 5, 33, 61], save: [43, 5, 33, 61], saved: [83, 5, 33, 61] } as const
export const PLATFORM: Record<string, number[]> = {
  GREEN: [2, 1, 66, 27], BORDEAUX: [72, 1, 66, 27], SKYBLUE: [142, 1, 66, 27], CAVE: [2, 31, 66, 21], PURPLE: [72, 31, 66, 27],
  BROWN: [142, 31, 66, 27], CITY: [2, 61, 66, 14], ICE: [72, 61, 66, 26], MOON: [142, 61, 66, 27], SPACE: [2, 91, 66, 13],
}
// Vacas: plantilla-vaca-1 (jaula que se rompe + vaca feliz) y plantilla-vaca-2 (vaca liberada con brillo)
export const COW = {
  caged: A('sprites/cow1', [[0, 0, 154, 140, 77, 116]], 1),
  breaking: A('sprites/cow1', grid(0, 0, 154, 140, 6, [1, 2, 3, 4, 5], 77, 116), 12, false),
  happy: A('sprites/cow1', grid(0, 150, 154, 120, 6, [0, 1, 2, 3, 4], 77, 110), 10),
  rescued: A('sprites/cow2', grid(0, 0, 154, 144, 6, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 77, 124), 14, false),
}

/** Dibuja el cuadro `f` de una animación en (x, y). flip = espejado horizontal; sq = estiramiento vertical (squash & stretch). */
export function drawFrame(ctx: CanvasRenderingContext2D, sheet: string, f: Frame, x: number, y: number, flip = false, alpha = 1, scale = 1, sq = 1) {
  const t = tex(sheet)
  if (!t) return
  const [sx, sy, w, h, ax, ay] = f
  if (alpha !== 1) ctx.globalAlpha = alpha
  if (flip || sq !== 1) {
    ctx.save()
    ctx.translate(x, y)
    const kx = sq === 1 ? 1 : 1 / Math.sqrt(sq)
    ctx.scale((flip ? -scale : scale) * kx, scale * sq)
    blit(ctx, t, sx, sy, w, h, -ax, -ay, w, h)
    ctx.restore()
  } else blit(ctx, t, sx, sy, w, h, x - ax * scale, y - ay * scale, w * scale, h * scale)
  if (alpha !== 1) ctx.globalAlpha = 1
}

export const frameAt = (a: Anim, t: number) => {
  const n = a.frames.length
  let i = Math.floor(t * a.fps)
  i = a.loop ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))
  return a.frames[i]
}
export const animDone = (a: Anim, t: number) => !a.loop && t * a.fps >= a.frames.length

export function drawAnim(ctx: CanvasRenderingContext2D, a: Anim, t: number, x: number, y: number, flip = false, alpha = 1, red = false, sq = 1) {
  drawFrame(ctx, red ? redSheet(a.sheet) : a.sheet, frameAt(a, t), x, y, flip, alpha, 1, sq)
}
/** Destello blanco (impacto): vuelve a dibujar el cuadro sumando luz. */
export function flashAnim(ctx: CanvasRenderingContext2D, a: Anim, t: number, x: number, y: number, flip: boolean, k: number) {
  if (k <= 0) return
  const op = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'lighter'
  drawFrame(ctx, a.sheet, frameAt(a, t), x, y, flip, Math.min(1, k))
  ctx.globalCompositeOperation = op
}
const redSheet = (s: string) => (s === 'sprites/hero' ? 'sprites/hero_red' : s === 'sprites/enemies' ? 'sprites/enemies_red' : s === 'sprites/boss' ? 'sprites/boss_green' : s)

export const GAME_SHEETS = [
  'sprites/hero', 'sprites/hero_red', 'sprites/enemies', 'sprites/enemies_red', 'sprites/blasts', 'sprites/mega_power',
  'sprites/items_effect', 'sprites/double_jump_fx', 'sprites/cow1', 'sprites/cow2', 'sprites/gate', 'sprites/platforms',
  'sprites/save', 'sprites/signs', 'ui/items', 'ui/hud_message_back', 'ui/fuente_blanca', 'ui/fuente_negra',
  'ui/buttons', 'ui/cursor', 'ui/exit_confirmation',
]
