import { useEffect, useState } from 'react'
import type { ItemGaleria, OpcoesGerar } from '../../../../shared/types'
import { chamar } from '../../api'
import { Galeria, limparErro, SemComfy, Trabalhos, useFluxos, useGaleria, useStatusIA, useTrabalhos } from './comum'
import { GeradorPrompt } from './GeradorPrompt'
import { Entradas, type ImagemEntrada, prepararImagens } from './Entradas'
import { PainelHardware } from '../Hardware'

// Resoluções na mesma proporção que o modelo usa (padrão do fluxo).
function resolucoes(l?: number, a?: number): [string, number, number][] {
  if (!l || !a) return [['Paisagem', 832, 480], ['Retrato', 480, 832], ['Quadrado', 640, 640]]
  const deitado = l >= a
  const maior = Math.max(l, a)
  const menor = Math.min(l, a)
  const op = (nome: string, M: number, m: number): [string, number, number] => (deitado ? [nome, M, m] : [nome, m, M])
  return [
    op(`Rápido`, Math.round((maior * 0.6) / 32) * 32, Math.round((menor * 0.6) / 32) * 32),
    op(`Padrão do modelo`, maior, menor),
    [deitado ? 'Retrato (deitar ↔ em pé)' : 'Paisagem (em pé ↔ deitar)', deitado ? menor : maior, deitado ? maior : menor]
  ]
}

