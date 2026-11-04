// Configurações > PC secundário: escolher o papel deste PC e parear os dois.
import { useState } from 'react'
import type { PapelPc, PcEncontrado, StatusRede } from '../../../shared/types'
import { chamar } from '../api'
import { confirmar } from '../confirmar'

const PAPEIS: [PapelPc, string, string][] = [
  ['unico', 'Só este PC', 'Abre e controla os navegadores aqui mesmo, como sempre.'],
  ['principal', 'PC principal', 'Este PC só dá as ordens. Os navegadores abrem no PC secundário.'],
  ['secundario', 'PC secundário', 'Este PC executa: abre os navegadores e recebe as ordens do principal.']
]

export function PcSecundario({ status }: { status: StatusRede | null }) {
  const [buscando, setBuscando] = useState(false)
  const [achados, setAchados] = useState<PcEncontrado[] | null>(null)
  const [endereco, setEndereco] = useState(status?.endereco ?? '')
  const [codigo, setCodigo] = useState('')
  if (!status) return null

  const mudarPapel = async (papel: PapelPc) => {
    if (papel === status.papel) return
    if (papel !== 'unico' && !(await confirmar(papel === 'principal'
      ? 'Mudar este PC para PRINCIPAL? Os navegadores passam a abrir no PC secundário.'
      : 'Mudar este PC para SECUNDÁRIO? Ele vai receber as ordens do PC principal.'))) return
    chamar('salvarRede', { papel })
  }
  const procurar = async () => {
    setBuscando(true)
    setAchados(await chamar<PcEncontrado[]>('procurarPcs').finally(() => setBuscando(false)))
  }
  const conectar = () => chamar('salvarRede', { endereco: endereco.trim(), codigo: codigo.trim() })

  return (
    <>
      <section className="painel">
        <h2>Este computador é:</h2>
        <div className="escolhas" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {PAPEIS.map(([v, t, d]) => (
            <label key={v} className={`escolha ${status.papel === v ? 'marcada' : ''}`} style={{ padding: '12px 14px', alignItems: 'flex-start' }}>
              <input type="radio" checked={status.papel === v} onChange={() => mudarPapel(v)} style={{ marginTop: 2 }} />
              <span>{t}<div className="dica" style={{ fontWeight: 400, marginTop: 2 }}>{d}</div></span>
            </label>
          ))}
        </div>
        <span className="dica">Nome deste PC: <strong>{status.meuNome}</strong> · IP na rede: <strong className="mono">{status.meusIps.join(' ou ') || '—'}</strong></span>
      </section>

      {status.papel === 'secundario' && (
        <section className="painel">
          <h2>Pareamento</h2>
          <div className="linha" style={{ gap: 24, alignItems: 'flex-start' }}>
            <div>
              <div className="dica">Código para digitar no PC principal</div>
              <div style={{ fontFamily: 'var(--titulo)', fontSize: 40, fontWeight: 700, letterSpacing: 6, marginTop: 4 }}>{status.meuCodigo}</div>
            </div>
            <div>
              <div className="dica">IP deste PC</div>
              <div className="mono" style={{ fontSize: 20, marginTop: 10 }}>{status.meusIps[0] ?? '—'}</div>
            </div>
            <span className="espaco" />
            <button className="btn" onClick={async () => (await confirmar('Gerar um código novo? O PC principal vai precisar digitar o novo.')) && chamar('novoCodigo')}>Gerar novo código</button>
          </div>
          <div className={`aviso ${status.conectado ? '' : ''}`} style={status.conectado ? { borderColor: 'var(--verde-borda)', background: 'var(--verde-fundo)', color: '#bbf7d0' } : undefined}>
            {status.conectado ? `Conectado ao PC principal "${status.nomeOutroPc}". Ele já pode dar as ordens.` : 'Aguardando o PC principal conectar…'}
          </div>
          {status.erro && <div className="aviso" style={{ color: '#ffb3c1' }}>{status.erro}</div>}
          <span className="dica">
            Na primeira vez, o Windows pode perguntar se o programa pode usar a rede: marque <strong>Redes privadas</strong> e clique em <strong>Permitir acesso</strong>.
          </span>
        </section>
      )}

      {status.papel === 'principal' && (
        <section className="painel">
          <h2>Conectar ao PC secundário</h2>
          <div className={`aviso`} style={status.conectado ? { borderColor: 'var(--verde-borda)', background: 'var(--verde-fundo)', color: '#bbf7d0' } : status.erro ? { color: '#ffb3c1' } : undefined}>
            {status.conectado
              ? `Conectado ao "${status.nomeOutroPc}" (${status.endereco}). Tudo o que você fizer aqui roda lá.`
              : status.conectando
                ? `Conectando em ${status.endereco}…`
                : status.erro ?? 'Ainda não conectado.'}
          </div>

          <div className="linha">
            <button className="btn primario" disabled={buscando} onClick={procurar}>{buscando ? 'Procurando…' : 'Procurar na rede'}</button>
            {achados && !achados.length && <span className="dica">Nenhum PC secundário encontrado. Ele está com o programa aberto no modo Secundário?</span>}
          </div>
          {achados && achados.length > 0 && (
            <div className="escolhas">
              {achados.map((a) => (
                <label key={a.endereco} className={`escolha ${endereco === a.endereco ? 'marcada' : ''}`}>
                  <input type="radio" checked={endereco === a.endereco} onChange={() => setEndereco(a.endereco)} />
                  <span>{a.nome}<div className="dica mono" style={{ fontWeight: 400 }}>{a.endereco} · v{a.versao}</div></span>
                </label>
              ))}
            </div>
          )}

          <div className="grade-campos">
            <label className="campo">IP do PC secundário<input className="mono" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="ex.: 192.168.0.15" /></label>
            <label className="campo">Código de pareamento<input className="mono" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 números" /></label>
          </div>
          <div className="linha" style={{ justifyContent: 'flex-end' }}>
            {(status.conectado || status.conectando) && <button className="btn" onClick={() => chamar('salvarRede', { codigo: '' })}>Desconectar</button>}
            <button className="btn primario" disabled={!endereco.trim() || codigo.length !== 6} onClick={conectar}>Conectar</button>
          </div>
          <span className="dica">O IP e o código aparecem no PC secundário, em Configurações &gt; PC secundário. Depois de conectar uma vez, ele reconecta sozinho.</span>
        </section>
      )}
    </>
  )
}
