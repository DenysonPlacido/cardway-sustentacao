import { Router, Request, Response } from 'express'
import { GlpiClient, withGlpiSession } from './atendimento-glpi/glpi-client'
import { SustentacaoEngine } from './atendimento-glpi/SustentacaoEngine'
import { GlpiService } from './atendimento-glpi/GlpiService'
import { AiService } from './atendimento-glpi/AiService'

const router = Router()
const engine = new SustentacaoEngine()
const glpiService = new GlpiService()

function buildGlpiClient(): GlpiClient {
  const url = process.env.GLPI_API_URL
  const appToken = process.env.GLPI_APP_TOKEN
  const userToken = process.env.GLPI_USER_TOKEN

  if (!url || !userToken) {
    throw new Error('GLPI não configurado: defina GLPI_API_URL e GLPI_USER_TOKEN')
  }

  return new GlpiClient(url, appToken ?? '', userToken)
}

function resolveAiErrorResponse(error: unknown): { status: number; message: string } {
  const rawStatus = Number(
    (error as { status?: unknown; response?: { status?: unknown } })?.status ??
      (error as { response?: { status?: unknown } })?.response?.status ??
      0
  )
  const status = Number.isFinite(rawStatus) && rawStatus > 0 ? rawStatus : 500
  const message = error instanceof Error ? error.message : String(error ?? 'Erro ao analisar ticket')

  if (status === 429 || /rate limit|too many requests|limite/i.test(message)) {
    return {
      status: 429,
      message: 'A IA atingiu o limite de requisições no momento. Tente novamente em alguns minutos.'
    }
  }

  if (status === 401 || status === 403) {
    return {
      status: 502,
      message: 'Falha na autenticação com o provedor de IA.'
    }
  }

  if (status >= 500) {
    return {
      status: 502,
      message: 'Falha ao comunicar com o provedor de IA.'
    }
  }

  return {
    status,
    message: message || 'Falha ao analisar ticket com IA'
  }
}

// GET /api/automacao/tickets?status=1
router.get('/tickets', async (req: Request, res: Response): Promise<void> => {
  const rawStatus = req.query['status']
  const status = rawStatus !== undefined ? Number(rawStatus) : undefined

  if (rawStatus !== undefined && (isNaN(status!) || status! < 1 || status! > 6)) {
    res.status(400).json({ error: 'status deve ser um número entre 1 e 6' })
    return
  }

  try {
    const client = buildGlpiClient()
    const tickets = await withGlpiSession(client, c => c.listTickets(status))
    res.json({ tickets })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao buscar tickets'
    console.error('[automacao] listTickets error:', message)

    if (message.includes('não configurado')) {
      res.status(503).json({ error: 'Integração GLPI não configurada no servidor' })
      return
    }

    res.status(502).json({ error: 'Falha ao comunicar com o GLPI' })
  }
})

// GET /api/automacao/pendentes?entityId=0
router.get('/pendentes', async (req: Request, res: Response): Promise<void> => {
  try {
    const entityId = Number(req.query['entityId']) || 0
    const tickets = await glpiService.getPendingTickets(entityId)
    res.json(tickets)
  } catch (error) {
    console.error('[automacao] getPendingTickets error:', error)
    res.status(500).json({ error: 'Erro ao buscar chamados no GLPI' })
  }
})

// GET /api/automacao/rodar-agente  (SSE streaming)
router.get('/rodar-agente', async (req: Request, res: Response): Promise<void> => {
  const rawStatus = req.query['status']
  const status = rawStatus !== undefined && rawStatus !== '' ? Number(rawStatus) : 1

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    send('error', { message: 'GEMINI_API_KEY não configurada no servidor' })
    res.end()
    return
  }

  const aiService = new AiService(apiKey)

  try {
    send('log', { text: 'Conectando ao GLPI...' })

    const client = buildGlpiClient()
    const tickets = await withGlpiSession(client, c => c.listTickets(status))

    send('log', { text: `Encontrados ${tickets.length} chamado(s) com status ${status}.` })

    if (!tickets.length) {
      send('log', { text: 'Nenhum chamado encontrado. Encerrando.' })
      send('agent_done', { total: 0 })
      res.end()
      return
    }

    for (const ticket of tickets) {
      send('ticket_start', { id: ticket.id, name: ticket.name, priority: ticket.priority, priorityLabel: ticket.priorityLabel })
      send('log', { text: `\n» Ticket #${ticket.id}: "${ticket.name}"` })

      try {
        const analysis = await aiService.streamAnalyzeTicket(ticket, (chunk) => {
          send('chunk', { text: chunk })
        })

        send('ticket_done', { id: ticket.id, analysis })
        send('log', { text: `\n✓ #${ticket.id} — ${analysis.tipo} · Risco: ${analysis.risco} · ${Math.round(analysis.confianca * 100)}% confiança` })

      } catch (ticketError) {
        const msg = ticketError instanceof Error ? ticketError.message : 'Erro desconhecido'
        send('ticket_error', { id: ticket.id, message: msg })
        send('log', { text: `\n✗ #${ticket.id} — ${msg}` })
      }
    }

    send('log', { text: '\n─── Agente finalizado ───' })
    send('agent_done', { total: tickets.length })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao executar agente'
    send('error', { message })
  } finally {
    res.end()
  }
})

