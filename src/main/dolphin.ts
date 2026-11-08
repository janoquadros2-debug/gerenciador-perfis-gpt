// Conversa com o Dolphin Anty.
// - API na nuvem (dolphin-anty-api.com): listar, criar, apagar e editar perfis.
// - API local (localhost:3001): abrir e fechar navegadores. Só funciona com o Dolphin aberto no PC.
// Se o Dolphin mudar algum endereço, é só ajustar aqui.
import type { Perfil, Proxy } from '../shared/types'
import { store } from './store'
import { logAviso } from './log'
import { ARGS_MANTER_ATIVAS } from './ativas'

const NUVEM = 'https://dolphin-anty-api.com'
const local = () => `http://localhost:${store.config.portaLocalDolphin}`

async function nuvem<T = any>(caminho: string, init: RequestInit = {}): Promise<T> {
  const token = store.config.tokenDolphin
  if (!token) throw new Error('Cole o token da API do Dolphin em Configurações > Dolphin Anty.')
  const executar = () => fetch(NUVEM + caminho, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {})
    }
  })
  let r: Response
  try {
    r = await executar()
  } catch (e) {
    if (init.method || !store.config.recursosExtras?.retryLeituras) throw e
    await new Promise((ok) => setTimeout(ok, 900))
    r = await executar()
  }
  if (!init.method && store.config.recursosExtras?.retryLeituras && (r.status === 429 || r.status >= 500)) {
    await new Promise((ok) => setTimeout(ok, 1100))
    r = await executar()
  }
  const texto = await r.text()
  if (!r.ok) {
    if (r.status === 401) throw new Error('Token do Dolphin inválido ou expirado.')
    if (r.status === 402) throw new Error('Essa função exige um plano pago do Dolphin.')
    if (r.status === 429) throw new Error('Muitas requisições ao Dolphin. Aguarde um pouco.')
    let detalhe = texto.slice(0, 200)
    try {
      const j = JSON.parse(texto)
      const err = j.error ?? j
      detalhe = [err.code, err.text ?? err.message].filter(Boolean).join(': ') || detalhe
    } catch {
      /* resposta sem JSON */
    }
    throw new Error(`Dolphin recusou (${r.status}) ${detalhe}`)
  }
  return texto ? JSON.parse(texto) : ({} as T)
}

async function localApi<T = any>(caminho: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(local() + caminho, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    })
  } catch {
    throw new Error('Não encontrei o Dolphin Anty aberto neste PC. Abra o Dolphin e tente de novo.')
  }
  const texto = await r.text()
  const json = texto ? JSON.parse(texto) : {}
  if (!r.ok || json.success === false) {
    throw new Error(json.error || json.message || `Dolphin local respondeu ${r.status}`)
  }
  return json
}

let logadoLocal = false
export async function loginLocal(): Promise<void> {
  if (logadoLocal) return
  await localApi('/v1.0/auth/login-with-token', {
    method: 'POST',
    body: JSON.stringify({ token: store.config.tokenDolphin })
  })
  logadoLocal = true
}
export function esquecerLogin() {
  logadoLocal = false
}

export async function testarConexao(): Promise<{ nuvem: boolean; local: boolean; erro?: string }> {
  const res = { nuvem: false, local: false, erro: undefined as string | undefined }
  try {
    await nuvem('/browser_profiles?limit=1')
    res.nuvem = true
  } catch (e: any) {
    res.erro = e.message
  }
  try {
    esquecerLogin()
    await loginLocal()
    res.local = true
  } catch (e: any) {
    res.erro = res.erro ?? e.message
  }
  return res
}

