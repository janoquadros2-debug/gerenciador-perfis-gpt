// Fluxos (workflows) do ComfyUI: o básico que já vem pronto e os que você importar.
// Para usar um fluxo seu: no ComfyUI, menu Workflow > Export (API), e importe o .json no programa.
// O programa acha sozinho onde ficam o prompt, a semente, o tamanho e a imagem de entrada.
import type { CamposFluxo, FluxoIA, OpcoesGerar } from '../../shared/types'
import flux2Criar from './prontos/flux2-klein-criar.json'
import flux2Editar from './prontos/flux2-klein-editar.json'
import ltxAnimar from './prontos/ltx-2.3-animar.json'
import zImageTurbo from './prontos/z-image-turbo.json'

type Grafo = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>

const CAMPOS_TEXTO = ['text', 'prompt', 'positive_prompt', 't5xxl', 'clip_l', 'text_g', 'text_l', 'positive', 'value']
const CAMPOS_NEGATIVO = ['negative_prompt', 'negative']
const ehLigacao = (v: any) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'

// Segue as ligações a partir de uma entrada até achar o nó que tem o texto.
function acharTexto(g: Grafo, inicio: any, visitados = new Set<string>()): { no: string; campo: string } | null {
  if (!ehLigacao(inicio)) return null
  const id = inicio[0]
  if (visitados.has(id) || !g[id]) return null
  visitados.add(id)
  const n = g[id]
  for (const c of CAMPOS_TEXTO) if (typeof n.inputs[c] === 'string') return { no: id, campo: c }
  for (const v of Object.values(n.inputs)) {
    const r = acharTexto(g, v, visitados)
    if (r) return r
  }
  return null
}

export function detectarCampos(g: Grafo): CamposFluxo {
  const c: CamposFluxo = { prompt: [], negativo: [], semente: [], largura: [], altura: [], quantidade: [], imagem: [], quadros: [], segundos: [], fps: [] }
  const add = (lista: { no: string; campo: string }[], no: string, campo: string) => {
    if (!lista.some((x) => x.no === no && x.campo === campo)) lista.push({ no, campo })
  }
  for (const [id, n] of Object.entries(g)) {
    const i = n.inputs ?? {}
    const tipo = n.class_type ?? ''
    // sampler: segue "positive" e "negative" até os textos
    if ('positive' in i && ehLigacao(i.positive)) {
      const p = acharTexto(g, i.positive)
      if (p) add(c.prompt, p.no, p.campo)
    }
    if ('negative' in i && ehLigacao(i.negative)) {
      const p = acharTexto(g, i.negative)
      if (p) add(c.negativo, p.no, p.campo)
    }
    // nós que já têm positivo/negativo em texto (ex.: WanVideoTextEncode)
    if (typeof i.positive_prompt === 'string') add(c.prompt, id, 'positive_prompt')
    for (const k of CAMPOS_NEGATIVO) if (typeof i[k] === 'string') add(c.negativo, id, k)
    for (const k of ['seed', 'noise_seed']) if (typeof i[k] === 'number') add(c.semente, id, k)
    if (typeof i.width === 'number') add(c.largura, id, 'width')
    if (typeof i.height === 'number') add(c.altura, id, 'height')
    if (typeof i.batch_size === 'number' && /Latent/i.test(tipo)) add(c.quantidade, id, 'batch_size')
    if (tipo === 'LoadImage' && typeof i.image === 'string') {
      add(c.imagem, id, 'image')
      c.imagem[c.imagem.length - 1].rotulo = n._meta?.title && n._meta.title !== 'Load Image' ? n._meta.title : undefined
    }
    for (const k of ['length', 'num_frames', 'frames', 'video_frames']) if (typeof i[k] === 'number') add(c.quadros, id, k)
    for (const k of ['fps', 'frame_rate']) if (typeof i[k] === 'number') add(c.fps, id, k)
    // caixinhas "Primitive" com nome (como nos fluxos oficiais do ComfyUI): Width, Height, Frame Rate, Duration
    if (/^Primitive(Int|Float)$/.test(tipo) && typeof i.value === 'number') {
      const t = (n._meta?.title ?? '').toLowerCase()
      if (/^(width|largura)$/.test(t)) add(c.largura, id, 'value')
      else if (/^(height|altura)$/.test(t)) add(c.altura, id, 'value')
      else if (/frame.?rate|^fps$/.test(t)) add(c.fps, id, 'value')
      else if (/duration|dura[cç][aã]o|segundos/.test(t)) add(c.segundos, id, 'value')
      else if (/^(length|frames|quadros)$/.test(t)) add(c.quadros, id, 'value')
    }
  }
  // sem sampler ligado: pega o primeiro nó de texto que parece ser o positivo
  if (!c.prompt.length) {
    for (const [id, n] of Object.entries(g)) {
      const campo = CAMPOS_TEXTO.find((k) => typeof n.inputs?.[k] === 'string')
      if (campo && !/neg/i.test(n._meta?.title ?? '')) {
        add(c.prompt, id, campo)
        break
      }
    }
  }
  // o mesmo nó não pode ser positivo e negativo
  c.negativo = c.negativo.filter((x) => !c.prompt.some((p) => p.no === x.no && p.campo === x.campo))
  return c
}

