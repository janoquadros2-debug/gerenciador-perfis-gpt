// Atalhos para a interface conversar com o motor.
import { useEffect, useState } from 'react'
import type { Configuracoes, EstadoMotor, StatusRede } from '../../shared/types'

declare global {
  interface Window {
    api: {
      chamar: (nome: string, ...args: unknown[]) => Promise<any>
      ouvir: (canal: string, fn: (dado: any) => void) => () => void
    }
  }
}

export const chamar = <T = any>(nome: string, ...args: unknown[]): Promise<T> => window.api.chamar(nome, ...args)
export const ouvir = (canal: string, fn: (dado: any) => void) => window.api.ouvir(canal, fn)

export function useEstado(): EstadoMotor | null {
  const [estado, setEstado] = useState<EstadoMotor | null>(null)
  useEffect(() => {
    chamar<EstadoMotor>('estado').then(setEstado)
    return ouvir('estado', setEstado)
  }, [])
  return estado
}

// Configurações compartilhadas por todas as telas (salvam sozinhas ao mudar).
let cache: Configuracoes | null = null
const inscritos = new Set<(c: Configuracoes) => void>()

export function useConfig(): [Configuracoes | null, (parcial: Partial<Configuracoes>) => void] {
  const [cfg, setCfg] = useState<Configuracoes | null>(cache)
  useEffect(() => {
    inscritos.add(setCfg)
    if (!cache) chamar<Configuracoes>('obterConfig').then((c) => {
      cache = c
      inscritos.forEach((f) => f(c))
    })
    return () => {
      inscritos.delete(setCfg)
    }
  }, [])
  const salvar = (parcial: Partial<Configuracoes>) => {
    if (!cache) return
    cache = { ...cache, ...parcial }
    inscritos.forEach((f) => f(cache!))
    chamar('salvarConfig', parcial)
  }
  return [cfg, salvar]
}

// Status da ligação entre os PCs. Quando muda o papel ou a conexão, a tela recarrega
// para buscar tudo de novo (do PC certo).
export function useRede(): StatusRede | null {
  const [st, setSt] = useState<StatusRede | null>(null)
  useEffect(() => {
    let anterior: StatusRede | null = null
    chamar<StatusRede>('rede').then((s) => {
      anterior = s
      setSt(s)
    })
    return ouvir('rede', (s: StatusRede) => {
      if (anterior && (anterior.papel !== s.papel || (s.papel === 'principal' && (anterior.conectado !== s.conectado || anterior.alvoAtivoId !== s.alvoAtivoId)))) {
        location.reload()
        return
      }
      anterior = s
      setSt(s)
    })
  }, [])
  return st
}

export function formatarGB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1) + ' GB'
}
