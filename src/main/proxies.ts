// Proxies: leitura da lista, teste, distribuição entre perfis e contador de uso.
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { Proxy, ResultadoTesteProxy, TipoProxy } from '../shared/types'
import { store } from './store'

// Aceita: host:porta | host:porta:usuario:senha | usuario:senha@host:porta | tipo://usuario:senha@host:porta
export function lerLinha(linha: string, tipoPadrao: TipoProxy): Proxy | null {
  let t = linha.trim()
  if (!t || t.startsWith('#')) return null
  let tipo: TipoProxy = tipoPadrao
  const m = t.match(/^(https?|socks5h?|socks):\/\//i)
  if (m) {
    const p = m[1].toLowerCase()
    tipo = p.startsWith('socks') ? 'socks5' : (p as TipoProxy)
    t = t.slice(m[0].length)
  }
  let usuario: string | undefined
  let senha: string | undefined
  let hostPorta = t
  if (t.includes('@')) {
    const [cred, hp] = t.split('@')
    ;[usuario, senha] = cred.split(':')
    hostPorta = hp
  }
  const partes = hostPorta.split(':')
  if (partes.length < 2) return null
  const [host, portaTxt, u, s] = partes
  const porta = Number(portaTxt)
  if (!host || !porta) return null
  if (!usuario && u) {
    usuario = u
    senha = s
  }
  return { id: randomUUID(), tipo, host, porta, usuario, senha, usos: 0 }
}

export function lerLista(texto: string, tipoPadrao: TipoProxy): Proxy[] {
  return texto.split(/\r?\n/).map((l) => lerLinha(l, tipoPadrao)).filter(Boolean) as Proxy[]
}

export function proxyParaTexto(p: Proxy, comSenha = false): string {
  const cred = p.usuario ? `${p.usuario}${comSenha ? ':' + (p.senha ?? '') : ''}@` : ''
  return `${p.tipo}://${cred}${p.host}:${p.porta}`
}

function urlDoProxy(p: Proxy): string {
  const cred = p.usuario ? `${encodeURIComponent(p.usuario)}:${encodeURIComponent(p.senha ?? '')}@` : ''
  const esquema = p.tipo === 'socks5' ? 'socks5' : 'http'
  return `${esquema}://${cred}${p.host}:${p.porta}`
}

export function testarProxy(p: Proxy, tempoLimite = 12000): Promise<ResultadoTesteProxy> {
  const agent = p.tipo === 'socks5' ? new SocksProxyAgent(urlDoProxy(p)) : new HttpsProxyAgent(urlDoProxy(p))
  const inicio = Date.now()
  return new Promise((resolve) => {
    let finalizado = false
    const fim = (r: Omit<ResultadoTesteProxy, 'quando'>) => {
      if (finalizado) return
      finalizado = true
      resolve({ ...r, quando: Date.now() })
    }
    const req = https.get('https://ipwho.is/', { agent, timeout: tempoLimite }, (res) => {
      let corpo = ''
      res.on('data', (c) => (corpo += c))
      res.on('end', () => {
        const httpStatus = res.statusCode ?? 0
        if (httpStatus !== 200) {
          fim({ ok: false, erro: httpStatus === 407 ? 'Autenticação do proxy recusada' : `HTTP ${httpStatus} no teste`, categoria: httpStatus === 407 ? 'autenticacao' : 'http', httpStatus, ms: Date.now() - inicio })
          return
        }
        try {
          const j = JSON.parse(corpo)
          if (!j.ip || j.success === false) fim({ ok: false, erro: 'IP de saída não confirmado', categoria: 'resposta', ms: Date.now() - inicio })
          else fim({ ok: true, ip: j.ip, pais: j.country, cidade: j.city, ms: Date.now() - inicio, categoria: 'ok', httpStatus })
        } catch {
          fim({ ok: false, erro: 'Resposta inesperada do teste', categoria: 'resposta' })
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      fim({ ok: false, erro: 'Tempo esgotado', categoria: 'tempo', ms: Date.now() - inicio })
    })
    req.on('error', (e: any) => {
      const msg = String(e?.message ?? e)
      let erro = 'Proxy inacessível ou conexão indisponível'
      let categoria: NonNullable<ResultadoTesteProxy['categoria']> = 'conexao'
      if (/407|auth|credentials/i.test(msg)) { erro = 'Usuário ou senha do proxy incorretos'; categoria = 'autenticacao' }
      else if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) { erro = 'DNS do proxy não encontrado'; categoria = 'dns' }
      else if (/TIMEOUT|ETIMEDOUT/i.test(msg)) { erro = 'Proxy demorou a responder'; categoria = 'tempo' }
      else if (/ECONNREFUSED/i.test(msg)) erro = 'Proxy recusou a conexão'
      else if (/ECONNRESET|EPIPE/i.test(msg)) erro = 'Conexão encerrada no teste'
      fim({ ok: false, erro, categoria, ms: Date.now() - inicio })
    })
  })
}

export async function testarVarios(lista: Proxy[], simultaneos = 10, aoTerminarUm?: (p: Proxy) => void) {
  const fila = [...lista]
  async function trabalhador() {
    for (;;) {
      const p = fila.shift()
      if (!p) return
      p.ultimoTeste = await testarProxy(p)
      if (store.config.recursosExtras?.historicoTestesProxy) {
        p.historicoTestes = [...(p.historicoTestes ?? []), p.ultimoTeste].slice(-20)
      }
      aoTerminarUm?.(p)
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneos, lista.length) }, trabalhador))
  return lista
}

// ---------- Distribuição ----------

export class ProxiesEsgotados extends Error {
  constructor() {
    super('Todos os proxies já foram usados. Aperte "Repetir" para liberar a lista.')
  }
}

export function proximoProxy(): Proxy {
  const lista = store.proxies
  if (lista.length === 0) throw new Error('A lista de proxies está vazia (aba Proxies).')
  const modo = store.config.modoDistribuicao
  let escolhido: Proxy

  if (modo === 'sequencia') {
    escolhido = lista[store.ponteiroSequencia % lista.length]
    store.ponteiroSequencia = store.ponteiroSequencia + 1
  } else if (modo === 'sorteado') {
    escolhido = lista[Math.floor(Math.random() * lista.length)]
  } else {
    const usados = new Set(store.usadosNaRodada)
    const livres = lista.filter((p) => !usados.has(p.id))
    if (livres.length === 0) throw new ProxiesEsgotados()
    escolhido = modo === 'sem-repetir' ? livres[0] : livres[Math.floor(Math.random() * livres.length)]
    store.usadosNaRodada = [...store.usadosNaRodada, escolhido.id]
  }

  escolhido.usos += 1
  if (store.config.recursosExtras?.validadeProxyInformativa && !escolhido.primeiroUsoEm) escolhido.primeiroUsoEm = Date.now()
  store.setProxies(lista)
  return escolhido
}

// Identifica o mesmo proxy mesmo que ele tenha sido colado de novo.
export const chaveProxy = (p: Proxy) => `${p.host.toLowerCase()}:${p.porta}:${p.usuario ?? ''}`

// Junta proxies colados (ex.: na criação em massa) à lista salva, sem duplicar.
// Devolve os proxies da lista salva correspondentes, na mesma ordem.
export function mesclarNaLista(novos: Proxy[]): Proxy[] {
  const lista = store.proxies
  const porChave = new Map(lista.map((p) => [chaveProxy(p), p]))
  const resultado = novos.map((n) => {
    const k = chaveProxy(n)
    let p = porChave.get(k)
    if (!p) {
      p = n
      lista.push(p)
      porChave.set(k, p)
    }
    return p
  })
  store.setProxies(lista)
  return resultado
}

// Marca o proxy como usado nesta rodada e soma no contador.
export function marcarUsado(p: Proxy) {
  if (!store.usadosNaRodada.includes(p.id)) store.usadosNaRodada = [...store.usadosNaRodada, p.id]
  p.usos += 1
  if (store.config.recursosExtras?.validadeProxyInformativa && !p.primeiroUsoEm) p.primeiroUsoEm = Date.now()
  store.setProxies(store.proxies)
}

// Próximo proxy da lista (na ordem) que ainda não foi usado nesta rodada.
export function proximoNaoUsado(): Proxy {
  const lista = store.proxies
  if (lista.length === 0) throw new Error('A lista de proxies está vazia. Adicione proxies na aba Proxies.')
  const usados = new Set(store.usadosNaRodada)
  const livre = lista.find((p) => !usados.has(p.id))
  if (!livre) throw new ProxiesEsgotados()
  marcarUsado(livre)
  return livre
}

export function repetirLista() {
  store.usadosNaRodada = []
  store.ponteiroSequencia = 0
}

export function zerarContagem() {
  store.setProxies(store.proxies.map((p) => ({ ...p, usos: 0 })))
}
