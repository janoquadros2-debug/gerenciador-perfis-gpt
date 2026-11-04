import { useEffect, useMemo, useState } from 'react'
import type { EstadoMotor, OpcoesCriacaoMassa, Perfil, ProgressoCriacao } from '../../../shared/types'
import { chamar, ouvir, useConfig } from '../api'
import { avisar, confirmar } from '../confirmar'
import { Modal, Opcao, corDoNumero } from '../componentes'
import { contarPorSistema } from '../../../shared/sorteio'

export function Perfis({ estado }: { estado: EstadoMotor | null }) {
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState<string>('Todos')
  const [busca, setBusca] = useState('')
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<Perfil | null>(null)
  const [limpando, setLimpando] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    chamar<Perfil[]>('listarPerfis')
      .then(setPerfis)
      .catch((e) => setErro(String(e.message ?? e).replace(/^Error invoking remote method 'chamar': Error: /, '')))
      .finally(() => setCarregando(false))
  }
  useEffect(carregar, [])

  const abertos = new Map((estado?.navegadores ?? []).map((n) => [n.perfilId, n]))
  const etiquetas = useMemo(() => [...new Set(perfis.flatMap((p) => p.etiquetas))].sort(), [perfis])

  const visiveis = perfis.filter((p) => {
    if (busca && !p.nome.toLowerCase().includes(busca.toLowerCase())) return false
    if (filtro === 'Abertos') return abertos.has(p.id)
    if (filtro === 'Sem etiqueta') return p.etiquetas.length === 0
    if (filtro !== 'Todos') return p.etiquetas.includes(filtro)
    return true
  })

  const alternar = (id: number) => {
    const s = new Set(selecionados)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelecionados(s)
  }

  const abrir = (ids: number[]) => chamar('abrirPerfis', ids)
  const fechar = (perfilId: number) => {
    const n = abertos.get(perfilId)
    if (n) chamar('encerrar', [n.slot])
  }
  const apagar = async () => {
    if (!(await confirmar(`Apagar ${selecionados.size} perfis do Dolphin? Isso não pode ser desfeito.`, { perigo: true }))) return
    const erros = await chamar<string[]>('apagarPerfis', [...selecionados])
    if (erros.length) await avisar(erros.join('\n'), 'Alguns perfis não foram apagados')
    setSelecionados(new Set())
    carregar()
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Perfis</h1>
          <p className="sub">
            {perfis.length} perfis · {estado?.navegadores.length ?? 0} abertos agora
          </p>
        </div>
        <div className="linha">
          <input className="solto" type="search" placeholder="Buscar perfil" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar perfil" />
          <button className="btn" onClick={carregar}>Atualizar lista</button>
          <button className="btn primario" onClick={() => setCriando(true)}>Criar em massa</button>
        </div>
      </div>

      {erro && <div className="aviso">{erro}</div>}

      <div className="linha">
        {['Todos', ...etiquetas, 'Sem etiqueta', 'Abertos'].map((f) => (
          <button key={f} className={`pilula ${filtro === f ? 'ativa' : ''}`} onClick={() => setFiltro(f)}>
            {f}
          </button>
        ))}
        <span className="espaco" />
        <button className="btn perigo" disabled={!perfis.length} onClick={() => setLimpando(true)}>Limpar perfis</button>
      </div>

      {selecionados.size > 0 && (
        <div className="aviso linha">
          <strong>{selecionados.size} selecionados</strong>
          <span className="espaco" />
          <button className="btn pequeno primario" onClick={() => abrir([...selecionados])}>Abrir</button>
          <button className="btn pequeno" onClick={() => setSelecionados(new Set())}>Limpar seleção</button>
          <button className="btn pequeno perigo" onClick={apagar}>Apagar</button>
        </div>
      )}

      <div className="painel sem-padding">
        <div className="tabela-caixa">
          <table>
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={visiveis.length > 0 && visiveis.every((p) => selecionados.has(p.id))}
                    onChange={(e) => setSelecionados(e.target.checked ? new Set(visiveis.map((p) => p.id)) : new Set())}
                  />
                </th>
                <th>Nome</th>
                <th>Etiquetas</th>
                <th>Proxy</th>
                <th>Site ao abrir</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => {
                const n = abertos.get(p.id)
                return (
                  <tr key={p.id}>
                    <td><input type="checkbox" aria-label={`Selecionar ${p.nome}`} checked={selecionados.has(p.id)} onChange={() => alternar(p.id)} /></td>
                    <td>
                      <span className="linha" style={{ gap: 10 }}>
                        <span className="avatar" style={{ width: 30, height: 30, borderRadius: 8, fontSize: 12, background: corDoNumero(p.id) }}>
                          {p.nome.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{p.nome}</strong>
                      </span>
                    </td>
                    <td className="dica">{p.etiquetas.join(', ') || '—'}</td>
                    <td className="mono">{p.proxyTexto ?? 'Sem proxy'}</td>
                    <td className="dica">{p.site || 'Padrão'}</td>
                    <td>
                      {n ? <span className={`selo ${n.status === 'ok' ? 'ok' : n.status === 'erro' ? 'erro' : 'abrindo'}`}>#{n.slot} {n.status === 'ok' ? 'Aberto' : n.status === 'erro' ? 'Erro' : 'Abrindo'}</span> : <span className="selo neutro">Parado</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="linha" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn pequeno" onClick={() => setEditando(p)}>Editar</button>
                        {n ? (
                          <button className="btn pequeno" onClick={() => fechar(p.id)}>Fechar</button>
                        ) : (
                          <button className="btn pequeno primario" onClick={() => abrir([p.id])}>Abrir</button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!carregando && visiveis.length === 0 && <div className="vazio">Nenhum perfil aqui.</div>}
          {carregando && <div className="vazio">Carregando perfis do Dolphin…</div>}
        </div>
      </div>

      {criando && <CriarEmMassa total={perfis.length} aoFechar={() => { setCriando(false); carregar() }} />}
      {editando && <EditarPerfil perfil={editando} aoFechar={() => { setEditando(null); carregar() }} />}
      {limpando && (
        <LimparPerfis
          todos={perfis}
          visiveis={visiveis}
          filtro={filtro}
          aoFechar={() => { setLimpando(false); setSelecionados(new Set()); carregar() }}
        />
      )}
    </>
  )
}

function LimparPerfis({ todos, visiveis, filtro, aoFechar }: { todos: Perfil[]; visiveis: Perfil[]; filtro: string; aoFechar: () => void }) {
  const filtrado = filtro !== 'Todos' && visiveis.length !== todos.length
  const [quais, setQuais] = useState<'filtro' | 'todos'>(filtrado ? 'filtro' : 'todos')
  const [texto, setTexto] = useState('')
  const [apagando, setApagando] = useState(false)
  const [erros, setErros] = useState<string[] | null>(null)
  const alvo = quais === 'filtro' ? visiveis : todos

  const apagar = async () => {
    setApagando(true)
    setErros(await chamar<string[]>('apagarPerfis', alvo.map((p) => p.id)).finally(() => setApagando(false)))
  }

  return (
    <Modal titulo="Limpar perfis" sub="Apaga os perfis do Dolphin. Isso não pode ser desfeito." aoFechar={() => !apagando && aoFechar()}>
      <div className="escolhas">
        {filtrado && (
          <label className={`escolha ${quais === 'filtro' ? 'marcada' : ''}`}>
            <input type="radio" checked={quais === 'filtro'} onChange={() => setQuais('filtro')} />
            Só os do filtro "{filtro}" ({visiveis.length})
          </label>
        )}
        <label className={`escolha ${quais === 'todos' ? 'marcada' : ''}`}>
          <input type="radio" checked={quais === 'todos'} onChange={() => setQuais('todos')} />
          Todos os perfis ({todos.length})
        </label>
      </div>
      {quais === 'todos' && <div className="aviso" style={{ color: 'var(--amarelo)' }}>Isso inclui os canais da Twitch e qualquer outro perfil da sua conta.</div>}
      <label className="campo">
        Para confirmar, digite APAGAR
        <input value={texto} onChange={(e) => setTexto(e.target.value)} disabled={apagando || erros !== null} />
      </label>
      {apagando && <div className="aviso">Apagando {alvo.length} perfis…</div>}
      {erros !== null && (
        <div className="aviso">
          {erros.length ? `Terminou com ${erros.length} erros: ${erros.slice(0, 3).join(' · ')}` : `Pronto! ${alvo.length} perfis apagados.`}
        </div>
      )}
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" disabled={apagando} onClick={aoFechar}>{erros !== null ? 'Fechar' : 'Cancelar'}</button>
        {erros === null && (
          <button className="btn perigo" disabled={apagando || texto.trim().toUpperCase() !== 'APAGAR' || !alvo.length} onClick={apagar}>
            Apagar {alvo.length} perfis
          </button>
        )}
      </div>
    </Modal>
  )
}

function EditarPerfil({ perfil, aoFechar }: { perfil: Perfil; aoFechar: () => void }) {
  const [site, setSite] = useState(perfil.site ?? '')
  return (
    <Modal titulo={perfil.nome} sub="Ajustes deste perfil" aoFechar={aoFechar}>
      <label className="campo">
        Site ao abrir (vazio = usa o padrão das Configurações)
        <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://..." />
      </label>
      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={aoFechar}>Cancelar</button>
        <button className="btn primario" onClick={async () => { await chamar('definirSite', perfil.id, site.trim()); aoFechar() }}>Salvar</button>
      </div>
    </Modal>
  )
}

const LIMITE_PLANO = 100

function CriarEmMassa({ total, aoFechar }: { total: number; aoFechar: () => void }) {
  const [cfg, salvarCfg] = useConfig()
  const [o, setO] = useState<OpcoesCriacaoMassa>({
    quantidade: 10, nomeBase: 'Teste', comecarDe: 1, modoProxy: 'nenhum', tipoProxy: 'http', etiqueta: 'Testes', sistema: 'windows', listaProxies: '', proxyUnico: '', site: ''
  })
  const [prog, setProg] = useState<ProgressoCriacao | null>(null)
  useEffect(() => ouvir('progresso-criacao', setProg), [])
  const muda = (p: Partial<OpcoesCriacaoMassa>) => setO({ ...o, ...p })

  const depois = total + o.quantidade
  const passa = depois - LIMITE_PLANO
  const qtdProxies = (o.listaProxies ?? '').split(/\r?\n/).filter((l) => l.trim()).length
  const criando = prog !== null && !prog.terminou
  const porc = o.porcentagens ?? { windows: 70, macos: 20, linux: 10 }
  const somaPorc = porc.windows + porc.macos + porc.linux
  const previa = contarPorSistema(o.quantidade, porc)
  const porcInvalida = o.sistema === 'sorteado' && somaPorc !== 100
  const tempo = o.tempoAberto ?? { modo: 'sem-limite' as const, minutos: 10, de: 5, ate: 15 }
  const tempoInvalido = tempo.modo === 'aleatorio' && tempo.de > tempo.ate
  const f5 = o.recarregar ?? { modo: 'sem-limite' as const, minutos: 5, de: 3, ate: 5 }
  const f5Invalido = f5.modo === 'aleatorio' && f5.de > f5.ate

  return (
    <Modal titulo="Criar perfis em massa" sub="Os perfis são criados direto no seu Dolphin Anty." aoFechar={() => !criando && aoFechar()}>
      <div className="grade-campos">
        <label className="campo">Quantidade<input type="number" min={1} max={LIMITE_PLANO} value={o.quantidade} onChange={(e) => muda({ quantidade: Math.max(1, Number(e.target.value)) })} /></label>
        <label className="campo">Nome base<input value={o.nomeBase} onChange={(e) => muda({ nomeBase: e.target.value })} /></label>
        <label className="campo">Começar do número<input type="number" min={1} value={o.comecarDe} onChange={(e) => muda({ comecarDe: Math.max(1, Number(e.target.value)) })} /></label>
      </div>
      <div className="aviso">
        Vai criar: <strong>{o.nomeBase} {o.comecarDe}</strong>, <strong>{o.nomeBase} {o.comecarDe + 1}</strong> … <strong>{o.nomeBase} {o.comecarDe + o.quantidade - 1}</strong>
      </div>

      <div className="campo">
        Proxy
        <div className="escolhas">
          {([['nenhum', 'Sem proxy'], ['mesmo', 'Mesmo para todos'], ['lista', 'Lista (1 por perfil)']] as const).map(([v, t]) => (
            <label key={v} className={`escolha ${o.modoProxy === v ? 'marcada' : ''}`}>
              <input type="radio" name="modoProxy" checked={o.modoProxy === v} onChange={() => muda({ modoProxy: v })} />
              {t}
            </label>
          ))}
        </div>
      </div>
      {o.modoProxy !== 'nenhum' && (
        <label className="campo">
          Tipo
          <select value={o.tipoProxy} onChange={(e) => muda({ tipoProxy: e.target.value as OpcoesCriacaoMassa['tipoProxy'] })}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
      )}
      {o.modoProxy === 'mesmo' && (
        <label className="campo">Proxy<input className="mono" placeholder="ip:porta:usuario:senha" value={o.proxyUnico} onChange={(e) => muda({ proxyUnico: e.target.value })} /></label>
      )}
      {o.modoProxy === 'lista' && (
        <label className="campo">
          Cole os proxies, um por linha
          <textarea rows={5} placeholder="ip:porta:usuario:senha" value={o.listaProxies} onChange={(e) => muda({ listaProxies: e.target.value })} />
          <span className="dica">
            {qtdProxies} proxies para {o.quantidade} perfis{qtdProxies && qtdProxies < o.quantidade ? ': a lista será reutilizada em sequência.' : '.'}
          </span>
        </label>
      )}

      <div className="grade-campos">
        <label className="campo">Etiqueta<input value={o.etiqueta} onChange={(e) => muda({ etiqueta: e.target.value })} /></label>
        <label className="campo">
          Sistema simulado
          <select value={o.sistema} onChange={(e) => muda({ sistema: e.target.value as OpcoesCriacaoMassa['sistema'] })}>
            <option value="windows">Windows</option>
            <option value="macos">macOS</option>
            <option value="linux">Linux</option>
            <option value="sorteado">Sortear (por porcentagem)</option>
          </select>
        </label>
        <label className="campo">Site ao abrir<input placeholder={cfg?.siteInicial ?? 'Padrão'} value={o.site} onChange={(e) => muda({ site: e.target.value })} /></label>
        <label className="campo">
          Privacidade do perfil
          <select value={o.privacidade ?? 'anonimo'} onChange={(e) => muda({ privacidade: e.target.value as OpcoesCriacaoMassa['privacidade'] })}>
            <option value="anonimo">Mais anônimo (recomendado)</option>
            <option value="padrao">Padrão (como antes)</option>
          </select>
        </label>
      </div>
      <label className="linha" style={{ gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={cfg?.manterAtivas !== false} onChange={(e) => salvarCfg({ manterAtivas: e.target.checked })} style={{ marginTop: 3 }} />
        <span>
          Manter todas as janelas ativas, mesmo cobertas
          <br />
          <span className="dica">Janelas atrás de outras ou minimizadas continuam rodando como se estivessem na frente (o vídeo não pausa nem baixa a qualidade). Usa um pouco mais de CPU e placa de vídeo. Vale para todos os navegadores que o programa abrir.</span>
        </span>
      </label>

      <div className="campo">
        Aviso de cookies (quando um site perguntar)
        <div className="escolhas">
          {([['aceitar', 'Aceitar sozinho'], ['recusar', 'Recusar sozinho'], ['desligado', 'Não mexer']] as const).map(([v, t]) => (
            <label key={v} className={`escolha ${(o.cookies ?? 'aceitar') === v ? 'marcada' : ''}`}>
              <input type="radio" name="cookies" checked={(o.cookies ?? 'aceitar') === v} onChange={() => muda({ cookies: v })} />
              {t}
            </label>
          ))}
        </div>
        <span className="dica">Vale para todas as abas do perfil. "Recusar" clica em "Rejeitar tudo" / "Só os necessários" quando o site tiver essa opção.</span>
      </div>

      <div className="campo">
        <label className="linha" style={{ gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={o.site2 !== undefined} onChange={(e) => muda({ site2: e.target.checked ? '' : undefined })} />
          Abrir também uma 2ª aba com outro link
        </label>
        {o.site2 !== undefined && (
          <>
            <input value={o.site2} onChange={(e) => muda({ site2: e.target.value })} placeholder="ex.: https://www.youtube.com" />
            <span className="dica">Cada perfil abre o site principal e, numa 2ª aba ao lado, este link. A aba principal fica na frente; o F5 automático e a verificação do site valem para a principal.</span>
          </>
        )}
      </div>
      {(o.privacidade ?? 'anonimo') === 'anonimo' && (
        <span className="dica">
          Cada perfil sai com impressão digital própria: ruído em Canvas, WebGL, Áudio e Client Rects; placa de vídeo, CPU, memória e tela de um PC real; MAC e nome do PC próprios. WebRTC mostra só o IP do proxy, e fuso, idioma e localização seguem o IP do proxy.
        </span>
      )}

      {o.sistema === 'sorteado' && (
        <div className="painel" style={{ background: 'var(--campo)', padding: 16, gap: 12 }}>
          <div className="grade-campos" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {(['windows', 'macos', 'linux'] as const).map((s) => (
              <label key={s} className="campo">
                {s === 'windows' ? 'Windows' : s === 'macos' ? 'macOS' : 'Linux'} (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={porc[s]}
                  onChange={(e) => muda({ porcentagens: { ...porc, [s]: Math.min(100, Math.max(0, Number(e.target.value))) } })}
                />
              </label>
            ))}
          </div>
          {somaPorc === 100 ? (
            <span className="dica">
              Para {o.quantidade} perfis: <strong>{previa.windows} Windows</strong>, <strong>{previa.macos} macOS</strong> e <strong>{previa.linux} Linux</strong>, em ordem sorteada.
            </span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--amarelo)' }}>A soma está em {somaPorc}%. Ajuste para dar 100%.</span>
          )}
        </div>
      )}

      <div className="campo">
        Tempo aberto (cada perfil fecha sozinho quando o tempo acabar)
        <div className="escolhas">
          {([['sem-limite', 'Sem limite'], ['fixo', 'Tempo fixo'], ['aleatorio', 'Aleatório']] as const).map(([v, t]) => (
            <label key={v} className={`escolha ${tempo.modo === v ? 'marcada' : ''}`}>
              <input type="radio" name="tempoAberto" checked={tempo.modo === v} onChange={() => muda({ tempoAberto: { ...tempo, modo: v } })} />
              {t}
            </label>
          ))}
        </div>
      </div>
      {tempo.modo === 'fixo' && (
        <label className="campo">
          Minutos aberto
          <input type="number" min={1} value={tempo.minutos} onChange={(e) => muda({ tempoAberto: { ...tempo, minutos: Math.max(1, Number(e.target.value)) } })} style={{ width: 140 }} />
          <span className="dica">Cada perfil fica aberto {tempo.minutos} min e depois fecha.</span>
        </label>
      )}
      {tempo.modo === 'aleatorio' && (
        <div className="campo">
          Entre quantos minutos
          <span className="linha" style={{ gap: 8 }}>
            <input className="solto" type="number" min={1} value={tempo.de} onChange={(e) => muda({ tempoAberto: { ...tempo, de: Math.max(1, Number(e.target.value)) } })} style={{ width: 100 }} aria-label="Mínimo em minutos" />
            <span>até</span>
            <input className="solto" type="number" min={1} value={tempo.ate} onChange={(e) => muda({ tempoAberto: { ...tempo, ate: Math.max(1, Number(e.target.value)) } })} style={{ width: 100 }} aria-label="Máximo em minutos" />
            <span>minutos</span>
          </span>
          {tempoInvalido ? (
            <span style={{ fontSize: 13, color: 'var(--amarelo)' }}>O primeiro número precisa ser menor ou igual ao segundo.</span>
          ) : (
            <span className="dica">Cada perfil sorteia o seu tempo: alguns fecham perto de {tempo.de} min, outros perto de {tempo.ate} min.</span>
          )}
        </div>
      )}
      {tempo.modo !== 'sem-limite' && (
        <div className="campo">
          Quando o tempo acabar
          <div className="escolhas">
            {([['reabrir', 'Fechar e abrir de novo'], ['fechar', 'Só fechar']] as const).map(([v, t]) => (
              <label key={v} className={`escolha ${(o.aoAcabar ?? 'reabrir') === v ? 'marcada' : ''}`}>
                <input type="radio" name="aoAcabar" checked={(o.aoAcabar ?? 'reabrir') === v} onChange={() => muda({ aoAcabar: v })} />
                {t}
              </label>
            ))}
          </div>
          {(o.aoAcabar ?? 'reabrir') === 'reabrir' && <span className="dica">Fecha, espera 3 s e abre o mesmo perfil no mesmo lugar, com o mesmo proxy e um tempo novo{tempo.modo === 'aleatorio' ? ' sorteado' : ''}. Fica nesse ciclo até você encerrar ou pausar.</span>}
        </div>
      )}
      {tempo.modo !== 'sem-limite' && (
        <span className="dica">
          {o.abrirAoCriar ? 'Vale para os perfis desta criação' : 'Ligue "Já abrir os perfis depois de criar" para valer nesta criação'} e para os criados pelo +1 / Adicionar da aba Ao vivo.
        </span>
      )}

      <div className="campo">
        F5 automático (recarrega a página sozinho de tempos em tempos)
        <div className="escolhas">
          {([['sem-limite', 'Desligado'], ['fixo', 'Tempo fixo'], ['aleatorio', 'Aleatório']] as const).map(([v, t]) => (
            <label key={v} className={`escolha ${f5.modo === v ? 'marcada' : ''}`}>
              <input type="radio" name="recarregar" checked={f5.modo === v} onChange={() => muda({ recarregar: { ...f5, modo: v } })} />
              {t}
            </label>
          ))}
        </div>
      </div>
      {f5.modo === 'fixo' && (
        <label className="campo">
          A cada quantos minutos
          <input type="number" min={1} value={f5.minutos} onChange={(e) => muda({ recarregar: { ...f5, minutos: Math.max(1, Number(e.target.value)) } })} style={{ width: 140 }} />
          <span className="dica">Cada perfil dá F5 a cada {f5.minutos} min.</span>
        </label>
      )}
      {f5.modo === 'aleatorio' && (
        <div className="campo">
          Entre quantos minutos
          <span className="linha" style={{ gap: 8 }}>
            <input className="solto" type="number" min={1} value={f5.de} onChange={(e) => muda({ recarregar: { ...f5, de: Math.max(1, Number(e.target.value)) } })} style={{ width: 100 }} aria-label="Mínimo em minutos para o F5" />
            <span>até</span>
            <input className="solto" type="number" min={1} value={f5.ate} onChange={(e) => muda({ recarregar: { ...f5, ate: Math.max(1, Number(e.target.value)) } })} style={{ width: 100 }} aria-label="Máximo em minutos para o F5" />
            <span>minutos</span>
          </span>
          {f5Invalido ? (
            <span style={{ fontSize: 13, color: 'var(--amarelo)' }}>O primeiro número precisa ser menor ou igual ao segundo.</span>
          ) : (
            <span className="dica">Cada perfil sorteia um tempo novo a cada F5, entre {f5.de} e {f5.ate} min (ao segundo): nenhum recarrega junto com o outro.</span>
          )}
        </div>
      )}

      <div className="painel" style={{ background: 'var(--campo)', padding: '4px 16px', gap: 0 }}>
        <Opcao
          titulo="Já abrir os perfis depois de criar"
          desc="Cada perfil abre assim que é criado, respeitando o limitador de RAM e o organizador de janelas."
          ligada={!!o.abrirAoCriar}
          aoMudar={(v) => muda({ abrirAoCriar: v })}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="linha" style={{ justifyContent: 'space-between', fontSize: 13 }}>
          <span className="dica">Uso do plano depois de criar</span>
          <strong>{total} → {depois} de {LIMITE_PLANO}</strong>
        </div>
        <div className="barra"><div style={{ width: `${Math.min(100, (depois / LIMITE_PLANO) * 100)}%`, background: passa > 0 ? '#F59E0B' : undefined }} /></div>
        {passa > 0 && <span style={{ color: 'var(--amarelo)', fontSize: 13 }}>Passa do limite em {passa}. Diminua para {Math.max(0, LIMITE_PLANO - total)} ou apague perfis antigos.</span>}
      </div>

      {prog && (
        <div className="aviso">
          {prog.terminou ? 'Pronto!' : 'Criando'} {prog.feitos} de {prog.total}
          {prog.pulados ? ` · ${prog.pulados} já existiam e foram pulados` : ''}
          {prog.terminou && prog.erros.length ? ` · ${prog.erros.length} falharam (clique em Criar de novo para tentar só esses)` : ''}
          <div className="barra" style={{ marginTop: 8 }}><div style={{ width: `${(prog.feitos / prog.total) * 100}%` }} /></div>
          {prog.erros.length > 0 && <div style={{ marginTop: 8, color: '#ffb3c1' }}>{prog.erros.slice(-3).join(' · ')}</div>}
        </div>
      )}

      <div className="linha" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" disabled={criando} onClick={aoFechar}>{prog?.terminou ? 'Fechar' : 'Cancelar'}</button>
        {passa > 0 ? (
          <button className="btn primario" onClick={() => muda({ quantidade: Math.max(1, LIMITE_PLANO - total) })}>Ajustar para {Math.max(0, LIMITE_PLANO - total)}</button>
        ) : (
          <button className="btn primario" disabled={criando || !o.nomeBase.trim() || porcInvalida || tempoInvalido || f5Invalido} onClick={() => { setProg({ feitos: 0, total: o.quantidade, erros: [], terminou: false }); chamar('criarEmMassa', { ...o, porcentagens: porc, tempoAberto: tempo, recarregar: f5, cookies: o.cookies ?? 'aceitar', aoAcabar: o.aoAcabar ?? 'reabrir' }) }}>
            {o.abrirAoCriar ? 'Criar e abrir' : 'Criar'} {o.quantidade} perfis
          </button>
        )}
      </div>
    </Modal>
  )
}
