import express, { Request, Response } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { GeradorDb } from './db'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizarValor, valorParaXlsx, gerarScript } = require('./sql_generator') as {
  normalizarValor: (v: string) => number
  valorParaXlsx: (v: string) => string
  gerarScript: (config: Record<string, unknown>, rows: Row[]) => string
}

interface Row { aux1: string; aux2: string }

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

function norm(s: string) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const KEYS_ESTAB = ['estabelecimento','estab','establishment','cod_estab','codigo','id_estab','aux1','id','codestab','cod']
const KEYS_VALOR = ['valor','value','val','montante','credito','amount','aux2','vl','vlr']

function detectCols(headers: string[]): [number, number] {
  let colEstab = -1, colValor = -1
  headers.forEach((h, i) => {
    const nh = norm(h)
    if (colEstab === -1 && KEYS_ESTAB.some(k => nh.includes(k))) colEstab = i
    if (colValor === -1 && KEYS_VALOR.some(k => nh.includes(k))) colValor = i
  })
  return [colEstab, colValor]
}

function applyMapping(headers: string[], mapping: Record<string, unknown>): [number, number] {
  if (mapping.usar_indice) {
    return [Number(mapping.indice_estabelecimento), Number(mapping.indice_valor)]
  }
  const colE = headers.findIndex(h => norm(h) === norm(String(mapping.coluna_estabelecimento || '')))
  const colV = headers.findIndex(h => norm(h) === norm(String(mapping.coluna_valor || '')))
  return [colE, colV]
}

function validateRow(aux1: unknown, aux2: unknown) {
  const issues: { tipo: string; msg: string }[] = []
  const a1 = String(aux1 || '').trim()
  const a2 = String(aux2 || '').trim()
  if (!a1) issues.push({ tipo: 'erro', msg: 'Estabelecimento vazio' })
  else if (!/^\d+$/.test(a1)) issues.push({ tipo: 'aviso', msg: 'Estabelecimento não é numérico' })
  if (!a2) issues.push({ tipo: 'aviso', msg: 'Valor vazio' })
  else {
    try {
      const v = normalizarValor(a2)
      if (v < 0) issues.push({ tipo: 'erro', msg: `Valor "${a2}" negativo` })
    } catch {
      issues.push({ tipo: 'erro', msg: `Valor "${a2}" inválido` })
    }
  }
  return issues
}

