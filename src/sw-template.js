// Service worker de "Xa contra los Cuatreros Galácticos" (generado en el build desde src/sw-template.js).
// · Shell (index, JS, CSS, íconos): precache en la instalación → el juego abre sin conexión.
// · /assets/** (imágenes con ?v=hash, audio): cache-first; la página manda en segundo plano la lista de lo
//   que este dispositivo necesita para jugar todos los niveles sin conexión.
const VERSION = '__VERSION__'
const SHELL = __SHELL__
const SHELL_CACHE = `xa-shell-${VERSION}`
const ASSETS = 'xa-assets-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('xa-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && res.status === 200) c.put(req, res.clone())
      return res
    }))
    return
  }
  if (req.mode === 'navigate') {
    // Red primero para el HTML (actualizaciones), caché si no hay conexión
    e.respondWith(fetch(req).then((res) => { caches.open(SHELL_CACHE).then((c) => c.put('/index.html', res.clone())); return res }).catch(() => caches.match('/index.html')))
    return
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)))
})
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'precache' || !Array.isArray(e.data.urls)) return
  e.waitUntil((async () => {
    const c = await caches.open(ASSETS)
    // Borra variantes viejas (otro ?v=) y baja lo que falte, de a pocos para no saturar la red
    const want = new Set(e.data.urls.map((u) => new URL(u, location.origin).href))
    for (const k of await c.keys()) if (!want.has(k.url)) await c.delete(k)
    const missing = []
    for (const u of want) if (!(await c.match(u))) missing.push(u)
    for (let i = 0; i < missing.length; i += 4) await Promise.all(missing.slice(i, i + 4).map((u) => fetch(u).then((r) => r.ok && c.put(u, r)).catch(() => {})))
  })())
})
