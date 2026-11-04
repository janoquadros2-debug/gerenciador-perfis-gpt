// Ponte segura entre a interface e o motor.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  chamar: (nome: string, ...args: unknown[]) => ipcRenderer.invoke('chamar', nome, ...args),
  ouvir: (canal: string, fn: (dado: unknown) => void) => {
    const ouvinte = (_e: unknown, dado: unknown) => fn(dado)
    ipcRenderer.on(canal, ouvinte)
    return () => ipcRenderer.removeListener(canal, ouvinte)
  }
})
