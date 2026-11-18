import { useEffect, useState, type FormEvent } from 'react'
import type { EstadoAgendaVps, ItemAgendaVps, LiveVps, PreferenciasAgendaVps, WhatsAppAgendaVps } from '../../../shared/lives-vps'
import { chamar } from '../api'
import { confirmar } from '../confirmar'

const whatsappInicial: WhatsAppAgendaVps = { telefoneId: '', destinatario: '', token: '', modelo: '', idioma: 'pt_BR' }
const camposWhatsApp = [
  ['telefoneId', 'ID do número remetente'],
  ['destinatario', 'Número de destino com DDI'],
  ['token', 'Token da Meta'],
  ['modelo', 'Nome do modelo aprovado'],
  ['idioma', 'Idioma do modelo']
] as const

const etapas = {
  aguardando: 'Aguardando', iniciando: 'Iniciando', 'ao-vivo': 'Ao vivo', encerrando: 'Encerrando',
  concluida: 'Concluída', cancelada: 'Cancelada', falha: 'Falha'
}
const erroTexto = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method 'chamar': (?:Error: )?/, '')

export function AgendaLivesVps({ catalogo }: { catalogo: LiveVps[] }) {
  const [itens, setItens] = useState<(ItemAgendaVps & { ordem: number })[]>([])
  const [proximaOrdem, setProximaOrdem] = useState(1)
  const [selecionada, setSelecionada] = useState('')
  const [senhas, setSenhas] = useState<Record<string, string>>({})
  const [inicio, setInicio] = useState('')
  const [estado, setEstado] = useState<EstadoAgendaVps>()
  const [pendente, setPendente] = useState(false)
  const [usarWhatsApp, setUsarWhatsApp] = useState(false)
  const [whatsapp, setWhatsApp] = useState(whatsappInicial)
  const [aviso, setAviso] = useState('')
  const [erro, setErro] = useState('')
  const ativo = !!estado?.executando
  const travado = ativo || pendente
  const origens = new Map<string, string>()
  for (const item of itens) {
    const live = catalogo.find((c) => c.id === item.liveId)
    if (live) origens.set(new URL(live.painel).origin, live.vps)
  }

  useEffect(() => {
    let ativa = true
    const ler = () => chamar<EstadoAgendaVps>('estadoAgendaVps')
      .then((e) => { if (ativa) setEstado(e) })
      .catch(() => {})
    void ler()
    const id = setInterval(ler, 2000)
    return () => { ativa = false; clearInterval(id) }
  }, [])

  const preferencias = (): PreferenciasAgendaVps => ({
    itens: itens.map(({ liveId, fila, minutos }) => ({ liveId, fila, minutos }))
  })
  const configurar = async (acao: 'salvar' | 'carregar') => {
    setPendente(true)
    setErro('')
    setAviso('')
    try {
      if (acao === 'salvar') {
        await chamar('salvarPreferenciasAgendaVps', preferencias())
        setAviso('Configuração salva.')
      } else {
        const cfg = await chamar<PreferenciasAgendaVps | undefined>('carregarPreferenciasAgendaVps')
        if (!cfg) {
          setAviso('Ainda não há configuração salva.')
          return
        }
        setItens(cfg.itens.map((item, i) => ({ ...item, ordem: i + 1 })))
        setProximaOrdem(cfg.itens.length + 1)
        setAviso('Configuração carregada.')
      }
    } catch (e) {
      setErro(erroTexto(e))
    } finally {
      setPendente(false)
    }
  }

  const iniciar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (travado || !itens.length) return
    setPendente(true)
    setErro('')
    try {
      setEstado(await chamar<EstadoAgendaVps>('iniciarAgendaVps', {
        ...preferencias(), senhas,
        whatsapp: usarWhatsApp ? whatsapp : undefined,
        iniciarEm: inicio ? new Date(inicio).getTime() : undefined
      }))
      setSenhas({})
      setWhatsApp((atual) => ({ ...atual, token: '' }))
    } catch (e) {
      setErro(erroTexto(e))
    } finally {
      setPendente(false)
    }
  }

  const ajustar = (ordem: number, parcial: Partial<ItemAgendaVps>) =>
    setItens((anteriores) => anteriores.map((i) => i.ordem === ordem ? { ...i, ...parcial } : i))

  return (
    <section className="painel">
      <h2>Lives agendadas</h2>
      <p className="dica">Adicione as transmissões na ordem desejada. As duas filas avançam de forma independente. O Gerenciador usa o estado do painel da VPS para confirmar a transmissão. Mantenha-o aberto durante a execução.</p>
      {aviso && <div className="dica" role="status">{aviso}</div>}
      {erro && <div className="aviso" role="alert">{erro}</div>}
      <form onSubmit={iniciar} style={{ display: 'grid', gap: 12 }}>
        <div className="linha" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="campo">Live cadastrada
            <select value={selecionada} disabled={travado} onChange={(e) => setSelecionada(e.target.value)}>
              <option value="">Escolher live</option>
              {catalogo.map((c) => <option key={c.id} value={c.id}>{c.live} · {c.vps}</option>)}
            </select>
          </label>
          <button type="button" className="btn" disabled={travado || !selecionada} onClick={() => {
            setItens([...itens, { liveId: selecionada, fila: 1, minutos: 120, ordem: proximaOrdem }])
            setProximaOrdem(proximaOrdem + 1)
          }}>Adicionar à fila</button>
        </div>
        {itens.map((item) => (
          <div key={item.ordem} className="linha" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
            <strong>{catalogo.find((c) => c.id === item.liveId)?.live ?? 'Vínculo removido'}</strong>
            <label className="campo">Fila
              <select value={item.fila} disabled={travado} onChange={(e) => ajustar(item.ordem, { fila: e.target.value === '2' ? 2 : 1 })}>
                <option value="1">Fila 1</option><option value="2">Fila 2</option>
              </select>
            </label>
            <label className="campo">Duração em minutos
              <input type="number" min={1} max={1440} required value={item.minutos || ''} disabled={travado}
                onChange={(e) => ajustar(item.ordem, { minutos: Number(e.target.value) })} />
            </label>
            <button type="button" className="btn pequeno" disabled={travado} onClick={() => setItens(itens.filter((i) => i.ordem !== item.ordem))}>Remover</button>
          </div>
        ))}
        {itens.length > 0 && <div className="grade-campos">
          <label className="campo">Horário de início (opcional)<input type="datetime-local" value={inicio} disabled={travado} onChange={(e) => setInicio(e.target.value)} /></label>
          {[...origens].map(([origem, nome]) => (
            <label className="campo" key={origem}>Senha do painel · {nome}
              <input type="password" autoComplete="off" required value={senhas[origem] ?? ''} disabled={travado}
                onChange={(e) => setSenhas({ ...senhas, [origem]: e.target.value })} />
            </label>
          ))}
        </div>}
        {itens.length > 0 && <label className="linha">
          <input type="checkbox" checked={usarWhatsApp} disabled={travado} onChange={(e) => setUsarWhatsApp(e.target.checked)} />
          Enviar avisos pelo WhatsApp
        </label>}
        {itens.length > 0 && usarWhatsApp && <>
          <p className="dica">Use um modelo aprovado pela Meta com uma variável no corpo da mensagem.</p>
          <div className="grade-campos">
            {camposWhatsApp.map(([chave, rotulo]) => (
              <label className="campo" key={chave}>{rotulo}
                <input type={chave === 'token' ? 'password' : 'text'} autoComplete="off" disabled={travado} required
                  value={whatsapp[chave]} onChange={(e) => setWhatsApp({ ...whatsapp, [chave]: e.target.value })} />
              </label>
            ))}
          </div>
        </>}
        <div className="linha" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={travado || !itens.length} onClick={() => configurar('salvar')}>Salvar configuração</button>
          <button type="button" className="btn" disabled={travado} onClick={() => configurar('carregar')}>Carregar configuração</button>
          <button className="btn primario" type="submit" disabled={!estado || travado || !itens.length}>{inicio ? 'Agendar filas' : 'Iniciar filas'}</button>
          {ativo && <button className="btn perigo" type="button" onClick={async () => {
            if (!(await confirmar('Encerrar as transmissões iniciadas por esta execução e cancelar as filas?', { perigo: true }))) return
            try { await chamar('cancelarAgendaVps') } catch (e) { setErro(erroTexto(e)) }
          }}>Cancelar filas</button>}
        </div>
      </form>
      {estado?.iniciarEm && <div className="dica">Início agendado para {new Date(estado.iniciarEm).toLocaleString()}.</div>}
      {estado?.filas.map((f) => (
        <div className="aviso" key={f.fila}>
          <strong>Fila {f.fila} · {etapas[f.etapa]}</strong>
          {f.live && <> · {f.live}</>}
          {f.terminaEm && <> · termina às {new Date(f.terminaEm).toLocaleTimeString()}</>}
          <div className="dica">{f.detalhe}</div>
        </div>
      ))}
      {!!estado?.eventos.length && <details>
        <summary>Histórico desta execução</summary>
        <ul>{estado.eventos.map((e, i) => <li key={i}>{new Date(e.hora).toLocaleTimeString()} · Fila {e.fila} · {e.texto}</li>)}</ul>
      </details>}
    </section>
  )
}
