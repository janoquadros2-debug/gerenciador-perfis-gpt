import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import type { ItemGaleria, StatusIA } from '../../shared/types'
import { chamar, ouvir, useConfig, useEstado, useRede } from './api'
import { Icone } from './componentes'
import { AoVivo } from './telas/AoVivo'
import { Atualizacoes } from './telas/Atualizacoes'
import { Configuracoes } from './telas/Configuracoes'
import { Janelas } from './telas/Janelas'
import { Perfis } from './telas/Perfis'
import { Proxies } from './telas/Proxies'
import { Sugestoes } from './telas/Sugestoes'
import { PerguntaProxies } from './PerguntaProxies'
import { JanelaConfirmacao } from './confirmar'
import { Logs } from './telas/Logs'
import { Lives } from './telas/Lives'

type Tela = 'perfis' | 'vivo' | 'lives' | 'janelas' | 'proxies' | 'imagens' | 'animar' | 'musica' | 'config' | 'atualizacoes' | 'sugestoes' | 'logs'

// Abas de IA: só existem na edição Completa (na Padrão nem entram no programa).
const CriarImagens = __EDICAO__ === 'completa' ? lazy(() => import('./telas/ia/CriarImagens')) : null
const Animar = __EDICAO__ === 'completa' ? lazy(() => import('./telas/ia/Animar')) : null
const Musica = __EDICAO__ === 'completa' ? lazy(() => import('./telas/ia/Musica')) : null

