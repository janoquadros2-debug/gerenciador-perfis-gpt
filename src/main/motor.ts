// O "motor": abre, acompanha, reabre, substitui e encerra os navegadores.
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import type { EstadoMotor, Navegador, Perfil, Proxy, TempoAberto, HistoricoPerfil } from '../shared/types'
import { sortearDuracao } from '../shared/sorteio'
import { type ModoCookies, vigiarCookies } from './cookies'
import { manterAtivas } from './ativas'
import { lerAmostraMidia, type AmostraMidia } from './diagnostico'
import { urlPlayerDeTeste } from './player-teste'
import { categorizarFalha, ipsRepetidos } from './diagnostico-falhas'
import * as dolphin from './dolphin'
import { retanguloDoSlot, capacidadeGrade } from './janelas'
import { ProxiesEsgotados, proximoProxy, proxyParaTexto, testarProxy, lerLinha } from './proxies'
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
  tempoFechadoMinutos?: number
  f5EmAndamento?: boolean
  fechando?: boolean
  amostraMidia?: AmostraMidia
  amostraEm?: number
  semAvancoDesde?: number // quando o tempo da mídia deixou de avançar
  recuperacaoEmAndamento?: boolean
  recuperacaoBloqueadaAte?: number
  leiturasSemAvanco?: number
  estavelDesde?: number
  pausaDesde?: number
  leiturasPausado?: number
  alertaPausa?: boolean
  operacaoAberturaId?: string
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
  tempoFechadoMinutos?: number
}

interface CicloEmEspera {
  item: ItemFila
  reabreEm: number
  tempoFechadoMinutos: number
  timer?: NodeJS.Timeout
}

const LIMITE_ABERTURA = 4
const INTERVALO_MINIATURA = { rapida: 1000, normal: 2500, economica: 6000, desligadas: 0 }

