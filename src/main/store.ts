// Guarda as configurações, proxies e sugestões num arquivo JSON na pasta do usuário.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ConfigRede, Configuracoes, FluxoIA, OpcoesCriacaoMassa, Proxy, Sugestao } from '../shared/types'

interface Dados {
  config: Configuracoes
  proxies: Proxy[]
  sugestoes: Sugestao[]
  sitesPorPerfil: Record<number, string>
  sitesExtras?: Record<number, string> // 2ª aba de cada perfil
  ponteiroSequencia: number
  proxiesUsadosNaRodada: string[]
  modeloAdicionar: OpcoesCriacaoMassa // como os perfis do "+1 / Adicionar" são criados (última criação em massa)
  rede: ConfigRede // papel deste PC (único, principal ou secundário)
  ia: { endereco: string; fluxos: FluxoIA[]; autoDesligar?: boolean } // ComfyUI deste PC e os fluxos importados
}

export const REDE_PADRAO: ConfigRede = { papel: 'unico', endereco: '', codigo: '', meuCodigo: '' }

export const MODELO_PADRAO: OpcoesCriacaoMassa = {
  quantidade: 1,
  nomeBase: 'Teste',
  comecarDe: 1,
  modoProxy: 'lista',
  tipoProxy: 'http',
  etiqueta: 'Testes',
  sistema: 'windows'
}

export const CONFIG_PADRAO: Configuracoes = {
  tokenDolphin: '',
  portaLocalDolphin: 3001,
  siteInicial: 'https://www.google.com',
  conferirIp: true,
  testarProxyAntes: false,
  reabrirSeCair: true,
  tentativasReabrir: 3,
  limitadorRam: true,
  limiteRam: 90,
  limparRamAuto: true,
  usarListaDeProxies: false,
  modoDistribuicao: 'sequencia',
  tipoProxyPadrao: 'http',
  miniaturas: 'normal',
  intervaloVerificacao: 10,
  iniciarComWindows: false,
  fecharTodosAoSair: true,
  manterAtivas: true,
  aberturasSimultaneas: 2,
  intervaloEntreAberturasMs: 1500,
  reorganizarAposLote: true,
  cookiesPadrao: 'recusar',
  diagnosticoReproducao: true,
  apagarAoSair: false,
  etiquetaApagarAoSair: 'Testes',
  janelas: {
    ativo: true,
    largura: 320,
    altura: 520,
    colunas: 6,
    linhas: 2,
    ordem: 'blocos-3x2',
    espaco: 0,
    monitores: []
  },
  repoAtualizacao: 'janoquadros2-debug/gerenciador-perfis-gpt'
}

const arquivo = () => path.join(app.getPath('userData'), 'dados.json')

let dados: Dados = {
  config: CONFIG_PADRAO,
  proxies: [],
  sugestoes: [],
  sitesPorPerfil: {},
  ponteiroSequencia: 0,
  proxiesUsadosNaRodada: [],
  modeloAdicionar: MODELO_PADRAO,
  rede: REDE_PADRAO,
  ia: { endereco: '', fluxos: [] }
}

export function carregar(): void {
  try {
    let lido: Dados
    try {
      lido = JSON.parse(fs.readFileSync(arquivo(), 'utf8'))
    } catch {
      // Recupera um backup somente quando o arquivo principal não é válido.
      lido = JSON.parse(fs.readFileSync(arquivo() + '.bak', 'utf8'))
    }
    dados = {
      ...dados,
      ...lido,
      config: { ...CONFIG_PADRAO, ...lido.config, janelas: { ...CONFIG_PADRAO.janelas, ...(lido.config?.janelas ?? {}) } }
    }
    if (!dados.config.repoAtualizacao) dados.config.repoAtualizacao = CONFIG_PADRAO.repoAtualizacao
  } catch {
    // primeira vez: usa os padrões
  }
}

let timer: NodeJS.Timeout | undefined
export function salvarAgora(): void {
  clearTimeout(timer)
  const destino = arquivo()
  const temporario = destino + '.tmp'
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const conteudo = JSON.stringify(dados, null, 2)
  // Nunca truncar o JSON principal durante uma queda de energia ou encerramento abrupto.
  fs.writeFileSync(temporario, conteudo, 'utf8')
  // Mantém uma cópia recuperável da versão anterior.
  if (fs.existsSync(destino)) fs.copyFileSync(destino, destino + '.bak')
  try {
    fs.renameSync(temporario, destino)
  } catch {
    // No Windows, alguns antivírus bloqueiam momentaneamente o rename de substituição.
    // Preservar o original e falhar é mais seguro do que escrever por cima.
    throw new Error('Não foi possível salvar as configurações com segurança. O arquivo original foi preservado.')
  }
}
export function salvar(): void {
  clearTimeout(timer)
  timer = setTimeout(salvarAgora, 200)
}

export const store = {
  get config() {
    return dados.config
  },
  setConfig(parcial: Partial<Configuracoes>) {
    dados.config = { ...dados.config, ...parcial }
    salvar()
    return dados.config
  },
  get proxies() {
    return dados.proxies
  },
  setProxies(lista: Proxy[]) {
    dados.proxies = lista
    salvar()
  },
  get sugestoes() {
    return dados.sugestoes
  },
  setSugestoes(lista: Sugestao[]) {
    dados.sugestoes = lista
    salvar()
  },
  get sitesPorPerfil() {
    return dados.sitesPorPerfil
  },
  get sitesExtras(): Record<number, string> {
    return (dados.sitesExtras ??= {})
  },
  setSite2(perfilId: number, site: string) {
    dados.sitesExtras ??= {}
    if (site) dados.sitesExtras[perfilId] = site
    else delete dados.sitesExtras[perfilId]
    salvar()
  },
  setSite(perfilId: number, site: string) {
    if (site) dados.sitesPorPerfil[perfilId] = site
    else delete dados.sitesPorPerfil[perfilId]
    salvar()
  },
  get ponteiroSequencia() {
    return dados.ponteiroSequencia
  },
  set ponteiroSequencia(v: number) {
    dados.ponteiroSequencia = v
    salvar()
  },
  get usadosNaRodada() {
    return dados.proxiesUsadosNaRodada
  },
  set usadosNaRodada(v: string[]) {
    dados.proxiesUsadosNaRodada = v
    salvar()
  },
  get modeloAdicionar(): OpcoesCriacaoMassa {
    return { ...MODELO_PADRAO, ...(dados.modeloAdicionar ?? {}) }
  },
  set modeloAdicionar(v: OpcoesCriacaoMassa) {
    dados.modeloAdicionar = v
    salvar()
  },
  get rede(): ConfigRede {
    return { ...REDE_PADRAO, ...(dados.rede ?? {}) }
  },
  set rede(v: ConfigRede) {
    dados.rede = v
    salvarAgora()
  },
  get ia() {
    return { endereco: dados.ia?.endereco ?? '', fluxos: dados.ia?.fluxos ?? [], autoDesligar: dados.ia?.autoDesligar }
  },
  set ia(v: { endereco: string; fluxos: FluxoIA[]; autoDesligar?: boolean }) {
    dados.ia = v
    salvar()
  }
}
