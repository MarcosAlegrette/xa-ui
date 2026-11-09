// Fuentes de mapa de bits originales (fuente_negra / fuente_blanca / fuente_negra_2).
// Grilla de 12x30 px; las métricas de cada glifo se miden en scripts/build-data.mjs.
import meta from '../data/meta.json'
import { blit, tex } from './assets'

export type FontName = 'fuente_negra' | 'fuente_blanca' | 'fuente_negra_2'
export const FONT_IMAGES: string[] = ['ui/fuente_negra', 'ui/fuente_blanca', 'ui/fuente_negra_2']
const G = meta.fonts.glyphs as unknown as Record<string, [number, number, number]>
const CELL = 30
const SPACE = 7
const GAP = 0

// Caracteres que no están en la fuente → equivalentes
const ALIAS: Record<string, string> = { 'Ú': 'Ú', '"': '"', '«': '"', '»': '"', '’': "'", '‘': "'", '–': '-', 'ü': 'ü' }
const glyph = (c: string) => G[c] ?? G[ALIAS[c] ?? ''] ?? G[c.toUpperCase()] ?? G[c.normalize('NFD')[0]]

export function textWidth(s: string) {
  let w = 0
  for (const c of s) w += c === ' ' ? SPACE : (glyph(c)?.[2] ?? SPACE) + GAP
  return w
}

export interface TextOpts { font?: FontName; scale?: number; align?: 'left' | 'center' | 'right'; lineHeight?: number; maxWidth?: number; alpha?: number }

/** Dibuja texto (con saltos de línea) en coordenadas lógicas. y = parte de arriba de la primera línea. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}) {
  const im = tex(`ui/${o.font ?? 'fuente_negra'}`)
  if (!im) return
  const lines = text.split('\n')
  let s = o.scale ?? 1
  if (o.maxWidth) {
    let widest = 0
    for (const l of lines) widest = Math.max(widest, textWidth(l))
    if (widest * s > o.maxWidth) s = o.maxWidth / widest
  }
  const lh = (o.lineHeight ?? 24) * (s / (o.scale ?? 1))
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const w = textWidth(line) * s
    let cx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
    const cy = y + i * lh
    for (const c of line) {
      const g = glyph(c)
      if (c === ' ' || !g) { cx += SPACE * s; continue }
      blit(ctx, im, g[0], g[1], g[2], CELL, cx, cy, g[2] * s, CELL * s)
      cx += (g[2] + GAP) * s
    }
  }
  if (o.alpha !== undefined) ctx.globalAlpha = 1
}
