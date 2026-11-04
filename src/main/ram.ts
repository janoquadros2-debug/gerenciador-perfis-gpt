// Limpador de memória RAM.
// 1) Pede para cada navegador aberto liberar o que não precisa (cache e memória de JavaScript sem uso).
// 2) No Windows, pede para os programas abertos devolverem a memória que não estão usando
//    (o mesmo que o "Empty Working Sets" do RAMMap da Microsoft). Os programas continuam funcionando;
//    se precisarem de algo de volta, o Windows devolve sozinho.
import { execFile } from 'node:child_process'
import os from 'node:os'
import type { Browser } from 'puppeteer-core'

const SCRIPT_WINDOWS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace Limpeza -Name Memoria -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(System.IntPtr h);'
$n = 0
foreach ($p in Get-Process) { try { if ([Limpeza.Memoria]::EmptyWorkingSet($p.Handle)) { $n++ } } catch {} }
Write-Output $n
`

export const usoRam = () => {
  const total = os.totalmem()
  const usada = total - os.freemem()
  return { usada, total, porcentagem: Math.round((usada / total) * 100) }
}

async function aliviarNavegador(browser: Browser) {
  for (const pagina of await browser.pages()) {
    try {
      const cdp = await pagina.createCDPSession()
      await cdp.send('Memory.simulatePressureNotification', { level: 'critical' }).catch(() => undefined)
      await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined)
      await cdp.detach()
    } catch {
      /* página ocupada ou fechando: pula */
    }
  }
}

function limparProgramasWindows(): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT_WINDOWS],
      { windowsHide: true, timeout: 90_000 },
      (_erro, saida) => resolve(Number(String(saida).trim()) || 0)
    )
  })
}

export interface ResultadoLimpeza {
  antes: number // % de uso
  depois: number
  liberado: number // bytes
  programas: number // quantos programas devolveram memória
}

let limpando: Promise<ResultadoLimpeza> | null = null

export function limparRam(navegadores: Browser[]): Promise<ResultadoLimpeza> {
  // se já está limpando, espera a mesma limpeza em vez de começar outra
  if (limpando) return limpando
  limpando = (async () => {
    const antes = usoRam()
    await Promise.all(navegadores.map((b) => aliviarNavegador(b).catch(() => undefined)))
    const programas = await limparProgramasWindows()
    await new Promise((r) => setTimeout(r, 1500)) // dá um tempo para o Windows atualizar os números
    const depois = usoRam()
    return {
      antes: antes.porcentagem,
      depois: depois.porcentagem,
      liberado: Math.max(0, antes.usada - depois.usada),
      programas
    }
  })().finally(() => {
    limpando = null
  })
  return limpando
}
