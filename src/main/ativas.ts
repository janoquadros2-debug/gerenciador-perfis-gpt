// "Manter todas as janelas ativas, mesmo cobertas"
// Quando uma janela fica totalmente coberta (ou minimizada), o Chrome economiza: marca a página como
// escondida, deixa os relógios lentos e alguns sites baixam o vídeo. Isto desliga essa economia.
import type { Browser, Page } from 'puppeteer-core'

// 1) configurações do Chrome que vão no perfil do Dolphin ("Command line switches")
export const ARGS_MANTER_ATIVAS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'
]

// 2) enquanto o navegador roda: a página acha que está visível e com foco
const SEMPRE_VISIVEL = `(() => {
  try {
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'visible' })
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(Document.prototype, 'webkitVisibilityState', { configurable: true, get: () => 'visible' })
    Object.defineProperty(Document.prototype, 'webkitHidden', { configurable: true, get: () => false })
    Document.prototype.hasFocus = function () { return true }
    const parar = (e) => e.stopImmediatePropagation()
    window.addEventListener('visibilitychange', parar, true)
    document.addEventListener('visibilitychange', parar, true)
    window.addEventListener('blur', parar, true)
  } catch (e) {}
})()`

async function ativarPagina(p: Page) {
  if (p.isClosed()) return
  if (!(p as any).__ativa) {
    try {
      await p.evaluateOnNewDocument(SEMPRE_VISIVEL)
      ;(p as any).__ativa = true
    } catch { return }
  }
  // Não garantir prioridade de CPU/GPU: a plataforma e o Windows ainda podem limitar o vídeo.
  await p.evaluate(SEMPRE_VISIVEL).catch(() => undefined)
  const cdp = await p.createCDPSession().catch(() => null)
  if (!cdp) return
  try {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined)
  } finally { await cdp.detach().catch(() => undefined) }
}

export async function manterAtivas(browser: Browser) {
  for (const p of await browser.pages()) await ativarPagina(p)
  browser.on('targetcreated', async (t) => {
    const p = await t.page().catch(() => null)
    if (p) await ativarPagina(p)
  })
  // Verifica novas abas e navegações sem forçar foco visível no Windows.
  let ocupado = false
  const timer = setInterval(async () => {
    if (ocupado) return
    ocupado = true
    try {
    if (!browser.connected) { clearInterval(timer); return }
    const paginas = await browser.pages().catch(() => [] as Page[])
    for (const p of paginas) if (!p.isClosed()) await ativarPagina(p)
    } catch { /* navegador encerrando */ } finally { ocupado = false }
  }, 60000)
  browser.once('disconnected', () => clearInterval(timer))
}