// Tira os nós que não levam a nenhum resultado (ex.: uma imagem solta que o fluxo não usa).
export function podar(g: Grafo): Grafo {
  const saidas = Object.keys(g).filter((id) => /^(Save|Preview)|VideoCombine/.test(g[id].class_type))
  if (!saidas.length) return g
  const manter = new Set<string>()
  const visitar = (id: string) => {
    if (manter.has(id) || !g[id]) return
    manter.add(id)
    for (const v of Object.values(g[id].inputs)) if (ehLigacao(v)) visitar(v[0])
  }
  saidas.forEach(visitar)
  return Object.fromEntries(Object.entries(g).filter(([id]) => manter.has(id)))
}

export function validarFluxo(json: any): Grafo {
  const g = json?.prompt && typeof json.prompt === 'object' ? json.prompt : json
  if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('Arquivo inválido.')
  if (Array.isArray(g.nodes) && Array.isArray(g.links))
    throw new Error('Esse arquivo é o fluxo "normal" do ComfyUI. Exporte no formato API: menu Workflow > Export (API).')
  const nos = Object.values<any>(g)
  if (!nos.length || !nos.every((n) => n && typeof n.class_type === 'string' && typeof n.inputs === 'object'))
    throw new Error('Não reconheci esse arquivo como um fluxo do ComfyUI no formato API.')
  return podar(g)
}

// Coloca o que você escolheu na tela (prompt, tamanho, semente…) dentro de uma cópia do fluxo.
export function aplicar(fluxo: FluxoIA, o: OpcoesGerar & { imagensNoComfy?: string[] }): Grafo {
  const g: Grafo = JSON.parse(JSON.stringify(fluxo.grafo))
  const por = (lista: { no: string; campo: string }[], valor: any) => {
    for (const { no, campo } of lista) if (g[no]) g[no].inputs[campo] = valor
  }
  const c = fluxo.campos
  if (o.prompt !== undefined) por(c.prompt, o.prompt)
  if (o.negativo !== undefined && o.negativo !== '') por(c.negativo, o.negativo)
  for (const s of c.semente) if (g[s.no]) g[s.no].inputs[s.campo] = o.semente ?? Math.floor(Math.random() * 2 ** 48)
  if (o.largura) por(c.largura, o.largura)
  if (o.altura) por(c.altura, o.altura)
  if (o.quantidade) por(c.quantidade, o.quantidade)
  if (o.quadros) por(c.quadros, o.quadros)
  if (o.segundos) por(c.segundos, o.segundos)
  if (o.fps) por(c.fps, o.fps)
  ;(o.imagensNoComfy ?? []).forEach((nome, k) => {
    const alvo = c.imagem[k]
    if (alvo && g[alvo.no]) g[alvo.no].inputs[alvo.campo] = nome
  })
  if (o.modelo && fluxo.id === BASICO_ID && g['4']) g['4'].inputs.ckpt_name = o.modelo
  if (fluxo.id === BASICO_ID && g['3']) {
    const p = predefinicao(o.modelo ?? '')
    if (o.passos) g['3'].inputs.steps = o.passos
    else g['3'].inputs.steps = p.passos
    g['3'].inputs.cfg = o.cfg ?? p.cfg
  }
  return g
}

// ---------- fluxo básico de imagem (funciona com checkpoints SD 1.5, SDXL, Pony, Illustrious…) ----------
export const BASICO_ID = 'basico-imagem'

export function fluxoBasico(): FluxoIA {
  const grafo: Grafo = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '' }, _meta: { title: 'Modelo' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] }, _meta: { title: 'Prompt' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality, watermark, text, deformed', clip: ['4', 1] }, _meta: { title: 'Negativo' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 }, _meta: { title: 'Tamanho' } },
    '3': {
      class_type: 'KSampler',
      inputs: { seed: 0, steps: 25, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
      _meta: { title: 'Gerar' }
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] }, _meta: { title: 'Decodificar' } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'Gerenciador', images: ['8', 0] }, _meta: { title: 'Salvar' } }
  }
  return { id: BASICO_ID, nome: 'Básico (escolha o modelo)', tipo: 'imagem', grafo, campos: detectarCampos(grafo), embutido: true }
}

