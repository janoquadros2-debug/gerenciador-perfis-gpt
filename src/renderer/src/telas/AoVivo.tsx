import { type MouseEvent, type WheelEvent, useEffect, useRef, useState } from 'react'
import type { EstadoMotor, Navegador, Proxy, TempoAberto } from '../../../shared/types'
import { chamar, useConfig } from '../api'
import { confirmar } from '../confirmar'
import { Icone, Modal } from '../componentes'
import { PainelHardware } from './Hardware'
import { SeletorPc } from '../componentes/SeletorPc'

// Lê "3, 7, 12" ou "10-15" e devolve a lista de números.
function lerNumeros(texto: string): number[] {
  const out = new Set<number>()
  for (const parte of texto.split(/[,;\s]+/)) {
    const m = parte.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i)
  }
  return [...out]
}

export function AoVivo({ estado }: { estado: EstadoMotor | null }) {
  const [cfg, salvar] = useConfig()
  const [qtd, setQtd] = useState('5')
  const [numeros, setNumeros] = useState('')
  const [ampliado, setAmpliado] = useState<Navegador | null>(null)
  const [trocando, setTrocando] = useState<number[] | null>(null)
  const [grupoMudando, setGrupoMudando] = useState(false)
  const [testandoPlay, setTestandoPlay] = useState(false)
  const [resultadoPlay, setResultadoPlay] = useState('')
  const [cronometros, setCronometros] = useState<{ slots: number[]; nome: string } | null>(null)
  const [editarEspera, setEditarEspera] = useState<number | null>(null)
  const [novaEspera, setNovaEspera] = useState('3')
  const [erroCiclo, setErroCiclo] = useState('')
  const [mostrarTrocaSite, setMostrarTrocaSite] = useState(false)
  const [novoSite, setNovoSite] = useState('')
  const [trocandoSite, setTrocandoSite] = useState(false)
  const [erroTrocaSite, setErroTrocaSite] = useState('')

  const navs = estado?.navegadores ?? []
  // relógio de 1 em 1 segundo para a contagem regressiva
  const [agora, setAgora] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const comErro = navs.filter((n) => n.status === 'erro').length
  const reproduzindo = navs.filter((n) => n.reproducao === 'reproduzindo').length
  const pausados = navs.filter((n) => n.reproducao === 'pausado').length
  const semConfirmacao = navs.filter((n) => n.status === 'ok' && n.reproducao !== 'reproduzindo' && n.reproducao !== 'pausado').length
  const ok = navs.filter((n) => n.status === 'ok').length
  const alvo = lerNumeros(numeros).filter((n) => navs.some((x) => x.slot === n))

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Ao vivo</h1>
          <p className="sub">Executando neste computador · {estado?.fila ? `${estado.fila} na fila para abrir` : 'nenhum na fila'}</p>
        </div>
        <div className="linha">
          {estado?.pausado ? (
            <button className="btn primario" onClick={() => chamar('retomar')}>Retomar</button>
          ) : (
            <button className="btn" onClick={() => chamar('pausar')}>Pausar</button>
          )}
          <button className="btn" onClick={() => chamar('organizarTodos')}>Organizar janelas</button>
          <button className="btn" disabled={testandoPlay || navs.length !== 1 || navs[0]?.status !== 'ok' || !!estado?.fila} onClick={async () => {
            setTestandoPlay(true)
            setResultadoPlay('')
            try {
              const r = await chamar<{ok:boolean;detalhe:string}>('testarPlayLocal', navs[0].slot)
              setResultadoPlay(r.detalhe)
            } catch (e) {setResultadoPlay('Erro no teste local: ' + String(e instanceof Error ? e.message : e))}
            finally {setTestandoPlay(false)}
          }}>{testandoPlay ? 'Testando Play…' : 'Testar Play automático (local)'}</button>
          <button className="btn primario" disabled={!navs.length} onClick={() => setCronometros({ slots: navs.map((n) => n.slot), nome: 'todos os perfis abertos' })}>F5 / Fechamento em todos</button>
          <button className="btn" disabled={!navs.length && !(estado?.ciclosEmEspera?.length)}
            onClick={() => { setMostrarTrocaSite(true); setErroTrocaSite('') }}>
            Fechar e reabrir em outro site
          </button>
          <button className="btn perigo" disabled={!navs.length} onClick={async () => (await confirmar('Fechar todos os navegadores?', { perigo: true })) && chamar('encerrarTodos')}>Fechar todos</button>
        </div>
      </div>

      <SeletorPc titulo="Ao vivo — escolher computador" />
      <div className="painel">
        <strong>Central de saúde dos navegadores</strong>
        <span className="dica">Diagnóstico passivo dos sites: confirma reprodução pelo avanço do vídeo. O botão de Play automático abre um player de demonstração gerado localmente, com apenas um perfil, sem reproduzir lives externas.</span>
        {resultadoPlay && <div className="dica" role="status">{resultadoPlay}</div>}
        <div className="linha" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="selo ok">{ok} navegadores carregados</span>
          <span className="selo neutro">{navs.filter((n) => n.status === 'abrindo').length} iniciando</span>
          <span className="selo erro">{comErro} precisam de atenção</span>
          <span className="selo neutro">{estado?.fila ?? 0} aguardando na fila</span>
          <span className="selo ok">{reproduzindo} reproduzindo (confirmados)</span>
          <span className="selo neutro">{pausados} pausados</span>
          <span className="selo neutro">{semConfirmacao} sem confirmação</span>
          <span className="selo neutro">{navs.filter((n) => n.avisoCookies).length} avisos de cookies</span>
        </div>
        {navs.some((n)=>n.ipRepetido) && <div className="aviso">IP de saída repetido em: {navs.filter((n)=>n.ipRepetido).map((n)=>'#'+n.slot+' ('+n.ip+')').join(' · ')}. Confirme se isso é esperado na sua rede.</div>}
        {navs.some((n)=>n.erroCategoria) && <span className="dica">Categorias de falha: {navs.filter((n)=>n.erroCategoria).map((n)=>'#'+n.slot+' '+n.erroCategoria).join(' · ')}</span>}
        {comErro > 0 && <span className="dica">Com problema: {navs.filter((n) => n.status === 'erro').slice(0, 12).map((n) => '#' + n.slot + ' ' + (n.erro ?? 'falha')).join(' · ')}</span>}
      </div>
      {(estado?.totalGrupos ?? 1) > 1 && (
        <div className="painel">
          <strong>Grupos de janelas</strong>
          <span className="dica">A tela não comporta todas as janelas simultaneamente. Escolha o grupo que ficará em evidência; os demais navegadores permanecem abertos atrás dele. Isso não garante prioridade de CPU ou GPU.</span>
          <div className="linha" style={{ gap: 8, flexWrap: 'wrap' }}>
            {Array.from({ length: Math.min(40, estado?.totalGrupos ?? 1) }, (_, grupo) => (
              <button key={grupo} className={`pilula ${(estado?.grupoVisivel ?? 0) === grupo ? 'ativa' : ''}`} disabled={grupoMudando}
                onClick={async () => {
                  setGrupoMudando(true)
                  try { await chamar('escolherGrupoJanelas', grupo) }
                  finally { setGrupoMudando(false) }
                }}>
                Grupo {grupo + 1}
              </button>
            ))}
          </div>
          <span className="dica">{estado?.capacidadePorGrupo ?? 0} posições por grupo · {estado?.totalGrupos ?? 1} grupos no total</span>
        </div>
      )}
      {!!estado?.ciclosEmEspera?.length && <section className="painel">
        <strong>Perfis fechados aguardando reabertura</strong>
        <span className="dica">O navegador Dolphin já foi fechado. A contagem continua neste aplicativo; ao pausá-lo, a reabertura aguarda o comando Retomar.</span>
        {estado.ciclosEmEspera.map((c) => <div key={c.slot} className="linha" style={{flexWrap:'wrap',gap:10}}>
          <span className="numero">#{c.slot}</span>
          <strong>{c.perfilNome}</strong>
          <span className="selo neutro">Reabre em {restante(Math.max(0,c.reabreEm-agora))}</span>
          <button className="btn pequeno" onClick={() => { setEditarEspera(c.slot); setNovaEspera(String(c.tempoFechadoMinutos || 3)); setErroCiclo('') }}>Alterar espera</button>
          <button className="btn pequeno" onClick={() => chamar('reabrirCicloAgora',c.slot)}>Reabrir agora</button>
          <button className="btn pequeno perigo" onClick={() => chamar('cancelarCiclo',c.slot)}>Cancelar ciclo</button>
        </div>)}
        {editarEspera !== null && <div className="linha" style={{gap:10,flexWrap:'wrap'}}>
          <label className="campo">Novo tempo fechado (minutos)
            <input className="solto" type="number" min={0.1} max={10080} step={0.1} value={novaEspera} onChange={(e)=>setNovaEspera(e.target.value)} style={{width:130}} />
          </label>
          <button className="btn primario pequeno" onClick={async () => {
            try { await chamar('alterarEsperaCiclo',editarEspera,Number(novaEspera)); setEditarEspera(null); setErroCiclo('') }
            catch(e){setErroCiclo(String(e instanceof Error?e.message:e))}
          }}>Aplicar agora</button>
          <button className="btn pequeno" onClick={()=>setEditarEspera(null)}>Fechar</button>
          {erroCiclo && <span className="dica">{erroCiclo}</span>}
        </div>}
      </section>}
      <PainelHardware />
      <div className="painel">
        <div className="linha" style={{ gap: 14 }}>
          <span className="selo ok">{ok} navegadores conectados</span>
          <span className="selo erro">{comErro} com erro</span>
          <span className="espaco" />
          <button className="btn pequeno perigo" disabled={!comErro} onClick={() => chamar('recarregarComErro')}>Recarregar todos com erro ({comErro})</button>
          <button className="btn pequeno" disabled={!comErro} onClick={() => chamar('substituirTodosComErro')}>Substituir todos com erro</button>
        </div>
        <div className="linha" style={{ gap: 14, alignItems: 'flex-end' }}>
          <label className="campo">
            Adicionar navegadores (cria perfis novos, cada um com o próximo proxy livre)
            <span className="linha" style={{ gap: 6 }}>
              <button className="btn" onClick={() => chamar('adicionar', 1)}>+1</button>
              <input className="solto" type="number" min={1} value={qtd} onChange={(e) => setQtd(e.target.value)} style={{ width: 80 }} aria-label="Quantidade para adicionar" />
              <button className="btn primario" onClick={() => Number(qtd) > 0 && chamar('adicionar', Number(qtd))}>Adicionar</button>
            </span>
          </label>
          <label className="campo">
            Navegadores pelo número (ex.: 12 ou 3, 7, 12 ou 10-15)
            <span className="linha" style={{ gap: 6 }}>
              <input className="solto" value={numeros} onChange={(e) => setNumeros(e.target.value)} style={{ width: 180 }} placeholder="12" />
              <button className="btn perigo" disabled={!alvo.length} onClick={() => { chamar('encerrar', alvo); setNumeros('') }}>Encerrar</button>
              <button className="btn" disabled={!alvo.length} onClick={() => setTrocando(alvo)}>Substituir</button>
              <button className="btn" disabled={!alvo.length} onClick={() => setCronometros({ slots: alvo, nome: alvo.map((n) => '#' + n).join(', ') })}>Programar tempo</button>
            </span>
          </label>
          <span className="espaco" />
          <label className="campo">
            Verificar o site a cada
            <select className="solto" value={cfg?.intervaloVerificacao ?? 10} onChange={(e) => salvar({ intervaloVerificacao: Number(e.target.value) })}>
              <option value={5}>5 segundos</option>
              <option value={10}>10 segundos</option>
              <option value={30}>30 segundos</option>
              <option value={60}>1 minuto</option>
              <option value={0}>Desligado</option>
            </select>
          </label>
          <label className="campo">
            Miniaturas
            <select className="solto" value={cfg?.miniaturas} onChange={(e) => salvar({ miniaturas: e.target.value as any })}>
              <option value="rapida">Rápida</option>
              <option value="normal">Normal</option>
              <option value="economica">Econômica</option>
              <option value="desligadas">Desligadas</option>
            </select>
          </label>
        </div>
      </div>

      {navs.length === 0 ? (
        <div className="painel vazio">Nenhum navegador aberto. Abra perfis na aba Perfis ou use "Adicionar".</div>
      ) : (
        <div className="grade-vivo">
          {navs.map((n) => (
            <CartaoVivo key={n.slot} n={n} agora={agora} aoAmpliar={() => setAmpliado(n)} aoSubstituir={() => setTrocando([n.slot])} aoProgramar={() => setCronometros({ slots: [n.slot], nome: n.perfilNome + ' (#' + n.slot + ')' })} />
          ))}
        </div>
      )}

      {mostrarTrocaSite && (
        <Modal titulo="Fechar e reabrir em outro site" sub="Reutiliza os mesmos perfis e proxies do computador selecionado, sem excluir nenhum cadastro do Dolphin." aoFechar={() => !trocandoSite && setMostrarTrocaSite(false)}>
          <div className="campo">
            Nova página para todos os perfis deste PC
            <input type="url" className="solto" value={novoSite}
              placeholder="https://exemplo.com"
              onChange={(e) => setNovoSite(e.target.value)} />
            <span className="dica">Os navegadores serão fechados e reabertos na nova página. O proxy individual, os cookies e os perfis existentes serão preservados.</span>
          </div>
          <div className="aviso">
            A troca será aplicada somente ao PC selecionado. Se houver perfis ainda abrindo, aguarde a fila terminar. Os outros PCs não serão afetados.
          </div>
          {erroTrocaSite && <div className="aviso" style={{ color: '#ffb3c1' }}>{erroTrocaSite}</div>}
          <div className="linha" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" disabled={trocandoSite} onClick={() => setMostrarTrocaSite(false)}>Cancelar</button>
            <button className="btn primario" disabled={trocandoSite || !novoSite.trim()} onClick={async () => {
              setTrocandoSite(true)
              setErroTrocaSite('')
              try {
                const resultado = await chamar<{ quantidade: number; site: string }>('reabrirTodosEmNovoSite', novoSite.trim())
                setMostrarTrocaSite(false)
                await confirmar(`${resultado.quantidade} perfil(is) preservado(s) e colocado(s) na fila para abrir em ${resultado.site}. Nenhum proxy foi trocado.`)
              } catch (e) {
                setErroTrocaSite(String(e instanceof Error ? e.message : e))
              } finally {
                setTrocandoSite(false)
              }
            }}>{trocandoSite ? 'Fechando e preparando…' : 'Fechar e reabrir'}</button>
          </div>
        </Modal>
      )}
      {ampliado && <Ampliado n={ampliado} aoFechar={() => setAmpliado(null)} />}
      {trocando && <Substituir slots={trocando} aoFechar={() => { setTrocando(null); setNumeros('') }} />}
      {cronometros && <ProgramarCronometros slots={cronometros.slots} nome={cronometros.nome} aoFechar={() => setCronometros(null)} />}
    </>
  )
}