function paraPerfil(p: any): Perfil {
  // Algumas respostas do Dolphin omitem a porta do proxy ou usam uma chave diferente.
  // Nunca exibir ":undefined" como se fosse um endereço válido.
  const bruto = p.proxy
  const host = typeof bruto?.host === 'string' ? bruto.host.trim() : ''
  const porta = Number(bruto?.port ?? bruto?.proxyPort ?? bruto?.proxy_port ?? bruto?.proxy_port_number)
  const portaValida = Number.isInteger(porta) && porta >= 1 && porta <= 65535
  const proxy = host ? `${bruto.type ?? 'http'}://${host}${portaValida ? ':' + porta : ''}` : undefined
  return {
    id: Number(p.id),
    nome: String(p.name ?? `Perfil ${p.id}`),
    etiquetas: Array.isArray(p.tags) ? p.tags.map(String) : [],
    plataforma: String(p.platform ?? 'windows'),
    proxyTexto: proxy,
    site: store.sitesPorPerfil[Number(p.id)],
    site2: store.sitesExtras[Number(p.id)]
  }
}

async function listarComCursor(): Promise<Perfil[]> {
  const todos: Perfil[] = []
  let cursor: string | undefined
  const visitados = new Set<string>()
  for (let n = 0; n < 250; n++) {
    const caminho: string = '/browser_profiles/list-cursor?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
    const r: any = await nuvem(caminho)
    const lista = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : []
    todos.push(...lista.map(paraPerfil))
    const prox: unknown = r.next_page_url ?? r.meta?.next_page_url ?? r.pagination?.next_page_url
    if (typeof prox !== 'string' || !prox || !lista.length) break
    const u = new URL(prox, NUVEM)
    if (u.origin !== NUVEM) throw new Error('A API retornou uma URL de cursor externa ao Dolphin.')
    cursor = u.searchParams.get('cursor') ?? undefined
    if (!cursor || visitados.has(cursor)) break
    visitados.add(cursor)
  }
  return todos
}

export async function listarPerfis(): Promise<Perfil[]> {
  if (store.config.recursosExtras?.apiCursor) return listarComCursor()

  const todos: Perfil[] = []
  let pagina = 1
  for (;;) {
    const r = await nuvem(`/browser_profiles?limit=50&page=${pagina}`)
    const lista: any[] = r.data ?? []
    todos.push(...lista.map(paraPerfil))
    const ultima = Number(r.last_page ?? r.meta?.last_page ?? 1)
    if (pagina >= ultima || lista.length === 0) break
    pagina++
  }
  return todos
}

function proxyParaDolphin(p?: Proxy | null) {
  if (!p) return null
  return {
    // o Dolphin só aceita http, socks4, socks5 e ssh: proxy HTTPS entra como "http" (é o mesmo protocolo de proxy)
    type: p.tipo === 'socks5' ? 'socks5' : (p.tipo as string) === 'socks4' ? 'socks4' : 'http',
    host: p.host,
    port: String(p.porta),
    login: p.usuario ?? '',
    password: p.senha ?? ''
  }
}

async function impressaoDigital(plataforma: string): Promise<any> {
  const q = `platform=${plataforma}&browser_type=anty&browser_version=latest&type=fingerprint`
  try {
    return await nuvem(`/fingerprints/fingerprint?${q}`)
  } catch {
    return {}
  }
}

// Cria um perfil. Se o Dolphin recusar a combinação de hardware (erro E_HARDWARE),
// tenta de novo com outra impressão digital; na última tentativa usa os valores reais do PC.
type OpcoesPerfil = { sistema: string; etiqueta?: string; proxy?: Proxy | null; privacidade?: 'anonimo' | 'padrao' }
// se o Dolphin recusar algum dos campos extras do modo anônimo, os próximos perfis são criados sem eles
let extrasRecusados = false

export async function criarPerfil(nome: string, opcoes: OpcoesPerfil) {
  const TENTATIVAS = 4
  for (let t = 1; ; t++) {
    const fp = t < TENTATIVAS ? await impressaoDigital(opcoes.sistema) : {}
    try {
      return await enviarPerfil(nome, opcoes, fp, t === TENTATIVAS, extrasRecusados)
    } catch (e: any) {
      const msg = String(e?.message)
      const hardware = /E_HARDWARE/.test(msg)
      // campo que o Dolphin não aceitou (versão diferente da API): tenta sem os extras do modo anônimo
      if (!hardware && !/E_PROXY/i.test(msg) && !extrasRecusados && ((opcoes.privacidade ?? 'anonimo') === 'anonimo' || store.config.manterAtivas !== false) && /\b4(00|22)\b|invalid|validation/i.test(msg)) {
        extrasRecusados = true
        logAviso('Criação', `O Dolphin recusou algumas opções extras de privacidade (${msg.slice(0, 120)}). Criando sem elas.`)
        t--
        continue
      }
      if (!hardware || t >= TENTATIVAS) throw e
    }
  }
}

