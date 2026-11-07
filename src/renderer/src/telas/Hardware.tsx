// Uso do computador ao vivo (CPU, RAM, GPU e temperaturas) dos três computadores.
import { useEffect, useState } from 'react'
import type { UsoHardware, LeituraHardwareRemoto } from '../../../shared/types'
import { chamar } from '../api'

interface Leitura {
  este: UsoHardware
  outro: UsoHardware | null // legado
  remotos?: LeituraHardwareRemoto[]
  papel: 'unico' | 'principal' | 'secundario'
}

// verde até 70%, amarelo até 90%, vermelho acima (temperatura: 75 °C e 85 °C)
const corUso = (p?: number) => (p === undefined ? '#6b6985' : p >= 90 ? '#ff5c7a' : p >= 70 ? '#f5c451' : '#3ddc84')
const corTemp = (t?: number) => (t === undefined ? '#6b6985' : t >= 85 ? '#ff5c7a' : t >= 75 ? '#f5c451' : '#3ddc84')

function Medidor({ rotulo, porcentagem, detalhe, temperatura }: { rotulo: string; porcentagem?: number; detalhe?: string; temperatura?: number }) {
  return (
    <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
      <div className="linha" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 6 }}>
        <span className="dica" style={{ fontWeight: 600, color: 'var(--texto-2)' }}>{rotulo}</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {porcentagem === undefined ? '—' : `${porcentagem}%`}
          {temperatura !== undefined && <span style={{ color: corTemp(temperatura), marginLeft: 8 }}>{temperatura}°C</span>}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: '#24243a', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, porcentagem ?? 0)}%`, background: corUso(porcentagem), transition: 'width .6s ease' }} />
      </div>
      {detalhe && <span className="dica" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={detalhe}>{detalhe}</span>}
    </div>
  )
}

function Cartao({ titulo, u }: { titulo: string; u: UsoHardware }) {
  const g = u.gpu
  return (
    <div className="trabalho" style={{ display: 'grid', gap: 10 }}>
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>{titulo}</strong>
        <span className="dica" style={{ fontSize: 11 }}>{u.nome}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        <Medidor rotulo="CPU" porcentagem={u.cpu.porcentagem} temperatura={u.cpu.temperatura} detalhe={u.cpu.temperatura === undefined ? 'temperatura: o PC não informa' : u.cpu.nome} />
        <Medidor rotulo="RAM" porcentagem={u.ram.porcentagem} detalhe={`${u.ram.usadaGb} de ${u.ram.totalGb} GB`} />
        {g ? (
          <Medidor
            rotulo="GPU"
            porcentagem={g.porcentagem}
            temperatura={g.temperatura}
            detalhe={`${g.nome}${g.vramUsadaGb !== undefined ? ` · ${g.vramUsadaGb}/${g.vramTotalGb} GB` : ''}`}
          />
        ) : (
          <Medidor rotulo="GPU" detalhe="só placas NVIDIA" />
        )}
      </div>
    </div>
  )
}

function CartaoRemoto({ pc, indice }: { pc: LeituraHardwareRemoto; indice: number }) {
  const titulo = pc.apelido?.trim() || `PC secundário ${indice + 1}`
  if (pc.dados) {
    return (
      <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
        <Cartao titulo={titulo + (pc.ativo ? ' (selecionado)' : '')} u={pc.dados} />
      </div>
    )
  }
  return (
    <div className="trabalho" style={{ display: 'grid', gap: 10, minWidth: 0, opacity: .86 }}>
      <div className="linha" style={{ justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: 13 }}>{titulo}{pc.ativo ? ' (selecionado)' : ''}</strong>
        <span className="selo neutro">{pc.conectado ? 'Sem leitura' : 'Desconectado'}</span>
      </div>
      <span className="dica mono">{pc.nome} · {pc.endereco}</span>
      <span className="dica">{pc.erro || 'Aguardando informações deste computador.'}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        <Medidor rotulo="CPU" /><Medidor rotulo="RAM" /><Medidor rotulo="GPU" />
      </div>
    </div>
  )
}

export function PainelHardware() {
  const [l, setL] = useState<Leitura | null>(null)
  useEffect(() => {
    let vivo = true
    let ocupado = false
    const ler = async () => {
      if (ocupado || document.hidden) return
      ocupado = true
      try {
        const r = await chamar<Leitura>('hardwareTodos')
        if (vivo) setL(r)
      } catch {
        /* tenta de novo */
      } finally {
        ocupado = false
      }
    }
    ler()
    const t = setInterval(ler, 2500)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [])
  if (!l) return null
  const nomeEste = l.papel === 'principal' ? 'Este PC (principal)' : l.papel === 'secundario' ? 'Este PC (secundário)' : 'Este PC'
  const remotos = l.remotos ?? []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 12 }}>
      <Cartao titulo={nomeEste} u={l.este} />
      {remotos.length > 0
        ? remotos.map((pc, i) => <CartaoRemoto key={pc.id} pc={pc} indice={i} />)
        : l.outro && <Cartao titulo="PC secundário" u={l.outro} />}
    </div>
  )
}
