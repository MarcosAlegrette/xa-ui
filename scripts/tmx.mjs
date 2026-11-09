// Lector mínimo de los mapas Tiled (.tmx) originales de "Xa contra los Cuatreros Galácticos".
// Los mapas usan una sola capa de tiles (base64, sin compresión, gids uint32 LE),
// un tileset con propiedades por tile y un objectgroup con todos los objetos del nivel.
import fs from 'node:fs'

const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const props = (s) => {
  const out = {}
  for (const m of (s ?? '').matchAll(/<property name="([^"]*)" value="([^"]*)"\s*\/>/g)) out[m[1]] = m[2]
  return out
}

/** Decodifica los textos de los carteles: el editor del juego usaba "\a" = á, "\m" = ñ, "\!" = ¡, etc. */
export function decodeText(s) {
  const map = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', m: 'ñ', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', M: 'Ñ', '!': '¡', '?': '¿', n: '\n' }
  return s
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'")
    .replace(/\\(.)/g, (_, c) => map[c] ?? c)
}

export function parseTmx(file) {
  const s = fs.readFileSync(file, 'utf8')
  const map = attrs(s.match(/<map ([^>]*)>/)[1])
  const mapProps = props(s.match(/<map[^>]*>\s*<properties>([\s\S]*?)<\/properties>/)?.[1])
  const ts = s.match(/<tileset ([^>]*)>([\s\S]*?)<\/tileset>/)
  const tileset = { ...attrs(ts[1]), image: attrs(ts[2].match(/<image ([^>]*)\/>/)[1]).source, tiles: {} }
  for (const m of ts[2].matchAll(/<tile id="(\d+)">([\s\S]*?)<\/tile>/g)) tileset.tiles[+m[1]] = props(m[2])
  const layers = []
  for (const m of s.matchAll(/<layer ([^>]*)>\s*<data ([^>]*)>([\s\S]*?)<\/data>/g)) {
    const a = attrs(m[1]), d = attrs(m[2])
    if (d.encoding !== 'base64' || d.compression) throw new Error(`${file}: codificación no soportada`)
    const buf = Buffer.from(m[3].trim(), 'base64')
    const gids = new Uint32Array(buf.length / 4)
    for (let i = 0; i < gids.length; i++) gids[i] = buf.readUInt32LE(i * 4)
    layers.push({ name: a.name, width: +a.width, height: +a.height, gids })
  }
  const objects = []
  const og = s.slice(s.indexOf('<objectgroup'))
  for (const m of og.matchAll(/<object ([^>]*?)(?:\/>|>([\s\S]*?)<\/object>)/g)) {
    const a = attrs(m[1])
    objects.push({ name: a.name ?? '', type: a.type ?? '', x: +a.x, y: +a.y, w: +(a.width ?? 0), h: +(a.height ?? 0), p: props(m[2]) })
  }
  return { width: +map.width, height: +map.height, tw: +map.tilewidth, th: +map.tileheight, props: mapProps, tileset, layers, objects }
}