// ---------- impressão digital única por perfil (modo "Mais anônimo") ----------
const sortear = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)]
function macAleatorio() {
  // endereço "administrado localmente" (2º caractere 2, 6, A ou E): parece de placa de rede real e nunca colide com um fabricante
  const b = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256))
  b[0] = (b[0] & 0xfc) | 0x02
  return b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':')
}
function nomeDoPc(sistema: string) {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  const id = Array.from({ length: 7 }, () => letras[Math.floor(Math.random() * letras.length)]).join('')
  if (sistema === 'macos') return `${sortear(['MacBook-Pro', 'MacBook-Air', 'iMac', 'Mac-mini'])}-${id.slice(0, 4)}`
  if (sistema === 'linux') return `${sortear(['ubuntu', 'desktop', 'pc', 'debian'])}-${id.toLowerCase().slice(0, 5)}`
  return `DESKTOP-${id}`
}
// telas comuns (tirada da impressão digital do Dolphin quando ela traz uma)
function tela(fp: any, sistema: string) {
  const w = Number(fp?.screen?.width ?? fp?.screenWidth)
  const h = Number(fp?.screen?.height ?? fp?.screenHeight)
  if (w > 0 && h > 0) return `${w}x${h}`
  return sistema === 'macos' ? sortear(['1440x900', '1512x982', '1728x1117', '2560x1440']) : sortear(['1920x1080', '1920x1080', '1366x768', '1536x864', '2560x1440', '1600x900'])
}

async function enviarPerfil(nome: string, opcoes: OpcoesPerfil, fp: any, simples: boolean, semExtras = false) {
  const anonimo = (opcoes.privacidade ?? 'anonimo') === 'anonimo'
  const corpo: any = {
    name: nome,
    tags: opcoes.etiqueta ? [opcoes.etiqueta] : [],
    platform: opcoes.sistema,
    browserType: 'anty',
    mainWebsite: '',
    useragent: fp.userAgent ? { mode: 'manual', value: fp.userAgent } : { mode: 'auto' },
    // WebRTC "altered": o site vê o IP do proxy, nunca o seu IP real
    webrtc: { mode: 'altered', ipAddress: null },
    // ruído: cada perfil desenha imagens e 3D com uma "assinatura" própria (não dá para ligar um perfil ao outro)
    canvas: { mode: anonimo ? 'noise' : 'real' },
    webgl: { mode: anonimo ? 'noise' : 'real' },
    webglInfo: !simples && fp.webgl
      ? { mode: 'manual', vendor: fp.webgl.unmaskedVendor, renderer: fp.webgl.unmaskedRenderer, webgl2Maximum: fp.webgl2Maximum }
      : { mode: 'off' },
    clientRect: { mode: anonimo ? 'noise' : 'real' },
    timezone: { mode: 'auto', value: null },
    locale: { mode: 'auto', value: null },
    geolocation: { mode: 'auto', latitude: null, longitude: null },
    // valores baixos (2 núcleos, 4 GB) são os que o Dolphin mais recusa, então usamos no mínimo 4 núcleos e 8 GB
    cpu: simples || !fp.hardwareConcurrency ? { mode: 'real' } : { mode: 'manual', value: Math.max(4, Number(fp.hardwareConcurrency)) },
    memory: simples || !fp.deviceMemory ? { mode: 'real' } : { mode: 'manual', value: Math.max(8, Number(fp.deviceMemory)) },
    doNotTrack: false,
    ports: { mode: 'protect', blacklist: '3389,5900,5800,7070,6568,5938' },
    platformVersion: fp.platformVersion,
    proxy: proxyParaDolphin(opcoes.proxy)
  }
  // janelas cobertas não "dormem" (opção da criação de perfis)
  if (store.config.manterAtivas !== false && !semExtras) corpo.args = ARGS_MANTER_ATIVAS
  if (anonimo) {
    corpo.audio = { mode: 'noise' }
    if (!semExtras) {
      corpo.screen = { mode: 'manual', resolution: tela(fp, opcoes.sistema) }
      corpo.mediaDevices = { mode: 'manual', audioInputs: sortear([1, 1, 2]), videoInputs: sortear([0, 1, 1]), audioOutputs: sortear([1, 2, 2]) }
      corpo.macAddress = { mode: 'manual', value: macAleatorio() }
      corpo.deviceName = { mode: 'manual', value: nomeDoPc(opcoes.sistema) }
    }
  }
  const r = await nuvem('/browser_profiles', { method: 'POST', body: JSON.stringify(corpo) })
  return Number(r.browserProfileId ?? r.data?.id ?? r.id)
}

