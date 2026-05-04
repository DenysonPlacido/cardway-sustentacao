import { Router, Request, Response } from 'express'
import { GlpiClient, withGlpiSession } from './glpi-client'

const router = Router()

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

export default router
