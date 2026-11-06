// Diagnóstico somente informativo; nunca dispara uma substituição de perfil ou proxy.
export type CategoriaFalha = 'dolphin' | 'proxy' | 'rede' | 'pagina' | 'autenticacao' | 'desconhecido'

export function categorizarFalha(erro: unknown): CategoriaFalha {
  const texto = String(erro instanceof Error ? erro.message : erro).toLowerCase()
  if (/401|403|unauthoriz|token|autentica|credencial|login/.test(texto)) return 'autenticacao'
  if (/proxy|socks|407|tunnel/.test(texto)) return 'proxy'
  if (/dolphin|browser_profiles|fingerprint|api local|3001/.test(texto)) return 'dolphin'
  if (/net::|dns|econn|etimedout|timeout|network|conexão|conexao|socket|offline/.test(texto)) return 'rede'
  if (/404|500|site|página|pagina|chrome-error|http/.test(texto)) return 'pagina'
  return 'desconhecido'
}

export function ipsRepetidos<T extends { ip?: string; status?: string; ipRepetido?: boolean }>(lista: T[]): void {
  const contagem = new Map<string, number>()
  for (const p of lista) {
    if (p.status === 'ok' && p.ip) contagem.set(p.ip, (contagem.get(p.ip) ?? 0) + 1)
  }
  for (const p of lista) p.ipRepetido = !!p.ip && (contagem.get(p.ip) ?? 0) > 1
}