export function App() {
  const [tela, setTela] = useState<Tela>('perfis')
  const [paraAnimar, setParaAnimar] = useState<ItemGaleria | null>(null)
  const [visitouMusica, setVisitouMusica] = useState(false)
  const [alertaLive, setAlertaLive] = useState<{ titulo: string; texto: string } | null>(null)
  useEffect(() => ouvir('obs-alerta', setAlertaLive), [])
  useEffect(() => {
    if (tela === 'musica') setVisitouMusica(true)
  }, [tela])
  const [abaConfig, setAbaConfig] = useState<string | undefined>()
  const irParaComfy = () => {
    setAbaConfig('comfy')
    setTela('config')
  }
  const [versao, setVersao] = useState('')
  const [temAtualizacao, setTemAtualizacao] = useState(false)
  const estado = useEstado()
  const rede = useRede()
  const principalDesligado = rede?.papel === 'principal' && !rede.conectado
  const [cfg] = useConfig()

  useEffect(() => {
    chamar<string>('versao').then(setVersao)
    chamar('estadoAtualizacao').then((i) => setTemAtualizacao(i.status === 'disponivel'))
    return window.api.ouvir('atualizacao', (i) => setTemAtualizacao(i.status === 'disponivel'))
  }, [])

  const [limpando, setLimpando] = useState(false)
  const [resultado, setResultado] = useState('')
  const limpar = async () => {
    setLimpando(true)
    setResultado('')
    try {
      const r = await chamar<{ antes: number; depois: number; liberado: number }>('limparRam')
      const gb = (r.liberado / 1024 ** 3).toFixed(1).replace('.', ',')
      setResultado(r.liberado > 50 * 1024 ** 2 ? `${r.antes}% → ${r.depois}% · liberou ${gb} GB` : `${r.antes}% → ${r.depois}% · pouco para liberar`)
      setTimeout(() => setResultado(''), 8000)
    } finally {
      setLimpando(false)
    }
  }
  const [errosNovos, setErrosNovos] = useState(0)
  useEffect(
    () =>
      window.api.ouvir('logs', (novas: { nivel: string; repeticoes?: number }[]) => {
        const n = novas.filter((e) => e.nivel === 'erro' && !e.repeticoes).length
        if (n) setErrosNovos((x) => x + n)
      }),
    []
  )
  useEffect(() => {
    if (tela === 'logs') setErrosNovos(0)
  }, [tela])
  const errosVisiveis = tela === 'logs' ? 0 : errosNovos

  const navs = estado?.navegadores ?? []
  const comErro = navs.filter((n) => n.status === 'erro').length
  const ram = estado?.ram.porcentagem ?? 0

  const itens: [Tela, string, ReactNode, ReactNode][] = [
    ['perfis', 'Perfis', Icone.perfis, null],
    ['vivo', 'Ao vivo', Icone.vivo, navs.length ? <span className={`contador ${comErro ? '' : 'verde'}`} style={comErro ? { background: 'var(--vermelho-borda)' } : undefined}>{comErro ? `${comErro} erro` : navs.length}</span> : null],
    ['lives', 'Lives', Icone.lives, null],
    ['janelas', 'Janelas', Icone.janelas, null],
    ['proxies', 'Proxies', Icone.proxies, null],
    ...(CriarImagens && rede?.edicao === 'completa'
      ? ([
          ['imagens', 'Criar imagens', Icone.imagem, null],
          ['animar', 'Animar', Icone.animar, null],
          ['musica', 'Música', Icone.musica, null]
        ] as [Tela, string, ReactNode, ReactNode][])
      : []),
    ['config', 'Configurações', Icone.config, null],
    ['atualizacoes', 'Atualizações', Icone.atualizar, temAtualizacao ? <span className="contador">1</span> : null],
    ['sugestoes', 'Sugestões', Icone.sugestoes, null],
    ['logs', 'Logs', Icone.logs, errosVisiveis ? <span className="contador" style={{ background: 'var(--vermelho-borda)' }}>{errosVisiveis > 99 ? '99+' : errosVisiveis}</span> : null]
  ]

  return (
    <div className="app">
      <nav className="lateral" aria-label="Menu principal">
        <div className="marca">
          <div className="marca-icone" style={{ color: '#fff' }}>{Icone.monitor}</div>
          <div>
            <div className="marca-nome">Gerenciador</div>
            <div className="marca-versao">v{versao}</div>
          </div>
        </div>
        <div className="menu">
          {itens.map(([id, nome, icone, extra]) => (
            <button key={id} className={tela === id ? 'ativo' : ''} onClick={() => { setAbaConfig(undefined); setTela(id) }}>
              {icone}
              {nome}
              {extra}
            </button>
          ))}
        </div>
        <div className="lateral-rodape">
          <div className="mini-cartao">
            <div className="linha" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span className="dica">Memória RAM</span>
              <strong>{ram}%</strong>
            </div>
            <div className="barra">
              <div style={{ width: `${ram}%`, background: cfg && ram >= cfg.limiteRam ? 'var(--vermelho)' : 'var(--verde)' }} />
              {cfg?.limitadorRam && <div className="marca-limite" style={{ left: `${cfg.limiteRam}%` }} />}
            </div>
            <span className="dica">{cfg?.limitadorRam ? `Limite em ${cfg.limiteRam}%` : 'Limitador desligado'}</span>
            <button className="btn pequeno" style={{ marginTop: 4 }} disabled={limpando} onClick={limpar}>
              {limpando ? 'Limpando…' : 'Limpar RAM'}
            </button>
            {resultado && <span className="dica" style={{ color: 'var(--verde)' }}>{resultado}</span>}
          </div>
          {rede && rede.papel !== 'unico' && (
            <button type="button" className="mini-cartao" onClick={() => setTela('config')} style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
              <span className="dica">{rede.papel === 'principal' ? 'Executando no PC secundário' : 'Este é o PC secundário'}</span>
              <span className="linha" style={{ gap: 8, fontSize: 13, fontWeight: 600, flexWrap: 'nowrap' }}>
                <span className="pontinho" style={{ background: rede.conectado ? 'var(--verde)' : rede.conectando || rede.papel === 'secundario' ? 'var(--amarelo)' : 'var(--vermelho)' }} />
                {rede.conectado
                  ? rede.nomeOutroPc ?? 'Conectado'
                  : rede.papel === 'principal'
                    ? rede.conectando ? 'Conectando…' : 'Desconectado'
                    : 'Aguardando o principal'}
              </span>
            </button>
          )}
          {CriarImagens && rede?.edicao === 'completa' && <CartaoIA />}
          <div className="mini-cartao" style={{ flexDirection: 'row', alignItems: 'center', fontSize: 13 }}>
            <span className="pontinho" style={{ background: estado?.pausado ? 'var(--amarelo)' : 'var(--verde)' }} />
            {estado?.pausado ? 'Programa pausado' : 'Programa rodando'}
          </div>
        </div>
      </nav>

      <main className="conteudo">
        {alertaLive && (
          <div className="faixa-pausa" style={{ background: '#3a121b', borderColor: 'var(--vermelho-borda)', color: '#ffc2cd' }}>
            <strong>{alertaLive.titulo}</strong>&nbsp;{alertaLive.texto}
            <span className="espaco" />
            <button className="btn" onClick={() => { setAlertaLive(null); setTela('lives') }}>Ver lives</button>
            <button className="btn" onClick={() => setAlertaLive(null)}>OK</button>
          </div>
        )}
        {principalDesligado && tela !== 'config' && (
          <div className="faixa-pausa" style={{ background: '#3a121b', borderColor: 'var(--vermelho-borda)', color: '#ffc2cd' }}>
            {rede?.conectando ? `Conectando ao PC secundário (${rede.endereco})…` : rede?.erro ?? 'Sem conexão com o PC secundário.'}
            <span className="espaco" />
            <button className="btn" onClick={() => setTela('config')}>Configurar</button>
          </div>
        )}
        {rede?.papel === 'secundario' && rede.conectado && tela === 'vivo' && (
          <div className="aviso">Este é o PC secundário: o PC principal "{rede.nomeOutroPc}" está dando as ordens. Você também pode acompanhar daqui.</div>
        )}
        {estado?.pausado && (
          <div className="faixa-pausa">
            Programa pausado: nada novo será aberto, reaberto ou testado.
            <span className="espaco" />
            <button className="btn primario" onClick={() => chamar('retomar')}>Retomar</button>
          </div>
        )}
        {estado && estado.avisos.length > 0 && (
          <div className="aviso linha">
            <span>{estado.avisos[estado.avisos.length - 1]}</span>
            <span className="espaco" />
            <button className="btn pequeno" onClick={() => chamar('limparAvisos')}>Ok</button>
          </div>
        )}

        {tela === 'perfis' && <Perfis estado={estado} />}
        {tela === 'vivo' && <AoVivo estado={estado} />}
        {tela === 'lives' && <Lives />}
        {tela === 'janelas' && <Janelas />}
        {tela === 'proxies' && <Proxies esgotados={!!estado?.proxiesEsgotados} />}
        {tela === 'config' && <Configuracoes abaInicial={abaConfig} />}
        {(tela === 'imagens' || tela === 'animar') && CriarImagens && Animar && (
          <Suspense fallback={<div className="vazio">Carregando…</div>}>
            {tela === 'imagens' ? (
              <CriarImagens aoAnimar={(i: ItemGaleria) => { setParaAnimar(i); setTela('animar') }} aoConfigurar={irParaComfy} />
            ) : (
              <Animar inicial={paraAnimar} aoConfigurar={irParaComfy} />
            )}
          </Suspense>
        )}
        {/* a aba Música fica aberta por trás depois da 1ª visita (o site do Suno não precisa recarregar e as músicas continuam sendo guardadas) */}
        {Musica && visitouMusica && (
          <div style={{ display: tela === 'musica' ? 'contents' : 'none' }}>
            <Suspense fallback={<div className="vazio">Carregando…</div>}>
              <Musica />
            </Suspense>
          </div>
        )}
        {tela === 'atualizacoes' && <Atualizacoes />}
        {tela === 'sugestoes' && <Sugestoes />}
        {tela === 'logs' && <Logs />}
      </main>
      <PerguntaProxies />
      <JanelaConfirmacao />
    </div>
  )
}

