// Suno (edição Completa).
// O Google NÃO deixa fazer login dentro de programas (tela "Esse navegador ou app pode não ser seguro").
// Por isso o Suno abre no Google Chrome de verdade (ou no Edge), com um perfil só dele que fica
// guardado nesta pasta do programa. O programa conversa com essa janela para gerar e baixar as músicas.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { logAviso, logInfo, logOk } from './log'
import * as galeria from './ia/galeria'

const PORTA = 47930
const API = 'https://studio-api.prod.suno.com'
const pastaPerfil = () => path.join(app.getPath('userData'), 'suno-chrome')
const arqPedido = () => path.join(app.getPath('userData'), 'suno-pedido.json')

// ---------- o programa "aprende" o jeito de pedir com o próprio site ----------
// Quando você clica em Create no site (na janela aberta pelo programa), guardamos o pedido que o site mandou
// (modelo v6, Weirdness, Style Influence, Vocal Gender…). O "Gerar direto" usa esse mesmo pedido como base.
export interface PedidoAprendido {
  quando: number
  corpo: Record<string, any>
  caminho: string // endereço que o site usa para gerar (ex.: /api/generate/v2-web/)
  modelos: string[] // nomes internos dos modelos já vistos (ex.: o da v6)
}
let enviandoDireto = 0
function lerPedido(): PedidoAprendido | null {
  try {
    return JSON.parse(fs.readFileSync(arqPedido(), 'utf8'))
  } catch {
    return null
  }
}
function aprender(corpo: Record<string, any>, url: string) {
  const antes = lerPedido()
  const limpo = { ...corpo, token: null } // o "token" é a verificação de robô: vale uma vez só
  const modelos = [...new Set([...(antes?.modelos ?? []), typeof corpo.mv === 'string' ? corpo.mv : ''].filter(Boolean))]
  const novo: PedidoAprendido = { quando: Date.now(), corpo: limpo, caminho: url.split('?')[0], modelos }
  fs.writeFileSync(arqPedido(), JSON.stringify(novo, null, 1))
  const resumo = Object.entries(limpo)
    .filter(([k]) => !['prompt', 'gpt_description_prompt', 'token'].includes(k))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' · ')
  logOk('Suno', `Aprendi as opções do seu pedido no site: ${resumo.slice(0, 900)}`)
  avisar('suno-pedido', novo)
}
const vistos = new Set<string>()

// ---------- guarda sozinho as músicas que o próprio site mostra prontas ----------
// O site do Suno fica perguntando "a música ficou pronta?". O programa escuta essas respostas:
// quando uma música nova aparece como pronta, baixa para a galeria (não depende de endereço nenhum).
const arqDesde = () => path.join(app.getPath('userData'), 'suno-desde.txt')
function desde(): number {
  try {
    return Number(fs.readFileSync(arqDesde(), 'utf8')) || 0
  } catch {
    const agora = Date.now()
    try {
      fs.writeFileSync(arqDesde(), String(agora))
    } catch {
      /* sem problema */
    }
    return agora
  }
}
const pedidasAgora = new Set<string>() // músicas criadas enquanto o programa estava aberto
const salvando = new Set<string>()
const falhas = new Map<string, number>()
let guardarSozinho = true
function acharClipes(j: any, out: any[] = [], fundo = 0): any[] {
  if (!j || typeof j !== 'object' || fundo > 5) return out
  if (Array.isArray(j)) {
    for (const x of j) acharClipes(x, out, fundo + 1)
    return out
  }
  if (typeof j.id === 'string' && ('audio_url' in j || 'status' in j) && ('title' in j || 'metadata' in j)) out.push(j)
  else for (const v of Object.values(j)) if (v && typeof v === 'object') acharClipes(v, out, fundo + 1)
  return out
}
// Baixa um arquivo pelo Chrome do Suno (com o seu login): o link de download do Suno às vezes recusa (403) quem não está logado.
// 1º jeito: o próprio Chrome baixa (como o DevTools faz), com os cookies do login e sem a trava de "CORS"
async function baixarPeloNavegador(p: Page, url: string): Promise<Buffer> {
  const cdp = await p.createCDPSession()
  try {
    const frameId = (p.mainFrame() as any)._id
    const r: any = await cdp.send('Network.loadNetworkResource' as any, { frameId, url, options: { disableCache: true, includeCredentials: true } } as any)
    const res = r.resource
    if (!res?.success || !res.stream || (res.httpStatusCode && res.httpStatusCode >= 400)) throw new Error(`HTTP ${res?.httpStatusCode ?? '?'} ${res?.netErrorName ?? ''}`.trim())
    const partes: Buffer[] = []
    for (let i = 0; i < 20000; i++) {
      const c: any = await cdp.send('IO.read' as any, { handle: res.stream, size: 1 << 20 } as any)
      partes.push(Buffer.from(c.data ?? '', c.base64Encoded ? 'base64' : 'utf8'))
      if (c.eof) break
    }
    await cdp.send('IO.close' as any, { handle: res.stream } as any).catch(() => undefined)
    const b = Buffer.concat(partes)
    if (b.length < 10_000 || /^\s*</.test(b.subarray(0, 20).toString())) throw new Error('veio uma página em vez da música')
    return b
  } finally {
    await cdp.detach().catch(() => undefined)
  }
}