// Passos e CFG que costumam funcionar bem para cada tipo de modelo (dá para mudar na tela).
export function predefinicao(modelo: string): { passos: number; cfg: number; lado: number } {
  const n = modelo.toLowerCase()
  if (/lightning|turbo|hyper|lcm|dmd/.test(n)) return { passos: 6, cfg: 1.8, lado: 1024 }
  if (/sd15|sd-1|v1-5|1\.5|_15|realisticvision|deliberate/.test(n)) return { passos: 25, cfg: 7, lado: 512 }
  if (/pony|illustrious|noob|animagine/.test(n)) return { passos: 28, cfg: 6, lado: 1024 }
  return { passos: 25, cfg: 6, lado: 1024 }
}

// ---------- o que cada IA faz de melhor (pelo nome do arquivo) ----------
export interface DescricaoModelo {
  familia: string
  uso: string
  categoria: 'imagem' | 'video' | 'apoio'
}

export function descreverModelo(arquivo: string, pasta: string): DescricaoModelo {
  const n = arquivo.toLowerCase()
  const r = (familia: string, uso: string, categoria: DescricaoModelo['categoria'] = 'imagem'): DescricaoModelo => ({ familia, uso, categoria })
  if (pasta === 'loras' && /lightning|turbo|hyper|lightx2v|causvid/.test(n)) return r('LoRA de velocidade', 'Complemento: deixa outro modelo muito mais rápido (4 a 8 passos em vez de 20+).', 'apoio')
  if (/qwen.*image.*edit/.test(n) && pasta !== 'loras') return r('Qwen Image Edit', 'Edita fotos com um comando de texto: trocar fundo, roupa, estilo, tirar ou pôr objetos, juntar 2 imagens.')
  if (/qwen.?2\.?5.?vl/.test(n)) return r('Leitor do Qwen', 'Complemento: é o "cérebro" que entende o texto e as imagens para os modelos Qwen.', 'apoio')
  if (pasta === 'facerestore_models' || /gfpgan|codeformer|gpen/.test(n)) return r('Restaurador de rosto', 'Complemento: deixa rostos mais nítidos (usado na troca de rosto).', 'apoio')
  if (pasta === 'facedetection') return r('Detector de rosto', 'Complemento: acha os rostos na imagem.', 'apoio')
  if (pasta === 'nsfw_detector') return r('Filtro de conteúdo', 'Complemento: o filtro de segurança do ReActor.', 'apoio')
  if (pasta === 'loras') return r('LoRA', 'Complemento: adiciona um estilo, personagem ou detalhe a outro modelo.', 'apoio')
  if (pasta === 'vae') return r('VAE', 'Complemento: melhora cores e nitidez na hora de montar a imagem.', 'apoio')
  if (['text_encoders', 'clip', 'clip_vision'].includes(pasta)) return r('Leitor de texto/imagem', 'Complemento: ajuda o modelo a entender o prompt ou a imagem.', 'apoio')
  if (pasta === 'upscale_models') return r('Ampliador', 'Aumenta a resolução de imagens já prontas.', 'apoio')
  if (/ace.?step/.test(n)) return r('ACE-Step', 'Gera música. Não é usado pelo programa.', 'apoio')
  if (/ltx.*upscaler|spatial.?upscaler/.test(n) || pasta === 'latent_upscale_models') return r('Ampliador do LTX', 'Complemento: deixa o vídeo do LTX em resolução maior.', 'apoio')
  if (/gemma.*lora|abliterated/.test(n)) return r('LoRA do LTX', 'Complemento do LTX-2.3 (melhora o texto do prompt).', 'apoio')
  if (/ltx.*distilled.*lora|ltx.*lora/.test(n)) return r('LoRA de velocidade (LTX)', 'Complemento: deixa o LTX-2.3 muito mais rápido.', 'apoio')
  if (/gemma/.test(n)) return r('Leitor do LTX', 'Complemento: entende o prompt para o LTX-2.3.', 'apoio')
  if (/qwen_3|qwen3/.test(n) && ['text_encoders', 'clip'].includes(pasta)) return r('Leitor do Z-Image/FLUX.2', 'Complemento: entende o prompt para o Z-Image e o FLUX.2 Klein.', 'apoio')
  if (/ltx/.test(n)) return r('LTX-2.3', 'Vídeo a partir de imagem (ou texto), já com som. Rápido para o tamanho.', 'video')
  if (/z.?image/.test(n)) return r('Z-Image Turbo', 'Cria imagens realistas muito rápido (8 passos).')
  if (/flux.?2.?klein/.test(n)) return r('FLUX.2 Klein', 'Cria e edita imagens com ótima fidelidade ao prompt. Rápido.')
  if (/wan/.test(n)) return r('Wan', /i2v/.test(n) ? 'Vídeo a partir de imagem: dá vida a uma foto, com movimento natural. Ótima qualidade.' : 'Vídeo a partir de texto (e, em algumas versões, de imagem). Ótima qualidade, mais pesado.', 'video')
  if (/ltx/.test(n)) return r('LTX Video', 'Vídeo rápido, bom para testes e animações curtas.', 'video')
  if (/hunyuan.*video|hunyuanvideo/.test(n)) return r('HunyuanVideo', 'Vídeo realista de alta qualidade, bem pesado.', 'video')
  if (/svd|stable.?video/.test(n)) return r('Stable Video Diffusion', 'Anima uma imagem com movimentos curtos e suaves.', 'video')
  if (/cogvideo/.test(n)) return r('CogVideoX', 'Vídeo a partir de texto ou imagem.', 'video')
  if (/mochi/.test(n)) return r('Mochi', 'Vídeo a partir de texto, movimento fluido.', 'video')
  if (/flux/.test(n)) return r('Flux', /schnell/.test(n) ? 'Imagens realistas e rápidas (poucos passos). Entende bem o prompt.' : 'Imagens muito realistas, entende bem o prompt e escreve texto na imagem. Mais pesado.')
  if (/qwen/.test(n)) return r('Qwen Image', 'Ótimo para imagens com texto escrito e cenas detalhadas.')
  if (/hidream/.test(n)) return r('HiDream', 'Imagens detalhadas e fiéis ao prompt.')
  if (/sd3|stable.?diffusion.?3/.test(n)) return r('SD 3.5', 'Boa composição e texto na imagem.')
  if (/pony/.test(n)) return r('Pony (SDXL)', 'Estilo anime, desenho e cartoon.')
  if (/illustrious|noob|animagine|anything|counterfeit/.test(n)) return r('Anime (SDXL)', 'Ilustração e anime com traço caprichado.')
  if (/juggernaut|realvis|epicrealism|realistic|photon|cyberrealistic|zavychroma/.test(n)) return r('Realista', 'Fotos realistas: pessoas, produtos, lugares.')
  if (/dreamshaper|protovision/.test(n)) return r('Versátil', 'Vai bem em vários estilos: realista, fantasia e arte.')
  if (/lightning|turbo|hyper|lcm|dmd/.test(n)) return r('Rápido', 'Gera em poucos segundos (poucos passos), com qualidade um pouco menor.')
  if (/xl|sdxl/.test(n)) return r('SDXL', 'Boa qualidade geral em 1024×1024.')
  if (/sd15|v1-5|1\.5|realisticvision|deliberate/.test(n)) return r('SD 1.5', 'Leve e rápido, em 512×512. Muitos estilos disponíveis.')
  return r('Imagem', 'Modelo de imagem. Teste com o fluxo básico para ver o estilo.')
}


