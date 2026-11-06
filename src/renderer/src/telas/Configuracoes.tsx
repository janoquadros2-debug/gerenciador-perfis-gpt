import { lazy, Suspense, useEffect, useState } from 'react'
import { chamar, formatarGB, useConfig, useEstado, useRede } from '../api'
import { PcSecundario } from './PcSecundario'
import { RecursosExtras } from './RecursosExtras'
import { Opcao } from '../componentes'

type Aba = 'execucao' | 'dolphin' | 'pc2' | 'comfy' | 'geral' | 'extras'

const ConfigComfy = __EDICAO__ === 'completa' ? lazy(() => import('./ia/ConfigComfy')) : null

export function Configuracoes({ abaInicial }: { abaInicial?: string }) {
  const [cfg, salvar] = useConfig()
  const estado = useEstado()
  const [aba, setAba] = useState<Aba>((abaInicial as Aba) ?? 'execucao')
  useEffect(() => {
    if (abaInicial) setAba(abaInicial as Aba)
  }, [abaInicial])
  const rede = useRede()
  const [teste, setTeste] = useState<{ nuvem: boolean; local: boolean; erro?: string } | null>(null)
  const [testando, setTestando] = useState(false)
  if (!cfg) return null

  const abas: [Aba, string][] = [['execucao', 'Execução'], ['dolphin', 'Dolphin Anty'], ['pc2', 'PC secundário'], ['comfy', 'ComfyUI'], ['geral', 'Geral'], ['extras', 'Novos recursos']].filter(
    ([v]) => (v !== 'pc2' && v !== 'comfy') || (rede?.edicao === 'completa' && (v !== 'comfy' || !!ConfigComfy))
  ) as [Aba, string][]

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Configurações</h1>
          <p className="sub">Tudo salva sozinho ao mudar.</p>
        </div>
      </div>
      <div className="linha">
        {abas.map(([v, t]) => (
          <button key={v} className={`pilula ${aba === v ? 'ativa' : ''}`} onClick={() => setAba(v)}>{t}</button>
        ))}
      </div>

      {aba === 'execucao' && (
        <>
          <section className="painel">
            <label className="campo">
              Site ao abrir os navegadores
              <input value={cfg.siteInicial} onChange={(e) => salvar({ siteInicial: e.target.value })} />
            </label>
            <span className="dica">Perfis com site próprio continuam abrindo no deles.</span>
          </section>
          <section className="painel" style={{ gap: 0, paddingTop: 6, paddingBottom: 6 }}>
            <Opcao titulo="Conferir o IP de cada perfil" desc="Ao abrir, verifica o IP de saída e o país e mostra na aba Ao vivo." ligada={cfg.conferirIp} aoMudar={(v) => salvar({ conferirIp: v })} />
            <Opcao titulo="Testar proxy antes de abrir" desc="Desligado: os perfis abrem direto, sem esperar teste." ligada={cfg.testarProxyAntes} aoMudar={(v) => salvar({ testarProxyAntes: v })} />
            <Opcao
              titulo="Manter todas as janelas ativas, mesmo cobertas"
              desc="Evita a economia de recursos do Chrome quando uma janela está atrás de outra ou minimizada. Pode aumentar o uso de CPU e GPU. Aplica-se aos navegadores abertos pelo programa; para perfis já abertos, feche e abra novamente."
              ligada={cfg.manterAtivas !== false}
              aoMudar={(v) => salvar({ manterAtivas: v })}
            />
            <div className="opcao" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label className="campo">
                Navegadores abrindo ao mesmo tempo
                <select className="solto" value={cfg.aberturasSimultaneas ?? 2} onChange={(e) => salvar({ aberturasSimultaneas: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="campo">
                Intervalo entre aberturas
                <select className="solto" value={cfg.intervaloEntreAberturasMs ?? 1500} onChange={(e) => salvar({ intervaloEntreAberturasMs: Number(e.target.value) })}>
                  <option value={0}>Sem intervalo</option>
                  <option value={1000}>1 segundo</option>
                  <option value={1500}>1,5 segundo</option>
                  <option value={3000}>3 segundos</option>
                  <option value={5000}>5 segundos</option>
                </select>
              </label>
            </div>
            <Opcao titulo="Reorganizar janelas após cada grupo de cinco aberturas" desc="Reposiciona as janelas ao concluir um grupo. Em grades lotadas, janelas extras podem continuar parcialmente sobrepostas." ligada={cfg.reorganizarAposLote !== false} aoMudar={(v) => salvar({ reorganizarAposLote: v })} />
            <Opcao titulo="Diagnóstico de reprodução de vídeos" desc="Verifica passivamente se o tempo do player avança. Mostra estado inconclusivo quando não há evidência suficiente. Não inicia reprodução." ligada={cfg.diagnosticoReproducao !== false} aoMudar={(v) => salvar({ diagnosticoReproducao: v })} />
            <Opcao titulo="Recuperação limitada de carregamento travado" desc="Depois de confirmar buffering por pelo menos 45 s, tenta atualizar a página até duas vezes, com intervalo mínimo de 60 s. Não interfere quando há anúncio ou vídeo pausado. Depois solicita intervenção." ligada={cfg.recuperarTravamento !== false} aoMudar={(v) => salvar({ recuperarTravamento: v })} />
            <div className="opcao">
              <label className="campo">
                Preferência de cookies para perfis existentes
                <select className="solto" value={cfg.cookiesPadrao ?? 'recusar'} onChange={(e) => salvar({ cookiesPadrao: e.target.value as 'aceitar' | 'recusar' | 'desligado' })}>
                  <option value="recusar">Recusar quando disponível</option>
                  <option value="aceitar">Aceitar quando disponível</option>
                  <option value="desligado">Não interferir</option>
                </select>
              </label>
            </div>
            <Opcao titulo="Organizar janelas ao abrir" desc="Usa a grade definida na aba Janelas." ligada={cfg.janelas.ativo} aoMudar={(v) => salvar({ janelas: { ...cfg.janelas, ativo: v } })} />
            <Opcao titulo="Reabrir se fechar ou cair" desc={`Tenta até ${cfg.tentativasReabrir} vezes. Navegadores que você encerrar não são reabertos.`} ligada={cfg.reabrirSeCair} aoMudar={(v) => salvar({ reabrirSeCair: v })} />
            {cfg.reabrirSeCair && (
              <div className="opcao">
                <div className="opcao-titulo">Tentativas de reabrir</div>
                <input className="solto" type="number" min={1} max={20} value={cfg.tentativasReabrir} onChange={(e) => salvar({ tentativasReabrir: Math.max(1, Number(e.target.value)) })} style={{ width: 90 }} aria-label="Tentativas de reabrir" />
              </div>
            )}
          </section>
          <section className="painel">
            <Opcao titulo="Limitador de memória RAM" desc="Para de abrir navegadores quando o PC chegar ao limite." ligada={cfg.limitadorRam} aoMudar={(v) => salvar({ limitadorRam: v })} />
            <Opcao titulo="Limpar a RAM sozinho ao chegar no limite" desc="Antes de esperar, tenta liberar memória (no máximo 1 vez por minuto). Você também pode usar o botão Limpar RAM no menu." ligada={cfg.limparRamAuto} aoMudar={(v) => salvar({ limparRamAuto: v })} />
            <label className="campo">
              <span className="linha" style={{ justifyContent: 'space-between' }}>
                <span>Limite</span>
                <strong style={{ fontFamily: 'var(--titulo)', fontSize: 20, color: 'var(--texto)' }}>{cfg.limiteRam}%</strong>
              </span>
              <input type="range" min={50} max={98} value={cfg.limiteRam} onChange={(e) => salvar({ limiteRam: Number(e.target.value) })} style={{ height: 'auto', padding: 0, border: 0, background: 'transparent', accentColor: 'var(--roxo)' }} />
            </label>
            {estado && (
              <span className="dica">
                Uso agora: {estado.ram.porcentagem}% ({formatarGB(estado.ram.usada)} de {formatarGB(estado.ram.total)})
              </span>
            )}
          </section>
        </>
      )}

      {aba === 'dolphin' && (
        <section className="painel">
          <h2>Conexão com o Dolphin Anty</h2>
          <label className="campo">
            Token da API
            <input type="password" value={cfg.tokenDolphin} onChange={(e) => salvar({ tokenDolphin: e.target.value.trim() })} placeholder="Cole aqui o token gerado no painel do Dolphin" />
          </label>
          <label className="campo">
            Porta local do Dolphin (normalmente 3001)
            <input type="number" value={cfg.portaLocalDolphin} onChange={(e) => salvar({ portaLocalDolphin: Number(e.target.value) || 3001 })} style={{ width: 140 }} />
          </label>
          <div className="linha">
            <button className="btn primario" disabled={testando} onClick={async () => { setTestando(true); setTeste(await chamar('testarDolphin').finally(() => setTestando(false))) }}>
              {testando ? 'Testando…' : 'Testar conexão'}
            </button>
            {teste && (
              <>
                <span className={`selo ${teste.nuvem ? 'ok' : 'erro'}`}>Conta: {teste.nuvem ? 'ok' : 'falhou'}</span>
                <span className={`selo ${teste.local ? 'ok' : 'erro'}`}>Dolphin aberto no PC: {teste.local ? 'ok' : 'não encontrado'}</span>
              </>
            )}
          </div>
          {teste?.erro && <div className="aviso">{teste.erro}</div>}
          <div className="dica" style={{ lineHeight: 1.7 }}>
            Como pegar o token: abra o Dolphin Anty, entre no seu painel pelo site, vá na área de <strong>API</strong>, gere um token novo e copie. Ele aparece uma vez só, então guarde num lugar seguro.
          </div>
        </section>
      )}

      {aba === 'pc2' && <PcSecundario status={rede} />}
      {aba === 'comfy' && ConfigComfy && (
        <Suspense fallback={<div className="vazio">Carregando…</div>}>
          <ConfigComfy />
        </Suspense>
      )}

      {aba === 'extras' && <RecursosExtras />}

      {aba === 'geral' && (
        <section className="painel" style={{ gap: 0, paddingTop: 6, paddingBottom: 6 }}>
          <Opcao titulo="Iniciar com o Windows" desc="O app abre sozinho quando você liga o PC." ligada={cfg.iniciarComWindows} aoMudar={(v) => salvar({ iniciarComWindows: v })} />
          <Opcao titulo="Fechar todos os navegadores ao sair" desc="Evita deixar navegadores abertos esquecidos." ligada={cfg.fecharTodosAoSair} aoMudar={(v) => salvar({ fecharTodosAoSair: v })} />
          <Opcao
            titulo="Apagar perfis ao fechar o programa"
            desc="Apaga do Dolphin os perfis da etiqueta abaixo sempre que você fechar o programa. Não dá para desfazer."
            ligada={cfg.apagarAoSair}
            aoMudar={(v) => salvar({ apagarAoSair: v })}
          />
          {cfg.apagarAoSair && (
            <div className="opcao" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
              <label className="campo" style={{ width: '100%' }}>
                Apagar só os perfis com a etiqueta
                <input value={cfg.etiquetaApagarAoSair} onChange={(e) => salvar({ etiquetaApagarAoSair: e.target.value })} placeholder="Deixe vazio para apagar TODOS" />
              </label>
              <span style={{ fontSize: 13, color: cfg.etiquetaApagarAoSair.trim() ? 'var(--texto-3)' : 'var(--amarelo)' }}>
                {cfg.etiquetaApagarAoSair.trim()
                  ? `Ao fechar, serão apagados os perfis com a etiqueta "${cfg.etiquetaApagarAoSair.trim()}". Os outros (como os canais da Twitch) ficam.`
                  : 'Atenção: com o campo vazio, TODOS os perfis serão apagados ao fechar, inclusive os canais da Twitch.'}
              </span>
            </div>
          )}
        </section>
      )}
    </>
  )
}
