// Gerador de prompt: você escreve em português e a IA devolve um prompt bem feito em inglês.
// Dois motores:
//  - "local": grátis, roda no ComfyUI do PC secundário (modelo de texto Qwen3, que já está lá).
//  - "claude": a API do Claude (paga à parte, centavos por prompt), mais rápido e melhor.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ConfigPrompt, PedidoPrompt, ResultadoPrompt } from '../../shared/types'
import { logInfo } from '../log'

// ---------- configuração (fica só neste PC; a chave do Claude nunca vai para o outro PC) ----------
const arq = () => path.join(app.getPath('userData'), 'gerador-prompt.json')
const PADRAO: ConfigPrompt = { motor: 'local', claudeChave: '', claudeModelo: 'claude-haiku-5-5' }
export function lerConfigPrompt(): ConfigPrompt {
  try {
    return { ...PADRAO, ...JSON.parse(fs.readFileSync(arq(), 'utf8')) }
  } catch {
    return { ...PADRAO }
  }
}
export function salvarConfigPrompt(p: Partial<ConfigPrompt>): ConfigPrompt {
  const c = { ...lerConfigPrompt(), ...p }
  fs.writeFileSync(arq(), JSON.stringify(c, null, 1))
  return c
}

// ---------- as instruções para cada tipo de prompt ----------
const INSTRUCOES: Record<PedidoPrompt['tipo'], string> = {
  imagem: `You are an expert prompt writer for AI image generators (Qwen Image, FLUX, Z-Image).
Turn the user's request (usually written in Portuguese) into ONE English image prompt.
Rules:
- Keep EVERY element the user asked for: subjects, actions, objects, place, text, style. Never replace or drop them.
- If the user wants text written in the image, keep that text exactly as given, inside quotes, in its original language.
- Add useful details: composition and framing, camera/lens, lighting, mood, colors, materials, quality.
- 40 to 100 words, one paragraph, no lists.
Reply with the prompt only.`,
  editar: `You are an expert at writing edit instructions for AI image editors (Qwen Image Edit, FLUX Kontext).
Turn the user's request (usually in Portuguese) into ONE short English edit instruction.
Rules:
- Say exactly what to change, and say to keep everything else the same (face, pose, background...) when it makes sense.
- If the edit uses two images, refer to them as "image 1" and "image 2".
- 1 to 3 sentences.
Reply with the instruction only.`,
  video: `You are an expert prompt writer for AI image-to-video models (Wan 2.2, LTX).
The user already has a still image; turn their request (usually in Portuguese) into ONE English prompt describing the MOTION.
Rules:
- Keep every action the user asked for.
- Describe what moves and how (subject motion, camera movement such as slow push-in, pan or orbit, hair/cloth/wind, light changes), in the order it happens.
- Keep it physically plausible and smooth. Mention the mood.
- 30 to 80 words, one paragraph.
Reply with the prompt only.`,
  musica: `You are an expert songwriter and prompt writer for Suno AI.
Turn the user's request (usually in Portuguese) into a Suno song.
Rules:
- STYLE: English, comma-separated tags: genre and subgenre, mood, tempo/BPM, main instruments, vocal type (e.g. "female vocals"). Max 180 characters.
- TITLE: short and catchy, in the same language as the lyrics.
- LYRICS: write them in the language the user wants (Portuguese if they wrote in Portuguese and did not ask otherwise). Use section tags like [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro]. Strong, memorable chorus. 2 verses + chorus at least.
- If the user asks for an instrumental, write "LYRICS:" followed by [Instrumental].
Reply EXACTLY in this format:
TITLE: ...
STYLE: ...
LYRICS:
...`
}

function montarPedido(p: PedidoPrompt) {
  const extra = p.atual?.trim() ? `\n\nCurrent prompt to improve (keep what is good): ${p.atual.trim()}` : ''
  return `User request: ${p.texto.trim()}${extra}`
}

function separar(tipo: PedidoPrompt['tipo'], bruto: string): ResultadoPrompt {
  let t = bruto.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  t = t.replace(/^```[a-z]*\n?|```$/g, '').trim()
  if (tipo !== 'musica') return { prompt: t.replace(/^(prompt|instruction)\s*:\s*/i, '').replace(/^"|"$/g, '').trim() }
  const titulo = t.match(/TITLE\s*:\s*(.+)/i)?.[1]?.trim()
  const estilo = t.match(/STYLE\s*:\s*(.+)/i)?.[1]?.trim()
  const letra = t.match(/LYRICS\s*:\s*\n?([\s\S]+)/i)?.[1]?.trim()
  return { prompt: estilo ?? t, titulo, estilo, letra }
}