// ---------- fluxos prontos: aparecem sozinhos quando os modelos certos estão instalados ----------
// info = resposta do /object_info do ComfyUI (lista os nós e os arquivos de cada pasta).
type InfoNos = Record<string, any>
// Lista de arquivos aceitos por um campo. O ComfyUI usa dois formatos:
// antigo: [["a.safetensors", "b.safetensors"], {...}]  ·  novo: ["COMBO", { options: ["a.safetensors", ...] }]
export const opcoes = (info: InfoNos, no: string, campo: string): string[] => {
  const d = info[no]?.input?.required?.[campo] ?? info[no]?.input?.optional?.[campo]
  const v = Array.isArray(d?.[0]) ? d[0] : d?.[0] === 'COMBO' ? d?.[1]?.options : undefined
  return Array.isArray(v) ? v.map(String) : []
}
const achar = (lista: string[], re: RegExp, nao?: RegExp) => lista.find((f) => re.test(f) && !(nao && nao.test(f)))
const NEG = 'low quality, blurry, bad anatomy, deformed, extra fingers, watermark, text'

function montar(id: string, nome: string, tipo: 'imagem' | 'video', descricao: string, grafo: Grafo): FluxoIA {
  return { id, nome, tipo, grafo, campos: detectarCampos(grafo), embutido: true, descricao }
}

