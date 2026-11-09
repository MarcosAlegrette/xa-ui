import { defineConfig } from 'vite'
export default defineConfig({ logLevel: 'warn', build: { ssr: process.env.XA_TEST ?? 'tests/physics.ts', outDir: 'node_modules/.cache/xa-tests', emptyOutDir: true, target: 'node20' } })
