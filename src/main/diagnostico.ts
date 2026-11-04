// Diagnóstico passivo: lê estado de mídia sem interagir com controles do site.
import type { Page } from 'puppeteer-core'

export interface AmostraMidia {
  encontrado: boolean
  tempo: number
  pausado: boolean
  encerrado: boolean
  pronto: number
  esperando: boolean
  erro: boolean
  avisoCookies: boolean
}

export async function lerAmostraMidia(pagina: Page): Promise<AmostraMidia | null> {
  for (const frame of pagina.frames().slice(0, 5)) {
    try {
      const resultado = await Promise.race([
        frame.evaluate(() => {
          const mostrar = (el: Element | null): boolean => {
            if (!(el instanceof HTMLElement)) return false
            const rect = el.getBoundingClientRect()
            const st = getComputedStyle(el)
            return rect.width > 0 && rect.height > 0 && st.display !== 'none' && st.visibility !== 'hidden'
          }
          const avisos = ['#onetrust-banner-sdk', '#CybotCookiebotDialog', '#didomi-host', '.qc-cmp2-container', '[aria-modal="true"]']
          const avisoCookies = avisos.some((sel) => {
            const el = document.querySelector(sel)
            return mostrar(el) && (sel !== '[aria-modal="true"]' || /cookie|consent|privacidade|privacy|aceitar|accept/i.test(el?.textContent?.slice(0, 700) ?? ''))
          })
          const video = [...document.querySelectorAll('video')].find((el) => mostrar(el)) as HTMLVideoElement | undefined
          return {
            encontrado: !!video,
            tempo: video?.currentTime ?? 0,
            pausado: video?.paused ?? true,
            encerrado: video?.ended ?? false,
            pronto: video?.readyState ?? 0,
            esperando: !!video && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA,
            erro: !!video?.error,
            avisoCookies
          }
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500))
      ])
      if (resultado && (resultado.encontrado || resultado.avisoCookies)) return resultado
    } catch {
      // Iframes que navegam durante a consulta serão verificados na próxima rodada.
    }
  }
  return null
}
