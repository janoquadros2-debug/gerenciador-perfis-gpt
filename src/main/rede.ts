// Ligação entre os dois PCs (edição Completa).
// - Secundário: abre uma "porta" na rede de casa e executa as ordens que chegam (navegadores, proxies, Dolphin…).
// - Principal: conecta no secundário e repassa para ele tudo o que você faz na tela; recebe de volta o Ao vivo, os logs etc.
// Só aceita quem digitar o código de pareamento que aparece no secundário.
import { randomInt } from 'node:crypto'
import dgram from 'node:dgram'
import os from 'node:os'
import { WebSocket, WebSocketServer } from 'ws'
import type { ConfigRede, PcEncontrado, StatusRede } from '../shared/types'

export const PORTA = 47920 // comandos
const PORTA_BUSCA = 47921 // "tem alguém aí?" na rede
const PERGUNTA = 'GERENCIADOR-PERFIS-GPT?'

type Msg =
  | { t: 'ola'; codigo: string; nome: string; versao: string }
  | { t: 'bem-vindo'; nome: string; versao: string }
  | { t: 'recusado'; motivo: string }
  | { t: 'chamar'; id: number; nome: string; args: unknown[] }
  | { t: 'resp'; id: number; ok: boolean; valor?: unknown; erro?: string }
  | { t: 'evento'; canal: string; dado: unknown }

export const novoCodigo = () => String(randomInt(100000, 1000000))

export function meusIps(): string[] {
  const ips: string[] = []
  for (const lista of Object.values(os.networkInterfaces()))
    for (const i of lista ?? []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address)
  return ips
}

interface Opcoes {
  versao: string
  edicao: 'completa' | 'padrao'
  executar: (nome: string, args: unknown[]) => Promise<unknown> // roda uma ação neste PC
  aoMudarStatus: (s: StatusRede) => void
  aoEvento: (canal: string, dado: unknown) => void // principal: evento que veio do secundário
  log: (nivel: 'info' | 'ok' | 'aviso' | 'erro', texto: string) => void
}

export class Rede {
  private cfg!: ConfigRede
  private servidor?: WebSocketServer
  private busca?: dgram.Socket
  private clientes = new Set<WebSocket>() // secundário: principais conectados
  private nomesClientes = new Map<WebSocket, string>()
  private ws?: WebSocket // principal: ligação com o secundário
  private pendentes = new Map<number, { ok: (v: unknown) => void; erro: (e: Error) => void; timer: NodeJS.Timeout }>()
  private proximoId = 1
  private st: StatusRede
  private timerReconectar?: NodeJS.Timeout
  private parado = false

  constructor(private o: Opcoes) {
    this.st = { edicao: o.edicao, papel: 'unico', conectado: false, conectando: false, meusIps: meusIps(), meuNome: os.hostname() }
  }

  get status() {
    return { ...this.st, meusIps: meusIps() }
  }
  get papel() {
    return this.cfg?.papel ?? 'unico'
  }
  // principal conectado: as ações vão para o outro PC
  get repassando() {
    return this.papel === 'principal'
  }
  get conectado() {
    return this.st.conectado
  }

  private mudar(p: Partial<StatusRede>) {
    this.st = { ...this.st, ...p }
    this.o.aoMudarStatus(this.status)
  }

  aplicar(cfg: ConfigRede) {
    this.parar()
    this.parado = false
    this.cfg = this.o.edicao === 'padrao' ? { ...cfg, papel: 'unico' } : cfg
    this.mudar({ papel: this.cfg.papel, conectado: false, conectando: false, erro: undefined, nomeOutroPc: undefined, versaoOutroPc: undefined, meuCodigo: this.cfg.papel === 'secundario' ? this.cfg.meuCodigo : undefined, endereco: this.cfg.papel === 'principal' ? this.cfg.endereco : undefined })
    if (this.cfg.papel === 'secundario') this.iniciarServidor()
    if (this.cfg.papel === 'principal' && this.cfg.endereco && this.cfg.codigo) this.conectar()
  }

  parar() {
    this.parado = true
    clearTimeout(this.timerReconectar)
    for (const c of this.clientes) c.close()
    this.clientes.clear()
    this.servidor?.close()
    this.servidor = undefined
    try {
      this.busca?.close()
    } catch {
      /* já fechado */
    }
    this.busca = undefined
    this.ws?.removeAllListeners()
    this.ws?.terminate()
    this.ws = undefined
    for (const p of this.pendentes.values()) {
      clearTimeout(p.timer)
      p.erro(new Error('A conexão com o PC secundário foi fechada.'))
    }
    this.pendentes.clear()
  }

