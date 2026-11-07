// Central de controle: até dois PCs secundários simultaneamente, sem alterar o protocolo legado.
// Apenas o PC escolhido recebe ações e alimenta a tela principal.
import os from 'node:os'
import { Rede, meusIps, type Opcoes } from './rede'
import type { ConfigRede, PcRemotoConfig, PcRemotoStatus, StatusRede, UsoHardware, LeituraHardwareRemoto } from '../shared/types'

export class RedeCentral {
  private cfg: ConfigRede = { papel: 'unico', endereco: '', codigo: '', meuCodigo: '' }
  private local: Rede
  private remotos = new Map<string, { cliente: Rede; status: StatusRede; config: PcRemotoConfig }>()
  private parado = false

  constructor(private opcoes: Opcoes) {
    this.local = new Rede(opcoes)
  }

  get papel() { return this.cfg.papel }
  get repassando() { return this.papel === 'principal' }
  get conectado() { return this.status.conectado }
  get config(): ConfigRede { return { ...this.cfg, remotos: this.cfg.remotos?.map((r) => ({ ...r })) } }

  private lista(): PcRemotoStatus[] {
    return [...this.remotos.values()].map(({ config, status }) => ({
      id: config.id, endereco: config.endereco, apelido: config.apelido,
      nome: status.nomeOutroPc ?? config.apelido ?? config.endereco,
      versao: status.versaoOutroPc, conectado: status.conectado,
      conectando: status.conectando, erro: status.erro
    }))
  }

  get status(): StatusRede {
    if (this.papel !== 'principal') return { ...this.local.status, pcs: [], alvoAtivoId: undefined }
    const ativo = this.remotos.get(this.cfg.alvoAtivoId ?? '')
    const st = ativo?.status
    return {
      edicao: this.opcoes.edicao,
      papel: 'principal',
      conectado: st?.conectado ?? false,
      conectando: st?.conectando ?? false,
      nomeOutroPc: st?.nomeOutroPc ?? ativo?.config.apelido,
      versaoOutroPc: st?.versaoOutroPc,
      endereco: ativo?.config.endereco,
      meusIps: meusIps(),
      meuNome: os.hostname(),
      erro: st?.erro,
      alvoAtivoId: this.cfg.alvoAtivoId,
      pcs: this.lista()
    }
  }

  private atualizar() {
    if (!this.parado) this.opcoes.aoMudarStatus(this.status)
  }

  aplicar(config: ConfigRede) {
    this.parar()
    this.parado = false
    const cfg = { ...config }
    // Migra automaticamente a configuração existente do único secundário.
    if (cfg.papel === 'principal' && (!cfg.remotos || !cfg.remotos.length) && cfg.endereco && cfg.codigo) {
      cfg.remotos = [{ id: 'legado', endereco: cfg.endereco, codigo: cfg.codigo, apelido: 'PC secundário' }]
    }
    cfg.remotos = (cfg.remotos ?? []).slice(0, 2)
    if (cfg.remotos.length && !cfg.remotos.some((p) => p.id === cfg.alvoAtivoId))
      cfg.alvoAtivoId = cfg.remotos[0].id
    this.cfg = this.opcoes.edicao === 'padrao' ? { ...cfg, papel: 'unico' } : cfg
    if (this.papel !== 'principal') {
      this.local.aplicar(this.cfg)
      this.atualizar()
      return
    }
    for (const p of this.cfg.remotos ?? []) this.iniciarRemoto(p)
    this.atualizar()
  }

  private iniciarRemoto(p: PcRemotoConfig) {
    const cliente = new Rede({
      ...this.opcoes,
      aoMudarStatus: (status) => {
        const item = this.remotos.get(p.id)
        if (!item) return
        item.status = status
        this.atualizar()
      },
      aoEvento: (canal, dado) => {
        if (this.cfg.alvoAtivoId === p.id) this.opcoes.aoEvento(canal, dado)
      },
      log: (nivel, msg) => this.opcoes.log(nivel, `[${p.apelido || p.endereco}] ${msg}`)
    })
    this.remotos.set(p.id, { cliente, config: p, status: cliente.status })
    cliente.aplicar({
      papel: 'principal', endereco: p.endereco, codigo: p.codigo, meuCodigo: this.cfg.meuCodigo
    })
  }