async function baixarComLogin(url: string): Promise<Buffer> {
  const p = await paginaDoSuno()
  let erroNavegador = ''
  try {
    return await baixarPeloNavegador(p, url)
  } catch (e: any) {
    erroNavegador = e.message
  }
  const { token } = await pegarToken(p)
  // baixa de dentro do site, com o seu login (cookie + "passe"), sem abrir aba nenhuma
  const r = await p
    .evaluate(
      async (u: string, tk: string | null) => {
        const tentar = async (h: Record<string, string>) => {
          const x = await fetch(u, { credentials: 'include', headers: h })
          if (!x.ok) return 'ERRO ' + x.status
          const a = new Uint8Array(await x.arrayBuffer())
          let s = ''
          for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000))
          return btoa(s)
        }
        try {
          const com = tk ? await tentar({ Authorization: 'Bearer ' + tk }) : 'ERRO sem login'
          return com.startsWith('ERRO') ? await tentar({}).then((sem) => (sem.startsWith('ERRO') ? com : sem)) : com
        } catch (e) {
          return 'ERRO ' + String(e)
        }
      },
      url,
      token
    )
    .catch((e) => 'ERRO ' + e.message)
  if (!r.startsWith('ERRO')) return Buffer.from(r, 'base64')
  const u = new URL(url)
  throw new Error(`o Suno recusou o download (navegador: ${erroNavegador}; site: ${r.replace('ERRO ', '').slice(0, 80)}; ${u.host}${u.pathname.slice(0, 60)})`)
}

const vistosNoSite = new Map<string, any>() // músicas que o site mostrou (para o "Puxar as últimas")
async function guardarClipes(clipes: any[], todas = false) {
  const d = desde()
  for (const c of clipes) {
    if (!todas) vistosNoSite.set(c.id, c)
    if (c.status !== 'complete' || salvando.has(c.id)) continue
    const nova = todas || pedidasAgora.has(c.id) || (c.created_at && Date.parse(c.created_at) >= d)
    if (!nova || (!guardarSozinho && !todas)) continue
    if (todas) falhas.delete(c.id)
    salvando.add(c.id)
    try {
      const item = await galeria.salvarMusica({
        id: c.id,
        titulo: c.title ?? '',
        audioUrl: c.audio_url && !/audiopipe/.test(c.audio_url) ? c.audio_url : `https://cdn1.suno.ai/${c.id}.mp3`,
        capaUrl: c.image_large_url ?? c.image_url,
        prompt: [c.metadata?.gpt_description_prompt, c.metadata?.tags && `Estilo: ${c.metadata.tags}`, c.metadata?.prompt].filter(Boolean).join('\n\n')
      }, baixarComLogin)
      if (item) {
        logOk('Suno', `Música "${c.title || c.id}" salva na galeria (${galeria.pastaGaleria()}).`)
        avisar('galeria', [item])
      }
    } catch (e: any) {
      const n = (falhas.get(c.id) ?? 0) + 1
      falhas.set(c.id, n)
      if (n < 3) salvando.delete(c.id) // tenta de novo (até 3 vezes)
      logAviso('Suno', `Não consegui baixar "${c.title || c.id}": ${e.message}${n >= 3 ? ' (desisti; use "Puxar as últimas do Suno" ou o Download do site)' : ''}`)
    }
  }
}

