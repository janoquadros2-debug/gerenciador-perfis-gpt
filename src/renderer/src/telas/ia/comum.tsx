// Peças usadas nas abas Criar imagens e Animar.
import { useEffect, useState } from 'react'
import type { ItemGaleria, ModeloIA, ResumoFluxo, StatusIA, TrabalhoIA } from '../../../../shared/types'
import { chamar, ouvir } from '../../api'
import { confirmar } from '../../confirmar'
import { Modal } from '../../componentes'

export function useStatusIA() {
  const [st, setSt] = useState<StatusIA | null>(null)
  useEffect(() => {
    chamar<StatusIA>('iaStatus').then(setSt).catch(() => setSt({ conectado: false, erro: 'Sem conexão com o PC secundário.' }))
    return ouvir('ia-status', setSt)
  }, [])
  return st
}

export function useFluxos() {
  const [lista, setLista] = useState<ResumoFluxo[]>([])
  const recarregar = () => chamar<ResumoFluxo[]>('iaFluxos').then(setLista).catch(() => undefined)
  useEffect(() => {
    recarregar()
  }, [])
  return [lista, recarregar] as const
}

export function useModelos(ativo: boolean) {
  const [lista, setLista] = useState<ModeloIA[] | null>(null)
  const [erro, setErro] = useState('')
  const recarregar = () => {
    setErro('')
    chamar<ModeloIA[]>('iaModelos')
      .then(setLista)
      .catch((e) => setErro(limparErro(e)))
  }
  useEffect(() => {
    if (ativo) recarregar()
  }, [ativo])
  return { lista, erro, recarregar }
}

export function useTrabalhos(tipo: 'imagem' | 'video') {
  const [lista, setLista] = useState<TrabalhoIA[]>([])
  useEffect(() => {
    chamar<TrabalhoIA[]>('iaTrabalhos').then(setLista).catch(() => undefined)
    return ouvir('ia-trabalho', (t: TrabalhoIA) =>
      setLista((atual) => [t, ...atual.filter((x) => x.id !== t.id)].sort((a, b) => b.criadoEm - a.criadoEm))
    )
  }, [])
  return lista.filter((t) => t.tipo === tipo)
}

export function useGaleria(midia: 'imagem' | 'video' | 'audio') {
  const [lista, setLista] = useState<ItemGaleria[]>([])
  const recarregar = () => chamar<ItemGaleria[]>('galeria').then(setLista)
  useEffect(() => {
    recarregar()
    return ouvir('galeria', recarregar)
  }, [])
  return [lista.filter((i) => i.midia === midia), recarregar] as const
}

export const limparErro = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method 'chamar': Error: /, '')

export function Trabalhos({ lista }: { lista: TrabalhoIA[] }) {
  const ativos = lista.filter((t) => t.status === 'na-fila' || t.status === 'gerando' || (t.terminouEm && Date.now() - t.terminouEm < 15_000) || t.status === 'erro').slice(0, 6)
  if (!ativos.length) return null
  return (
    <section className="painel" style={{ gap: 10 }}>
      <h2>Em andamento</h2>
      {ativos.map((t) => (
        <div key={t.id} className="trabalho">
          <div className="linha" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              <strong>{t.fluxoNome}</strong> {t.prompt && <span className="dica">· {t.prompt}</span>}
            </span>
            <span className="linha" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <span className={`selo ${t.status === 'pronto' ? 'ok' : t.status === 'erro' ? 'erro' : t.status === 'cancelado' ? 'neutro' : 'abrindo'}`}>
                {t.status === 'gerando' && t.porcentagem !== undefined ? `${t.porcentagem}%` : { 'na-fila': 'Na fila', gerando: 'Gerando', pronto: 'Pronto', erro: 'Erro', cancelado: 'Cancelado' }[t.status]}
              </span>
              {(t.status === 'na-fila' || t.status === 'gerando') && <button className="btn pequeno" onClick={() => chamar('iaCancelar', t.id)}>Cancelar</button>}
            </span>
          </div>
          {t.status === 'gerando' && (
            <div className="barra" style={{ marginTop: 8 }}>
              <div style={{ width: `${t.porcentagem ?? 3}%`, transition: 'width .3s' }} />
            </div>
          )}
          <div className="dica" style={{ marginTop: 6, color: t.status === 'erro' ? '#ffb3c1' : undefined }}>{t.erro ?? t.etapa}</div>
        </div>
      ))}
    </section>
  )
}

