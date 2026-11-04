// Aba Lives: conversa com o OBS deste PC pelo "WebSocket" que já vem dentro do OBS (Ferramentas > Configurações do servidor WebSocket).
// - OBS: cenas, transmissão principal, uso de CPU e quadros perdidos.
// - Seu plugin multi-rtmp (v0.10.0+): os 5 canais, cada um com status, bitrate e botão de ligar/desligar.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { WebSocket } from 'ws'
import type { CanalObs, ConfigObs, StatusObs } from '../shared/types'
import { logErro, logInfo, logOk } from './log'

const arq = () => path.join(app.getPath('userData'), 'obs.json')
const PADRAO: ConfigObs = { endereco: '127.0.0.1', porta: 4455, senha: '', alertas: true }
export function lerConfigObs(): ConfigObs {
  try {
    return { ...PADRAO, ...JSON.parse(fs.readFileSync(arq(), 'utf8')) }
  } catch {
    return { ...PADRAO }
  }
}
export function salvarConfigObs(p: Partial<ConfigObs>): ConfigObs {
  const c = { ...lerConfigObs(), ...p }
  fs.writeFileSync(arq(), JSON.stringify(c, null, 1))
  desconectar()
  return c
}

// ---------- conexão (protocolo do obs-websocket 5) ----------
let ws: WebSocket | null = null
let pronto: Promise<void> | null = null
const pendentes = new Map<string, { ok: (v: any) => void; erro: (e: Error) => void; timer: NodeJS.Timeout }>()
let ultimoErro = ''

function desconectar() {
  try {
    ws?.close()
  } catch {
    /* já fechado */
  }
  ws = null
  pronto = null
}

function conectar(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN && pronto) return pronto
  const c = lerConfigObs()
  pronto = new Promise<void>((ok, erro) => {
    const s = new WebSocket(`ws://${c.endereco}:${c.porta}`, 'obswebsocket.json', { handshakeTimeout: 4000 })
    ws = s
    const falhar = (e: string) => {
      ultimoErro = e
      erro(new Error(e))
      if (ws === s) desconectar()
    }
    s.on('error', (e: any) =>
      falhar(/ECONNREFUSED/.test(String(e?.message)) ? 'O OBS não está aberto, ou o servidor WebSocket dele está desligado (OBS > Ferramentas > Configurações do servidor WebSocket).' : `Não consegui falar com o OBS: ${e?.message ?? e}`)
    )
    s.on('close', (codigo) => {
      if (codigo === 4009) falhar('A senha do WebSocket do OBS está errada.')
      for (const [, p] of pendentes) p.erro(new Error('O OBS fechou a conexão.'))
      pendentes.clear()
      if (ws === s) desconectar()
    })
    s.on('message', (bruto) => {
      let m: any
      try {
        m = JSON.parse(String(bruto))
      } catch {
        return
      }
      if (m.op === 0) {
        // Hello: responde com Identify (e a senha, se o OBS pedir)
        const auth = m.d?.authentication
        const d: any = { rpcVersion: 1, eventSubscriptions: 0 }
        if (auth) {
          if (!c.senha) return falhar('O OBS pede senha: copie a senha em OBS > Ferramentas > Configurações do servidor WebSocket > Mostrar informações de conexão.')
          const segredo = createHash('sha256').update(c.senha + auth.salt).digest('base64')
          d.authentication = createHash('sha256').update(segredo + auth.challenge).digest('base64')
        }
        s.send(JSON.stringify({ op: 1, d }))
      } else if (m.op === 2) {
        ultimoErro = ''
        ok()
      } else if (m.op === 7) {
        const p = pendentes.get(m.d?.requestId)
        if (!p) return
        pendentes.delete(m.d.requestId)
        clearTimeout(p.timer)
        if (m.d.requestStatus?.result) p.ok(m.d.responseData ?? {})
        else p.erro(new Error(m.d.requestStatus?.comment ?? `o OBS recusou (${m.d.requestStatus?.code})`))
      }
    })
  })
  pronto.catch(() => undefined)
  return pronto
}

async function pedir(tipo: string, dados?: Record<string, unknown>): Promise<any> {
  await conectar()
  const s = ws
  if (!s || s.readyState !== WebSocket.OPEN) throw new Error(ultimoErro || 'Sem conexão com o OBS.')
  const id = randomUUID()
  return new Promise((ok, erro) => {
    const timer = setTimeout(() => {
      pendentes.delete(id)
      erro(new Error('O OBS demorou para responder.'))
    }, 8000)
    pendentes.set(id, { ok, erro, timer })
    s.send(JSON.stringify({ op: 6, d: { requestType: tipo, requestId: id, requestData: dados } }))
  })
}

const plugin = async (tipo: string, dados?: Record<string, unknown>) =>
  (await pedir('CallVendorRequest', { vendorName: 'obs-multi-rtmp', requestType: tipo, requestData: dados ?? {} })).responseData ?? {}

// ---------- status de tudo ----------
let anteriores = new Map<string, CanalObs>()
let avisar: (canal: string, dado: unknown) => void = () => undefined