function vigiar(pg: Page) {
  if ((pg as any).__vigiado) return
  ;(pg as any).__vigiado = true
  pg.on('response', async (res) => {
    try {
      const u = res.url()
      if (!/studio-api|suno\.com\/(a\/)?api/.test(u) || res.request().method() === 'OPTIONS') return
      if (!/json/.test(res.headers()['content-type'] ?? '')) return
      const clipes = acharClipes(await res.json())
      if (!clipes.length) return
      if (/\/generate|\/create/i.test(new URL(u).pathname)) for (const c of clipes) pedidasAgora.add(c.id)
      await guardarClipes(clipes)
    } catch {
      /* resposta que não interessa */
    }
  })
  pg.on('request', async (req) => {
    try {
      if (req.method() !== 'POST' || !/suno\.(com|ai)/.test(req.url()) || enviandoDireto > 0) return
      const url = new URL(req.url())
      // anota os endereços que o site usa (ajuda a achar o problema se o Suno mudar)
      if (/studio-api|\/api\//.test(req.url()) && !vistos.has(url.pathname) && vistos.size < 40) {
        vistos.add(url.pathname)
        logInfo('Suno', `Site do Suno chamou: POST ${url.host}${url.pathname}`)
      }
      if (!/\/generate|\/create/i.test(url.pathname)) return
      // o corpo do pedido às vezes não vem junto: aí pede ao Chrome
      let dados = req.postData()
      if (!dados && req.hasPostData()) dados = await req.fetchPostData().catch(() => undefined)
      if (!dados) return logAviso('Suno', `Vi o pedido de criar (${url.pathname}), mas não consegui ler as opções.`)
      const corpo = JSON.parse(dados)
      if (corpo && typeof corpo === 'object' && ('prompt' in corpo || 'tags' in corpo || 'mv' in corpo || 'gpt_description_prompt' in corpo)) aprender(corpo, req.url())
    } catch {
      /* pedido diferente: ignora */
    }
  })
}

type Modo = 'login' | 'janela' | 'fundo'
let processo: ChildProcess | null = null
let modoAtual: Modo | null = null
let conexao: Browser | null = null
let avisar: (canal: string, dado: unknown) => void = () => undefined

export interface StatusSuno {
  navegador: string | null // caminho do Chrome/Edge encontrado
  aberto: Modo | null
}

function acharNavegador(): string | null {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] ?? ''
  const opcoes = [
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')
  ]
  return opcoes.find((p) => p && fs.existsSync(p)) ?? null
}

const status = (): StatusSuno => ({ navegador: acharNavegador(), aberto: modoAtual })
const mudou = () => avisar('suno-status', status())

async function fechar() {
  try {
    await conexao?.close() // fecha o navegador do Suno inteiro
  } catch {
    /* já fechado */
  }
  conexao = null
  if (processo && processo.exitCode === null) processo.kill()
  // espera o Chrome soltar a pasta do perfil
  for (let i = 0; i < 30 && processo && processo.exitCode === null; i++) await new Promise((r) => setTimeout(r, 200))
  processo = null
  modoAtual = null
  mudou()
}

