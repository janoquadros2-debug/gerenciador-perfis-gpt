// O "motor": abre, acompanha, reabre, substitui e encerra os navegadores.
import { EventEmitter } from 'node:events'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import type { EstadoMotor, Navegador, Perfil, Proxy, TempoAberto } from '../shared/types'
import { sortearDuracao } from '../shared/sorteio'
import { type ModoCookies, vigiarCookies } from './cookies'
import * as dolphin from './dolphin'
import { retanguloDoSlot } from './janelas'
import { ProxiesEsgotados, proximoProxy, proxyParaTexto, testarProxy } from './proxies'
import { logErro, logInfo, logOk, logAviso } from './log'
import { limparRam, usoRam } from './ram'
import { store } from './store'

interface Sessao {
  info: Navegador
  perfil: Perfil
  browser?: Browser
  encerradoPorVoce: boolean
  abaAtiva?: number // aba que você está controlando pelo "Ao vivo" (tela grande)
  recarregar?: TempoAberto // F5 sozinho (fixo ou aleatório)
  cookies?: ModoCookies
  tempoAberto?: TempoAberto
  aoAcabar?: 'fechar' | 'reabrir'
  fechando?: boolean
}

interface ItemFila {
  perfil: Perfil
  slot?: number
  proxy?: Proxy | null // proxy definido na hora (substituição)
  manterProxy?: boolean // usa o proxy que já está no perfil, sem tirar da lista
  duracaoMs?: number // quanto tempo fica aberto (conta a partir de quando abrir)
  fechaEm?: number // horário já marcado para fechar (ao reabrir, mantém o mesmo)
  recarregar?: TempoAberto // F5 sozinho de tempos em tempos
  cookies?: ModoCookies // aviso de cookies: aceitar/recusar sozinho
  tempoAberto?: TempoAberto // para sortear um tempo novo ao reabrir
  aoAcabar?: 'fechar' | 'reabrir'
}

const ABRIR_AO_MESMO_TEMPO = 3
const INTERVALO_MINIATURA = { rapida: 1000, normal: 2500, economica: 6000, desligadas: 0 }

export class Motor extends EventEmitter {
  perfis: Perfil[] = []
  private sessoes = new Map<number, Sessao>()
  private fila: ItemFila[] = []
  private abrindoAgora = 0
  private pausado = false
  private avisos: string[] = []
  private proxiesEsgotados = false
  private timerMiniatura?: NodeJS.Timeout
  private timerVerificacao?: NodeJS.Timeout
  private timerEstado?: NodeJS.Timeout

  constructor() {
    super()
    this.agendarMiniaturas()
    this.agendarVerificacao()
    setInterval(() => {
      this.verificarTempos()
      this.avisarMudanca() // atualiza a RAM na tela
    }, 2000)
  }

  // ---------- estado para a interface ----------
  ram() {
    return usoRam()
  }

  // Botão "Limpar RAM" e limpeza automática ao chegar no limite.
  private ultimaLimpeza = 0
  async limparRam(automatica = false) {
    this.ultimaLimpeza = Date.now()
    logInfo('Memória', automatica ? 'Limite de RAM atingido: limpando a memória sozinho…' : 'Limpando a memória RAM…')
    const navegadores = [...this.sessoes.values()].map((s) => s.browser).filter((b): b is Browser => !!b?.connected)
    const r = await limparRam(navegadores)
    const gb = (r.liberado / 1024 ** 3).toFixed(1).replace('.', ',')
    if (r.liberado > 50 * 1024 ** 2) logOk('Memória', `Limpeza feita: ${r.antes}% → ${r.depois}% (liberou ${gb} GB).`)
    else logInfo('Memória', `Limpeza feita: ${r.antes}% → ${r.depois}%. O PC já estava com pouca memória sobrando para liberar.`)
    this.avisarMudanca()
    return r
  }

  estado(): EstadoMotor {
    return {
      pausado: this.pausado,
      navegadores: [...this.sessoes.values()].map((s) => s.info).sort((a, b) => a.slot - b.slot),
      fila: this.fila.length,
      ram: this.ram(),
      avisos: this.avisos.slice(-5),
      proxiesEsgotados: this.proxiesEsgotados
    }
  }

