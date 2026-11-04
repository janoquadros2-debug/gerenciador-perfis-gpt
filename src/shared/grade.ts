import type { ConfigJanelas } from './types'

// Posição (linha/coluna) da janela k (começando em 0) dentro de um monitor, conforme a ordem escolhida.
export function posicaoNaGrade(k: number, cfg: ConfigJanelas): { linha: number; coluna: number } {
  const { colunas, linhas, ordem } = cfg
  if (ordem === 'coluna') return { coluna: Math.floor(k / linhas), linha: k % linhas }
  if (ordem === 'blocos-3x2') {
    const blocosPorLinha = Math.max(1, Math.ceil(colunas / 3))
    const b = Math.floor(k / 6)
    const dentro = k % 6
    return {
      linha: Math.floor(b / blocosPorLinha) * 2 + Math.floor(dentro / 3),
      coluna: (b % blocosPorLinha) * 3 + (dentro % 3)
    }
  }
  return { linha: Math.floor(k / colunas), coluna: k % colunas }
}

// Tamanho mínimo que o navegador costuma aceitar (abaixo disso ele não encolhe).
export const LARGURA_MINIMA = 500
