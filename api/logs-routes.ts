import { Router, Request, Response } from 'express'
import http from 'http'

const router = Router()

const LOG_MS_BASE = (process.env.LOG_SERVER_URL ?? 'http://10.111.2.54/pods/microservices_prod/ms-backoffice').replace(/\/$/, '')

export const LOG_SERVICES = [
  'api',
  'api-cobranca-baixa',
  'cobrancabaixa',
  'cobrancapix',
  'dicionario',
  'distribuicao',
  'logistica',
  'pedido',
  'portal',
  'relatorio',
  'sig',
  'sigvivo',
] as const

type LogService = typeof LOG_SERVICES[number]

interface PedidoInput {
  id: number
  data_alteracao: string
}

interface PodEntry {
  name: string
  date: Date
}

function parseDataAlteracao(raw: string): { fileDate: string; hour: string } | null {
  const m = raw.trim().match(/(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})/)
  if (!m) return null
  const [, dd, mm, yy, hh] = m
  const year = yy.length === 2 ? `20${yy}` : yy
  return { fileDate: `${year}-${mm}-${dd}`, hour: hh }
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => (data += c.toString()))
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchPodList(serviceBase: string): Promise<PodEntry[]> {
  const html = await httpGet(serviceBase + '/')
  const pods: PodEntry[] = []
  // Captura qualquer nome de pod: href="nome-pod-xyz/"  DD-Mon-YYYY HH:MM
  const re = /href="([^./][^"]+)\/"\s*>[^<]*<\/a>\s*([\d]{2}-\w{3}-[\d]{4} [\d]{2}:[\d]{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const d = new Date(m[2])
    if (!isNaN(d.getTime())) pods.push({ name: m[1], date: d })
  }
  return pods
}

function headRequest(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'HEAD' }, (res) => resolve(res.statusCode === 200))
    req.on('error', () => resolve(false))
    req.setTimeout(5000, () => { req.destroy(); resolve(false) })
    req.end()
  })
}

function isNoisyLine(line: string): boolean {
  return line.includes('"type":"Buffer"') || line.includes('"notaBlod"')
}

function cleanAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '').trim()
}

function grepLogFile(url: string, target: string): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = []
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve([]); return }
      let buf = ''
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''
        for (const line of parts) {
          if (line.includes(target) && !isNoisyLine(line)) lines.push(cleanAnsi(line))
        }
      })
      res.on('end', () => {
        if (buf && buf.includes(target) && !isNoisyLine(buf)) lines.push(cleanAnsi(buf))
        resolve(lines)
      })
      res.on('error', () => resolve(lines))
    })
    req.on('error', () => resolve(lines))
    req.setTimeout(60000, () => { req.destroy(); resolve(lines) })
  })
}

// GET /api/logs/servicos
router.get('/servicos', (_req: Request, res: Response): void => {
  res.json({ services: LOG_SERVICES })
})

// GET /api/logs/buscar-pedidos?service=pedido&pedidos=[...]
router.get('/buscar-pedidos', async (req: Request, res: Response): Promise<void> => {
  const service = String(req.query['service'] ?? 'pedido') as LogService
  if (!LOG_SERVICES.includes(service)) {
    res.status(400).json({ error: `Serviço inválido: ${service}` })
    return
  }

  let pedidos: PedidoInput[]
  try {
    pedidos = JSON.parse(String(req.query['pedidos'] ?? '[]')) as PedidoInput[]
  } catch {
    res.status(400).json({ error: 'Parâmetro pedidos inválido' })
    return
  }
  if (!pedidos.length) {
    res.status(400).json({ error: 'Informe ao menos um registro' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const serviceBase = `${LOG_MS_BASE}/${service}`

  try {
    send('status', { msg: `Carregando pods de ${service}...` })
    const pods = await fetchPodList(serviceBase)
    if (!pods.length) {
      send('error', { msg: `Nenhum pod encontrado em ${service}` })
      res.end()
      return
    }
    send('status', { msg: `${pods.length} pods encontrados. Iniciando busca...` })

    for (const pedido of pedidos) {
      const parsed = parseDataAlteracao(pedido.data_alteracao)
      if (!parsed) {
        send('result', { id: pedido.id, error: 'Formato de data inválido', lines: [] })
        continue
      }

      const { fileDate, hour } = parsed
      const fileName = `file-${fileDate}_${hour}00.txt`
      const pedidoThreshold = new Date(`${fileDate}T${hour}:00:00`)

      send('status', { msg: `Buscando ID ${pedido.id} em ${service} (${fileName})...` })

      const candidates = pods
        .filter((p) => p.date >= pedidoThreshold)
        .sort((a, b) => a.date.getTime() - b.date.getTime())

      let found = false
      for (const pod of candidates) {
        const url = `${serviceBase}/${pod.name}/${fileName}`
        const exists = await headRequest(url)
        if (!exists) continue

        send('status', { msg: `ID ${pedido.id}: lendo ${pod.name}/${fileName}...` })
        const lines = await grepLogFile(url, String(pedido.id))
        send('result', { id: pedido.id, pod: pod.name, file: fileName, url, lines })
        found = true
        break
      }

      if (!found) {
        send('result', { id: pedido.id, error: `Arquivo ${fileName} não encontrado em nenhum pod de ${service}`, lines: [] })
      }
    }

    send('done', { msg: 'Busca concluída' })
  } catch (err) {
    send('error', { msg: err instanceof Error ? err.message : 'Erro inesperado' })
  } finally {
    res.end()
  }
})

export default router
