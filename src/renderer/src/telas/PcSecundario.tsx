// Configurações > PC secundário: escolher o papel deste PC e parear os dois.
import { useState } from 'react'
import type { PapelPc, PcEncontrado, StatusRede } from '../../../shared/types'
import { chamar } from '../api'
import { confirmar } from '../confirmar'

const PAPEIS: [PapelPc, string, string][] = [
  ['unico', 'Só este PC', 'Abre e controla os navegadores aqui mesmo, como sempre.'],
  ['principal', 'PC principal', 'Central de controle: escolha qual PC secundário recebe cada comando.'],
  ['secundario', 'PC secundário', 'Este PC executa: abre os navegadores e recebe as ordens do principal.']
]

export function PcSecundario({ status }: { status: StatusRede | null }) {
  const [buscando, setBuscando] = useState(false)
  const [achados, setAchados] = useState<PcEncontrado[] | null>(null)
  const [endereco, setEndereco] = useState(status?.endereco ?? '')
  const [codigo, setCodigo] = useState('')
  const [apelido, setApelido] = useState('')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [erroFormulario, setErroFormulario] = useState('')
  const [testandoLigacao, setTestandoLigacao] = useState(false)
  const [resultadoLigacao, setResultadoLigacao] = useState('')
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
  const conectar = async () => {
    setErroFormulario('')
    try {
      await chamar('salvarPcRemoto', { id: editandoId ?? '', endereco: endereco.trim(), codigo: codigo.trim(), apelido: apelido.trim() })
      setEditandoId(null)
      setCodigo('')
      setEndereco('')
      setApelido('')
    } catch (e) { setErroFormulario(String(e instanceof Error ? e.message : e)) }
  }
  const selecionar = async (id: string) => {
    try { await chamar('selecionarPcDestino', id) }
    catch (e) { setErroFormulario(String(e instanceof Error ? e.message : e)) }
  }
  const remover = async (id: string) => {
    if (await confirmar('Desconectar e remover este PC da central? Os navegadores que já estão abertos nele continuarão funcionando.')) {
      await chamar('removerPcRemoto', id)
    }
  }

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
          <h2>Central de computadores — até 3 PCs</h2>
          <span className="dica">Este é o PC principal. Cadastre até 2 secundários, mantenha ambos conectados e selecione o destino dos comandos. Um comando nunca é enviado aos dois ao mesmo tempo.</span>
          <div className="escolhas" style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {(status.pcs ?? []).map((pc) => (
              <div key={pc.id} className={`escolha ${status.alvoAtivoId === pc.id ? 'marcada' : ''}`} style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', flex:1, minWidth:200 }}>
                  <input type="radio" name="destinoPc" checked={status.alvoAtivoId === pc.id} onChange={() => selecionar(pc.id)} />
                  <span>
                    <strong>{pc.apelido || pc.nome}</strong>
                    <div className="dica mono">{pc.endereco} · {pc.conectado ? '● Conectado' : pc.conectando ? 'Conectando…' : '○ Desconectado'} {pc.versao ? `· v${pc.versao}` : ''}</div>
                    {pc.erro && <div className="dica" style={{color:'#ffb3c1'}}>{pc.erro}</div>}
                  </span>
                </label>
                <div className="linha" style={{gap:8}}>
                  <button className="btn pequeno" onClick={() => { setEditandoId(pc.id); setEndereco(pc.endereco); setApelido(pc.apelido ?? ''); setCodigo(''); setErroFormulario('') }}>Editar</button>
                  <button className="btn pequeno perigo" onClick={() => remover(pc.id)}>Remover</button>
                </div>
              </div>
            ))}
          </div>
          <div className="aviso" style={{marginTop:12}}>
            {status.alvoAtivoId
              ? status.conectado
                ? `Destino ativo: ${status.nomeOutroPc || status.endereco}. As próximas ações vão somente para ele.`
                : `Destino selecionado desconectado: ${status.endereco}. Os outros PCs continuam independentes.`
              : 'Nenhum PC selecionado. Cadastre um computador abaixo.'}
          </div>
          {status.conectado && (
            <div className="linha" style={{gap:10}}>
              <button className="btn" disabled={testandoLigacao} onClick={async () => {
                setTestandoLigacao(true)
                setResultadoLigacao('')
                try {
                  const r = await chamar<{ok:boolean;latenciaMs:number;remoto:{versao:string;navegadores:number;fila:number}}>('diagnosticoRede')
                  setResultadoLigacao(`Conexão OK · ${r.latenciaMs} ms · v${r.remoto.versao} · ${r.remoto.navegadores} navegadores · ${r.remoto.fila} na fila`)
                } catch (e) { setResultadoLigacao(String(e instanceof Error ? e.message : e)) }
                finally { setTestandoLigacao(false) }
              }}>{testandoLigacao ? 'Testando…' : 'Testar PC selecionado'}</button>
              {resultadoLigacao && <span className="dica">{resultadoLigacao}</span>}
            </div>
          )}
          <h3>{editandoId ? 'Editar pareamento' : 'Adicionar PC secundário'}</h3>
          <div className="linha">
            <button className="btn" disabled={buscando} onClick={procurar}>{buscando ? 'Procurando…' : 'Procurar na rede'}</button>
            {achados && !achados.length && <span className="dica">Nenhum PC encontrado. Confirme o modo Secundário e o firewall.</span>}
          </div>
          {achados && achados.length > 0 && <div className="escolhas">
            {achados.map((a) => <label key={a.endereco} className={`escolha ${endereco === a.endereco ? 'marcada' : ''}`}>
              <input type="radio" checked={endereco === a.endereco} onChange={() => { setEndereco(a.endereco); if (!apelido) setApelido(a.nome) }} />
              <span>{a.nome}<div className="dica mono">{a.endereco} · v{a.versao}</div></span>
            </label>)}
          </div>}
          <div className="grade-campos">
            <label className="campo">Nome (opcional)<input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="PC secundário 2" /></label>
            <label className="campo">IP do computador<input className="mono" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="192.168.0.15" /></label>
            <label className="campo">Código de pareamento (6 dígitos)<input className="mono" type="password" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Código exibido no outro PC" /></label>
          </div>
          {erroFormulario && <div className="aviso" style={{color:'#ffb3c1'}}>{erroFormulario}</div>}
          <div className="linha" style={{justifyContent:'flex-end'}}>
            {editandoId && <button className="btn" onClick={() => {setEditandoId(null);setEndereco('');setCodigo('');setApelido('')}}>Cancelar edição</button>}
            <button className="btn primario" disabled={!endereco.trim() || codigo.length !== 6 || (!editandoId && (status.pcs?.length ?? 0) >= 2)} onClick={conectar}>
              {editandoId ? 'Salvar novo pareamento' : 'Adicionar e conectar'}
            </button>
          </div>
          <span className="dica">O terceiro computador deve estar no modo PC secundário. Cada secundário usa seu próprio código. A seleção do destino é salva e as conexões reconectam automaticamente.</span>
        </section>
      )}
    </>
  )
}