// carrega o modelo principal, seja .gguf (ComfyUI-GGUF) ou .safetensors
function carregarModelo(info: InfoNos, re: RegExp, nao?: RegExp): Grafo[string] | null {
  const gguf = achar(opcoes(info, 'UnetLoaderGGUF', 'unet_name'), re, nao)
  if (gguf) return { class_type: 'UnetLoaderGGUF', inputs: { unet_name: gguf }, _meta: { title: 'Modelo' } }
  const st = achar(opcoes(info, 'UNETLoader', 'unet_name'), re, nao)
  if (st) return { class_type: 'UNETLoader', inputs: { unet_name: st, weight_dtype: 'default' }, _meta: { title: 'Modelo' } }
  return null
}

function qwenEditar(info: InfoNos, duas: boolean): FluxoIA | null {
  const modelo = carregarModelo(info, /qwen.*image.*edit/i)
  const te = achar(opcoes(info, 'CLIPLoader', 'clip_name'), /qwen.?2\.?5.?vl/i)
  const vae = achar(opcoes(info, 'VAELoader', 'vae_name'), /qwen.?image.?vae/i)
  if (!modelo || !te || !vae) return null
  const lora = achar(opcoes(info, 'LoraLoaderModelOnly', 'lora_name'), /qwen.*edit.*lightning|lightning.*qwen.*edit/i)
  const g: Grafo = {
    '39': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '115': modelo,
    '38': { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'qwen_image', device: 'default' } },
    '66': { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3, model: lora ? ['89', 0] : ['115', 0] } },
    '75': { class_type: 'CFGNorm', inputs: { strength: 1, model: ['66', 0] } },
    '78': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: duas ? 'Imagem 1 (a que vai ser editada)' : 'Imagem a editar' } },
    '93': { class_type: 'ImageScaleToTotalPixels', inputs: { upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1, image: ['78', 0] } },
    '111': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { prompt: '', clip: ['38', 0], vae: ['39', 0], image1: ['93', 0] }, _meta: { title: 'Prompt' } },
    '110': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { prompt: NEG, clip: ['38', 0], vae: ['39', 0], image1: ['93', 0] }, _meta: { title: 'Negativo' } },
    '118': { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { reference_latents_method: 'index_timestep_zero', conditioning: ['111', 0] } },
    '117': { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { reference_latents_method: 'index_timestep_zero', conditioning: ['110', 0] } },
    '88': { class_type: 'VAEEncode', inputs: { pixels: ['93', 0], vae: ['39', 0] } },
    '3': {
      class_type: 'KSampler',
      inputs: { seed: 0, steps: lora ? (/4.?step/i.test(lora) ? 4 : 8) : 20, cfg: lora ? 1 : 2.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['75', 0], positive: ['118', 0], negative: ['117', 0], latent_image: ['88', 0] }
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['39', 0] } },
    '60': { class_type: 'SaveImage', inputs: { filename_prefix: 'Gerenciador/editar', images: ['8', 0] } }
  }
  if (lora) g['89'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: lora, strength_model: 1, model: ['115', 0] } }
  if (duas) {
    g['106'] = { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Imagem 2 (referência)' } }
    g['111'].inputs.image2 = ['106', 0]
    g['110'].inputs.image2 = ['106', 0]
  }
  return montar(
    duas ? 'pronto-qwen-editar-2' : 'pronto-qwen-editar',
    duas ? 'Editar com 2 imagens (Qwen)' : 'Editar imagem (Qwen)',
    'imagem',
    duas
      ? 'Junta duas imagens com um comando. Ex.: "coloque a roupa da imagem 2 na pessoa da imagem 1".'
      : 'Edita uma foto com um comando de texto. Ex.: "troque o fundo por uma praia ao pôr do sol".',
    g
  )
}

function trocarRosto(info: InfoNos): FluxoIA | null {
  if (!info.ReActorFaceSwap) return null
  const swap = achar(opcoes(info, 'ReActorFaceSwap', 'swap_model'), /inswapper/i) ?? opcoes(info, 'ReActorFaceSwap', 'swap_model')[0]
  if (!swap) return null
  const restaurar = opcoes(info, 'ReActorFaceSwap', 'face_restore_model')
  const g: Grafo = {
    '1': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Foto de destino' } },
    '2': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Rosto (origem)' } },
    '3': {
      class_type: 'ReActorFaceSwap',
      inputs: {
        enabled: true,
        input_image: ['1', 0],
        source_image: ['2', 0],
        swap_model: swap,
        facedetection: 'retinaface_resnet50',
        face_restore_model: achar(restaurar, /GFPGANv1\.4/i) ?? restaurar.find((r) => r !== 'none') ?? 'none',
        face_restore_visibility: 1,
        codeformer_weight: 0.5,
        detect_gender_input: 'no',
        detect_gender_source: 'no',
        input_faces_index: '0',
        source_faces_index: '0',
        console_log_level: 1
      }
    },
    '4': { class_type: 'SaveImage', inputs: { filename_prefix: 'Gerenciador/rosto', images: ['3', 0] } }
  }
  return montar('pronto-trocar-rosto', 'Trocar rosto (ReActor)', 'imagem', 'Coloca o rosto da segunda foto na pessoa da primeira. Não usa prompt.', g)
}

