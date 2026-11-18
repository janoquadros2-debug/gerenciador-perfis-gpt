import type { EstadoLiveVps } from '../shared/lives-vps'

type Objeto = Record<string, unknown>
function objeto(v: unknown): v is Objeto {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export async function consultarLiveVps(painel: string, nome: string, senha: string): Promise<EstadoLiveVps> {
  if (typeof senha !== 'string' || !senha.trim()) throw new Error('Digite a senha do painel.')
  const url = new URL(painel)
  const requisitar = async (rota: string, init: RequestInit) => {
    try {
      return await fetch(new URL(rota, url.origin), {
        ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000)
      })
    } catch {
      throw new Error('O painel da VPS não respondeu. Confira o endereço e a conexão.')
    }
  }

  const login = await requisitar('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha })
  })
  if (login.status === 401 || login.status === 403) throw new Error('O painel recusou a senha.')
  if (login.status !== 200) throw new Error(`O login do painel retornou HTTP ${login.status}.`)
  const sid = /(?:^|,\s*)sid=([a-f0-9]+)(?=;|,|$)/i.exec(login.headers.get('set-cookie') ?? '')?.[1]
  if (!sid) throw new Error('O painel não retornou uma sessão válida.')

  const resposta = await requisitar('/api/estado', { headers: { Cookie: 'sid=' + sid } })
  if (!resposta.ok) throw new Error(`A consulta de estado retornou HTTP ${resposta.status}.`)
  const corpo: unknown = await resposta.json().catch(() => null)
  if (!objeto(corpo) || !Array.isArray(corpo.lives)) throw new Error('O painel retornou uma lista de lives inválida.')
  const candidatas = corpo.lives.filter((live) => objeto(live) && live.nome === nome)
  if (!candidatas.length) throw new Error('A live cadastrada não foi encontrada no painel. Confira o nome.')
  if (candidatas.length > 1) throw new Error('Há mais de uma live com esse nome no painel.')
  const live: Objeto = candidatas[0]
  if (typeof live.id !== 'string' || !live.id || typeof live.ligada !== 'boolean' || !Array.isArray(live.destinos))
    throw new Error('O painel não informou o estado da live no formato esperado.')

  const destinos = live.destinos
    .filter((d): d is Objeto => objeto(d) && d.ativo === true && d.temChave === true)
    .flatMap((d) => typeof d.estado === 'string'
      ? [{ plataforma: typeof d.plataforma === 'string' ? d.plataforma : 'Destino', estado: d.estado }]
      : [])
  return { id: live.id, ligada: live.ligada, destinos }
}
