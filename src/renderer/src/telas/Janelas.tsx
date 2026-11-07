import { useEffect, useState } from 'react'
import { LARGURA_MINIMA, posicaoNaGrade } from '../../../shared/grade'
import type { ConfigJanelas, Monitor } from '../../../shared/types'
import { chamar, useConfig } from '../api'
import { Chave } from '../componentes'
import { SeletorPc } from '../componentes/SeletorPc'

export function Janelas() {
  const [cfg, salvar] = useConfig()
  const [monitores, setMonitores] = useState<Monitor[]>([])
  const [verManual, setVerManual] = useState(false)
  useEffect(() => {
    chamar<Monitor[]>('monitores').then(setMonitores)
  }, [])
  if (!cfg) return null
  const j = cfg.janelas
  const muda = (p: Partial<ConfigJanelas>) => salvar({ janelas: { ...j, ...p } })

  const emUso = j.monitores.length ? j.monitores.map((id) => monitores.find((m) => m.id === id)).filter(Boolean) as Monitor[] : monitores
  const porMonitor = j.colunas * j.linhas
  const pequena = j.largura < LARGURA_MINIMA

  const alternarMonitor = (id: number) => {
    const base = j.monitores.length ? j.monitores : monitores.map((m) => m.id)
    const novo = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    muda({ monitores: novo.length ? novo : [] })
  }

  const numero = (pos: number, m: number) => m * porMonitor + pos + 1
  const celulas = (m: number) => {
    // monta a grade na ordem visual (linha a linha) com o número que vai em cada posição
    const mapa: number[] = Array(porMonitor).fill(0)
    for (let k = 0; k < porMonitor; k++) {
      const { linha, coluna } = posicaoNaGrade(k, j)
      if (linha < j.linhas && coluna < j.colunas) mapa[linha * j.colunas + coluna] = numero(k, m)
    }
    return mapa
  }

  // grade pronta (ex.: 3×2): calcula sozinho o tamanho de cada janela para encher o monitor
  const menorMonitor = emUso.length ? emUso.reduce((a, b) => (a.largura * a.altura <= b.largura * b.altura ? a : b)) : null
  const aplicarGrade = (colunas: number, linhas: number) => {
    const m = menorMonitor
    const espaco = j.espaco ?? 0
    const largura = m ? Math.floor((m.largura - espaco * (colunas - 1)) / colunas) : j.largura
    const altura = m ? Math.floor((m.altura - espaco * (linhas - 1)) / linhas) : j.altura
    muda({ colunas, linhas, largura: Math.max(200, largura), altura: Math.max(200, altura) })
  }
  const GRADES: [number, number][] = [[2, 1], [2, 2], [3, 2], [3, 3], [4, 2], [4, 3], [4, 4], [5, 2], [5, 3], [6, 2], [6, 3], [8, 2], [8, 3]]

  const numCampo = (rotulo: string, chave: keyof ConfigJanelas, min = 0) => (
    <label className="campo">
      {rotulo}
      <input type="number" min={min} value={j[chave] as number} onChange={(e) => muda({ [chave]: Math.max(min, Number(e.target.value)) } as Partial<ConfigJanelas>)} style={{ width: 110 }} />
    </label>
  )

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Organizador de janelas</h1>
          <p className="sub">Posiciona os navegadores na tela automaticamente ao abrir.</p>
        </div>
        {emUso.length > 0 && <span className="dica">Cada grupo comporta {porMonitor * emUso.length} posições. Se houver mais perfis, abra a aba Ao vivo para alternar qual grupo fica em evidência. Perfis fora do grupo continuam abertos, mas não há espaço físico para exibir todos sem sobreposição.</span>}
        <div className="linha">
          <strong>{j.ativo ? 'Ativado' : 'Desativado'}</strong>
          <Chave ligada={j.ativo} aoMudar={(v) => muda({ ativo: v })} rotulo="Organizador de janelas" />
          <button className="btn primario" onClick={() => chamar('organizarTodos')}>Organizar agora</button>
        </div>
      </div>

      <SeletorPc titulo="Configurar janelas do computador" />
      <div className="painel">
        <div className="campo">
          Grade por monitor (colunas × linhas): clique e o tamanho das janelas é calculado sozinho
          <div className="linha" style={{ gap: 6, flexWrap: 'wrap' }}>
            {GRADES.map(([c, l]) => (
              <button key={`${c}x${l}`} type="button" className={`pilula ${j.colunas === c && j.linhas === l ? 'ativa' : ''}`} onClick={() => aplicarGrade(c, l)}>
                {c}×{l} <span style={{ opacity: 0.6, fontWeight: 400 }}>({c * l})</span>
              </button>
            ))}
            <button type="button" className={`pilula ${verManual ? 'ativa' : ''}`} onClick={() => setVerManual(!verManual)}>Personalizado…</button>
          </div>
          <span className="dica">
            {j.colunas}×{j.linhas} = {porMonitor} navegadores por monitor{emUso.length > 1 ? `, ${porMonitor * emUso.length} nos ${emUso.length} monitores` : ''} · cada janela com {j.largura}×{j.altura}px
            {menorMonitor ? ` (calculado para ${menorMonitor.largura}×${menorMonitor.altura})` : ''}
          </span>
        </div>
        <div className="linha" style={{ alignItems: 'flex-end', gap: 14 }}>
          <label className="campo">
            Ordem
            <select value={j.ordem} onChange={(e) => muda({ ordem: e.target.value as ConfigJanelas['ordem'] })}>
              <option value="blocos-3x2">Blocos de 3×2</option>
              <option value="linha">Linha por linha</option>
              <option value="coluna">Coluna por coluna</option>
            </select>
          </label>
          {numCampo('Espaço entre (px)', 'espaco', 0)}
        </div>
        {verManual && (
        <div className="linha" style={{ alignItems: 'flex-end', gap: 14 }}>
          {numCampo('Largura (px)', 'largura', 200)}
          {numCampo('Altura (px)', 'altura', 200)}
          {numCampo('Colunas', 'colunas', 1)}
          {numCampo('Linhas', 'linhas', 1)}
        </div>
        )}
        {pequena && <div className="aviso">Janelas com menos de {LARGURA_MINIMA}px de largura podem ficar maiores do que o escolhido: o navegador tem um tamanho mínimo.</div>}
      </div>

      <div className="painel">
        <h2>Monitores usados</h2>
        <div className="linha">
          {monitores.map((m) => (
            <label key={m.id} className={`escolha ${emUso.includes(m) ? 'marcada' : ''}`}>
              <input type="checkbox" checked={emUso.includes(m)} onChange={() => alternarMonitor(m.id)} />
              {m.nome} · {m.largura}×{m.altura}
            </label>
          ))}
        </div>
        <span className="dica">A ordem em que você marca define qual monitor recebe os primeiros navegadores.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 18 }}>
        {emUso.map((m, i) => (
          <div className="painel" key={m.id}>
            <div className="linha" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{m.nome}</strong>
                <div className="dica">{m.largura} × {m.altura}</div>
              </div>
              <span className="selo neutro">Navegadores {numero(0, i)} a {numero(porMonitor - 1, i)}</span>
            </div>
            <div className="monitor" style={{ aspectRatio: `${m.largura} / ${m.altura}`, gridTemplateColumns: `repeat(${j.colunas}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${j.linhas}, minmax(0, 1fr))` }}>
              {celulas(i).map((n, k) => (
                <div key={k} className={pequena ? 'pequena' : ''}>{n || ''}</div>
              ))}
            </div>
            {(j.colunas * (j.largura + j.espaco) > m.largura || j.linhas * (j.altura + j.espaco) > m.altura) && (
              <span style={{ color: 'var(--amarelo)', fontSize: 13 }}>A grade é maior que este monitor: algumas janelas vão ficar para fora da tela.</span>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
