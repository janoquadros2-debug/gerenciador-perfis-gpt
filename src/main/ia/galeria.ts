// Galeria: guarda neste PC (o principal) as imagens, vídeos e músicas gerados.
// Pasta: Documentos\Gerenciador de Perfis - IA
import { app, net, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ItemGaleria, TrabalhoIA } from '../../shared/types'

export const pastaGaleria = () => path.join(app.getPath('documents'), 'Gerenciador de Perfis GPT - IA')
const ARQ_INFO = '.galeria.json'
const EXT_VIDEO = /\.(mp4|webm|mov|mkv|gif)$/i
const EXT_AUDIO = /\.(mp3|wav|m4a|ogg|flac)$/i
const EXT_MIDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|mp3|wav|m4a|ogg|flac)$/i

type Info = Record<string, { quando: number; prompt?: string; fluxo?: string; sunoId?: string; capa?: string }>

function lerInfo(): Info {
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaGaleria(), ARQ_INFO), 'utf8'))
  } catch {
    return {}
  }
}
function gravarInfo(i: Info) {
  fs.mkdirSync(pastaGaleria(), { recursive: true })
  fs.writeFileSync(path.join(pastaGaleria(), ARQ_INFO), JSON.stringify(i, null, 1))
}
const seguro = (nome: string) => path.basename(nome).replace(/[<>:"/\\|?*]/g, '_')

// Precisa ser chamado antes do app ficar pronto.
export function prepararProtocolo() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'galeria', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}
export function ativarProtocolo() {
  protocol.handle('galeria', (req) => {
    const nome = seguro(decodeURIComponent(new URL(req.url).pathname.slice(1)))
    return net.fetch(pathToFileURL(path.join(pastaGaleria(), nome)).toString())
  })
}

export function salvarNaGaleria(r: { trabalho: TrabalhoIA; arquivos: { nome: string; base64: string }[] }): ItemGaleria[] {
  fs.mkdirSync(pastaGaleria(), { recursive: true })
  const info = lerInfo()
  const salvos: ItemGaleria[] = []
  for (const a of r.arquivos) {
    let nome = seguro(a.nome)
    if (fs.existsSync(path.join(pastaGaleria(), nome))) nome = `${Date.now()}-${nome}`
    fs.writeFileSync(path.join(pastaGaleria(), nome), Buffer.from(a.base64, 'base64'))
    info[nome] = { quando: Date.now(), prompt: r.trabalho.prompt, fluxo: r.trabalho.fluxoNome }
    salvos.push(item(nome, info[nome]))
  }
  gravarInfo(info)
  return salvos
}

// A URL usa só letras seguras (o nome vai codificado), para o navegador interno aceitar.
const item = (arquivo: string, i?: Info[string]): ItemGaleria => ({
  arquivo,
  midia: EXT_AUDIO.test(arquivo) ? 'audio' : EXT_VIDEO.test(arquivo) ? 'video' : 'imagem',
  url: `galeria://f/${encodeURIComponent(arquivo)}`,
  quando: i?.quando ?? fs.statSync(path.join(pastaGaleria(), arquivo)).mtimeMs,
  prompt: i?.prompt,
  fluxo: i?.fluxo,
  capa: i?.capa
})

export function listarGaleria(): ItemGaleria[] {
  try {
    const info = lerInfo()
    return fs
      .readdirSync(pastaGaleria())
      .filter((f) => EXT_MIDIA.test(f))
      .map((f) => item(f, info[f]))
      .sort((a, b) => b.quando - a.quando)
  } catch {
    return []
  }
}

export function lerDaGaleria(arquivo: string): { nome: string; base64: string } {
  const nome = seguro(arquivo)
  return { nome, base64: fs.readFileSync(path.join(pastaGaleria(), nome)).toString('base64') }
}

export function apagarDaGaleria(arquivo: string) {
  const nome = seguro(arquivo)
  fs.rmSync(path.join(pastaGaleria(), nome), { force: true })
  const info = lerInfo()
  const i = info[nome]
  if (i?.capa) fs.rmSync(path.join(pastaGaleria(), decodeURIComponent(i.capa.replace('galeria://f/', ''))), { force: true })
  // música do Suno apagada: lembra o código para não baixar de novo sozinha
  if (i?.sunoId) info[`__apagado:${i.sunoId}`] = { quando: Date.now(), sunoId: i.sunoId }
  delete info[nome]
  gravarInfo(info)
}

export function abrirPastaGaleria() {
  fs.mkdirSync(pastaGaleria(), { recursive: true })
  return shell.openPath(pastaGaleria())
}

export function mostrarNaPasta(arquivo: string) {
  shell.showItemInFolder(path.join(pastaGaleria(), seguro(arquivo)))
}

// ---------- músicas do Suno ----------
export function sunoJaSalvos(): string[] {
  return Object.values(lerInfo())
    .map((i) => i.sunoId)
    .filter(Boolean) as string[]
}

export async function salvarMusica(
  m: { id: string; titulo: string; audioUrl: string; capaUrl?: string; prompt?: string },
  baixarComLogin?: (url: string) => Promise<Buffer> // baixa pelo Chrome do Suno (com o seu login), quando o link direto é recusado
): Promise<ItemGaleria | null> {
  const info = lerInfo()
  if (Object.values(info).some((i) => i.sunoId === m.id)) return null // já está na galeria
  fs.mkdirSync(pastaGaleria(), { recursive: true })
  const direto = async (url: string) => {
    const r = await net.fetch(url)
    if (!r.ok) throw new Error(`não consegui baixar (${r.status})`)
    return Buffer.from(await r.arrayBuffer())
  }
  const baixar = async (url: string) => {
    try {
      return await direto(url)
    } catch (e) {
      if (!baixarComLogin) throw e
      return baixarComLogin(url)
    }
  }
  let audio: Buffer | null = null
  let ultimoErro: any
  for (const url of [...new Set([m.audioUrl, `https://cdn1.suno.ai/${m.id}.mp3`, `https://cdn2.suno.ai/${m.id}.mp3`].filter(Boolean))]) {
    try {
      audio = await baixar(url)
      if (audio.length > 10_000) break
      audio = null
    } catch (e) {
      ultimoErro = ultimoErro ?? e // guarda o erro do link principal (o mais útil)
    }
  }
  if (!audio) throw ultimoErro ?? new Error('o arquivo veio vazio')
  const base = seguro(`${(m.titulo || 'Musica').slice(0, 60)} - ${m.id.slice(0, 6)}`)
  const nome = `${base}.mp3`
  fs.writeFileSync(path.join(pastaGaleria(), nome), audio)
  let capa: string | undefined
  if (m.capaUrl) {
    try {
      const c = `.capa-${m.id.slice(0, 8)}.jpg`
      fs.writeFileSync(path.join(pastaGaleria(), c), await baixar(m.capaUrl))
      capa = `galeria://f/${encodeURIComponent(c)}`
    } catch {
      /* sem capa */
    }
  }
  info[nome] = { quando: Date.now(), prompt: m.prompt, fluxo: `Suno: ${m.titulo || 'Música'}`, sunoId: m.id, capa }
  gravarInfo(info)
  return item(nome, info[nome])
}
