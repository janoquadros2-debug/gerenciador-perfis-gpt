// IA (edição Completa): fila de trabalhos do ComfyUI.
// Roda no PC que tem o ComfyUI (o secundário). O PC principal só pede e recebe o resultado.
import { randomUUID } from 'node:crypto'
import type { FluxoIA, ModeloIA, OpcoesGerar, PedidoPrompt, ResumoFluxo, StatusIA, TrabalhoIA } from '../../shared/types'
import { logErro, logInfo, logOk } from '../log'
import { store } from '../store'
import * as comfy from './comfy'
import { gerarLocal } from './prompt'
import { aplicar, BASICO_ID, descreverModelo, detectarCampos, fluxoBasico, fluxosProntos, opcoes, padroesDoFluxo, validarFluxo } from './fluxos'

interface Trabalho {
  info: TrabalhoIA
  opcoes: OpcoesGerar
  arquivos?: comfy.ArquivoGerado[]
  cancelar: AbortController
}

const trabalhos = new Map<string, Trabalho>()
const fila: string[] = []
let rodando = false
let status: StatusIA = { conectado: false }
// IA desligada (para os navegadores terem o PC todo): não aceita trabalhos e tira os modelos da memória
let desligada: StatusIA['desligada'] = undefined
const comDesligar = (st: StatusIA): StatusIA => ({ ...st, desligada, autoDesligar: store.ia.autoDesligar ?? true })

async function liberarMemoria() {
  if (!status.endereco) return
  // tira os modelos da placa de vídeo e da RAM (o ComfyUI continua aberto, só fica leve)
  await fetch(`${status.endereco}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => undefined)
}

export async function desligarIA(motivo: 'manual' | 'navegadores') {
  if (desligada) {
    // já desligada: só anota se agora foi você que desligou (aí não religa sozinha)
    if (motivo === 'manual' && desligada !== 'manual') {
      desligada = 'manual'
      avisar('ia-status', comDesligar(status))
    }
    return
  }
  const ja = false
  desligada = motivo
  // para o que estiver na fila e o que estiver gerando agora
  for (const t of trabalhos.values()) {
    if (t.info.status === 'na-fila') mudar(t, { status: 'cancelado', etapa: 'Cancelado: IA desligada' })
    else if (t.info.status === 'gerando') t.cancelar.abort()
  }
  fila.length = 0
  if (status.endereco) await fetch(`${status.endereco}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }).catch(() => undefined)
  await liberarMemoria()
  if (!ja) logInfo('IA', motivo === 'manual' ? 'IA desligada: a placa de vídeo e a RAM ficam livres para os navegadores.' : 'Navegadores abertos: IA desligada sozinha para não pesar o PC.')
  avisar('ia-status', comDesligar(status))
}

export function ligarIA(motivo?: 'manual' | 'navegadores') {
  // a volta automática (navegadores fecharam) não religa o que você desligou na mão
  if (!desligada || (motivo === 'navegadores' && desligada === 'manual')) return
  desligada = undefined
  logOk('IA', 'IA ligada de novo.')
  avisar('ia-status', comDesligar(status))
}
let avisar: (canal: string, dado: unknown) => void = () => undefined

const resumo = (f: FluxoIA): ResumoFluxo => {
  const { grafo: _g, ...r } = f
  return { ...r, padroes: padroesDoFluxo(f) }
}

// O que está instalado no ComfyUI (guardado por 5 minutos para não pedir toda hora).
let cacheInfo: { quando: number; info: Record<string, any> } | null = null
async function infoInstalada(): Promise<Record<string, any>> {
  if (cacheInfo && Date.now() - cacheInfo.quando < 5 * 60_000) return cacheInfo.info
  const st = status.conectado ? status : await conectar()
  if (!st.conectado || !st.endereco) return {}
  try {
    cacheInfo = { quando: Date.now(), info: await comfy.infoNos(st.endereco) }
  } catch {
    return cacheInfo?.info ?? {}
  }
  return cacheInfo.info
}

// Fluxos disponíveis: os prontos (conforme os modelos instalados), o básico (se houver checkpoints) e os importados.
async function todosOsFluxos(): Promise<FluxoIA[]> {
  const info = await infoInstalada()
  // o fluxo básico só aparece se houver checkpoint de IMAGEM (ex.: não conta o LTX, que é de vídeo)
  const temCheckpoint = opcoes(info, 'CheckpointLoaderSimple', 'ckpt_name').some((f) => descreverModelo(f, 'checkpoints').categoria === 'imagem')
  return [...fluxosProntos(info), ...(temCheckpoint ? [fluxoBasico()] : []), ...store.ia.fluxos]
}

function mudar(t: Trabalho, p: Partial<TrabalhoIA>) {
  t.info = { ...t.info, ...p }
  avisar('ia-trabalho', t.info)
}

