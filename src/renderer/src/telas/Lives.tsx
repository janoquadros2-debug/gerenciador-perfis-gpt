// Aba Lives: o OBS e os 5 canais do seu plugin multi-rtmp, direto no programa.
import { useEffect, useState } from 'react'
import type { CanalObs, ConfigObs, StatusObs } from '../../../shared/types'
import { chamar } from '../api'
import { confirmar } from '../confirmar'
import { Chave } from '../componentes'

const limpar = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method 'chamar': Error: /, '')
const duracao = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
}
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

export function Lives() {
  const [st, setSt] = useState<StatusObs | null>(null)
  const [cfg, setCfg] = useState<ConfigObs | null>(null)
  const [senha, setSenha] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)

  const ler = () => chamar<StatusObs>('obsStatus').then(setSt).catch(() => undefined)
  useEffect(() => {
    chamar<ConfigObs>('obsConfig').then((c) => {
      setCfg(c)
      setSenha(c.senha)
    })
    ler()
    const t = setInterval(ler, 2000)
    return () => clearInterval(t)
  }, [])

  const fazer = async (chave: string, acao: () => Promise<unknown>) => {
    setOcupado(chave)
    setAviso('')
    try {
      await acao()
      setTimeout(ler, 600)
    } catch (e) {
      setAviso(limpar(e))
    } finally {
      setOcupado(null)
    }
  }

  const canais = st?.canais ?? []
  const noAr = canais.filter((c) => c.noAr).length

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Lives</h1>
          <p className="sub">
            {st?.conectado
              ? `OBS ${st.versaoObs ?? ''} conectado · ${noAr} de ${canais.length} canais no ar`
              : 'O OBS e os seus 5 canais (plugin multi-rtmp) direto aqui.'}
          </p>
        </div>
        {st?.conectado && st.pluginPronto && canais.length > 0 && (
          <div className="linha">
            <button className="btn primario" disabled={!!ocupado} onClick={() => fazer('todos', () => chamar('obsTodos', true))}>Ligar todos</button>
            <button
              className="btn perigo"
              disabled={!!ocupado || !noAr}
              onClick={async () => (await confirmar(`Desligar as ${noAr} lives que estão no ar?`, { perigo: true })) && fazer('todos', () => chamar('obsTodos', false))}
            >
              Desligar todos
            </button>
          </div>
        )}
      </div>

      {aviso && <div className="aviso" style={{ color: '#ffb3c1' }}>{aviso}</div>}

      {!st ? null : !st.conectado ? (
        <section className="painel">
          <h2>Conectar ao OBS</h2>
          <div className="aviso">{st.erro}</div>
          <p className="sub" style={{ marginTop: 0, lineHeight: 1.75 }}>
            Uma vez só, no OBS:
            <br />1. Abra o OBS e vá em <strong>Ferramentas &gt; Configurações do servidor WebSocket</strong>.
            <br />2. Marque <strong>Ativar servidor WebSocket</strong> (porta 4455) e clique em <strong>Mostrar informações de conexão</strong>.
            <br />3. Copie a <strong>senha</strong> e cole aqui embaixo. Pronto: o programa conecta sozinho.
          </p>
          <div className="linha" style={{ gap: 10, alignItems: 'flex-end' }}>
            <label className="campo" style={{ flex: 1 }}>
              Senha do WebSocket do OBS
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="cole a senha aqui" />
            </label>
            <button className="btn primario" onClick={() => fazer('senha', async () => setCfg(await chamar<ConfigObs>('salvarObsConfig', { senha: senha.trim() })))}>Salvar e conectar</button>
            <button className="btn" disabled={ocupado === 'abrir'} onClick={() => fazer('abrir', () => chamar('obsAbrir'))}>Abrir o OBS</button>
          </div>
        </section>
      ) : (
        <>
          <section className="painel">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <Numero rotulo="CPU do OBS" valor={`${st.cpu ?? 0}%`} cor={(st.cpu ?? 0) > 80 ? '#ff5c7a' : undefined} />
              <Numero rotulo="FPS" valor={`${st.fps ?? 0}`} />
              <Numero rotulo="Quadros perdidos (render)" valor={`${st.quadrosPerdidosRender ?? 0}`} />
              <Numero rotulo="Transmissão principal" valor={st.principal?.noAr ? (st.principal.reconectando ? 'Reconectando…' : `No ar · ${st.principal.tempo?.slice(0, 8) ?? ''}`) : 'Desligada'} cor={st.principal?.noAr ? '#3ddc84' : undefined} />
            </div>
            <div className="linha" style={{ gap: 10, alignItems: 'flex-end' }}>
              <label className="campo">
                Cena no ar
                <select value={st.cenaAtual} onChange={(e) => fazer('cena', () => chamar('obsCena', e.target.value))}>
                  {st.cenas.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <span className="espaco" />
              <button className="btn" disabled={!!ocupado} onClick={() => fazer('principal', () => chamar('obsPrincipal', !st.principal?.noAr))}>
                {st.principal?.noAr ? 'Parar transmissão principal' : 'Iniciar transmissão principal'}
              </button>
            </div>
          </section>

          {!st.pluginPronto ? (
            <section className="painel">
              <h2>Falta atualizar o plugin multi-rtmp</h2>
              <p className="sub" style={{ marginTop: 0, lineHeight: 1.75 }}>
                Para ver e controlar os 5 canais daqui, o seu plugin precisa estar na <strong>versão 0.10.0 ou mais nova</strong>. No OBS, abra o painel do plugin, vá na aba <strong>Atualizações</strong> e instale a nova versão (ou baixe em github.com/mtierry388-wq/obs-multi-rtmp/releases). Depois feche e abra o OBS.
              </p>
            </section>
          ) : !canais.length ? (
            <div className="vazio">Nenhum canal configurado no plugin multi-rtmp.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {canais.map((c) => (
                <CartaoCanal key={c.id} c={c} ocupado={ocupado === c.id} aoTrocar={(ligar) => fazer(c.id, () => chamar('obsCanal', c.id, ligar, c.nome))} />
              ))}
            </div>
          )}
        </>
      )}

      {cfg && st?.conectado && (
        <section className="painel">
          <div className="linha" style={{ gap: 10, alignItems: 'center' }}>
            <Chave ligada={cfg.alertas} aoMudar={async (v) => setCfg(await chamar<ConfigObs>('salvarObsConfig', { alertas: v }))} rotulo="Avisar quando uma live cair" />
            Avisar na tela quando uma live cair
            <span className="espaco" />
            <span className="dica">OBS em {cfg.endereco}:{cfg.porta}</span>
          </div>
        </section>
      )}
    </>
  )
}

