import { Router, Request, Response } from 'express'
import { Pool } from 'pg'

interface JwtPayload {
  id: number
  login: string
  name: string
  exp?: number
}

interface AuthRequest extends Request {
  user?: JwtPayload
}

interface ProxyRequestBody {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
}

interface MemCollection {
  id: number
  user_id: number
  name: string
  requests: unknown[]
  created_at: string
  updated_at: string
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const URL_MAX_LENGTH = 2048
const BODY_MAX_LENGTH = 1_000_000

// In-memory fallback when DATABASE_URL is not configured
const USE_MEM = !process.env['DATABASE_URL']
const memStore: MemCollection[] = []
let memSeq = 1

function memGetByUser(userId: number): MemCollection[] {
  return memStore
    .filter((c) => c.user_id === userId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

function memCreate(userId: number, name: string, requests: unknown[]): MemCollection {
  const now = new Date().toISOString()
  const col: MemCollection = { id: memSeq++, user_id: userId, name, requests, created_at: now, updated_at: now }
  memStore.push(col)
  return col
}

function memUpdate(userId: number, id: number, patch: Partial<Pick<MemCollection, 'name' | 'requests'>>): boolean {
  const idx = memStore.findIndex((c) => c.id === id && c.user_id === userId)
  if (idx === -1) return false
  memStore[idx] = { ...memStore[idx]!, ...patch, updated_at: new Date().toISOString() }
  return true
}

function memDelete(userId: number, id: number): void {
  const idx = memStore.findIndex((c) => c.id === id && c.user_id === userId)
  if (idx !== -1) memStore.splice(idx, 1)
}

function isValidUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return ALLOWED_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

function sanitizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string') result[k] = v
  }
  return result
}

export function createPostApisRouter(pool: Pool): Router {
  const router = Router()

  router.post('/proxy', async (req: Request, res: Response): Promise<void> => {
    const { method, url, headers, body } = req.body as ProxyRequestBody

    if (!method || !url) {
      res.status(400).json({ success: false, error: 'method e url são obrigatórios' })
      return
    }

    const normalizedMethod = method.toUpperCase()
    if (!ALLOWED_METHODS.has(normalizedMethod)) {
      res.status(400).json({ success: false, error: 'Método não permitido' })
      return
    }

    if (url.length > URL_MAX_LENGTH) {
      res.status(400).json({ success: false, error: 'URL muito longa' })
      return
    }

    if (!isValidUrl(url)) {
      res.status(400).json({ success: false, error: 'URL inválida. Use http:// ou https://' })
      return
    }

    if (body && body.length > BODY_MAX_LENGTH) {
      res.status(400).json({ success: false, error: 'Body muito grande (máx 1MB)' })
      return
    }

    const start = Date.now()

    try {
      const fetchOptions: RequestInit = {
        method: normalizedMethod,
        headers: sanitizeHeaders(headers),
        signal: AbortSignal.timeout(30_000),
      }

      if (body && !['GET', 'HEAD'].includes(normalizedMethod)) {
        fetchOptions.body = body
      }

      const response = await fetch(url, fetchOptions)
      const duration = Date.now() - start

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => { responseHeaders[key] = value })

      const responseBody = await response.text()
      const size = Buffer.byteLength(responseBody, 'utf8')

      res.json({
        success: true,
        data: { status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseBody, duration, size },
      })
    } catch (error: unknown) {
      const duration = Date.now() - start
      const message = error instanceof Error ? error.message : 'Erro ao executar requisição'
      res.json({ success: false, error: message, data: { duration } })
    }
  })

  // ---- Collections ----

  router.get('/collections', async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthRequest).user!.id

    if (USE_MEM) {
      res.json({ success: true, data: memGetByUser(userId) })
      return
    }

    try {
      const { rows } = await pool.query(
        `SELECT id, name, requests, created_at, updated_at
         FROM api_tester_collections
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [userId]
      )
      res.json({ success: true, data: rows })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro ao listar coleções'
      res.status(500).json({ success: false, error: message })
    }
  })

  router.post('/collections', async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthRequest).user!.id
    const { name, requests } = req.body as { name?: string; requests?: unknown }

    if (!name?.trim()) {
      res.status(400).json({ success: false, error: 'Nome é obrigatório' })
      return
    }

    if (USE_MEM) {
      const col = memCreate(userId, name.trim(), (requests as unknown[]) ?? [])
      res.status(201).json({ success: true, data: col })
      return
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO api_tester_collections (user_id, name, requests)
         VALUES ($1, $2, $3)
         RETURNING id, name, requests, created_at, updated_at`,
        [userId, name.trim(), JSON.stringify(requests ?? [])]
      )
      res.status(201).json({ success: true, data: rows[0] })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro ao criar coleção'
      res.status(500).json({ success: false, error: message })
    }
  })

  router.put('/collections/:id', async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthRequest).user!.id
    const collectionId = Number(req.params['id'])

    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      res.status(400).json({ success: false, error: 'ID inválido' })
      return
    }

    const { name, requests } = req.body as { name?: string; requests?: unknown }

    if (USE_MEM) {
      const patch: Partial<Pick<MemCollection, 'name' | 'requests'>> = {}
      if (name !== undefined) patch.name = name.trim()
      if (requests !== undefined) patch.requests = requests as unknown[]
      const ok = memUpdate(userId, collectionId, patch)
      if (!ok) { res.status(404).json({ success: false, error: 'Coleção não encontrada' }); return }
      res.json({ success: true })
      return
    }

    const setClauses: string[] = ['updated_at = NOW()']
    const values: unknown[] = [userId, collectionId]
    let idx = 3

    if (name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(name.trim()) }
    if (requests !== undefined) { setClauses.push(`requests = $${idx++}`); values.push(JSON.stringify(requests)) }

    try {
      const { rowCount } = await pool.query(
        `UPDATE api_tester_collections SET ${setClauses.join(', ')} WHERE user_id = $1 AND id = $2`,
        values
      )
      if (!rowCount) { res.status(404).json({ success: false, error: 'Coleção não encontrada' }); return }
      res.json({ success: true })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro ao atualizar coleção'
      res.status(500).json({ success: false, error: message })
    }
  })

  router.delete('/collections/:id', async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthRequest).user!.id
    const collectionId = Number(req.params['id'])

    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      res.status(400).json({ success: false, error: 'ID inválido' })
      return
    }

    if (USE_MEM) {
      memDelete(userId, collectionId)
      res.json({ success: true })
      return
    }

    try {
      await pool.query(
        `DELETE FROM api_tester_collections WHERE user_id = $1 AND id = $2`,
        [userId, collectionId]
      )
      res.json({ success: true })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro ao deletar coleção'
      res.status(500).json({ success: false, error: message })
    }
  })

  return router
}