  private avisarMudanca() {
    if (this.timerEstado) return
    this.timerEstado = setTimeout(() => {
      this.timerEstado = undefined
      this.emit('estado', this.estado())
    }, 150)
  }

  private aviso(texto: string, origem = 'Programa') {
    logAviso(origem, texto)
    this.avisos.push(texto)
    this.avisarMudanca()
  }

  // Fecha os navegadores cujo tempo acabou (com o programa pausado, espera retomar).
  private verificarTempos() {
    if (this.pausado) return
    const agora = Date.now()
    // F5 automático (fixo ou aleatório): recarrega e já sorteia o próximo
    for (const s of this.sessoes.values()) {
      if (!s.recarregar || !s.info.proximoF5 || s.info.proximoF5 > agora || s.info.status !== 'ok') continue
      s.info.proximoF5 = agora + (sortearDuracao(s.recarregar) ?? 60_000)
      logInfo(`Navegador #${s.info.slot}`, `F5 automático em ${s.perfil.nome} (próximo às ${new Date(s.info.proximoF5).toLocaleTimeString('pt-BR')}).`)
      this.f5(s.info.slot).catch(() => undefined)
      this.avisarMudanca()
    }
    // tempo aberto acabou: fecha (e, se escolhido, abre de novo com um tempo novo)
    const vencidos = [...this.sessoes.values()].filter((s) => s.info.fechaEm && s.info.fechaEm <= agora && !s.fechando && s.info.status !== 'abrindo')
    for (const s of vencidos) this.fecharPorTempo(s).catch(() => undefined)
  }

  // aviso vindo de fora do motor (ex.: "+1 / Adicionar")
  avisar(texto: string, proxiesEsgotados = false) {
    if (proxiesEsgotados) this.proxiesEsgotados = true
    this.aviso(texto)
  }

  limparAvisos() {
    this.avisos = []
    this.proxiesEsgotados = false
    this.avisarMudanca()
  }

  // ---------- abrir ----------
  abrir(
    perfis: Perfil[],
    opcoes: { manterProxy?: boolean; duracaoMs?: number; recarregar?: TempoAberto; cookies?: ModoCookies; tempoAberto?: TempoAberto; aoAcabar?: 'fechar' | 'reabrir' } = {}
  ) {
    const ocupados = new Set([...this.sessoes.values()].map((s) => s.perfil.id).concat(this.fila.map((f) => f.perfil.id)))
    const recarregar = opcoes.recarregar && opcoes.recarregar.modo !== 'sem-limite' ? opcoes.recarregar : undefined
    for (const p of perfis) if (!ocupados.has(p.id)) this.fila.push({
          perfil: p,
          manterProxy: opcoes.manterProxy,
          // cada perfil sorteia o seu próprio tempo
          duracaoMs: opcoes.tempoAberto ? sortearDuracao(opcoes.tempoAberto) : opcoes.duracaoMs,
          recarregar,
          cookies: opcoes.cookies,
          tempoAberto: opcoes.tempoAberto && opcoes.tempoAberto.modo !== 'sem-limite' ? opcoes.tempoAberto : undefined,
          aoAcabar: opcoes.aoAcabar
        })
    this.avisarMudanca()
    this.processarFila()
  }

  // Abre mais N perfis que ainda não estão abertos (opcional: só de uma etiqueta)
  adicionar(quantidade: number, etiqueta?: string) {
    const ocupados = new Set([...this.sessoes.values()].map((s) => s.perfil.id).concat(this.fila.map((f) => f.perfil.id)))
    const livres = this.perfis.filter((p) => !ocupados.has(p.id) && (!etiqueta || p.etiquetas.includes(etiqueta)))
    if (livres.length < quantidade) this.aviso(`Só havia ${livres.length} perfis livres para abrir.`)
    this.abrir(livres.slice(0, quantidade))
  }

  private proximoSlotLivre(): number {
    const usados = new Set([...this.sessoes.keys()].concat(this.fila.map((f) => f.slot ?? 0)))
    let s = 1
    while (usados.has(s)) s++
    return s
  }