// POST /api/automacao/analisar-ticket
router.post('/analisar-ticket', async (req: Request, res: Response): Promise<void> => {
  const { ticketId } = req.body ?? {}

  if (!ticketId) {
    res.status(400).json({ error: 'ticketId é obrigatório' })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'GEMINI_API_KEY não configurada no servidor' })
    return
  }

  try {
    const client = buildGlpiClient()
    const ticket = await withGlpiSession(client, c => c.getTicket(Number(ticketId)))

    if (!ticket) {
      res.status(404).json({ error: `Ticket #${ticketId} não encontrado no GLPI` })
      return
    }

    const aiService = new AiService(apiKey)
    const analysis = await aiService.analyzeTicket(ticket)

    res.json({ ticketId: ticket.id, analysis })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao analisar ticket'
    console.error('[automacao] analisar-ticket error:', message)

    if (message.includes('não configurado')) {
      res.status(503).json({ error: 'Integração GLPI não configurada no servidor' })
      return
    }

    const aiError = resolveAiErrorResponse(error)
    res.status(aiError.status).json({ error: aiError.message })
  }
})

// GET /api/automacao/tickets/:ticketId
router.get('/tickets/:ticketId', async (req: Request, res: Response): Promise<void> => {
  const ticketId = Number(req.params.ticketId)

  if (!ticketId) {
    res.status(400).json({ error: 'ticketId deve ser informado' })
    return
  }

  try {
    const client = buildGlpiClient()
    const ticket = await withGlpiSession(client, c => c.getTicket(ticketId))

    if (!ticket) {
      res.status(404).json({ error: `Ticket #${ticketId} não encontrado no GLPI` })
      return
    }

    res.json({ ticket })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao consultar ticket'
    console.error('[automacao] tickets/:ticketId error:', message)

    if (message.includes('não configurado')) {
      res.status(503).json({ error: 'Integração GLPI não configurada no servidor' })
      return
    }

    res.status(502).json({ error: 'Falha ao comunicar com o GLPI' })
  }
})

// GET /api/automacao/glpi-asset?src=/front/...
router.get('/glpi-asset', async (req: Request, res: Response): Promise<void> => {
  const src = String(req.query['src'] ?? '').trim()

  if (!src) {
    res.status(400).json({ error: 'src deve ser informado' })
    return
  }

  try {
    const client = buildGlpiClient()
    const asset = await withGlpiSession(client, c => c.fetchAsset(src))
    res.setHeader('Content-Type', asset.contentType)
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.send(Buffer.from(asset.body))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao buscar imagem do GLPI'
    console.error('[automacao] glpi-asset error:', message)

    if (message.includes('não configurado')) {
      res.status(503).json({ error: 'Integração GLPI não configurada no servidor' })
      return
    }

    res.status(502).json({ error: 'Falha ao carregar imagem do GLPI' })
  }
})

// POST /api/automacao/processar-agora
router.post('/processar-agora', async (req: Request, res: Response): Promise<void> => {
  try {
    const entityId = Number(req.body?.entityId) || 0
    await engine.run(entityId)
    res.json({ message: 'Ciclo de monitoramento e análise concluído com sucesso.' })
  } catch (error) {
    console.error('[automacao] processar-agora error:', error)
    res.status(500).json({ error: 'Falha ao executar análise da IA' })
  }
})

// POST /api/automacao/aprovar
router.post('/aprovar', async (req: Request, res: Response): Promise<void> => {
  const { ticketId, acaoId, acaoDescricao } = req.body ?? {}

  if (!ticketId || !acaoId) {
    res.status(400).json({ error: 'ticketId e acaoId são obrigatórios.' })
    return
  }

  try {
    const logExecucao = `✅ **Ação Executada via Portal:** ${acaoId}\n**Descrição:** ${acaoDescricao ?? 'Execução automatizada aprovada pelo analista.'}`
    await glpiService.addAnalysisFollowup(ticketId, logExecucao)
    res.json({ success: true, message: `Ação ${acaoId} executada e log postado no GLPI.` })
  } catch (error) {
    console.error('[automacao] aprovar error:', error)
    res.status(500).json({ error: 'Falha técnica ao executar a ação de sustentação.' })
  }
})

// POST /api/automacao/feedback
router.post('/feedback', (req: Request, res: Response): void => {
  const { ticketId, feedback } = req.body ?? {}

  if (!ticketId || !feedback) {
    res.status(400).json({ error: 'ticketId e feedback são obrigatórios' })
    return
  }

  console.log(`[feedback] Ticket #${ticketId}:`, feedback)
  res.json({ success: true })
})

// POST /api/automacao/tickets/:ticketId/reply
router.post('/tickets/:ticketId/reply', async (req: Request, res: Response): Promise<void> => {
  const ticketId = Number(req.params.ticketId)
  const content = String(req.body?.content ?? '').trim()
  const isPrivate = Boolean(req.body?.isPrivate ?? false)

  if (!ticketId || !content) {
    res.status(400).json({ error: 'ticketId e content são obrigatórios' })
    return
  }

  try {
    await glpiService.replyToTicket(ticketId, content, isPrivate)
    res.json({ success: true })
  } catch (error) {
    console.error('[automacao] tickets/:ticketId/reply error:', error)
    res.status(500).json({ error: 'Falha técnica ao responder o chamado.' })
  }
})

// PUT /api/automacao/tickets/:ticketId
router.put('/tickets/:ticketId', async (req: Request, res: Response): Promise<void> => {
  const ticketId = Number(req.params.ticketId)
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined
  const content = req.body?.content !== undefined ? String(req.body.content).trim() : undefined

  if (!ticketId) {
    res.status(400).json({ error: 'ticketId deve ser informado' })
    return
  }

  if (name === undefined && content === undefined) {
    res.status(400).json({ error: 'Informe name ou content para atualizar' })
    return
  }

  try {
    await glpiService.updateTicket(ticketId, {
      ...(name !== undefined ? { name } : {}),
      ...(content !== undefined ? { content } : {})
    })
    res.json({ success: true })
  } catch (error) {
    console.error('[automacao] tickets/:ticketId update error:', error)
    res.status(500).json({ error: 'Falha técnica ao atualizar o chamado.' })
  }
})

export default router
