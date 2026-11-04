// Aba Música: o Suno com a sua conta.
// O Google não deixa fazer login dentro de programas, então o Suno abre no Google Chrome de verdade
// (um perfil só para o Suno). O programa conversa com essa janela para gerar e guardar as músicas.
// Modo 1 (site): você usa o Suno normalmente na janela do Chrome; as prontas vêm para a galeria.
// Modo 2 (gerar direto): você escreve aqui e o programa pede ao Suno (caminho NÃO oficial).
import { useEffect, useRef, useState } from 'react'
import type { ItemGaleria } from '../../../../shared/types'
import { chamar, ouvir } from '../../api'
import { confirmar } from '../../confirmar'
import { Chave } from '../../componentes'
import { limparErro, useGaleria } from './comum'
import { GeradorPrompt } from './GeradorPrompt'

// nomes internos dos modelos do Suno (se o Suno mudar, dá para escrever outro na tela)
// (antes de o programa aprender com o site; depois ele usa os modelos que o próprio site usou)
const MODELOS: [string, string][] = [
  ['chirp-crow', 'v5'],
  ['chirp-auk', 'v4.5'],
  ['chirp-v4', 'v4']
]

interface PedidoAprendido {
  quando: number
  corpo: Record<string, any>
  caminho: string
  modelos: string[]
}
// mostra as opções aprendidas de um jeito legível (sem os textos)
const TEXTOS = ['prompt', 'gpt_description_prompt', 'tags', 'title', 'token', 'negative_tags']
// ---------- opções avançadas (Weirdness, Style Influence…) ----------
// O Suno não publica os nomes internos dessas opções; o programa acha cada uma no pedido aprendido do site.
interface Ajuste {
  id: string
  rotulo: string
  tipo: 'porcentagem' | 'liga' | 'escolha' | 'texto'
  opcoes?: [string, string][]
  re: RegExp
  dica?: string
}
const AJUSTES: Ajuste[] = [
  { id: 'genero', rotulo: 'Vocal Gender (voz)', tipo: 'escolha', re: /vocal_?gender/i, opcoes: [['', 'Automático'], ['m', 'Masculina'], ['f', 'Feminina']] },
  { id: 'excluir', rotulo: 'Exclude styles (estilos para evitar)', tipo: 'texto', re: /negative_tags|exclude/i, dica: 'ex.: heavy metal, autotune' },
  { id: 'max', rotulo: 'Max Mode', tipo: 'liga', re: /max_?mode/i },
  { id: 'weird', rotulo: 'Weirdness (ousadia)', tipo: 'porcentagem', re: /weird/i },
  { id: 'estilo', rotulo: 'Style Influence (força do estilo)', tipo: 'porcentagem', re: /style_?(weight|influence)/i },
  { id: 'variedade', rotulo: 'Variety (variedade)', tipo: 'porcentagem', re: /variety|audio_?weight|diversity/i },
  { id: 'personalizar', rotulo: 'Personalize (My Taste)', tipo: 'liga', re: /personaliz|my_?taste/i }
]
// acha o "caminho" de cada opção no pedido (ex.: metadata.control_sliders.weirdness_constraint)
function caminhos(c: Record<string, any>): Record<string, string[]> {
  const achados: Record<string, string[]> = {}
  const passar = (o: Record<string, any>, pre: string[]) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) passar(v, [...pre, k])
      else for (const a of AJUSTES) if (!achados[a.id] && a.re.test(k)) achados[a.id] = [...pre, k]
    }
  }
  passar(c, [])
  return achados
}
const pegar = (o: any, cam: string[]) => cam.reduce((x, k) => x?.[k], o)
const por = (o: any, cam: string[], v: any) => {
  let x = o
  for (const k of cam.slice(0, -1)) x = x[k] ??= {}
  x[cam[cam.length - 1]] = v
}
// valores do pedido → tela (0-1 vira %) e tela → pedido
function paraTela(a: Ajuste, v: any): any {
  if (a.tipo === 'porcentagem') return typeof v === 'number' ? Math.round(v <= 1 ? v * 100 : v) : 50
  if (a.tipo === 'liga') return v === true || v === 'on' || v === 1
  if (a.tipo === 'escolha') return typeof v === 'string' ? v.slice(0, 1).toLowerCase() : ''
  return v ?? ''
}
function paraPedido(a: Ajuste, v: any, original: any): any {
  if (a.tipo === 'porcentagem') return typeof original === 'number' && original > 1 ? v : +(v / 100).toFixed(2)
  if (a.tipo === 'liga') return typeof original === 'string' ? (v ? 'on' : 'off') : typeof original === 'number' ? (v ? 1 : 0) : !!v
  if (a.tipo === 'escolha') {
    if (!v) return typeof original === 'string' && original.length > 1 ? '' : null
    return typeof original === 'string' && original.length > 1 ? (v === 'm' ? 'male' : 'female') : v
  }
  return v
}

