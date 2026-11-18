interface Token {
  access_token?: string
  expires_in?: number
}

export function twitchLives(clientId: string, segredo: string) {
  let token: string | undefined
  let expira = 0
  let renovando: Promise<void> | undefined
  const autenticar = async () => {
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, client_secret: segredo, grant_type: 'client_credentials' }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    })
    if (!r.ok) {
      const erro = await r.json().catch(() => null) as { message?: string } | null
      const detalhe = typeof erro?.message === 'string' ? erro.message.toLowerCase() : ''
      if (/invalid client secret|client secret.*(?:invalid|does not match)/.test(detalhe))
        throw new Error('Client Secret inválido. Use o segredo atual da mesma aplicação do Client ID.')
      if (/invalid client id|client (?:does not|doesn't) exist|client id.*(?:unknown|invalid)/.test(detalhe))
        throw new Error('Client ID inválido. Copie o identificador no Console da Twitch.')
      if (r.status === 400 || r.status === 401)
        throw new Error(`A Twitch recusou o par Client ID e Client Secret (HTTP ${r.status}). Confira a mesma aplicação confidencial.`)
      throw new Error(`A Twitch não autorizou a conexão (HTTP ${r.status}).`)
    }
    const dado = await r.json() as Token
    if (!dado.access_token || !dado.expires_in) throw new Error('A Twitch não devolveu um token válido.')
    token = dado.access_token
    expira = Date.now() + dado.expires_in * 1000
  }
  const garantirToken = async () => {
    if (token && expira > Date.now() + 30_000) return
    renovando ??= autenticar().finally(() => { renovando = undefined })
    await renovando
  }
  const consultar = async (canal: string): Promise<string | null> => {
    const login = new URL(canal).pathname.slice(1)
    const url = new URL('https://api.twitch.tv/helix/streams')
    url.searchParams.set('user_login', login)
    const buscar = async () => {
      await garantirToken()
      return fetch(url, {
        headers: { 'Client-Id': clientId, Authorization: 'Bearer ' + token },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      })
    }
    let r = await buscar()
    if (r.status === 401) {
      expira = 0
      r = await buscar()
    }
    if (!r.ok) throw new Error(`A Twitch não confirmou o estado do canal (HTTP ${r.status}).`)
    const resultado = await r.json() as { data?: { id: string; type: string }[] }
    if (!Array.isArray(resultado.data)) throw new Error('A Twitch retornou um estado inválido.')
    const live = resultado.data[0]
    if (!live) return null
    if (live.type !== 'live' || typeof live.id !== 'string' || !live.id)
      throw new Error('A Twitch não devolveu uma transmissão válida.')
    return live.id
  }
  return { autenticar: garantirToken, consultar }
}
