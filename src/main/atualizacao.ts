// Atualizações com um clique: o programa procura versões novas no seu GitHub (Releases).
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { InfoAtualizacao } from '../shared/types'
import { logErro, logInfo, logOk } from './log'
import { EDICAO } from '../shared/edicao'
import { store } from './store'

let info: InfoAtualizacao = { versaoAtual: app.getVersion(), status: 'nao-configurado' }
let avisar: (i: InfoAtualizacao) => void = () => undefined

function mudar(parcial: Partial<InfoAtualizacao>) {
  const antes = info.status
  info = { ...info, ...parcial }
  if (info.status !== antes) {
    if (info.status === 'disponivel') logInfo('Atualização', `Nova versão disponível: v${info.novaVersao}.`)
    if (info.status === 'baixando') logInfo('Atualização', 'Baixando a nova versão…')
    if (info.status === 'pronta') logOk('Atualização', 'Download pronto. Instalando e reabrindo…')
    if (info.status === 'erro') logErro('Atualização', info.erro ?? 'Erro ao verificar atualização.')
  }
  avisar(info)
}

// antesDeInstalar: fecha os navegadores e libera a saída do programa, para o instalador
// conseguir fechar e reabrir o app sem nada segurando.
export function iniciarAtualizacoes(aoMudar: (i: InfoAtualizacao) => void, antesDeInstalar: () => Promise<void>) {
  avisar = aoMudar
  autoUpdater.autoDownload = false
  autoUpdater.on('checking-for-update', () => mudar({ status: 'verificando', erro: undefined }))
  autoUpdater.on('update-not-available', () => mudar({ status: 'em-dia' }))
  autoUpdater.on('update-available', (u) =>
    mudar({ status: 'disponivel', novaVersao: u.version, notas: typeof u.releaseNotes === 'string' ? u.releaseNotes : '' })
  )
  autoUpdater.on('download-progress', (p) => mudar({ status: 'baixando', progresso: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', async () => {
    mudar({ status: 'pronta' })
    await antesDeInstalar().catch(() => undefined)
    setImmediate(() => autoUpdater.quitAndInstall(true, true)) // fecha, instala e abre de novo
  })
  autoUpdater.on('error', (e) => mudar({ status: 'erro', erro: String(e?.message ?? e).slice(0, 200) }))
  setTimeout(() => verificar(), 5000)
}

function configurar(): boolean {
  const repo = 'janoquadros2-debug/gerenciador-perfis-gpt' // atualizador isolado do projeto original
  const [owner, nome] = repo.split('/')
  if (!owner || !nome) {
    mudar({ status: 'nao-configurado' })
    return false
  }
  autoUpdater.setFeedURL({ provider: 'github', owner, repo: nome })
  // Completa usa o canal de sempre (latest); Padrão usa o seu próprio (padrao) e nunca troca de edição
  autoUpdater.channel = EDICAO === 'padrao' ? 'padrao' : 'latest'
  autoUpdater.allowDowngrade = false
  return true
}

export function estadoAtualizacao() {
  return info
}

export async function verificar() {
  if (!app.isPackaged) return mudar({ status: 'erro', erro: 'Atualizações só funcionam no programa instalado.' })
  if (!configurar()) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (e: any) {
    mudar({ status: 'erro', erro: String(e?.message ?? e).slice(0, 200) })
  }
}

export async function atualizarAgora() {
  if (!configurar()) return
  await autoUpdater.downloadUpdate()
}

// Procura e, se tiver versão nova, já baixa e instala (usado pelo PC principal para atualizar o secundário com 1 clique).
export async function procurarEInstalar(): Promise<{ versao: string | null; atual: string }> {
  if (!app.isPackaged) throw new Error('Atualizações só funcionam no programa instalado.')
  if (!configurar()) throw new Error('Atualizações não configuradas neste PC (falta o repositório em Atualizações).')
  const r = await autoUpdater.checkForUpdates()
  const nova = r?.updateInfo?.version
  const temNova = r ? ((r as any).isUpdateAvailable ?? (nova && nova !== app.getVersion())) : false
  if (!temNova || !nova) return { versao: null, atual: app.getVersion() }
  logInfo('Atualização', `O PC principal pediu para atualizar: baixando a v${nova}…`)
  autoUpdater.downloadUpdate().catch((e) => mudar({ status: 'erro', erro: String(e?.message ?? e).slice(0, 200) }))
  return { versao: nova, atual: app.getVersion() }
}
