import { Router, Request, Response } from 'express'
import { GlpiClient, withGlpiSession } from './glpi-client'
import { SustentacaoEngine } from './atendimento-glpi/SustentacaoEngine'
import { GlpiService } from './atendimento-glpi/GlpiService'

const router = Router()
const engine = new SustentacaoEngine()
const glpiService = new GlpiService()

function buildGlpiClient(): GlpiClient {
  const url = process.env.GLPI_API_URL
  const appToken = process.env.GLPI_APP_TOKEN
  const userToken = process.env.GLPI_USER_TOKEN

  if (!url || !appToken || !userToken) {
    throw new Error('GLPI não configurado: defina GLPI_API_URL, GLPI_APP_TOKEN e GLPI_USER_TOKEN')
  }

  return new GlpiClient(url, appToken, userToken)
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

export default router