function restante(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = String(s % 60).padStart(2, '0')
  return h ? `${h}h${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`
}

function CartaoVivo({ n, agora, aoAmpliar, aoSubstituir, aoProgramar }: { n: Navegador; agora: number; aoAmpliar: () => void; aoSubstituir: () => void; aoProgramar: () => void }) {
  const [testandoProxy, setTestandoProxy] = useState(false)
  const [erroTeste, setErroTeste] = useState('')
  const [verHistorico, setVerHistorico] = useState(false)
  const [verificandoVideo, setVerificandoVideo] = useState(false)
  const diagnosticarProxy = async () => {
    setTestandoProxy(true)
    setErroTeste('')
    try { await chamar('diagnosticarProxyPerfil', n.slot) }
    catch (e) { setErroTeste(String(e instanceof Error ? e.message : e)) }
    finally { setTestandoProxy(false) }
  }
  const textoStatus = n.status === 'ok' ? 'OK' : n.status === 'erro' ? 'ERRO' : 'ABRINDO'
  return (
    <article className={`vivo ${n.status}`}>
      <button type="button" className="tela" onClick={aoAmpliar} aria-label={`Ver ${n.perfilNome} em tela grande`} style={{ padding: 0 }}>
        {n.miniatura ? <img src={`data:image/jpeg;base64,${n.miniatura}`} alt="" /> : <span>{n.status === 'abrindo' ? 'Abrindo…' : 'Sem prévia'}</span>}
      </button>
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <span className="linha" style={{ gap: 8 }}>
          <span className="numero">#{n.slot}</span>
          <strong>{n.perfilNome}</strong>
        </span>
        <span className="selo" style={{ background: 'rgba(255,255,255,0.12)' }}>{textoStatus}</span>
      </div>
      <div className="site">
        <span className={`selo ${n.siteOk === undefined ? 'neutro' : n.siteOk ? 'ok' : 'erro'}`} style={{ flex: '0 0 auto' }}>
          {n.siteOk === undefined ? '…' : n.siteOk ? 'OK' : 'FALHA'}
        </span>
        <span className="mono url" title={n.url}>{n.url ? n.url.replace(/^https?:\/\//, '') : '—'}</span>
      </div>
      {n.verificadoEm && <span className="dica" style={{ fontSize: 11, marginTop: -6 }}>Verificado há {Math.max(0, Math.round((agora - n.verificadoEm) / 1000))}s</span>}
      {n.reproducao && (
        <div className="linha" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`selo ${n.reproducao === 'reproduzindo' ? 'ok' : n.reproducao === 'erro' ? 'erro' : 'neutro'}`} title={n.reproducaoDetalhe}>
            Vídeo: {({ analisando: 'analisando', reproduzindo: 'reproduzindo', pausado: 'pausado', carregando: 'carregando', encerrado: 'encerrado', 'sem-video': 'não encontrado', inconclusivo: 'inconclusivo', erro: 'erro' } as const)[n.reproducao]}
          </span>
          {n.avisoCookies && <span className="selo erro">Aviso de cookies detectado</span>}
          {n.anuncioProvavel && <span className="selo neutro" title="Indício visual; não é confirmação da entrega de publicidade">Possível anúncio</span>}
          {n.recuperacao === 'tentando' && <span className="selo neutro">Verificando carregamento · tentativa {n.tentativasRecuperacao ?? 0}/2</span>}
          {n.recuperacao === 'analisando' && (n.tentativasRecuperacao ?? 0) > 0 && <span className="selo neutro">Aguardando após F5 ({n.tentativasRecuperacao}/2)</span>}
          {n.recuperacao === 'intervencao' && <span className="selo erro">Precisa de intervenção</span>}
        </div>
      )}
      <div className="dados">
        <span>Sistema</span><span>{n.sistema}</span>
        <span>IP de saída</span><span className="mono">{n.ip ?? '—'}</span>
        <span>País</span><span>{n.pais ?? '—'}</span>
        <span>Proxy</span><span className="mono" style={{ overflowWrap: 'anywhere' }}>{n.proxy ?? 'Sem proxy'}</span>
        <span>Fecha em</span>
        <span>
          {n.fechando ? (
            <strong style={{ fontSize: 13, color: 'var(--amarelo)' }}>{n.reabreAoAcabar ? 'Fechando para reabrir…' : 'Fechando…'}</strong>
          ) : n.fechaEm ? (
            <strong className="mono" style={{ fontSize: 13, color: n.fechaEm - agora < 60_000 ? 'var(--amarelo)' : undefined }} title={`Fecha às ${new Date(n.fechaEm).toLocaleTimeString('pt-BR')}`}>
              {restante(n.fechaEm - agora)}
              {n.reabreAoAcabar && <span className="dica" style={{ fontWeight: 400 }}> · reabre</span>}
            </strong>
          ) : n.status === 'ok' ? 'Sem limite' : '—'}
        </span>
        {n.reabreAoAcabar && (
          <>
            <span>Tempo fechado</span>
            <span className="mono">{n.tempoFechadoMinutos ? n.tempoFechadoMinutos + ' min' : '3 segundos (antigo)'}</span>
          </>
        )}
        {n.proximoF5 && (
          <>
            <span>Próximo F5</span>
            <strong className="mono" style={{ fontSize: 13 }} title={`F5 às ${new Date(n.proximoF5).toLocaleTimeString('pt-BR')}`}>{restante(Math.max(0, n.proximoF5 - agora))}</strong>
          </>
        )}
      </div>
      {n.reproducaoDetalhe && <span className="dica" title={n.reproducaoDetalhe}>{n.reproducaoDetalhe}</span>}
      {n.diagnosticoProxy && <span className={`selo ${n.diagnosticoProxy.ok ? 'ok' : 'erro'}`}>
        {n.diagnosticoProxy.metodo === 'navegador' ? 'Conexão do navegador' : 'Proxy'}: {n.diagnosticoProxy.ok ? `OK · ${n.diagnosticoProxy.ms ?? '?'} ms` : n.diagnosticoProxy.erro ?? 'falha'}
      </span>}
      {erroTeste && <span className="dica">{erroTeste}</span>}
      {n.erro && <div className="erro-msg">{n.erro}</div>}
      {!!n.historico?.length && (
        <div>
          <button className="btn pequeno" onClick={() => setVerHistorico(!verHistorico)}>
            {verHistorico ? 'Ocultar histórico' : `Histórico (${n.historico.length})`}
          </button>
          {verHistorico && <div className="dica" style={{ maxHeight: 150, overflowY: 'auto', marginTop: 6 }}>
            {[...n.historico].reverse().slice(0, 20).map((h, i) => (
              <div key={h.quando + '-' + i}>{new Date(h.quando).toLocaleTimeString('pt-BR')} · {h.categoria}: {h.texto}</div>
            ))}
          </div>}
        </div>
      )}
      <div className="linha" style={{ gap: 6 }}>
        <button className="btn pequeno" style={{ flex: 1 }} onClick={() => chamar('f5', n.slot)}>F5</button>
        <button className="btn pequeno" title="Programar ou desativar F5 e fechamento automáticos neste perfil" onClick={aoProgramar}>Tempos</button>
        {n.reabreAoAcabar && <button className="btn pequeno perigo" title="Desligar apenas o ciclo fechar/reabrir; não desativa o F5" onClick={() => chamar('cancelarCiclo',n.slot)}>Cancelar ciclo</button>}
        <button className="btn pequeno" disabled={testandoProxy} title="Testar a conexão do proxy sem mudar o perfil" onClick={diagnosticarProxy}>{testandoProxy ? 'Testando…' : 'Testar proxy'}</button>
        <button className="btn pequeno" disabled={verificandoVideo || n.status !== 'ok'} onClick={async () => {
          setVerificandoVideo(true)
          try { await chamar('verificarVideoAgora', n.slot) } catch (e) { setErroTeste(String(e instanceof Error ? e.message : e)) }
          finally { setVerificandoVideo(false) }
        }}>{verificandoVideo ? 'Verificando…' : 'Verificar vídeo'}</button>
        {n.recuperacao === 'intervencao' && <button className="btn pequeno" title="Limpar alerta e iniciar nova rodada de monitoramento" onClick={() => chamar('retomarDiagnostico', n.slot)}>Retomar diagnóstico</button>}
        <button className="btn pequeno icone" title="Substituir" aria-label="Substituir" onClick={aoSubstituir}>{Icone.trocar}</button>
        <button className="btn pequeno icone" title="Trazer para frente" aria-label="Trazer para frente" onClick={() => chamar('trazerParaFrente', n.slot)}>{Icone.frente}</button>
        <button className="btn pequeno icone" title="Encerrar" aria-label="Encerrar" onClick={() => chamar('encerrar', [n.slot])}>{Icone.fechar}</button>
      </div>
    </article>
  )
}

function ProgramarCronometros({ slots, nome, aoFechar }: { slots: number[]; nome: string; aoFechar: () => void }) {
  const [tipo, setTipo] = useState<'f5' | 'fechamento'>('f5')
  const [modo, setModo] = useState<TempoAberto['modo']>('fixo')
  const [minutos, setMinutos] = useState(5)
  const [de, setDe] = useState(3)
  const [ate, setAte] = useState(8)
  const [aoAcabar, setAoAcabar] = useState<'fechar' | 'reabrir'>('fechar')
  const [tempoFechadoMinutos, setTempoFechadoMinutos] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const aplicar = async () => {
    if (modo !== 'sem-limite' && (!Number.isFinite(minutos) || !Number.isFinite(de) || !Number.isFinite(ate) ||
        (modo === 'fixo' && minutos <= 0) || (modo === 'aleatorio' && (de <= 0 || ate < de)))) {
      setErro('Confira os minutos e o intervalo informado.')
      return
    }
    if (tipo === 'fechamento' && aoAcabar === 'reabrir' && (!Number.isFinite(tempoFechadoMinutos) || tempoFechadoMinutos < 0 || tempoFechadoMinutos > 10080)) {
      setErro('Tempo fechado inválido.')
      return
    }
    setSalvando(true)
    setErro('')
    try {
      const resultado = await chamar<{ alterados: number; ignorados: number }>('ajustarCronometros', slots, tipo, { modo, minutos, de, ate }, aoAcabar, tipo === 'fechamento' && aoAcabar === 'reabrir' ? tempoFechadoMinutos : undefined)
      if (!resultado.alterados) { setErro('Nenhum perfil selecionado está disponível.'); return }
      aoFechar()
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally { setSalvando(false) }
  }
  return (
    <Modal titulo="Programar F5 e fechamento" sub={`Aplicar em ${nome} · contagem a partir de agora`} aoFechar={aoFechar}>
      <div className="campo">
        Função
        <div className="linha">
          <label className="escolha"><input type="radio" checked={tipo === 'f5'} onChange={() => setTipo('f5')} /> F5 automático</label>
          <label className="escolha"><input type="radio" checked={tipo === 'fechamento'} onChange={() => setTipo('fechamento')} /> Fechar por tempo</label>
        </div>
      </div>
      <label className="campo">Modo
        <select className="solto" value={modo} onChange={(e) => setModo(e.target.value as TempoAberto['modo'])}>
          <option value="sem-limite">Desativar {tipo === 'f5' ? 'F5 automático' : 'fechamento automático'}</option>
          <option value="fixo">Tempo fixo</option>
          <option value="aleatorio">Tempo aleatório por perfil</option>
        </select>
      </label>
      {modo === 'fixo' && <label className="campo">Minutos
        <input className="solto" type="number" min={1} max={10080} value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} />
      </label>}
      {modo === 'aleatorio' && <div className="linha" style={{ gap: 12 }}>
        <label className="campo">De (minutos)<input className="solto" type="number" min={1} max={10080} value={de} onChange={(e) => setDe(Number(e.target.value))} /></label>
        <label className="campo">Até (minutos)<input className="solto" type="number" min={1} max={10080} value={ate} onChange={(e) => setAte(Number(e.target.value))} /></label>
      </div>}
      {tipo === 'fechamento' && modo !== 'sem-limite' && (
        <label className="campo">Quando o tempo terminar
          <select className="solto" value={aoAcabar} onChange={(e) => setAoAcabar(e.target.value as 'fechar' | 'reabrir')}>
            <option value="fechar">Fechar o navegador</option>
            <option value="reabrir">Fechar e reabrir com novo tempo</option>
          </select>
        </label>
      )}
      {tipo === 'fechamento' && modo !== 'sem-limite' && aoAcabar === 'reabrir' && (
        <label className="campo">Aguardar com navegador fechado (minutos)
          <input className="solto" type="number" min={0} max={10080} value={tempoFechadoMinutos} onChange={(e)=>setTempoFechadoMinutos(Number(e.target.value))} style={{width:130}} />
          <span className="dica">Zero preserva o ciclo antigo de 3 segundos. Tempo positivo usa descanso em minutos.</span>
        </label>
      )}
      <span className="dica">Alterar uma função não modifica a outra. Cada perfil sorteia seu próprio prazo quando selecionado o modo aleatório. Desativar cancela os próximos eventos.</span>
      {erro && <div className="aviso">{erro}</div>}
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={aoFechar}>Cancelar</button>
        <button className="btn primario" disabled={salvando} onClick={aplicar}>{salvando ? 'Aplicando…' : 'Aplicar agora'}</button>
      </div>
    </Modal>
  )
}

function Ampliado({ n, aoFechar }: { n: Navegador; aoFechar: () => void }) {
  const [img, setImg] = useState<string | undefined>()
  const [abas, setAbas] = useState<{ indice: number; titulo: string; url: string; ativa: boolean }[]>([])
  const [texto, setTexto] = useState('')
  const [controlar, setControlar] = useState(true)
  const [marca, setMarca] = useState<{ x: number; y: number } | null>(null)
  const atualizar = useRef<() => void>(() => undefined)
  useEffect(() => {
    let ativo = true
    let ocupado = false
    const pegar = async () => {
      if (ocupado) return
      ocupado = true
      await chamar<string | undefined>('miniaturaGrande', n.slot).then((i) => ativo && setImg(i)).catch(() => undefined)
      ocupado = false
    }
    const pegarAbas = () => chamar<typeof abas>('abasNavegador', n.slot).then((a) => ativo && setAbas(a)).catch(() => undefined)
    atualizar.current = () => {
      setTimeout(pegar, 250)
      setTimeout(pegar, 900)
      setTimeout(pegarAbas, 900)
    }
    pegar()
    pegarAbas()
    const t = setInterval(pegar, 1000)
    const t2 = setInterval(pegarAbas, 4000)
    return () => {
      ativo = false
      clearInterval(t)
      clearInterval(t2)
    }
  }, [n.slot])

  const posicao = (e: MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const clicar = async (e: MouseEvent<HTMLImageElement>, botao: 'left' | 'right' = 'left', duplo = false) => {
    if (!controlar) return
    e.preventDefault()
    const p = posicao(e)
    setMarca(p)
    setTimeout(() => setMarca(null), 500)
    await chamar('clicarNavegador', n.slot, p.x, p.y, botao, duplo).catch(() => undefined)
    atualizar.current()
  }
  const rolar = (e: WheelEvent<HTMLImageElement>) => {
    if (!controlar) return
    const r = e.currentTarget.getBoundingClientRect()
    chamar('rolarNavegador', n.slot, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, Math.max(-800, Math.min(800, e.deltaY))).catch(() => undefined)
    atualizar.current()
  }
  const enviar = async (tecla?: string) => {
    await chamar('digitarNavegador', n.slot, tecla ? '' : texto, tecla ?? undefined).catch(() => undefined)
    if (!tecla) setTexto('')
    atualizar.current()
  }

  return (
    <Modal titulo={`#${n.slot} · ${n.perfilNome}`} sub={controlar ? 'Controle ligado: clique, role e digite direto na tela' : 'Só olhando (atualiza a cada 1 s)'} aoFechar={aoFechar} grande>
      {abas.length > 1 && (
        <div className="linha" style={{ gap: 6, flexWrap: 'nowrap', overflowX: 'auto' }}>
          {abas.map((a) => (
            <button
              key={a.indice}
              type="button"
              className={`pilula ${a.ativa ? 'ativa' : ''}`}
              style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}
              title={a.url}
              onClick={() => chamar('escolherAba', n.slot, a.indice).then(() => atualizar.current())}
            >
              {a.titulo}
            </button>
          ))}
        </div>
      )}
      <div style={{ background: '#0e0e16', borderRadius: 12, minHeight: 300, display: 'grid', placeItems: 'center', overflow: 'hidden', position: 'relative' }}>
        {img ? (
          <div style={{ position: 'relative', lineHeight: 0 }}>
            <img
              src={`data:image/jpeg;base64,${img}`}
              alt={`Tela do navegador ${n.perfilNome}`}
              style={{ maxWidth: '100%', maxHeight: '62vh', cursor: controlar ? 'pointer' : 'default', userSelect: 'none' }}
              draggable={false}
              onClick={(e) => clicar(e)}
              onDoubleClick={(e) => clicar(e, 'left', true)}
              onContextMenu={(e) => clicar(e, 'right')}
              onWheel={rolar}
            />
            {marca && (
              <span style={{ position: 'absolute', left: `${marca.x * 100}%`, top: `${marca.y * 100}%`, width: 26, height: 26, marginLeft: -13, marginTop: -13, borderRadius: 99, border: '3px solid #ff4f9a', pointerEvents: 'none' }} />
            )}
          </div>
        ) : (
          <span className="dica">Carregando…</span>
        )}
      </div>
      <div className="linha" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="linha" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={controlar} onChange={(e) => setControlar(e.target.checked)} /> Controlar pela tela
        </label>
        <button className="btn pequeno" disabled={!controlar} onClick={() => chamar('clicarNavegador', n.slot, 0.5, 0.5).then(() => atualizar.current())}>Clicar no meio</button>
        <input
          className="solto"
          value={texto}
          disabled={!controlar}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (texto ? enviar().then(() => enviar('Enter')) : enviar('Enter'))}
          placeholder="Digitar no navegador (Enter envia)"
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className="btn pequeno" disabled={!controlar || !texto} onClick={() => enviar()}>Digitar</button>
        <button className="btn pequeno" disabled={!controlar} onClick={() => enviar('Enter')}>Enter</button>
        <button className="btn pequeno" disabled={!controlar} onClick={() => enviar('Escape')}>Esc</button>
        <button className="btn pequeno" disabled={!controlar} onClick={() => enviar('Space')}>Espaço</button>
      </div>
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => chamar('f5', n.slot).then(() => atualizar.current())}>F5</button>
        <button className="btn primario" onClick={() => chamar('trazerParaFrente', n.slot)}>Trazer para frente</button>
      </div>
    </Modal>
  )
}