/**
 * login  = Chrome normal, SEM controle do programa (é assim que o Google aceita o login).
 * janela = Chrome visível, para você usar o site; o programa acompanha e guarda as músicas.
 * fundo  = Chrome escondido, só para o "Gerar direto" e para guardar as músicas.
 */
async function abrir(modo: Modo): Promise<StatusSuno> {
  const exe = acharNavegador()
  if (!exe) throw new Error('Não achei o Google Chrome nem o Microsoft Edge neste PC. Instale o Chrome (google.com/chrome) e tente de novo.')
  if (modoAtual === modo && processo?.exitCode === null) return status()
  if (modoAtual) await fechar()
  fs.mkdirSync(pastaPerfil(), { recursive: true })
  const args = [`--user-data-dir=${pastaPerfil()}`, '--no-first-run', '--no-default-browser-check', '--disable-features=ChromeWhatsNewUI']
  if (modo !== 'login') args.push(`--remote-debugging-port=${PORTA}`, '--remote-allow-origins=*')
  // "fundo": janela normal (o Suno recusa o Chrome invisível), só que fora da tela e sem som
  if (modo === 'fundo') args.push('--window-position=-32000,-32000', '--window-size=1280,900', '--mute-audio')
  // janela visível sempre no meio da tela (senão o Chrome lembra a posição escondida do modo de fundo)
  else args.push('--window-position=80,60', '--window-size=1400,900')
  args.push('https://suno.com/create')
  const p = spawn(exe, args, { detached: false, stdio: 'ignore' })
  processo = p
  modoAtual = modo
  p.on('exit', () => {
    if (processo === p) {
      processo = null
      modoAtual = null
      conexao = null
      mudou()
    }
  })
  if (modo === 'janela')
    setTimeout(
      () =>
        conectar()
          .then(async (b) => {
            logInfo('Suno', `Acompanhando o site do Suno (${(await b.pages()).length} aba(s)): o próximo Create que você fizer lá ensina as opções ao programa.`)
            const pg = (await b.pages()).find((x) => /suno\.com/.test(x.url()))
            await pg?.bringToFront().catch(() => undefined)
          })
          .catch((e) => logAviso('Suno', `Não consegui acompanhar a janela do Suno: ${e.message}`)),
      1500
    )
  logInfo('Suno', modo === 'login' ? 'Janela de login do Suno aberta no Chrome.' : modo === 'janela' ? 'Suno aberto no Chrome.' : 'Suno ligado em segundo plano.')
  mudou()
  return status()
}

