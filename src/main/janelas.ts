// Organizador de janelas: calcula a posição de cada navegador na grade e nos monitores.
import { screen } from 'electron'
import { posicaoNaGrade } from '../shared/grade'
import type { ConfigJanelas, Monitor } from '../shared/types'

export function listarMonitores(): Monitor[] {
  const principal = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d, i) => ({
      id: d.id,
      nome: d.id === principal ? `Monitor ${i + 1} (principal)` : `Monitor ${i + 1}`,
      x: d.workArea.x,
      y: d.workArea.y,
      largura: d.workArea.width,
      altura: d.workArea.height,
      principal: d.id === principal
    }))
}

function monitoresEmUso(cfg: ConfigJanelas): Monitor[] {
  const todos = listarMonitores()
  const escolhidos = cfg.monitores.map((id) => todos.find((m) => m.id === id)).filter(Boolean) as Monitor[]
  return escolhidos.length ? escolhidos : todos
}

export function retanguloDoSlot(slot: number, cfg: ConfigJanelas) {
  const monitores = monitoresEmUso(cfg)
  const porMonitor = Math.max(1, cfg.colunas * cfg.linhas)
  const i = slot - 1
  const mon = monitores[Math.floor(i / porMonitor) % monitores.length]
  const { linha, coluna } = posicaoNaGrade(i % porMonitor, cfg)
  return {
    left: Math.round(mon.x + coluna * (cfg.largura + cfg.espaco)),
    top: Math.round(mon.y + linha * (cfg.altura + cfg.espaco)),
    width: cfg.largura,
    height: cfg.altura
  }
}
