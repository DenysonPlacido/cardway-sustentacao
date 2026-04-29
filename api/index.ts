import 'dotenv/config'
import express, { NextFunction, Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import path from 'path'
import { Pool } from 'pg'

const app = express()
const PUBLIC_DIR = path.join(process.cwd(), 'public')
const STATIC_DIR = path.join(process.cwd(), 'api', 'static')
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-please-change-in-production'
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? ''
const DEFAULT_USERS = [
  { login: 'denyson.dplacido', name: 'Denyson D. Placido', password: 'Cardway@123' },
  { login: 'pedro.ggabe', name: 'Pedro G. Gabe', password: 'Cardway@456' },
]

const LOGIN_MIN_LENGTH = 3
const LOGIN_MAX_LENGTH = 64
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

const db = new Pool({
  connectionString: DATABASE_URL || undefined,
  ssl: { rejectUnauthorized: false },
})
const dbSetupPromise = setupDb().then(() => true).catch((error: unknown) => {
  console.error('Database setup failed:', error)
  return false
})

app.use(express.json())
app.use(cookieParser())
app.get('/favicon.ico', (_req: Request, res: Response): void => {
  res.type('image/svg+xml')
  res.sendFile(path.join(PUBLIC_DIR, 'cardway-logo-DmLFa68k.svg'))
})
app.use('/api/static', express.static(STATIC_DIR))
app.use(express.static(PUBLIC_DIR))

interface JwtPayload {
  id: number
  login: string
  name: string
}

interface AuthRequest extends Request {
  user?: JwtPayload
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase()
}

function isValidLogin(value: string): boolean {
  return /^[a-z0-9._@-]+$/.test(value)
}

function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH
}

function resolveLoginLookup(value: string): string[] {
  const normalized = normalizeLogin(value)
  const localPart = normalized.includes('@') ? normalized.split('@')[0] : normalized
  return localPart === normalized ? [normalized] : [normalized, localPart]
}

function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies['token'] as string | undefined
  if (!token) {
    res.status(401).json({ error: 'Nao autorizado' })
    return
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as JwtPayload
    next()
  } catch {
    res.status(401).json({ error: 'Sessao expirada, faca login novamente' })
  }
}

async function setupDb(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL nao configurada')
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      login TEXT NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login TEXT`)
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`)
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  const legacyEmailColumn = await db.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'email'
      LIMIT 1
    `
  )
  if (legacyEmailColumn.rows.length > 0) {
    await db.query(`UPDATE users SET login = COALESCE(login, email) WHERE login IS NULL AND COALESCE(email, '') <> ''`)
  }
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_login_key ON users (login)`)

  if (process.env.NODE_ENV !== 'production') {
    for (const user of DEFAULT_USERS) {
      const hash = await bcrypt.hash(user.password, 12)
      await db.query(
        `
          INSERT INTO users (login, name, password_hash, is_active)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT (login) DO UPDATE
          SET name = EXCLUDED.name,
              password_hash = EXCLUDED.password_hash,
              is_active = TRUE,
              updated_at = NOW()
        `,
        [normalizeLogin(user.login), user.name, hash]
      )
    }
  }
}

async function ensureDbReady(): Promise<boolean> {
  return dbSetupPromise
}

function isDatabaseConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /connect|timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|DATABASE_URL/i.test(message)
}

function getDatabaseUnavailableMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')

  if (/DATABASE_URL nao configurada/i.test(message)) {
    return 'Banco nao configurado no deploy'
  }

  if (/ENOTFOUND/i.test(message)) {
    return 'Banco configurado com host invalido'
  }

  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(message)) {
    return 'Banco indisponivel ou sem acesso de rede'
  }

  return 'Banco de dados indisponivel'
}