export function Galeria({ lista, aoAnimar }: { lista: ItemGaleria[]; aoAnimar?: (i: ItemGaleria) => void }) {
  const [aberto, setAberto] = useState<ItemGaleria | null>(null)
  const apagar = async (i: ItemGaleria) => {
    if (!(await confirmar(`Apagar "${i.arquivo}" da galeria?`, { perigo: true }))) return
    await chamar('apagarDaGaleria', i.arquivo)
    setAberto(null)
  }
  return (
    <section className="painel">
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <h2>Galeria <span className="dica" style={{ fontWeight: 400 }}>· {lista.length}</span></h2>
        <button className="btn pequeno" onClick={() => chamar('abrirPastaGaleria')}>Abrir pasta</button>
      </div>
      {!lista.length ? (
        <div className="vazio">Nada gerado ainda.</div>
      ) : (
        <div className="galeria">
          {lista.map((i) => (
            <button key={i.arquivo} type="button" className="galeria-item" onClick={() => setAberto(i)} title={i.prompt}>
              {i.midia === 'video' ? <video src={i.url} muted loop autoPlay playsInline /> : <img src={i.url} alt={i.prompt ?? i.arquivo} loading="lazy" />}
            </button>
          ))}
        </div>
      )}
      {aberto && (
        <Modal titulo={aberto.fluxo ?? 'Resultado'} sub={new Date(aberto.quando).toLocaleString('pt-BR')} aoFechar={() => setAberto(null)} grande>
          <div style={{ background: '#0e0e16', borderRadius: 12, display: 'grid', placeItems: 'center', overflow: 'hidden', maxHeight: '62vh' }}>
            {aberto.midia === 'video' ? (
              <video src={aberto.url} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: '62vh' }} />
            ) : (
              <img src={aberto.url} alt={aberto.prompt ?? ''} style={{ maxWidth: '100%', maxHeight: '62vh' }} />
            )}
          </div>
          {aberto.prompt && <p className="dica" style={{ margin: 0, whiteSpace: 'pre-line', color: 'var(--texto-2)' }}>{aberto.prompt}</p>}
          <div className="linha" style={{ justifyContent: 'flex-end' }}>
            <button className="btn perigo" onClick={() => apagar(aberto)}>Apagar</button>
            <button className="btn" onClick={() => navigator.clipboard.writeText(aberto.prompt ?? '')} disabled={!aberto.prompt}>Copiar prompt</button>
            <button className="btn" onClick={() => chamar('mostrarNaPasta', aberto.arquivo)}>Mostrar na pasta</button>
            {aoAnimar && aberto.midia === 'imagem' && <button className="btn primario" onClick={() => { aoAnimar(aberto); setAberto(null) }}>Animar esta</button>}
          </div>
        </Modal>
      )}
    </section>
  )
}

export function SemComfy({ st, aoConfigurar }: { st: StatusIA | null; aoConfigurar: () => void }) {
  if (!st || st.conectado) return null
  return (
    <div className="faixa-pausa" style={{ background: '#3a121b', borderColor: 'var(--vermelho-borda)', color: '#ffc2cd' }}>
      {st.erro ?? 'ComfyUI não conectado.'}
      <span className="espaco" />
      <button className="btn" onClick={aoConfigurar}>Configurar ComfyUI</button>
    </div>
  )
}

// Pega um arquivo do PC e devolve em base64 (para mandar ao ComfyUI).
export function lerArquivo(f: File): Promise<{ nome: string; base64: string; url: string }> {
  return new Promise((ok, erro) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      ok({ nome: f.name, base64: url.split(',')[1] ?? '', url })
    }
    r.onerror = () => erro(r.error)
    r.readAsDataURL(f)
  })
}
