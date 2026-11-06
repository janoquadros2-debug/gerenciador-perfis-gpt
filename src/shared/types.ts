// Tipos compartilhados entre o "motor" (main) e a interface (renderer).

export type TipoProxy = 'http' | 'https' | 'socks5'

export interface Proxy {
  id: string
  tipo: TipoProxy
  host: string
  porta: number
  usuario?: string
  senha?: string
  usos: number // contador de uso
  ultimoTeste?: ResultadoTesteProxy
  historicoTestes?: ResultadoTesteProxy[] // histórico opcional, limitado a 20 resultados
  primeiroUsoEm?: number // referência informativa, não expira nem troca proxies automaticamente
}

export interface ResultadoTesteProxy {
  ok: boolean
  ip?: string
  pais?: string
  cidade?: string
  ms?: number
  erro?: string
  quando: number
  categoria?: 'ok' | 'autenticacao' | 'dns' | 'tempo' | 'conexao' | 'http' | 'resposta'
  httpStatus?: number
  metodo?: 'direto' | 'navegador' // navegador confirma conexão, não valida credenciais do proxy
}

export type ModoDistribuicao = 'sequencia' | 'sorteado' | 'sem-repetir' | 'sorteado-sem-repetir'

export interface Perfil {
  id: number // id do perfil no Dolphin Anty
  nome: string
  etiquetas: string[]
  plataforma: string // windows / macos / linux
  proxyTexto?: string // proxy salvo no Dolphin, só para mostrar
  site?: string // site próprio (opcional)
  site2?: string // 2ª aba (opcional)
}

export type StatusNavegador = 'abrindo' | 'ok' | 'erro' | 'fechado'
export type EstadoReproducao = 'analisando' | 'reproduzindo' | 'pausado' | 'carregando' | 'encerrado' | 'sem-video' | 'inconclusivo' | 'erro'

export interface HistoricoPerfil {
  quando: number
  categoria: 'abertura' | 'site' | 'video' | 'cookies' | 'proxy' | 'temporizador' | 'erro'
  texto: string
}

export interface Navegador {
  slot: number // número do navegador (#1, #2, ...)
  perfilId: number
  perfilNome: string
  sistema: string
  status: StatusNavegador
  ip?: string
  pais?: string
  proxy?: string
  erro?: string
  quedas: number
  abertoEm: number
  fechaEm?: number // quando o tempo aberto acaba (se houver limite)
  proximoF5?: number // quando a página vai ser recarregada sozinha (se ligado)
  fechando?: boolean // o tempo acabou e ele está fechando agora
  reabreAoAcabar?: boolean // quando o tempo acabar, fecha e abre de novo
  url?: string // endereço que o navegador está acessando agora
  siteOk?: boolean // última verificação: o site está carregado?
  verificadoEm?: number // quando foi a última verificação
  erroDoSite?: boolean // o erro atual veio da verificação do site (some sozinho se o site voltar)
  miniatura?: string // imagem jpeg em base64
  reproducao?: EstadoReproducao // diagnóstico passivo, nunca inicia o vídeo
  reproducaoEm?: number // instante da última medição
  reproducaoDetalhe?: string
  avisoCookies?: boolean
  anuncioProvavel?: boolean // indicador visual de anúncio: estimativa, não confirmação
  recuperacao?: 'analisando' | 'tentando' | 'intervencao' | 'normal'
  tentativasRecuperacao?: number
  proximaRecuperacaoEm?: number
  diagnosticoProxy?:  ResultadoTesteProxy
  historico?: HistoricoPerfil[]
  erroCategoria?: 'dolphin' | 'proxy' | 'rede' | 'pagina' | 'autenticacao' | 'desconhecido'
  ipRepetido?: boolean
}

export interface ConfigJanelas {
  ativo: boolean
  largura: number
  altura: number
  colunas: number
  linhas: number
  ordem: 'blocos-3x2' | 'linha' | 'coluna'
  espaco: number
  monitores: number[] // ids dos monitores usados, na ordem
  grupoVisivel?: number // grupo de janelas em evidência
}

export interface RecursosExtras {
  apiCursor: boolean
  retryLeituras: boolean
  diarioOperacoes: boolean
  historicoPersistente: boolean
  categorizarFalhas: boolean
  detectarIpsRepetidos: boolean
  historicoTestesProxy: boolean
  validadeProxyInformativa: boolean
  validarAbertura: boolean
}

export interface RegistroOperacao {
  id: string
  tipo: 'abrir' | 'fechar' | 'criar'
  estado: 'pendente' | 'concluida' | 'erro' | 'revisada'
  perfilId?: number
  perfilNome?: string
  slot?: number
  iniciadoEm: number
  atualizadoEm: number
  detalhe?: string
}

