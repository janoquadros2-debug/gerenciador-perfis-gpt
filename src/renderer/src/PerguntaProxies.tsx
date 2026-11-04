// Janela que aparece quando os proxies acabam no "+1 / Adicionar".
import { useEffect, useState } from 'react'
import { chamar, ouvir } from './api'
import { Modal } from './componentes'

interface Pergunta {
  faltam: number
  listaVazia: boolean
}

export function PerguntaProxies() {
  const [p, setP] = useState<Pergunta | null>(null)
  useEffect(() => ouvir('pergunta-proxies', setP), [])
  if (!p) return null

  const responder = (r: 'resetar' | 'meu-ip' | 'cancelar') => {
    chamar('responderProxies', r)
    setP(null)
  }

  return (
    <Modal
      titulo={p.listaVazia ? 'Nenhum proxy na lista' : 'Os proxies acabaram'}
      sub={
        p.listaVazia
          ? `A lista de proxies está vazia. Faltam ${p.faltam} perfis para criar.`
          : `Todos os proxies da lista já foram usados. Faltam ${p.faltam} perfis para criar.`
      }
      aoFechar={() => responder('cancelar')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!p.listaVazia && (
          <button className="btn primario" style={{ height: 'auto', padding: '14px 16px', justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => responder('resetar')}>
            <span>
              <strong>Resetar a lista de proxies</strong>
              <div style={{ fontWeight: 400, fontSize: 13, opacity: 0.85 }}>Libera todos de novo e continua a partir do primeiro.</div>
            </span>
          </button>
        )}
        <button className="btn" style={{ height: 'auto', padding: '14px 16px', justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => responder('meu-ip')}>
          <span>
            <strong>Usar o meu IP</strong>
            <div style={{ fontWeight: 400, fontSize: 13, color: 'var(--texto-3)' }}>Cria os {p.faltam} perfis restantes sem proxy.</div>
          </span>
        </button>
        <button className="btn perigo" style={{ height: 'auto', padding: '14px 16px', justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => responder('cancelar')}>
          <span>
            <strong>Cancelar</strong>
            <div style={{ fontWeight: 400, fontSize: 13, opacity: 0.85 }}>Não cria os perfis que faltam.</div>
          </span>
        </button>
      </div>
    </Modal>
  )
}