  private async processarFila() {
    while (!this.pausado && this.fila.length > 0 && this.abrindoAgora < ABRIR_AO_MESMO_TEMPO) {
      const cfg = store.config
      if (cfg.limitadorRam && this.ram().porcentagem >= cfg.limiteRam) {
        // tenta limpar a RAM sozinho (no máximo 1 vez por minuto) antes de esperar
        if (cfg.limparRamAuto && Date.now() - this.ultimaLimpeza > 60_000) {
          this.limparRam(true).finally(() => this.processarFila())
          return
        }
        this.aviso(`Limite de memória atingido (${cfg.limiteRam}%). Aguardando para abrir os próximos.`)
        setTimeout(() => this.processarFila(), 4000)
        return
      }
      const item = this.fila.shift()!
      this.abrindoAgora++
      this.abrirUm(item).finally(() => {
        this.abrindoAgora--
        this.processarFila()
      })
    }
  }

  private async escolherProxy(): Promise<Proxy | null> {
    const cfg = store.config
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const p = proximoProxy()
      if (!cfg.testarProxyAntes) return p
      const r = await testarProxy(p)
      p.ultimoTeste = r
      if (r.ok) return p
    }
    throw new Error('Nenhum proxy funcionou nas últimas 5 tentativas.')
  }

  private async abrirUm(item: ItemFila) {
    const cfg = store.config
    const slot = item.slot ?? this.proximoSlotLivre()
    const anterior = this.sessoes.get(slot)
    const sessao: Sessao = {
      perfil: item.perfil,
      encerradoPorVoce: false,
      // ao reabrir ou substituir no mesmo lugar, o F5 automático continua
      recarregar: item.recarregar ?? anterior?.recarregar,
      cookies: item.cookies ?? anterior?.cookies,
      tempoAberto: item.tempoAberto ?? anterior?.tempoAberto,
      aoAcabar: item.aoAcabar ?? anterior?.aoAcabar,
      info: {
        slot,
        perfilId: item.perfil.id,
        perfilNome: item.perfil.nome,
        sistema: nomeSistema(item.perfil.plataforma),
        status: 'abrindo',
        proxy: item.perfil.proxyTexto,
        quedas: anterior?.perfil.id === item.perfil.id ? anterior.info.quedas : 0,
        abertoEm: Date.now(),
        fechaEm: item.fechaEm,
        reabreAoAcabar: (item.aoAcabar ?? anterior?.aoAcabar) === 'reabrir' && !!(item.tempoAberto ?? anterior?.tempoAberto)
      }
    }
    this.sessoes.set(slot, sessao)
    this.avisarMudanca()
    const quem = `Navegador #${slot}`
    logInfo(quem, `Abrindo ${item.perfil.nome}${anterior?.perfil.id === item.perfil.id ? ' de novo' : ''}…`)

    try {
      // 1. proxy
      let proxy = item.proxy
      if (proxy === undefined && cfg.usarListaDeProxies && !item.manterProxy) proxy = await this.escolherProxy()
      if (proxy !== undefined) {
        await dolphin.trocarProxyDoPerfil(item.perfil.id, proxy)
        sessao.info.proxy = proxy ? proxyParaTexto(proxy) : 'Sem proxy'
        logInfo(quem, `${item.perfil.nome}: proxy ${proxy ? `${proxy.host}:${proxy.porta}` : 'nenhum (seu IP)'}`)
      }

      // 2. abre pelo Dolphin e conecta
      const { ws } = await dolphin.abrirNavegador(item.perfil.id)
      const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
      sessao.browser = browser
      browser.on('disconnected', () => this.aoCair(slot, sessao))
      // aviso de cookies: aceita (ou recusa) sozinho, em todas as abas
      if (sessao.cookies && sessao.cookies !== 'desligado')
        vigiarCookies(browser, () => sessao.cookies ?? 'desligado', (url) =>
          logInfo(quem, `${item.perfil.nome}: ${sessao.cookies === 'aceitar' ? 'aceitei' : 'recusei'} o aviso de cookies em ${url.replace(/^https?:\/\//, '').slice(0, 60)}.`)
        ).catch(() => undefined)

      // 3. posiciona a janela
      if (cfg.janelas.ativo) await this.posicionar(slot).catch(() => undefined)

      // 4. confere o IP
      if (cfg.conferirIp) {
        // se nenhum site de IP responder, o navegador segue normal (só fica sem o IP na tela)
        try {
          const ip = await conferirIp(browser)
          sessao.info.ip = ip.ip
          sessao.info.pais = ip.pais
        } catch (e: any) {
          sessao.info.ip = undefined
          sessao.info.pais = 'não conferido'
          logAviso(quem, `${item.perfil.nome}: não consegui conferir o IP (${e.message}). O navegador continua aberto.`)
        }
      }

      // 5. abre o site e passa a vigiar a página (URL e falhas de conexão)
      const site = normalizarSite(item.perfil.site || cfg.siteInicial)
      const pagina = await paginaPrincipal(browser)
      this.vigiarPagina(sessao, pagina)
      sessao.info.url = site
      const resposta = await pagina.goto(site, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => {
        this.falhaNoSite(sessao, traduzirErro(e))
        throw e
      })
      if (resposta && resposta.status() >= 400) throw new Error(`O site respondeu com erro ${resposta.status()}`)
      sessao.info.siteOk = true
      sessao.info.verificadoEm = Date.now()

      // 2ª aba (se escolhida na criação): abre ao lado e volta para a principal
      if (item.perfil.site2) {
        const site2 = normalizarSite(item.perfil.site2)
        browser
          .newPage()
          .then(async (aba) => {
            await aba.goto(site2, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => logAviso(quem, `${item.perfil.nome}: a 2ª aba (${site2}) não abriu: ${traduzirErro(e)}`))
            await pagina.bringToFront().catch(() => undefined)
          })
          .catch(() => undefined)
      }

      // tempo aberto: começa a contar quando o navegador abriu de verdade
      if (!sessao.info.fechaEm && item.duracaoMs) sessao.info.fechaEm = Date.now() + item.duracaoMs
      // F5 automático: marca o primeiro
      if (sessao.recarregar) sessao.info.proximoF5 = Date.now() + (sortearDuracao(sessao.recarregar) ?? 0)
      sessao.info.status = 'ok'
      sessao.info.erro = undefined
      logOk(
        quem,
        `${item.perfil.nome} aberto em ${site}` +
          (sessao.info.ip ? ` · IP ${sessao.info.ip}${sessao.info.pais ? ` (${sessao.info.pais})` : ''}` : '') +
          (sessao.info.fechaEm ? ` · fecha às ${new Date(sessao.info.fechaEm).toLocaleTimeString('pt-BR')}` : '')
      )
    } catch (e: any) {
      if (e instanceof ProxiesEsgotados) {
        this.proxiesEsgotados = true
        this.pausado = true
        this.fila.unshift({ perfil: item.perfil, slot })
        this.sessoes.delete(slot)
        this.aviso(e.message + ' O programa foi pausado.')
        return
      }
      sessao.info.status = 'erro'
      sessao.info.erro = traduzirErro(e)
      logErro(quem, `${item.perfil.nome} não abriu: ${sessao.info.erro}`)
      // se o problema foi ao carregar o site, o verificador tira o erro sozinho quando o site voltar
      if (sessao.info.url && sessao.info.siteOk !== true) {
        sessao.info.siteOk = false
        sessao.info.erroDoSite = true
        sessao.info.verificadoEm = Date.now()
      }
    }
    this.avisarMudanca()
  }

  private aoCair(slot: number, sessao: Sessao) {
    if (this.sessoes.get(slot) !== sessao) return // já foi substituído
    if (sessao.encerradoPorVoce) return
    const cfg = store.config
    sessao.info.quedas += 1
    logErro(`Navegador #${slot}`, `${sessao.perfil.nome} fechou ou caiu sozinho (queda ${sessao.info.quedas}).`)
    if (cfg.reabrirSeCair && !this.pausado && sessao.info.quedas <= cfg.tentativasReabrir) {
      sessao.info.status = 'abrindo'
      sessao.info.erro = `Caiu, reabrindo (${sessao.info.quedas}/${cfg.tentativasReabrir})`
      this.fila.unshift({ perfil: sessao.perfil, slot, proxy: undefined, fechaEm: sessao.info.fechaEm })
      this.processarFila()
    } else {
      sessao.info.status = 'erro'
      sessao.info.erro =
        sessao.info.quedas > cfg.tentativasReabrir ? `Caiu ${sessao.info.quedas} vezes` : 'O navegador fechou'
    }
    this.avisarMudanca()
  }

  // ---------- ações ----------
  async f5(slot: number) {
    const s = this.sessoes.get(slot)
    if (!s) return
    if (!s.browser?.connected) {
      this.fila.unshift({ perfil: s.perfil, slot, fechaEm: s.info.fechaEm })
      this.processarFila()
      return
    }
    try {
      const p = await paginaPrincipal(s.browser)
      const r = await p.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
      if (r && r.status() >= 400) throw new Error(`O site respondeu com erro ${r.status()}`)
      s.info.status = 'ok'
      s.info.erro = undefined
      s.info.erroDoSite = false
      s.info.siteOk = true
      s.info.url = p.url()
      s.info.verificadoEm = Date.now()
    } catch (e) {
      this.falhaNoSite(s, traduzirErro(e))
    }
    this.avisarMudanca()
  }

  async recarregarComErro() {
    const comErro = [...this.sessoes.values()].filter((s) => s.info.status === 'erro')
    await Promise.all(comErro.map((s) => this.f5(s.info.slot)))
  }

  async encerrar(slots: number[], manterVaga = false) {
    await Promise.all(
      slots.map(async (slot) => {
        const s = this.sessoes.get(slot)
        if (!s) return
        s.encerradoPorVoce = true
        logInfo(`Navegador #${slot}`, `${s.perfil.nome} encerrado${manterVaga ? ' para substituir' : ''}.`)
        // fecha pelos dois caminhos ao mesmo tempo, sem deixar nenhum travar (máximo 15 s)
        const limite = (p: Promise<unknown>) => Promise.race([p.catch(() => undefined), new Promise((ok) => setTimeout(ok, 15_000))])
        await Promise.all([
          limite(s.browser?.connected ? s.browser.close() : Promise.resolve()),
          limite(dolphin.fecharNavegador(s.perfil.id))
        ])
        // o Dolphin às vezes ignora o primeiro pedido: confere e pede de novo
        if (s.browser?.connected) {
          await limite(dolphin.fecharNavegador(s.perfil.id))
          try {
            s.browser.disconnect()
          } catch {
            /* já desligou */
          }
        }
        if (!manterVaga && this.sessoes.get(slot) === s) this.sessoes.delete(slot)
      })
    )
    this.fila = this.fila.filter((f) => !f.slot || !slots.includes(f.slot))
    this.avisarMudanca()
  }

  private async fecharPorTempo(s: Sessao) {
    const slot = s.info.slot
    s.fechando = true
    s.info.fechando = true
    this.avisarMudanca()
    const reabrir = s.aoAcabar === 'reabrir' && !!s.tempoAberto
    logInfo(`Navegador #${slot}`, `${s.perfil.nome}: o tempo aberto acabou${reabrir ? ', fechando e abrindo de novo' : ', fechando'}.`)
    await this.encerrar([slot])
    if (!reabrir || this.pausado) return
    // abre de novo no mesmo lugar, com o mesmo proxy, um tempo novo e as mesmas opções
    await new Promise((ok) => setTimeout(ok, 3000))
    if (this.sessoes.has(slot)) return // você já pôs outro navegador nesse lugar
    this.fila.unshift({ perfil: s.perfil, slot, manterProxy: true, duracaoMs: sortearDuracao(s.tempoAberto), tempoAberto: s.tempoAberto, aoAcabar: s.aoAcabar, recarregar: s.recarregar, cookies: s.cookies })
    this.processarFila()
  }

  async encerrarTodos() {
    this.fila = []
    await this.encerrar([...this.sessoes.keys()])
  }

  /**
   * Substitui o navegador do número indicado por outro, com outro proxy.
   * perfil: 'mesmo' reabre o mesmo perfil; 'outro' usa o próximo perfil livre da mesma etiqueta.
   * proxy: 'proximo' = próximo da lista; um id = proxy escolhido; texto = proxy colado na hora.
   */
  async substituir(slot: number, opcoes: { perfil: 'mesmo' | 'outro'; proxy: 'proximo' | { id: string } | { texto: string } }) {
    const s = this.sessoes.get(slot)
    if (!s) return
    let perfil = s.perfil
    if (opcoes.perfil === 'outro') {
      const ocupados = new Set([...this.sessoes.values()].map((x) => x.perfil.id))
      const etiqueta = s.perfil.etiquetas[0]
      const livre = this.perfis.find((p) => !ocupados.has(p.id) && (!etiqueta || p.etiquetas.includes(etiqueta)))
      if (!livre) {
        this.aviso('Não há outro perfil livre para substituir.')
        return
      }
      perfil = livre
    }
    let proxy: Proxy | null
    try {
      if (opcoes.proxy === 'proximo') proxy = await this.escolherProxy()
      else if ('id' in opcoes.proxy) {
        const id = opcoes.proxy.id
        proxy = store.proxies.find((p) => p.id === id) ?? null
        if (proxy) proxy.usos++
      } else {
        const { lerLinha } = await import('./proxies')
        proxy = lerLinha(opcoes.proxy.texto, store.config.tipoProxyPadrao)
      }
    } catch (e: any) {
      this.aviso(e.message)
      return
    }
    logInfo(`Navegador #${slot}`, `Substituindo ${s.perfil.nome} por ${perfil.nome}${proxy ? ` com o proxy ${proxy.host}:${proxy.porta}` : ''}.`)
    await this.encerrar([slot], true)
    this.fila.unshift({ perfil, slot, proxy, fechaEm: s.info.fechaEm })
    this.processarFila()
  }

  async substituirTodosComErro() {
    const comErro = [...this.sessoes.values()].filter((s) => s.info.status === 'erro')
    for (const s of comErro) await this.substituir(s.info.slot, { perfil: 'mesmo', proxy: 'proximo' })
  }

  pausar() {
    this.pausado = true
    this.aviso('Programa pausado.')
  }

  retomar() {
    if (this.pausado) logInfo('Programa', 'Programa retomado.')
    this.pausado = false
    this.proxiesEsgotados = false
    this.avisarMudanca()
    this.processarFila()
  }

  // ---------- janelas ----------
  private async posicionar(slot: number) {
    const s = this.sessoes.get(slot)
    if (!s?.browser?.connected) return
    const pagina = await paginaPrincipal(s.browser)
    const cdp = await pagina.createCDPSession()
    const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number }
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: retanguloDoSlot(slot, store.config.janelas) })
    await cdp.detach()
  }

  async organizarTodos() {
    await Promise.all([...this.sessoes.keys()].map((slot) => this.posicionar(slot).catch(() => undefined)))
  }

  async trazerParaFrente(slot: number) {
    const s = this.sessoes.get(slot)
    if (!s?.browser?.connected) return
    const p = await paginaPrincipal(s.browser)
    await p.bringToFront()
  }

  // ---------- miniaturas ao vivo ----------
  // ---------- site: URL atual e verificador periódico ----------
  private vigiarPagina(s: Sessao, pagina: Page) {
    pagina.on('framenavigated', (f) => {
      if (f !== pagina.mainFrame() || f.url().startsWith('chrome-error://')) return
      s.info.url = f.url()
      this.avisarMudanca()
    })
    // falha de conexão no meio do caminho: aparece na hora, sem esperar o verificador
    pagina.on('requestfailed', (r) => {
      if (!r.isNavigationRequest() || r.frame() !== pagina.mainFrame()) return
      const t = r.failure()?.errorText ?? ''
      if (/ERR_ABORTED/.test(t)) return // navegação cancelada (ex.: clicou em outro link)
      this.falhaNoSite(s, traduzirErro(t))
    })
  }

  private falhaNoSite(s: Sessao, erro: string) {
    // só registra quando muda (de OK para falha, ou um erro diferente)
    if (s.info.siteOk !== false || s.info.erro !== erro) logErro(`Navegador #${s.info.slot}`, `${s.perfil.nome}: falha no site ${s.info.url ?? ''} · ${erro}`)
    s.info.siteOk = false
    s.info.verificadoEm = Date.now()
    if (s.info.status === 'ok' || s.info.erroDoSite) {
      s.info.status = 'erro'
      s.info.erro = erro
      s.info.erroDoSite = true
    }
    this.avisarMudanca()
  }

  private siteVoltou(s: Sessao) {
    if (s.info.siteOk === false) logOk(`Navegador #${s.info.slot}`, `${s.perfil.nome}: o site voltou a carregar (${s.info.url ?? ''}).`)
    s.info.siteOk = true
    s.info.verificadoEm = Date.now()
    if (s.info.erroDoSite) {
      s.info.status = 'ok'
      s.info.erro = undefined
      s.info.erroDoSite = false
    }
  }

  // De X em X segundos confere se cada navegador continua no site, carregado.
  agendarVerificacao() {
    clearTimeout(this.timerVerificacao)
    const seg = store.config.intervaloVerificacao
    if (!seg) return
    this.timerVerificacao = setTimeout(async () => {
      if (!this.pausado) {
        await Promise.all(
          [...this.sessoes.values()]
            .filter((s) => s.browser?.connected && (s.info.status === 'ok' || s.info.erroDoSite))
            .map((s) => this.verificarSite(s))
        )
        this.avisarMudanca()
      }
      this.agendarVerificacao()
    }, seg * 1000)
  }

  private async verificarSite(s: Sessao) {
    try {
      const p = await paginaPrincipal(s.browser!)
      const r = await Promise.race([
        p.evaluate(() => ({
          href: location.href,
          erroChrome: !!document.getElementById('main-frame-error') || location.href.startsWith('chrome-error://'),
          codigo: (document.querySelector('.error-code') as HTMLElement | null)?.innerText ?? ''
        })),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('A página parou de responder')), 8000))
      ])
      if (!r.erroChrome && !r.href.startsWith('chrome-error://')) s.info.url = r.href
      if (r.erroChrome) this.falhaNoSite(s, traduzirErro(r.codigo || 'Falha de conexão'))
      else this.siteVoltou(s)
    } catch (e) {
      this.falhaNoSite(s, traduzirErro(e))
    }
  }

  agendarMiniaturas() {
    clearTimeout(this.timerMiniatura)
    const intervalo = INTERVALO_MINIATURA[store.config.miniaturas]
    if (!intervalo) {
      for (const s of this.sessoes.values()) s.info.miniatura = undefined
      return
    }
    this.timerMiniatura = setTimeout(async () => {
      if (!this.pausado) {
        await Promise.all(
          [...this.sessoes.values()]
            .filter((s) => s.info.status === 'ok' && s.browser?.connected)
            .map(async (s) => {
              try {
                const p = await paginaPrincipal(s.browser!)
                const img = await p.screenshot({ type: 'jpeg', quality: 35, encoding: 'base64', optimizeForSpeed: true })
                s.info.miniatura = String(img)
              } catch {
                /* página ocupada; tenta de novo no próximo ciclo */
              }
            })
        )
        this.avisarMudanca()
      }
      this.agendarMiniaturas()
    }, intervalo)
  }

  async miniaturaGrande(slot: number): Promise<string | undefined> {
    const p = await this.paginaControlada(slot)
    if (!p) return undefined
    return String(await p.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64', optimizeForSpeed: true }))
  }

  // ---------- controle pelo "Ao vivo": clicar, rolar, digitar e trocar de aba ----------
  private async paginaControlada(slot: number): Promise<Page | undefined> {
    const s = this.sessoes.get(slot)
    if (!s?.browser?.connected) return undefined
    const paginas = (await s.browser.pages()).filter((p) => !p.url().startsWith('devtools'))
    if (!paginas.length) return paginaPrincipal(s.browser)
    return paginas[Math.min(s.abaAtiva ?? 0, paginas.length - 1)]
  }

  async abas(slot: number): Promise<{ indice: number; titulo: string; url: string; ativa: boolean }[]> {
    const s = this.sessoes.get(slot)
    if (!s?.browser?.connected) return []
    const paginas = (await s.browser.pages()).filter((p) => !p.url().startsWith('devtools'))
    const ativa = Math.min(s.abaAtiva ?? 0, paginas.length - 1)
    return Promise.all(paginas.map(async (p, i) => ({ indice: i, titulo: (await p.title().catch(() => '')) || p.url(), url: p.url(), ativa: i === ativa })))
  }

  async escolherAba(slot: number, indice: number) {
    const s = this.sessoes.get(slot)
    if (!s) return
    s.abaAtiva = indice
    const p = await this.paginaControlada(slot)
    await p?.bringToFront().catch(() => undefined)
  }

  // x e y de 0 a 1 (posição na imagem); o programa converte para a página
  async clicar(slot: number, x: number, y: number, botao: 'left' | 'right' = 'left', duplo = false) {
    const p = await this.paginaControlada(slot)
    if (!p) throw new Error('Esse navegador não está aberto.')
    const { w, h } = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    await p.mouse.click(Math.round(x * w), Math.round(y * h), { button: botao, ...(duplo ? ({ clickCount: 2, count: 2 } as any) : {}) })
  }

  async rolar(slot: number, x: number, y: number, dy: number) {
    const p = await this.paginaControlada(slot)
    if (!p) return
    const { w, h } = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    await p.mouse.move(Math.round(x * w), Math.round(y * h))
    await p.mouse.wheel({ deltaY: dy })
  }

  async digitar(slot: number, texto: string, tecla?: string) {
    const p = await this.paginaControlada(slot)
    if (!p) throw new Error('Esse navegador não está aberto.')
    if (texto) await p.keyboard.type(texto, { delay: 20 })
    if (tecla) await p.keyboard.press(tecla as any)
  }
}

