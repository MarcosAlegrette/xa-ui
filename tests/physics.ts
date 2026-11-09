// Pruebas de la física de Xa (node, sin navegador): npm run test:physics
// Simula entradas reales (flancos de teclado) a 120 Hz sobre un mapa de prueba.
import { input } from '../src/core/input'
import { World } from '../src/game/world'
import type { LevelData } from '../src/game/level'

const Wt = 80, Ht = 20, FLOOR = 15
const tiles = new Uint16Array(Wt * Ht)
for (let x = 0; x < 30; x++) tiles[FLOOR * Wt + x] = 1 // piso con borde en x=30 tiles (960 px)
for (let x = 40; x < Wt; x++) tiles[FLOOR * Wt + x] = 1
const level: LevelData = {
  n: 99, width: Wt, height: Ht, tile: 32, background: 'background_1', music: 'xa_1', tileset: 'tileset_level1', tilesetCols: 32,
  flags: [1], tiles: Buffer.from(tiles.buffer).toString('base64'),
  objects: [{ type: 'Hero', name: 'Hero', x: 128, y: (FLOOR - 1) * 32, w: 32, h: 32, p: {} }],
}
const STEP = 1 / 120
let fails = 0
const ok = (c: boolean, msg: string) => { console.log(`${c ? '✔' : '✘'} ${msg}`); if (!c) fails++ }

function fresh() {
  const w = new World(level)
  input.releaseAll()
  for (let i = 0; i < 240; i++) step(w) // termina la animación de entrada y se apoya
  return w
}
function step(w: World) { w.update(STEP); input.endFrame() }
function run(w: World, s: number, each?: () => void) { for (let i = 0; i < Math.round(s / STEP); i++) { each?.(); step(w) } }
const press = (a: 'jump' | 'right' | 'left') => input.set(`test:${a}`, [a])
const release = (a: 'jump' | 'right' | 'left') => input.set(`test:${a}`, [])

// 1. Salto completo
{
  const w = fresh(), h = w.hero, y0 = h.y
  ok(h.onGround && h.state === 'normal', 'Xa empieza en el piso')
  press('jump'); let minY = y0
  run(w, 1.2, () => { minY = Math.min(minY, h.y) })
  release('jump')
  const hgt = y0 - minY
  ok(hgt > 92 && hgt < 110, `salto completo ≈ 3 tiles (${hgt.toFixed(1)} px)`)
  ok(h.onGround, 'vuelve al piso')
}
// 2. Toque corto = salto bajo pero con altura mínima
{
  const w = fresh(), h = w.hero, y0 = h.y
  press('jump'); step(w); release('jump'); let minY = y0
  run(w, 1, () => { minY = Math.min(minY, h.y) })
  const hgt = y0 - minY
  ok(hgt > 28 && hgt < 60, `toque corto: salto variable bajo (${hgt.toFixed(1)} px)`)
}
// 3. Doble salto desde el piso (segunda pulsación en el aire)
{
  const w = fresh(), h = w.hero, y0 = h.y
  press('jump'); run(w, 0.3); release('jump'); run(w, 0.05)
  press('jump'); let minY = h.y
  run(w, 1.2, () => { minY = Math.min(minY, h.y) })
  release('jump')
  ok(h.usedDouble === false && h.onGround, 'doble salto se repone al aterrizar')
  const hgt = y0 - minY
  ok(hgt > 150, `doble salto suma altura (${hgt.toFixed(1)} px total)`)
}
// 4. Mantener apretado NO dispara el doble salto (flanco)
{
  const w = fresh(), h = w.hero
  press('jump'); let used = false
  run(w, 1.0, () => { if (h.usedDouble) used = true })
  release('jump')
  ok(!used, 'mantener el botón no consume el doble salto')
}
// 5. Doble toque rapidísimo (dos pulsaciones en pasos seguidos)
{
  const w = fresh(), h = w.hero
  press('jump'); step(w); release('jump'); step(w); step(w); press('jump'); step(w)
  ok(h.usedDouble, 'dos toques rápidos = salto + doble salto')
  release('jump'); run(w, 1.2)
}
// 6. Caer de un borde y luego saltar en el aire (después del coyote) = doble salto
{
  const w = fresh(), h = w.hero
  press('right'); run(w, 6, () => { if (!h.onGround && h.vy > 0 && h.x > 960) release('right') })
  release('right')
  // reubicar justo antes del borde
  const w2 = fresh(), h2 = w2.hero
  h2.x = 940; h2.px = 940
  press('right'); let left = -1
  for (let i = 0; i < 240; i++) { step(w2); if (!h2.onGround && left < 0) left = i; if (left >= 0 && i - left > 24) break }
  release('right')
  ok(!h2.onGround && h2.vy > 0, 'cayó del borde')
  const vyBefore = h2.vy
  press('jump'); step(w2); release('jump')
  ok(h2.usedDouble && h2.vy < 0 && vyBefore > 0, 'después del coyote time, saltar en el aire usa el doble salto')
  void w; void h
}
// 7. Coyote time: saltar apenas después de salir del borde = salto normal (y queda el doble)
{
  const w = fresh(), h = w.hero
  h.x = 940; h.px = 940
  press('right'); let i = 0
  while (h.onGround && i++ < 240) step(w)
  step(w); step(w); step(w) // ~25 ms en el aire
  press('jump'); step(w)
  ok(h.vy < -300 && !h.usedDouble, 'coyote time: salto normal un instante después de salir del borde')
  release('jump'); step(w); step(w); step(w); step(w); step(w); step(w); step(w); step(w); step(w); step(w)
  press('jump'); step(w); release('jump')
  ok(h.usedDouble, '…y el doble salto sigue disponible')
  release('right')
}
// 8. Búfer: apretar justo antes de tocar el piso salta al aterrizar
{
  const w = fresh(), h = w.hero
  press('jump'); step(w); release('jump'); run(w, 0.05)
  press('jump'); step(w); release('jump') // doble salto
  while (!(h.vy > 0 && h.y > h.py && (FLOOR * 32 - h.y) < 14)) step(w)
  press('jump'); step(w); release('jump')
  let jumped = false
  run(w, 0.2, () => { if (h.vy < -200) jumped = true })
  ok(jumped, 'búfer de salto: la pulsación justo antes de aterrizar no se pierde')
}
// 9. Aceleración: llega a velocidad máxima rápido y frena rápido
{
  const w = fresh(), h = w.hero
  press('right'); run(w, 0.1)
  ok(h.vx > 170, `acelera a tope en 0,1 s (${h.vx.toFixed(0)} px/s)`)
  release('right'); run(w, 0.08)
  ok(Math.abs(h.vx) < 1, 'frena en < 0,1 s')
}
// 10. Sin túneles: caída a velocidad máxima desde muy alto aterriza sobre el piso
{
  const w = fresh(), h = w.hero
  h.y = 40; h.py = 40; h.vy = 2000
  run(w, 1.5)
  ok(h.onGround && Math.abs(h.y - FLOOR * 32) < 0.01, 'caída rápida no atraviesa el piso')
}
// 11. Mismos resultados a distinto ritmo de cuadros (el paso fijo los vuelve deterministas)
console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron')
process.exit(fails ? 1 : 0)