async function conectar(): Promise<Browser> {
  if (conexao?.connected) return conexao
  if (modoAtual === 'login') throw new Error('Termine o login e feche a janela do Chrome primeiro (ou clique em "Já entrei").')
  if (!modoAtual) await abrir('fundo')
  let ultimoErro: any
  for (let i = 0; i < 40; i++) {
    try {
      conexao = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORTA}`, defaultViewport: null })
      conexao.on('disconnected', () => (conexao = null))
      // acompanha os pedidos que você faz no site (para aprender as opções)
      for (const pg of await conexao.pages()) vigiar(pg)
      conexao.on('targetcreated', async (t) => {
        const pg = await t.page().catch(() => null)
        if (pg) vigiar(pg)
      })
      // downloads feitos à mão no site vão direto para a galeria
      try {
        const cdp = await conexao.target().createCDPSession()
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: galeria.pastaGaleria() })
      } catch {
        /* sem problema */
      }
      return conexao
    } catch (e) {
      ultimoErro = e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`Não consegui falar com o Chrome do Suno (${ultimoErro?.message ?? 'sem resposta'}).`)
}

async function paginaDoSuno(): Promise<Page> {
  const b = await conectar()
  const paginas = await b.pages()
  let p = paginas.find((x) => /^https:\/\/([a-z]+\.)?suno\.com/.test(x.url()))
  if (!p) {
    p = paginas[0] ?? (await b.newPage())
    await p.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  }
  // espera o login do site carregar
  await p.waitForFunction('document.readyState === "complete"', { timeout: 30_000 }).catch(() => undefined)
  return p
}

export interface RespostaSuno {
  login: boolean
  status?: number
  json?: any
  texto?: string
}

// Pega o "passe" (token) da sua sessão do Suno.
// 1º jeito: pergunta ao próprio site (Clerk, o sistema de login do Suno).
// 2º jeito: lê o cookie de login do Chrome e pede o token direto ao Clerk.
async function pegarToken(p: Page): Promise<{ token: string | null; motivo: string }> {
  const doSite = await p
    .evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        const c = (window as any).Clerk
        try {
          if (c?.loaded || c?.session) {
            const t = await c.session?.getToken()
            if (t) return t as string
            if (c.loaded && !c.session) return null
          }
        } catch {
          /* tenta de novo */
        }
        const ck = (document.cookie.match(/(?:^|; )__session=([^;]+)/) || [])[1]
        if (ck) return ck
        await new Promise((r) => setTimeout(r, 500))
      }
      return null
    })
    .catch(() => null)
  if (doSite) return { token: doSite, motivo: '' }

  // 2º jeito: cookie "__client" do Clerk
  try {
    const cdp = await p.createCDPSession()
    const { cookies } = (await cdp.send('Network.getAllCookies')) as { cookies: { name: string; value: string; domain: string }[] }
    await cdp.detach().catch(() => undefined)
    const cliente = cookies.find((c) => c.name === '__client' && /suno/.test(c.domain))
    const nomes = [...new Set(cookies.filter((c) => /suno/.test(c.domain)).map((c) => c.name))].slice(0, 12).join(', ')
    if (!cliente) return { token: null, motivo: `sem cookie de login (${p.url()}; cookies: ${nomes || 'nenhum'})` }
    const dominio = cliente.domain.replace(/^\./, '')
    const base = `https://${/^(clerk|auth)\./.test(dominio) ? dominio : 'clerk.' + dominio}`
    const cab = { Cookie: `__client=${cliente.value}`, Origin: 'https://suno.com' }
    const c: any = await fetch(`${base}/v1/client?_clerk_js_version=5`, { headers: cab }).then((r) => r.json())
    const sid = c?.response?.last_active_session_id ?? c?.response?.sessions?.[0]?.id
    if (!sid) return { token: null, motivo: `o Clerk não achou sessão ativa (${base})` }
    const t: any = await fetch(`${base}/v1/client/sessions/${sid}/tokens?_clerk_js_version=5`, { method: 'POST', headers: cab }).then((r) => r.json())
    return t?.jwt ? { token: t.jwt, motivo: '' } : { token: null, motivo: 'o Clerk não devolveu o token' }
  } catch (e: any) {
    return { token: null, motivo: `erro lendo o login: ${e.message}` }
  }
}

// Faz um pedido à API do Suno de dentro da página (com o login que está no Chrome).
async function pedir(caminho: string, metodo = 'GET', corpo?: unknown): Promise<RespostaSuno> {
  const p = await paginaDoSuno()
  const { token, motivo } = await pegarToken(p)
  if (!token) {
    logAviso('Suno', `Login não encontrado: ${motivo}`)
    return { login: false, texto: motivo }
  }
  enviandoDireto++
  return p.evaluate(
    async (url: string, metodo: string, corpo: string | null, tk: string) => {
      try {
        const r = await fetch(url, { method: metodo, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: corpo ?? undefined })
        const t = await r.text()
        let j = null
        try {
          j = JSON.parse(t)
        } catch {
          /* não é JSON */
        }
        return { login: true, status: r.status, json: j, texto: t.slice(0, 300) }
      } catch (e) {
        return { login: true, status: 0, texto: String(e) }
      }
    },
    /^https?:/.test(caminho) ? caminho : caminho.startsWith('/a/') ? 'https://suno.com' + caminho : API + caminho,
    metodo,
    corpo === undefined ? null : JSON.stringify(corpo),
    token
  ).finally(() => setTimeout(() => enviandoDireto--, 1000))
}