export async function apagarPerfil(id: number) {
  await nuvem(`/browser_profiles/${id}?forceDelete=1`, { method: 'DELETE' })
}

export async function trocarProxyDoPerfil(id: number, proxy: Proxy | null) {
  await nuvem(`/browser_profiles/${id}`, { method: 'PATCH', body: JSON.stringify({ proxy: proxyParaDolphin(proxy) }) })
}

export async function abrirNavegador(id: number): Promise<{ porta: number; ws: string }> {
  await loginLocal()
  let r: any
  // Algumas inicializações retornam NoSuchKey ("Not detected NoSuchKey - server problem").
  // O Dolphin pode deixar a tentativa parcialmente registrada, sem janela aberta.
  // Repetimos apenas falhas conhecidas, com limite, sem apagar nem recriar o perfil.
  for (let t = 1; ; t++) {
    try {
      r = await localApi(`/v1.0/browser_profiles/${id}/start?automation=1`)
      break
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      const naoAchou = /not found|não encontrado/i.test(msg)
      const jaAberto = /already|is running|running/i.test(msg)
      const falhaChave = /NoSuchKey|not detected.{0,80}server problem/i.test(msg)
      const recuperavel = naoAchou || jaAberto || falhaChave
      // Erros de chave/servidor: no máximo quatro tentativas no total.
      // Os "not found"/"already running" seguem com o limite antigo de seis.
      const maximo = falhaChave ? 4 : 6
      if (!recuperavel || t >= maximo) {
        if (falhaChave) {
          logAviso('Dolphin', `Perfil #${id}: erro NoSuchKey persistiu após ${t} tentativa(s). Confira o log e o estado do perfil no Dolphin.`)
        }
        throw e
      }

      const esperaMs = falhaChave ? Math.min(9000, 2500 * t) : naoAchou ? 3000 * t : 2500
      logAviso('Dolphin', `Perfil #${id}: falha temporária na inicialização (${falhaChave ? 'NoSuchKey' : naoAchou ? 'perfil ainda não sincronizado' : 'perfil já em execução'}). Tentando recuperar (${t + 1}/${maximo})…`)
      // Equivale a "Fechar" antes de tentar abrir outra vez. Não exclui o perfil.
      await localApi(`/v1.0/browser_profiles/${id}/stop`).catch((erro) =>
        logAviso('Dolphin', `Perfil #${id}: tentativa de encerramento retornou ${String(erro?.message ?? erro).slice(0, 160)}.`)
      )
      await new Promise((ok) => setTimeout(ok, esperaMs))
    }
  }
  const porta = Number(r.automation?.port)
  let ws: string = r.automation?.wsEndpoint ?? ''
  if (!porta) throw new Error('O Dolphin não devolveu a porta de automação.')
  // o Dolphin às vezes devolve só o caminho (/devtools/browser/...)
  if (!ws.startsWith('ws')) ws = `ws://127.0.0.1:${porta}${ws.startsWith('/') ? '' : '/'}${ws}`
  return { porta, ws }
}

export async function fecharNavegador(id: number) {
  try {
    await localApi(`/v1.0/browser_profiles/${id}/stop`)
  } catch {
    // se já estava fechado, tudo bem
  }
}
