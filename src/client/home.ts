interface UserInfo { id: number; login: string; name: string }

const TITLES: Record<string, string> = {
  painel:        'Painel',
  'sql-concat':  'SQL → IN',
  'json-format': 'JSON Identador',
  'sql-with':    'SQL WITH',
}

let activeSection = 'painel'

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

  document.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); navigateTo(link.dataset['section']!) })
  })
  document.querySelectorAll<HTMLElement>('.tool-card[data-section]').forEach(card => {
    card.addEventListener('click', () => navigateTo(card.dataset['section']!))
  })
  document.getElementById('logoutBtn')!.addEventListener('click', logout)

  initSqlTool()
  initJsonTool()
  initWithTool()
}

boot().catch(console.error)
