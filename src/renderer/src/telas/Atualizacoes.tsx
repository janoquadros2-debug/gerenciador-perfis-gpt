import { useEffect, useState } from 'react'
import type { InfoAtualizacao } from '../../../shared/types'
import { chamar, ouvir, useConfig, useRede } from '../api'

export function Atualizacoes() {
  const [cfg, salvar] = useConfig()
  const [info, setInfo] = useState<InfoAtualizacao | null>(null)
  const rede = useRede()
  const comOutro = rede?.papel === 'principal' && rede.conectado
  const [outro, setOutro] = useState<InfoAtualizacao | null>(null)
  const [junto, setJunto] = useState(true)
  const [msgOutro, setMsgOutro] = useState('')
  useEffect(() => {
    chamar<InfoAtualizacao>('estadoAtualizacao').then(setInfo)
    return ouvir('atualizacao', setInfo)
  }, [])
  useEffect(() => {
    if (!comOutro) return
    chamar<InfoAtualizacao | null>('estadoAtualizacaoOutro').then(setOutro).catch(() => undefined)
    return ouvir('atualizacao-outro', setOutro)
  }, [comOutro])
  if (!cfg || !info) return null

  const atualizarOutro = async () => {
    setMsgOutro('Pedindo para o PC secundário atualizar…')
    try {
      const r = await chamar<{ versao: string | null; atual: string }>('atualizarOutroPc')
      setMsgOutro(r.versao ? `O PC secundário está baixando a v${r.versao}. Ele fecha, instala e abre sozinho; depois reconecta aqui.` : `O PC secundário já está na versão mais recente (v${r.atual}).`)
    } catch (e: any) {
      setMsgOutro(String(e?.message ?? e).replace(/^Error invoking remote method 'chamar': Error: /, ''))
    }
  }

  const texto: Record<InfoAtualizacao['status'], string> = {
    'nao-configurado': 'Atualizações ainda não configuradas',
    verificando: 'Procurando versão nova…',
    'em-dia': 'Você está na versão mais recente',
    disponivel: 'Nova versão disponível',
    baixando: `Baixando… ${info.progresso ?? 0}%`,
    pronta: 'Instalando… o programa vai fechar e abrir sozinho em até 1 minuto',
    erro: 'Não foi possível verificar'
  }

  return (
    <>
      <div className="cabecalho">
        <h1>Atualizações</h1>
      </div>

      <section className="painel" style={info.status === 'disponivel' ? { background: '#1a1730', borderColor: '#3a2f78' } : undefined}>
        <div className="cabecalho">
          <div>
            <div className="dica" style={{ color: '#d7ccff', fontWeight: 600 }}>{texto[info.status]}</div>
            <div style={{ fontFamily: 'var(--titulo)', fontSize: 26, fontWeight: 700, marginTop: 4 }}>
              v{info.status === 'disponivel' ? info.novaVersao : info.versaoAtual}
            </div>
            <div className="dica">Você está na v{info.versaoAtual}</div>
          </div>
          {info.status === 'disponivel' ? (
            <button className="btn primario" style={{ height: 52, fontSize: 16, padding: '0 28px' }} onClick={() => chamar('atualizarAgora', comOutro && junto)}>{comOutro && junto ? 'Atualizar os dois PCs' : 'Atualizar agora'}</button>
          ) : (
            <button className="btn" disabled={info.status === 'verificando' || info.status === 'baixando'} onClick={() => chamar('verificarAtualizacao')}>Procurar atualização</button>
          )}
        </div>
        {info.status === 'baixando' && <div className="barra"><div style={{ width: `${info.progresso ?? 0}%` }} /></div>}
        {info.notas && <div className="dica" style={{ whiteSpace: 'pre-line', color: 'var(--texto-2)' }}>{info.notas.replace(/<[^>]+>/g, '')}</div>}
        {info.erro && <div className="aviso">{info.erro}</div>}
        {comOutro && info.status === 'disponivel' && (
          <label className="linha" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={junto} onChange={(e) => setJunto(e.target.checked)} /> Atualizar o PC secundário junto
          </label>
        )}
        <span className="dica">O app fecha, instala e abre de novo sozinho. Seus perfis não são afetados.</span>
      </section>

      {comOutro && (
        <section className="painel">
          <div className="cabecalho">
            <div>
              <h2>PC secundário{rede?.nomeOutroPc ? ` (${rede.nomeOutroPc})` : ''}</h2>
              <div className="dica">
                Está na v{rede?.versaoOutroPc ?? outro?.versaoAtual ?? '?'}
                {outro?.status === 'baixando' ? ` · baixando ${outro.progresso ?? 0}%` : outro?.status === 'pronta' ? ' · instalando…' : outro?.status === 'disponivel' ? ` · v${outro.novaVersao} disponível` : ''}
                {rede?.versaoOutroPc && rede.versaoOutroPc !== info.versaoAtual ? ' · diferente deste PC' : ''}
              </div>
            </div>
            <button className="btn" onClick={atualizarOutro}>Atualizar o PC secundário</button>
          </div>
          {msgOutro && <div className="aviso">{msgOutro}</div>}
          <span className="dica">Atualiza o PC secundário daqui, sem precisar ir até ele. Ele fecha, instala, abre sozinho e reconecta.</span>
        </section>
      )}

      <section className="painel">
        <h2>De onde vêm as atualizações</h2>
        <label className="campo">
          Repositório no GitHub (usuario/repositorio)
          <input value={cfg.repoAtualizacao} onChange={(e) => salvar({ repoAtualizacao: e.target.value.trim() })} placeholder="ex.: seu-usuario/gerenciador-perfis" />
        </label>
        <span className="dica">Vamos configurar isso juntos: é onde eu publico as versões novas.</span>
      </section>
    </>
  )
}
