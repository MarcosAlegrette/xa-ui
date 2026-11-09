import { defineConfig, type Plugin } from 'vite'
import { createHash } from 'node:crypto'

/** Genera dist/sw.js con la lista de archivos del build (shell precacheado; ver src/sw-template.js). */
function serviceWorker(): Plugin {
  return {
    name: 'xa-sw',
    apply: 'build',
    async generateBundle(_, bundle) {
      const fs = await import('node:fs')
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `/${f}`)
      const shell = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...files]
      const version = createHash('sha1').update(shell.join('|')).digest('hex').slice(0, 10)
      const tpl = fs.readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: tpl.replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell)) })
    },
  }
}

export default defineConfig({
  base: '/',
  server: { port: 5203, strictPort: true, host: true },
  preview: { port: 5203, strictPort: true, host: true },
  plugins: [serviceWorker()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900, assetsInlineLimit: 0, assetsDir: 'static' },
})