export function createGeradorRouter(db: GeradorDb) {
  const router = express.Router()

  router.get('/stats', async (_req: Request, res: Response) => {
    res.json(await db.statsGerais())
  })

  router.get('/tipos', async (req: Request, res: Response) => {
    res.json(await db.listarTipos(req.query.todos !== '1'))
  })

  router.post('/tipos', async (req: Request, res: Response) => {
    try {
      const id = await db.criarTipo(req.body as Record<string, unknown>)
      res.json({ id })
    } catch (e) {
      res.status(400).json({ erro: (e as Error).message })
    }
  })

  router.put('/tipos/:id', async (req: Request, res: Response) => {
    await db.atualizarTipo(Number(req.params.id), req.body as Record<string, unknown>)
    res.json({ ok: true })
  })

  router.delete('/tipos/:id', async (req: Request, res: Response) => {
    await db.desativarTipo(Number(req.params.id))
    res.json({ ok: true })
  })

  router.get('/mapeamentos', async (req: Request, res: Response) => {
    res.json(await db.listarMapeamentos(req.query.todos !== '1'))
  })

  router.post('/mapeamentos', async (req: Request, res: Response) => {
    try {
      const id = await db.criarMapeamento(req.body as Record<string, unknown>)
      res.json({ id })
    } catch (e) {
      res.status(400).json({ erro: (e as Error).message })
    }
  })

  router.put('/mapeamentos/:id', async (req: Request, res: Response) => {
    await db.atualizarMapeamento(Number(req.params.id), req.body as Record<string, unknown>)
    res.json({ ok: true })
  })

  router.delete('/mapeamentos/:id', async (req: Request, res: Response) => {
    await db.desativarMapeamento(Number(req.params.id))
    res.json({ ok: true })
  })

  router.get('/historico', async (req: Request, res: Response) => {
    res.json(await db.listarHistorico(Number(req.query.limite) || 50))
  })

  router.get('/historico/:id', async (req: Request, res: Response) => {
    const row = await db.buscarHistoricoSql(Number(req.params.id))
    if (!row) return res.status(404).json({ erro: 'Não encontrado' })
    res.json(row)
  })

  router.get('/oracle', async (req: Request, res: Response) => {
    res.json(await db.listarSistema(req.query.todos !== '1'))
  })

  router.put('/oracle/:id', async (req: Request, res: Response) => {
    await db.atualizarSistema(Number(req.params.id), req.body as Record<string, unknown>)
    res.json({ ok: true })
  })

  router.post('/oracle/:id/converter', async (req: Request, res: Response) => {
    try {
      const id = await db.criarTipo(req.body as Record<string, unknown>)
      res.json({ id })
    } catch (e) {
      res.status(400).json({ erro: (e as Error).message })
    }
  })

  router.post('/parse', upload.single('arquivo'), async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file
      if (!file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' })

      const wb = XLSX.read(file.buffer, { type: 'buffer', raw: false })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      if (data.length < 2) return res.json({ rows: [] })

      const headers = (data[0] as unknown[]).map(String)
      let colE = -1, colV = -1

      if (req.body.mapeamento_id) {
        const mapeamentos = await db.listarMapeamentos(false)
        const map = mapeamentos.find((m: Record<string, unknown>) => m.id === Number(req.body.mapeamento_id))
        if (map) {
          ;[colE, colV] = applyMapping(headers, map as Record<string, unknown>)
        }
      }
      if (colE === -1) [colE, colV] = detectCols(headers)
      if (colE === -1) colE = 0
      if (colV === -1) colV = 1

      const rows = (data.slice(1) as unknown[][])
        .filter(r => String(r[colE!] || '').trim())
        .map(r => ({ aux1: String(r[colE!] || '').trim(), aux2: String(r[colV!] || '').trim() }))

      res.json({
        rows,
        col_estab: headers[colE!] || `col ${colE}`,
        col_valor: headers[colV!] || `col ${colV}`,
      })
    } catch (e) {
      res.status(400).json({ erro: (e as Error).message })
    }
  })

  router.post('/gerar/sql', async (req: Request, res: Response) => {
    try {
      const { config, rows } = req.body as { config: Record<string, unknown>; rows: Row[] }
      if (!rows?.length) return res.status(400).json({ erro: 'Sem dados para gerar.' })
      if (!config?.glpi) return res.status(400).json({ erro: 'GLPI obrigatório.' })

      const validas = rows.filter(r => !validateRow(r.aux1, r.aux2).some(i => i.tipo === 'erro') && String(r.aux1).trim())
      if (!validas.length) return res.status(400).json({ erro: 'Nenhuma linha válida.' })

      const sql = gerarScript(config, validas)
      const totalVal = validas.reduce((s, r) => {
        try { return s + normalizarValor(r.aux2) } catch { return s }
      }, 0)

      try {
        await db.salvarHistorico({
          glpi: config.glpi,
          nome_campanha: config.campanha || '',
          dados_complementares: config.dados_complementares || '',
          tipo_transacao_id_val: config.tipo_transacao_id,
          natureza: config.natureza,
          modalidade: config.modalidade,
          impacto_limite: config.impacto_limite,
          envia_fila: config.envia_fila,
          canal_venda: config.canal_venda,
          quantidade: config.quantidade,
          total_registros: validas.length,
          valor_total: Math.round(totalVal * 100) / 100,
          sql_gerado: sql,
          mapeamento_usado: config.mapeamento_usado || 'auto',
        })
      } catch { /* salvar histórico é best-effort */ }

      res.json({ sql, total: validas.length })
    } catch (e) {
      res.status(500).json({ erro: (e as Error).message })
    }
  })

  router.post('/gerar/xlsx', async (req: Request, res: Response) => {
    try {
      const { config, rows } = req.body as { config: Record<string, unknown>; rows: Row[] }
      const validas = rows.filter(r => !validateRow(r.aux1, r.aux2).some(i => i.tipo === 'erro') && String(r.aux1).trim())
      if (!validas.length) return res.status(400).json({ erro: 'Nenhuma linha válida.' })

      const wsData: string[][] = [['aux1','aux2','aux3','aux4','aux5','aux6','aux7']]
      validas.forEach(r => wsData.push([String(r.aux1), valorParaXlsx(r.aux2), '','','','','']))

      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(wsData)
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C })
          if (ws[addr]) ws[addr].z = '@'
        }
      }
      XLSX.utils.book_append_sheet(wb, ws, 'dados')
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      const glpi = config?.glpi || 'sem_glpi'
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="table_aux_ciso_glpi_${glpi}.xlsx"`)
      res.send(buf)
    } catch (e) {
      res.status(500).json({ erro: (e as Error).message })
    }
  })

  router.post('/validar', (req: Request, res: Response) => {
    const { rows } = req.body as { rows: Row[] }
    let erros = 0, avisos = 0, ok = 0
    const problemas: { linha: number; tipo: string; msg: string }[] = []
    ;(rows || []).forEach((row, i) => {
      const issues = validateRow(row.aux1, row.aux2)
      const tipos = issues.map(x => x.tipo)
      if (tipos.includes('erro')) erros++
      else if (tipos.includes('aviso')) avisos++
      else ok++
      issues.forEach(x => problemas.push({ linha: i + 1, tipo: x.tipo, msg: x.msg }))
    })
    const aux1s = (rows || []).map(r => String(r.aux1).trim()).filter(Boolean)
    const duplicatas = aux1s.filter((v, i, a) => a.indexOf(v) !== i)
    res.json({ total: rows?.length || 0, erros, avisos, ok, problemas, duplicatas: [...new Set(duplicatas)] })
  })

  return router
}