function Substituir({ slots, aoFechar }: { slots: number[]; aoFechar: () => void }) {
  const [perfil, setPerfil] = useState<'mesmo' | 'outro'>('mesmo')
  const [modo, setModo] = useState<'proximo' | 'escolher' | 'colar'>('proximo')
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [escolhido, setEscolhido] = useState('')
  const [texto, setTexto] = useState('')
  useEffect(() => {
    chamar<Proxy[]>('proxies').then((l) => {
      setProxies(l)
      setEscolhido(l[0]?.id ?? '')
    })
  }, [])

  const confirmar = async () => {
    const proxy = modo === 'proximo' ? 'proximo' : modo === 'escolher' ? { id: escolhido } : { texto }
    for (const slot of slots) await chamar('substituir', slot, { perfil, proxy })
    aoFechar()
  }

  return (
    <Modal titulo={`Substituir ${slots.map((s) => '#' + s).join(', ')}`} sub="Fecha e abre outro no mesmo lugar da grade." aoFechar={aoFechar}>
      <div className="campo">
        Qual perfil entra no lugar
        <div className="escolhas">
          <label className={`escolha ${perfil === 'mesmo' ? 'marcada' : ''}`}><input type="radio" checked={perfil === 'mesmo'} onChange={() => setPerfil('mesmo')} />O mesmo, com proxy novo</label>
          <label className={`escolha ${perfil === 'outro' ? 'marcada' : ''}`}><input type="radio" checked={perfil === 'outro'} onChange={() => setPerfil('outro')} />Outro perfil livre</label>
        </div>
      </div>
      <div className="campo">
        Proxy
        <div className="escolhas">
          {([['proximo', 'Próximo da lista'], ['escolher', 'Escolher um'], ['colar', 'Colar um novo']] as const).map(([v, t]) => (
            <label key={v} className={`escolha ${modo === v ? 'marcada' : ''}`}><input type="radio" checked={modo === v} onChange={() => setModo(v)} />{t}</label>
          ))}
        </div>
      </div>
      {modo === 'escolher' && (
        <label className="campo">
          Proxy salvo
          <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>{p.tipo}://{p.host}:{p.porta} · usado {p.usos}x{p.ultimoTeste ? (p.ultimoTeste.ok ? ' · ok' : ' · falhou') : ''}</option>
            ))}
          </select>
        </label>
      )}
      {modo === 'colar' && (
        <label className="campo">Proxy<input className="mono" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ip:porta:usuario:senha" /></label>
      )}
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={aoFechar}>Cancelar</button>
        <button className="btn primario" disabled={(modo === 'escolher' && !escolhido) || (modo === 'colar' && !texto.trim())} onClick={confirmar}>Substituir</button>
      </div>
    </Modal>
  )
}