async function conectar(endereco?: string): Promise<StatusIA> {
  try {
    const i = await comfy.encontrar(endereco || store.ia.endereco)
    status = { conectado: true, ...i }
    if (i.endereco !== store.ia.endereco) store.ia = { ...store.ia, endereco: i.endereco }
    cacheInfo = null
  } catch (e: any) {
    status = { conectado: false, endereco: endereco || store.ia.endereco, erro: e.message }
  }
  avisar('ia-status', comDesligar(status))
  return comDesligar(status)
}

async function processar() {
  if (rodando) return
  rodando = true
  try {
    while (fila.length) {
      const id = fila.shift()!
      const t = trabalhos.get(id)
      if (!t || t.info.status === 'cancelado') continue
      await rodar(t)
    }
  } finally {
    rodando = false
  }
}

async function rodar(t: Trabalho) {
  const fluxo = (await todosOsFluxos()).find((f) => f.id === t.opcoes.fluxoId)
  try {
    if (!fluxo) throw new Error('Esse fluxo não existe mais.')
    if (fluxo.id === BASICO_ID && !t.opcoes.modelo) throw new Error('Escolha um modelo para o fluxo básico.')
    const st = status.conectado ? status : await conectar()
    if (!st.conectado || !st.endereco) throw new Error(st.erro ?? 'ComfyUI não encontrado.')
    mudar(t, { status: 'gerando', etapa: 'Preparando…', porcentagem: undefined })

    const imagensNoComfy: string[] = []
    const entradas = t.opcoes.imagens ?? []
    if (entradas.length < fluxo.campos.imagem.length) throw new Error(`Esse fluxo precisa de ${fluxo.campos.imagem.length} imagem(ns).`)
    for (const [k, img] of entradas.entries()) {
      mudar(t, { etapa: entradas.length > 1 ? `Enviando a imagem ${k + 1}…` : 'Enviando a imagem…' })
      const ext = (img.nome.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? '.png').toLowerCase()
      imagensNoComfy.push(await comfy.subirImagem(st.endereco, `gerenciador-${t.info.id.slice(0, 8)}-${k + 1}${ext}`, Buffer.from(img.base64, 'base64')))
    }
    const grafo = aplicar(fluxo, { ...t.opcoes, imagensNoComfy })
    logInfo('IA', `${fluxo.tipo === 'video' ? 'Animando' : 'Gerando'} com "${fluxo.nome}"${t.opcoes.prompt ? `: ${t.opcoes.prompt.slice(0, 120)}` : ''}`)
    const inicio = Date.now()
    const arquivos = await comfy.executar(st.endereco, grafo, (p) => mudar(t, p), t.cancelar.signal)
    t.arquivos = arquivos
    t.opcoes.imagens = undefined // libera memória
    mudar(t, { status: 'pronto', etapa: 'Pronto', porcentagem: 100, terminouEm: Date.now(), arquivos: arquivos.map((a) => ({ nome: a.nome, midia: a.midia })) })
    logOk('IA', `Pronto em ${Math.round((Date.now() - inicio) / 1000)}s: ${arquivos.length} arquivo(s).`)
  } catch (e: any) {
    const cancelado = /Cancelado/.test(e.message)
    mudar(t, { status: cancelado ? 'cancelado' : 'erro', erro: cancelado ? undefined : e.message, etapa: cancelado ? 'Cancelado' : 'Erro', terminouEm: Date.now() })
    if (!cancelado) {
      logErro('IA', e.message)
      if (/conex|ComfyUI não|Não encontrei/i.test(e.message)) status = { ...status, conectado: false }
    }
  }
}

// limpa trabalhos antigos (mais de 2 horas) para não ocupar memória
setInterval(() => {
  const limite = Date.now() - 2 * 3600_000
  for (const [id, t] of trabalhos) if (t.info.terminouEm && t.info.terminouEm < limite) trabalhos.delete(id)
}, 10 * 60_000)

