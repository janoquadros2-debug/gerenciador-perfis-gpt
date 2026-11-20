import type { WhatsAppAgendaVps } from '../shared/lives-vps'

export function avisosWhatsApp(config: WhatsAppAgendaVps) {
  const telefone = config.telefoneId.trim()
  const destinatario = config.destinatario.trim().replace(/^\+/, '')
  const token = config.token.trim()
  const modelo = config.modelo.trim()
  const idioma = config.idioma.trim()
  if (!/^\d+$/.test(telefone) || !/^\d{8,15}$/.test(destinatario) || !token ||
      !/^[a-z0-9_]+$/.test(modelo) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(idioma))
    throw new Error('Confira o identificador, o número com DDI, o token, o modelo e o idioma do WhatsApp.')

  return async (aviso: string) => {
    const texto = aviso.replace(/\s+/g, ' ').trim().slice(0, 512)
    let resposta: Response
    try {
      resposta = await fetch(`https://graph.facebook.com/v27.0/${telefone}/messages`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: destinatario, type: 'template',
          template: { name: modelo, language: { code: idioma },
            components: [{ type: 'body', parameters: [{ type: 'text', text: texto }] }] }
        })
      })
    } catch {
      throw new Error('A API do WhatsApp não respondeu.')
    }
    if (!resposta.ok) throw new Error(`A Meta recusou o aviso (HTTP ${resposta.status}).`)
    const dado = await resposta.json().catch(() => null) as { messages?: { id?: string }[] } | null
    if (!dado?.messages?.[0]?.id) throw new Error('A Meta não devolveu um identificador para o aviso.')
  }
}
