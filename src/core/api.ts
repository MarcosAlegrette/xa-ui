// Punto de enganche con la API compartida (FastAPI en ../../api: /games/{slug}/save|results|leaderboard).
// DESACTIVADO salvo que se defina VITE_API_URL al compilar. El juego funciona 100 % sin backend;
// nada de esto se llama todavía desde el juego.
import type { SaveData } from './save'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
export const SLUG = 'xa-cuatreros'
export const apiEnabled = BASE !== ''

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T | null> {
  if (!apiEnabled) return null
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export const api = {
  getSave: (token: string) => call<{ data: SaveData }>('GET', `/games/${SLUG}/save`, undefined, token),
  putSave: (token: string, data: SaveData) => call<unknown>('PUT', `/games/${SLUG}/save`, { data }, token),
  postResult: (token: string, r: { level: number; points: number; cows: number; coins: number; won: boolean }) =>
    call<unknown>('POST', `/games/${SLUG}/results`, r, token),
  leaderboard: (limit = 20) => call<unknown[]>('GET', `/games/${SLUG}/leaderboard?limit=${limit}`),
}