// ---------- ajudantes ----------
async function paginaPrincipal(browser: Browser): Promise<Page> {
  const paginas = await browser.pages()
  return paginas.find((p) => !p.url().startsWith('devtools')) ?? (await browser.newPage())
}

async function conferirIp(browser: Browser): Promise<{ ip?: string; pais?: string }> {
  // vários sites, porque alguns bloqueiam proxies: o primeiro que responder vale
  const sites: [string, (j: any, t: string) => { ip?: string; pais?: string }][] = [
    ['https://ipwho.is/', (j) => ({ ip: j.ip, pais: j.country })],
    ['https://ipinfo.io/json', (j) => ({ ip: j.ip, pais: j.country })],
    ['https://api.myip.com/', (j) => ({ ip: j.ip, pais: j.country })],
    ['https://api.ipify.org/?format=json', (j) => ({ ip: j.ip })]
  ]
  const aba = await browser.newPage()
  try {
    for (const [url, ler] of sites) {
      try {
        await aba.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
        const texto = await aba.evaluate(() => document.body.innerText)
        const r = ler(JSON.parse(texto), texto)
        if (r.ip) return r
      } catch {
        /* tenta o próximo */
      }
    }
    throw new Error('nenhum site de IP respondeu pelo proxy')
  } finally {
    await aba.close().catch(() => undefined)
  }
}

function normalizarSite(site: string) {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`
}

function nomeSistema(p: string) {
  const t = p.toLowerCase()
  if (t.includes('mac')) return 'macOS'
  if (t.includes('linux')) return 'Linux'
  return 'Windows'
}

function traduzirErro(e: any): string {
  const m = String(e?.message ?? e)
  if (/ERR_PROXY|ERR_TUNNEL/i.test(m)) return 'Proxy não respondeu'
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i.test(m)) return 'Falha de conexão: internet caiu'
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i.test(m)) return 'Falha de conexão: tempo esgotado'
  if (/ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(m)) return 'Falha de conexão: o site fechou a conexão'
  if (/ERR_NAME_NOT_RESOLVED/i.test(m)) return 'Site não encontrado'
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(m)) return 'Erro de conexão: o site recusou o acesso'
  if (/timeout|Timed out/i.test(m)) return 'Página demorou demais para carregar'
  return m.slice(0, 160)
}
