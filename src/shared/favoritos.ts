import type { ConfiguracaoFavorito } from './types'

export function configuracaoFavorito(o: ConfiguracaoFavorito): ConfiguracaoFavorito {
  return {
    quantidade: o.quantidade, nomeBase: o.nomeBase, comecarDe: o.comecarDe,
    etiqueta: o.etiqueta, sistema: o.sistema, porcentagens: o.porcentagens,
    site2: o.site2, cookies: o.cookies, privacidade: o.privacidade,
    abrirAoCriar: o.abrirAoCriar, tempoAberto: o.tempoAberto, aoAcabar: o.aoAcabar,
    tempoFechadoMinutos: o.tempoFechadoMinutos, tempoFechado: o.tempoFechado,
    recarregar: o.recarregar, manterAtivas: o.manterAtivas, encerrarCiclo: o.encerrarCiclo
  }
}

export function siteFavorito(texto: string): string {
  const endereco = texto.trim()
  const temProtocolo = /^[a-z][a-z0-9+.-]*:\/\//i.test(endereco)
  const erro = 'Informe um endereço HTTP ou HTTPS válido.'
  if (!endereco || /[\s\\]/.test(endereco)) throw new Error(erro)
  let url: URL
  try {
    url = new URL(temProtocolo ? endereco : 'https://' + endereco)
  } catch {
    throw new Error(erro)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error(erro)
  return url.href
}

export const MAX_HORAS_CICLO = 168

export function horasCicloValidas(horas: number) {
  return Number.isFinite(horas) && horas >= 1 / 60 && horas <= MAX_HORAS_CICLO
}
