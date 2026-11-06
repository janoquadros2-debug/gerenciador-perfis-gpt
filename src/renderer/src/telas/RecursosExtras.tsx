import { useEffect, useState } from 'react'
import type { Configuracoes, RecursosExtras, RegistroOperacao } from '../../../shared/types'
import { chamar, useConfig } from '../api'
import { Opcao } from '../componentes'
import { confirmar } from '../confirmar'

const OPCOES: { chave: keyof RecursosExtras; nome: string; descricao: string }[] = [
  { chave: 'apiCursor', nome: 'Nova listagem por cursor (Dolphin)', descricao: 'Usa a API list-cursor. Pode exigir liberação na conta Dolphin; se falhar, desligue e confira a documentação da sua conta.' },
  { chave: 'retryLeituras', nome: 'Repetir leituras temporariamente indisponíveis', descricao: 'Uma nova tentativa apenas em consultas GET após erro de conexão, limite de API ou falha do servidor. Não repete ações de criação/alteração.' },
  { chave: 'diarioOperacoes', nome: 'Diário persistente de operações', descricao: 'Registra aberturas e seus resultados. Pendências após reinício ficam marcadas para revisão, sem executar comandos duplicados.' },
  { chave: 'historicoPersistente', nome: 'Guardar histórico por perfil', descricao: 'Preserva até 60 eventos por perfil no arquivo de dados local, para revisão após reabrir o aplicativo.' },
  { chave: 'categorizarFalhas', nome: 'Categorizar erros', descricao: 'Acrescenta classificação informativa: autenticação, proxy, Dolphin, conexão, página ou desconhecido.' },
  { chave: 'detectarIpsRepetidos', nome: 'Avisar IPs de saída repetidos', descricao: 'Compara os IPs já verificados dos navegadores abertos e alerta quando dois perfis têm o mesmo IP.' },
  { chave: 'historicoTestesProxy', nome: 'Histórico dos testes de proxy', descricao: 'Preserva até 20 resultados por proxy salvo; não altera a distribuição dos proxies.' },
  { chave: 'validadeProxyInformativa', nome: 'Mostrar tempo desde o primeiro uso do proxy', descricao: 'Marca a data do primeiro uso depois de ativar a opção. Não expira ou substitui proxies automaticamente.' },
  { chave: 'validarAbertura', nome: 'Validar conexão ao terminar abertura', descricao: 'Antes de registrar abertura como concluída, confirma que o navegador segue conectado e que a página carregou.' }
]

export function RecursosExtras() {
  const [cfg, salvar] = useConfig()
  const [operacoes, setOperacoes] = useState<RegistroOperacao[]>([])
  const [resultadoBackup, setResultadoBackup] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const carregar = () => chamar<RegistroOperacao[]>('operacoes').then(setOperacoes).catch(() => undefined)
  useEffect(() => { carregar() }, [])
  if (!cfg) return null
  const extras: RecursosExtras = { apiCursor:false, retryLeituras:false, diarioOperacoes:false, historicoPersistente:false,
    categorizarFalhas:false, detectarIpsRepetidos:false, historicoTestesProxy:false,
    validadeProxyInformativa:false, validarAbertura:false,
    ...(cfg.recursosExtras ?? {}) }
  const alterar = (chave: keyof RecursosExtras, valor: boolean) => {
    salvar({ recursosExtras: { ...extras, [chave]: valor } } as Partial<Configuracoes>)
  }

  const exportar = async () => {
    if (!(await confirmar('O backup inclui configurações, tokens e senhas de proxies salvos. Guarde o arquivo em local privado. Deseja exportar?'))) return
    setOcupado(true)
    try {
      const r = await chamar<{cancelado:boolean;caminho?:string}>('exportarBackupLocal')
      setResultadoBackup(r.cancelado ? 'Exportação cancelada.' : 'Backup salvo em: ' + r.caminho)
    } catch (e) {
      setResultadoBackup('Não foi possível exportar: ' + String(e instanceof Error ? e.message : e))
    } finally { setOcupado(false) }
  }

  return <section className="painel" style={{gap:16}}>
    <h2>Novos recursos opcionais</h2>
    <p className="sub">Tudo começa desligado. Ative apenas o que deseja testar. As funções antigas continuam disponíveis e não são substituídas.</p>
    <div style={{border:'1px solid var(--borda, #343442)',borderRadius:10,padding:'4px 12px'}}>
      {OPCOES.map((o) => <Opcao key={o.chave} titulo={o.nome} desc={o.descricao}
        ligada={extras[o.chave]} aoMudar={(v) => alterar(o.chave, v)} />)}
    </div>
    <section className="painel" style={{background:'transparent'}}>
      <h3>Backup dos dados deste computador</h3>
      <p className="dica">Exporta as configurações, proxies e preferências do Gerenciador em JSON. Não copia perfis armazenados pelo Dolphin na nuvem. O arquivo pode conter credenciais: mantenha-o privado.</p>
      <div className="linha"><button className="btn primario" disabled={ocupado} onClick={exportar}>{ocupado ? 'Exportando…' : 'Salvar backup local'}</button></div>
      {resultadoBackup && <span className="dica" role="status">{resultadoBackup}</span>}
    </section>
    <section className="painel" style={{background:'transparent'}}>
      <div className="linha">
        <h3>Diário de operações (últimas 300)</h3>
        <span className="espaco" />
        <button className="btn pequeno" onClick={carregar}>Atualizar lista</button>
        <button className="btn pequeno" disabled={!operacoes.some(x=>x.estado==='pendente')} onClick={async()=>{
          await chamar('marcarOperacoesRevisadas')
          carregar()
        }}>Marcar pendências para revisão</button>
      </div>
      <p className="dica">Após um reinício, as operações pendentes são marcadas para conferência manual. O sistema não as repete sozinho.</p>
      <div style={{maxHeight:250,overflow:'auto'}}>
        {operacoes.length === 0 ? <p className="dica">Nenhuma operação registrada. Habilite “Diário persistente de operações” para começar.</p> :
          [...operacoes].reverse().slice(0,30).map(x => <div key={x.id} className="linha" style={{borderBottom:'1px solid #30303a',padding:'8px 0',flexWrap:'wrap'}}>
            <strong>{x.tipo.toUpperCase()}</strong><span>{x.perfilNome ?? x.perfilId ?? 'Perfil'}</span>
            <span className="selo neutro">{x.estado}</span>
            <span className="dica">{new Date(x.atualizadoEm).toLocaleString('pt-BR')}</span>
            {x.detalhe && <span className="dica">{x.detalhe}</span>}
          </div>)}
      </div>
    </section>
  </section>
}