  // ================= SECUNDÁRIO =================
  private iniciarServidor() {
    const srv = new WebSocketServer({ port: PORTA, maxPayload: 64 * 1024 * 1024 })
    this.servidor = srv
    srv.on('listening', () => this.o.log('ok', `Modo secundário: aguardando o PC principal (porta ${PORTA}, IP ${meusIps().join(' ou ')}).`))
    srv.on('error', (e: any) => {
      const msg = e?.code === 'EADDRINUSE' ? `A porta ${PORTA} já está em uso. Feche outra cópia do programa.` : String(e?.message ?? e)
      this.o.log('erro', msg)
      this.mudar({ erro: msg })
    })
    srv.on('connection', (c, req) => {
      const ip = req.socket.remoteAddress?.replace('::ffff:', '') ?? '?'
      let autenticado = false
      const prazo = setTimeout(() => !autenticado && c.close(), 8000)
      c.on('message', async (bruto) => {
        let m: Msg
        try {
          m = JSON.parse(String(bruto))
        } catch {
          return
        }
        if (!autenticado) {
          if (m.t !== 'ola') return c.close()
          if (m.codigo !== this.cfg.meuCodigo) {
            this.o.log('aviso', `Tentativa de conexão de ${ip} com código errado. Recusada.`)
            this.enviarPara(c, { t: 'recusado', motivo: 'Código de pareamento errado.' })
            return setTimeout(() => c.close(), 200)
          }
          autenticado = true
          clearTimeout(prazo)
          this.clientes.add(c)
          this.nomesClientes.set(c, m.nome)
          this.enviarPara(c, { t: 'bem-vindo', nome: os.hostname(), versao: this.o.versao })
          this.o.log('ok', `PC principal "${m.nome}" (${ip}) conectado.${m.versao !== this.o.versao ? ` Atenção: ele está na v${m.versao} e este na v${this.o.versao}.` : ''}`)
          this.mudar({ conectado: true, nomeOutroPc: m.nome, versaoOutroPc: m.versao })
          return
        }
        if (m.t === 'chamar') {
          try {
            const valor = await this.o.executar(m.nome, m.args ?? [])
            this.enviarPara(c, { t: 'resp', id: m.id, ok: true, valor })
          } catch (e: any) {
            this.enviarPara(c, { t: 'resp', id: m.id, ok: false, erro: String(e?.message ?? e) })
          }
        }
      })
      c.on('close', () => {
        clearTimeout(prazo)
        if (!this.clientes.delete(c)) return
        const nome = this.nomesClientes.get(c)
        this.nomesClientes.delete(c)
        this.o.log('aviso', `PC principal "${nome}" desconectou. Os navegadores continuam rodando aqui.`)
        const outro = [...this.nomesClientes.values()][0]
        this.mudar({ conectado: this.clientes.size > 0, nomeOutroPc: outro })
      })
      c.on('error', () => undefined)
    })

    // responde a quem procurar PCs na rede
    const b = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.busca = b
    b.on('message', (msg, remoto) => {
      if (String(msg) !== PERGUNTA) return
      const resp = JSON.stringify({ nome: os.hostname(), versao: this.o.versao })
      b.send(resp, remoto.port, remoto.address)
    })
    b.on('error', () => undefined)
    b.bind(PORTA_BUSCA)
  }