export class Motor extends EventEmitter {
  perfis: Perfil[] = []
  private sessoes = new Map<number, Sessao>()
  private fila: ItemFila[] = []
  private ciclosEmEspera = new Map<number, CicloEmEspera>()
  private abrindoAgora = 0
  private proximaAbertura = 0
  private timerFila?: NodeJS.Timeout
  private concluidosNoLote = 0
  private pausado = false
  private avisos: string[] = []
  private proxiesEsgotados = false
  private timerMiniatura?: NodeJS.Timeout
  private timerVerificacao?: NodeJS.Timeout
  private timerEstado?: NodeJS.Timeout
  private indiceMiniatura = 0

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
    const navegadorLista = [...this.sessoes.values()].map((s) => s.info).sort((a, b) => a.slot - b.slot)
    if (store.config.recursosExtras?.detectarIpsRepetidos) ipsRepetidos(navegadorLista)
    else for (const n of navegadorLista) n.ipRepetido = undefined
    return {
      pausado: this.pausado,
      navegadores: navegadorLista,
      fila: this.fila.length,
      ciclosEmEspera: [...this.ciclosEmEspera].map(([slot, c]) => ({ slot, perfilId: c.item.perfil.id, perfilNome: c.item.perfil.nome, reabreEm: c.reabreEm, tempoFechadoMinutos: c.tempoFechadoMinutos })),
      ram: this.ram(),
      avisos: this.avisos.slice(-5),
      proxiesEsgotados: this.proxiesEsgotados,
      capacidadePorGrupo: capacidadeGrade(store.config.janelas),
      totalGrupos: Math.max(1, Math.ceil(Math.max(0, ...this.sessoes.keys()) / capacidadeGrade(store.config.janelas))),
      grupoVisivel: store.config.janelas.grupoVisivel ?? 0
    }
  }

  private historicos = new Map<number, HistoricoPerfil[]>()

  private registrar(s: Sessao, categoria: HistoricoPerfil['categoria'], texto: string) {
    const historico = this.historicos.get(s.perfil.id) ?? (store.config.recursosExtras?.historicoPersistente ? (store.historicosPerfis[s.perfil.id] ?? []) : [])
    const anterior = historico[historico.length - 1]
    if (anterior?.texto === texto && Date.now() - anterior.quando < 30000) return
    historico.push({ quando: Date.now(), categoria, texto })
    if (historico.length > 60) historico.splice(0, historico.length - 60)
    this.historicos.set(s.perfil.id, historico)
    s.info.historico = [...historico]
    store.salvarHistoricoPerfil(s.perfil.id, historico)
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
    // O agendamento do F5 não depende do status da página após erro HTTP/timeout.
    for (const s of this.sessoes.values()) {
      if (!s.recarregar || !s.info.proximoF5 || s.info.proximoF5 > agora ||
          s.f5EmAndamento || s.fechando || s.info.status === 'abrindo' || !s.browser?.connected) continue
      s.f5EmAndamento = true
      s.info.proximoF5 = undefined
      void this.f5(s.info.slot).catch((e) => {
        logAviso(`Navegador #${s.info.slot}`, `Falha no F5 agendado: ${traduzirErro(e)}`)
      }).finally(() => {
        s.f5EmAndamento = false
        if (this.sessoes.get(s.info.slot) !== s || !s.recarregar || s.fechando) return
        const intervalo = sortearDuracao(s.recarregar)
        if (intervalo) {
          s.info.proximoF5 = Date.now() + intervalo
          logInfo(`Navegador #${s.info.slot}`,
            `F5 concluído; próximo intervalo sorteado: ${Math.ceil(intervalo / 1000)} s (às ${new Date(s.info.proximoF5).toLocaleTimeString('pt-BR')}).`)
        }
        this.avisarMudanca()
      })
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
    opcoes: { manterProxy?: boolean; duracaoMs?: number; recarregar?: TempoAberto; cookies?: ModoCookies; tempoAberto?: TempoAberto; aoAcabar?: 'fechar' | 'reabrir'; tempoFechadoMinutos?: number } = {}
  ) {
    const ocupados = new Set([...this.sessoes.values()].map((s) => s.perfil.id).concat(this.fila.map((f) => f.perfil.id), [...this.ciclosEmEspera.values()].map((c) => c.item.perfil.id)))
    const recarregar = opcoes.recarregar && opcoes.recarregar.modo !== 'sem-limite' ? opcoes.recarregar : undefined
    for (const p of perfis) if (!ocupados.has(p.id)) this.fila.push({
          perfil: p,
          manterProxy: opcoes.manterProxy,
          // cada perfil sorteia o seu próprio tempo
          duracaoMs: opcoes.tempoAberto ? sortearDuracao(opcoes.tempoAberto) : opcoes.duracaoMs,
          recarregar,
          cookies: opcoes.cookies,
          tempoAberto: opcoes.tempoAberto && opcoes.tempoAberto.modo !== 'sem-limite' ? opcoes.tempoAberto : undefined,
          aoAcabar: opcoes.aoAcabar,
          tempoFechadoMinutos: opcoes.tempoFechadoMinutos
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
    const usados = new Set([...this.sessoes.keys(), ...this.ciclosEmEspera.keys(), ...this.fila.map((f) => f.slot ?? 0)])
    let s = 1
    while (usados.has(s)) s++
    return s
  }

  private async processarFila() {
    const cfgInicial = store.config
    const limite = Math.max(1, Math.min(LIMITE_ABERTURA, Math.round(cfgInicial.aberturasSimultaneas ?? 2)))
    const intervalo = Math.max(0, Math.min(15000, cfgInicial.intervaloEntreAberturasMs ?? 1500))
    while (!this.pausado && this.fila.length > 0 && this.abrindoAgora < limite) {
      const espera = this.proximaAbertura - Date.now()
      if (espera > 0) {
        if (!this.timerFila) this.timerFila = setTimeout(() => {
          this.timerFila = undefined
          this.processarFila()
        }, espera)
        return
      }
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
      this.proximaAbertura = Date.now() + intervalo
      this.abrirUm(item).finally(() => {
        this.abrindoAgora--
        this.concluidosNoLote++
        if (store.config.reorganizarAposLote && this.concluidosNoLote % 5 === 0 && store.config.janelas.ativo) {
          // A reorganização é agendada e nunca impede a abertura dos próximos perfis.
          this.organizarTodos().catch(() => undefined)
        }
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
      cookies: item.cookies ?? anterior?.cookies ?? cfg.cookiesPadrao ?? 'recusar',
      tempoAberto: item.tempoAberto ?? anterior?.tempoAberto,
      aoAcabar: item.aoAcabar ?? anterior?.aoAcabar,
      tempoFechadoMinutos: item.tempoFechadoMinutos ?? anterior?.tempoFechadoMinutos,
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
        reabreAoAcabar: (item.aoAcabar ?? anterior?.aoAcabar) === 'reabrir' && !!(item.tempoAberto ?? anterior?.tempoAberto),
        tempoFechadoMinutos: item.tempoFechadoMinutos ?? anterior?.tempoFechadoMinutos
      }
    }
    sessao.info.historico = [...(this.historicos.get(item.perfil.id) ?? (cfg.recursosExtras?.historicoPersistente ? store.historicosPerfis[item.perfil.id] ?? [] : []))]
    this.registrar(sessao, 'abertura', 'Iniciando navegador')
    this.sessoes.set(slot, sessao)
    if (cfg.recursosExtras?.diarioOperacoes) {
      sessao.operacaoAberturaId = randomUUID()
      store.registrarOperacao({ id: sessao.operacaoAberturaId, tipo: 'abrir', estado: 'pendente',
        perfilId: item.perfil.id, perfilNome: item.perfil.nome, slot, iniciadoEm: Date.now(), atualizadoEm: Date.now() })
    }
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
        this.registrar(sessao, 'proxy', proxy ? `Proxy configurado: ${proxy.host}:${proxy.porta}` : 'Sem proxy')
        logInfo(quem, `${item.perfil.nome}: proxy ${proxy ? `${proxy.host}:${proxy.porta}` : 'nenhum (seu IP)'}`)
      }

      // 2. abre pelo Dolphin e conecta
      const { ws } = await dolphin.abrirNavegador(item.perfil.id)
      const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
      sessao.browser = browser
      browser.on('disconnected', () => this.aoCair(slot, sessao))
      // janelas cobertas continuam rodando como se estivessem na frente
      if (cfg.manterAtivas !== false) manterAtivas(browser).catch(() => undefined)
      // aviso de cookies: aceita (ou recusa) sozinho, em todas as abas
      if (sessao.cookies && sessao.cookies !== 'desligado')
        vigiarCookies(browser, () => sessao.cookies ?? 'desligado', (url) =>
          {
            logInfo(quem, `${item.perfil.nome}: ${sessao.cookies === 'aceitar' ? 'aceitei' : 'recusei'} o aviso de cookies em ${url.replace(/^https?:\/\//, '').slice(0, 60)}.`)
            this.registrar(sessao, 'cookies', 'Preferência de cookies aplicada em ' + url.slice(0, 100))
            this.avisarMudanca()
          }
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
      if (cfg.recursosExtras?.validarAbertura && (!browser.connected || !sessao.info.siteOk))
        throw new Error('Abertura sem confirmação de conexão e carregamento')
      if (sessao.operacaoAberturaId) store.registrarOperacao({
        id: sessao.operacaoAberturaId, tipo: 'abrir', estado: 'concluida',
        perfilId: item.perfil.id, perfilNome: item.perfil.nome, slot,
        iniciadoEm: sessao.info.abertoEm, atualizadoEm: Date.now(), detalhe: 'Navegador e página carregados'
      })
      this.registrar(sessao, 'abertura', 'Navegador aberto e página carregada')
      sessao.info.erro = undefined
      logOk(
        quem,
        `${item.perfil.nome} aberto em ${site}` +
          (sessao.info.ip ? ` · IP ${sessao.info.ip}${sessao.info.pais ? ` (${sessao.info.pais})` : ''}` : '') +
          (sessao.info.fechaEm ? ` · fecha às ${new Date(sessao.info.fechaEm).toLocaleTimeString('pt-BR')}` : '')
      )
    } catch (e: any) {
      if (sessao.operacaoAberturaId) store.registrarOperacao({
        id: sessao.operacaoAberturaId, tipo: 'abrir', estado: 'erro', perfilId: item.perfil.id,
        perfilNome: item.perfil.nome, slot, iniciadoEm: sessao.info.abertoEm,
        atualizadoEm: Date.now(), detalhe: traduzirErro(e)
      })
      if (cfg.recursosExtras?.categorizarFalhas) sessao.info.erroCategoria = categorizarFalha(e)
      if (e instanceof ProxiesEsgotados) {
        this.proxiesEsgotados = true
        this.pausado = true
        this.fila.unshift({ perfil: item.perfil, slot })
        this.sessoes.delete(slot)
        this.aviso(e.message + ' O programa foi pausado.')
        return
      }
      sessao.info.status = 'erro'
      this.registrar(sessao, 'erro', traduzirErro(e))
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
      this.fila.unshift({ perfil: sessao.perfil, slot, proxy: undefined, fechaEm: sessao.info.fechaEm,
        recarregar: sessao.recarregar, tempoAberto: sessao.tempoAberto, aoAcabar: sessao.aoAcabar, cookies: sessao.cookies, tempoFechadoMinutos: sessao.tempoFechadoMinutos })
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
      this.fila.unshift({ perfil: s.perfil, slot, fechaEm: s.info.fechaEm,
        recarregar: s.recarregar, tempoAberto: s.tempoAberto, aoAcabar: s.aoAcabar, cookies: s.cookies, tempoFechadoMinutos: s.tempoFechadoMinutos })
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

  /**
   * Ajusta os cronômetros de perfis JÁ abertos, independentemente da criação em massa.
   * O desligamento elimina o próximo evento agendado. Não altera perfis encerrados.
   */
  ajustarCronometros(
    slots: number[],
    tipo: 'f5' | 'fechamento',
    tempo: TempoAberto,
    aoAcabar: 'fechar' | 'reabrir' = 'fechar',
    tempoFechadoMinutos?: number
  ): { alterados: number; ignorados: number } {
    if (!Array.isArray(slots) || !['f5', 'fechamento'].includes(tipo)) throw new Error('Seleção inválida')
    if (!tempo || !['sem-limite', 'fixo', 'aleatorio'].includes(tempo.modo)) throw new Error('Modo de tempo inválido')
    const valores = [tempo.minutos, tempo.de, tempo.ate]
    if (valores.some((v) => !Number.isFinite(v) || v < 0 || v > 10080)) throw new Error('Informe tempos válidos de até 7 dias')
    if (tempo.modo === 'fixo' && tempo.minutos <= 0) throw new Error('Tempo fixo deve ser maior que zero')
    if (tempo.modo === 'aleatorio' && (tempo.de <= 0 || tempo.ate <= 0 || tempo.de > tempo.ate)) throw new Error('Intervalo aleatório inválido')
    if (tempoFechadoMinutos !== undefined && (!Number.isFinite(tempoFechadoMinutos) || tempoFechadoMinutos < 0 || tempoFechadoMinutos > 10080)) throw new Error('Tempo fechado inválido')
    const agora = Date.now()
    let alterados = 0
    for (const slot of new Set(slots)) {
      const s = this.sessoes.get(slot)
      if (!s || s.fechando || s.info.status === 'fechado') continue
      const ativo = tempo.modo !== 'sem-limite'
      if (tipo === 'f5') {
        s.recarregar = ativo ? { ...tempo } : undefined
        s.info.proximoF5 = ativo ? agora + (sortearDuracao(tempo) ?? 0) : undefined
      } else {
        s.tempoAberto = ativo ? { ...tempo } : undefined
        s.aoAcabar = ativo ? aoAcabar : undefined
        s.info.fechaEm = ativo ? agora + (sortearDuracao(tempo) ?? 0) : undefined
        s.info.reabreAoAcabar = ativo && aoAcabar === 'reabrir'
        if (tempoFechadoMinutos !== undefined) s.tempoFechadoMinutos = tempoFechadoMinutos
        s.info.tempoFechadoMinutos = s.tempoFechadoMinutos
      }
      alterados++
    }
    if (alterados) {
      for (const slot of slots) {
        const s = this.sessoes.get(slot)
        if (s) this.registrar(s, 'temporizador', `${tipo} ${tempo.modo === 'sem-limite' ? 'desativado' : 'reprogramado'}`)
      }
      logInfo('Ao vivo', `${tipo === 'f5' ? 'F5' : 'Fechamento'}: temporizador ${tempo.modo === 'sem-limite' ? 'desligado' : 'ajustado'} em ${alterados} perfis.`)
      this.avisarMudanca()
    }
    return { alterados, ignorados: slots.length - alterados }
  }

  async recarregarComErro() {
    const comErro = [...this.sessoes.values()].filter((s) => s.info.status === 'erro')
    await Promise.all(comErro.map((s) => this.f5(s.info.slot)))
  }

  async encerrar(slots: number[], manterVaga = false) {
    for (const slot of slots) this.cancelarEsperaInterna(slot)
    await Promise.all(
      slots.map(async (slot) => {
        const s = this.sessoes.get(slot)
        if (!s) return
        s.encerradoPorVoce = true
        const opFecharId = store.config.recursosExtras?.diarioOperacoes ? randomUUID() : undefined
        const opInicio = Date.now()
        if (opFecharId) store.registrarOperacao({id:opFecharId,tipo:'fechar',estado:'pendente',perfilId:s.perfil.id,
          perfilNome:s.perfil.nome,slot,iniciadoEm:opInicio,atualizadoEm:opInicio})
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
        if (opFecharId) store.registrarOperacao({id:opFecharId,tipo:'fechar',
          estado:s.browser?.connected ? 'erro' : 'concluida',
          perfilId:s.perfil.id,perfilNome:s.perfil.nome,slot,iniciadoEm:opInicio,atualizadoEm:Date.now(),
          detalhe:s.browser?.connected ? 'O navegador ainda responde; verifique o Dolphin manualmente.' : 'Encerramento confirmado pela desconexão.'})
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
    // Opcional: espera configurável; os antigos 3 segundos permanecem por padrão.
    const pausa = Number(s.tempoFechadoMinutos) > 0 ? Number(s.tempoFechadoMinutos) : 0
    const urlAtual = s.info.url
    const perfil = urlAtual && /^https?:\/\//i.test(urlAtual) ? { ...s.perfil, site: urlAtual } : s.perfil
    this.agendarReabertura({
      perfil, slot, manterProxy: true, duracaoMs: sortearDuracao(s.tempoAberto),
      tempoAberto: s.tempoAberto, aoAcabar: s.aoAcabar,
      recarregar: s.recarregar, cookies: s.cookies, tempoFechadoMinutos: s.tempoFechadoMinutos
    }, pausa ? pausa * 60_000 : 3000)
  }

  private agendarReabertura(item: ItemFila, esperaMs: number) {
    const slot = item.slot!
    this.cancelarEsperaInterna(slot)
    const ciclo: CicloEmEspera = { item, reabreEm: Date.now() + esperaMs, tempoFechadoMinutos: item.tempoFechadoMinutos ?? 0 }
    this.ciclosEmEspera.set(slot, ciclo)
    const verificar = () => {
      if (this.ciclosEmEspera.get(slot) !== ciclo) return
      if (this.pausado) { ciclo.timer = setTimeout(verificar, 2000); return }
      const falta = ciclo.reabreEm - Date.now()
      if (falta > 0) { ciclo.timer = setTimeout(verificar, Math.min(falta, 30000)); return }
      this.ciclosEmEspera.delete(slot)
      if (this.sessoes.has(slot) || this.fila.some((f) => f.slot === slot)) {
        this.aviso(`Não reabri ${item.perfil.nome}: posição #${slot} ocupada.`)
        return
      }
      logInfo(`Navegador #${slot}`, 'Tempo fechado encerrado; reabrindo o mesmo perfil.')
      this.fila.unshift(item)
      this.processarFila()
      this.avisarMudanca()
    }
    ciclo.timer = setTimeout(verificar, Math.min(esperaMs, 30000))
    this.avisarMudanca()
  }

  private cancelarEsperaInterna(slot: number): boolean {
    const ciclo = this.ciclosEmEspera.get(slot)
    if (!ciclo) return false
    clearTimeout(ciclo.timer)
    this.ciclosEmEspera.delete(slot)
    return true
  }

  cancelarCiclo(slot: number) {
    if (this.cancelarEsperaInterna(slot)) {
      logInfo(`Navegador #${slot}`, 'Reabertura programada cancelada.')
      this.avisarMudanca()
      return
    }
    const s = this.sessoes.get(slot)
    if (!s) return
    s.tempoAberto = undefined
    s.aoAcabar = undefined
    s.info.fechaEm = undefined
    s.info.reabreAoAcabar = false
    this.registrar(s, 'temporizador', 'Ciclo fechar/reabrir cancelado')
    this.avisarMudanca()
  }

  alterarEsperaCiclo(slot: number, minutos: number) {
    if (!Number.isFinite(minutos) || minutos < 0.1 || minutos > 10080) throw new Error('Informe entre 0,1 e 10080 minutos.')
    const ciclo = this.ciclosEmEspera.get(slot)
    if (ciclo) {
      ciclo.item.tempoFechadoMinutos = minutos
      this.agendarReabertura(ciclo.item, minutos * 60_000)
      return
    }
    const s = this.sessoes.get(slot)
    if (!s) throw new Error('Perfil não encontrado.')
    s.tempoFechadoMinutos = minutos
    s.info.tempoFechadoMinutos = minutos
    this.registrar(s, 'temporizador', `Tempo fechado: ${minutos} min`)
    this.avisarMudanca()
  }

  reabrirCicloAgora(slot: number) {
    const ciclo = this.ciclosEmEspera.get(slot)
    if (!ciclo) return
    const item = ciclo.item
    this.cancelarEsperaInterna(slot)
    if (this.sessoes.has(slot) || this.fila.some((f) => f.slot === slot)) throw new Error('Posição ocupada.')
    this.fila.unshift(item)
    this.processarFila()
    this.avisarMudanca()
  }

  async encerrarTodos() {
    for (const slot of this.ciclosEmEspera.keys()) this.cancelarEsperaInterna(slot)
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
    const slots = [...this.sessoes.keys()].sort((a, b) => a - b)
    const capacidade = capacidadeGrade(store.config.janelas)
    const grupoVisivel = Math.max(0, store.config.janelas.grupoVisivel ?? 0)
    // Posicionar os outros grupos primeiro, e o grupo selecionado por último.
    const outros = slots.filter((slot) => Math.floor((slot - 1) / capacidade) !== grupoVisivel)
    const principais = slots.filter((slot) => Math.floor((slot - 1) / capacidade) === grupoVisivel)
    for (const slot of [...outros, ...principais]) await this.posicionar(slot).catch(() => undefined)
    for (const slot of principais) await this.trazerParaFrente(slot).catch(() => undefined)
  }

  async escolherGrupo(grupo: number) {
    const total = Math.max(1, this.estado().totalGrupos ?? 1)
    if (!Number.isInteger(grupo) || grupo < 0 || grupo >= total) throw new Error('Grupo de janelas inválido')
    store.setConfig({ janelas: { ...store.config.janelas, grupoVisivel: grupo } })
    await this.organizarTodos()
    this.avisarMudanca()
    return { grupo, total }
  }

  async diagnosticarProxy(slot: number) {
    const s = this.sessoes.get(slot)
    if (!s) throw new Error('Perfil não está aberto')
    const endereco = s.info.proxy ?? s.perfil.proxyTexto
    if (!endereco || endereco === 'Sem proxy') throw new Error('Este navegador não tem proxy configurado')
    // O Dolphin frequentemente retorna o tipo HTTP no lugar de HTTPS e não devolve
    // as credenciais; a comparação literal com a lista salva gerava falso erro.
    const lido = lerLinha(endereco, 'http')
    const host = endereco.replace(/^[a-z0-9]+:\/\//i, '').split('@').pop()?.split(':')[0]?.toLowerCase()
    const proxy = (lido
      ? store.proxies.find((p) => p.host.toLowerCase() === lido.host.toLowerCase() && p.porta === lido.porta)
      : store.proxies.find((p) => p.host.toLowerCase() === host))
      ?? lido
    let resultado: import('../shared/types').ResultadoTesteProxy
    if (proxy && proxy.porta >= 1 && proxy.porta <= 65535) {
      resultado = { ...await testarProxy(proxy, 12000), metodo: 'direto' }
    } else if (s.browser?.connected) {
      // Quando o Dolphin não fornece porta/credenciais, testar a conexão
      // real do próprio navegador, em vez de tentar montar uma URL inválida.
      const inicio = Date.now()
      try {
        const ip = await conferirIp(s.browser)
        resultado = { ok: !!ip.ip, ip: ip.ip, pais: ip.pais, ms: Date.now() - inicio,
          quando: Date.now(), categoria: ip.ip ? 'ok' : 'resposta', metodo: 'navegador',
          erro: ip.ip ? undefined : 'IP de saída não foi confirmado' }
      } catch {
        resultado = { ok: false, quando: Date.now(), categoria: 'conexao', metodo: 'navegador',
          erro: 'Não foi possível verificar a conexão pelo navegador. O Dolphin não forneceu a porta do proxy.' }
      }
    } else throw new Error('Proxy sem porta e navegador desconectado: não é possível testar')
    s.info.diagnosticoProxy = resultado
    this.registrar(s, 'proxy', resultado.ok ? `Teste de proxy OK (${resultado.ms ?? '?'} ms)` : `Teste de proxy: ${resultado.erro ?? 'falha'}`)
    this.avisarMudanca()
    return resultado
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
    if (store.config.recursosExtras?.categorizarFalhas) s.info.erroCategoria = categorizarFalha(erro)
    this.registrar(s, 'site', erro)
    s.info.verificadoEm = Date.now()
    if (s.info.status === 'ok' || s.info.erroDoSite) {
      s.info.status = 'erro'
      s.info.erro = erro
      s.info.erroDoSite = true
    }
    this.avisarMudanca()
  }

  private siteVoltou(s: Sessao) {
    if (s.info.siteOk === false) this.registrar(s, 'site', 'Página voltou a responder')
    if (s.info.siteOk === false) logOk(`Navegador #${s.info.slot}`, `${s.perfil.nome}: o site voltou a carregar (${s.info.url ?? ''}).`)
    s.info.siteOk = true
    s.info.erroCategoria = undefined
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
        // Não bombardear dezenas de navegadores simultaneamente.
        const alvos = [...this.sessoes.values()].filter((s) => s.browser?.connected && (s.info.status === 'ok' || s.info.erroDoSite))
        for (let inicio = 0; inicio < alvos.length; inicio += 5) {
          await Promise.all(alvos.slice(inicio, inicio + 5).map((s) => this.verificarSite(s)))
          if (this.pausado) break
        }
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
      if (r.erroChrome) {
        this.falhaNoSite(s, traduzirErro(r.codigo || 'Falha de conexão'))
        s.info.reproducao = 'erro'
        s.info.reproducaoDetalhe = 'Página não carregou'
      } else {
        this.siteVoltou(s)
        if (store.config.diagnosticoReproducao !== false) {
          const amostra = await lerAmostraMidia(p)
          if (amostra) this.atualizarDiagnostico(s, amostra)
          else {
            s.info.reproducao = 'inconclusivo'
            s.info.reproducaoDetalhe = 'Não foi possível consultar o player'
            s.info.reproducaoEm = Date.now()
          }
        } else {
          s.info.reproducao = undefined
          s.info.reproducaoDetalhe = undefined
        }
      }
    } catch (e) {
      this.falhaNoSite(s, traduzirErro(e))
    }
  }

  private atualizarDiagnostico(s: Sessao, atual: AmostraMidia) {
    const anterior = s.amostraMidia
    const agora = Date.now()
    const anteriorStatus = s.info.reproducao
    const avancou = !!(anterior?.encontrado && atual.encontrado && atual.tempo > anterior.tempo + 0.3)
    const bloqueio = atual.anuncioProvavel || atual.avisoCookies || atual.pausado || atual.encerrado

    s.info.avisoCookies = atual.avisoCookies
    s.info.anuncioProvavel = atual.anuncioProvavel
    s.info.reproducaoEm = agora

    // HTMLMediaElement.paused = true NÃO é buffering. Antes, esse estado era
    // excluído da recuperação e também nunca gerava um alerta após longa pausa.
    // Alertar após múltiplas leituras, sem iniciar reprodução automaticamente.
    if (atual.encontrado && atual.pausado && !atual.encerrado && !atual.anuncioProvavel && !atual.avisoCookies) {
      if (!s.pausaDesde) s.pausaDesde = agora
      s.leiturasPausado = (s.leiturasPausado ?? 0) + 1
      if (!s.alertaPausa && agora - s.pausaDesde >= 30000 && s.leiturasPausado >= 3) {
        s.alertaPausa = true
        s.info.recuperacao = 'intervencao'
        s.info.proximaRecuperacaoEm = undefined
        const motivo = 'Player pausado há mais de 30 segundos. Confira se a pausa foi intencional, se o Rumble pede interação ou se existe um bloqueio.'
        this.registrar(s, 'video', motivo)
        logAviso(`Navegador #${s.info.slot}`, motivo)
        this.avisarMudanca()
      }
    } else {
      s.pausaDesde = undefined
      s.leiturasPausado = 0
      if (s.alertaPausa && avancou) {
        s.alertaPausa = false
        s.info.recuperacao = 'normal'
        s.info.proximaRecuperacaoEm = undefined
        this.registrar(s, 'video', 'A reprodução voltou a avançar; alerta de pausa encerrado')
      }
    }

    if (avancou || !atual.encontrado || bloqueio) {
      s.semAvancoDesde = undefined
      s.leiturasSemAvanco = 0
    } else {
      s.leiturasSemAvanco = (s.leiturasSemAvanco ?? 0) + 1
      if (!s.semAvancoDesde) s.semAvancoDesde = agora
    }
    if (avancou) {
      if (!s.estavelDesde) s.estavelDesde = agora
      if (agora - s.estavelDesde > 60000) {
        s.info.tentativasRecuperacao = 0
        s.info.recuperacao = 'normal'
        s.info.proximaRecuperacaoEm = undefined
        s.recuperacaoBloqueadaAte = undefined
      }
    } else s.estavelDesde = undefined
    const semAvancoHa = s.semAvancoDesde ? agora - s.semAvancoDesde : 0

    if (atual.erro) {
      s.info.reproducao = 'erro'
      s.info.reproducaoDetalhe = 'O elemento de vídeo reportou um erro'
    } else if (!atual.encontrado) {
      s.info.reproducao = 'sem-video'
      s.info.reproducaoDetalhe = 'Nenhum elemento de vídeo visível foi localizado'
    } else if (atual.encerrado) {
      s.info.reproducao = 'encerrado'
      s.info.reproducaoDetalhe = 'O vídeo foi encerrado'
    } else if (atual.pausado) {
      s.info.reproducao = 'pausado'
      s.info.reproducaoDetalhe = s.alertaPausa
        ? 'Pausa prolongada: verifique o player manualmente. A página está aberta, mas o vídeo não está reproduzindo.'
        : `O player informa pausa (${Math.round((agora - (s.pausaDesde ?? agora)) / 1000)} s); verificando se persiste`
    } else if (avancou) {
      s.info.reproducao = 'reproduzindo'
      s.info.reproducaoDetalhe = 'O tempo do player avançou desde a última verificação'
    } else if (semAvancoHa >= 30000) {
      // Não confundir a falta de dados com suspensão do vídeo pelo site ou proxy.
      s.info.reproducao = 'inconclusivo'
      s.info.reproducaoDetalhe = `Sem avanço de tempo há ${Math.floor(semAvancoHa / 1000)} s. Verifique rede, player e proxy; um F5 pode não resolver.`
    } else if (atual.esperando || atual.pronto < 2) {
      s.info.reproducao = 'carregando'
      s.info.reproducaoDetalhe = `Aguardando dados do vídeo (${Math.floor(semAvancoHa / 1000)} s)`
    } else {
      s.info.reproducao = 'inconclusivo'
      s.info.reproducaoDetalhe = 'Aguardando uma segunda leitura do tempo do vídeo'
    }

    if (anteriorStatus && anteriorStatus !== s.info.reproducao && s.info.reproducao !== 'inconclusivo') {
      this.registrar(s, 'video', s.info.reproducaoDetalhe ?? 'Estado da mídia alterado')
      logInfo(`Navegador #${s.info.slot}`, `${s.perfil.nome}: ${s.info.reproducaoDetalhe}`)
    }
    s.amostraMidia = atual
    s.amostraEm = agora

    // Apenas buffering prolongado e confirmado; um player pausado, um anúncio
    // ou ausência de vídeo nunca dispara recuperação automática.
    if (store.config.recuperarTravamento && store.config.diagnosticoReproducao !== false &&
        s.info.status === 'ok' && !this.pausado && !s.fechando && !bloqueio &&
        atual.encontrado && !atual.erro && (atual.esperando || atual.pronto < 2) &&
        semAvancoHa >= 45000 && (s.leiturasSemAvanco ?? 0) >= 3) {
      void this.recuperarCarregamento(s)
    }
  }

  private async recuperarCarregamento(s: Sessao) {
    if (s.recuperacaoEmAndamento || s.info.recuperacao === 'intervencao') return
    if (this.sessoes.get(s.info.slot) !== s || !s.browser?.connected) return
    const agora = Date.now()
    if (s.recuperacaoBloqueadaAte && agora < s.recuperacaoBloqueadaAte) {
      s.info.proximaRecuperacaoEm = s.recuperacaoBloqueadaAte
      s.info.recuperacao = 'analisando'
      return
    }
    const tentativas = s.info.tentativasRecuperacao ?? 0
    if (tentativas >= 2) {
      s.info.recuperacao = 'intervencao'
      s.info.proximaRecuperacaoEm = undefined
      const motivo = 'O player continua carregando após duas atualizações de página. Verifique o navegador, o proxy e a transmissão.'
      s.info.reproducaoDetalhe = motivo
      this.registrar(s, 'erro', motivo)
      logAviso(`Navegador #${s.info.slot}`, motivo)
      this.avisarMudanca()
      return
    }
    s.recuperacaoEmAndamento = true
    s.info.recuperacao = 'tentando'
    s.info.tentativasRecuperacao = tentativas + 1
    s.info.proximaRecuperacaoEm = undefined
    const motivo = `Player sem dados por pelo menos 45 s; atualizando a página (tentativa ${tentativas + 1}/2)`
    this.registrar(s, 'video', motivo)
    logAviso(`Navegador #${s.info.slot}`, motivo)
    this.avisarMudanca()
    try {
      await this.f5(s.info.slot)
    } finally {
      // Mesmo se o F5 falhar, aguardar antes de tentar de novo.
      s.recuperacaoEmAndamento = false
      s.recuperacaoBloqueadaAte = Date.now() + 60000
      s.info.proximaRecuperacaoEm = s.recuperacaoBloqueadaAte
      s.info.recuperacao = 'analisando'
      s.amostraMidia = undefined
      s.semAvancoDesde = undefined
      s.leiturasSemAvanco = 0
      this.avisarMudanca()
    }
  }

  agendarMiniaturas() {
    clearTimeout(this.timerMiniatura)
    const base = INTERVALO_MINIATURA[store.config.miniaturas]
    const quantidade = this.sessoes.size
    const intervalo = base && quantidade >= 20 ? Math.max(base, 5000) : base
    if (!intervalo) {
      for (const s of this.sessoes.values()) s.info.miniatura = undefined
      return
    }
    this.timerMiniatura = setTimeout(async () => {
      if (!this.pausado) {
        const todos = [...this.sessoes.values()].filter((s) => s.info.status === 'ok' && s.browser?.connected)
        // Acima de 20 perfis, atualizar no máximo 6 miniaturas por rodada.
        // As demais continuam visíveis com a última imagem, evitando picos de GPU.
        const qtd = todos.length >= 20 ? Math.min(6, todos.length) : todos.length
        const alvos = todos.length ? Array.from({ length: qtd }, (_, i) => todos[(this.indiceMiniatura + i) % todos.length]) : []
        if (todos.length) this.indiceMiniatura = (this.indiceMiniatura + qtd) % todos.length
        for (let i = 0; i < alvos.length; i += 3) {
          await Promise.all(alvos.slice(i, i + 3).map(async (s) => {
            try {
              const p = await paginaPrincipal(s.browser!)
              const img = await p.screenshot({ type: 'jpeg', quality: 35, encoding: 'base64', optimizeForSpeed: true })
              s.info.miniatura = String(img)
            } catch {
              /* navegador ocupado; tentar no próximo ciclo */
            }
          }))
          if (this.pausado) break
        }
        this.avisarMudanca()
      }
      this.agendarMiniaturas()
    }, intervalo)
  }

  async testarPlayLocal(slot: number): Promise<{ ok: boolean; detalhe: string }> {
    // Teste isolado: não aceita disparo em lote, não abre lives externas,
    // não reutiliza o player do site e só permite um perfil ativo.
    if (this.sessoes.size !== 1 || this.fila.length > 0 || this.abrindoAgora !== 0) {
      throw new Error('O teste de Play local exige apenas um navegador aberto e nenhuma abertura pendente.')
    }
    const s = this.sessoes.get(slot)
    if (!s?.browser?.connected || s.info.status !== 'ok') {
      throw new Error('Abra um único perfil e aguarde a conexão antes de testar.')
    }
    const pagina = await s.browser.newPage()
    try {
      await pagina.goto(urlPlayerDeTeste(), { waitUntil: 'domcontentloaded', timeout: 15000 })
      await pagina.waitForSelector('#botao-play', { timeout: 10000 })
      // Um único clique automatizado, no botão de uma página de demonstração local.
      await pagina.click('#botao-play')
      await new Promise((resolve) => setTimeout(resolve, 1300))
      const estado = await pagina.evaluate(() => {
        const video = document.getElementById('video') as HTMLVideoElement | null
        return {
          ok: !!video && !video.paused && video.readyState >= 2,
          texto: document.getElementById('estado')?.textContent || ''
        }
      })
      const detalhe = estado.ok
        ? 'Teste local: o clique foi executado e o vídeo de demonstração iniciou.'
        : 'Teste local: o clique foi feito, mas não houve reprodução confirmada. ' + estado.texto
      this.registrar(s, 'video', detalhe)
      this.avisarMudanca()
      return { ok: estado.ok, detalhe }
    } catch (e) {
      const detalhe = 'Falha no teste local de Play: ' + traduzirErro(e)
      this.registrar(s, 'erro', detalhe)
      this.avisarMudanca()
      await pagina.close().catch(() => undefined)
      return { ok: false, detalhe }
    }
  }

  async verificarAgora(slot: number) {
    const s = this.sessoes.get(slot)
    if (!s?.browser?.connected) throw new Error('O navegador não está conectado')
    await this.verificarSite(s)
    this.avisarMudanca()
    return { reproducao: s.info.reproducao, detalhe: s.info.reproducaoDetalhe, recuperacao: s.info.recuperacao }
  }

  retomarDiagnostico(slot: number) {
    const s = this.sessoes.get(slot)
    if (!s) throw new Error('Navegador não encontrado')
    s.info.recuperacao = 'analisando'
    s.info.tentativasRecuperacao = 0
    s.info.proximaRecuperacaoEm = undefined
    s.recuperacaoBloqueadaAte = undefined
    s.semAvancoDesde = undefined
    s.leiturasSemAvanco = 0
    s.amostraMidia = undefined
    s.pausaDesde = undefined
    s.leiturasPausado = 0
    s.alertaPausa = false
    this.registrar(s, 'video', 'Monitoramento reiniciado manualmente')
    this.avisarMudanca()
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
