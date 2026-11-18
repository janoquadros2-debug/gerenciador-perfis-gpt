import { setTimeout as esperar } from 'node:timers/promises'
import type { AgendaVpsEntrada, EstadoAgendaVps, ItemAgendaVps, LiveVps } from '../shared/lives-vps'
import { painelVps } from './painel-vps'
import { twitchLives } from './twitch-lives'
import { avisosWhatsApp } from './whatsapp-agenda'

type Etapa = EstadoAgendaVps['filas'][number]
const CONFIRMACAO_MS = 90_000
const INTERVALO_MS = 4000
const mensagem = (e: unknown) => e instanceof Error ? e.message : 'Erro inesperado.'

export function montarItensAgenda(itens: ItemAgendaVps[], catalogo: LiveVps[]) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 50)
    throw new Error('Selecione de 1 a 50 transmissões.')
  const vinculos = new Map(catalogo.map((live) => [live.id, live]))
  return itens.map((item) => {
    const live = vinculos.get(item.liveId)
    if (!live || ![1, 2].includes(item.fila) || !Number.isInteger(item.minutos) || item.minutos < 1 || item.minutos > 1440)
      throw new Error('Cada transmissão deve ter uma fila e duração entre 1 e 1.440 minutos.')
    return { liveId: item.liveId, fila: item.fila, minutos: item.minutos, live }
  })
}

export class AgendaVps {
  private estadoAtual: EstadoAgendaVps = { executando: false, filas: [], eventos: [] }
  private cancelarAtual?: AbortController
  private execucao?: Promise<void>
  private enviarAviso?: ReturnType<typeof avisosWhatsApp>
  private filaAvisos: Promise<void> = Promise.resolve()

  estado() { return this.estadoAtual }
  cancelar() { this.cancelarAtual?.abort() }
  async cancelarEAguardar() {
    this.cancelar()
    await this.execucao
  }

  iniciar(entrada: AgendaVpsEntrada, catalogo: LiveVps[]) {
    if (this.estadoAtual.executando) throw new Error('Já existe um agendamento rodando.')
    if (!entrada.twitchClientId?.trim() || !entrada.twitchSegredo?.trim())
      throw new Error('Informe o Client ID e o Client Secret da Twitch.')
    const iniciarEm = entrada.iniciarEm
    if (iniciarEm !== undefined && (!Number.isFinite(iniciarEm) || iniciarEm <= Date.now() || iniciarEm - Date.now() > 14 * 86400_000))
      throw new Error('O horário de início deve estar nos próximos 14 dias.')
    const itens = montarItensAgenda(entrada.itens, catalogo)
    const origens = new Map<string, ReturnType<typeof painelVps>>()
    const filasDosCanais = new Map<string, number>()
    const filasDasLives = new Map<string, number>()
    for (const item of itens) {
      const { live, fila } = item
      const outra = filasDosCanais.get(live.canal)
      if (outra && outra !== fila) throw new Error('O mesmo canal da Twitch não pode ficar nas duas filas.')
      filasDosCanais.set(live.canal, fila)
      const origem = new URL(live.painel).origin
      const chave = JSON.stringify([origem, live.live])
      const filaDaLive = filasDasLives.get(chave)
      if (filaDaLive && filaDaLive !== fila) throw new Error('A mesma live da VPS não pode ficar nas duas filas.')
      filasDasLives.set(chave, fila)
      if (!origens.has(origem)) origens.set(origem, painelVps(origem, entrada.senhas[origem]))
    }
    const online = twitchLives(entrada.twitchClientId.trim(), entrada.twitchSegredo.trim())
    this.enviarAviso = entrada.whatsapp ? avisosWhatsApp(entrada.whatsapp) : undefined
    const controlador = new AbortController()
    this.cancelarAtual = controlador
    const filas: Etapa[] = ([1, 2] as const)
      .filter((fila) => itens.some((item) => item.fila === fila))
      .map((fila) => ({ fila, etapa: 'aguardando' }))
    this.estadoAtual = { executando: true, iniciarEm, filas, eventos: [] }
    const executar = async () => {
      try {
        if (iniciarEm) await esperar(Math.max(0, iniciarEm - Date.now()), undefined, { signal: controlador.signal })
        this.estadoAtual.iniciarEm = undefined
        await Promise.all(filas.map(async (fila) => {
          try {
            await this.executarFila(fila, itens.filter((item) => item.fila === fila.fila), origens, online, controlador.signal)
          } catch (e) {
            this.registrar(fila, 'falha', mensagem(e))
          }
        }))
      } catch (e) {
        for (const fila of filas) this.registrar(fila, controlador.signal.aborted ? 'cancelada' : 'falha',
          controlador.signal.aborted ? 'Fila cancelada antes de começar.' : mensagem(e))
      } finally {
        await this.filaAvisos
        this.enviarAviso = undefined
        this.estadoAtual.executando = false
        this.estadoAtual.iniciarEm = undefined
        this.cancelarAtual = undefined
        this.execucao = undefined
      }
    }
    this.execucao = executar()
    return this.estadoAtual
  }

