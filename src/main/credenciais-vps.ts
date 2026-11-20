import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const arquivo = () => path.join(app.getPath('userData'), 'credenciais-vps.json')

function ler(): Map<string, string> {
  try {
    const dados: unknown = JSON.parse(fs.readFileSync(arquivo(), 'utf8'))
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('Formato inválido.')
    return new Map(Object.entries(dados).filter((item): item is [string, string] => typeof item[1] === 'string'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw new Error('Não foi possível ler as credenciais de VPS guardadas neste PC.')
  }
}

function gravar(credenciais: Map<string, string>) {
  const destino = arquivo()
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const temporario = destino + '.tmp'
  try {
    fs.writeFileSync(temporario, JSON.stringify(Object.fromEntries(credenciais)), { mode: 0o600 })
    fs.renameSync(temporario, destino)
  } catch {
    throw new Error('Não foi possível gravar as credenciais de VPS neste PC.')
  } finally {
    try { fs.unlinkSync(temporario) } catch { /* Já movido ou indisponível. */ }
  }
}

function criptografiaDisponivel() {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}

export const credenciaisVps = {
  origens() { return criptografiaDisponivel() ? [...ler().keys()] : [] },
  obter(origem: string) {
    if (!criptografiaDisponivel()) return undefined
    const cifrada = ler().get(origem)
    if (!cifrada) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(cifrada, 'base64'))
    } catch {
      throw new Error('A credencial guardada não pode ser lida neste PC. Teste e guarde uma credencial nova.')
    }
  },
  guardar(origem: string, credencial: string) {
    if (!criptografiaDisponivel()) throw new Error('O cofre de credenciais do sistema não está disponível neste PC.')
    const todas = ler()
    todas.set(origem, safeStorage.encryptString(credencial).toString('base64'))
    gravar(todas)
  },
  esquecer(origem: string) {
    const todas = ler()
    if (todas.delete(origem)) gravar(todas)
  }
}