// ---------- motor Claude (roda neste PC) ----------
export async function gerarComClaude(p: PedidoPrompt): Promise<ResultadoPrompt> {
  const c = lerConfigPrompt()
  if (!c.claudeChave.trim()) throw new Error('Falta a chave da API do Claude (Configurações > ComfyUI > Gerador de prompt).')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': c.claudeChave.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.claudeModelo || PADRAO.claudeModelo, max_tokens: p.tipo === 'musica' ? 1500 : 500, system: INSTRUCOES[p.tipo], messages: [{ role: 'user', content: montarPedido(p) }] }),
    signal: AbortSignal.timeout(90_000)
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = j?.error?.message ?? `erro ${r.status}`
    if (r.status === 401) throw new Error('A chave do Claude não foi aceita. Confira se copiou ela inteira.')
    if (/credit|balance/i.test(msg)) throw new Error('Acabou o crédito da API do Claude. Coloque mais em console.anthropic.com (Billing).')
    throw new Error(`O Claude recusou: ${msg}`)
  }
  const texto = (j.content ?? []).map((b: any) => b.text ?? '').join('')
  logInfo('Prompt', `Prompt criado com o Claude (${j.usage?.input_tokens ?? '?'} + ${j.usage?.output_tokens ?? '?'} tokens).`)
  return { ...separar(p.tipo, texto), motor: 'Claude' }
}

// ---------- motor local (ComfyUI, roda no PC que tem o ComfyUI) ----------
const opc = (info: Record<string, any>, no: string, campo: string): string[] => {
  const d = info[no]?.input?.required?.[campo]
  const v = Array.isArray(d?.[0]) ? d[0] : d?.[0] === 'COMBO' ? d?.[1]?.options : []
  return Array.isArray(v) ? v : []
}
// prefere o Qwen3 (segue melhor o pedido); o Gemma do LTX fica de reserva
const PREFERIDOS = [/qwen3\.?5.*4b/i, /qwen_?3_4b(?!.*fp8)/i, /qwen_?3_4b/i, /qwen_?3/i, /gemma/i]

export async function gerarLocal(endereco: string, info: Record<string, any>, p: PedidoPrompt): Promise<ResultadoPrompt> {
  if (!info.TextGenerate) throw new Error('O seu ComfyUI ainda não tem o gerador de texto. Atualize o ComfyUI.')
  const encoders = opc(info, 'CLIPLoader', 'clip_name')
  const modelo = PREFERIDOS.map((re) => encoders.find((f) => re.test(f))).find(Boolean)
  if (!modelo) throw new Error('Não achei um modelo de texto (Qwen3 4B) no ComfyUI. Ou use o Claude no gerador de prompt.')
  const grafo = {
    '1': { class_type: 'CLIPLoader', inputs: { clip_name: modelo, type: 'ltxv', device: 'default' } },
    '2': {
      class_type: 'TextGenerate',
      inputs: {
        clip: ['1', 0],
        prompt: `${INSTRUCOES[p.tipo]}\n\n${montarPedido(p)}`,
        max_length: p.tipo === 'musica' ? 1100 : 320,
        sampling_mode: 'on',
        'sampling_mode.temperature': 0.7,
        'sampling_mode.top_k': 64,
        'sampling_mode.top_p': 0.95,
        'sampling_mode.min_p': 0.05,
        'sampling_mode.repetition_penalty': 1.05,
        'sampling_mode.seed': Math.floor(Math.random() * 1e9),
        'sampling_mode.presence_penalty': 0,
        thinking: false,
        use_default_template: true,
        mtp: 'auto'
      }
    },
    '3': { class_type: 'PreviewAny', inputs: { source: ['2', 0] } }
  }
  const r = await fetch(`${endereco}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: grafo, client_id: 'gerenciador-prompt' }) })
  const j: any = await r.json()
  if (!r.ok || j.error) throw new Error(`O ComfyUI recusou o gerador de texto: ${j.error?.message ?? r.status}`)
  const id = j.prompt_id
  const inicio = Date.now()
  while (Date.now() - inicio < 4 * 60_000) {
    await new Promise((ok) => setTimeout(ok, 1500))
    const h: any = await fetch(`${endereco}/history/${id}`).then((x) => x.json()).catch(() => ({}))
    const item = h[id]
    if (!item) continue
    const erro = (item.status?.messages ?? []).find((m: any) => m[0] === 'execution_error')
    if (erro) throw new Error(`Erro no gerador de texto: ${erro[1]?.exception_message ?? 'falhou'}`)
    const texto = item.outputs?.['3']?.text?.[0]
    if (typeof texto === 'string') {
      logInfo('Prompt', `Prompt criado no PC secundário (${modelo}) em ${Math.round((Date.now() - inicio) / 1000)}s.`)
      return { ...separar(p.tipo, texto), motor: 'Grátis (PC secundário)' }
    }
    if (item.status?.completed) throw new Error('O gerador de texto terminou sem resposta.')
  }
  throw new Error('O gerador de texto demorou demais (o ComfyUI está ocupado com outra imagem?).')
}
