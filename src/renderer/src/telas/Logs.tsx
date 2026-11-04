import { useEffect, useMemo, useRef, useState } from 'react'
import type { EntradaLog, NivelLog } from '../../../shared/types'
import { chamar, ouvir } from '../api'
import { Chave } from '../componentes'

const NOMES: Record<NivelLog, string> = { info: 'INFO', ok: 'OK', aviso: 'AVISO', erro: 'ERRO' }
const CLASSES: Record<NivelLog, string> = { info: 'neutro', ok: 'ok', aviso: 'abrindo', erro: 'erro' }

export function Logs() {
  const [lista, setLista] = useState<EntradaLog[]>([])
  const [nivel, setNivel] = useState<'todos' | NivelLog>('todos')
  const [origem, setOrigem] = useState('todas')
  const [busca, setBusca] = useState('')
  const [acompanhar, setAcompanhar] = useState(true)
  const [copiado, setCopiado] = useState(false)
  const caixa = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    chamar<EntradaLog[]>('logs').then((l) => setLista([...l].sort((a, b) => a.quando - b.quando || a.id - b.id)))
    return ouvir('logs', (novas: EntradaLog[]) =>
      setLista((atual) => {
        const porId = new Map(atual.map((e) => [e.id, e]))
        for (const n of novas) porId.set(n.id, n)
        return [...porId.values()].sort((a, b) => a.quando - b.quando || a.id - b.id).slice(-3000)
      })
    )
  }, [])

  const origens = useMemo(() => [...new Set(lista.map((e) => e.origem.replace(/ #\d+$/, ' #')))].sort(), [lista])
  const visiveis = lista.filter(
    (e) =>
      (nivel === 'todos' || e.nivel === nivel) &&
      (origem === 'todas' || e.origem.replace(/ #\d+$/, ' #') === origem) &&
      (!busca || `${e.origem} ${e.texto}`.toLowerCase().includes(busca.toLowerCase()))
  )
  const contar = (n: NivelLog) => lista.filter((e) => e.nivel === n).length

  // desce sozinho para o mais novo, como um terminal
  useEffect(() => {
    if (acompanhar && caixa.current) caixa.current.scrollTop = caixa.current.scrollHeight
  }, [visiveis.length, acompanhar])

  const copiar = async () => {
    const nomes = { info: 'INFO ', ok: 'OK   ', aviso: 'AVISO', erro: 'ERRO ' }
    const texto = visiveis
      .map((e) => `[${new Date(e.quando).toLocaleString('pt-BR')}] ${nomes[e.nivel]} ${e.origem}: ${e.texto}${e.repeticoes ? ` (x${e.repeticoes})` : ''}`)
      .join('\n')
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Logs</h1>
          <p className="sub">Tudo o que o programa está fazendo, na hora. Guardado por 7 dias.</p>
        </div>
        <div className="linha">
          <button className="btn" onClick={copiar} disabled={!visiveis.length}>{copiado ? 'Copiado!' : 'Copiar para me mandar'}</button>
          <button className="btn" onClick={() => chamar('abrirPastaLogs')}>Abrir pasta dos logs</button>
          <button className="btn perigo" onClick={async () => { await chamar('limparLogs'); setLista([]) }}>Limpar tela</button>
        </div>
      </div>

      <div className="linha">
        <button className={`pilula ${nivel === 'todos' ? 'ativa' : ''}`} onClick={() => setNivel('todos')}>Todos · {lista.length}</button>
        <button className={`pilula ${nivel === 'erro' ? 'ativa' : ''}`} onClick={() => setNivel('erro')}>Erros · {contar('erro')}</button>
        <button className={`pilula ${nivel === 'aviso' ? 'ativa' : ''}`} onClick={() => setNivel('aviso')}>Avisos · {contar('aviso')}</button>
        <button className={`pilula ${nivel === 'ok' ? 'ativa' : ''}`} onClick={() => setNivel('ok')}>Sucesso · {contar('ok')}</button>
        <select className="solto" value={origem} onChange={(e) => setOrigem(e.target.value)} aria-label="Filtrar por origem" style={{ height: 38 }}>
          <option value="todas">Todas as origens</option>
          {origens.map((o) => (
            <option key={o} value={o}>{o.endsWith(' #') ? o.replace(' #', 's') : o}</option>
          ))}
        </select>
        <input className="solto" type="search" placeholder="Buscar (ex.: Teste 12, proxy, erro)" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ height: 38, minWidth: 240 }} aria-label="Buscar nos logs" />
        <span className="espaco" />
        <span className="linha" style={{ gap: 10, fontSize: 13 }}>
          Acompanhar ao vivo
          <Chave ligada={acompanhar} aoMudar={setAcompanhar} rotulo="Acompanhar ao vivo" />
        </span>
      </div>

      <div className="painel sem-padding">
        <div ref={caixa} className="logs" onWheel={(e) => e.deltaY < 0 && setAcompanhar(false)}>
          {visiveis.map((e) => (
            <div key={e.id} className={`log-linha ${e.nivel}`}>
              <span className="log-hora">{new Date(e.quando).toLocaleTimeString('pt-BR')}</span>
              <span className={`selo ${CLASSES[e.nivel]}`} style={{ justifyContent: 'center', minWidth: 58 }}>{NOMES[e.nivel]}</span>
              <span className="log-origem">{e.origem}</span>
              <span className="log-texto">
                {e.texto}
                {e.repeticoes ? <span className="log-rep"> ×{e.repeticoes}</span> : null}
              </span>
            </div>
          ))}
          {!visiveis.length && <div className="vazio">{lista.length ? 'Nada com esse filtro.' : 'Nenhum registro ainda.'}</div>}
        </div>
      </div>
    </>
  )
}
