// Uso do computador (ao vivo): CPU, RAM, placa de vídeo e temperaturas.
// - CPU e RAM: o próprio Windows informa.
// - Placa de vídeo NVIDIA: pelo "nvidia-smi", que vem junto com o driver da NVIDIA.
// - Temperatura da CPU: pelo sensor da placa-mãe que o Windows expõe (nem todo PC informa; aí aparece "—").
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UsoHardware } from '../shared/types'

const rodar = (exe: string, args: string[], ms = 4000) =>
  new Promise<string>((ok) => execFile(exe, args, { windowsHide: true, timeout: ms }, (_e, saida) => ok(String(saida ?? ''))))

// ---------- CPU (diferença entre duas leituras) ----------
let anterior = os.cpus().map((c) => c.times)
function usoCpu(): number {
  const agora = os.cpus().map((c) => c.times)
  let ocupado = 0
  let total = 0
  agora.forEach((t, i) => {
    const a = anterior[i] ?? t
    const tot = t.user + t.nice + t.sys + t.idle + t.irq - (a.user + a.nice + a.sys + a.idle + a.irq)
    total += tot
    ocupado += tot - (t.idle - a.idle)
  })
  anterior = agora
  return total > 0 ? Math.round((ocupado / total) * 100) : 0
}

// ---------- temperatura da CPU (lida a cada 15 s: o PowerShell é lento para abrir) ----------
let tempCpu: number | undefined
let ultimaTemp = 0
let lendoTemp = false
function atualizarTempCpu() {
  if (process.platform !== 'win32' || lendoTemp || Date.now() - ultimaTemp < 15_000) return
  lendoTemp = true
  ultimaTemp = Date.now()
  const script =
    "$z = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue; " +
    "if ($z) { ($z | Measure-Object -Property HighPrecisionTemperature -Maximum).Maximum } " +
    "else { $w = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue; if ($w) { (($w | Measure-Object -Property CurrentTemperature -Maximum).Maximum) } }"
  rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 10_000).then((s) => {
    lendoTemp = false
    const v = Number(s.trim())
    // os dois sensores informam em décimos de Kelvin
    const c = v > 2000 ? Math.round(v / 10 - 273.15) : undefined
    tempCpu = c && c > 5 && c < 120 ? c : undefined
  })
}

// ---------- placa de vídeo NVIDIA ----------
let nvidiaSmi: string | null | undefined
function acharNvidiaSmi(): string | null {
  if (nvidiaSmi !== undefined) return nvidiaSmi
  const opcoes = [
    path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
  ]
  nvidiaSmi = process.platform === 'win32' ? (opcoes.find((p) => fs.existsSync(p)) ?? null) : 'nvidia-smi'
  return nvidiaSmi
}

async function usoGpu(): Promise<UsoHardware['gpu']> {
  const exe = acharNvidiaSmi()
  if (!exe) return undefined
  const s = await rodar(exe, ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'])
  const linha = s.split(/\r?\n/).find((l) => l.trim())
  if (!linha) return undefined
  const [nome, uso, usada, total, temp] = linha.split(',').map((x) => x.trim())
  const n = (x: string) => (Number.isFinite(Number(x)) ? Number(x) : undefined)
  return { nome: nome.replace(/^NVIDIA\s+/i, ''), porcentagem: n(uso), vramUsadaGb: n(usada) !== undefined ? +(Number(usada) / 1024).toFixed(1) : undefined, vramTotalGb: n(total) !== undefined ? +(Number(total) / 1024).toFixed(1) : undefined, temperatura: n(temp) }
}

export async function lerHardware(): Promise<UsoHardware> {
  atualizarTempCpu()
  const total = os.totalmem()
  const usada = total - os.freemem()
  return {
    nome: os.hostname(),
    cpu: { nome: os.cpus()[0]?.model.replace(/\s+/g, ' ').trim(), porcentagem: usoCpu(), temperatura: tempCpu },
    ram: { usadaGb: +(usada / 1024 ** 3).toFixed(1), totalGb: +(total / 1024 ** 3).toFixed(1), porcentagem: Math.round((usada / total) * 100) },
    gpu: await usoGpu().catch(() => undefined),
    quando: Date.now()
  }
}
