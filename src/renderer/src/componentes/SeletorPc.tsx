// Troca a visualização dos navegadores e o destino dos controles sem misturar os PCs.
// As tarefas em andamento permanecem na conexão em que foram iniciadas.
import { useState } from 'react'
import { chamar, useRede } from '../api'

export function SeletorPc({ titulo = 'Computador exibido' }: { titulo?: string }) {
  const rede = useRede()
  const [mudando, setMudando] = useState(false)
  const [erro, setErro] = useState('')
  if (rede?.papel !== 'principal') return null
  const pcs = rede.pcs ?? []

  return (
    <section className="painel">
      <strong>{titulo}</strong>
      <div className="linha" style={{ gap: 8, flexWrap: 'wrap' }}>
        {pcs.map((pc, i) => (
          <button type="button" key={pc.id}
            className={`pilula ${rede.alvoAtivoId === pc.id ? 'ativa' : ''}`}
            disabled={mudando || !pc.conectado}
            title={pc.conectado ? `Acompanhar ${pc.nome}` : `Desconectado: ${pc.nome}`}
            onClick={async () => {
              if (rede.alvoAtivoId === pc.id) return
              setMudando(true)
              setErro('')
              try { await chamar('selecionarPcDestino', pc.id) }
              catch (e) { setErro(String(e instanceof Error ? e.message : e)); setMudando(false) }
            }}>
            {pc.apelido || `PC ${i + 2}`}{pc.conectado ? ' · conectado' : ' · offline'}
          </button>
        ))}
      </div>
      <span className="dica">Mostra e controla apenas o computador escolhido. Operações iniciadas no outro PC continuam rodando normalmente.</span>
      {erro && <div className="aviso">{erro}</div>}
    </section>
  )
}
