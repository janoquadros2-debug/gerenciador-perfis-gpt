// Aviso de cookies: clica sozinho em "Aceitar" (ou "Recusar") quando um site mostra o aviso.
// Funciona com os avisos mais comuns (OneTrust, Cookiebot, Didomi, Quantcast, Google/YouTube, Twitch…)
// e, se não reconhecer, procura um botão com o texto certo dentro do aviso.
import type { Browser, Frame, Page } from 'puppeteer-core'

export type ModoCookies = 'aceitar' | 'recusar' | 'desligado'

// roda DENTRO da página: devolve true se clicou em algo
function clicarNoAviso(modo: 'aceitar' | 'recusar'): boolean {
  const SELETORES: Record<string, string[]> = {
    aceitar: [
      '#onetrust-accept-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#CybotCookiebotDialogBodyButtonAccept',
      '#didomi-notice-agree-button',
      '.qc-cmp2-summary-buttons button[mode="primary"]',
      '[data-a-target="consent-banner-accept"]',
      'button[aria-label="Accept all"]',
      'button[aria-label="Aceitar tudo"]',
      '#L2AGLb',
      '.fc-cta-consent',
      '#truste-consent-button',
      '.cc-allow',
      '.cookie-accept'
    ],
    recusar: [
      '#onetrust-reject-all-handler',
      '#CybotCookiebotDialogBodyButtonDecline',
      '#didomi-notice-disagree-button',
      '.qc-cmp2-summary-buttons button[mode="secondary"]',
      '[data-a-target="consent-banner-reject"]',
      'button[aria-label="Reject all"]',
      'button[aria-label="Rejeitar tudo"]',
      '#W0wltc',
      '.fc-cta-do-not-consent',
      '.cc-deny'
    ]
  }
  // textos dos botões em vários idiomas (o site costuma mostrar o aviso na língua do país do proxy)
  const TEXTOS: Record<string, RegExp> = {
    aceitar: new RegExp(
      '^(' +
        [
          // português
          'aceitar( todos| tudo| cookies| e fechar)?', 'concordo', 'eu concordo', 'ok, entendi', 'entendi', 'permitir( todos| tudo)?', 'aceito',
          // inglês
          'accept( all| cookies| all cookies| and close| & close)?', 'allow( all)?( cookies)?', 'i agree', 'agree( and close)?', 'got it', 'i accept', 'yes, i agree',
          // espanhol
          'aceptar( todo| todas| todos| cookies| y cerrar)?', 'acepto', 'de acuerdo', 'permitir todas',
          // francês
          "accepter( tout| et fermer| les cookies)?", "tout accepter", "j'accepte", "d'accord", 'ok pour moi',
          // alemão
          'alle akzeptieren', 'akzeptieren( und schließen)?', 'alle cookies akzeptieren', 'zustimmen', 'einverstanden', 'alles akzeptieren', 'ich stimme zu',
          // italiano
          'accetta( tutto| tutti| e chiudi)?', 'accetto', 'acconsento',
          // holandês
          'alles accepteren', 'accepteren', 'akkoord', 'alle cookies accepteren',
          // polonês
          'akceptuj( wszystko)?', 'zaakceptuj( wszystko)?', 'zgadzam się', 'zgoda',
          // russo / ucraniano
          'принять( все)?', 'согласен', 'я согласен', 'прийняти( все)?',
          // turco
          'kabul et', 'tümünü kabul et', 'kabul ediyorum',
          // sueco / dinamarquês / norueguês
          'acceptera( alla)?', 'godkänn( alla)?', 'accepter alle', 'godta alle', 'tillad alle',
          // tcheco / romeno / húngaro / grego
          'přijmout vše', 'souhlasím', 'accept toate', 'acceptă( tot)?', 'elfogadom', 'összes elfogadása', 'αποδοχή( όλων)?',
          // japonês / chinês / coreano
          'すべて受け入れる', '同意する', '同意', '接受( 全部| 所有)?', '全部接受', '同意并继续', '모두 수락', '동의', '수락'
        ].join('|') +
        ')[.!]?$',
      'i'
    ),
    recusar: new RegExp(
      '^(' +
        [
          'recusar( todos| tudo)?', 'rejeitar( todos| tudo)?', 'somente (os )?(necessários|essenciais)', 'apenas (os )?(necessários|essenciais)', 'continuar sem aceitar',
          'reject( all)?', 'decline( all)?', 'deny', 'only (necessary|essential)( cookies)?', 'necessary (cookies )?only', 'refuse( all)?',
          'rechazar( todo| todas)?', 'solo (las )?necesarias', 'denegar',
          'tout refuser', 'refuser( tout)?', 'continuer sans accepter',
          'alle ablehnen', 'ablehnen', 'nur notwendige( cookies)?',
          'rifiuta( tutto)?', 'solo necessari',
          'alles weigeren', 'weigeren', 'alleen noodzakelijke',
          'odrzuć( wszystko)?', 'отклонить( все)?', 'reddet', 'tümünü reddet', 'avvisa alla', 'afvis alle', 'odmítnout vše',
          'すべて拒否', '拒否', '拒绝( 全部| 所有)?', '모두 거부', '거부'
        ].join('|') +
        ')[.!]?$',
      'i'
    )
  }
  const visivel = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect()
    const st = getComputedStyle(el as HTMLElement)
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
  }
  // Inclui componentes com shadow DOM aberto, usados por alguns avisos modernos.
  const raizes: Array<Document | ShadowRoot> = [document]
  for (const raiz of raizes) {
    if (raizes.length > 24) break
    for (const elemento of [...raiz.querySelectorAll('*')].slice(0, 300)) {
      if (elemento.shadowRoot) raizes.push(elemento.shadowRoot)
    }
  }
  for (const sel of SELETORES[modo]) {
    const el = raizes.map((raiz) => raiz.querySelector(sel)).find(Boolean)
    if (el && visivel(el)) {
      ;(el as HTMLElement).click()
      return true
    }
  }
  // genérico: só botões que estão dentro de algo que fala de cookies/privacidade
  const botoes = raizes.flatMap((raiz) => [...raiz.querySelectorAll('button, [role="button"], a.button, input[type="button"], input[type="submit"]')]).slice(0, 400)
  for (const b of botoes) {
    const texto = ((b as HTMLInputElement).value || b.textContent || '').replace(/\s+/g, ' ').trim()
    if (!texto || texto.length > 40 || !TEXTOS[modo].test(texto) || !visivel(b)) continue
    let pai: Element | null = b
    let fala = false
    for (let i = 0; i < 8 && pai; i++, pai = pai.parentElement ?? (pai.getRootNode() instanceof ShadowRoot ? (pai.getRootNode() as ShadowRoot).host : null)) {
      if (/cookie|consent|privacidade|privacy|gdpr|lgpd|datenschutz|confidentialité|privacidad|riservatezza|prywatn|конфиденц|файл|gizlilik|プライバシー|隐私|개인정보/i.test(`${pai.id} ${pai.className} ${pai.getAttribute?.('aria-label') ?? ''} ${(pai.textContent ?? '').slice(0, 600)}`)) {
        fala = true
        break
      }
    }
    if (fala) {
      ;(b as HTMLElement).click()
      return true
    }
  }
  return false
}

