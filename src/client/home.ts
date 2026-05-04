interface UserInfo { id: number; login: string; name: string; exp?: number }

const TITLES: Record<string, string> = {
  painel:        'Painel',
  'sql-concat':  'SQL → IN',
  'json-format': 'JSON Identador',
  'sql-with':    'SQL WITH',
  automacoes:    'Atendimento GLPI',
}

let activeSection = 'painel'
let sessionExpAt = 0
let timerInterval: ReturnType<typeof setInterval> | null = null

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function checkAuth(): Promise<UserInfo> {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) { window.location.href = '/login'; throw new Error('unauth') }
  return ((await res.json()) as { user: UserInfo }).user
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/login'
}

// ─── Session timer ────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function setAlertLevel(level: null | 'warn' | 'urgent'): void {
  const banner = document.getElementById('sessionAlert')!
  const text   = document.getElementById('sessionAlertText')!
  const timer  = document.getElementById('sessionTimer')!
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
      window.location.href = '/login'
      return
    }
    if (remaining <= 60_000)       setAlertLevel('urgent')
    else if (remaining <= 120_000) setAlertLevel('warn')
    else                           setAlertLevel(null)
  }

  tick()
  timerInterval = setInterval(tick, 1000)
}

async function renewSession(): Promise<void> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!res.ok) { window.location.href = '/login'; return }
  const user = await checkAuth()
  if (user.exp) startSessionTimer(user.exp * 1000)
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigateTo(id: string): void {
  document.getElementById(`section-${activeSection}`)?.classList.add('hidden')
  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach(el => {
    el.classList.toggle('active', el.dataset['section'] === id)
  })
  document.getElementById(`section-${id}`)?.classList.remove('hidden')
  const titleEl = document.getElementById('pageTitle')
  if (titleEl) titleEl.textContent = TITLES[id] ?? id
  activeSection = id
}

// ─── SQL → IN ─────────────────────────────────────────────────────────────────

function buildSqlIn(column: string, raw: string, type: 'string' | 'number'): string {
  const vals = raw.split('\n').map(v => v.trim()).filter(Boolean)
  if (!vals.length) return ''
  const fmt = type === 'string' ? vals.map(v => `'${v.replace(/'/g, "''")}'`) : vals
  const chunks: string[][] = []
  for (let i = 0; i < fmt.length; i += 1000) chunks.push(fmt.slice(i, i + 1000))
  return chunks.map(c => `${column} IN (${c.join(', ')})`).join(' OR\n')
}

function initSqlTool(): void {
  const col    = document.getElementById('sqlColumn')      as HTMLInputElement
  const vals   = document.getElementById('sqlValues')      as HTMLTextAreaElement
  const result = document.getElementById('sqlResult')      as HTMLDivElement
  const pre    = document.getElementById('sqlResultPre')   as HTMLPreElement
  const count  = document.getElementById('sqlResultCount') as HTMLSpanElement

  function run(type: 'string' | 'number'): void {
    if (!col.value.trim() || !vals.value.trim()) return
    const out = buildSqlIn(col.value.trim(), vals.value, type)
    const n = vals.value.split('\n').filter(v => v.trim()).length
    pre.textContent = out
    count.textContent = `${n} valores`
    result.classList.remove('hidden')
  }

  document.getElementById('sqlBtnString')!.addEventListener('click', () => run('string'))
  document.getElementById('sqlBtnNumber')!.addEventListener('click', () => run('number'))
  document.getElementById('sqlClearBtn')!.addEventListener('click', () => {
    col.value = ''; vals.value = ''; result.classList.add('hidden')
  })
  document.getElementById('sqlCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('sqlCopyBtn') as HTMLButtonElement)
  )
}

// ─── JSON Identador ───────────────────────────────────────────────────────────

function initJsonTool(): void {
  const input  = document.getElementById('jsonInput')     as HTMLTextAreaElement
  const err    = document.getElementById('jsonError')     as HTMLDivElement
  const result = document.getElementById('jsonResult')    as HTMLDivElement
  const pre    = document.getElementById('jsonResultPre') as HTMLPreElement

  document.getElementById('jsonFormatBtn')!.addEventListener('click', () => {
    err.classList.add('hidden'); result.classList.add('hidden')
    try {
      pre.textContent = JSON.stringify(JSON.parse(input.value), null, 2)
      result.classList.remove('hidden')
    } catch (e) {
      err.textContent = `JSON inválido: ${(e as Error).message}`
      err.classList.remove('hidden')
    }
  })
  document.getElementById('jsonClearBtn')!.addEventListener('click', () => {
    input.value = ''; err.classList.add('hidden'); result.classList.add('hidden')
  })
  document.getElementById('jsonCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('jsonCopyBtn') as HTMLButtonElement)
  )
}

// ─── SQL WITH ─────────────────────────────────────────────────────────────────

function buildWith(name: string, cols: string[], blocks: string[][]): string {
  const selects: string[] = []
  for (const block of blocks) {
    for (const line of block) {
      const parts = line.split(',').map(v => v.trim())
      if (parts.length !== cols.length) continue
      selects.push(`SELECT ${parts.join(', ')} FROM dual`)
    }
  }
  if (!selects.length) return ''
  const w = name || 'dados'
  return `WITH ${w} (${cols.join(', ')}) AS (\n  ${selects.join('\n  UNION ALL\n  ')}\n)\nSELECT *\nFROM ${w};`
}

