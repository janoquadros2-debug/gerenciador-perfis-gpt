// Registro de tudo o que o programa faz (aba Logs).
// Fica na memória (últimos 3000) e também em arquivos por dia: %APPDATA%\Gerenciador de Perfis\logs\
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { EntradaLog, NivelLog } from '../shared/types'

const MAXIMO = 3000
const DIAS_GUARDADOS = 7
const entradas: EntradaLog[] = []
let seq = 0
let enviar: (novas: EntradaLog[]) => void = () => undefined
let pendentes: EntradaLog[] = []
let timer: NodeJS.Timeout | undefined

export const pastaLogs = () => path.join(app.getPath('userData'), 'logs')
const arquivoDoDia = (d = new Date()) => path.join(pastaLogs(), `${d.toISOString().slice(0, 10)}.txt`)

export function iniciarLog(aoNovo: (novas: EntradaLog[]) => void) {
  enviar = aoNovo
  try {
    fs.mkdirSync(pastaLogs(), { recursive: true })
    // apaga arquivos com mais de 7 dias
    const limite = Date.now() - DIAS_GUARDADOS * 86_400_000
    for (const f of fs.readdirSync(pastaLogs())) {
      const p = path.join(pastaLogs(), f)
      if (fs.statSync(p).mtimeMs < limite) fs.rmSync(p, { force: true })
    }
  } catch {
    /* sem pasta de logs: continua só na memória */
  }
}

export function log(nivel: NivelLog, origem: string, texto: string) {
  const ultima = entradas[entradas.length - 1]
  // a mesma mensagem repetida em seguida vira "(x3)" em vez de encher a tela
  if (ultima && ultima.texto === texto && ultima.origem === origem && ultima.nivel === nivel && Date.now() - ultima.quando < 120_000) {
    ultima.repeticoes = (ultima.repeticoes ?? 1) + 1
    ultima.quando = Date.now()
    agendarEnvio(ultima)
    return
  }
  const e: EntradaLog = { id: ++seq, quando: Date.now(), nivel, origem, texto }
  entradas.push(e)
  if (entradas.length > MAXIMO) entradas.splice(0, entradas.length - MAXIMO)
  agendarEnvio(e)
  try {
    fs.appendFileSync(arquivoDoDia(), linhaDeTexto(e) + '\n')
  } catch {
    /* disco cheio ou sem permissão: ignora */
  }
}

export const logInfo = (origem: string, texto: string) => log('info', origem, texto)
export const logOk = (origem: string, texto: string) => log('ok', origem, texto)
export const logAviso = (origem: string, texto: string) => log('aviso', origem, texto)
export const logErro = (origem: string, texto: string) => log('erro', origem, texto)

function agendarEnvio(e: EntradaLog) {
  pendentes = pendentes.filter((p) => p.id !== e.id).concat({ ...e })
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    const lote = pendentes
    pendentes = []
    enviar(lote)
  }, 250)
}

export function linhaDeTexto(e: EntradaLog) {
  const hora = new Date(e.quando).toLocaleString('pt-BR')
  const nivel = { info: 'INFO ', ok: 'OK   ', aviso: 'AVISO', erro: 'ERRO ' }[e.nivel]
  return `[${hora}] ${nivel} ${e.origem}: ${e.texto}${e.repeticoes ? ` (x${e.repeticoes})` : ''}`
}

export const todosOsLogs = () => entradas
export function limparLogs() {
  entradas.length = 0
}
