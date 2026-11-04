// Escolher as imagens de entrada de um fluxo (do PC ou da galeria).
import { useState } from 'react'
import type { ItemGaleria, LocalCampo } from '../../../../shared/types'
import { chamar } from '../../api'
import { lerArquivo } from './comum'

export interface ImagemEntrada {
  nome: string
  url: string
  base64?: string // veio do PC
  daGaleria?: string // arquivo da galeria
}

// Junta as imagens em base64 (as da galeria são lidas na hora).
export async function prepararImagens(lista: (ImagemEntrada | null)[]) {
  const out: { nome: string; base64: string }[] = []
  for (const i of lista) {
    if (!i) continue
    if (i.base64) out.push({ nome: i.nome, base64: i.base64 })
    else if (i.daGaleria) out.push(await chamar<{ nome: string; base64: string }>('lerDaGaleria', i.daGaleria))
  }
  return out
}

export function Entradas({
  campos,
  valores,
  aoMudar,
  galeria
}: {
  campos: LocalCampo[]
  valores: (ImagemEntrada | null)[]
  aoMudar: (v: (ImagemEntrada | null)[]) => void
  galeria: ItemGaleria[]
}) {
  const [escolhendo, setEscolhendo] = useState<number | null>(null)
  const definir = (k: number, v: ImagemEntrada | null) => {
    const novo = [...valores]
    novo[k] = v
    aoMudar(novo)
  }
  if (!campos.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="linha" style={{ alignItems: 'stretch', gap: 14 }}>
        {campos.map((c, k) => (
          <div key={c.no} className="entrada">
            <div className="dica" style={{ fontWeight: 600, color: 'var(--texto-2)' }}>{c.rotulo ?? (campos.length > 1 ? `Imagem ${k + 1}` : 'Imagem')}</div>
            <div className="tela" style={{ height: 190, cursor: 'default' }}>
              {valores[k] ? <img src={valores[k]!.url} alt={c.rotulo ?? `Imagem ${k + 1}`} style={{ objectFit: 'contain' }} /> : <span>Nenhuma imagem</span>}
            </div>
            <div className="linha" style={{ gap: 6 }}>
              <label className="btn pequeno" style={{ flex: 1, justifyContent: 'center' }}>
                Do PC
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (f) definir(k, await lerArquivo(f))
                    e.target.value = ''
                  }}
                />
              </label>
              <button className="btn pequeno" style={{ flex: 1 }} disabled={!galeria.length} onClick={() => setEscolhendo(escolhendo === k ? null : k)}>Da galeria</button>
              {valores[k] && <button className="btn pequeno" onClick={() => definir(k, null)} aria-label="Tirar imagem">×</button>}
            </div>
          </div>
        ))}
      </div>
      {escolhendo !== null && (
        <div className="galeria">
          {galeria.map((i) => (
            <button key={i.arquivo} type="button" className="galeria-item" onClick={() => { definir(escolhendo, { nome: i.arquivo, url: i.url, daGaleria: i.arquivo }); setEscolhendo(null) }}>
              <img src={i.url} alt={i.prompt ?? i.arquivo} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
