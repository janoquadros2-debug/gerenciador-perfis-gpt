import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// EDICAO=padrao gera a edição Padrão; sem nada, gera a Completa (a sua, com os 2 PCs).
const define = { __EDICAO__: JSON.stringify(process.env.EDICAO === 'padrao' ? 'padrao' : 'completa') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    define,
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
})
