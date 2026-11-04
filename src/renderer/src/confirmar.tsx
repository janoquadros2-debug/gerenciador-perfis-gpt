// Janelas de confirmação do próprio programa.
// (As do sistema, confirm()/alert(), travam o teclado no Electron para Windows depois que fecham.)
import { useEffect, useState } from 'react'
import { Modal } from './componentes'

interface Pedido {
  texto: string
  titulo: string
  soOk: boolean
  perigo: boolean
  responder: (sim: boolean) => void
}

let mostrar: (p: Pedido) => void = () => undefined

export function confirmar(texto: string, opcoes: { titulo?: string; perigo?: boolean } = {}): Promise<boolean> {
  return new Promise((responder) => mostrar({ texto, titulo: opcoes.titulo ?? 'Confirmar', soOk: false, perigo: !!opcoes.perigo, responder }))
}

export function avisar(texto: string, titulo = 'Aviso'): Promise<void> {
  return new Promise((ok) => mostrar({ texto, titulo, soOk: true, perigo: false, responder: () => ok() }))
}

export function JanelaConfirmacao() {
  const [p, setP] = useState<Pedido | null>(null)
  useEffect(() => {
    mostrar = setP
  }, [])
  if (!p) return null
  const fim = (sim: boolean) => {
    setP(null)
    p.responder(sim)
  }
  return (
    <Modal titulo={p.titulo} aoFechar={() => fim(false)}>
      <p style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{p.texto}</p>
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        {!p.soOk && <button className="btn" onClick={() => fim(false)}>Cancelar</button>}
        <button className={`btn ${p.perigo ? 'perigo' : 'primario'}`} autoFocus onClick={() => fim(true)}>{p.soOk ? 'Ok' : 'Confirmar'}</button>
      </div>
    </Modal>
  )
}