  private enviarPara(c: WebSocket, m: Msg) {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(m))
  }

  // secundário: manda um evento (estado, logs…) para os principais conectados
  transmitir(canal: string, dado: unknown) {
    if (this.papel !== 'secundario') return
    for (const c of this.clientes) this.enviarPara(c, { t: 'evento', canal, dado })
  }

  novoCodigo(): string {
    const c = novoCodigo()
    this.cfg.meuCodigo = c
    for (const cl of this.clientes) cl.close() // quem usava o código antigo precisa digitar o novo
    this.mudar({ meuCodigo: c })
    return c
  }

  // ================= PRINCIPAL =================
  private conectar() {
    if (this.parado) return
    clearTimeout(this.timerReconectar)
    this.mudar({ conectando: true, erro: undefined })
    const ws = new WebSocket(`ws://${this.cfg.endereco}:${PORTA}`, { handshakeTimeout: 6000, maxPayload: 64 * 1024 * 1024 })
    this.ws = ws
    let recusado = false
    ws.on('open', () => this.enviarPara(ws, { t: 'ola', codigo: this.cfg.codigo, nome: os.hostname(), versao: this.o.versao }))
    ws.on('message', (bruto) => {
      let m: Msg
      try {
        m = JSON.parse(String(bruto))
      } catch {
        return
      }
      if (m.t === 'bem-vindo') {
        this.o.log('ok', `Conectado ao PC secundário "${m.nome}" (${this.cfg.endereco}).`)
        if (m.versao !== this.o.versao) this.o.log('aviso', `O PC secundário está na v${m.versao} e este na v${this.o.versao}. Atualize os dois para a mesma versão.`)
        this.mudar({ conectado: true, conectando: false, nomeOutroPc: m.nome, versaoOutroPc: m.versao, erro: undefined })
      } else if (m.t === 'recusado') {
        recusado = true
        this.mudar({ conectado: false, conectando: false, erro: m.motivo })
        this.o.log('erro', `O PC secundário recusou a conexão: ${m.motivo}`)
      } else if (m.t === 'resp') {
        const p = this.pendentes.get(m.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pendentes.delete(m.id)
        m.ok ? p.ok(m.valor) : p.erro(new Error(m.erro))
      } else if (m.t === 'evento') {
        this.o.aoEvento(m.canal, m.dado)
      }
    })
    ws.on('close', () => {
      if (this.ws !== ws) return
      const estava = this.st.conectado
      for (const p of this.pendentes.values()) {
        clearTimeout(p.timer)
        p.erro(new Error('A conexão com o PC secundário caiu.'))
      }
      this.pendentes.clear()
      if (estava) this.o.log('erro', 'A conexão com o PC secundário caiu. Tentando reconectar…')
      this.mudar({
        conectado: false,
        conectando: !recusado,
        erro: recusado ? this.st.erro : estava ? 'Conexão caiu. Tentando de novo…' : this.st.erro ?? `Não encontrei o PC secundário em ${this.cfg.endereco}. Ele está ligado, com o programa aberto no modo Secundário?`
      })
      if (!recusado && !this.parado) this.timerReconectar = setTimeout(() => this.conectar(), 3000)
    })
    ws.on('error', () => undefined)
  }

  // principal: roda uma ação no PC secundário e espera a resposta
  chamar(nome: string, args: unknown[], tempoMaximo = 10 * 60_000): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.st.conectado)
      return Promise.reject(new Error('Sem conexão com o PC secundário. Confira em Configurações > PC secundário.'))
    const id = this.proximoId++
    return new Promise((ok, erro) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id)
        erro(new Error('O PC secundário demorou demais para responder.'))
      }, tempoMaximo)
      this.pendentes.set(id, { ok, erro, timer })
      this.enviarPara(ws, { t: 'chamar', id, nome, args })
    })
  }
}

// Procura PCs no modo secundário na rede de casa (leva ~2 segundos).
export function procurarNaRede(): Promise<PcEncontrado[]> {
  return new Promise((resolve) => {
    const achados = new Map<string, PcEncontrado>()
    const s = dgram.createSocket('udp4')
    s.on('message', (msg, remoto) => {
      try {
        const j = JSON.parse(String(msg))
        achados.set(remoto.address, { nome: j.nome, versao: j.versao, endereco: remoto.address })
      } catch {
        /* resposta estranha: ignora */
      }
    })
    s.on('error', () => undefined)
    s.bind(() => {
      s.setBroadcast(true)
      const alvos = new Set(['255.255.255.255'])
      // também o "broadcast" de cada rede deste PC (ex.: 192.168.0.255)
      for (const lista of Object.values(os.networkInterfaces()))
        for (const i of lista ?? [])
          if (i.family === 'IPv4' && !i.internal) {
            const ip = i.address.split('.').map(Number)
            const mask = i.netmask.split('.').map(Number)
            alvos.add(ip.map((b, k) => (b & mask[k]) | (~mask[k] & 255)).join('.'))
          }
      for (const a of alvos) s.send(PERGUNTA, PORTA_BUSCA, a)
    })
    setTimeout(() => {
      try {
        s.close()
      } catch {
        /* já fechado */
      }
      resolve([...achados.values()])
    }, 2000)
  })
}