function resumoOpcoes(c: Record<string, any>): string[] {
  const out: string[] = []
  const passar = (o: Record<string, any>, pre = '') => {
    for (const [k, v] of Object.entries(o)) {
      if (TEXTOS.includes(k) || v === null || v === undefined || v === '') continue
      if (typeof v === 'object' && !Array.isArray(v)) passar(v, `${pre}${k}.`)
      else out.push(`${pre}${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    }
  }
  passar(c)
  return out
}

interface Clipe {
  id: string
  title?: string
  status?: string
  audio_url?: string
  image_url?: string
  image_large_url?: string
  created_at?: string
  metadata?: { prompt?: string; tags?: string; gpt_description_prompt?: string; error_message?: string }
}
interface Resposta {
  login: boolean
  status?: number
  json?: any
  texto?: string
}
interface StatusSuno {
  navegador: string | null
  aberto: 'login' | 'janela' | 'fundo' | null
}

// guarda escolhas simples só neste PC
const ler = <T,>(k: string, padrao: T): T => {
  try {
    const v = localStorage.getItem(`suno.${k}`)
    return v === null ? padrao : (JSON.parse(v) as T)
  } catch {
    return padrao
  }
}
const gravar = (k: string, v: unknown) => {
  try {
    localStorage.setItem(`suno.${k}`, JSON.stringify(v))
  } catch {
    /* sem problema */
  }
}

const api = (caminho: string, metodo?: string, corpo?: unknown) => chamar<Resposta>('sunoApi', caminho, metodo, corpo)

export default function Musica() {
  const [st, setSt] = useState<StatusSuno | null>(null)
  const [logado, setLogado] = useState<boolean | null>(null)
  const [conferindo, setConferindo] = useState(false)
  const [creditos, setCreditos] = useState<number | null>(null)
  const [modo, setModo] = useState<'site' | 'direto'>(() => ler('modo', 'site'))
  const [autoGuardar, setAutoGuardar] = useState<boolean>(() => ler('autoGuardar', true))
  const [desde] = useState<number>(() => {
    const d = ler<number>('desde', 0)
    if (d) return d
    const agora = Date.now()
    gravar('desde', agora)
    return agora
  })
  const [aviso, setAviso] = useState('')
  const [musicas] = useGaleria('audio')

  // formulário do modo 2
  const [tipo, setTipo] = useState<'descricao' | 'letra'>(() => ler('tipo', 'descricao'))
  const [descricao, setDescricao] = useState('')
  const [letra, setLetra] = useState('')
  const [estilo, setEstilo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [instrumental, setInstrumental] = useState(false)
  const [modelo, setModelo] = useState<string>(() => ler('modelo', 'chirp-crow'))
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [podePreencher, setPodePreencher] = useState(false)
  const [emAndamento, setEmAndamento] = useState<Clipe[]>([])
  const ocupado = useRef(false)
  const motivo = useRef('')
  const avisouFeed = useRef(false)
  const [ajustes, setAjustes] = useState<Record<string, any>>(() => ler('ajustes', {}))
  useEffect(() => gravar('ajustes', ajustes), [ajustes])
  const [pedido, setPedido] = useState<PedidoAprendido | null>(null)
  useEffect(() => {
    chamar<PedidoAprendido | null>('sunoPedido').then((p) => {
      setPedido(p)
      if (p?.corpo?.mv && !MODELOS.some(([m]) => m === p.corpo.mv) && !ler('modeloEscolhido', false)) setModelo(p.corpo.mv)
    }).catch(() => undefined)
    return ouvir('suno-pedido', (p: PedidoAprendido) => {
      setPedido(p)
      if (p?.corpo?.mv) setModelo(p.corpo.mv)
    })
  }, [])

  useEffect(() => gravar('modo', modo), [modo])
  useEffect(() => {
    gravar('autoGuardar', autoGuardar)
    chamar('sunoGuardarSozinho', autoGuardar).catch(() => undefined)
  }, [autoGuardar])
  useEffect(() => gravar('tipo', tipo), [tipo])
  useEffect(() => gravar('modelo', modelo), [modelo])

  useEffect(() => {
    chamar<StatusSuno>('sunoStatus').then(setSt).catch(() => undefined)
    return ouvir('suno-status', setSt)
  }, [])

  // Confere se o login deu certo (liga o Chrome do Suno escondido, se precisar).
  const conferirConta = async () => {
    setConferindo(true)
    try {
      const r = await api('/api/billing/info/')
      const ok = r.login && r.status !== 401 && r.status !== 403
      motivo.current = r.login ? `o Suno respondeu ${r.status}: ${r.texto ?? ''}` : r.texto ?? ''
      setLogado(ok)
      if (ok) gravar('jaEntrou', true)
      const c = r.json?.total_credits_left ?? r.json?.credits_left ?? r.json?.credits
      setCreditos(typeof c === 'number' ? c : null)
      return ok
    } catch (e) {
      setAviso(limparErro(e))
      return false
    } finally {
      setConferindo(false)
    }
  }

  // se você já entrou antes, confere sozinho ao abrir a aba
  useEffect(() => {
    if (ler('jaEntrou', false)) conferirConta()
  }, [])

  const entrar = async () => {
    setAviso('')
    try {
      await chamar('sunoEntrar')
    } catch (e) {
      setAviso(limparErro(e))
    }
  }
  const jaEntrei = async () => {
    await chamar('sunoFechar')
    const ok = await conferirConta()
    setAviso(
      ok
        ? 'Pronto! Você está conectado ao Suno.'
        : `Ainda não achei o login. Clique em "Entrar com Google", entre de novo e espere a sua conta aparecer no Suno antes de fechar a janela do Chrome. (Detalhe para o suporte: ${motivo.current.slice(0, 220) || 'sem detalhe'})`
    )
  }

  const salvar = async (c: Clipe) => {
    await chamar<ItemGaleria | null>('sunoSalvar', {
      id: c.id,
      titulo: c.title ?? '',
      audioUrl: c.audio_url && !/audiopipe/.test(c.audio_url) ? c.audio_url : `https://cdn1.suno.ai/${c.id}.mp3`,
      capaUrl: c.image_large_url ?? c.image_url,
      prompt: [c.metadata?.gpt_description_prompt, c.metadata?.tags && `Estilo: ${c.metadata.tags}`, c.metadata?.prompt].filter(Boolean).join('\n\n')
    })
  }

  // Guarda sozinho as músicas novas que ficarem prontas (as feitas no site ou pelo modo direto).
  const guardarNovas = async (ids?: string[]) => {
    if (ocupado.current) return
    ocupado.current = true
    try {
      const r = await api(ids?.length ? `/api/feed/v2?ids=${ids.join(',')}` : '/api/feed/v2?page=0')
      if (!r.login) return setLogado(false)
      const clipes: Clipe[] = r.json?.clips ?? (Array.isArray(r.json) ? r.json : [])
      if (!Array.isArray(clipes) || (r.status && r.status >= 400)) {
        if (!avisouFeed.current) {
          avisouFeed.current = true
          chamar('sunoLog', `Lista de músicas do Suno respondeu ${r.status}: ${String(r.texto ?? '').slice(0, 200)}`)
        }
        return
      }
      const ja = new Set(await chamar<string[]>('sunoJaSalvos'))
      for (const c of clipes) {
        const nova = ids?.includes(c.id) || (c.created_at ? Date.parse(c.created_at) >= desde : false)
        if (c.status === 'complete' && nova && !ja.has(c.id)) {
          try {
            await salvar(c)
          } catch (e) {
            setAviso(`Não consegui salvar "${c.title}": ${limparErro(e)}`)
          }
        }
      }
      if (ids?.length) setEmAndamento((atual) => atual.map((a) => clipes.find((c) => c.id === a.id) ?? a))
    } catch {
      /* o Chrome do Suno foi fechado: tenta de novo depois */
    } finally {
      ocupado.current = false
    }
  }

  // a cada 20 s confere o que ficou pronto (só com o Chrome do Suno aberto)
  const ligado = logado === true && (st?.aberto === 'janela' || st?.aberto === 'fundo')
  useEffect(() => {
    if (!ligado) return
    const rodar = () => {
      const pendentes = emAndamento.filter((c) => c.status !== 'complete' && c.status !== 'error').map((c) => c.id)
      if (pendentes.length) guardarNovas(pendentes)
      else if (autoGuardar) guardarNovas()
    }
    const t = setInterval(rodar, 20_000)
    return () => clearInterval(t)
  }, [ligado, autoGuardar, emAndamento])

  // ----- modo 2: gerar direto -----
  const gerar = async () => {
    setErro('')
    setPodePreencher(false)
    if (tipo === 'descricao' && !descricao.trim()) return setErro('Descreva a música que você quer.')
    if (tipo === 'letra' && !estilo.trim() && !letra.trim()) return setErro('Escreva a letra e/ou o estilo.')
    setEnviando(true)
    try {
      // com o pedido aprendido do site: usa ele como base (mesmas opções avançadas) e troca só os textos
      const base: Record<string, any> = pedido ? JSON.parse(JSON.stringify(pedido.corpo)) : { generation_type: 'TEXT' }
      const corpo: Record<string, any> =
        tipo === 'descricao'
          ? { ...base, gpt_description_prompt: descricao.trim(), prompt: '', tags: '', title: '' }
          : { ...base, prompt: instrumental ? '' : letra, tags: estilo.trim(), title: titulo.trim() }
      if (tipo === 'letra') delete corpo.gpt_description_prompt
      corpo.make_instrumental = instrumental
      corpo.mv = modelo
      corpo.token = null
      // opções avançadas escolhidas na tela
      if (pedido) {
        const cams = caminhos(pedido.corpo)
        for (const a of AJUSTES) {
          const cam = cams[a.id]
          if (!cam) continue
          // instrumental: sem voz, então a voz fica em "automático"
          if (a.id === 'genero' && instrumental) por(corpo, cam, paraPedido(a, '', pegar(pedido.corpo, cam)))
          else if (ajustes[a.id] !== undefined) por(corpo, cam, paraPedido(a, ajustes[a.id], pegar(pedido.corpo, cam)))
        }
      }
      const r = await api(pedido?.caminho ?? '/api/generate/v2/', 'POST', corpo)
      if (!r.login) {
        setLogado(false)
        throw new Error('Você ainda não entrou na sua conta do Suno. Use o botão "Entrar com Google" lá em cima.')
      }
      const clipes: Clipe[] = r.json?.clips ?? []
      if (!r.status || r.status >= 400 || !clipes.length) {
        setPodePreencher(true)
        const motivo = r.json?.detail ?? r.texto ?? `erro ${r.status}`
        throw new Error(
          /captcha|token/i.test(String(motivo))
            ? 'O Suno pediu a verificação "não sou um robô". Use "Preencher no site": eu passo o texto para o site e você clica em Create.'
            : `O Suno recusou o pedido direto (${String(motivo).slice(0, 160)}). Você pode usar "Preencher no site".`
        )
      }
      setEmAndamento((atual) => [...clipes, ...atual].slice(0, 8))
      chamar('sunoNovas', clipes.map((c) => c.id)).catch(() => undefined)
      chamar('sunoLog', `Pedido direto enviado ao Suno: ${clipes.length} música(s).`)
      setTimeout(conferirConta, 3000)
    } catch (e) {
      setErro(limparErro(e))
    } finally {
      setEnviando(false)
    }
  }

  // Plano B: abre o site no Chrome, escreve o texto nos campos e você só clica em "Create".
  const preencherNoSite = async () => {
    try {
      const ok = await chamar<string[]>('sunoPreencher', tipo === 'descricao' ? { descricao } : { letra, estilo, titulo })
      setAviso(
        ok.length
          ? `Preenchi: ${ok.join(', ')}. Confira na janela do Chrome e clique em "Create". A música vem para cá quando ficar pronta.`
          : 'Não achei os campos no site. Na janela do Chrome, abra a página "Create" do Suno (no modo Custom para letra e estilo) e tente de novo.'
      )
    } catch (e) {
      setAviso(`Não consegui preencher: ${limparErro(e)}`)
    }
  }

  const guardarUltimas = async () => {
    if (!(await confirmar('Guardar na galeria as músicas prontas da sua conta do Suno? As que já estão na galeria são puladas.'))) return
    setAviso('Procurando as suas músicas…')
    try {
      // 1º: as que o site do Suno já mostrou (é o jeito que sempre funciona)
      const v = await chamar<{ vistas: number; salvas: number; falharam: number }>('sunoPuxarVistas')
      let n = v.salvas
      let erroUltimo = ''
      // 2º: pergunta a lista à parte (caminho antigo; pode não funcionar mais)
      if (!v.vistas) {
        const r = await api('/api/feed/v2?page=0').catch(() => null)
        const clipes: Clipe[] = r?.json?.clips ?? []
        const ja = new Set(await chamar<string[]>('sunoJaSalvos'))
        for (const c of clipes)
          if (c.status === 'complete' && !ja.has(c.id)) {
            try {
              await salvar(c)
              n++
            } catch (e) {
              erroUltimo = limparErro(e)
            }
          }
        if (!clipes.length) {
          await chamar('sunoAbrir').catch(() => undefined)
          return setAviso('Abri o Suno no Chrome. Espere a página carregar (pode abrir a sua biblioteca, em "Library") e clique em "Puxar as últimas do Suno" de novo.')
        }
      }
      setAviso(
        n
          ? `${n} música(s) guardada(s) na galeria.${v.falharam ? ` ${v.falharam} não baixaram: veja o motivo na aba Logs.` : ''}`
          : v.falharam || erroUltimo
            ? `Achei as músicas, mas o download falhou. Motivo: ${erroUltimo || 'veja a aba Logs (filtre por Suno)'}`
            : 'Nenhuma música nova para guardar.'
      )
    } catch (e) {
      setAviso(limparErro(e))
    }
  }

  const semNavegador = st && !st.navegador
  // modelos: os que o site já usou (aprendidos) primeiro
  const opcoesModelo: [string, string][] = pedido?.modelos.length
    ? [...pedido.modelos.map((m) => [m, m === pedido.corpo.mv ? `${m} (o último usado no site)` : m] as [string, string]), ...MODELOS.filter(([m]) => !pedido.modelos.includes(m))]
    : MODELOS

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Música</h1>
          <p className="sub">O Suno com a sua conta. As músicas prontas vão para a galeria daqui.</p>
        </div>
        <div className="linha" style={{ gap: 8 }}>
          {logado && <span className="selo ok">Conectado{creditos !== null ? ` · ${creditos} créditos` : ''}</span>}
          <button className={`pilula ${modo === 'site' ? 'ativa' : ''}`} onClick={() => setModo('site')}>Usar o site</button>
          <button className={`pilula ${modo === 'direto' ? 'ativa' : ''}`} onClick={() => setModo('direto')}>Gerar direto</button>
        </div>
      </div>

      {aviso && (
        <div className="aviso" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{aviso}</span>
          <button className="btn pequeno" onClick={() => setAviso('')}>OK</button>
        </div>
      )}

      {semNavegador && (
        <div className="faixa-pausa" style={{ background: '#3a121b', borderColor: 'var(--vermelho-borda)', color: '#ffc2cd' }}>
          Não achei o Google Chrome neste PC. Instale o Chrome (google.com/chrome) e volte aqui.
        </div>
      )}

      {logado !== true && (
        <section className="painel">
          <h2>Entrar na sua conta do Suno</h2>
          <p className="sub" style={{ marginTop: 0, lineHeight: 1.75 }}>
            O Google não deixa fazer login dentro de programas, por isso o login é feito numa janela do <strong>Google Chrome</strong> (separada do seu Chrome de sempre). É só uma vez:
            <br />1. Clique em <strong>Entrar com Google</strong>. Abre uma janela do Chrome no site do Suno.
            <br />2. Lá, clique em <strong>Sign in</strong> e entre com o Google, como você sempre faz.
            <br />3. Quando aparecer a sua conta no Suno, <strong>feche essa janela do Chrome</strong>.
            <br />4. Volte aqui e clique em <strong>Já entrei</strong>.
          </p>
          <div className="linha" style={{ gap: 8 }}>
            <button className="btn primario" disabled={!!semNavegador || st?.aberto === 'login'} onClick={entrar}>
              {st?.aberto === 'login' ? 'Janela de login aberta…' : 'Entrar com Google'}
            </button>
            <button className="btn" disabled={conferindo} onClick={jaEntrei}>{conferindo ? 'Conferindo…' : 'Já entrei'}</button>
          </div>
        </section>
      )}

      {modo === 'site' && logado === true && (
        <section className="painel">
          <h2>Usar o site do Suno</h2>
          <p className="sub" style={{ marginTop: 0, lineHeight: 1.75 }}>
            Abre o Suno numa janela do Chrome, já com a sua conta. Crie as músicas normalmente lá: quando ficarem prontas, elas vêm para "Minhas músicas" aqui embaixo sozinhas (com o programa aberto). Se você clicar em Download no site, o arquivo também cai na galeria.
          </p>
          <GeradorPrompt
            tipo="musica"
            aoUsar={(r) => {
              const tudo = [r.titulo && `Título: ${r.titulo}`, `Estilo: ${r.estilo ?? r.prompt}`, r.letra && `Letra:\n${r.letra}`].filter(Boolean).join('\n\n')
              navigator.clipboard.writeText(tudo).catch(() => undefined)
              setAviso('Copiei título, estilo e letra. No site do Suno, cole cada parte no campo certo (Advanced: Lyrics, Styles e Song Title). Ou use o "Gerar direto", que preenche tudo sozinho.')
            }}
          />
          <div className="linha" style={{ gap: 8 }}>
            <button className="btn primario" onClick={() => chamar('sunoAbrir').catch((e) => setAviso(limparErro(e)))}>
              {st?.aberto === 'janela' ? 'Suno aberto no Chrome' : 'Abrir o Suno'}
            </button>
            {st?.aberto && <button className="btn" onClick={() => chamar('sunoFechar')}>Fechar o Suno</button>}
          </div>
        </section>
      )}

      {modo === 'direto' && (
        <section className="painel">
          <div className="faixa-pausa" style={{ background: '#2a2140', borderColor: '#4a3a78' }}>
            Modo direto: usa um caminho que não é oficial do Suno. Pode parar de funcionar se o site mudar. Use com moderação (nada de centenas seguidas), para não arriscar a sua conta. Se falhar, o "Usar o site" sempre funciona.
          </div>
          {pedido ? (
            <div className="trabalho" style={{ display: 'grid', gap: 6 }}>
              <div className="linha" style={{ justifyContent: 'space-between' }}>
                <strong>Usando as opções do seu último pedido no site</strong>
                <span className="dica">aprendido em {new Date(pedido.quando).toLocaleString('pt-BR')}</span>
              </div>
              <span className="dica">
                Modelo, Weirdness, Style Influence, Vocal Gender, Max Mode e as outras opções avançadas ficam iguais às do último Create que você fez no site. Para mudar, faça uma música no site com as opções novas: o programa aprende sozinho.
              </span>
              <span className="dica mono" style={{ fontSize: 11, lineHeight: 1.6 }}>{resumoOpcoes(pedido.corpo).join(' · ').slice(0, 600)}</span>
            </div>
          ) : (
            <div className="trabalho" style={{ display: 'grid', gap: 8 }}>
              <strong>Ensine o programa uma vez (para usar a v6 e as opções avançadas)</strong>
              <span className="dica" style={{ lineHeight: 1.7 }}>
                1. Clique em <strong>Abrir o Suno</strong> (abre o site no Chrome).
                <br />2. Faça <strong>uma</strong> música lá do jeito que você gosta: escolha v6, Advanced, Weirdness, Style Influence, Vocal Gender… e clique em Create.
                <br />3. Pronto: o programa copia essas opções e o "Gerar direto" passa a usar a v6 com elas.
              </span>
              <div><button className="btn" onClick={() => chamar('sunoAbrir').catch((e) => setAviso(limparErro(e)))}>Abrir o Suno</button></div>
            </div>
          )}
          <div className="linha" style={{ gap: 6 }}>
            <button className={`pilula ${tipo === 'descricao' ? 'ativa' : ''}`} onClick={() => setTipo('descricao')}>Descrever a música</button>
            <button className={`pilula ${tipo === 'letra' ? 'ativa' : ''}`} onClick={() => setTipo('letra')}>Letra + estilo</button>
          </div>
          <GeradorPrompt
            tipo="musica"
            aoUsar={(r) => {
              // a IA faz título, estilo e letra: vai para o modo "Letra + estilo"
              setTipo('letra')
              if (r.titulo) setTitulo(r.titulo)
              setEstilo((r.estilo ?? r.prompt).slice(0, 200))
              if (r.letra && !/^\[instrumental\]$/i.test(r.letra.trim())) {
                setLetra(r.letra)
                setInstrumental(false)
              } else if (r.letra) setInstrumental(true)
            }}
          />
          {tipo === 'descricao' ? (
            <label className="campo">
              Descreva a música (pode ser em português)
              <textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} style={{ fontFamily: 'inherit', fontSize: 14 }} placeholder="ex.: funk animado sobre uma live de jogos à noite, voz feminina, refrão marcante" />
            </label>
          ) : (
            <>
              <label className="campo">
                Título
                <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} placeholder="ex.: Madrugada na Live" />
              </label>
              <label className="campo">
                Estilo
                <input value={estilo} onChange={(e) => setEstilo(e.target.value)} maxLength={200} placeholder="ex.: brazilian funk, female vocals, energetic, 128 bpm" />
              </label>
              {!instrumental && (
                <label className="campo">
                  Letra
                  <textarea rows={8} value={letra} onChange={(e) => setLetra(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 14 }} placeholder={'[Verso]\n...\n[Refrão]\n...'} />
                </label>
              )}
            </>
          )}
          <div className="linha" style={{ gap: 14, alignItems: 'center' }}>
            <span className="linha" style={{ gap: 8, alignItems: 'center' }}>
              <Chave ligada={instrumental} aoMudar={setInstrumental} rotulo="Instrumental" /> Instrumental (sem voz)
            </span>
            <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              Modelo
              <select
                value={opcoesModelo.some(([m]) => m === modelo) ? modelo : 'outro'}
                onChange={(e) => {
                  gravar('modeloEscolhido', true)
                  setModelo(e.target.value === 'outro' ? '' : e.target.value)
                }}
              >
                {opcoesModelo.map(([m, n]) => <option key={m} value={m}>{n}</option>)}
                <option value="outro">Outro…</option>
              </select>
              {!opcoesModelo.some(([m]) => m === modelo) && <input value={modelo} onChange={(e) => setModelo(e.target.value.trim())} placeholder="nome interno" style={{ width: 140 }} />}
            </label>
          </div>
          <OpcoesAvancadas pedido={pedido} instrumental={instrumental} ajustes={ajustes} aoMudar={(id, v) => setAjustes((a) => ({ ...a, [id]: v }))} aoZerar={() => setAjustes({})} />
          <span className="dica">Cada pedido gera 2 músicas e gasta créditos da sua conta, igual ao site. O programa usa o Chrome do Suno escondido para isso.</span>
          {erro && <div className="aviso" style={{ color: '#ffb3c1' }}>{erro}</div>}
          <div className="linha" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {podePreencher && <button className="btn" onClick={preencherNoSite}>Preencher no site</button>}
            <button className="btn primario" style={{ height: 48, padding: '0 26px', fontSize: 15 }} disabled={enviando || logado !== true} onClick={gerar}>
              {enviando ? 'Enviando…' : 'Gerar música'}
            </button>
          </div>
          {emAndamento.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {emAndamento.map((c) => (
                <div key={c.id} className="trabalho linha" style={{ justifyContent: 'space-between' }}>
                  <span>{c.title || 'Música nova'}</span>
                  <span className="dica">
                    {c.status === 'complete' ? 'Pronta · na galeria' : c.status === 'error' ? `Erro: ${c.metadata?.error_message ?? 'falhou'}` : c.status === 'streaming' ? 'Quase pronta…' : 'Gerando…'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="painel">
        <div className="linha" style={{ justifyContent: 'space-between' }}>
          <h2>Minhas músicas <span className="dica" style={{ fontWeight: 400 }}>· {musicas.length}</span></h2>
          <span className="linha" style={{ gap: 10, alignItems: 'center' }}>
            <span className="linha" style={{ gap: 8, alignItems: 'center' }}>
              <Chave ligada={autoGuardar} aoMudar={setAutoGuardar} rotulo="Guardar sozinho" /> Guardar sozinho as novas
            </span>
            <button className="btn pequeno" disabled={logado !== true} onClick={guardarUltimas}>Puxar as últimas do Suno</button>
            <button className="btn pequeno" onClick={() => chamar('abrirPastaGaleria')}>Abrir pasta</button>
          </span>
        </div>
        {!musicas.length ? (
          <div className="vazio">Nenhuma música ainda. Crie no Suno (pelo site ou pelo "Gerar direto") e ela aparece aqui quando ficar pronta.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {musicas.map((m) => (
              <div key={m.arquivo} className="trabalho linha" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'center' }}>
                {m.capa ? <img src={m.capa} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} /> : <div style={{ width: 48, height: 48, borderRadius: 8, background: '#1b1b2b' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.prompt}>{(m.fluxo ?? m.arquivo).replace(/^Suno: /, '')}</div>
                  <div className="dica">{new Date(m.quando).toLocaleString('pt-BR')}</div>
                </div>
                <audio src={m.url} controls preload="none" style={{ height: 36, maxWidth: 320 }} />
                <button className="btn pequeno" onClick={() => chamar('mostrarNaPasta', m.arquivo)}>Pasta</button>
                <button
                  className="btn pequeno perigo"
                  onClick={async () => {
                    if (await confirmar(`Apagar "${m.arquivo}" da galeria?`, { perigo: true })) chamar('apagarDaGaleria', m.arquivo)
                  }}
                >
                  Apagar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function OpcoesAvancadas({ pedido, instrumental, ajustes, aoMudar, aoZerar }: { pedido: PedidoAprendido | null; instrumental: boolean; ajustes: Record<string, any>; aoMudar: (id: string, v: any) => void; aoZerar: () => void }) {
  const [aberto, setAberto] = useState(true)
  const cams = pedido ? caminhos(pedido.corpo) : {}
  const valor = (a: Ajuste) => (ajustes[a.id] !== undefined ? ajustes[a.id] : paraTela(a, cams[a.id] ? pegar(pedido!.corpo, cams[a.id]) : undefined))
  return (
    <div className="trabalho" style={{ display: 'grid', gap: 12 }}>
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn pequeno" onClick={() => setAberto(!aberto)}>{aberto ? '▾' : '▸'} Opções avançadas (More Options)</button>
        {aberto && pedido && <button type="button" className="btn pequeno" onClick={aoZerar}>Voltar ao que usei no site</button>}
      </div>
      {aberto &&
        (!pedido ? (
          <span className="dica">As opções aparecem aqui depois que o programa aprender com o site: abra o Suno e faça uma música com o Advanced e o More Options.</span>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {AJUSTES.map((a) => {
              const semVoz = a.id === 'genero' && instrumental
              const tem = !!cams[a.id] && !semVoz
              const v = semVoz ? '' : valor(a)
              return (
                <label key={a.id} className="campo" style={{ opacity: tem ? 1 : 0.45 }} title={tem ? '' : 'Ainda não aprendi essa opção: mexa nela no site e faça uma música, que eu aprendo.'}>
                  <span className="linha" style={{ justifyContent: 'space-between' }}>
                    {a.rotulo}
                    {a.tipo === 'porcentagem' && <strong>{v}%</strong>}
                  </span>
                  {a.tipo === 'porcentagem' && <input type="range" min={0} max={100} step={1} style={{ accentColor: "#ff4f9a" }} disabled={!tem} value={v} onChange={(e) => aoMudar(a.id, Number(e.target.value))} />}
                  {a.tipo === 'liga' && (
                    <span className="linha" style={{ gap: 6 }}>
                      <button type="button" disabled={!tem} className={`pilula ${!v ? 'ativa' : ''}`} onClick={() => aoMudar(a.id, false)}>Off</button>
                      <button type="button" disabled={!tem} className={`pilula ${v ? 'ativa' : ''}`} onClick={() => aoMudar(a.id, true)}>On</button>
                    </span>
                  )}
                  {a.tipo === 'escolha' && (
                    <span className="linha" style={{ gap: 6 }}>
                      {a.opcoes!.map(([k, n]) => (
                        <button type="button" key={k} disabled={!tem} className={`pilula ${v === k ? 'ativa' : ''}`} onClick={() => aoMudar(a.id, k)}>{n}</button>
                      ))}
                    </span>
                  )}
                  {a.tipo === 'texto' && <input disabled={!tem} value={v} onChange={(e) => aoMudar(a.id, e.target.value)} placeholder={a.dica} />}
                  {semVoz ? <span className="dica" style={{ fontSize: 11 }}>instrumental: sem voz</span> : !tem && <span className="dica" style={{ fontSize: 11 }}>ainda não aprendida</span>}
                </label>
              )
            })}
          </div>
        ))}
    </div>
  )
}