  private registrar(fila: Etapa, etapa: Etapa['etapa'], detalhe: string) {
    fila.etapa = etapa
    fila.detalhe = detalhe
    this.adicionarEvento(fila.fila, detalhe)
    const enviar = this.enviarAviso
    if (enviar && ['ao-vivo', 'falha', 'concluida', 'cancelada'].includes(etapa)) {
      this.filaAvisos = this.filaAvisos.then(async () => {
        try {
          await enviar(`Fila ${fila.fila}. ${detalhe}`)
          this.adicionarEvento(fila.fila, 'Aviso aceito pela API do WhatsApp.')
        } catch (e) {
          this.adicionarEvento(fila.fila, `Falha no aviso do WhatsApp. ${mensagem(e)}`)
        }
      })
    }
  }

  private adicionarEvento(fila: 1 | 2, texto: string) {
    this.estadoAtual.eventos.unshift({ hora: Date.now(), fila, texto })
    this.estadoAtual.eventos.length = Math.min(this.estadoAtual.eventos.length, 200)
  }

  private async executarFila(fila: Etapa, itens: (ItemAgendaVps & { live: LiveVps })[],
    paineis: Map<string, ReturnType<typeof painelVps>>, online: (canal: string) => Promise<string | null>, sinal: AbortSignal
  ) {
    for (const { live, minutos } of itens) {
      if (sinal.aborted) break
      fila.live = live.live
      let id: string | undefined
      let tentouIniciar = false
      let terminouNoPrazo = false
      const painel = paineis.get(new URL(live.painel).origin)!
      this.registrar(fila, 'iniciando', `Consultando ${live.live}.`)
      try {
        const estado = await painel.consultar(live.live)
        if (estado.ligada || await online(live.canal)) throw new Error('A live já está ligada. Esta fila não assumiu seu controle.')
        if (!estado.destinos.length) throw new Error('O painel não retornou um destino ativo para esta live.')
        sinal.throwIfAborted()
        id = estado.id
        tentouIniciar = true
        await painel.comando(id, 'iniciar')
        await this.confirmar(async () => {
          const atual = await painel.consultar(live.live)
          if (atual.id !== id) throw new Error('O ID da live no painel mudou.')
          return atual.ligada && atual.destinos.some((d) => d.estado === 'ao_vivo')
            ? online(live.canal) : null
        }, true, sinal)
        fila.terminaEm = Date.now() + minutos * 60_000
        this.registrar(fila, 'ao-vivo', `${live.live} confirmada pela Twitch.`)
        let falhas = 0
        while (Date.now() < fila.terminaEm) {
          await esperar(Math.min(15_000, Math.max(0, fila.terminaEm - Date.now())), undefined, { signal: sinal })
          if (Date.now() >= fila.terminaEm) break
          let noAr = false
          try { noAr = Boolean(await online(live.canal)) } catch { /* Uma consulta isolada pode falhar. */ }
          falhas = noAr ? 0 : falhas + 1
          if (falhas >= 3) throw new Error('A Twitch deixou de confirmar a transmissão.')
        }
        terminouNoPrazo = true
      } catch (e) {
        if (!sinal.aborted) this.registrar(fila, 'falha', `${live.live}: ${mensagem(e)}`)
      }

      fila.terminaEm = undefined
      if (tentouIniciar && id) {
        this.registrar(fila, 'encerrando', `Encerrando ${live.live}.`)
        try {
          const estado = await painel.consultar(live.live)
          if (estado.id !== id) throw new Error('O ID da live no painel mudou.')
          if (estado.ligada) await painel.comando(id, 'parar')
          await this.confirmar(async () => {
            const atual = await painel.consultar(live.live)
            if (atual.id !== id) throw new Error('O ID da live no painel mudou.')
            return atual.ligada || await online(live.canal) ? 'ativa' : null
          }, false)
          this.registrar(fila, 'aguardando', `${live.live}: encerramento confirmado.`)
        } catch (e) {
          this.registrar(fila, 'falha', `${live.live}: ${mensagem(e)} A fila parou para conferir a transmissão.`)
          return
        }
      }
      if (!sinal.aborted && !terminouNoPrazo)
        this.registrar(fila, 'aguardando', `Pulando ${live.live} e verificando a próxima transmissão da fila.`)
    }
    this.registrar(fila, sinal.aborted ? 'cancelada' : 'concluida',
      sinal.aborted ? 'Fila cancelada.' : 'Fila finalizada. Confira o histórico de execução.')
  }

  private async confirmar(consultar: () => Promise<string | null>, entrada: boolean, sinal?: AbortSignal) {
    const limite = Date.now() + CONFIRMACAO_MS
    do {
      sinal?.throwIfAborted()
      if (Boolean(await consultar()) === entrada) return
      await esperar(INTERVALO_MS, undefined, { signal: sinal })
    } while (Date.now() < limite)
    throw new Error(entrada ? 'A Twitch não confirmou a entrada no ar.' : 'A saída do ar não foi confirmada.')
  }
}
