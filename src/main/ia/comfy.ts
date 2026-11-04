// Conversa com o ComfyUI que roda NESTE PC (no seu caso, o PC secundário com a RTX 5070).
// Usa a própria "API" do ComfyUI: /prompt (manda trabalho), /ws (progresso), /history e /view (resultado).
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

export const ENDERECOS_PADRAO = ['http://127.0.0.1:8188', 'http://127.0.0.1:8000'] // ComfyUI comum e ComfyUI Desktop

export interface InfoComfy {
  endereco: string
  versao?: string
  placa?: string // ex.: NVIDIA GeForce RTX 5070
  vramTotalGb?: number
  vramLivreGb?: number
}

export interface ArquivoGerado {
  nome: string
  subpasta: string
  tipo: string // "output" ou "temp"
  midia: 'imagem' | 'video'
}

const semBarra = (e: string) => e.replace(/\/+$/, '')

async function getJson(url: string, ms = 5000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`ComfyUI respondeu ${r.status}`)
  return r.json()
}

export async function testar(endereco: string): Promise<InfoComfy> {
  const base = semBarra(endereco)
  const j: any = await getJson(`${base}/system_stats`)
  const d = j.devices?.[0]
  return {
    endereco: base,
    versao: j.system?.comfyui_version,
    placa: d?.name?.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/, ''),
    vramTotalGb: d?.vram_total ? +(d.vram_total / 1024 ** 3).toFixed(1) : undefined,
    vramLivreGb: d?.vram_free ? +(d.vram_free / 1024 ** 3).toFixed(1) : undefined
  }
}

