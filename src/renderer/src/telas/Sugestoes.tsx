import { useEffect, useState } from 'react'
import type { Sugestao } from '../../../shared/types'
import { chamar } from '../api'

export function Sugestoes() {
  const [lista, setLista] = useState<Sugestao[]>([])
  const [texto, setTexto] = useState('')
  useEffect(() => {
    chamar<Sugestao[]>('sugestoes').then(setLista)
  }, [])

  const adicionar = async () => {
    if (!texto.trim()) return
    setLista(await chamar('adicionarSugestao', texto.trim()))
    setTexto('')
  }
  const copiarTudo = () => navigator.clipboard.writeText(lista.map((s, i) => `${i + 1}. ${s.texto}`).join('\n'))

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Sugestões</h1>
          <p className="sub">Anote ideias e mudanças. Depois copie tudo e me mande para eu fazer a próxima versão.</p>
        </div>
        <button className="btn" disabled={!lista.length} onClick={copiarTudo}>Copiar todas</button>
      </div>
      <section className="painel">
        <label className="campo">
          Nova sugestão
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 14 }} />
        </label>
        <div className="linha" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primario" onClick={adicionar}>Salvar sugestão</button>
        </div>
      </section>
      <section className="painel" style={{ gap: 0, paddingTop: 6, paddingBottom: 6 }}>
        {lista.map((s) => (
          <div key={s.id} className="opcao">
            <div>
              <div style={{ whiteSpace: 'pre-line' }}>{s.texto}</div>
              <div className="opcao-desc">{new Date(s.quando).toLocaleString('pt-BR')}</div>
            </div>
            <button className="btn pequeno" onClick={async () => setLista(await chamar('apagarSugestao', s.id))}>Apagar</button>
          </div>
        ))}
        {!lista.length && <div className="vazio">Nenhuma sugestão ainda.</div>}
      </section>
    </>
  )
}
