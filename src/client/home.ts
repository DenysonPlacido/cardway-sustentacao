import { initJsonTool } from './home/json-identador'
import { initConcatenadorTool } from './home/sql-concatenador'
import { initCteTool } from './home/sql-cte'
import { ensureGlpiUiStructure, initGlpiTool, fetchGlpiTickets } from './home/glpi'
import { initLogPedidoTool } from './home/log-pedido'
import { initLogWebTool } from './home/log-web'

interface UserInfo { id: number; login: string; name: string; exp?: number }

const NATIVE_TITLES: Record<string, { title: string; eyebrow: string }> = {
  painel: { title: 'Painel', eyebrow: 'Portal base' },
  'json-format': { title: 'JSON Identador', eyebrow: 'Ferramenta' },
  'sql-concatenador': { title: 'Concatenador SQL', eyebrow: 'Ferramenta' },
  'sql-tabela': { title: 'SQL -> Tabela', eyebrow: 'Ferramenta' },
  'log-pedido': { title: 'Logs de Pedido', eyebrow: 'Ferramenta' },
  'log-web': { title: 'Logs Web SGV', eyebrow: 'Ferramenta' },
  automacoes: { title: 'Atendimento GLPI', eyebrow: 'Automacao' },
}

const PAGE_TITLES: Record<string, { title: string; eyebrow: string }> = {
  '/lancamento': { title: 'Lancamento - Dashboard', eyebrow: 'Modulo incorporado' },
  '/lancamento/gerador': { title: 'Lancamento - Gerador', eyebrow: 'Modulo incorporado' },
  '/lancamento/tipos': { title: 'Lancamento - Tipos', eyebrow: 'Modulo incorporado' },
  '/lancamento/mapeamentos': { title: 'Lancamento - Mapeamentos', eyebrow: 'Modulo incorporado' },
  '/lancamento/historico': { title: 'Lancamento - Historico', eyebrow: 'Modulo incorporado' },
}

let currentView: { type: 'native'; id: string } | { type: 'page'; path: string } = { type: 'native', id: 'painel' }
let sessionExpAt = 0
let timerInterval: ReturnType<typeof setInterval> | null = null

function getFrame(): HTMLIFrameElement {
  return document.getElementById('contentFrame') as HTMLIFrameElement
}

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
    ? 'Falta 1 minuto para encerrar sua sessao'
    : 'Falta 2 minutos para encerrar sua sessao'
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
      window.location.href = '/login'
      return
    }
    if (remaining <= 60_000) setAlertLevel('urgent')
    else if (remaining <= 120_000) setAlertLevel('warn')
    else setAlertLevel(null)
  }

  tick()
  timerInterval = setInterval(tick, 1000)
}

async function renewSession(): Promise<void> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!res.ok) {
    window.location.href = '/login'
    return
  }
  const user = await checkAuth()
  if (user.exp) startSessionTimer(user.exp * 1000)
}

function setHeader(title: string, eyebrow: string): void {
  const titleEl = document.getElementById('pageTitle')
  const eyebrowEl = document.getElementById('pageEyebrow')
  const embeddedTitle = document.getElementById('embeddedPageTitle')
  if (titleEl) titleEl.textContent = title
  if (eyebrowEl) eyebrowEl.textContent = eyebrow
  if (embeddedTitle) embeddedTitle.textContent = title
}

function setPageOpenButton(path: string | null): void {
  const button = document.getElementById('pageOpenBtn') as HTMLButtonElement
  if (!path) {
    button.classList.add('hidden')
    button.onclick = null
    return
  }

  button.classList.remove('hidden')
  button.onclick = (): void => window.open(path, '_blank', 'noopener')
}

function setHashForView(): void {
  if (currentView.type === 'native') {
    window.history.replaceState(null, '', `/home#${currentView.id}`)
    return
  }

  window.history.replaceState(null, '', `/home#page=${encodeURIComponent(currentView.path)}`)
}

function syncNavState(): void {
  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach((el) => {
    el.classList.toggle('active', currentView.type === 'native' && el.dataset['section'] === currentView.id)
  })

  const parentToggle = document.getElementById('lancamentoToggle')
  let hasActivePage = false
  document.querySelectorAll<HTMLElement>('.nav-subitem[data-page]').forEach((el) => {
    const active = currentView.type === 'page' && el.dataset['page'] === currentView.path
    el.classList.toggle('active', active)
    if (active) hasActivePage = true
  })
  parentToggle?.classList.toggle('active', hasActivePage)
}