export default function Animar({ inicial, aoConfigurar }: { inicial: ItemGaleria | null; aoConfigurar: () => void }) {
  const st = useStatusIA()
  const [fluxos] = useFluxos()
  const trabalhos = useTrabalhos('video')
  const [videos] = useGaleria('video')
  const [imagensGaleria] = useGaleria('imagem')
  const fluxosVideo = fluxos.filter((f) => f.tipo === 'video')

  const [fluxoId, setFluxoId] = useState('')
  const [entradas, setEntradas] = useState<(ImagemEntrada | null)[]>([])
  const [prompt, setPrompt] = useState('')
  const [negativo, setNegativo] = useState('')
  const [segundos, setSegundos] = useState(5)
  const [fps, setFps] = useState(24)
  const [res, setRes] = useState<{ l: number; a: number } | null>(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!fluxosVideo.find((f) => f.id === fluxoId) && fluxosVideo.length) setFluxoId(fluxosVideo[0].id)
  }, [fluxosVideo.length])
  const fluxo = fluxosVideo.find((f) => f.id === fluxoId)
  useEffect(() => {
    if (!fluxo) return
    if (fluxo.padroes.fps) setFps(fluxo.padroes.fps)
    if (fluxo.padroes.segundos) setSegundos(fluxo.padroes.segundos)
    if (fluxo.padroes.largura && fluxo.padroes.altura) setRes({ l: fluxo.padroes.largura, a: fluxo.padroes.altura })
  }, [fluxoId, fluxo?.id])
  useEffect(() => {
    if (inicial) setEntradas([{ nome: inicial.arquivo, url: inicial.url, daGaleria: inicial.arquivo }])
  }, [inicial])

  const temQuadros = !!fluxo?.campos.quadros.length
  const temSegundos = !!fluxo?.campos.segundos.length
  const temFps = !!fluxo?.campos.fps.length
  const temTamanho = !!fluxo?.campos.largura.length
  const faltamImagens = (fluxo?.campos.imagem.length ?? 0) > entradas.filter(Boolean).length

  const animar = async () => {
    if (!fluxo) return
    setErro('')
    setEnviando(true)
    try {
      // modelos Wan usam quadros = segundos × fps + 1
      const o: OpcoesGerar = {
        fluxoId,
        prompt: prompt.trim(),
        negativo: negativo.trim() || undefined,
        imagens: await prepararImagens(fluxo.campos.imagem.map((_, k) => entradas[k] ?? null)),
        quadros: temQuadros ? Math.round(segundos * fps) + 1 : undefined,
        segundos: temSegundos ? segundos : undefined,
        fps: temFps ? fps : undefined,
        largura: temTamanho && res ? res.l : undefined,
        altura: temTamanho && res ? res.a : undefined
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
          <h1>Animar</h1>
          <p className="sub">Dê vida a uma imagem: o vídeo é feito no PC secundário e volta para cá.</p>
        </div>
      </div>
      <SemComfy st={st} aoConfigurar={aoConfigurar} />
      <PainelHardware />

      {st?.conectado && !fluxosVideo.length ? (
        <section className="painel">
          <h2>Falta instalar uma IA de vídeo</h2>
          <p className="sub" style={{ marginTop: 0, lineHeight: 1.75 }}>
            O seu ComfyUI ainda não tem nenhum modelo de vídeo. A recomendação para a RTX 5070 é o <strong>Wan 2.2 5B</strong>: roda bem em 12 GB, faz vídeos de ~5 segundos em 720p e já vem pronto aqui no programa.
            <br />
            <br />
            <strong>Como instalar (uma vez só, cerca de 17 GB de download):</strong>
            <br />1. No PC secundário, abra o ComfyUI no navegador.
            <br />2. Clique em <strong>Workflow &gt; Browse Templates</strong> (ou no ícone de modelos/templates na lateral).
            <br />3. Na categoria <strong>Video</strong>, abra <strong>"Wan 2.2 5B video generation"</strong> (ou parecido, com "5B").
            <br />4. O ComfyUI vai avisar dos arquivos que faltam e mostrar botões de <strong>Download</strong>: baixe todos. Eles já vão para as pastas certas.
            <br />5. Feche e abra o ComfyUI de novo. Depois, aqui, vá em Configurações &gt; ComfyUI e clique em <strong>Atualizar lista</strong>.
            <br />
            <br />
            Pronto: o fluxo <strong>"Animar (Wan 2.2 5B)"</strong> aparece sozinho nesta aba. Se você preferir usar outro modelo de vídeo, também pode importar o seu fluxo em Configurações &gt; ComfyUI.
          </p>
          <div><button className="btn" onClick={aoConfigurar}>Ir para Configurações &gt; ComfyUI</button></div>
        </section>
      ) : fluxo ? (
        <section className="painel">
          {fluxosVideo.length > 1 && (
            <label className="campo">
              Fluxo
              <select value={fluxoId} onChange={(e) => setFluxoId(e.target.value)}>
                {fluxosVideo.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
          )}
          {fluxo.descricao && <span className="dica">{fluxo.nome}: {fluxo.descricao}</span>}

          <Entradas campos={fluxo.campos.imagem} valores={entradas} aoMudar={setEntradas} galeria={imagensGaleria} />

          {fluxo.campos.prompt.length > 0 && <GeradorPrompt tipo="video" atual={prompt} aoUsar={(r) => setPrompt(r.prompt)} />}
          {fluxo.campos.prompt.length > 0 && (
            <label className="campo">
              Como quer o movimento? (em inglês costuma funcionar melhor)
              <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 14 }} placeholder="ex.: the camera slowly zooms in, hair moving with the wind, soft light" />
            </label>
          )}
          <div className="linha" style={{ gap: 14, alignItems: 'flex-end' }}>
            {(temQuadros || temSegundos) && (
              <label className="campo">Duração (segundos)<input type="number" min={1} max={10} value={segundos} onChange={(e) => setSegundos(Math.min(10, Math.max(1, Number(e.target.value))))} style={{ width: 120 }} /></label>
            )}
            {temFps && (
              <label className="campo">Quadros por segundo<input type="number" min={8} max={30} value={fps} onChange={(e) => setFps(Math.min(30, Math.max(8, Number(e.target.value))))} style={{ width: 120 }} /></label>
            )}
            {temTamanho && (
              <div className="campo">
                Resolução
                <div className="linha" style={{ gap: 6 }}>
                  {resolucoes(fluxo.padroes.largura, fluxo.padroes.altura).map(([n, l, a]) => (
                    <button key={n} type="button" className={`pilula ${res?.l === l && res?.a === a ? 'ativa' : ''}`} onClick={() => setRes({ l, a })}>{n} <span style={{ opacity: 0.6, fontWeight: 400 }}>{l}×{a}</span></button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {fluxo.campos.negativo.length > 0 && <label className="campo">O que NÃO quer no vídeo<input value={negativo} onChange={(e) => setNegativo(e.target.value)} placeholder="ex.: blurry, distorted, static" /></label>}
          {(temQuadros || temSegundos) && <span className="dica">Vídeos mais longos ou maiores demoram mais e usam mais memória da placa. Comece com 5 s no "Rápido" para testar.</span>}
          {erro && <div className="aviso" style={{ color: '#ffb3c1' }}>{erro}</div>}
          <div className="linha" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primario" style={{ height: 48, padding: '0 26px', fontSize: 15 }} disabled={enviando || !st?.conectado || faltamImagens || (fluxo.campos.prompt.length > 0 && !prompt.trim())} onClick={animar}>
              {enviando ? 'Enviando…' : 'Animar'}
            </button>
          </div>
        </section>
      ) : null}

      <Trabalhos lista={trabalhos} />
      <Galeria lista={videos} />
    </>
  )
}