  selecionarAlvo(id: string) {
    if (this.papel !== 'principal' || !this.remotos.has(id)) throw new Error('PC de destino não encontrado.')
    this.cfg.alvoAtivoId = id
    this.atualizar()
    return this.status
  }

  salvarRemoto(info: PcRemotoConfig) {
    if (this.papel !== 'principal') throw new Error('Ative o modo PC principal primeiro.')
    if (!info.endereco?.trim() || !/^\d{6}$/.test(info.codigo)) throw new Error('Informe IP e código de pareamento de 6 dígitos.')
    const p = { ...info, endereco: info.endereco.trim(), id: info.id || `pc-${Date.now()}` }
    const index = (this.cfg.remotos ?? []).findIndex((x) => x.id === p.id)
    if (index < 0 && (this.cfg.remotos?.length ?? 0) >= 2)
      throw new Error('Limite de 2 PCs secundários atingido (3 computadores no total).')
    if (index >= 0) this.cfg.remotos![index] = p
    else (this.cfg.remotos ??= []).push(p)
    this.remotos.get(p.id)?.cliente.parar()
    this.remotos.delete(p.id)
    this.iniciarRemoto(p)
    if (!this.cfg.alvoAtivoId || !this.remotos.has(this.cfg.alvoAtivoId)) this.cfg.alvoAtivoId = p.id
    this.atualizar()
    return this.status
  }

  removerRemoto(id: string) {
    this.remotos.get(id)?.cliente.parar()
    this.remotos.delete(id)
    this.cfg.remotos = (this.cfg.remotos ?? []).filter((p) => p.id !== id)
    if (this.cfg.alvoAtivoId === id) this.cfg.alvoAtivoId = this.cfg.remotos[0]?.id
    // Impede que a migração recrie o PC legado após remover todos.
    this.cfg.endereco = ''
    this.cfg.codigo = ''
    this.atualizar()
    return this.status
  }

  // Coleta telemetria sem alterar o PC que recebe comandos. Um remoto indisponível
  // não bloqueia a leitura dos demais, e o estado offline permanece visível.
  async hardwareRemotos(): Promise<LeituraHardwareRemoto[]> {
    if (this.papel !== 'principal') return []
    const remotos = [...this.remotos.values()]
    return Promise.all(remotos.map(async ({ config, status, cliente }): Promise<LeituraHardwareRemoto> => {
      const base = {
        id: config.id,
        apelido: config.apelido,
        endereco: config.endereco,
        nome: status.nomeOutroPc ?? config.apelido ?? config.endereco,
        ativo: config.id === this.cfg.alvoAtivoId,
        conectado: cliente.conectado
      }
      if (!cliente.conectado) return { ...base, erro: status.erro || 'PC desconectado' }
      try {
        const dados = await cliente.chamar('hardwareLocal', [], 5000) as UsoHardware
        return { ...base, nome: dados.nome || base.nome, conectado: true, dados }
      } catch (e) {
        return { ...base, conectado: cliente.conectado, erro: String(e instanceof Error ? e.message : e) }
      }
    }))
  }

  chamar(nome: string, args: unknown[], tempoMaximo?: number): Promise<unknown> {
    const ativo = this.remotos.get(this.cfg.alvoAtivoId ?? '')
    if (!ativo) return Promise.reject(new Error('Escolha um PC de destino em Configurações > Computadores.'))
    return ativo.cliente.chamar(nome, args, tempoMaximo)
  }

  transmitir(canal: string, dado: unknown) { this.local.transmitir(canal, dado) }
  novoCodigo() { return this.local.novoCodigo() }

  parar() {
    this.parado = true
    this.local.parar()
    for (const x of this.remotos.values()) x.cliente.parar()
    this.remotos.clear()
  }
}