export function registrarIA(acoes: Record<string, (...a: any[]) => unknown>, enviar: (canal: string, dado: unknown) => void) {
  avisar = enviar
  conectar().catch(() => undefined)

  Object.assign(acoes, {
    iaStatus: () => comDesligar(status),
    iaDesligar: () => desligarIA('manual'),
    iaLigar: () => ligarIA('manual'),
    iaAutoDesligar: (v: boolean) => {
      store.ia = { ...store.ia, autoDesligar: v }
      avisar('ia-status', comDesligar(status))
    },
    iaConectar: (endereco?: string) => conectar(endereco),

    iaModelos: async (): Promise<ModeloIA[]> => {
      const st = status.conectado ? status : await conectar()
      if (!st.conectado || !st.endereco) throw new Error(st.erro ?? 'ComfyUI não encontrado.')
      const porPasta = await comfy.listarModelos(st.endereco)
      const lista: ModeloIA[] = []
      for (const [pasta, arquivos] of Object.entries(porPasta))
        for (const arquivo of arquivos ?? []) lista.push({ arquivo, pasta, ...descreverModelo(arquivo, pasta) })
      return lista
    },

    iaFluxos: async (): Promise<ResumoFluxo[]> => (await todosOsFluxos()).map(resumo),

    iaImportarFluxo: (o: { nome: string; tipo: 'imagem' | 'video'; json: string }): ResumoFluxo => {
      let dados: any
      try {
        dados = JSON.parse(o.json)
      } catch {
        throw new Error('Esse arquivo não é um .json válido.')
      }
      const grafo = validarFluxo(dados)
      const campos = detectarCampos(grafo)
      if (!campos.prompt.length && !campos.imagem.length) throw new Error('Não achei onde fica o prompt nem a imagem de entrada nesse fluxo.')
      if (o.tipo === 'video' && !campos.imagem.length) throw new Error('Para animar, o fluxo precisa de um nó "Load Image" (a imagem que vai ganhar movimento).')
      const f: FluxoIA = { id: randomUUID(), nome: o.nome.trim() || 'Meu fluxo', tipo: o.tipo, grafo, campos }
      store.ia = { ...store.ia, fluxos: [...store.ia.fluxos, f] }
      logOk('IA', `Fluxo "${f.nome}" importado (${o.tipo === 'video' ? 'animar' : 'imagem'}).`)
      return resumo(f)
    },

    iaApagarFluxo: (id: string) => {
      store.ia = { ...store.ia, fluxos: store.ia.fluxos.filter((f) => f.id !== id) }
    },

    iaGerar: async (o: OpcoesGerar): Promise<TrabalhoIA> => {
      const fluxo = (await todosOsFluxos()).find((f) => f.id === o.fluxoId)
      if (desligada) throw new Error(desligada === 'navegadores' ? 'A IA está desligada porque há navegadores abertos (para não pesar o PC). Feche os navegadores ou ligue a IA.' : 'A IA está desligada. Clique em "Ligar a IA" para usar.')
      if (!fluxo) throw new Error('Esse fluxo não está disponível. Confira se o ComfyUI está aberto.')
      if (fluxo.campos.prompt.length && !o.prompt?.trim()) throw new Error('Escreva o prompt.')
      if ((o.imagens?.length ?? 0) < fluxo.campos.imagem.length) throw new Error(`Escolha ${fluxo.campos.imagem.length === 1 ? 'a imagem' : `as ${fluxo.campos.imagem.length} imagens`}.`)
      const t: Trabalho = {
        opcoes: o,
        cancelar: new AbortController(),
        info: { id: randomUUID(), tipo: fluxo.tipo, fluxoNome: fluxo.nome, prompt: o.prompt ?? '', status: 'na-fila', etapa: 'Na fila', criadoEm: Date.now() }
      }
      trabalhos.set(t.info.id, t)
      fila.push(t.info.id)
      avisar('ia-trabalho', t.info)
      processar()
      return t.info
    },

    // gerador de prompt grátis (roda no ComfyUI deste PC)
    iaPromptLocal: async (p: PedidoPrompt) => {
      if (desligada) throw new Error('A IA do PC secundário está desligada (navegadores abertos). Ligue a IA ou use o Claude no gerador de prompt.')
      const st = status.conectado ? status : await conectar()
      if (!st.conectado || !st.endereco) throw new Error(st.erro ?? 'ComfyUI não encontrado.')
      return gerarLocal(st.endereco, await infoInstalada(), p)
    },

    iaTrabalhos: (): TrabalhoIA[] => [...trabalhos.values()].map((t) => t.info).sort((a, b) => b.criadoEm - a.criadoEm),

    iaCancelar: (id: string) => {
      const t = trabalhos.get(id)
      if (!t) return
      if (t.info.status === 'na-fila') mudar(t, { status: 'cancelado', etapa: 'Cancelado' })
      else if (t.info.status === 'gerando') t.cancelar.abort()
    },

    // o PC principal busca o resultado pronto para guardar na galeria dele
    iaBaixarResultado: async (id: string) => {
      const t = trabalhos.get(id)
      if (!t?.arquivos || !status.endereco) throw new Error('Resultado não encontrado.')
      const lista: { nome: string; midia: 'imagem' | 'video'; base64: string }[] = []
      for (const a of t.arquivos) lista.push({ nome: a.nome, midia: a.midia, base64: (await comfy.baixarArquivo(status.endereco, a)).toString('base64') })
      return { trabalho: t.info, arquivos: lista }
    }
  })
}
