import { useEffect, useState, type FormEvent } from 'react'
import { agruparLivesVps, type EstadoLiveVps, type LiveVps, type LiveVpsEntrada } from '../../../shared/lives-vps'
import { chamar } from '../api'
import { confirmar } from '../confirmar'
import { AgendaLivesVps } from './AgendaLivesVps'

const vazio: LiveVpsEntrada = { vps: '', painel: '', live: '', canal: '' }
const campos: { chave: keyof LiveVpsEntrada; rotulo: string; exemplo: string }[] = [
  { chave: 'vps', rotulo: 'Nome da VPS', exemplo: 'VPS 1' },
  { chave: 'painel', rotulo: 'URL do painel', exemplo: 'https://painel.exemplo.com/' },
  { chave: 'live', rotulo: 'Nome da live no painel', exemplo: 'NightTrainWindow' },
  { chave: 'canal', rotulo: 'Canal da Twitch', exemplo: 'https://www.twitch.tv/seucanal' }
]
const mensagem = (erro: unknown) =>
  String(erro instanceof Error ? erro.message : erro).replace(/^Error invoking remote method 'chamar': (?:Error: )?/, '')

export function LivesVps() {
  const [lista, setLista] = useState<LiveVps[] | null>(null)
  const grupos = agruparLivesVps(lista ?? [])
  const [form, setForm] = useState(vazio)
  const [editando, setEditando] = useState<string>()
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const [testando, setTestando] = useState<string>()
  const [guardadas, setGuardadas] = useState<string[]>([])
  const [lembrar, setLembrar] = useState(false)
  const [senha, setSenha] = useState('')
  const [resultado, setResultado] = useState<EstadoLiveVps>()

  useEffect(() => {
    let ativa = true
    chamar<string[]>('listarCredenciaisVps')
      .then((v) => { if (ativa) setGuardadas(v) })
      .catch((e) => { if (ativa) setAviso(mensagem(e)) })
    chamar<LiveVps[]>('listarLivesVps')
      .then((v) => { if (ativa) setLista(v) })
      .catch((e) => { if (ativa) setAviso(mensagem(e)) })
    return () => { ativa = false }
  }, [])

  const abrirTeste = (id?: string) => {
    setTestando(id)
    setLembrar(false)
    setSenha('')
    setResultado(undefined)
    setAviso('')
  }
  const testar = async (e: FormEvent<HTMLFormElement>, item: LiveVps) => {
    e.preventDefault()
    const origem = new URL(item.painel).origin
    if (ocupado || (!senha.trim() && !guardadas.includes(origem))) return
    setOcupado(true)
    setAviso('')
    setResultado(undefined)
    try {
      setResultado(await chamar<EstadoLiveVps>('testarLiveVps', item.id, senha, lembrar))
      if (senha.trim() && lembrar) {
        setGuardadas((anteriores) => [...new Set([...anteriores, origem])])
        setAviso('Credencial guardada neste computador.')
      }
    } catch (erro) {
      setAviso(mensagem(erro))
    } finally {
      setSenha('')
      setLembrar(false)
      setOcupado(false)
    }
  }

  const esquecer = async (item: LiveVps) => {
    if (ocupado) return
    setOcupado(true)
    setAviso('')
    try {
      await chamar('esquecerCredencialVps', item.id)
      const origem = new URL(item.painel).origin
      setGuardadas((anteriores) => anteriores.filter((v) => v !== origem))
      setAviso('Credencial removida deste computador.')
    } catch (erro) {
      setAviso(mensagem(erro))
    } finally {
      setOcupado(false)
    }
  }

  const editar = (item?: LiveVps) => {
    abrirTeste()
    setEditando(item?.id)
    setForm(item ?? vazio)
  }
  const salvar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!lista || ocupado) return
    setOcupado(true)
    setAviso('')
    try {
      setLista(await chamar<LiveVps[]>('salvarLiveVps', form, editando))
      editar()
      setAviso('Vínculo salvo.')
    } catch (erro) {
      setAviso(mensagem(erro))
    } finally {
      setOcupado(false)
    }
  }
  const remover = async (item: LiveVps) => {
    if (!(await confirmar(`Remover o vínculo de ${item.live}?`))) return
    setOcupado(true)
    setAviso('')
    try {
      setLista(await chamar<LiveVps[]>('removerLiveVps', item.id))
      if (editando === item.id) editar()
      else if (testando === item.id) abrirTeste()
      setAviso('Vínculo removido.')
    } catch (erro) {
      setAviso(mensagem(erro))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
    <section className="painel">
      <h2>Lives das VPS</h2>
      <p className="dica">Vincule cada live cadastrada no seu painel ao canal público da Twitch.</p>
      <form onSubmit={salvar} style={{ display: 'grid', gap: 12 }}>
        <div className="grade-campos">
          {campos.map(({ chave, rotulo, exemplo }) => (
            <label key={chave} className="campo">
              {rotulo}
              <input required placeholder={exemplo} disabled={ocupado} value={form[chave]}
                onChange={(e) => setForm({ ...form, [chave]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="linha">
          <button type="submit" className="btn primario" disabled={!lista || ocupado}>{editando ? 'Salvar alteração' : 'Vincular live'}</button>
          {editando && <button type="button" className="btn" disabled={ocupado} onClick={() => editar()}>Cancelar</button>}
        </div>
      </form>
      {aviso && <div role="status" className="aviso">{aviso}</div>}
      {lista?.length === 0 && <span className="dica">Nenhuma live de VPS cadastrada.</span>}
      {grupos.map((grupo) => {
        const guardada = guardadas.includes(grupo.origem)
        return (
          <details key={grupo.origem} className="painel" style={{ padding: '12px 16px' }}>
            <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
              <strong>{grupo.nome}</strong> · {grupo.lives.length} {grupo.lives.length === 1 ? 'live' : 'lives'}
              <span className="dica"> · {grupo.origem}{guardada && ' · Credencial guardada'}</span>
            </summary>
            <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
              {guardada && <div>
                <button type="button" className="btn pequeno" disabled={ocupado}
                  onClick={() => esquecer(grupo.lives[0])}>Esquecer credencial do painel</button>
              </div>}
              {grupo.lives.map((item) => (
                <article key={item.id} style={{ display: 'grid', gap: 8, overflowWrap: 'anywhere' }}>
                  <div className="linha" style={{ flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <strong>{item.live}</strong>
                    <div className="dica">{item.canal}</div>
                  </div>
                  <button className="btn pequeno" disabled={ocupado} onClick={() => abrirTeste(item.id)}>Testar conexão</button>
                  <button className="btn pequeno" disabled={ocupado} onClick={() => editar(item)}>Editar</button>
                  <button className="btn pequeno perigo" disabled={ocupado} onClick={() => remover(item)}>Remover vínculo</button>
                  </div>
                  {testando === item.id && (
                    <form className="linha" style={{ flexWrap: 'wrap', alignItems: 'end' }} onSubmit={(e) => testar(e, item)}>
                      <label className="campo">Senha ou token do painel
                        <input type="password" autoComplete="off" placeholder={guardada ? 'Credencial guardada neste PC' : undefined} value={senha} disabled={ocupado} onChange={(e) => setSenha(e.target.value)} />
                      </label>
                      {senha.trim() && <label className="linha">
                        <input type="checkbox" checked={lembrar} disabled={ocupado} onChange={(e) => setLembrar(e.target.checked)} />
                        Guardar neste computador
                      </label>}
                      <button type="submit" className="btn primario" disabled={ocupado || (!guardada && !senha.trim())}>Consultar estado</button>
                      <button type="button" className="btn" disabled={ocupado} onClick={() => abrirTeste()}>Fechar teste</button>
                      {resultado && <span className="dica" role="status">
                        ID no painel: {resultado.id} · {resultado.ligada ? 'Ligada' : 'Parada'}
                        {resultado.destinos.map((d) => ` · ${d.plataforma}: ${d.estado}`).join('')}
                      </span>}
                    </form>
                  )}
                </article>

              ))}
            </div>
          </details>
        )
      })}
    </section>
    <AgendaLivesVps catalogo={lista ?? []} grupos={grupos} credenciaisGuardadas={guardadas} />
    </>
  )
}