export async function statusObs(): Promise<StatusObs> {
  try {
    const [versao, stream, stats, cenas] = await Promise.all([pedir('GetVersion'), pedir('GetStreamStatus'), pedir('GetStats'), pedir('GetSceneList')])
    let canais: CanalObs[] = []
    let plug = true
    try {
      const r = await plugin('GetTargets')
      canais = (r.targets ?? []).map((t: any) => ({
        id: t.id,
        nome: t.name || 'Canal',
        ligado: t.enabled !== false,
        noAr: !!t.live,
        conectando: !!(t.connecting || t.reconnecting || t.waitingRetry),
        tentativaEm: t.waitingRetry ? t.retrySecondsLeft : undefined,
        reconexoes: t.reconnectCount ?? 0,
        erro: t.lastErrorCode || undefined,
        kbps: t.kbps ?? 0,
        fps: t.fps ?? 0,
        perdidos: t.framesDropped ?? 0,
        total: t.framesTotal ?? 0,
        congestionamento: t.congestion ?? 0,
        tempoNoAr: t.uptimeSec ?? 0
      }))
    } catch {
      plug = false
    }
    vigiarQuedas(canais)
    return {
      conectado: true,
      versaoObs: versao.obsVersion,
      pluginPronto: plug,
      principal: { noAr: !!stream.outputActive, reconectando: !!stream.outputReconnecting, tempo: stream.outputTimecode, perdidos: stream.outputSkippedFrames ?? 0, total: stream.outputTotalFrames ?? 0 },
      cpu: Math.round(stats.cpuUsage ?? 0),
      fps: Math.round(stats.activeFps ?? 0),
      quadrosPerdidosRender: stats.renderSkippedFrames ?? 0,
      cenaAtual: cenas.currentProgramSceneName,
      cenas: (cenas.scenes ?? []).map((x: any) => x.sceneName).reverse(),
      canais
    }
  } catch (e: any) {
    return { conectado: false, erro: e.message, canais: [], cenas: [] }
  }
}

// avisa quando um canal cai (estava no ar e saiu sem você mandar)
const desligadosPorVoce = new Set<string>()
function vigiarQuedas(canais: CanalObs[]) {
  const alertas = lerConfigObs().alertas
  for (const c of canais) {
    const antes = anteriores.get(c.id)
    if (antes?.noAr && !c.noAr && !desligadosPorVoce.has(c.id)) {
      logErro('Lives', `O canal "${c.nome}" caiu${c.conectando ? ' (o plugin está tentando reconectar)' : ''}.`)
      if (alertas) avisar('obs-alerta', { titulo: `Live caiu: ${c.nome}`, texto: c.conectando ? 'O plugin está tentando reconectar sozinho.' : 'Confira a internet ou ligue o canal de novo.' })
    }
    if (!antes?.noAr && c.noAr && antes) logOk('Lives', `"${c.nome}" está no ar.`)
    if (c.noAr) desligadosPorVoce.delete(c.id)
  }
  anteriores = new Map(canais.map((c) => [c.id, c]))
}

// ---------- abrir o OBS ----------
function acharObs(): string | null {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const opcoes = [path.join(pf, 'obs-studio\\bin\\64bit\\obs64.exe'), path.join(pf86, 'obs-studio\\bin\\64bit\\obs64.exe')]
  return opcoes.find((p) => fs.existsSync(p)) ?? null
}

export async function abrirObs() {
  if ((await statusObs()).conectado) return
  const exe = acharObs()
  if (!exe) throw new Error('Não achei o OBS neste PC (C:\\Program Files\\obs-studio).')
  // o OBS precisa ser aberto de dentro da pasta dele
  spawn(exe, ['--disable-shutdown-check'], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref()
  logInfo('Lives', 'Abrindo o OBS…')
}

export function acoesObs(avisarTela: (canal: string, dado: unknown) => void) {
  avisar = avisarTela
  // de 10 em 10 s confere se alguma live caiu (mesmo com a aba fechada)
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) statusObs().catch(() => undefined)
  }, 10_000)
  return {
    obsConfig: () => lerConfigObs(),
    salvarObsConfig: (p: Partial<ConfigObs>) => salvarConfigObs(p),
    obsStatus: () => statusObs(),
    obsAbrir: () => abrirObs(),
    obsCena: (nome: string) => pedir('SetCurrentProgramScene', { sceneName: nome }),
    obsPrincipal: async (ligar: boolean) => {
      await pedir(ligar ? 'StartStream' : 'StopStream')
      logInfo('Lives', ligar ? 'Transmissão principal do OBS ligada.' : 'Transmissão principal do OBS desligada.')
    },
    obsCanal: async (id: string, ligar: boolean, nome?: string) => {
      if (!ligar) desligadosPorVoce.add(id)
      const r = await plugin(ligar ? 'StartTarget' : 'StopTarget', { id })
      if (!r.ok) throw new Error('Não achei esse canal no plugin.')
      logInfo('Lives', `${ligar ? 'Ligando' : 'Desligando'} o canal "${nome ?? id}".`)
    },
    obsTodos: async (ligar: boolean) => {
      if (!ligar) for (const c of anteriores.keys()) desligadosPorVoce.add(c)
      await plugin(ligar ? 'StartAll' : 'StopAll')
      logInfo('Lives', ligar ? 'Ligando todos os canais.' : 'Desligando todos os canais.')
    }
  }
}

// fechar o programa: fecha a conexão (as lives continuam no OBS)
app.on('before-quit', () => desconectar())