function qwenCriar(info: InfoNos): FluxoIA | null {
  const modelo = carregarModelo(info, /qwen.?image/i, /edit|layered/i)
  const te = achar(opcoes(info, 'CLIPLoader', 'clip_name'), /qwen.?2\.?5.?vl/i)
  const vae = achar(opcoes(info, 'VAELoader', 'vae_name'), /qwen.?image.?vae/i)
  if (!modelo || !te || !vae) return null
  const lora = achar(opcoes(info, 'LoraLoaderModelOnly', 'lora_name'), /qwen.?image.*lightning|lightning.*qwen/i, /edit/i)
  const g: Grafo = {
    '1': modelo,
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '5': { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3.1, model: lora ? ['4', 0] : ['1', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] }, _meta: { title: 'Prompt' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['2', 0] }, _meta: { title: 'Negativo' } },
    '8': { class_type: 'EmptySD3LatentImage', inputs: { width: 1328, height: 1328, batch_size: 1 } },
    '9': {
      class_type: 'KSampler',
      inputs: { seed: 0, steps: lora ? (/4.?step/i.test(lora) ? 4 : 8) : 20, cfg: lora ? 1 : 2.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['5', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0] }
    },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'SaveImage', inputs: { filename_prefix: 'Gerenciador/criar', images: ['10', 0] } }
  }
  if (lora) g['4'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: lora, strength_model: 1, model: ['1', 0] } }
  return montar('pronto-qwen-criar', /2512/.test(JSON.stringify(modelo.inputs)) ? 'Criar do zero (Qwen Image 2512)' : 'Criar do zero (Qwen Image)', 'imagem', 'Cria uma imagem só com o texto: pessoas muito realistas e ótimo com textos escritos na imagem.', g)
}

