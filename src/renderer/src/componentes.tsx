// Peças reutilizadas em várias telas.
import type { ReactNode } from 'react'

const svg = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

export const Icone = {
  perfis: svg(<><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6" /><path d="M17 4a4 4 0 0 1 0 8" /></>),
  vivo: svg(<><circle cx="12" cy="12" r="3" /><path d="M5.6 5.6a9 9 0 0 0 0 12.8" /><path d="M18.4 5.6a9 9 0 0 1 0 12.8" /></>),
  janelas: svg(<><rect x="3" y="4" width="8" height="7" rx="1" /><rect x="13" y="4" width="8" height="7" rx="1" /><rect x="3" y="13" width="8" height="7" rx="1" /><rect x="13" y="13" width="8" height="7" rx="1" /></>),
  proxies: svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></>),
  config: svg(<><path d="M4 6h10" /><circle cx="16" cy="6" r="2" /><path d="M4 12h4" /><path d="M12 12h8" /><circle cx="10" cy="12" r="2" /><path d="M4 18h12" /><circle cx="18" cy="18" r="2" /></>),
  atualizar: svg(<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></>),
  sugestoes: svg(<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z" />),
  monitor: svg(<><rect x="3" y="4" width="18" height="14" rx="3" /><path d="M8 21h8" /><path d="M12 18v3" /></>),
  fechar: svg(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>),
  ampliar: svg(<><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>),
  frente: svg(<><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>),
  imagem: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>),
  animar: svg(<><rect x="3" y="5" width="14" height="14" rx="2" /><path d="M17 10l4-2v8l-4-2" /></>),
  lives: svg(<><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4" /><path d="M7.8 16.2a6 6 0 0 1 0-8.4" /><path d="M19 5a10 10 0 0 1 0 14" /><path d="M5 19A10 10 0 0 1 5 5" /></>),
  musica: svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  logs: svg(<><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h10" /></>),
  trocar: svg(<><path d="M4 7h13l-3-3" /><path d="M20 17H7l3 3" /></>)
}

export function Chave({ ligada, aoMudar, rotulo }: { ligada: boolean; aoMudar: (v: boolean) => void; rotulo: string }) {
  return (
    <button type="button" className={`chave ${ligada ? 'ligada' : ''}`} aria-pressed={ligada} aria-label={rotulo} onClick={() => aoMudar(!ligada)}>
      <span />
    </button>
  )
}

export function Opcao(props: { titulo: string; desc?: string; ligada: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <div className="opcao">
      <div>
        <div className="opcao-titulo">{props.titulo}</div>
        {props.desc && <div className="opcao-desc">{props.desc}</div>}
      </div>
      <Chave ligada={props.ligada} aoMudar={props.aoMudar} rotulo={props.titulo} />
    </div>
  )
}

export function Modal({ titulo, sub, aoFechar, children, grande }: { titulo: string; sub?: string; aoFechar: () => void; children: ReactNode; grande?: boolean }) {
  return (
    <div className="fundo-modal" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className={`modal ${grande ? 'grande' : ''}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="cabecalho">
          <div>
            <h1 style={{ fontSize: 22 }}>{titulo}</h1>
            {sub && <p className="sub">{sub}</p>}
          </div>
          <button type="button" className="btn icone" aria-label="Fechar" onClick={aoFechar}>
            {Icone.fechar}
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

const CORES = ['#B9A4FF', '#7DD3FC', '#FCD34D', '#F9A8D4', '#86EFAC', '#FDBA74', '#A5B4FC', '#5EEAD4']
export const corDoNumero = (n: number) => CORES[Math.abs(n) % CORES.length]