app.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { login, password } = req.body as { login?: string; password?: string }

  if (!login || !password) {
    res.status(400).json({ error: 'Login e senha sao obrigatorios' })
    return
  }

  const normalizedLogin = normalizeLogin(login)
  const lookupLogins = resolveLoginLookup(login)

  if (
    normalizedLogin.length < LOGIN_MIN_LENGTH ||
    normalizedLogin.length > LOGIN_MAX_LENGTH ||
    !isValidLogin(normalizedLogin)
  ) {
    res.status(400).json({ error: 'Login invalido' })
    return
  }

  if (!isValidPassword(password)) {
    res.status(400).json({ error: 'Senha invalida' })
    return
  }

  try {
    const dbReady = await ensureDbReady()
    if (!dbReady) {
      res.status(503).json({ error: 'Servico de autenticacao indisponivel no momento' })
      return
    }

    const result = await db.query<{
      id: number
      login: string
      name: string
      password_hash: string
      is_active: boolean
    }>(
      `
        SELECT id, login, name, password_hash, is_active
        FROM users
        WHERE login = ANY($1::text[])
        LIMIT 1
      `,
      [lookupLogins]
    )

    const user = result.rows[0]

    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Credenciais invalidas' })
      return
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatches) {
      res.status(401).json({ error: 'Credenciais invalidas' })
      return
    }

    const token = jwt.sign(
      { id: user.id, login: user.login, name: user.name } satisfies JwtPayload,
      JWT_SECRET,
      { expiresIn: '8h' }
    )

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
    })

    res.json({ success: true, user: { login: user.login, name: user.name } })
  } catch (error) {
    console.error('Login error:', error)
    if (isDatabaseConnectivityError(error)) {
      res.status(503).json({ error: getDatabaseUnavailableMessage(error) })
      return
    }
    res.status(500).json({ error: 'Erro interno' })
  }
})

app.post('/api/auth/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token')
  res.json({ success: true })
})

app.get('/api/auth/me', authMiddleware, (req: AuthRequest, res: Response): void => {
  res.json({ user: req.user })
})

app.post('/api/admin/users', async (req: Request, res: Response): Promise<void> => {
  const adminKey = req.headers['x-admin-key'] as string | undefined
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    res.status(403).json({ error: 'Acesso negado' })
    return
  }

  const { login, name, password } = req.body as { login?: string; name?: string; password?: string }
  if (!login || !name || !password) {
    res.status(400).json({ error: 'login, name e password sao obrigatorios' })
    return
  }

  const normalizedLogin = normalizeLogin(login)
  if (
    normalizedLogin.length < LOGIN_MIN_LENGTH ||
    normalizedLogin.length > LOGIN_MAX_LENGTH ||
    !isValidLogin(normalizedLogin)
  ) {
    res.status(400).json({ error: 'Login invalido' })
    return
  }

  if (!isValidPassword(password)) {
    res.status(400).json({ error: 'Senha invalida' })
    return
  }

  try {
    const hash = await bcrypt.hash(password, 12)

    await db.query(
      `
        INSERT INTO users (login, name, password_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT (login) DO UPDATE
        SET name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            is_active = TRUE,
            updated_at = NOW()
      `,
      [normalizedLogin, name.trim(), hash]
    )

    res.status(201).json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao criar usuario'
    res.status(400).json({ error: message })
  }
})

app.get('/', (_req: Request, res: Response): void => {
  res.redirect('/login')
})

app.get('/login', (_req: Request, res: Response): void => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'))
})

app.get('/home', (req: Request, res: Response): void => {
  const token = req.cookies?.['token'] as string | undefined
  if (!token) {
    res.redirect('/login')
    return
  }

  try {
    jwt.verify(token, JWT_SECRET)
    res.sendFile(path.join(PUBLIC_DIR, 'home.html'))
  } catch {
    res.clearCookie('token')
    res.redirect('/login')
  }
})

if (process.env.NODE_ENV !== 'production') {
  const PORT = Number(process.env.PORT ?? 3000)
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`))
}

export default app