async function tentarEmTodos(pagina: Page, modo: 'aceitar' | 'recusar'): Promise<boolean> {
  const quadros: Frame[] = pagina.frames()
  for (const q of quadros) {
    const ok = await q.evaluate(clicarNoAviso, modo).catch(() => false)
    if (ok) return true
  }
  return false
}

// Mantém apenas uma verificação por aba para evitar centenas de timers em 50 perfis.
function vigiarPagina(pagina: Page, modo: () => ModoCookies, aoClicar: () => void) {
  if ((pagina as any).__cookies) return
  ;(pagina as any).__cookies = true
  let ocupado = false
  let tratado = false
  let tentativas = 0
  let ultimaAcao = 0
  const checar = async () => {
    if (pagina.isClosed()) { clearInterval(timer); return }
    if (ocupado || (tratado && Date.now() - ultimaAcao < 30000) || modo() === 'desligado') return
    ocupado = true
    try {
      if (await tentarEmTodos(pagina, modo() as 'aceitar' | 'recusar')) {
        tratado = true
        ultimaAcao = Date.now()
        aoClicar()
      }
    } catch {
      // Uma aba em navegação pode invalidar o iframe; repetir depois.
    } finally { ocupado = false }
  }
  const aoCarregar = () => { tratado = false; tentativas = 0; void checar() }
  const timer = setInterval(() => {
    if (pagina.isClosed()) { clearInterval(timer); return }
    if (tentativas++ < 120) void checar()
  }, 5000)
  pagina.on('load', aoCarregar)
  pagina.on('domcontentloaded', aoCarregar)
  pagina.once('close', () => clearInterval(timer))
  setTimeout(() => { if (!pagina.isClosed()) void checar() }, 1200)
}

// liga em todas as abas do navegador (as que já existem e as que abrirem depois)
export async function vigiarCookies(browser: Browser, modo: () => ModoCookies, aoClicar: (url: string) => void) {
  const ligar = (p: Page) => vigiarPagina(p, modo, () => aoClicar(p.url()))
  for (const p of await browser.pages()) ligar(p)
  browser.on('targetcreated', async (t) => {
    const p = await t.page().catch(() => null)
    if (p) ligar(p)
  })
}
