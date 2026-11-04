// Configurações > ComfyUI: conexão, IAs instaladas (com explicação) e fluxos importados.
import { useEffect, useState } from 'react'
import type { ConfigPrompt, ModeloIA, ResumoFluxo, StatusIA } from '../../../../shared/types'
import { chamar } from '../../api'
import { confirmar } from '../../confirmar'
import { Modal } from '../../componentes'
import { limparErro, useFluxos, useModelos, useStatusIA } from './comum'

const GRUPOS: [ModeloIA['categoria'], string][] = [
  ['imagem', 'Para criar imagens'],
  ['video', 'Para criar/animar vídeos'],
  ['apoio', 'Complementos (usados junto com os outros)']
]

const resumoCampos = (f: ResumoFluxo) =>
  [
    f.campos.prompt.length && 'prompt',
    f.campos.negativo.length && 'negativo',
    f.campos.semente.length && 'semente',
    f.campos.largura.length && 'tamanho',
    f.campos.quantidade.length && 'quantidade',
    f.campos.imagem.length && 'imagem de entrada',
    f.campos.quadros.length && 'duração',
    f.campos.fps.length && 'fps'
  ]
    .filter(Boolean)
    .join(', ')

export default function ConfigComfy() {
  const st = useStatusIA()
  const [fluxos, recarregarFluxos] = useFluxos()
  const { lista: modelos, erro: erroModelos, recarregar } = useModelos(!!st?.conectado)
  const [endereco, setEndereco] = useState('')
  const [testando, setTestando] = useState(false)
  const [importando, setImportando] = useState<{ nome: string; json: string } | null>(null)
  const [verTodos, setVerTodos] = useState(false)

  const conectar = async () => {
    setTestando(true)
    await chamar<StatusIA>('iaConectar', endereco.trim() || undefined).finally(() => setTestando(false))
    recarregar()
  }

  return (
    <>
      <ConfigGeradorPrompt />
      <section className="painel">
        <h2>Conexão com o ComfyUI</h2>
        <div className="aviso" style={st?.conectado ? { borderColor: 'var(--verde-borda)', background: 'var(--verde-fundo)', color: '#bbf7d0' } : { color: '#ffb3c1' }}>
          {!st
            ? 'Verificando…'
            : st.conectado
              ? `Conectado ao ComfyUI ${st.versao ? `v${st.versao} ` : ''}em ${st.endereco}${st.placa ? ` · ${st.placa}` : ''}${st.vramTotalGb ? ` · ${st.vramTotalGb} GB de memória de vídeo` : ''}`
              : st.erro ?? 'Não conectado.'}
        </div>
        <div className="linha" style={{ alignItems: 'flex-end' }}>
          <label className="campo" style={{ flex: '1 1 260px' }}>
            Endereço (deixe vazio para procurar sozinho)
            <input className="mono" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder={st?.endereco ?? 'http://127.0.0.1:8188'} />
          </label>
          <button className="btn primario" disabled={testando} onClick={conectar}>{testando ? 'Procurando…' : 'Conectar'}</button>
        </div>
        <span className="dica">
          O ComfyUI precisa estar aberto no PC secundário (onde fica a placa de vídeo). O programa procura em http://127.0.0.1:8188 (ComfyUI normal) e http://127.0.0.1:8000 (ComfyUI Desktop).
        </span>
      </section>

      <section className="painel">
        <div className="linha" style={{ justifyContent: 'space-between' }}>
          <h2>IAs instaladas no ComfyUI</h2>
          <button className="btn pequeno" disabled={!st?.conectado} onClick={recarregar}>Atualizar lista</button>
        </div>
        {erroModelos && <div className="aviso" style={{ color: '#ffb3c1' }}>{erroModelos}</div>}
        {!modelos && st?.conectado && !erroModelos && <div className="dica">Lendo os modelos…</div>}
        {modelos &&
          GRUPOS.map(([cat, titulo]) => {
            const lista = modelos.filter((m) => m.categoria === cat)
            if (!lista.length) return null
            const mostrar = cat === 'apoio' && !verTodos ? lista.slice(0, 6) : lista
            return (
              <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong style={{ fontSize: 13, color: 'var(--texto-2)' }}>{titulo} · {lista.length}</strong>
                <div className="tabela-caixa">
                  <table>
                    <tbody>
                      {mostrar.map((m) => (
                        <tr key={m.pasta + m.arquivo}>
                          <td style={{ width: 170 }}><span className="selo neutro">{m.familia}</span></td>
                          <td className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{m.arquivo}</td>
                          <td className="dica" style={{ color: 'var(--texto-2)' }}>{m.uso}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {cat === 'apoio' && lista.length > 6 && (
                  <button className="btn pequeno" style={{ alignSelf: 'flex-start' }} onClick={() => setVerTodos(!verTodos)}>{verTodos ? 'Mostrar menos' : `Ver todos (${lista.length})`}</button>
                )}
              </div>
            )
          })}
        {modelos && !modelos.length && <div className="vazio">Nenhum modelo encontrado nas pastas do ComfyUI.</div>}
        <span className="dica">A explicação vem do nome do arquivo. Se algum estiver errado ou genérico, me mande a lista que eu ajusto.</span>
      </section>

      <section className="painel">
        <div className="linha" style={{ justifyContent: 'space-between' }}>
          <h2>Fluxos</h2>
          <label className="btn primario pequeno">
            Importar fluxo (.json)
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setImportando({ nome: f.name.replace(/\.json$/i, ''), json: await f.text() })
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <span className="dica" style={{ lineHeight: 1.7 }}>
          Para usar um fluxo seu: no ComfyUI, abra o fluxo e clique em <strong>Workflow &gt; Export (API)</strong>. Se essa opção não aparecer, ative <strong>Dev mode</strong> nas configurações (engrenagem) e use <strong>Save (API Format)</strong>.
        </span>
        <div className="tabela-caixa">
          <table>
            <tbody>
              {fluxos.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.nome}</strong></td>
                  <td><span className="selo neutro">{f.tipo === 'video' ? 'Animar' : 'Imagem'}</span></td>
                  <td className="dica">Campos: {resumoCampos(f) || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {f.embutido ? (
                      <span className="dica">já vem no programa</span>
                    ) : (
                      <button className="btn pequeno perigo" onClick={async () => (await confirmar(`Remover o fluxo "${f.nome}"?`, { perigo: true })) && chamar('iaApagarFluxo', f.id).then(recarregarFluxos)}>Remover</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {importando && <Importar inicial={importando} aoFechar={() => { setImportando(null); recarregarFluxos() }} />}
    </>
  )
}

function Importar({ inicial, aoFechar }: { inicial: { nome: string; json: string }; aoFechar: () => void }) {
  const [nome, setNome] = useState(inicial.nome)
  const [tipo, setTipo] = useState<'imagem' | 'video'>(/vid|i2v|anim|wan|ltx|svd|hunyuan/i.test(inicial.nome + inicial.json.slice(0, 20000)) ? 'video' : 'imagem')
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState<ResumoFluxo | null>(null)

  const importar = async () => {
    setErro('')
    try {
      setPronto(await chamar<ResumoFluxo>('iaImportarFluxo', { nome, tipo, json: inicial.json }))
    } catch (e) {
      setErro(limparErro(e))
    }
  }

  return (
    <Modal titulo="Importar fluxo" sub="O programa acha sozinho onde ficam o prompt, a imagem e as outras opções." aoFechar={aoFechar}>
      {pronto ? (
        <>
          <div className="aviso" style={{ borderColor: 'var(--verde-borda)', background: 'var(--verde-fundo)', color: '#bbf7d0' }}>
            "{pronto.nome}" importado! Campos que o programa vai controlar: {resumoCampos(pronto)}.
          </div>
          <span className="dica">Ele já aparece na aba {pronto.tipo === 'video' ? 'Animar' : 'Criar imagens'}. O resto das configurações (modelo, passos etc.) fica como está no seu fluxo.</span>
          <div className="linha" style={{ justifyContent: 'flex-end' }}><button className="btn primario" onClick={aoFechar}>Fechar</button></div>
        </>
      ) : (
        <>
          <label className="campo">Nome<input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <div className="campo">
            Para que serve
            <div className="escolhas">
              <label className={`escolha ${tipo === 'imagem' ? 'marcada' : ''}`}><input type="radio" checked={tipo === 'imagem'} onChange={() => setTipo('imagem')} />Criar imagens</label>
              <label className={`escolha ${tipo === 'video' ? 'marcada' : ''}`}><input type="radio" checked={tipo === 'video'} onChange={() => setTipo('video')} />Animar (imagem para vídeo)</label>
            </div>
          </div>
          {erro && <div className="aviso" style={{ color: '#ffb3c1' }}>{erro}</div>}
          <div className="linha" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={aoFechar}>Cancelar</button>
            <button className="btn primario" disabled={!nome.trim()} onClick={importar}>Importar</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------- Gerador de prompt: grátis (PC secundário) ou Claude (chave paga à parte) ----------
function ConfigGeradorPrompt() {
  const [c, setC] = useState<ConfigPrompt | null>(null)
  const [chave, setChave] = useState('')
  const [teste, setTeste] = useState('')
  useEffect(() => {
    chamar<ConfigPrompt>('promptConfig').then((x) => {
      setC(x)
      setChave(x.claudeChave)
    })
  }, [])
  if (!c) return null
  const salvar = async (p: Partial<ConfigPrompt>) => setC(await chamar<ConfigPrompt>('salvarPromptConfig', p))
  const testar = async () => {
    setTeste('Testando…')
    try {
      const r = await chamar<{ prompt: string; motor?: string }>('gerarPrompt', { tipo: 'imagem', texto: 'um gato laranja dormindo numa janela com chuva lá fora' })
      setTeste(`Funcionou (${r.motor}): ${r.prompt.slice(0, 220)}`)
    } catch (e) {
      setTeste(limparErro(e))
    }
  }
  return (
    <section className="painel">
      <h2>Gerador de prompt (português → inglês)</h2>
      <span className="dica">É o botão "✨ Criar prompt com IA" das abas Criar imagens, Animar e Música. Escolha qual IA escreve os prompts:</span>
      <div className="linha" style={{ gap: 8 }}>
        <button className={`pilula ${c.motor === 'local' ? 'ativa' : ''}`} onClick={() => salvar({ motor: 'local' })}>Grátis (PC secundário)</button>
        <button className={`pilula ${c.motor === 'claude' ? 'ativa' : ''}`} onClick={() => salvar({ motor: 'claude' })}>Claude (pago à parte)</button>
      </div>
      {c.motor === 'local' ? (
        <span className="dica">Usa o modelo de texto Qwen3 que já está no ComfyUI. Não custa nada; leva de 10 a 40 s e espera na fila se o ComfyUI estiver gerando uma imagem.</span>
      ) : (
        <>
          <label className="campo">
            Chave da API do Claude
            <input type="password" value={chave} onChange={(e) => setChave(e.target.value)} onBlur={() => chave !== c.claudeChave && salvar({ claudeChave: chave.trim() })} placeholder="sk-ant-..." />
          </label>
          <label className="campo">
            Modelo
            <select value={c.claudeModelo} onChange={(e) => salvar({ claudeModelo: e.target.value })}>
              <option value="claude-haiku-5-5">Haiku 5.5: rápido e baratíssimo (menos de 1 centavo por prompt)</option>
              <option value="claude-sonnet-5-5">Sonnet 5.5: escreve melhor, ótimo para letras (uns centavos por prompt)</option>
            </select>
          </label>
          <span className="dica" style={{ lineHeight: 1.7 }}>
            Como pegar a chave (uma vez só): 1. Entre em console.anthropic.com e crie a conta. 2. Em <strong>Billing</strong>, coloque um crédito (é pré-pago e separado da sua assinatura do Claude). 3. Em <strong>API Keys</strong>, clique em <strong>Create Key</strong>, copie e cole aqui. A chave fica só neste PC.
          </span>
        </>
      )}
      <div className="linha" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn" onClick={() => salvar({ claudeChave: chave.trim() }).then(testar)}>Testar</button>
        {teste && <span className="dica" style={{ flex: 1 }}>{teste}</span>}
      </div>
    </section>
  )
}
