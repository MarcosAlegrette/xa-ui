// Genera los datos del juego a partir de los archivos ORIGINALES:
//  - src/data/levels/levelN.json  ← assets/data/levelN.tmx (tiles, propiedades de tiles y objetos)
//  - src/data/meta.json           ← nombres y descripciones de los niveles (cadenas UTF-16 de xa.exe)
//                                   y métricas de las fuentes de mapa de bits (fuente_*.png)
//   node scripts/build-data.mjs
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { parseTmx, decodeText } from './tmx.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIG = path.resolve(root, '../original')
const A = path.join(ORIG, 'assets')
const OUT = path.join(root, 'src/data')
fs.mkdirSync(path.join(OUT, 'levels'), { recursive: true })

// ---------------------------------------------------------------- niveles
// Bits de cada tile (propiedades del tileset de Tiled)
const FLAGS = { pHard: 1, pPlatform: 2, pLadder: 4, pLadderEnd: 8, pKilling: 16, pInvisible: 32 }
const num = (v) => (v === undefined || v === '' ? undefined : Number(v))

const summary = []
for (let n = 1; n <= 16; n++) {
  const t = parseTmx(path.join(A, `data/level${n}.tmx`))
  const L = t.layers[0]
  const cols = +t.props.pTileSetWidth || 32
  // Tiles: gid-1 (0 = vacío) como Uint16 en base64
  const tiles = new Uint16Array(L.gids.length)
  let maxId = 0
  for (let i = 0; i < L.gids.length; i++) { tiles[i] = L.gids[i] & 0x1fffffff; maxId = Math.max(maxId, tiles[i]) }
  const flags = new Array(maxId + 1).fill(0)
  for (const [id, p] of Object.entries(t.tileset.tiles)) {
    let f = 0
    for (const [k, b] of Object.entries(FLAGS)) if (p[k] === 'true') f |= b
    if (+id < flags.length) flags[+id] = f
  }
  const objects = t.objects.map((o) => {
    const p = {}
    for (const [k, v] of Object.entries(o.p)) {
      if (k === 'pText') p.text = decodeText(v)
      else if (v === 'true' || v === 'false') p[k.slice(1)] = v === 'true'
      else if (/^-?\d+(\.\d+)?$/.test(v)) p[k.slice(1)] = num(v)
      else p[k.slice(1)] = v
    }
    return { type: o.type, name: o.name, x: o.x, y: o.y, w: o.w, h: o.h, p }
  })
  const level = {
    n, width: t.width, height: t.height, tile: t.tw,
    background: t.props.pBackground.replace('.jpg', ''),
    music: t.props.pMusic.replace('.ogg', ''),
    tileset: path.basename(t.tileset.image, '.png'),
    tilesetCols: cols,
    flags,
    tiles: Buffer.from(tiles.buffer).toString('base64'),
    objects,
  }
  fs.writeFileSync(path.join(OUT, `levels/level${n}.json`), JSON.stringify(level))
  const count = (pred) => objects.filter(pred).length
  summary.push({
    n, w: t.width, h: t.height, bg: level.background, music: level.music, tileset: level.tileset,
    cows: count((o) => o.type === 'Cow'), coins: count((o) => o.p.Asset === 'COIN'),
    keys: count((o) => o.p.Asset === 'KEY'),
  })
}

// ---------------------------------------------------------------- textos del ejecutable
// El motor guarda los textos en UTF-16LE. Los nombres y descripciones de los niveles están
// en orden inverso (del 16 al 1), entre "Atrás" y "Nivel 16".
function utf16Strings(buf) {
  const out = []
  for (const start of [0, 1]) {
    let cur = '', at = 0
    for (let i = start; i + 1 < buf.length; i += 2) {
      const c = buf[i] | (buf[i + 1] << 8)
      if ((c >= 0x20 && c < 0x7f) || c === 0x0a || (c >= 0xa0 && c <= 0xff)) { if (!cur) at = i; cur += String.fromCharCode(c) }
      else { if (cur.length >= 3) out.push({ at, s: cur }); cur = '' }
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
const strs = utf16Strings(fs.readFileSync(path.join(ORIG, 'xa.exe')))
const iBack = strs.findIndex((s) => s.s === 'Atrás')
const block = strs.slice(iBack + 1, iBack + 1 + 32).map((s) => s.s)
const names = block.slice(0, 16).reverse()
const descriptions = block.slice(16, 32).reverse()
if (!names[0].startsWith('Campos') || !descriptions[0].startsWith('Una mañana')) throw new Error('No se encontraron los textos de los niveles en xa.exe')
const find = (pred) => strs.find((s) => pred(s.s))?.s
const texts = {
  title: 'Xa contra los Cuatreros Galácticos',
  confirmExit: find((s) => s.startsWith('¿Seguro que quieres volver')),
  points: find((s) => s === 'Puntos'),
}

// ---------------------------------------------------------------- fuentes
// Las fuentes son grillas de 12 columnas de 30x30. El orden de los caracteres se reconstruyó
// mirando la imagen (el exe lo tiene compilado). Para cada glifo se mide el ancho real (alfa).
const GLYPHS = [
  'ABCDEFGHIJKL', 'MNOPQRSTUVWX', 'YZabcdefghij', 'klmnopqrstuv', 'wxyz01234567', "89();,.:+-&'",
  '´!/?% ÀÁÄÇÉÑ', 'ÓÚÜßàáâäçèéê', 'ìîïñóôöùúûü—', '`“”„…¡¿$"_ÂÈ', 'ÊËÌÍÎÏÒÔÖÙÛë', 'íò',
]
async function fontMetrics(file) {
  const { data, info } = await sharp(path.join(A, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const g = {}
  GLYPHS.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ' ') return
    let x0 = 99, x1 = -1
    for (let y = r * 30; y < r * 30 + 30; y++) for (let x = c * 30; x < c * 30 + 30; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 24) { x0 = Math.min(x0, x - c * 30); x1 = Math.max(x1, x - c * 30) }
    }
    if (x1 >= 0) g[ch] = [c * 30 + x0, r * 30, x1 - x0 + 1]
  }))
  return g
}
const fonts = { glyphs: await fontMetrics('lang/images/fuente_negra.png'), digitsPixel: await fontMetrics('lang/images/fuente_pixelada.png') }

fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ names, descriptions, texts, levels: summary, fonts }, null, 0))
console.table(summary)
console.log('datos listos')
