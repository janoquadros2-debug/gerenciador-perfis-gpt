import { useEffect, useMemo, useState } from 'react'
import type { ItemGaleria, OpcoesGerar } from '../../../../shared/types'
import { chamar } from '../../api'
import { Galeria, limparErro, SemComfy, Trabalhos, useFluxos, useGaleria, useModelos, useStatusIA, useTrabalhos } from './comum'
import { GeradorPrompt } from './GeradorPrompt'
import { Entradas, type ImagemEntrada, prepararImagens } from './Entradas'
import { PainelHardware } from '../Hardware'

const TAMANHOS: [string, number, number][] = [
  ['Quadrado', 1024, 1024],
  ['Retrato', 832, 1216],
  ['Paisagem', 1216, 832],
  ['Celular (9:16)', 768, 1344],
  ['Tela (16:9)', 1344, 768]
]

export default function CriarImagens({ aoAnimar, aoConfigurar }: { aoAnimar: (i: ItemGaleria) => void; aoConfigurar: () => void }) {
  const st = useStatusIA()
  const [fluxos] = useFluxos()
  const fluxosImagem = fluxos.filter((f) => f.tipo === 'imagem')
  const temBasico = fluxosImagem.some((f) => f.id === 'basico-imagem')
  const { lista: modelos, erro: erroModelos } = useModelos(!!st?.conectado && temBasico)
  const trabalhos = useTrabalhos('imagem')
  const [galeria] = useGaleria('imagem')

  const [fluxoId, setFluxoId] = useState('')
  const [modelo, setModelo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativo, setNegativo] = useState('')
  const [tam, setTam] = useState<{ l: number; a: number } | null>(null)
  const [quantidade, setQuantidade] = useState(1)
  const [semente, setSemente] = useState('')
  const [passos, setPassos] = useState('')
  const [cfg, setCfg] = useState('')
  const [entradas, setEntradas] = useState<(ImagemEntrada | null)[]>([])
  const [mais, setMais] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!fluxosImagem.find((f) => f.id === fluxoId) && fluxosImagem.length) setFluxoId(fluxosImagem[0].id)
  }, [fluxosImagem.length])

  const fluxo = fluxosImagem.find((f) => f.id === fluxoId)
  const basico = fluxoId === 'basico-imagem'
  const usaPrompt = !!fluxo?.campos.prompt.length
  const usaTamanho = !!fluxo?.campos.largura.length
  const checkpoints = useMemo(() => (modelos ?? []).filter((m) => m.pasta === 'checkpoints' && m.categoria === 'imagem'), [modelos])
  const escolhido = checkpoints.find((m) => m.arquivo === modelo)
  useEffect(() => {
    if (basico && !modelo && checkpoints.length) setModelo(checkpoints[0].arquivo)
  }, [checkpoints, basico])
  // ao trocar de fluxo, volta para o tamanho que ele já traz e limpa as imagens
  useEffect(() => {
    setTam(fluxo?.padroes.largura && fluxo.padroes.altura ? { l: fluxo.padroes.largura, a: fluxo.padroes.altura } : null)
    setEntradas([])
    setErro('')
  }, [fluxoId])

  const faltamImagens = (fluxo?.campos.imagem.length ?? 0) > entradas.filter(Boolean).length
  const gerar = async () => {
    if (!fluxo) return
    setErro('')
    setEnviando(true)
    try {
      const o: OpcoesGerar = {
        fluxoId,
        prompt: prompt.trim(),
        negativo: negativo.trim() || undefined,
        modelo: basico ? modelo : undefined,
        largura: usaTamanho && tam ? tam.l : undefined,
        altura: usaTamanho && tam ? tam.a : undefined,
        quantidade: fluxo.campos.quantidade.length ? quantidade : undefined,
        semente: semente ? Number(semente) : undefined,
        passos: basico && passos ? Number(passos) : undefined,
        cfg: basico && cfg ? Number(cfg) : undefined,
        imagens: await prepararImagens(fluxo.campos.imagem.map((_, k) => entradas[k] ?? null))
      }
      await chamar('iaGerar', o)
    } catch (e) {
      setErro(limparErro(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Criar imagens</h1>
          <p className="sub">{st?.conectado ? `Gerando na ${st.placa ?? 'placa do PC secundário'} via ComfyUI` : 'Usa o ComfyUI do PC secundário'}</p>
        </div>
      </div>
      <SemComfy st={st} aoConfigurar={aoConfigurar} />
      <PainelHardware />

      {st?.conectado && !fluxosImagem.length && (
        <div className="aviso">Nenhum fluxo de imagem disponível. Confira em Configurações &gt; ComfyUI quais IAs estão instaladas.</div>
      )}

      {fluxo && (
        <section className="painel">
          <div className="escolhas" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            {fluxosImagem.map((f) => (
              <label key={f.id} className={`escolha ${f.id === fluxoId ? 'marcada' : ''}`} style={{ padding: '10px 14px', alignItems: 'flex-start' }}>
                <input type="radio" checked={f.id === fluxoId} onChange={() => setFluxoId(f.id)} style={{ marginTop: 2 }} />
                <span>{f.nome}<div className="dica" style={{ fontWeight: 400, marginTop: 2 }}>{f.descricao ?? 'Fluxo importado por você.'}</div></span>
              </label>
            ))}
          </div>

          {basico && (
            <>
              <label className="campo">
                Modelo (IA)
                <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                  {!checkpoints.length && <option value="">{erroModelos ? 'Não consegui ler os modelos' : 'Carregando modelos…'}</option>}
                  {checkpoints.map((m) => <option key={m.arquivo} value={m.arquivo}>{m.familia} · {m.arquivo}</option>)}
                </select>
              </label>
              {escolhido && <span className="dica">Para que serve: {escolhido.uso}</span>}
            </>
          )}

          <Entradas campos={fluxo.campos.imagem} valores={entradas} aoMudar={setEntradas} galeria={galeria} />

          {usaPrompt && <GeradorPrompt tipo={fluxo.campos.imagem.length ? 'editar' : 'imagem'} atual={prompt} aoUsar={(r) => setPrompt(r.prompt)} />}
          {usaPrompt && (
            <label className="campo">
              {fluxo.campos.imagem.length ? 'O que fazer com a imagem? (pode escrever em português; em inglês costuma ficar mais preciso)' : 'Descreva a imagem (pode escrever em português; em inglês costuma ficar mais preciso)'}
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                style={{ fontFamily: 'inherit', fontSize: 14 }}
                placeholder={fluxo.campos.imagem.length > 1 ? 'ex.: put the jacket from image 2 on the person in image 1' : fluxo.campos.imagem.length ? 'ex.: change the background to a beach at sunset' : 'ex.: a cozy streamer room at night, neon lights, cinematic'}
              />
            </label>
          )}

          {usaTamanho && (
            <div className="campo">
              Tamanho
              <div className="linha" style={{ gap: 6 }}>
                {TAMANHOS.map(([n, l, a]) => (
                  <button key={n} type="button" className={`pilula ${tam?.l === l && tam?.a === a ? 'ativa' : ''}`} onClick={() => setTam({ l, a })}>{n} <span style={{ opacity: 0.6, fontWeight: 400 }}>{l}×{a}</span></button>
                ))}
                {fluxo.padroes.largura && fluxo.padroes.altura && !TAMANHOS.some(([, l, a]) => l === fluxo.padroes.largura && a === fluxo.padroes.altura) && (
                  <button type="button" className={`pilula ${tam?.l === fluxo.padroes.largura && tam?.a === fluxo.padroes.altura ? 'ativa' : ''}`} onClick={() => setTam({ l: fluxo.padroes.largura!, a: fluxo.padroes.altura! })}>
                    Padrão do modelo <span style={{ opacity: 0.6, fontWeight: 400 }}>{fluxo.padroes.largura}×{fluxo.padroes.altura}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="linha" style={{ alignItems: 'flex-end', gap: 14 }}>
            {fluxo.campos.quantidade.length ? (
              <label className="campo">Quantidade<input type="number" min={1} max={8} value={quantidade} onChange={(e) => setQuantidade(Math.min(8, Math.max(1, Number(e.target.value))))} style={{ width: 100 }} /></label>
            ) : null}
            {(usaPrompt || basico) && <button className="btn pequeno" onClick={() => setMais(!mais)}>{mais ? 'Menos opções' : 'Mais opções'}</button>}
            <span className="espaco" />
            <button
              className="btn primario"
              style={{ height: 48, padding: '0 26px', fontSize: 15 }}
              disabled={enviando || !st?.conectado || (usaPrompt && !prompt.trim()) || faltamImagens || (basico && !modelo)}
              onClick={gerar}
            >
              {enviando ? 'Enviando…' : fluxo.campos.imagem.length ? 'Aplicar' : 'Gerar'}
            </button>
          </div>
          {faltamImagens && <span className="dica">Escolha {fluxo.campos.imagem.length === 1 ? 'a imagem' : `as ${fluxo.campos.imagem.length} imagens`} para continuar.</span>}

          {mais && (
            <div className="grade-campos">
              {fluxo.campos.negativo.length > 0 && <label className="campo">O que NÃO quer na imagem<input value={negativo} onChange={(e) => setNegativo(e.target.value)} placeholder="ex.: blurry, text, watermark" /></label>}
              {fluxo.campos.semente.length > 0 && <label className="campo">Semente (vazio = aleatória)<input type="number" value={semente} onChange={(e) => setSemente(e.target.value)} placeholder="aleatória" /></label>}
              {basico && <label className="campo">Passos (vazio = automático)<input type="number" min={1} max={100} value={passos} onChange={(e) => setPassos(e.target.value)} placeholder="automático" /></label>}
              {basico && <label className="campo">CFG (vazio = automático)<input type="number" step={0.5} min={1} max={20} value={cfg} onChange={(e) => setCfg(e.target.value)} placeholder="automático" /></label>}
            </div>
          )}
          {erro && <div className="aviso" style={{ color: '#ffb3c1' }}>{erro}</div>}
        </section>
      )}

      <Trabalhos lista={trabalhos} />
      <Galeria lista={galeria} aoAnimar={aoAnimar} />
    </>
  )
}
