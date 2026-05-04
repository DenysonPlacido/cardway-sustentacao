import { initSqlTool } from './home/sql-in'
import { initJsonTool } from './home/json-identador'
import { initWithTool } from './home/sql-with'
import { ensureGlpiUiStructure, initGlpiTool, fetchGlpiTickets } from './home/glpi'

interface UserInfo { id: number; login: string; name: string; exp?: number }

const TITLES: Record<string, string> = {
  painel: 'Painel',
  'sql-concat': 'SQL → IN',
  'json-format': 'JSON Identador',
  'sql-with': 'SQL WITH',
  automacoes: 'Atendimento GLPI',
}

let activeSection = 'painel'
let sessionExpAt = 0
let timerInterval: ReturnType<typeof setInterval> | null = null

async function checkAuth(): Promise<UserInfo> {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) {
    window.location.href = '/login'
    throw new Error('unauth')
  }
  return ((await res.json()) as { user: UserInfo }).user
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/login'
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function setAlertLevel(level: null | 'warn' | 'urgent'): void {
  const banner = document.getElementById('sessionAlert')!
  const text = document.getElementById('sessionAlertText')!
  const timer = document.getElementById('sessionTimer')!
  if (!level) {
    banner.hidden = true
    timer.className = 'session-timer'
    return
  }
  banner.hidden = false
  banner.className = `session-alert ${level}`
  timer.className = `session-timer ${level}`
  text.textContent = level === 'urgent'
    ? 'Falta 1 minuto para encerrar sua sessão'
    : 'Falta 2 minutos para encerrar sua sessão'
}

function startSessionTimer(expAtMs: number): void {
  sessionExpAt = expAtMs
  const timerText = document.getElementById('sessionTimerText')!

  if (timerInterval) clearInterval(timerInterval)

  function tick(): void {
    const remaining = sessionExpAt - Date.now()
    timerText.textContent = formatTime(remaining)
    if (remaining <= 0) {
      clearInterval(timerInterval!)
      showReauthModal()
      return
    }
    if (remaining <= 60_000) setAlertLevel('urgent')
    else if (remaining <= 120_000) setAlertLevel('warn')
    else setAlertLevel(null)
  }

  tick()
  timerInterval = setInterval(tick, 1000)
}

function showReauthModal(): void {
  const modal = document.getElementById('reauth-modal')!
  modal.hidden = false
  ;(document.getElementById('ra-login') as HTMLInputElement).focus()
}

function hideReauthModal(): void {
  const modal = document.getElementById('reauth-modal')!
  modal.hidden = true
  ;(document.getElementById('ra-login') as HTMLInputElement).value = ''
  ;(document.getElementById('ra-senha') as HTMLInputElement).value = ''
  ;(document.getElementById('ra-error') as HTMLElement).hidden = true
}

async function renewSession(): Promise<void> {
  showReauthModal()
}

function navigateTo(id: string): void {
  document.getElementById(`section-${activeSection}`)?.classList.add('hidden')
  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach((el) => {
    el.classList.toggle('active', el.dataset['section'] === id)
  })
  document.getElementById(`section-${id}`)?.classList.remove('hidden')
  const titleEl = document.getElementById('pageTitle')
  if (titleEl) titleEl.textContent = TITLES[id] ?? id
  activeSection = id
}

async function boot(): Promise<void> {
  const user = await checkAuth()

  const nameEl = document.getElementById('userName')
  const emailEl = document.getElementById('userEmail')
  const avatarEl = document.getElementById('userAvatar')
  if (nameEl) nameEl.textContent = user.name
  if (emailEl) emailEl.textContent = user.login
  if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase()

  if (user.exp) startSessionTimer(user.exp * 1000)
  document.getElementById('renewBtn')?.addEventListener('click', renewSession)

  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const section = link.dataset['section']!
      navigateTo(section)
      if (section === 'automacoes') fetchGlpiTickets()
    })
  })

  document.querySelectorAll<HTMLElement>('.tool-card[data-section]').forEach((card) => {
    card.addEventListener('click', () => {
      const section = card.dataset['section']!
      navigateTo(section)
      if (section === 'automacoes') fetchGlpiTickets()
    })
  })

  document.getElementById('logoutBtn')!.addEventListener('click', logout)

  const raConfirm = document.getElementById('ra-confirm')!
  const raCancel = document.getElementById('ra-cancel')!
  const raError = document.getElementById('ra-error')!

  raConfirm.addEventListener('click', async () => {
    const loginVal = (document.getElementById('ra-login') as HTMLInputElement).value.trim()
    const passVal = (document.getElementById('ra-senha') as HTMLInputElement).value
    raError.hidden = true
    if (!loginVal || !passVal) {
      raError.textContent = 'Preencha login e senha.'
      raError.hidden = false
      return
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginVal, password: passVal }),
      })
      if (!res.ok) {
        raError.textContent = 'Credenciais inválidas.'
        raError.hidden = false
        return
      }
      const u = await checkAuth()
      if (u.exp) startSessionTimer(u.exp * 1000)
      hideReauthModal()
      setAlertLevel(null)
    } catch {
      raError.textContent = 'Erro de conexão.'
      raError.hidden = false
    }
  })

  ;(document.getElementById('ra-login') as HTMLInputElement).addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') (document.getElementById('ra-senha') as HTMLInputElement).focus()
  })
  ;(document.getElementById('ra-senha') as HTMLInputElement).addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') raConfirm.click()
  })
  raCancel.addEventListener('click', () => { window.location.href = '/login' })

  initSqlTool()
  initJsonTool()
  initWithTool()
  ensureGlpiUiStructure()
  initGlpiTool()
}

boot().catch(console.error)
