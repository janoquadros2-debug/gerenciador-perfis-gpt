import { useEffect, useState, type FormEvent } from 'react'
import type { LiveVps, LiveVpsEntrada } from '../../../shared/lives-vps'
import { chamar } from '../api'
import { confirmar } from '../confirmar'

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
  const [form, setForm] = useState(vazio)
  const [editando, setEditando] = useState<string>()
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    let ativa = true
    chamar<LiveVps[]>('listarLivesVps')
      .then((v) => { if (ativa) setLista(v) })
      .catch((e) => { if (ativa) setAviso(mensagem(e)) })
    return () => { ativa = false }
  }, [])

  const editar = (item?: LiveVps) => {
    setEditando(item?.id)
    setForm(item ?? vazio)
    setAviso('')
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
      setAviso('Vínculo removido.')
    } catch (erro) {
      setAviso(mensagem(erro))
    } finally {
      setOcupado(false)
    }
  }

  return (
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
      {lista?.map((item) => (
        <article key={item.id} className="linha" style={{ flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <strong>{item.live}</strong>
            <div className="dica">{item.vps} · {item.painel}</div>
            <div className="dica">{item.canal}</div>
          </div>
          <button className="btn pequeno" disabled={ocupado} onClick={() => editar(item)}>Editar</button>
          <button className="btn pequeno perigo" disabled={ocupado} onClick={() => remover(item)}>Remover vínculo</button>
        </article>
      ))}
    </section>
  )
}