function Numero({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="trabalho" style={{ display: 'grid', gap: 4 }}>
      <span className="dica">{rotulo}</span>
      <strong style={{ fontSize: 18, color: cor }}>{valor}</strong>
    </div>
  )
}

function CartaoCanal({ c, ocupado, aoTrocar }: { c: CanalObs; ocupado: boolean; aoTrocar: (ligar: boolean) => void }) {
  const perda = pct(c.perdidos, c.total)
  const estado = c.noAr ? 'No ar' : c.conectando ? (c.tentativaEm ? `Reconectando… ${c.tentativaEm}s` : 'Conectando…') : c.ligado ? 'Desligado' : 'Desativado no plugin'
  const cor = c.noAr ? (perda > 2 || c.congestionamento > 0.3 ? '#f5c451' : '#3ddc84') : c.conectando ? '#f5c451' : '#6b6985'
  return (
    <article className="painel" style={{ gap: 10, borderColor: c.noAr ? '#1f5a3a' : c.conectando ? '#5a4a1f' : undefined }}>
      <div className="linha" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</strong>
        <span className="selo" style={{ color: cor, background: '#16161f' }}>● {estado}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 13 }}>
        <div><span className="dica">Bitrate</span><br /><strong>{c.noAr ? `${(c.kbps / 1000).toFixed(1)} Mb/s` : '—'}</strong></div>
        <div><span className="dica">Perdidos</span><br /><strong style={{ color: perda > 2 ? '#ff5c7a' : undefined }}>{c.noAr ? `${perda.toFixed(1)}%` : '—'}</strong></div>
        <div><span className="dica">No ar há</span><br /><strong>{c.noAr ? duracao(c.tempoNoAr) : '—'}</strong></div>
      </div>
      {c.noAr && c.congestionamento > 0.3 && <span className="dica" style={{ color: '#f5c451' }}>Internet apertada: a live pode travar.</span>}
      {c.reconexoes > 0 && <span className="dica">Reconectou {c.reconexoes}× desde que ligou</span>}
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        {c.noAr || c.conectando ? (
          <button className="btn perigo" disabled={ocupado} onClick={() => aoTrocar(false)}>{ocupado ? 'Aguarde…' : 'Desligar'}</button>
        ) : (
          <button className="btn primario" disabled={ocupado || !c.ligado} onClick={() => aoTrocar(true)}>{ocupado ? 'Aguarde…' : 'Ligar'}</button>
        )}
      </div>
    </article>
  )
}