export interface Configuracoes {
  recursosExtras?: RecursosExtras
  tokenDolphin: string
  portaLocalDolphin: number
  siteInicial: string
  conferirIp: boolean
  testarProxyAntes: boolean
  reabrirSeCair: boolean
  tentativasReabrir: number
  limitadorRam: boolean
  limiteRam: number // porcentagem
  limparRamAuto: boolean // ao chegar no limite, limpa a RAM sozinho antes de esperar
  usarListaDeProxies: boolean // aplica proxies da lista ao abrir
  modoDistribuicao: ModoDistribuicao
  tipoProxyPadrao: TipoProxy
  miniaturas: 'rapida' | 'normal' | 'economica' | 'desligadas'
  intervaloVerificacao: number // segundos entre as verificações do site (0 = desligado)
  iniciarComWindows: boolean
  fecharTodosAoSair: boolean
  manterAtivas?: boolean // janelas cobertas continuam rodando como se estivessem na frente
  aberturasSimultaneas?: number // limite de 1 a 4 navegadores em abertura
  intervaloEntreAberturasMs?: number // intervalo entre inícios de abertura (0 a 15000 ms)
  reorganizarAposLote?: boolean // reposiciona janelas ao concluir um grupo
  cookiesPadrao?: 'aceitar' | 'recusar' | 'desligado'
  diagnosticoReproducao?: boolean
  recuperarTravamento?: boolean // F5 limitado após travamento confirmado, sem interagir com anúncios
  apagarAoSair: boolean // apaga perfis do Dolphin ao fechar o programa
  etiquetaApagarAoSair: string // só apaga os perfis com esta etiqueta ('' = todos)
  janelas: ConfigJanelas
  repoAtualizacao: string // "usuario/repositorio" no GitHub
}

export interface Sugestao {
  id: string
  texto: string
  quando: number
}

export interface EstadoMotor {
  pausado: boolean
  navegadores: Navegador[]
  fila: number // quantos ainda esperam para abrir
  ram: { usada: number; total: number; porcentagem: number }
  avisos: string[]
  proxiesEsgotados: boolean
  capacidadePorGrupo?: number
  totalGrupos?: number
  grupoVisivel?: number
}

export interface Monitor {
  id: number
  nome: string
  x: number
  y: number
  largura: number
  altura: number
  principal: boolean
}

export interface InfoAtualizacao {
  versaoAtual: string
  status: 'nao-configurado' | 'verificando' | 'em-dia' | 'disponivel' | 'baixando' | 'pronta' | 'erro'
  novaVersao?: string
  notas?: string
  progresso?: number
  erro?: string
}

export interface OpcoesCriacaoMassa {
  quantidade: number
  nomeBase: string
  comecarDe: number
  modoProxy: 'nenhum' | 'mesmo' | 'lista'
  proxyUnico?: string
  listaProxies?: string
  tipoProxy: TipoProxy
  etiqueta: string
  sistema: 'windows' | 'macos' | 'linux' | 'sorteado'
  porcentagens?: { windows: number; macos: number; linux: number } // usado quando sistema = 'sorteado'
  site?: string
  cookies?: 'aceitar' | 'recusar' | 'desligado' // aviso de cookies: clica sozinho
  site2?: string // abre também uma 2ª aba com este link (vazio = só o site principal)
  abrirAoCriar?: boolean // já abre cada perfil assim que ele é criado
  tempoAberto?: TempoAberto // vale para esta criação e para o "+1 / Adicionar"
  aoAcabar?: 'fechar' | 'reabrir' // quando o tempo aberto acabar: só fecha, ou fecha e abre de novo (com tempo novo)
  recarregar?: TempoAberto // F5 sozinho: 'sem-limite' = desligado; fixo ou aleatório (ex.: de 3 a 5 min)
  privacidade?: 'anonimo' | 'padrao' // anonimo = cada perfil com impressão digital única (ruído, hardware, tela, MAC…)
}

export interface TempoAberto {
  modo: 'sem-limite' | 'fixo' | 'aleatorio'
  minutos: number // tempo fixo
  de: number // aleatório: mínimo em minutos
  ate: number // aleatório: máximo em minutos
}

export interface ProgressoCriacao {
  feitos: number
  total: number
  erros: string[]
  pulados?: number // nomes que já existiam
  terminou: boolean
}

export type NivelLog = 'info' | 'ok' | 'aviso' | 'erro'

export interface EntradaLog {
  id: number
  quando: number
  nivel: NivelLog
  origem: string // ex.: "Navegador #3", "Proxies", "Criação"
  texto: string
  repeticoes?: number
}

// ---------- dois PCs ----------
export type PapelPc = 'unico' | 'principal' | 'secundario'

export interface ConfigRede {
  papel: PapelPc
  endereco: string // principal: IP do PC secundário
  codigo: string // principal: código de pareamento digitado
  meuCodigo: string // secundário: código que o principal precisa digitar
}

export interface StatusRede {
  edicao: 'completa' | 'padrao'
  papel: PapelPc
  conectado: boolean // principal: ligado ao secundário · secundário: algum principal ligado
  conectando: boolean
  nomeOutroPc?: string
  versaoOutroPc?: string
  endereco?: string
  meusIps: string[]
  meuNome: string
  meuCodigo?: string
  erro?: string
}

