// Ponto de partida do programa: cria a janela e liga a interface ao motor.
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Configuracoes, OpcoesCriacaoMassa, ProgressoCriacao, Proxy } from '../shared/types'
import { atualizarAgora, estadoAtualizacao, iniciarAtualizacoes, procurarEInstalar, verificar } from './atualizacao'
import * as dolphin from './dolphin'
import { listarMonitores } from './janelas'
import { Motor } from './motor'
import { lerLinha, lerLista, marcarUsado, mesclarNaLista, proximoNaoUsado, ProxiesEsgotados, proxyParaTexto, repetirLista, testarVarios, zerarContagem } from './proxies'
import { carregar, salvarAgora, store } from './store'
import { iniciarLog, limparLogs, linhaDeTexto, logAviso, logErro, logInfo, logOk, pastaLogs, todosOsLogs } from './log'
import { sortearDuracao, sortearSistemas } from '../shared/sorteio'
import { EDICAO } from '../shared/edicao'
import { novoCodigo, procurarNaRede, Rede } from './rede'
import * as galeria from './ia/galeria'
import { acoesSuno } from './suno'
import { lerHardware } from './hardware'
import { acoesObs } from './obs'
import type { TrabalhoIA } from '../shared/types'
import type { ConfigRede, EntradaLog } from '../shared/types'

let janela: BrowserWindow | null = null
const motor = new Motor()

function enviarTela(canal: string, dado: unknown) {
  janela?.webContents.send(canal, dado)
}

// Eventos do motor deste PC (Ao vivo, logs, progresso…).
// No modo Principal, quem trabalha é o outro PC: só os logs locais (da conexão) aparecem na tela.
// No modo Secundário, além da tela daqui, vão também para o PC principal.
function enviar(canal: string, dado: unknown) {
  if (rede.papel === 'principal') {
    if (canal === 'logs') enviarTela(canal, dado)
    return
  }
  enviarTela(canal, dado)
  rede.transmitir(canal, dado)
  // só este PC: o resultado da IA vai direto para a galeria daqui
  if (canal === 'ia-trabalho' && rede.papel === 'unico') guardarResultado(dado as TrabalhoIA, (n, a) => executarLocal(n, a))
}

// Quando uma imagem/vídeo fica pronto, o PC principal busca e guarda na galeria dele.
const jaGuardados = new Set<string>()
async function guardarResultado(t: TrabalhoIA, buscar: (nome: string, args: unknown[]) => Promise<unknown>) {
  if (t.status !== 'pronto' || jaGuardados.has(t.id)) return
  jaGuardados.add(t.id)
  try {
    const r = (await buscar('iaBaixarResultado', [t.id])) as Parameters<typeof galeria.salvarNaGaleria>[0]
    const salvos = galeria.salvarNaGaleria(r)
    logOk('IA', `${salvos.length} arquivo(s) salvos na galeria.`)
    enviarTela('galeria', salvos)
  } catch (e: any) {
    jaGuardados.delete(t.id)
    logErro('IA', `Não consegui trazer o resultado para a galeria: ${e.message}`)
  }
}

// Logs que vêm do outro PC ganham outro número para não se misturarem com os daqui.
const ID_REMOTO = 1_000_000_000
const marcarRemotos = (l: EntradaLog[]) => l.map((e) => ({ ...e, id: e.id + ID_REMOTO, origem: e.origem }))

function criarJanela() {
  janela = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0B0B12',
    title: 'Gerenciador de Perfis GPT',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  janela.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) janela.loadURL(process.env.ELECTRON_RENDERER_URL)
  else janela.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// Todas as funções que a interface pode chamar.
