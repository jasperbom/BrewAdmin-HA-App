import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'

// Versie uit config.yaml (single source of truth) — een hardcoded waarde
// liep stelselmatig achter op de versie-bump-per-commit-regel. Ontbreekt het
// bestand (bv. niet meegekopieerd in een buildomgeving), dan valt de build
// terug op 'dev' in plaats van te crashen.
const appVersion = (() => {
  try {
    return (readFileSync(new URL('./config.yaml', import.meta.url), 'utf8')
      .match(/^version:\s*"([^"]+)"/m) || [])[1] || 'dev'
  } catch {
    return 'dev'
  }
})()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