// Procura o ComfyUI nas portas de sempre.
export async function encontrar(preferido?: string): Promise<InfoComfy> {
  const tentativas = [...new Set([preferido, ...ENDERECOS_PADRAO].filter(Boolean) as string[])]
  for (const e of tentativas) {
    try {
      return await testar(e)
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error('Não encontrei o ComfyUI neste PC. Ele está aberto? (normalmente em http://127.0.0.1:8188)')
}

// Lista os modelos instalados por pasta (checkpoints, loras, diffusion_models…).
export async function listarModelos(endereco: string): Promise<Record<string, string[]>> {
  const base = semBarra(endereco)
  const pastas = ['checkpoints', 'diffusion_models', 'unet', 'loras', 'vae', 'text_encoders', 'clip', 'clip_vision', 'upscale_models', 'latent_upscale_models', 'facerestore_models']
  const out: Record<string, string[]> = {}
  let temRotaModelos = true
  let existentes: string[] = []
  try {
    existentes = (await getJson(`${base}/models`)) as string[]
  } catch {
    temRotaModelos = false
  }
  for (const p of pastas) {
    if (!temRotaModelos) break
    if (existentes.length && !existentes.includes(p)) continue
    try {
      out[p] = (await getJson(`${base}/models/${p}`)) as string[]
    } catch {
      /* pasta que esse ComfyUI não tem */
    }
  }
  if (temRotaModelos) return out
  // ComfyUI antigo: pega pelas opções dos nós
  const info: any = await getJson(`${base}/object_info`, 20000)
  const lista = (no: string, campo: string): string[] => {
    const d = info[no]?.input?.required?.[campo]
    const v = Array.isArray(d?.[0]) ? d[0] : d?.[0] === 'COMBO' ? d?.[1]?.options : []
    return Array.isArray(v) ? v : []
  }
  return {
    checkpoints: lista('CheckpointLoaderSimple', 'ckpt_name'),
    diffusion_models: lista('UNETLoader', 'unet_name'),
    loras: lista('LoraLoader', 'lora_name'),
    vae: lista('VAELoader', 'vae_name')
  }
}

// Lista todos os nós instalados e os arquivos que cada um aceita (é assim que achamos os modelos).
export async function infoNos(endereco: string): Promise<Record<string, any>> {
  return getJson(`${semBarra(endereco)}/object_info`, 30000)
}

// Sobe uma imagem para o ComfyUI usar (ex.: no fluxo de animar).
export async function subirImagem(endereco: string, nome: string, dados: Buffer): Promise<string> {
  const fd = new FormData()
  fd.append('image', new Blob([new Uint8Array(dados)]), nome)
  fd.append('overwrite', 'true')
  const r = await fetch(`${semBarra(endereco)}/upload/image`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`Não consegui enviar a imagem ao ComfyUI (${r.status})`)
  const j: any = await r.json()
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name
}

export async function baixarArquivo(endereco: string, a: ArquivoGerado): Promise<Buffer> {
  const q = new URLSearchParams({ filename: a.nome, subfolder: a.subpasta, type: a.tipo })
  const r = await fetch(`${semBarra(endereco)}/view?${q}`)
  if (!r.ok) throw new Error(`Não consegui baixar ${a.nome} (${r.status})`)
  return Buffer.from(await r.arrayBuffer())
}

export async function cancelar(endereco: string) {
  await fetch(`${semBarra(endereco)}/interrupt`, { method: 'POST' }).catch(() => undefined)
}

const EXT_VIDEO = /\.(mp4|webm|mov|mkv|gif|webp)$/i

/**
 * Manda o fluxo para o ComfyUI e espera terminar, avisando o progresso.
 * Devolve a lista de arquivos gerados (imagens e/ou vídeos).
 */
export function executar(
  endereco: string,
  fluxo: Record<string, any>,
  aoProgresso: (p: { porcentagem?: number; etapa: string }) => void,
  sinal?: AbortSignal
): Promise<ArquivoGerado[]> {
  const base = semBarra(endereco)
  const clientId = randomUUID()
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?clientId=${clientId}`)
    let promptId = ''
    let fim = false
    const terminar = (erro?: Error, arquivos?: ArquivoGerado[]) => {
      if (fim) return
      fim = true
      ws.close()
      erro ? reject(erro) : resolve(arquivos ?? [])
    }
    sinal?.addEventListener('abort', () => {
      cancelar(base)
      terminar(new Error('Cancelado.'))
    })

    ws.on('error', () => terminar(new Error('Perdi a conexão com o ComfyUI.')))
    ws.on('open', async () => {
      try {
        const r = await fetch(`${base}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: fluxo, client_id: clientId })
        })
        const j: any = await r.json()
        if (!r.ok || j.error) {
          const detalhes = Object.values(j.node_errors ?? {})
            .flatMap((n: any) => n.errors?.map((e: any) => `${n.class_type}: ${e.details || e.message}`) ?? [])
            .slice(0, 3)
            .join(' · ')
          return terminar(new Error(`O ComfyUI recusou o fluxo: ${j.error?.message ?? r.status}${detalhes ? ` (${detalhes})` : ''}`))
        }
        promptId = j.prompt_id
        aoProgresso({ etapa: j.number > 0 ? `Na fila do ComfyUI (posição ${j.number})` : 'Começando…' })
      } catch (e: any) {
        terminar(new Error(`Não consegui mandar o trabalho ao ComfyUI: ${e.message}`))
      }
    })
    ws.on('message', async (bruto, binario) => {
      if (binario) return // prévias em imagem: ignora
      let m: any
      try {
        m = JSON.parse(String(bruto))
      } catch {
        return
      }
      const d = m.data ?? {}
      if (d.prompt_id && promptId && d.prompt_id !== promptId) return
      if (m.type === 'execution_start') aoProgresso({ etapa: 'Gerando…', porcentagem: 0 })
      if (m.type === 'progress' && d.max) aoProgresso({ etapa: 'Gerando…', porcentagem: Math.round((d.value / d.max) * 100) })
      if (m.type === 'executing' && d.node && fluxo[d.node]) {
        const t = fluxo[d.node]._meta?.title ?? fluxo[d.node].class_type
        aoProgresso({ etapa: `Etapa: ${t}` })
      }
      if (m.type === 'execution_error') terminar(new Error(`Erro no ComfyUI (${d.node_type ?? 'nó'}): ${d.exception_message ?? 'falhou'}`))
      if (m.type === 'execution_interrupted') terminar(new Error('Cancelado.'))
      if ((m.type === 'executing' && d.node === null && d.prompt_id === promptId) || m.type === 'execution_success') {
        try {
          const h: any = await getJson(`${base}/history/${promptId}`, 15000)
          const saidas = h[promptId]?.outputs ?? {}
          const arquivos: ArquivoGerado[] = []
          for (const s of Object.values<any>(saidas))
            for (const lista of Object.values<any>(s))
              if (Array.isArray(lista))
                for (const a of lista)
                  if (a?.filename && a.type === 'output')
                    arquivos.push({ nome: a.filename, subpasta: a.subfolder ?? '', tipo: a.type, midia: EXT_VIDEO.test(a.filename) || s.animated?.[0] ? 'video' : 'imagem' })
          if (!arquivos.length) return terminar(new Error('O fluxo terminou mas não salvou nenhum arquivo. Ele tem um nó de salvar (Save Image / Save Video)?'))
          terminar(undefined, arquivos)
        } catch (e: any) {
          terminar(new Error(`Terminou, mas não consegui pegar o resultado: ${e.message}`))
        }
      }
    })
  })
}
