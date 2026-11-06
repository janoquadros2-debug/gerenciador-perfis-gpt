import { useEffect, useState } from 'react'
import type { ModoDistribuicao, Proxy } from '../../../shared/types'
import { chamar, ouvir, useConfig } from '../api'
import { Opcao } from '../componentes'
import { confirmar } from '../confirmar'

const MODOS: [ModoDistribuicao, string, string][] = [
  ['sequencia', 'Em sequência', 'Perfil 1 usa o proxy 1, perfil 2 o proxy 2…'],
  ['sorteado', 'Sorteado', 'Cada perfil recebe um proxy aleatório.'],
  ['sem-repetir', 'Sem repetir', 'Em ordem, sem usar o mesmo duas vezes.'],
  ['sorteado-sem-repetir', 'Sorteado sem repetir', 'Aleatório, sem usar o mesmo duas vezes.']
]

export function Proxies({ esgotados }: { esgotados: boolean }) {
  const [cfg, salvar] = useConfig()
  const [lista, setLista] = useState<Proxy[]>([])
  const [texto, setTexto] = useState('')
  const [testando, setTestando] = useState(false)

  useEffect(() => {
    chamar<Proxy[]>('proxies').then(setLista)
    return ouvir('proxies', setLista)
  }, [])
  if (!cfg) return null

  const ok = lista.filter((p) => p.ultimoTeste?.ok)
  const falhou = lista.filter((p) => p.ultimoTeste && !p.ultimoTeste.ok)

  const adicionar = async () => {
    if (!texto.trim()) return
    setLista(await chamar('adicionarProxies', texto))
    setTexto('')
  }
  const testar = async (ids?: string[]) => {
    setTestando(true)
    setLista(await chamar('testarProxies', ids).finally(() => setTestando(false)))
  }
  const salvarLista = async (l: Proxy[]) => setLista(await chamar('salvarProxies', l))
  const copiar = () => navigator.clipboard.writeText(ok.map((p) => `${p.host}:${p.porta}${p.usuario ? `:${p.usuario}:${p.senha ?? ''}` : ''}`).join('\n'))
  const mudarTipo = (p: Proxy, tipo: Proxy['tipo']) => salvarLista(lista.map((x) => (x.id === p.id ? { ...x, tipo } : x)))

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Proxies</h1>
          <p className="sub">{lista.length} salvos · testar é sempre opcional</p>
        </div>
      </div>

      {esgotados && (
        <div className="faixa-pausa">
          Todos os proxies já foram usados.
          <span className="espaco" />
          <button className="btn primario" onClick={() => chamar('repetirProxies')}>Repetir</button>
        </div>
      )}

      <div className="linha" style={{ alignItems: 'stretch', gap: 18 }}>
        <section className="painel" style={{ flex: '1 1 300px' }}>
          <h2>Adicionar proxies</h2>
          <label className="campo">
            Cole um por linha (ip:porta, ip:porta:usuario:senha ou tipo://usuario:senha@ip:porta)
            <textarea rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          <label className="campo">
            Tipo, quando a linha não disser
            <select value={cfg.tipoProxyPadrao} onChange={(e) => salvar({ tipoProxyPadrao: e.target.value as Proxy['tipo'] })}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </label>
          <button className="btn primario" onClick={adicionar}>Adicionar à lista</button>
        </section>

        <section className="painel" style={{ flex: '1 1 300px' }}>
          <h2>Ao abrir vários perfis</h2>
          <Opcao titulo="Usar os proxies desta lista" desc="Desligado: cada perfil usa o proxy que já está salvo nele no Dolphin." ligada={cfg.usarListaDeProxies} aoMudar={(v) => salvar({ usarListaDeProxies: v })} />
          <div className="escolhas" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {MODOS.map(([v, t, d]) => (
              <label key={v} className={`escolha ${cfg.modoDistribuicao === v ? 'marcada' : ''}`} style={{ padding: '10px 14px' }} title={d}>
                <input type="radio" checked={cfg.modoDistribuicao === v} onChange={() => salvar({ modoDistribuicao: v })} />
                <span>{t}<div className="dica" style={{ fontWeight: 400 }}>{d}</div></span>
              </label>
            ))}
          </div>
          <div className="linha">
            <button className="btn pequeno" onClick={() => chamar('repetirProxies')}>Repetir (liberar lista)</button>
            <button className="btn pequeno" onClick={async () => setLista(await chamar('zerarContagem'))}>Zerar contagem</button>
          </div>
        </section>
      </div>

      <section className="painel sem-padding">
        <div className="linha" style={{ padding: '14px 18px', borderBottom: '1px solid #20203a' }}>
          <span className="selo ok">{ok.length} funcionando</span>
          <span className="selo erro">{falhou.length} falharam</span>
          <span className="espaco" />
          <button className="btn pequeno primario" disabled={testando || !lista.length} onClick={() => testar()}>{testando ? 'Testando…' : 'Testar todos'}</button>
          <button className="btn pequeno" disabled={!ok.length} onClick={copiar}>Copiar os que funcionam</button>
          <button className="btn pequeno perigo" disabled={!falhou.length} onClick={() => salvarLista(lista.filter((p) => !falhou.includes(p)))}>Remover os que falharam</button>
          <button
            className="btn pequeno perigo"
            disabled={!lista.length}
            onClick={async () => {
              if (await confirmar(`Apagar TODOS os ${lista.length} proxies da lista? Isso não mexe nos perfis já criados.`, { perigo: true })) salvarLista([])
            }}
          >
            Apagar todos
          </button>
        </div>
        <div className="tabela-caixa">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Proxy</th>
                <th>Tipo</th>
                <th>Resultado</th>
                <th>IP</th>
                <th>Local</th>
                <th>Velocidade</th>
                <th>Usos</th>
                {cfg.recursosExtras?.historicoTestesProxy && <th>Histórico</th>}
                {cfg.recursosExtras?.validadeProxyInformativa && <th>Primeiro uso</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const t = p.ultimoTeste
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.host}:{p.porta}{p.usuario ? ` (${p.usuario})` : ''}</td>
                    <td>
                      <select className="solto" style={{ height: 34 }} value={p.tipo} onChange={(e) => mudarTipo(p, e.target.value as Proxy['tipo'])} aria-label="Tipo do proxy">
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </td>
                    <td>{t ? <span className={`selo ${t.ok ? 'ok' : 'erro'}`}>{t.ok ? 'Funcionando' : `Falhou: ${t.erro}`}</span> : <span className="selo neutro">Não testado</span>}</td>
                    <td className="mono">{t?.ip ?? '—'}</td>
                    <td>{t?.ok ? [t.cidade, t.pais].filter(Boolean).join(', ') : '—'}</td>
                    <td>{t?.ms ? `${t.ms} ms` : '—'}</td>
                    <td><strong>{p.usos}</strong></td>
                    {cfg.recursosExtras?.historicoTestesProxy && <td title={(p.historicoTestes ?? []).slice(-5).map(x=>`${new Date(x.quando).toLocaleString('pt-BR')}: ${x.ok ? 'OK' : x.erro ?? 'Falha'}`).join(' | ')}>{p.historicoTestes?.length ?? 0} registros</td>}
                    {cfg.recursosExtras?.validadeProxyInformativa && <td>{p.primeiroUsoEm ? new Date(p.primeiroUsoEm).toLocaleString('pt-BR') : 'Não registrado'}</td>}
                    <td style={{ textAlign: 'right' }}>
                      <span className="linha" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button className="btn pequeno" onClick={() => testar([p.id])}>Testar</button>
                        <button className="btn pequeno" onClick={() => salvarLista(lista.filter((x) => x.id !== p.id))}>Remover</button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!lista.length && <div className="vazio">Nenhum proxy salvo ainda.</div>}
        </div>
      </section>
    </>
  )
}