const acoes: Record<string, (...args: any[]) => unknown> = {
  // configurações
  obterConfig: () => store.config,
  salvarConfig: (parcial: Partial<Configuracoes>) => {
    const antes = store.config
    const cfg = store.setConfig(parcial)
    if (parcial.tokenDolphin !== undefined && parcial.tokenDolphin !== antes.tokenDolphin) dolphin.esquecerLogin()
    if (parcial.miniaturas) motor.agendarMiniaturas()
    if (parcial.intervaloVerificacao !== undefined || parcial.diagnosticoReproducao !== undefined) motor.agendarVerificacao()
    if (parcial.iniciarComWindows !== undefined) app.setLoginItemSettings({ openAtLogin: parcial.iniciarComWindows })
    return cfg
  },
  monitores: () => listarMonitores(),
  versao: () => app.getVersion(),
  operacoes: () => store.operacoes,
  marcarOperacoesRevisadas: () => store.reconhecerOperacoes(),
  exportarBackupLocal: async () => {
    salvarAgora()
    const data = new Date().toISOString().replace(/[:.]/g, '-')
    const r = await dialog.showSaveDialog(janela!, {
      title: 'Salvar backup das configurações do Gerenciador de Perfis GPT',
      defaultPath: 'Gerenciador-GPT-backup-' + data + '.json',
      filters: [{ name: 'Backup JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { cancelado: true }
    const origem = path.join(app.getPath('userData'), 'dados.json')
    fs.copyFileSync(origem, r.filePath)
    logOk('Backup', 'Configurações do aplicativo exportadas para uma cópia local.')
    return { cancelado: false, caminho: r.filePath }
  },

  // Dolphin e perfis
  testarDolphin: async () => {
    const r = await dolphin.testarConexao()
    if (r.nuvem && r.local) logOk('Dolphin', 'Conexão com o Dolphin OK (conta e app aberto).')
    else logErro('Dolphin', `Teste de conexão: conta ${r.nuvem ? 'ok' : 'falhou'}, app no PC ${r.local ? 'ok' : 'não encontrado'}${r.erro ? ` · ${r.erro}` : ''}`)
    return r
  },
  listarPerfis: async () => {
    try {
      motor.perfis = await dolphin.listarPerfis()
    } catch (e: any) {
      logErro('Dolphin', `Não consegui listar os perfis: ${e.message}`)
      throw e
    }
    return motor.perfis
  },
  definirSite: (perfilId: number, site: string) => {
    store.setSite(perfilId, site)
    const p = motor.perfis.find((x) => x.id === perfilId)
    if (p) p.site = site || undefined
  },
  apagarPerfis: async (ids: number[]) => {
    const erros: string[] = []
    // fecha antes os navegadores desses perfis que estiverem abertos
    const abertos = motor.estado().navegadores.filter((n) => ids.includes(n.perfilId)).map((n) => n.slot)
    if (abertos.length) await motor.encerrar(abertos)
    logInfo('Perfis', `Apagando ${ids.length} perfis…`)
    for (const id of ids) {
      try {
        await dolphin.apagarPerfil(id)
      } catch (e: any) {
        erros.push(e.message)
        logErro('Perfis', `Não apagou o perfil ${id}: ${e.message}`)
      }
    }
    logOk('Perfis', `${ids.length - erros.length} de ${ids.length} perfis apagados.`)
    motor.perfis = await dolphin.listarPerfis().catch(() => motor.perfis)
    return erros
  },
  criarEmMassa: async (o: OpcoesCriacaoMassa) => {
    const prog: ProgressoCriacao = { feitos: 0, total: o.quantidade, erros: [], terminou: false }
    logInfo('Criação', `Criando ${o.quantidade} perfis: ${o.nomeBase} ${o.comecarDe} a ${o.nomeBase} ${o.comecarDe + o.quantidade - 1}${o.abrirAoCriar ? ', abrindo cada um' : ''}.`)
    // proxies colados aqui também vão para a lista salva (aba Proxies), para o "+1 / Adicionar" continuar dela
    const lista: Proxy[] =
      o.modoProxy === 'lista' ? mesclarNaLista(lerLista(o.listaProxies ?? '', o.tipoProxy)) : []
    store.modeloAdicionar = { ...o, listaProxies: undefined, proxyUnico: undefined }
    const unico = o.modoProxy === 'mesmo' ? lerLinha(o.proxyUnico ?? '', o.tipoProxy) : null
    // nomes que já existem são pulados: assim, rodar de novo cria só os que faltaram
    const jaExistem = await dolphin.listarPerfis().catch(() => motor.perfis)
    const existentes = new Map(jaExistem.map((p) => [p.nome, p]))
    let pulados = 0
    const sistemas =
      o.sistema === 'sorteado'
        ? sortearSistemas(o.quantidade, o.porcentagens ?? { windows: 100, macos: 0, linux: 0 })
        : Array(o.quantidade).fill(o.sistema)
    for (let i = 0; i < o.quantidade; i++) {
      const nome = `${o.nomeBase} ${o.comecarDe + i}`
      const proxy = o.modoProxy === 'lista' && lista.length ? lista[i % lista.length] : unico
      const existente = existentes.get(nome)
      if (existente) {
        // Perfis com nomes existentes reutilizam o cadastro, MAS precisam receber o site
        // solicitado nesta criação. Antes abriam o URL antigo (geralmente o Google).
        if (o.site?.trim()) {
          const site = o.site.trim()
          store.setSite(existente.id, site)
          existente.site = site
        }
        if (o.site2?.trim()) {
          const site2 = o.site2.trim()
          store.setSite2(existente.id, site2)
          existente.site2 = site2
        }
        if (o.abrirAoCriar) motor.abrir([existente], { manterProxy: true, tempoAberto: o.tempoAberto, aoAcabar: o.aoAcabar ?? 'reabrir', recarregar: o.recarregar, cookies: o.cookies })
        pulados++
        prog.feitos = i + 1
        prog.pulados = pulados
        enviar('progresso-criacao', { ...prog })
        continue
      }
      try {
        const id = await dolphin.criarPerfil(nome, { sistema: sistemas[i], etiqueta: o.etiqueta, proxy, privacidade: o.privacidade })
        if (o.modoProxy === 'lista' && proxy) marcarUsado(proxy)
        logOk('Criação', `${nome} criado (${sistemas[i]}${proxy ? `, proxy ${proxy.host}:${proxy.porta}` : ', sem proxy'}).`)
        if (o.site && id) store.setSite(id, o.site)
        if (o.site2?.trim() && id) store.setSite2(id, o.site2.trim())
        if (o.abrirAoCriar && id) {
          const novo = {
            id,
            nome,
            etiquetas: o.etiqueta ? [o.etiqueta] : [],
            plataforma: sistemas[i],
            proxyTexto: proxy ? proxyParaTexto(proxy) : undefined,
            site: o.site || undefined,
            site2: o.site2?.trim() || undefined
          }
          motor.perfis.push(novo)
          motor.abrir([novo], { manterProxy: true, tempoAberto: o.tempoAberto, aoAcabar: o.aoAcabar ?? 'reabrir', recarregar: o.recarregar, cookies: o.cookies }) // abre já, enquanto os próximos vão sendo criados
        }
      } catch (e: any) {
        prog.erros.push(`${nome}: ${e.message}`)
        logErro('Criação', `${nome} não foi criado: ${e.message}`)
      }
      prog.feitos = i + 1
      enviar('progresso-criacao', { ...prog })
    }
    prog.terminou = true
    enviar('progresso-criacao', { ...prog })
    logInfo('Criação', `Terminou: ${prog.total - prog.erros.length - (prog.pulados ?? 0)} criados, ${prog.pulados ?? 0} já existiam, ${prog.erros.length} com erro.`)
    motor.perfis = await dolphin.listarPerfis().catch(() => motor.perfis)
    return prog
  },

  // navegadores
  estado: () => motor.estado(),
  abrirPerfis: (ids: number[]) => motor.abrir(motor.perfis.filter((p) => ids.includes(p.id))),
  responderProxies: (r: RespostaProxies) => {
    const f = responderPergunta
    responderPergunta = null
    f?.(r)
  },
  adicionar: (n: number) => {
    filaAdicionar = filaAdicionar.then(() => adicionarNovos(n)).catch((e) => motor.avisar(String(e?.message ?? e)))
  },
  f5: (slot: number) => motor.f5(slot),
  verificarVideoAgora: (slot: number) => motor.verificarAgora(slot),
  testarPlayLocal: (slot: number) => motor.testarPlayLocal(slot),
  retomarDiagnostico: (slot: number) => motor.retomarDiagnostico(slot),
  ajustarCronometros: (slots: number[], tipo: 'f5' | 'fechamento', tempo: import('../shared/types').TempoAberto, aoAcabar?: 'fechar' | 'reabrir') =>
    motor.ajustarCronometros(slots, tipo, tempo, aoAcabar),
  recarregarComErro: () => motor.recarregarComErro(),
  encerrar: (slots: number[]) => motor.encerrar(slots),
  encerrarTodos: () => motor.encerrarTodos(),
  substituir: (slot: number, opcoes: Parameters<Motor['substituir']>[1]) => motor.substituir(slot, opcoes),
  substituirTodosComErro: () => motor.substituirTodosComErro(),
  pausar: () => motor.pausar(),
  retomar: () => motor.retomar(),
  organizarTodos: () => motor.organizarTodos(),
  escolherGrupoJanelas: (grupo: number) => motor.escolherGrupo(grupo),
  diagnosticarProxyPerfil: (slot: number) => motor.diagnosticarProxy(slot),
  diagnosticoRedeLocal: () => ({
    versao: app.getVersion(), edicao: EDICAO, hora: Date.now(),
    navegadores: motor.estado().navegadores.length, fila: motor.estado().fila
  }),
  diagnosticoRede: async () => {
    if (rede.status.papel !== 'principal') return {
      ok: true, local: true, versao: app.getVersion(), navegadores: motor.estado().navegadores.length
    }
    if (!rede.conectado) throw new Error('PC secundário não conectado')
    const inicio = Date.now()
    const r = await rede.chamar('diagnosticoRedeLocal', [], 10000)
    return { ok: true, local: false, latenciaMs: Date.now() - inicio, remoto: r }
  },
  trazerParaFrente: (slot: number) => motor.trazerParaFrente(slot),
  abasNavegador: (slot: number) => motor.abas(slot),
  escolherAba: (slot: number, i: number) => motor.escolherAba(slot, i),
  clicarNavegador: (slot: number, x: number, y: number, botao?: 'left' | 'right', duplo?: boolean) => motor.clicar(slot, x, y, botao, duplo),
  rolarNavegador: (slot: number, x: number, y: number, dy: number) => motor.rolar(slot, x, y, dy),
  digitarNavegador: (slot: number, texto: string, tecla?: string) => motor.digitar(slot, texto, tecla),
  miniaturaGrande: (slot: number) => motor.miniaturaGrande(slot),
  limparAvisos: () => motor.limparAvisos(),

  // proxies
  proxies: () => store.proxies,
  adicionarProxies: (texto: string) => {
    const novos = lerLista(texto, store.config.tipoProxyPadrao)
    store.setProxies([...store.proxies, ...novos])
    return store.proxies
  },
  salvarProxies: (lista: Proxy[]) => {
    store.setProxies(lista)
    return lista
  },
  testarProxies: async (ids?: string[]) => {
    const alvo = ids ? store.proxies.filter((p) => ids.includes(p.id)) : store.proxies
    logInfo('Proxies', `Testando ${alvo.length} proxies…`)
    await testarVarios(alvo, 10, (p) => {
      enviar('proxies', store.proxies)
      const t = p.ultimoTeste
      if (t?.ok) logOk('Proxies', `${p.host}:${p.porta} funcionando · IP ${t.ip} (${[t.cidade, t.pais].filter(Boolean).join(', ')}) · ${t.ms} ms`)
      else logErro('Proxies', `${p.host}:${p.porta} falhou: ${t?.erro}`)
    })
    store.setProxies(store.proxies)
    logInfo('Proxies', `Teste terminou: ${alvo.filter((p) => p.ultimoTeste?.ok).length} de ${alvo.length} funcionando.`)
    return store.proxies
  },
  testarTexto: async (texto: string) => {
    const lista = lerLista(texto, store.config.tipoProxyPadrao)
    return testarVarios(lista, 10)
  },
  repetirProxies: () => {
    logInfo('Proxies', 'Lista de proxies liberada de novo (Repetir).')
    repetirLista()
    motor.retomar()
  },
  zerarContagem: () => {
    zerarContagem()
    return store.proxies
  },

  // memória
  limparRam: () => motor.limparRam(),

  // logs
  logs: () => todosOsLogs(),
  limparLogs: () => limparLogs(),
  abrirPastaLogs: () => shell.openPath(pastaLogs()),
  textoDosLogs: (ids?: number[]) =>
    todosOsLogs()
      .filter((e) => !ids || ids.includes(e.id))
      .map(linhaDeTexto)
      .join('\n'),

  // sugestões
  sugestoes: () => store.sugestoes,
  adicionarSugestao: (texto: string) => {
    store.setSugestoes([{ id: randomUUID(), texto, quando: Date.now() }, ...store.sugestoes])
    return store.sugestoes
  },
  apagarSugestao: (id: string) => {
    store.setSugestoes(store.sugestoes.filter((s) => s.id !== id))
    return store.sugestoes
  },

  // atualizações
  estadoAtualizacao: () => estadoAtualizacao(),
  verificarAtualizacao: () => verificar(),
  atualizarAgora: async (junto?: boolean) => {
    // "atualizar os dois juntos": manda o secundário atualizar antes de este PC fechar para instalar
    if (junto && rede.status.papel === 'principal' && rede.conectado) await Promise.resolve(acoes.atualizarOutroPc()).catch(() => undefined)
    return atualizarAgora()
  },
  procurarEInstalar: () => procurarEInstalar(),
  estadoAtualizacaoOutro: () => (rede.status.papel === 'principal' && rede.conectado ? rede.chamar('estadoAtualizacao', [], 8000).catch(() => null) : null),
  atualizarOutroPc: async () => {
    if (!(rede.status.papel === 'principal' && rede.conectado)) throw new Error('O PC secundário não está conectado.')
    const r = (await rede.chamar('procurarEInstalar', [], 60_000)) as { versao: string | null; atual: string }
    logInfo('Atualização', r.versao ? `PC secundário: atualizando para a v${r.versao} (ele fecha e abre sozinho).` : `PC secundário já está na versão mais recente (v${r.atual}).`)
    return r
  }
}

// ---------- "+1 / Adicionar": cria perfis novos e já abre ----------
const LIMITE_PLANO = 100
let filaAdicionar: Promise<void> = Promise.resolve() // cliques seguidos entram em fila, sem misturar números

function proximoNumero(perfis: { nome: string }[], base: string): number {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`)
  let maior = 0
  for (const p of perfis) {
    const m = p.nome.match(re)
    if (m) maior = Math.max(maior, Number(m[1]))
  }
  return maior + 1
}

// Pergunta na tela o que fazer quando os proxies acabam, e espera a resposta.
type RespostaProxies = 'resetar' | 'meu-ip' | 'cancelar'
let responderPergunta: ((r: RespostaProxies) => void) | null = null
function perguntarSobreProxies(info: { faltam: number; listaVazia: boolean }): Promise<RespostaProxies> {
  responderPergunta?.('cancelar')
  janela?.show()
  enviar('pergunta-proxies', info)
  return new Promise((resolve) => (responderPergunta = resolve))
}

async function adicionarNovos(n: number) {
  if (!n || n < 1) return
  const m = store.modeloAdicionar
  const perfis = await dolphin.listarPerfis()
  motor.perfis = perfis
  const cabem = LIMITE_PLANO - perfis.length
  if (cabem <= 0) return motor.avisar(`O plano já está com ${perfis.length} de ${LIMITE_PLANO} perfis. Apague alguns para adicionar.`)
  if (n > cabem) {
    motor.avisar(`Só cabem mais ${cabem} perfis no plano. Vou criar ${cabem}.`)
    n = cabem
  }
  const sistemas =
    m.sistema === 'sorteado'
      ? sortearSistemas(n, m.porcentagens ?? { windows: 100, macos: 0, linux: 0 })
      : Array(n).fill(m.sistema)
  let numero = proximoNumero(perfis, m.nomeBase)

  let usarMeuIp = false
  for (let i = 0; i < n; i++, numero++) {
    // próximo proxy da lista que ainda não foi usado; se acabou, pergunta o que fazer
    let proxy: Proxy | null = null
    if (!usarMeuIp) {
      try {
        proxy = proximoNaoUsado()
      } catch (e: any) {
        const listaVazia = !(e instanceof ProxiesEsgotados)
        logAviso('Proxies', listaVazia ? 'A lista de proxies está vazia.' : 'Todos os proxies da lista já foram usados.')
        const resposta = await perguntarSobreProxies({ faltam: n - i, listaVazia })
        logInfo('Proxies', `Você escolheu: ${{ resetar: 'resetar a lista', 'meu-ip': 'usar o seu IP', cancelar: 'cancelar' }[resposta]}.`)
        if (resposta === 'cancelar') {
          motor.avisar(i ? `Parei: ${i} criados, ${n - i} cancelados.` : 'Cancelado: nenhum perfil criado.')
          return
        }
        if (resposta === 'resetar') {
          repetirLista()
          proxy = proximoNaoUsado()
        } else {
          usarMeuIp = true
        }
      }
    }
    const nome = `${m.nomeBase} ${numero}`
    logInfo('Adicionar', `Criando ${nome} (${i + 1} de ${n}) ${proxy ? `com o proxy ${proxy.host}:${proxy.porta}` : 'com o seu IP'}.`)
    motor.avisar(`Criando ${nome} (${i + 1} de ${n}) ${proxy ? `com o proxy ${proxy.host}:${proxy.porta}` : 'com o seu IP (sem proxy)'}…`)
    try {
      const id = await dolphin.criarPerfil(nome, { sistema: sistemas[i], etiqueta: m.etiqueta, proxy, privacidade: m.privacidade })
      if (m.site) store.setSite(id, m.site)
      if (m.site2?.trim()) store.setSite2(id, m.site2.trim())
      const novo = {
        id,
        nome,
        etiquetas: m.etiqueta ? [m.etiqueta] : [],
        plataforma: sistemas[i],
        proxyTexto: proxy ? proxyParaTexto(proxy) : undefined,
        site: m.site || undefined,
        site2: m.site2?.trim() || undefined
      }
      motor.perfis.push(novo)
      motor.abrir([novo], { manterProxy: true, tempoAberto: m.tempoAberto, aoAcabar: m.aoAcabar ?? 'reabrir', recarregar: m.recarregar, cookies: m.cookies })
    } catch (e: any) {
      logErro('Adicionar', `${nome} não foi criado: ${e.message}`)
      motor.avisar(`${nome}: ${e.message}`)
    }
  }
  motor.avisar(n === 1 ? 'Perfil criado e abrindo.' : `${n} perfis criados e abrindo.`)
}

// Ações que sempre rodam NESTE PC, mesmo no modo Principal.
const LOCAIS = new Set([
  'versao', 'edicao', 'estadoAtualizacao', 'verificarAtualizacao', 'atualizarAgora', 'estadoAtualizacaoOutro', 'atualizarOutroPc',
  'rede', 'salvarRede', 'procurarPcs', 'novoCodigo',
  'sugestoes', 'adicionarSugestao', 'apagarSugestao', 'abrirPastaLogs',
  'exportarBackupLocal',
  'galeria', 'lerDaGaleria', 'apagarDaGaleria', 'abrirPastaGaleria', 'mostrarNaPasta',
  'sunoJaSalvos', 'sunoSalvar', 'sunoLog', 'sunoStatus', 'sunoEntrar', 'sunoAbrir', 'sunoFechar', 'sunoApi', 'sunoPreencher', 'sunoPedido', 'sunoEsquecerPedido', 'sunoGuardarSozinho', 'sunoNovas', 'sunoPuxarVistas',
  'hardwareLocal', 'hardwareTodos', 'diagnosticoRede',
  'obsConfig', 'salvarObsConfig', 'obsStatus', 'obsAbrir', 'obsCena', 'obsPrincipal', 'obsCanal', 'obsTodos', 'promptConfig', 'salvarPromptConfig', 'gerarPrompt'
])

async function executarLocal(nome: string, args: unknown[]) {
  const fn = acoes[nome]
  if (!fn) throw new Error(`Ação desconhecida: ${nome}`)
  return fn(...args)
}

ipcMain.handle('chamar', async (_e, nome: string, ...args: unknown[]) => {
  if (!rede.repassando || LOCAIS.has(nome)) return executarLocal(nome, args)
  // desconectado: as telas ainda abrem (para você conseguir arrumar a conexão), mas nada roda aqui
  if (!rede.conectado && (nome === 'obterConfig' || nome === 'estado')) return executarLocal(nome, args)
  if (nome === 'logs') {
    const daqui = todosOsLogs()
    const doOutro = await rede.chamar('logs', []).then((l) => marcarRemotos(l as EntradaLog[])).catch(() => [])
    return [...daqui, ...doOutro]
  }
  if (nome === 'limparLogs') {
    limparLogs()
    return rede.chamar('limparLogs', []).catch(() => undefined)
  }
  return rede.chamar(nome, args)
})

// ---------- dois PCs ----------
const rede = new Rede({
  versao: app.getVersion(),
  edicao: EDICAO,
  executar: executarLocal,
  aoMudarStatus: (s) => enviarTela('rede', s),
  aoEvento: (canal, dado) => {
    // a atualização do secundário NÃO pode aparecer como se fosse a deste PC (era o "bug" de só atualizar depois do secundário)
    if (canal === 'atualizacao') return enviarTela('atualizacao-outro', dado)
    if (canal === 'suno-status' || canal === 'suno-pedido') return
    enviarTela(canal, canal === 'logs' ? marcarRemotos(dado as EntradaLog[]) : dado)
    if (canal === 'ia-trabalho') guardarResultado(dado as TrabalhoIA, (n, a) => rede.chamar(n, a))
  },
  log: (nivel, texto) => {
    const f = { info: logInfo, ok: logOk, aviso: logAviso, erro: logErro }[nivel]
    f('Rede', texto)
  }
})

Object.assign(acoes, {
  // uso do computador ao vivo: deste PC e, se estiver ligado, do outro
  hardwareLocal: () => lerHardware(),
  hardwareTodos: async () => {
    const este = await lerHardware()
    let outro = null
    if (rede.conectado) outro = await rede.chamar('hardwareLocal', [], 5000).catch(() => null)
    return { este, outro, papel: rede.status.papel }
  },

  // galeria (fica neste PC)
  galeria: () => galeria.listarGaleria(),
  lerDaGaleria: (arquivo: string) => galeria.lerDaGaleria(arquivo),
  apagarDaGaleria: (arquivo: string) => galeria.apagarDaGaleria(arquivo),
  abrirPastaGaleria: () => galeria.abrirPastaGaleria(),
  mostrarNaPasta: (arquivo: string) => galeria.mostrarNaPasta(arquivo),

  edicao: () => EDICAO,
  rede: () => rede.status,
  salvarRede: (parcial: Partial<ConfigRede>) => {
    store.rede = { ...store.rede, ...parcial }
    rede.aplicar(store.rede)
    return rede.status
  },
  procurarPcs: () => procurarNaRede(),
  novoCodigo: () => {
    const c = rede.novoCodigo()
    store.rede = { ...store.rede, meuCodigo: c }
    logInfo('Rede', 'Novo código de pareamento gerado. O PC principal precisa digitar o novo código.')
    return rede.status
  }
})

// a galeria usa um endereço próprio (galeria://) para mostrar imagens e vídeos salvos
galeria.prepararProtocolo()

// erros inesperados vão para a aba Logs em vez de passarem em silêncio
process.on('uncaughtException', (e) => logErro('Programa', `Erro inesperado: ${e?.message ?? e}`))
process.on('unhandledRejection', (e: any) => logErro('Programa', `Erro inesperado: ${e?.message ?? e}`))

app.setName('Gerenciador de Perfis GPT') // userData exclusivo do aplicativo GPT

app.whenReady().then(() => {
  iniciarLog((novas) => enviar('logs', novas))
  // aba Lives: o OBS roda neste PC (o principal)
  Object.assign(acoes, acoesObs(enviarTela))
  carregar()
  // Em reinício, pendências do diário exigem conferência, nunca reexecução automática.
  store.reconhecerOperacoes()
  galeria.ativarProtocolo()
  // IA (ComfyUI): só existe na edição Completa; na Padrão esse código nem entra no programa
  if (__EDICAO__ === 'completa') {
    import('./ia').then((ia) => ia.registrarIA(acoes, enviar))
    // gerador de prompt: o Claude roda aqui; o grátis roda no PC que tem o ComfyUI (o secundário)
    import('./ia/prompt').then((pr) =>
      Object.assign(acoes, {
        promptConfig: () => pr.lerConfigPrompt(),
        salvarPromptConfig: (c: any) => pr.salvarConfigPrompt(c),
        gerarPrompt: async (p: any) => {
          if (pr.lerConfigPrompt().motor === 'claude') return pr.gerarComClaude(p)
          if (rede.status.papel === 'principal' && rede.conectado) return rede.chamar('iaPromptLocal', [p], 5 * 60_000)
          return acoes.iaPromptLocal(p)
        }
      })
    )
    // Suno (aba Música): roda sempre neste PC, no Chrome, com o seu login
    Object.assign(acoes, acoesSuno(enviarTela))
  }
  logInfo('Programa', `Gerenciador de Perfis GPT v${app.getVersion()} (edição ${EDICAO === 'completa' ? 'Completa' : 'Padrão'}) iniciado.`)
  if (!store.rede.meuCodigo) store.rede = { ...store.rede, meuCodigo: novoCodigo() }
  rede.aplicar(store.rede)
  motor.on('estado', (e) => {
    enviar('estado', e)
    // IA x navegadores: com navegadores abertos neste PC, a IA desliga sozinha (se a opção estiver ligada)
    if (__EDICAO__ === 'completa' && store.ia.autoDesligar !== false) {
      const abertos = e.navegadores.length + (e.fila ?? 0) > 0
      import('./ia').then((ia) => (abertos ? ia.desligarIA('navegadores') : ia.ligarIA('navegadores'))).catch(() => undefined)
    }
  })
  criarJanela()
  iniciarAtualizacoes(
    (i) => enviar('atualizacao', i),
    async () => {
      // atualização: fecha os navegadores, salva e deixa o instalador fechar o app (sem apagar perfis)
      saindo = true
      salvarAgora()
      await motor.encerrarTodos().catch(() => undefined)
    }
  )
})

// Ao sair: fecha os navegadores e, se escolhido, apaga os perfis (só os da etiqueta definida).
async function apagarPerfisAoSair() {
  const etiqueta = store.config.etiquetaApagarAoSair.trim()
  const perfis = await dolphin.listarPerfis()
  const alvo = perfis.filter((p) => !etiqueta || p.etiquetas.includes(etiqueta))
  for (const p of alvo) await dolphin.apagarPerfil(p.id).catch(() => undefined)
}

let saindo = false
app.on('before-quit', async (e) => {
  salvarAgora()
  const cfg = store.config
  if (saindo || (!cfg.fecharTodosAoSair && !cfg.apagarAoSair)) return
  e.preventDefault()
  saindo = true
  await motor.encerrarTodos().catch(() => undefined)
  if (cfg.apagarAoSair) await apagarPerfisAoSair().catch(() => undefined)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
