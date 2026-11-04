// "Criar prompt com IA": você escreve em português e recebe um prompt em inglês bem feito.
import { useState } from 'react'
import type { PedidoPrompt, ResultadoPrompt } from '../../../../shared/types'
import { chamar } from '../../api'
import { limparErro } from './comum'

const DICAS: Record<PedidoPrompt['tipo'], string> = {
  imagem: 'ex.: uma streamer gamer no quarto à noite com luz neon roxa, câmera de lado, bem realista',
  editar: 'ex.: troque o fundo por uma praia ao pôr do sol e deixe a pessoa igual',
  video: 'ex.: ela sorri, olha para a câmera e o cabelo mexe com o vento; câmera se aproximando devagar',
  musica: 'ex.: um funk animado sobre maratonar live de madrugada, voz feminina, refrão chiclete'
}

export function GeradorPrompt({ tipo, atual, aoUsar }: { tipo: PedidoPrompt['tipo']; atual?: string; aoUsar: (r: ResultadoPrompt) => void }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [r, setR] = useState<ResultadoPrompt | null>(null)

  const gerar = async (melhorar = false) => {
    if (!texto.trim() && !melhorar) return setErro('Escreva o que você quer, em português.')
    setErro('')
    setGerando(true)
    try {
      setR(await chamar<ResultadoPrompt>('gerarPrompt', { tipo, texto: texto.trim() || 'improve this prompt', atual: melhorar ? atual : undefined }))
    } catch (e) {
      setErro(limparErro(e))
    } finally {
      setGerando(false)
    }
  }

  if (!aberto)
    return (
      <div className="linha" style={{ gap: 8 }}>
        <button type="button" className="btn pequeno" onClick={() => setAberto(true)}>✨ Criar prompt com IA (escreva em português)</button>
      </div>
    )

  return (
    <div className="trabalho" style={{ display: 'grid', gap: 10, borderColor: '#4a3a78', background: '#1a1730' }}>
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <strong>✨ Criar prompt com IA</strong>
        <button type="button" className="btn pequeno" onClick={() => setAberto(false)}>Fechar</button>
      </div>
      <label className="campo">
        O que você quer (em português, do seu jeito)
        <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 14 }} placeholder={DICAS[tipo]} />
      </label>
      <div className="linha" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {atual?.trim() && tipo !== 'musica' && (
          <button type="button" className="btn" disabled={gerando} onClick={() => gerar(true)}>Melhorar o prompt atual</button>
        )}
        <button type="button" className="btn primario" disabled={gerando} onClick={() => gerar(false)}>{gerando ? 'Criando… (pode levar até 1 min no grátis)' : 'Criar prompt'}</button>
      </div>
      {erro && <div className="aviso" style={{ color: '#ffb3c1' }}>{erro}</div>}
      {r && (
        <div style={{ display: 'grid', gap: 8 }}>
          {tipo === 'musica' ? (
            <>
              {r.titulo && <div><span className="dica">Título:</span> <strong>{r.titulo}</strong></div>}
              <div><span className="dica">Estilo:</span> {r.estilo ?? r.prompt}</div>
              {r.letra && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, margin: 0, maxHeight: 260, overflow: 'auto', background: '#0e0e16', padding: 12, borderRadius: 10 }}>{r.letra}</pre>}
            </>
          ) : (
            <div style={{ background: '#0e0e16', padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>{r.prompt}</div>
          )}
          <div className="linha" style={{ gap: 8, justifyContent: 'space-between' }}>
            <span className="dica">{r.motor ? `Feito por: ${r.motor}` : ''}</span>
            <span className="linha" style={{ gap: 8 }}>
              <button type="button" className="btn" disabled={gerando} onClick={() => gerar(false)}>Gerar outro</button>
              <button type="button" className="btn primario" onClick={() => { aoUsar(r); setAberto(false) }}>Usar este</button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