// Plano B do "Gerar direto": escreve o texto nos campos do site (você clica em Create).
async function preencher(dados: { descricao?: string; letra?: string; estilo?: string; titulo?: string }): Promise<string[]> {
  if (modoAtual !== 'janela') await abrir('janela')
  const p = await paginaDoSuno()
  await p.bringToFront().catch(() => undefined)
  return p.evaluate((d: typeof dados) => {
    const vis = (el: HTMLElement) => el.offsetParent !== null
    const pega = (re: RegExp) =>
      [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type=text], input:not([type])')]
        .filter(vis)
        .find((el) => re.test(`${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.name || ''}`))
    const por = (el: HTMLInputElement | HTMLTextAreaElement | undefined, v?: string) => {
      if (!el || !v) return false
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const ok: string[] = []
    if (d.descricao !== undefined) {
      if (por(pega(/describe|description|song about|descri|ideia|idea/i) ?? [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].filter(vis)[0], d.descricao)) ok.push('descrição')
    } else {
      if (por(pega(/lyric|letra/i), d.letra)) ok.push('letra')
      if (por(pega(/style|estilo|genre|g[eê]nero/i), d.estilo)) ok.push('estilo')
      if (por(pega(/title|t[ií]tulo/i), d.titulo)) ok.push('título')
    }
    return ok
  }, dados)
}

export function acoesSuno(avisarTela: (canal: string, dado: unknown) => void) {
  avisar = avisarTela
  desde()
  app.on('before-quit', () => {
    if (processo && processo.exitCode === null) processo.kill()
  })
  return {
    sunoStatus: () => status(),
    sunoPedido: () => lerPedido(),
    sunoEsquecerPedido: () => fs.rmSync(arqPedido(), { force: true }),
    sunoEntrar: () => abrir('login'),
    sunoAbrir: () => abrir('janela'),
    sunoFechar: () => fechar(),
    sunoApi: async (caminho: string, metodo?: string, corpo?: unknown) => {
      try {
        return await pedir(caminho, metodo, corpo)
      } catch (e: any) {
        logAviso('Suno', e.message)
        throw e
      }
    },
    sunoPreencher: (dados: Parameters<typeof preencher>[0]) => preencher(dados),
    sunoJaSalvos: () => galeria.sunoJaSalvos(),
    sunoGuardarSozinho: (v: boolean) => {
      guardarSozinho = v
    },
    // guarda todas as músicas prontas que o site já mostrou (abra o Suno e a sua biblioteca antes)
    sunoPuxarVistas: async () => {
      const ja = new Set(galeria.sunoJaSalvos())
      const lista = [...vistosNoSite.values()].filter((c) => c.status === 'complete' && !ja.has(c.id))
      await guardarClipes(lista, true)
      const agora = new Set(galeria.sunoJaSalvos())
      return { vistas: vistosNoSite.size, salvas: lista.filter((c) => agora.has(c.id)).length, falharam: lista.filter((c) => !agora.has(c.id)).length }
    },
    sunoNovas: (ids: string[]) => ids.forEach((i) => pedidasAgora.add(i)),
    sunoSalvar: async (m: { id: string; titulo: string; audioUrl: string; capaUrl?: string; prompt?: string }) => {
      const item = await galeria.salvarMusica(m, baixarComLogin)
      if (item) {
        logOk('Suno', `Música "${m.titulo || m.id}" salva na galeria.`)
        avisarTela('galeria', [item])
      }
      return item
    },
    sunoLog: (texto: string) => logInfo('Suno', texto)
  }
}