function initWithTool(): void {
  const nameInp  = document.getElementById('withName')    as HTMLInputElement
  const colInputs = Array.from(document.querySelectorAll<HTMLInputElement>('#withCols input'))
  const blockTAs  = Array.from(document.querySelectorAll<HTMLTextAreaElement>('#withBlocks textarea'))
  const result    = document.getElementById('withResult')    as HTMLDivElement
  const pre       = document.getElementById('withResultPre') as HTMLPreElement

  document.getElementById('withGenerateBtn')!.addEventListener('click', () => {
    const cols   = colInputs.map(i => i.value.trim()).filter(Boolean)
    const blocks = blockTAs.map(ta => ta.value.trim().split('\n').filter(Boolean)).filter(b => b.length)
    if (!cols.length || !blocks.length) return
    pre.textContent = buildWith(nameInp.value.trim(), cols, blocks)
    result.classList.remove('hidden')
  })
  document.getElementById('withClearBtn')!.addEventListener('click', () => {
    nameInp.value = ''
    colInputs.forEach(i => { i.value = '' })
    blockTAs.forEach(ta => { ta.value = '' })
    result.classList.add('hidden')
  })
  document.getElementById('withCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('withCopyBtn') as HTMLButtonElement)
  )
}

// ─── Atendimento GLPI ─────────────────────────────────────────────────────────

interface GlpiTicket {
  id: number
  name: string
  statusLabel: string
  priority: number
  priorityLabel: string
  date: string
}

const PRIORITY_CLASS: Record<number, string> = {
  1: 'priority-low', 2: 'priority-low',
  3: 'priority-medium',
  4: 'priority-high', 5: 'priority-high', 6: 'priority-urgent',
}

function formatGlpiDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw.replace(' ', 'T'))
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function renderTickets(tickets: GlpiTicket[]): void {
  const tbody  = document.getElementById('glpiTableBody')!
  const wrap   = document.getElementById('glpiTableWrap')!
  const empty  = document.getElementById('glpiEmpty')!

  tbody.innerHTML = ''

  if (!tickets.length) {
    wrap.classList.add('hidden')
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  wrap.classList.remove('hidden')

  tickets.forEach(t => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="glpi-id">#${t.id}</td>
      <td class="glpi-name">${escapeHtml(t.name)}</td>
      <td><span class="glpi-status-badge">${escapeHtml(t.statusLabel)}</span></td>
      <td><span class="glpi-priority-badge ${PRIORITY_CLASS[t.priority] ?? ''}">${escapeHtml(t.priorityLabel)}</span></td>
      <td class="glpi-date">${formatGlpiDate(t.date)}</td>
    `
    tbody.appendChild(tr)
  })
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function fetchGlpiTickets(): Promise<void> {
  const loading = document.getElementById('glpiLoading')!
  const errorEl = document.getElementById('glpiError')!
  const wrap    = document.getElementById('glpiTableWrap')!
  const empty   = document.getElementById('glpiEmpty')!
  const filter  = document.getElementById('glpiStatusFilter') as HTMLSelectElement

  errorEl.classList.add('hidden')
  wrap.classList.add('hidden')
  empty.classList.add('hidden')
  loading.classList.remove('hidden')

  try {
    const status = filter.value
    const url = `/api/automacao/tickets${status ? `?status=${status}` : ''}`
    const res = await fetch(url, { credentials: 'include' })

    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? `Erro ${res.status}`)
    }

    const data = await res.json() as { tickets: GlpiTicket[] }
    renderTickets(data.tickets)
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : 'Erro ao buscar chamados'
    errorEl.classList.remove('hidden')
  } finally {
    loading.classList.add('hidden')
  }
}

function initGlpiTool(): void {
  document.getElementById('glpiRefreshBtn')!.addEventListener('click', fetchGlpiTickets)
  document.getElementById('glpiStatusFilter')!.addEventListener('change', fetchGlpiTickets)
}

// ─── Util ─────────────────────────────────────────────────────────────────────

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    const orig = btn.textContent
    btn.textContent = 'Copiado!'
    setTimeout(() => { btn.textContent = orig }, 1500)
  } catch { btn.textContent = 'Erro' }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  const user = await checkAuth()

  const nameEl   = document.getElementById('userName')
  const emailEl  = document.getElementById('userEmail')
  const avatarEl = document.getElementById('userAvatar')
  if (nameEl)   nameEl.textContent   = user.name
  if (emailEl)  emailEl.textContent  = user.login
  if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase()

  if (user.exp) startSessionTimer(user.exp * 1000)
  document.getElementById('renewBtn')?.addEventListener('click', renewSession)

  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      const section = link.dataset['section']!
      navigateTo(section)
      if (section === 'automacoes') fetchGlpiTickets()
    })
  })
  document.querySelectorAll<HTMLElement>('.tool-card[data-section]').forEach(card => {
    card.addEventListener('click', () => {
      const section = card.dataset['section']!
      navigateTo(section)
      if (section === 'automacoes') fetchGlpiTickets()
    })
  })
  document.getElementById('logoutBtn')!.addEventListener('click', logout)

  initSqlTool()
  initJsonTool()
  initWithTool()
  initGlpiTool()
}

boot().catch(console.error)