function wan5b(info: InfoNos): FluxoIA | null {
  const modelo = carregarModelo(info, /wan2\.?2.*ti2v.*5b|wan2\.?2.*5b/i)
  const te = achar(opcoes(info, 'CLIPLoader', 'clip_name'), /umt5/i)
  const vae = achar(opcoes(info, 'VAELoader', 'vae_name'), /wan2\.?2.?vae/i)
  if (!modelo || !te || !vae || !info.Wan22ImageToVideoLatent) return null
  const g: Grafo = {
    '1': modelo,
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'wan', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '4': { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['1', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] }, _meta: { title: 'Movimento' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, static, distorted, low quality, jpeg artifacts, extra limbs, deformed face', clip: ['2', 0] }, _meta: { title: 'Negativo' } },
    '7': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Imagem para animar' } },
    '8': { class_type: 'Wan22ImageToVideoLatent', inputs: { width: 1280, height: 704, length: 121, batch_size: 1, vae: ['3', 0], start_image: ['7', 0] } },
    '9': {
      class_type: 'KSampler',
      inputs: { seed: 0, steps: 20, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['8', 0] }
    },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    ...salvarVideo(info, ['10', 0], 24)
  }
  return montar('pronto-wan-5b', 'Animar (Wan 2.2 5B)', 'video', 'Dá movimento a uma imagem: vídeo de até ~5 s em 720p. Leva alguns minutos.', g)
}

// salva o vídeo em .mp4 (CreateVideo + SaveVideo); em ComfyUI antigo, cai para .webm
function salvarVideo(info: InfoNos, imagens: [string, number], fps: number): Grafo {
  if (info.CreateVideo && info.SaveVideo)
    return {
      'v1': { class_type: 'CreateVideo', inputs: { fps, images: imagens } },
      'v2': { class_type: 'SaveVideo', inputs: { filename_prefix: 'Gerenciador/video', format: 'auto', codec: 'auto', video: ['v1', 0] } }
    }
  return { 'v2': { class_type: 'SaveWEBM', inputs: { filename_prefix: 'Gerenciador/video', codec: 'vp9', fps, crf: 28, images: imagens } } }
}

// Wan 2.2 14B (imagem → vídeo): dois modelos (alto e baixo ruído). Com as LoRAs lightx2v faz em só 4 passos.
function wan14b(info: InfoNos): FluxoIA | null {
  const alto = carregarModelo(info, /wan2\.?2.*i2v.*high.*14b|wan2\.?2.*i2v.*14b.*high/i)
  const baixo = carregarModelo(info, /wan2\.?2.*i2v.*low.*14b|wan2\.?2.*i2v.*14b.*low/i)
  const te = achar(opcoes(info, 'CLIPLoader', 'clip_name'), /umt5/i)
  const vae = achar(opcoes(info, 'VAELoader', 'vae_name'), /wan_?2\.?1.?vae/i)
  if (!alto || !baixo || !te || !vae || !info.WanImageToVideo || !info.KSamplerAdvanced) return null
  const loras = opcoes(info, 'LoraLoaderModelOnly', 'lora_name')
  const loraAlto = achar(loras, /wan2\.?2.*i2v.*(lightx2v|lightning).*high/i)
  const loraBaixo = achar(loras, /wan2\.?2.*i2v.*(lightx2v|lightning).*low/i)
  const rapido = !!(loraAlto && loraBaixo)
  const passos = rapido ? 4 : 20
  const meio = rapido ? 2 : 10
  const cfg = rapido ? 1 : 3.5
  const g: Grafo = {
    '95': { ...alto, _meta: { title: 'Modelo (alto ruído)' } },
    '96': { ...baixo, _meta: { title: 'Modelo (baixo ruído)' } },
    '104': { class_type: 'ModelSamplingSD3', inputs: { shift: 5, model: rapido ? ['101', 0] : ['95', 0] } },
    '103': { class_type: 'ModelSamplingSD3', inputs: { shift: 5, model: rapido ? ['102', 0] : ['96', 0] } },
    '84': { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'wan', device: 'default' } },
    '90': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '93': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['84', 0] }, _meta: { title: 'Movimento' } },
    '89': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, static, distorted, low quality, jpeg artifacts, extra limbs, deformed face, subtitles', clip: ['84', 0] }, _meta: { title: 'Negativo' } },
    '97': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Imagem para animar' } },
    '98': { class_type: 'WanImageToVideo', inputs: { width: 832, height: 480, length: 81, batch_size: 1, positive: ['93', 0], negative: ['89', 0], vae: ['90', 0], start_image: ['97', 0] } },
    '86': {
      class_type: 'KSamplerAdvanced',
      inputs: { add_noise: 'enable', noise_seed: 0, steps: passos, cfg, sampler_name: 'euler', scheduler: 'simple', start_at_step: 0, end_at_step: meio, return_with_leftover_noise: 'enable', model: ['104', 0], positive: ['98', 0], negative: ['98', 1], latent_image: ['98', 2] }
    },
    '85': {
      class_type: 'KSamplerAdvanced',
      inputs: { add_noise: 'disable', noise_seed: 0, steps: passos, cfg, sampler_name: 'euler', scheduler: 'simple', start_at_step: meio, end_at_step: 10000, return_with_leftover_noise: 'disable', model: ['103', 0], positive: ['98', 0], negative: ['98', 1], latent_image: ['86', 0] }
    },
    '87': { class_type: 'VAEDecode', inputs: { samples: ['85', 0], vae: ['90', 0] } },
    ...salvarVideo(info, ['87', 0], 16)
  }
  if (rapido) {
    g['101'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: loraAlto, strength_model: 1, model: ['95', 0] } }
    g['102'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: loraBaixo, strength_model: 1, model: ['96', 0] } }
  }
  return montar(
    'pronto-wan-14b',
    'Animar com qualidade (Wan 2.2 14B)',
    'video',
    rapido
      ? 'O melhor movimento e realismo. Com o modo rápido (lightx2v, 4 passos): ~5 s de vídeo em poucos minutos.'
      : 'O melhor movimento e realismo, mas lento (20 passos). Instale as LoRAs lightx2v para ficar rápido.',
    g
  )
}

// Troca de rosto usando o Qwen Edit (não precisa do ReActor): o prompt já vem pronto.
function qwenRosto(info: InfoNos): FluxoIA | null {
  const base = qwenEditar(info, true)
  if (!base) return null
  const g = base.grafo as Grafo
  g['111'].inputs.prompt =
    'replace the face of the person in image1 with the face of the person in image2. keep the body, hair, clothes, pose and background of image1 exactly the same. realistic skin, natural lighting.'
  g['78']._meta = { title: 'Foto de destino (corpo)' }
  g['106']._meta = { title: 'Rosto (origem)' }
  g['60'].inputs.filename_prefix = 'Gerenciador/rosto'
  const f = montar('pronto-qwen-rosto', 'Trocar rosto (Qwen)', 'imagem', 'Coloca o rosto da segunda foto na pessoa da primeira, usando o Qwen Edit. Não precisa escrever nada.', g)
  f.campos.prompt = [] // prompt fixo: a tela não pede texto
  return f
}

