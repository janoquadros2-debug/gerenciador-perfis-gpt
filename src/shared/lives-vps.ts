export interface LiveVpsEntrada {
  vps: string
  painel: string
  live: string
  canal: string
}

export interface LiveVps extends LiveVpsEntrada {
  id: string
}

export function normalizarLiveVps(entrada: LiveVpsEntrada): LiveVpsEntrada {
  const vps = entrada.vps.trim()
  const live = entrada.live.trim()
  if (!vps || !live) throw new Error('Informe o nome da VPS e da live no painel.')

  let painel: URL
  let canal: URL
  try {
    painel = new URL(entrada.painel.trim())
  } catch {
    throw new Error('Informe a URL completa do painel da VPS.')
  }
  if (!['http:', 'https:'].includes(painel.protocol) || painel.username || painel.password || painel.search || painel.hash)
    throw new Error('Use o endereço HTTP ou HTTPS do painel, sem credenciais ou parâmetros.')

  const erroCanal = 'Informe um link público de canal, como https://www.twitch.tv/seucanal.'
  try {
    canal = new URL(entrada.canal.trim())
  } catch {
    throw new Error(erroCanal)
  }
  const login = /^\/([a-z0-9_]{1,25})\/?$/i.exec(canal.pathname)?.[1]
  if (!login || !['http:', 'https:'].includes(canal.protocol) || !['twitch.tv', 'www.twitch.tv'].includes(canal.hostname) ||
      canal.username || canal.password || canal.port || ['directory', 'downloads', 'drops', 'login', 'settings', 'signup', 'videos'].includes(login.toLowerCase()))
    throw new Error(erroCanal)

  return { vps, live, painel: painel.href, canal: 'https://www.twitch.tv/' + login.toLowerCase() }
}

export interface EstadoLiveVps {
  id: string
  ligada: boolean
  destinos: { plataforma: string; estado: string }[]
}

export interface ItemAgendaVps {
  liveId: string
  fila: 1 | 2
  minutos: number
}

export interface AgendaVpsEntrada {
  itens: ItemAgendaVps[]
  senhas: Record<string, string>
  twitchClientId: string
  twitchSegredo: string
  iniciarEm?: number
  whatsapp?: WhatsAppAgendaVps
}

export interface EstadoAgendaVps {
  executando: boolean
  iniciarEm?: number
  filas: {
    fila: 1 | 2
    etapa: 'aguardando' | 'iniciando' | 'ao-vivo' | 'encerrando' | 'concluida' | 'cancelada' | 'falha'
    live?: string
    terminaEm?: number
    detalhe?: string
  }[]
  eventos: { hora: number; fila: 1 | 2; texto: string }[]
}

export interface PreferenciasAgendaVps {
  itens: ItemAgendaVps[]
  twitchClientId: string
}

export interface WhatsAppAgendaVps {
  telefoneId: string
  destinatario: string
  token: string
  modelo: string
  idioma: string
}