export interface PcEncontrado {
  nome: string
  endereco: string
  versao: string
}

// ---------- IA (ComfyUI) · edição Completa ----------
export interface LocalCampo {
  no: string
  campo: string
  rotulo?: string // nome do nó (ex.: "Seu rosto") para mostrar na tela
}

export interface CamposFluxo {
  prompt: LocalCampo[]
  negativo: LocalCampo[]
  semente: LocalCampo[]
  largura: LocalCampo[]
  altura: LocalCampo[]
  quantidade: LocalCampo[]
  imagem: LocalCampo[] // imagem de entrada (para animar)
  quadros: LocalCampo[] // duração do vídeo em quadros
  segundos: LocalCampo[] // duração do vídeo em segundos (alguns fluxos, como o LTX)
  fps: LocalCampo[]
}

export interface FluxoIA {
  id: string
  nome: string
  tipo: 'imagem' | 'video'
  grafo: Record<string, any>
  campos: CamposFluxo
  embutido?: boolean
  descricao?: string // o que esse fluxo faz (nos que já vêm prontos)
}

export type ResumoFluxo = Omit<FluxoIA, 'grafo'> & {
  padroes: { largura?: number; altura?: number; quadros?: number; segundos?: number; fps?: number }
  descricao?: string
}

export interface OpcoesGerar {
  fluxoId: string
  prompt: string
  negativo?: string
  modelo?: string // só no fluxo básico
  largura?: number
  altura?: number
  quantidade?: number
  semente?: number
  passos?: number
  cfg?: number
  quadros?: number
  segundos?: number
  fps?: number
  imagens?: { nome: string; base64: string }[] // imagens de entrada, na ordem dos nós "Load Image"
}

export interface TrabalhoIA {
  id: string
  tipo: 'imagem' | 'video'
  fluxoNome: string
  prompt: string
  status: 'na-fila' | 'gerando' | 'pronto' | 'erro' | 'cancelado'
  etapa?: string
  porcentagem?: number
  erro?: string
  criadoEm: number
  terminouEm?: number
  arquivos?: { nome: string; midia: 'imagem' | 'video' }[]
}

export interface StatusIA {
  conectado: boolean
  endereco?: string
  versao?: string
  placa?: string
  vramTotalGb?: number
  vramLivreGb?: number
  erro?: string
  desligada?: 'manual' | 'navegadores' // IA desligada para não pesar o PC enquanto os navegadores rodam
  autoDesligar?: boolean // desliga sozinha quando houver navegadores abertos
}

export interface ModeloIA {
  arquivo: string
  pasta: string
  familia: string
  uso: string
  categoria: 'imagem' | 'video' | 'apoio'
}

export interface ItemGaleria {
  arquivo: string
  midia: 'imagem' | 'video' | 'audio'
  capa?: string // capa da música (Suno)
  url: string // galeria://arquivo
  quando: number
  prompt?: string
  fluxo?: string
}

// Uso do computador ao vivo (aba Ao vivo, Criar imagens e Animar)
export interface UsoHardware {
  nome: string
  cpu: { nome?: string; porcentagem: number; temperatura?: number }
  ram: { usadaGb: number; totalGb: number; porcentagem: number }
  gpu?: { nome: string; porcentagem?: number; vramUsadaGb?: number; vramTotalGb?: number; temperatura?: number }
  quando: number
}

// Gerador de prompt (português → inglês)
export interface ConfigPrompt {
  motor: 'local' | 'claude'
  claudeChave: string
  claudeModelo: string // ex.: claude-haiku-5-5 ou claude-sonnet-5-5
}
export interface PedidoPrompt {
  tipo: 'imagem' | 'editar' | 'video' | 'musica'
  texto: string // o que você quer, em português
  atual?: string // prompt que já está escrito (para melhorar)
}
export interface ResultadoPrompt {
  prompt: string // para música: o estilo
  titulo?: string
  estilo?: string
  letra?: string
  motor?: string
}

// Aba Lives (OBS + plugin multi-rtmp)
export interface ConfigObs {
  endereco: string
  porta: number
  senha: string
  alertas: boolean // aviso na tela quando uma live cai
}
export interface CanalObs {
  id: string
  nome: string
  ligado: boolean // "ativado" no plugin
  noAr: boolean
  conectando: boolean
  tentativaEm?: number
  reconexoes: number
  erro?: number
  kbps: number
  fps: number
  perdidos: number
  total: number
  congestionamento: number
  tempoNoAr: number
}
export interface StatusObs {
  conectado: boolean
  erro?: string
  versaoObs?: string
  pluginPronto?: boolean
  principal?: { noAr: boolean; reconectando: boolean; tempo?: string; perdidos: number; total: number }
  cpu?: number
  fps?: number
  quadrosPerdidosRender?: number
  cenaAtual?: string
  cenas: string[]
  canais: CanalObs[]
}
