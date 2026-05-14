import { Router, Request, Response } from 'express'
import https from 'https'
import http from 'http'
import { URL as NodeURL } from 'url'

const router = Router()

const WEB_SERVERS = {
  web02: {
    base: 'https://sgvlogs-prd.integrati.cloud/web02_producao',
    instances: ['cluster02-instance01', 'cluster02-instance02', 'cluster02-instance03', 'cluster02-instance04', 'cluster02-instance05'],
  },
  web03: {
    base: 'https://sgvlogs-prd.integrati.cloud/web03_producao',
    instances: ['cluster03-instance01', 'cluster03-instance02', 'cluster03-instance03', 'cluster03-instance04'],
  },
} as const

type WebServer = keyof typeof WEB_SERVERS

interface WebLogFile {
  name: string
  rotationTime: Date
}

function makeGet(url: string, cb: (res: http.IncomingMessage) => void): http.ClientRequest {
  const parsed = new NodeURL(url)
  if (parsed.protocol === 'https:') {
    return https.get(url, { rejectUnauthorized: false }, cb)
  }
  return http.get(url, cb)
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = makeGet(url, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => (data += c.toString()))
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// Parse server.log_YYYY-MM-DDTHH-MM-SS filenames (rotation-based, timestamp = when file was archived)
function parseLogFiles(html: string): WebLogFile[] {
  const files: WebLogFile[] = []
  const re = /href="(server\.log_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}))"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const rotationTime = new Date(`${m[2]}T${m[3]}:${m[4]}:${m[5]}`)
    if (!isNaN(rotationTime.getTime())) files.push({ name: m[1], rotationTime })
  }
  return files.sort((a, b) => a.rotationTime.getTime() - b.rotationTime.getTime())
}

// Each file contains entries from the previous rotation until its own rotation timestamp.
// To find entries for time T: find the first file whose rotation time >= T.
// Also check server.log (active) if T is after all archived files.
function findCandidates(files: WebLogFile[], targetTime: Date): string[] {
  for (let i = 0; i < files.length; i++) {
    if (files[i].rotationTime >= targetTime) {
      const result = [files[i].name]
      if (i > 0) result.push(files[i - 1].name)
      return result
    }
  }
  const result = ['server.log']
  if (files.length) result.push(files[files.length - 1].name)
  return result
}

function grepFile(url: string, term: string): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = []
    const req = makeGet(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve([]); return }
      let buf = ''
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''
        for (const line of parts) {
          if (line.includes(term)) lines.push(line.trim())
        }
      })
      res.on('end', () => {
        if (buf && buf.includes(term)) lines.push(buf.trim())
        resolve(lines)
      })
      res.on('error', () => resolve(lines))
    })
    req.on('error', () => resolve(lines))
    req.setTimeout(120000, () => { req.destroy(); resolve(lines) })
  })
}

function parseTargetDate(dateStr: string, hourStr: string): Date | null {
  const dmy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/)
  const ymd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  let iso: string
  if (dmy) {
    const [, dd, mm, yy] = dmy
    const year = yy.length === 2 ? `20${yy}` : yy
    iso = `${year}-${mm}-${dd}`
  } else if (ymd) {
    iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`
  } else {
    return null
  }
  const hh = hourStr.match(/^\d{1,2}$/) ? hourStr.padStart(2, '0') : '12'
  const d = new Date(`${iso}T${hh}:00:00`)
  return isNaN(d.getTime()) ? null : d
}

// GET /api/logs/web/buscar?term=TERM&date=DD/MM/YYYY&hour=HH&servers=web02,web03
router.get('/buscar', async (req: Request, res: Response): Promise<void> => {
  const term = String(req.query['term'] ?? '').trim()
  const dateStr = String(req.query['date'] ?? '').trim()
  const hourStr = String(req.query['hour'] ?? '').trim()
  const serversParam = String(req.query['servers'] ?? 'web02,web03')

  if (!term) { res.status(400).json({ error: 'Informe o termo de busca' }); return }
  if (!dateStr) { res.status(400).json({ error: 'Informe a data' }); return }

  const targetTime = parseTargetDate(dateStr, hourStr)
  if (!targetTime) { res.status(400).json({ error: 'Data inválida. Use DD/MM/YYYY' }); return }

  const selectedServers = serversParam.split(',').filter((s): s is WebServer => s in WEB_SERVERS)
  if (!selectedServers.length) { res.status(400).json({ error: 'Nenhum servidor válido' }); return }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    for (const serverKey of selectedServers) {
      const server = WEB_SERVERS[serverKey]
      send('status', { msg: `Buscando em ${serverKey} (${server.instances.length} instâncias)...` })

      for (const instance of server.instances) {
        const instanceBase = `${server.base}/${instance}`
        try {
          const html = await fetchText(`${instanceBase}/`)
          const files = parseLogFiles(html)
          const candidates = findCandidates(files, targetTime)

          let found = false
          for (const fileName of candidates) {
            const fileUrl = `${instanceBase}/${fileName}`
            send('status', { msg: `${serverKey}/${instance}: lendo ${fileName}...` })
            const lines = await grepFile(fileUrl, term)
            if (lines.length) {
              send('result', { source: `${serverKey}/${instance}`, file: fileName, url: fileUrl, lines })
              found = true
              break
            }
          }

          if (!found) {
            send('status', { msg: `${serverKey}/${instance}: sem ocorrências` })
          }
        } catch (err) {
          send('status', { msg: `${serverKey}/${instance}: erro — ${err instanceof Error ? err.message : 'falha'}` })
        }
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
