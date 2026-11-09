// Mide el costo de la lógica (World.update) en los niveles más grandes: node (ver package.json "bench").
import { input } from '../src/core/input'
import { World } from '../src/game/world'
import type { LevelData } from '../src/game/level'
import l14 from '../src/data/levels/level14.json'
import l16 from '../src/data/levels/level16.json'
import l10 from '../src/data/levels/level10.json'
for (const [n, d] of [[10, l10], [14, l14], [16, l16]] as const) {
  const w = new World(d as unknown as LevelData)
  input.set('b', ['right'])
  const N = 120 * 30
  const t0 = performance.now()
  for (let i = 0; i < N; i++) { if (i % 90 === 0) input.set('j', ['jump']); else if (i % 90 === 20) input.set('j', []); w.update(1 / 120); input.endFrame() }
  const ms = (performance.now() - t0) / N
  console.log(`nivel ${n}: ${w.ents.length} entidades, ${ms.toFixed(4)} ms por paso lógico (${(ms * 2).toFixed(3)} ms por cuadro a 60 Hz)`)
  input.releaseAll()
}
