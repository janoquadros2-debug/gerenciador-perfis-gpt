import type { TempoAberto } from './types'

// Quanto tempo (em ms) um perfil fica aberto. Aleatório: qualquer valor entre "de" e "até", ao segundo.
export function sortearDuracao(t?: TempoAberto): number | undefined {
  if (!t || t.modo === 'sem-limite') return undefined
  if (t.modo === 'fixo') return t.minutos > 0 ? t.minutos * 60_000 : undefined
  const de = Math.max(0, Math.min(t.de, t.ate))
  const ate = Math.max(t.de, t.ate)
  if (ate <= 0) return undefined
  const segundos = Math.round(de * 60 + Math.random() * (ate - de) * 60)
  return Math.max(1, segundos) * 1000
}

// Monta a lista de sistemas para N perfis respeitando as porcentagens e embaralha a ordem.
// Ex.: 10 perfis com 70/20/10 → exatamente 7 Windows, 2 macOS e 1 Linux, em ordem aleatória.
export type Sistema = 'windows' | 'macos' | 'linux'

export function contarPorSistema(total: number, p: Record<Sistema, number>): Record<Sistema, number> {
  const chaves: Sistema[] = ['windows', 'macos', 'linux']
  const soma = chaves.reduce((s, k) => s + Math.max(0, p[k]), 0) || 1
  const exatos = chaves.map((k) => (total * Math.max(0, p[k])) / soma)
  const contas = exatos.map(Math.floor)
  // distribui o que sobrou para quem ficou com a maior "sobra"
  let falta = total - contas.reduce((a, b) => a + b, 0)
  const ordem = exatos.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])
  for (let j = 0; falta > 0; j++, falta--) contas[ordem[j % 3][1]]++
  return { windows: contas[0], macos: contas[1], linux: contas[2] }
}

export function sortearSistemas(total: number, p: Record<Sistema, number>): Sistema[] {
  const c = contarPorSistema(total, p)
  const lista: Sistema[] = [
    ...Array<Sistema>(c.windows).fill('windows'),
    ...Array<Sistema>(c.macos).fill('macos'),
    ...Array<Sistema>(c.linux).fill('linux')
  ]
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
  }
  return lista
}