// Liga/desliga a IA (ComfyUI) para os navegadores terem o PC todo
function CartaoIA() {
  const [st, setSt] = useState<StatusIA | null>(null)
  const [mudando, setMudando] = useState(false)
  useEffect(() => {
    chamar<StatusIA>('iaStatus').then(setSt).catch(() => undefined)
    return ouvir('ia-status', setSt)
  }, [])
  if (!st) return null
  const desligada = !!st.desligada
  const trocar = async () => {
    setMudando(true)
    await chamar(desligada ? 'iaLigar' : 'iaDesligar').catch(() => undefined)
    setSt(await chamar<StatusIA>('iaStatus').catch(() => st))
    setMudando(false)
  }
  return (
    <div className="mini-cartao" title="Com a IA desligada, a placa de vídeo e a RAM do PC secundário ficam livres para os navegadores.">
      <div className="linha" style={{ justifyContent: 'space-between', fontSize: 13, flexWrap: 'nowrap' }}>
        <span className="linha" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <span className="pontinho" style={{ background: desligada ? 'var(--amarelo)' : st.conectado ? 'var(--verde)' : 'var(--vermelho)' }} />
          <strong>IA {desligada ? 'desligada' : st.conectado ? 'ligada' : 'sem ComfyUI'}</strong>
        </span>
      </div>
      {desligada && <span className="dica">{st.desligada === 'navegadores' ? 'Navegadores abertos: liga sozinha quando fecharem' : 'Desligada por você'}</span>}
      <button className={`btn pequeno ${desligada ? 'primario' : ''}`} style={{ marginTop: 4 }} disabled={mudando} onClick={trocar}>
        {mudando ? 'Aguarde…' : desligada ? 'Ligar a IA' : 'Desligar a IA'}
      </button>
      <label className="linha" style={{ gap: 6, fontSize: 11, color: 'var(--texto-2)', cursor: 'pointer', flexWrap: 'nowrap' }}>
        <input type="checkbox" checked={st.autoDesligar !== false} onChange={(e) => chamar('iaAutoDesligar', e.target.checked).then(() => setSt({ ...st, autoDesligar: e.target.checked }))} />
        Desligar sozinha com navegadores
      </label>
    </div>
  )
}