// ---------- fluxos oficiais do ComfyUI (tirados dos modelos do próprio ComfyUI) ----------
// Cada um só aparece se TODOS os arquivos de modelo que ele usa estiverem instalados.
const CAMPOS_ARQUIVO = ['unet_name', 'clip_name', 'vae_name', 'lora_name', 'ckpt_name', 'text_encoder', 'model_name']

function oficial(
  info: InfoNos,
  base: Grafo,
  id: string,
  nome: string,
  tipo: 'imagem' | 'video',
  descricao: string,
  trocas: Record<string, RegExp[]> = {}, // se o arquivo do modelo oficial não existir, aceita um parecido
  ajuste?: (g: Grafo, trocados: Set<string>) => void
): FluxoIA | null {
  const g: Grafo = podar(JSON.parse(JSON.stringify(base)))
  const trocados = new Set<string>()
  for (const n of Object.values(g)) {
    for (const k of CAMPOS_ARQUIVO) {
      const atual = n.inputs[k]
      if (typeof atual !== 'string') continue
      const lista = opcoes(info, n.class_type, k)
      if (lista.includes(atual)) continue
      const alternativa = (trocas[atual] ?? []).map((re) => lista.find((f) => re.test(f))).find(Boolean)
      if (!alternativa) return null // falta um arquivo: esse fluxo não aparece
      n.inputs[k] = alternativa
      trocados.add(atual)
    }
  }
  ajuste?.(g, trocados)
  return montar(id, nome, tipo, descricao, g)
}

function oficiais(info: InfoNos): FluxoIA[] {
  return [
    oficial(info, zImageTurbo as Grafo, 'oficial-z-image-turbo', 'Criar do zero (Z-Image Turbo)', 'imagem', 'Cria imagens realistas a partir do texto, muito rápido (8 passos).', {
      'qwen_3_4b_fp8_mixed.safetensors': [/qwen_3_4b/i],
      'z_image_turbo_int8_convrot.safetensors': [/z.?image.?turbo/i]
    }),
    oficial(
      info,
      flux2Criar as Grafo,
      'oficial-flux2-criar',
      'Criar do zero (FLUX.2 Klein)',
      'imagem',
      'Cria imagens a partir do texto, com ótima fidelidade ao prompt.',
      { 'flux-2-klein-base-4b.safetensors': [/flux.?2.?klein.*4b/i] },
      (g, trocados) => {
        // o modelo "distilled" (sem "base" no nome) usa só 4 passos e CFG 1
        if (trocados.has('flux-2-klein-base-4b.safetensors')) {
          for (const n of Object.values(g)) {
            if (n.class_type === 'Flux2Scheduler') n.inputs.steps = 4
            if (n.class_type === 'CFGGuider') n.inputs.cfg = 1
          }
        }
      }
    ),
    oficial(info, flux2Editar as Grafo, 'oficial-flux2-editar', 'Editar imagem (FLUX.2 Klein)', 'imagem', 'Edita uma foto com um comando de texto. Ex.: "mude a cor da bolsa para azul".', {
      'flux-2-klein-4b-fp8.safetensors': [/flux.?2.?klein.*4b/i]
    }),
    oficial(info, ltxAnimar as Grafo, 'oficial-ltx-2.3', 'Animar com som (LTX-2.3)', 'video', 'Transforma uma imagem em vídeo de até ~10 s, com áudio. Pode descrever falas e sons no prompt.')
  ].filter(Boolean) as FluxoIA[]
}

export function fluxosProntos(info: InfoNos): FluxoIA[] {
  return [...oficiais(info), qwenCriar(info), qwenEditar(info, false), qwenEditar(info, true), trocarRosto(info), qwenRosto(info), wan5b(info), wan14b(info)].filter(Boolean) as FluxoIA[]
}

// Valores que o fluxo já traz (para a tela começar com eles).
export function padroesDoFluxo(f: FluxoIA) {
  const v = (lista: { no: string; campo: string }[]) => {
    const x = lista[0] && f.grafo[lista[0].no]?.inputs?.[lista[0].campo]
    return typeof x === 'number' ? x : undefined
  }
  return { largura: v(f.campos.largura), altura: v(f.campos.altura), quadros: v(f.campos.quadros), segundos: v(f.campos.segundos), fps: v(f.campos.fps) }
}