function showSection(sectionId: string): void {
  document.querySelectorAll<HTMLElement>('.section').forEach((section) => {
    section.classList.add('hidden')
  })
  document.getElementById(sectionId)?.classList.remove('hidden')
}

function navigateToNative(id: string): void {
  const header = NATIVE_TITLES[id] ?? { title: id, eyebrow: 'Portal' }
  currentView = { type: 'native', id }
  syncNavState()
  showSection(`section-${id}`)
  setHeader(header.title, header.eyebrow)
  setPageOpenButton(null)
  setHashForView()

  if (id === 'automacoes') {
    fetchGlpiTickets().catch(console.error)
  }
}

function buildEmbeddedUrl(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}embed=1`
}

function setEmbeddedPathLabel(path: string): void {
  const pathLabel = document.getElementById('embeddedPagePath')
  if (pathLabel) pathLabel.textContent = path
}

function navigateToPage(path: string, forceReload = false): void {
  const frame = getFrame()
  const header = PAGE_TITLES[path] ?? { title: path, eyebrow: 'Pagina incorporada' }
  const src = buildEmbeddedUrl(path)

  currentView = { type: 'page', path }
  syncNavState()
  showSection('section-page-host')
  setHeader(header.title, header.eyebrow)
  setPageOpenButton(path)
  setEmbeddedPathLabel(path)
  setHashForView()

  if (forceReload || frame.dataset.currentPath !== path) {
    frame.dataset.currentPath = path
    frame.src = src
  }
}

function syncViewFromFrame(): void {
  const frame = getFrame()

  try {
    const framePath = frame.contentWindow?.location.pathname
    if (!framePath || !(framePath in PAGE_TITLES)) return

    if (currentView.type !== 'page' || currentView.path !== framePath) {
      currentView = { type: 'page', path: framePath }
    }

    const header = PAGE_TITLES[framePath]
    syncNavState()
    setHeader(header.title, header.eyebrow)
    setPageOpenButton(framePath)
    setEmbeddedPathLabel(framePath)
    setHashForView()
  } catch {
    // ignore cross-frame transition timing
  }
}

function applyHashRoute(): void {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) {
    navigateToNative('painel')
    return
  }

  if (hash.startsWith('page=')) {
    const path = decodeURIComponent(hash.slice('page='.length))
    if (PAGE_TITLES[path]) {
      navigateToPage(path)
      return
    }
  }

  if (NATIVE_TITLES[hash]) {
    navigateToNative(hash)
    return
  }

  navigateToNative('painel')
}

function initSidebarControls(): void {
  const sidebar = document.getElementById('mainSidebar')
  const button = document.getElementById('sidebarCollapseBtn')
  const savedState = window.localStorage.getItem('sidebarCollapsed')

  if (savedState === 'false') sidebar?.classList.remove('collapsed')

  button?.addEventListener('click', () => {
    const collapsed = sidebar?.classList.toggle('collapsed')
    window.localStorage.setItem('sidebarCollapsed', String(Boolean(collapsed)))
  })

  const toggle = document.getElementById('lancamentoToggle')
  const menu = document.getElementById('lancamentoMenu')
  toggle?.addEventListener('click', () => {
    toggle.classList.toggle('is-open')
    menu?.classList.toggle('open')
  })
}

function initNavigation(): void {
  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault()
      const section = element.dataset['section']
      if (!section) return
      navigateToNative(section)
    })
  })

  document.querySelectorAll<HTMLElement>('.nav-subitem[data-page]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault()
      const page = element.dataset['page']
      if (!page) return
      navigateToPage(page)
    })
  })

  document.querySelectorAll<HTMLElement>('.tool-card[data-section]').forEach((element) => {
    element.addEventListener('click', () => {
      const section = element.dataset['section']
      if (!section) return
      navigateToNative(section)
    })
  })

  document.querySelectorAll<HTMLElement>('.tool-card[data-page]').forEach((element) => {
    element.addEventListener('click', () => {
      const page = element.dataset['page']
      if (!page) return
      navigateToPage(page)
    })
  })

  getFrame().addEventListener('load', syncViewFromFrame)
  window.addEventListener('hashchange', applyHashRoute)
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
  document.getElementById('logoutBtn')?.addEventListener('click', logout)

  initSidebarControls()
  initNavigation()
  initJsonTool()
  initConcatenadorTool()
  initCteTool()
  initLogPedidoTool()
  initLogWebTool()
  ensureGlpiUiStructure()
  initGlpiTool()

  applyHashRoute()
}

boot().catch(console.error)
