import * as XLSX from 'xlsx'

interface KVPair { key: string; value: string; enabled: boolean }
interface ApiRequestBody { type: 'none' | 'json' | 'form' | 'raw'; content: string }
interface ApiRequest { id: string; name: string; method: string; url: string; params: KVPair[]; headers: KVPair[]; body: ApiRequestBody }
interface ApiFolder { type: 'folder'; id: string; name: string; requests: ApiRequest[] }
type CollectionItem = ApiFolder | ApiRequest
interface ApiCollection { id: number; name: string; requests: CollectionItem[] }
interface ProxyResult { status: number; statusText: string; headers: Record<string, string>; body: string; duration: number; size: number }
interface ConsoleEntry { id: string; ts: number; method: string; url: string; status: number | null; duration: number | null; error?: string }
type ActiveTab = 'params' | 'headers' | 'body'
type RespTab = 'body' | 'headers' | 'html'

// ---- State ----
let collections: ApiCollection[] = []
let currentRequest: ApiRequest = makeNewRequest()
let currentCollectionId: number | null = null
let isSending = false
let runnerStop = false
const openFolders = new Set<string>()
const openCollections = new Set<number>()
const consoleEntries: ConsoleEntry[] = []
let runnerData: Record<string, string>[] = []
let _ctxCleanup: (() => void) | null = null

// ---- Utilities ----
function isFolder(item: CollectionItem): item is ApiFolder { return (item as ApiFolder).type === 'folder' }
function getAllRequests(items: CollectionItem[]): ApiRequest[] { return items.flatMap(item => isFolder(item) ? item.requests : [item]) }
function makeNewRequest(): ApiRequest { return { id: crypto.randomUUID(), name: 'Nova Requisição', method: 'GET', url: '', params: [], headers: [], body: { type: 'none', content: '' } } }
function formatSize(b: number): string { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB` }
function formatDuration(ms: number): string { return ms < 1000 ? `${ms} ms` : `${(ms/1000).toFixed(2)} s` }
function formatTime(ts: number): string { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function statusClass(s: number): string { return s >= 500 ? 'at-status-5xx' : s >= 400 ? 'at-status-4xx' : s >= 300 ? 'at-status-3xx' : s >= 200 ? 'at-status-2xx' : '' }
function tryJson(b: string): string { try { return JSON.stringify(JSON.parse(b), null, 2) } catch { return b } }
function esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T }
function subst(s: string, v: Record<string,string>): string { return s.replace(/\{\{(\w+)\}\}/g, (_,k) => v[k] ?? `{{${k}}}`) }

// ---- Modal utilities ----
let _toastTimer: number | null = null

function showToast(msg: string, type: 'info' | 'error' = 'info'): void {
  const toast = el<HTMLDivElement>('atToast')
  el<HTMLSpanElement>('atToastText').textContent = msg
  toast.className = `at-toast at-toast-${type}`
  toast.hidden = false
  if (_toastTimer !== null) clearTimeout(_toastTimer)
  _toastTimer = window.setTimeout(() => { toast.hidden = true; _toastTimer = null }, 4500)
}

function showPrompt(label: string, defaultVal = ''): Promise<string | null> {
  return new Promise(resolve => {
    const modal = el<HTMLDivElement>('atPromptModal')
    el<HTMLParagraphElement>('atPromptLabel').textContent = label
    const input = el<HTMLInputElement>('atPromptInput')
    input.value = defaultVal
    modal.hidden = false
    setTimeout(() => { input.focus(); input.select() }, 0)
    const ok = el<HTMLButtonElement>('atPromptOk')
    const cancel = el<HTMLButtonElement>('atPromptCancel')
    const done = (val: string | null): void => {
      modal.hidden = true; ok.onclick = null; cancel.onclick = null; input.onkeydown = null; resolve(val)
    }
    ok.onclick = () => done(input.value.trim() || null)
    cancel.onclick = () => done(null)
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value.trim() || null); else if (e.key === 'Escape') done(null) }
  })
}

function showConfirm(label: string): Promise<boolean> {
  return new Promise(resolve => {
    const modal = el<HTMLDivElement>('atConfirmModal')
    el<HTMLParagraphElement>('atConfirmLabel').textContent = label
    modal.hidden = false
    const ok = el<HTMLButtonElement>('atConfirmOk')
    const cancel = el<HTMLButtonElement>('atConfirmCancel')
    const done = (val: boolean): void => { modal.hidden = true; ok.onclick = null; cancel.onclick = null; resolve(val) }
    ok.onclick = () => done(true)
    cancel.onclick = () => done(false)
  })
}

// ---- Context menu ----
interface CtxItem { icon: string; label: string; danger?: boolean; action: () => void }
type CtxEntry = CtxItem | 'sep'

function showCtxMenu(anchor: HTMLElement, items: CtxEntry[]): void {
  if (_ctxCleanup) { _ctxCleanup(); _ctxCleanup = null }
  const menu = el<HTMLDivElement>('atCtxMenu')
  const list = el<HTMLDivElement>('atCtxMenuList')
  list.innerHTML = ''

  items.forEach(item => {
    if (item === 'sep') {
      const sep = document.createElement('div'); sep.className = 'at-ctx-sep'; list.appendChild(sep); return
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'at-ctx-item' + (item.danger ? ' at-ctx-item--danger' : '')
    btn.textContent = `${item.icon}  ${item.label}`
    btn.addEventListener('click', () => { menu.hidden = true; item.action() })
    list.appendChild(btn)
  })

  const rect = anchor.getBoundingClientRect()
  menu.style.left = `${rect.left}px`
  menu.style.top = `${rect.bottom + 4}px`
  menu.hidden = false

  const mr = menu.getBoundingClientRect()
  if (mr.right > window.innerWidth - 8) menu.style.left = `${window.innerWidth - mr.width - 8}px`
  if (mr.bottom > window.innerHeight - 8) menu.style.top = `${rect.top - mr.height - 2}px`

  const outsideClick = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) { menu.hidden = true; cleanup() }
  }
  const cleanup = (): void => {
    document.removeEventListener('click', outsideClick, true)
    _ctxCleanup = null
  }
  setTimeout(() => {
    document.addEventListener('click', outsideClick, true)
    _ctxCleanup = cleanup
  }, 0)
}

// ---- KV table helpers ----
function buildKvRow(pair: KVPair): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.className = 'at-kv-row'
  const checkTd = document.createElement('td')
  const check = document.createElement('input')
  check.type = 'checkbox'; check.checked = pair.enabled; check.className = 'at-kv-check-input'
  checkTd.appendChild(check); tr.appendChild(checkTd)
  ;(['key','value'] as const).forEach((field, i) => {
    const td = document.createElement('td')
    const inp = document.createElement('input')
    inp.type = 'text'; inp.value = pair[field]; inp.placeholder = i === 0 ? 'Chave' : 'Valor'; inp.className = 'at-kv-input'
    td.appendChild(inp); tr.appendChild(td)
  })
  const delTd = document.createElement('td')
  const delBtn = document.createElement('button')
  delBtn.type = 'button'; delBtn.className = 'at-kv-del'; delBtn.textContent = '×'
  delBtn.addEventListener('click', () => tr.remove()); delTd.appendChild(delBtn); tr.appendChild(delTd)
  return tr
}
function addKvRow(tbody: HTMLTableSectionElement): void {
  const row = buildKvRow({ key: '', value: '', enabled: true })
  tbody.appendChild(row); row.querySelector<HTMLInputElement>('.at-kv-input')?.focus()
}
function readKvTable(tbody: HTMLTableSectionElement): KVPair[] {
  const pairs: KVPair[] = []
  tbody.querySelectorAll<HTMLTableRowElement>('.at-kv-row').forEach(row => {
    const check = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const inputs = row.querySelectorAll<HTMLInputElement>('.at-kv-input')
    const key = inputs[0]?.value.trim() ?? ''; const value = inputs[1]?.value ?? ''
    if (key || value) pairs.push({ key, value, enabled: check?.checked ?? true })
  })
  return pairs
}
function populateKvTable(tbody: HTMLTableSectionElement, pairs: KVPair[]): void {
  tbody.innerHTML = ''; pairs.forEach(p => tbody.appendChild(buildKvRow(p)))
}

// ---- Runner preview & results ----
interface RunnerResult { iter: number; name: string; method: string; url: string; status: number | null; duration: number | null; error: string }
let runnerResults: RunnerResult[] = []

function renderRunnerPreview(): void {
  const panel = el<HTMLDivElement>('atRunnerPreview')
  if (runnerData.length === 0) { panel.hidden = true; return }

  const headers = Object.keys(runnerData[0]!)
  const colId = Number(el<HTMLSelectElement>('atRunnerCollSelect').value)
  const col = collections.find(c => c.id === colId)

  // variable match check
  const varsDiv = el<HTMLDivElement>('atRunnerPreviewVars')
  varsDiv.innerHTML = ''
  if (col) {
    const allText = getAllRequests(col.requests).flatMap(r => [r.url, r.body.content, ...r.headers.map(h => h.value), ...r.params.map(p => p.value)]).join(' ')
    const usedVars = [...new Set([...allText.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]!))]
    if (usedVars.length > 0) {
      const wrap = document.createElement('div'); wrap.className = 'at-preview-vars-wrap'
      usedVars.forEach(v => {
        const tag = document.createElement('span')
        const found = headers.includes(v)
        tag.className = `at-preview-var-tag ${found ? 'at-preview-var-ok' : 'at-preview-var-miss'}`
        tag.textContent = `{{${v}}} ${found ? '✓' : '✗'}`
        wrap.appendChild(tag)
      })
      varsDiv.appendChild(wrap)
    }
  }

  // data table
  const maxRows = 50
  const shown = runnerData.slice(0, maxRows)
  el<HTMLSpanElement>('atRunnerPreviewMeta').textContent =
    `${runnerData.length} linha${runnerData.length !== 1 ? 's' : ''} · ${headers.length} variável${headers.length !== 1 ? 'eis' : ''}` +
    (runnerData.length > maxRows ? ` (exibindo ${maxRows})` : '')

  const table = el<HTMLTableElement>('atRunnerPreviewTable')
  table.innerHTML = ''
  const thead = document.createElement('thead'); const hr = document.createElement('tr')
  const nth = document.createElement('th'); nth.textContent = '#'; hr.appendChild(nth)
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th) })
  thead.appendChild(hr); table.appendChild(thead)
  const tbody = document.createElement('tbody')
  shown.forEach((row, i) => {
    const tr = document.createElement('tr')
    const ntd = document.createElement('td'); ntd.textContent = String(i + 1); tr.appendChild(ntd)
    headers.forEach(h => { const td = document.createElement('td'); td.textContent = row[h] ?? ''; tr.appendChild(td) })
    tbody.appendChild(tr)
  })
  table.appendChild(tbody)
  panel.hidden = false
}

function exportRunnerResults(format: 'csv' | 'xlsx'): void {
  if (runnerResults.length === 0) { showToast('Nenhum resultado para exportar.', 'error'); return }
  const headers = ['#', 'Nome', 'Método', 'URL', 'Status', 'Tempo(ms)', 'Erro']
  if (format === 'csv') {
    const rows = runnerResults.map(r => [r.iter, `"${r.name.replace(/"/g,'""')}"`, r.method, `"${r.url.replace(/"/g,'""')}"`, r.status ?? '', r.duration ?? '', `"${r.error.replace(/"/g,'""')}"`].join(','))
    const csv = [headers.join(','), ...rows].join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = `runner_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href)
  } else {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...runnerResults.map(r => [r.iter, r.name, r.method, r.url, r.status ?? '', r.duration ?? '', r.error])])
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados')
    XLSX.writeFile(wb, `runner_${Date.now()}.xlsx`)
  }
}

// ---- Console ----
function addConsoleEntry(e: Omit<ConsoleEntry, 'id' | 'ts'>): void {
  consoleEntries.unshift({ id: crypto.randomUUID(), ts: Date.now(), ...e })
  if (consoleEntries.length > 200) consoleEntries.pop()
  renderConsole()
}
function exportConsoleCsv(): void {
  if (consoleEntries.length === 0) { showToast('Console vazio.', 'error'); return }
  const header = 'Hora,Método,URL,Status,Tempo(ms),Erro'
  const rows = consoleEntries.map(e =>
    [formatTime(e.ts), e.method, `"${e.url.replace(/"/g, '""')}"`, e.status ?? '', e.duration ?? '', e.error ? `"${e.error.replace(/"/g, '""')}"` : ''].join(',')
  )
  const csv = [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `console_${Date.now()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function renderConsole(): void {
  const tbody = el<HTMLTableSectionElement>('atConsoleTbody')
  el<HTMLSpanElement>('atConsoleCount').textContent = String(consoleEntries.length)
  tbody.innerHTML = ''
  consoleEntries.slice(0, 100).forEach(entry => {
    const tr = document.createElement('tr')
    const statusHtml = entry.status != null
      ? `<span class="at-status-badge ${statusClass(entry.status)}">${entry.status}</span>`
      : entry.error ? `<span class="at-status-badge at-status-5xx">${esc(entry.error.slice(0,40))}</span>` : '—'
    tr.innerHTML = `<td class="at-con-time">${esc(formatTime(entry.ts))}</td><td><span class="at-method-badge at-method-${entry.method.toLowerCase()}">${esc(entry.method)}</span></td><td class="at-con-url" title="${esc(entry.url)}">${esc(entry.url)}</td><td>${statusHtml}</td><td>${entry.duration != null ? formatDuration(entry.duration) : '—'}</td>`
    tbody.appendChild(tr)
  })
}

// ---- Data file parsing ----
function parseCsv(text: string, sep: string): Record<string, string>[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map(line => {
    const vals = line.split(sep).map(v => v.replace(/^"|"$/g, '').trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}
function parseXlsxBuffer(buf: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]!]
  if (!ws) return []
  return (XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })).map(row => {
    const r: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) r[k] = String(v)
    return r
  })
}

// ---- Collections sidebar ----
function renderCollections(): void {
  const list = el<HTMLDivElement>('atCollectionList')
  const runnerSel = el<HTMLSelectElement>('atRunnerCollSelect')
  const savedVal = runnerSel.value
  list.innerHTML = ''; runnerSel.innerHTML = '<option value="">— Selecionar coleção —</option>'

  if (collections.length === 0) {
    const msg = document.createElement('p'); msg.className = 'at-empty'
    msg.textContent = 'Nenhuma coleção. Clique em "+ Nova" para criar.'; list.appendChild(msg); return
  }

  collections.forEach(col => {
    const isOpen = openCollections.has(col.id)
    const opt = document.createElement('option'); opt.value = String(col.id); opt.textContent = col.name; runnerSel.appendChild(opt)
    const colEl = document.createElement('div'); colEl.className = 'at-collection'

    const head = document.createElement('div'); head.className = 'at-collection-head'

    const chevron = document.createElement('span'); chevron.className = 'at-col-chevron'; chevron.textContent = isOpen ? '▾' : '▸'
    const nameSpan = document.createElement('span'); nameSpan.className = 'at-collection-name'; nameSpan.textContent = col.name
    const toggle = document.createElement('div'); toggle.className = 'at-col-toggle'
    toggle.appendChild(chevron); toggle.appendChild(nameSpan)
    toggle.addEventListener('click', () => { isOpen ? openCollections.delete(col.id) : openCollections.add(col.id); renderCollections() })
    head.appendChild(toggle)

    const actions = document.createElement('div'); actions.className = 'at-collection-actions'
    const menuBtn = document.createElement('button')
    menuBtn.type = 'button'; menuBtn.className = 'at-col-action'; menuBtn.title = 'Opções'; menuBtn.textContent = '⋯'
    menuBtn.addEventListener('click', e => {
      e.stopPropagation()
      showCtxMenu(menuBtn, [
        { icon: '✏', label: 'Renomear', action: () => void renameCollection(col.id, col.name) },
        { icon: '📁', label: 'Nova pasta', action: async () => { const n = await showPrompt('Nome da pasta:'); if (n) void createFolderInCollection(col.id, n) } },
        { icon: '+', label: 'Adicionar requisição', action: () => void saveToCollection(col.id, null) },
        'sep',
        { icon: '↓', label: 'Exportar como JSON', action: () => exportCollection(col) },
        'sep',
        { icon: '×', label: 'Excluir coleção', danger: true, action: () => void deleteCollection(col.id) },
      ])
    })
    actions.appendChild(menuBtn)
    head.appendChild(actions); colEl.appendChild(head)

    if (isOpen && col.requests.length > 0) {
      const wrap = document.createElement('div'); wrap.className = 'at-items-wrap'
      col.requests.forEach(item => wrap.appendChild(isFolder(item) ? buildFolderEl(col, item) : buildRequestEl(col.id, null, item)))
      colEl.appendChild(wrap)
    }
    list.appendChild(colEl)
  })
  if (savedVal) runnerSel.value = savedVal
}

function buildFolderEl(col: ApiCollection, folder: ApiFolder): HTMLElement {
  const isOpen = openFolders.has(folder.id)
  const folderEl = document.createElement('div'); folderEl.className = 'at-folder'

  const head = document.createElement('div'); head.className = 'at-folder-head'
  head.addEventListener('click', () => { isOpen ? openFolders.delete(folder.id) : openFolders.add(folder.id); renderCollections() })

  const toggle = document.createElement('span'); toggle.className = 'at-folder-toggle'; toggle.textContent = isOpen ? '▾' : '▸'
  const nameSpan = document.createElement('span'); nameSpan.className = 'at-folder-name'; nameSpan.textContent = folder.name
  const countSpan = document.createElement('span'); countSpan.className = 'at-folder-count'; countSpan.textContent = String(folder.requests.length)

  const actions = document.createElement('div'); actions.className = 'at-collection-actions'
  const menuBtn = document.createElement('button')
  menuBtn.type = 'button'; menuBtn.className = 'at-col-action'; menuBtn.title = 'Opções'; menuBtn.textContent = '⋯'
  menuBtn.addEventListener('click', e => {
    e.stopPropagation()
    showCtxMenu(menuBtn, [
      { icon: '✏', label: 'Renomear pasta', action: () => void renameFolder(col.id, folder.id, folder.name) },
      { icon: '+', label: 'Adicionar requisição', action: () => void saveToCollection(col.id, folder.id) },
      'sep',
      { icon: '×', label: 'Excluir pasta', danger: true, action: () => void deleteFolderFromCollection(col.id, folder.id) },
    ])
  })
  actions.appendChild(menuBtn)

  head.appendChild(toggle); head.appendChild(nameSpan); head.appendChild(countSpan); head.appendChild(actions)
  folderEl.appendChild(head)

  if (isOpen && folder.requests.length > 0) {
    const body = document.createElement('div'); body.className = 'at-folder-body'
    folder.requests.forEach(req => body.appendChild(buildRequestEl(col.id, folder.id, req)))
    folderEl.appendChild(body)
  }
  return folderEl
}

function buildRequestEl(collectionId: number, folderId: string | null, req: ApiRequest): HTMLElement {
  const reqEl = document.createElement('div'); reqEl.className = 'at-req-item'
  if (currentRequest.id === req.id) reqEl.classList.add('active')

  const badge = document.createElement('span'); badge.className = `at-method-badge at-method-${req.method.toLowerCase()}`; badge.textContent = req.method
  const nameEl = document.createElement('span'); nameEl.className = 'at-req-item-name'; nameEl.textContent = req.name || req.url || 'Sem nome'; nameEl.title = req.url

  const btns = document.createElement('span'); btns.className = 'at-req-btns'
  const moveBtn = document.createElement('button'); moveBtn.type = 'button'; moveBtn.className = 'at-req-del'; moveBtn.title = 'Mover'; moveBtn.textContent = '↕'
  moveBtn.addEventListener('click', e => { e.stopPropagation(); showMoveModal(collectionId, folderId, req) })
  const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'at-req-del'; delBtn.title = 'Remover'; delBtn.textContent = '×'
  delBtn.addEventListener('click', e => { e.stopPropagation(); void removeFromCollection(collectionId, folderId, req.id) })
  btns.appendChild(moveBtn); btns.appendChild(delBtn)

  reqEl.appendChild(badge); reqEl.appendChild(nameEl); reqEl.appendChild(btns)
  reqEl.addEventListener('click', () => loadRequest(req, collectionId))
  return reqEl
}

// ---- Request form ----
function loadRequest(req: ApiRequest, collectionId: number): void {
  currentRequest = { ...req }; currentCollectionId = collectionId
  el<HTMLInputElement>('atReqName').value = req.name
  el<HTMLSelectElement>('atMethod').value = req.method
  el<HTMLInputElement>('atUrl').value = req.url
  populateKvTable(el<HTMLTableSectionElement>('atParamsTbody'), req.params)
  populateKvTable(el<HTMLTableSectionElement>('atHeadersTbody'), req.headers)
  const bodyRadio = document.querySelector<HTMLInputElement>(`input[name="atBodyType"][value="${req.body.type}"]`)
  if (bodyRadio) bodyRadio.checked = true
  el<HTMLTextAreaElement>('atBodyContent').value = req.body.content
  updateBodyVisibility(); clearResponse(); renderCollections()
}
function buildCurrentRequest(): ApiRequest {
  const method = el<HTMLSelectElement>('atMethod').value
  const url = el<HTMLInputElement>('atUrl').value.trim()
  const name = el<HTMLInputElement>('atReqName').value.trim() || url || 'Nova Requisição'
  const bodyTypeEl = document.querySelector<HTMLInputElement>('input[name="atBodyType"]:checked')
  const bodyType = (bodyTypeEl?.value ?? 'none') as ApiRequestBody['type']
  return { ...currentRequest, name, method, url, params: readKvTable(el<HTMLTableSectionElement>('atParamsTbody')), headers: readKvTable(el<HTMLTableSectionElement>('atHeadersTbody')), body: { type: bodyType, content: el<HTMLTextAreaElement>('atBodyContent').value } }
}
function updateBodyVisibility(): void {
  const bodyType = document.querySelector<HTMLInputElement>('input[name="atBodyType"]:checked')?.value ?? 'none'
  const ta = el<HTMLTextAreaElement>('atBodyContent'); ta.hidden = bodyType === 'none'
  ta.placeholder = bodyType === 'json' ? '{\n  "chave": "valor"\n}' : bodyType === 'form' ? 'chave=valor&outro=xxx' : ''
}

// ---- Proxy request ----
function buildUrlWithParams(url: string, params: KVPair[]): string {
  const enabled = params.filter(p => p.enabled && p.key)
  if (!enabled.length) return url
  const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`
}
function buildHeaders(pairs: KVPair[]): Record<string, string> {
  const h: Record<string, string> = {}
  pairs.filter(p => p.enabled && p.key).forEach(p => { h[p.key] = p.value })
  return h
}
async function execProxy(req: ApiRequest, vars?: Record<string,string>): Promise<ProxyResult> {
  const applyVars = (s: string) => vars ? subst(s, vars) : s
  const url = buildUrlWithParams(applyVars(req.url), req.params.map(p => vars ? { ...p, key: applyVars(p.key), value: applyVars(p.value) } : p))
  const headers = buildHeaders(req.headers.map(h => vars ? { ...h, key: applyVars(h.key), value: applyVars(h.value) } : h))
  if (req.body.type === 'json' && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  if (req.body.type === 'form' && !headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  const body = req.body.type !== 'none' ? applyVars(req.body.content) : undefined
  const res = await fetch('/api/api-tester/proxy', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: req.method, url, headers, body }) })
  const json = (await res.json()) as { success: boolean; data?: ProxyResult; error?: string }
  if (!json.success || !json.data) throw new Error(json.error ?? 'Erro ao executar requisição')
  return json.data
}
async function sendRequest(): Promise<void> {
  if (isSending) return
  const req = buildCurrentRequest(); currentRequest = req
  const url = buildUrlWithParams(req.url, req.params)
  if (!url) { showRespError('Informe a URL antes de enviar.'); return }
  isSending = true
  const sendBtn = el<HTMLButtonElement>('atSendBtn'); sendBtn.disabled = true; sendBtn.textContent = 'Enviando...'
  clearResponse()
  try {
    const result = await execProxy(req)
    addConsoleEntry({ method: req.method, url, status: result.status, duration: result.duration })
    showResponse(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro de rede'
    addConsoleEntry({ method: req.method, url, status: null, duration: null, error: msg }); showRespError(msg)
  } finally { isSending = false; sendBtn.disabled = false; sendBtn.textContent = 'Enviar' }
}

// ---- Response ----
function clearResponse(): void {
  el('atRespBodyWrap').hidden = true; el('atRespError').hidden = true; el('atRespIdle').hidden = false
  el<HTMLButtonElement>('atRespHtmlTab').hidden = true
}
function showRespError(msg: string): void { el('atRespError').textContent = msg; el('atRespError').hidden = false; el('atRespBodyWrap').hidden = true; el('atRespIdle').hidden = true }
function showResponse(result: ProxyResult): void {
  el('atRespIdle').hidden = true; el('atRespError').hidden = true
  const statusEl = el<HTMLSpanElement>('atRespStatus'); statusEl.textContent = `${result.status} ${result.statusText}`; statusEl.className = `at-status-badge ${statusClass(result.status)}`
  el('atRespTime').textContent = formatDuration(result.duration); el('atRespSize').textContent = formatSize(result.size)
  const ct = result.headers['content-type'] ?? ''
  el<HTMLPreElement>('atRespBodyPre').textContent = tryJson(result.body)
  const isHtml = ct.includes('html')
  const htmlTab = el<HTMLButtonElement>('atRespHtmlTab')
  htmlTab.hidden = !isHtml
  if (isHtml) el<HTMLIFrameElement>('atRespHtmlFrame').srcdoc = result.body
  const tbl = el<HTMLTableElement>('atRespHeadersTable'); tbl.innerHTML = '<thead><tr><th>Header</th><th>Valor</th></tr></thead>'
  const hTbody = document.createElement('tbody')
  Object.entries(result.headers).forEach(([k, v]) => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${esc(k)}</td><td>${esc(v)}</td>`; hTbody.appendChild(tr) })
  tbl.appendChild(hTbody); el('atRespBodyWrap').hidden = false; setRespTab('body')
}

// ---- Tabs ----
function setTab(tab: ActiveTab): void {
  document.querySelectorAll<HTMLButtonElement>('.at-tab').forEach(btn => btn.classList.toggle('active', btn.dataset['tab'] === tab))
  const paneId = `atPane${tab.charAt(0).toUpperCase() + tab.slice(1)}`
  document.querySelectorAll<HTMLDivElement>('.at-tab-panel').forEach(pane => pane.classList.toggle('hidden', pane.id !== paneId))
}
function setRespTab(tab: RespTab): void {
  document.querySelectorAll<HTMLButtonElement>('.at-resp-tab').forEach(btn => btn.classList.toggle('active', btn.dataset['tab'] === tab))
  el('atRespPaneBody').classList.toggle('hidden', tab !== 'body')
  el('atRespPaneHeaders').classList.toggle('hidden', tab !== 'headers')
  el('atRespPaneHtml').classList.toggle('hidden', tab !== 'html')
}

// ---- Collections API ----
async function loadCollections(): Promise<void> {
  try { const res = await fetch('/api/api-tester/collections', { credentials: 'include' }); const json = (await res.json()) as { success: boolean; data?: ApiCollection[] }; if (json.success && json.data) { collections = json.data; renderCollections() } } catch { /* no collections */ }
}
async function updateItems(collectionId: number, items: CollectionItem[]): Promise<void> {
  await fetch(`/api/api-tester/collections/${collectionId}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: items }) })
}
async function createCollection(name: string): Promise<ApiCollection | null> {
  try {
    const res = await fetch('/api/api-tester/collections', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, requests: [] }) })
    const json = (await res.json()) as { success: boolean; data?: ApiCollection }
    if (json.success && json.data) { openCollections.add(json.data.id); collections = [json.data, ...collections]; renderCollections(); return json.data }
  } catch (err: unknown) { showToast(err instanceof Error ? err.message : 'Erro ao criar coleção', 'error') }
  return null
}
async function deleteCollection(id: number): Promise<void> {
  if (!await showConfirm('Excluir esta coleção?')) return
  await fetch(`/api/api-tester/collections/${id}`, { method: 'DELETE', credentials: 'include' })
  collections = collections.filter(c => c.id !== id); openCollections.delete(id); if (currentCollectionId === id) currentCollectionId = null; renderCollections()
}
function exportCollection(col: ApiCollection): void {
  const json = JSON.stringify({ name: col.name, requests: col.requests }, null, 2)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  a.download = `${col.name.replace(/[^a-z0-9_-]/gi, '_')}.json`
  a.click(); URL.revokeObjectURL(a.href)
}

async function renameCollection(id: number, currentName: string): Promise<void> {
  const name = await showPrompt('Renomear coleção:', currentName)
  if (!name || name === currentName) return
  await fetch(`/api/api-tester/collections/${id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
  collections = collections.map(c => c.id === id ? { ...c, name } : c); renderCollections()
}
async function createFolderInCollection(collectionId: number, folderName: string): Promise<void> {
  const col = collections.find(c => c.id === collectionId); if (!col) return
  const newFolder: ApiFolder = { type: 'folder', id: crypto.randomUUID(), name: folderName, requests: [] }
  const updated = [...col.requests, newFolder]
  await updateItems(collectionId, updated); collections = collections.map(c => c.id === collectionId ? { ...c, requests: updated } : c)
  openFolders.add(newFolder.id); renderCollections()
}
async function renameFolder(collectionId: number, folderId: string, currentName: string): Promise<void> {
  const name = await showPrompt('Renomear pasta:', currentName)
  if (!name || name === currentName) return
  const col = collections.find(c => c.id === collectionId); if (!col) return
  const updated = col.requests.map(item => isFolder(item) && item.id === folderId ? { ...item, name } : item)
  await updateItems(collectionId, updated)
  collections = collections.map(c => c.id === collectionId ? { ...c, requests: updated } : c)
  renderCollections()
}

async function deleteFolderFromCollection(collectionId: number, folderId: string): Promise<void> {
  const col = collections.find(c => c.id === collectionId); if (!col) return
  if (!await showConfirm('Excluir esta pasta e todas as suas requisições?')) return
  const updated = col.requests.filter(item => !(isFolder(item) && item.id === folderId))
  await updateItems(collectionId, updated); collections = collections.map(c => c.id === collectionId ? { ...c, requests: updated } : c); openFolders.delete(folderId); renderCollections()
}
async function saveToCollection(collectionId: number, folderId: string | null): Promise<void> {
  const req = buildCurrentRequest(); currentRequest = req
  const col = collections.find(c => c.id === collectionId); if (!col) return
  let updated: CollectionItem[]
  if (folderId) {
    updated = col.requests.map(item => {
      if (!isFolder(item) || item.id !== folderId) return item
      const idx = item.requests.findIndex(r => r.id === req.id)
      return { ...item, requests: idx >= 0 ? item.requests.map((r,i) => i === idx ? req : r) : [...item.requests, req] }
    })
  } else {
    const idx = col.requests.findIndex(item => !isFolder(item) && item.id === req.id)
    updated = idx >= 0 ? col.requests.map((item,i) => i === idx ? req : item) : [...col.requests, req]
  }
  await updateItems(collectionId, updated); collections = collections.map(c => c.id === collectionId ? { ...c, requests: updated } : c); currentCollectionId = collectionId; renderCollections()
}
async function removeFromCollection(collectionId: number, folderId: string | null, requestId: string): Promise<void> {
  const col = collections.find(c => c.id === collectionId); if (!col) return
  const updated: CollectionItem[] = folderId
    ? col.requests.map(item => isFolder(item) && item.id === folderId ? { ...item, requests: item.requests.filter(r => r.id !== requestId) } : item)
    : col.requests.filter(item => isFolder(item) || item.id !== requestId)
  await updateItems(collectionId, updated); collections = collections.map(c => c.id === collectionId ? { ...c, requests: updated } : c); renderCollections()
}

// ---- cURL ----
function buildCurl(req: ApiRequest): string {
  const url = buildUrlWithParams(req.url, req.params)
  const sq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`
  const parts: string[] = [`curl -X ${req.method}`]
  req.headers.filter(h => h.enabled && h.key).forEach(h => {
    parts.push(`  -H ${sq(`${h.key}: ${h.value}`)}`)
  })
  if (req.body.type === 'json') {
    if (!req.headers.some(h => h.enabled && h.key.toLowerCase() === 'content-type'))
      parts.push(`  -H 'Content-Type: application/json'`)
    parts.push(`  -d ${sq(req.body.content)}`)
  } else if (req.body.type === 'form') {
    if (!req.headers.some(h => h.enabled && h.key.toLowerCase() === 'content-type'))
      parts.push(`  -H 'Content-Type: application/x-www-form-urlencoded'`)
    parts.push(`  -d ${sq(req.body.content)}`)
  } else if (req.body.type === 'raw' && req.body.content) {
    parts.push(`  -d ${sq(req.body.content)}`)
  }
  parts.push(`  ${sq(url)}`)
  return parts.join(' \\\n')
}

function showCurlModal(): void {
  el<HTMLPreElement>('atCurlPre').textContent = buildCurl(buildCurrentRequest())
  el('atCurlModal').hidden = false
}

// ---- Save modal ----
function showSaveModal(): void {
  const modal = el<HTMLDivElement>('atSaveModal'); const list = el<HTMLDivElement>('atSaveModalList'); list.innerHTML = ''
  if (collections.length === 0) { const msg = document.createElement('p'); msg.className = 'at-empty'; msg.textContent = 'Nenhuma coleção.'; list.appendChild(msg) }
  else collections.forEach(col => {
    const colBtn = document.createElement('button'); colBtn.type = 'button'; colBtn.className = 'at-save-col-btn'; colBtn.textContent = `📦 ${col.name}`
    colBtn.addEventListener('click', () => { modal.hidden = true; void saveToCollection(col.id, null) }); list.appendChild(colBtn)
    col.requests.filter(isFolder).forEach(folder => {
      const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'at-save-col-btn at-save-folder-btn'; fb.textContent = `  📁 ${folder.name}`
      fb.addEventListener('click', () => { modal.hidden = true; void saveToCollection(col.id, folder.id) }); list.appendChild(fb)
    })
  })
  modal.hidden = false
}

// ---- Move modal ----
function showMoveModal(fromColId: number, fromFolderId: string | null, req: ApiRequest): void {
  const modal = el<HTMLDivElement>('atMoveModal'); const list = el<HTMLDivElement>('atMoveModalList'); list.innerHTML = ''
  collections.forEach(col => {
    const colBtn = document.createElement('button'); colBtn.type = 'button'; colBtn.className = 'at-save-col-btn'; colBtn.textContent = `📦 ${col.name} (raiz)`
    colBtn.addEventListener('click', async () => {
      modal.hidden = true
      await removeFromCollection(fromColId, fromFolderId, req.id)
      const target = collections.find(c => c.id === col.id); if (!target) return
      const updated = [...target.requests, req]
      await updateItems(col.id, updated); collections = collections.map(c => c.id === col.id ? { ...c, requests: updated } : c); renderCollections()
    }); list.appendChild(colBtn)
    col.requests.filter(isFolder).forEach(folder => {
      const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'at-save-col-btn at-save-folder-btn'; fb.textContent = `  📁 ${folder.name}`
      fb.addEventListener('click', async () => {
        modal.hidden = true
        await removeFromCollection(fromColId, fromFolderId, req.id)
        const target = collections.find(c => c.id === col.id); if (!target) return
        const updated = target.requests.map(item => isFolder(item) && item.id === folder.id ? { ...item, requests: [...item.requests, req] } : item)
        await updateItems(col.id, updated); collections = collections.map(c => c.id === col.id ? { ...c, requests: updated } : c); openFolders.add(folder.id); renderCollections()
      }); list.appendChild(fb)
    })
  })
  if (list.children.length === 0) { const msg = document.createElement('p'); msg.className = 'at-empty'; msg.textContent = 'Nenhum destino.'; list.appendChild(msg) }
  modal.hidden = false
}

// ---- Runner ----
async function runCollection(collectionId: number): Promise<void> {
  const col = collections.find(c => c.id === collectionId); if (!col) { showToast('Coleção não encontrada.', 'error'); return }
  const allReqs = getAllRequests(col.requests); if (allReqs.length === 0) { showToast('Coleção vazia.', 'error'); return }
  const dataRows = runnerData.length > 0 ? runnerData : [{}]
  const total = allReqs.length * dataRows.length
  runnerStop = false; runnerResults = []

  const startBtn = el<HTMLButtonElement>('atRunnerStart'); const stopBtn = el<HTMLButtonElement>('atRunnerStop')
  startBtn.disabled = true; stopBtn.disabled = false
  el('atRunnerExport').hidden = true

  const tbody = el<HTMLTableSectionElement>('atRunnerTbody'); tbody.innerHTML = ''
  const summary = el<HTMLDivElement>('atRunnerSummary'); summary.hidden = false
  el('atRunnerTotal').textContent = `${total} execuções`
  const progressWrap = el<HTMLDivElement>('atRunnerProgress'); progressWrap.hidden = false
  const progressBar = el<HTMLDivElement>('atRunnerProgressBar'); progressBar.style.width = '0%'
  const progressText = el<HTMLSpanElement>('atRunnerProgressText')

  let done = 0; let passed = 0; let failed = 0
  const upd = (): void => {
    el('atRunnerPassed').textContent = `${passed} ok`
    el('atRunnerFailed').textContent = `${failed} erro`
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    progressBar.style.width = `${pct}%`
    progressText.textContent = `${done} / ${total} (${pct}%)`
  }
  upd()

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    if (runnerStop) break
    const vars = dataRows[rowIdx]!
    for (let i = 0; i < allReqs.length; i++) {
      if (runnerStop) break
      const req = allReqs[i]!
      const iterLabel = dataRows.length > 1 ? `[${rowIdx+1}/${dataRows.length}] ` : ''
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${esc(iterLabel)}${i+1}</td><td title="${esc(req.name)}">${esc(req.name||'Sem nome')}</td><td><span class="at-method-badge at-method-${req.method.toLowerCase()}">${req.method}</span></td><td class="at-runner-url" title="${esc(req.url)}">${esc(req.url)}</td><td><span class="at-runner-spinner">⌛</span></td><td>—</td>`
      tbody.appendChild(tr); tr.scrollIntoView({ block: 'nearest' })
      const cells = tr.querySelectorAll('td'); const statusCell = cells[4]!; const timeCell = cells[5]!
      const result: RunnerResult = { iter: done + 1, name: req.name || 'Sem nome', method: req.method, url: req.url, status: null, duration: null, error: '' }
      try {
        const r = await execProxy(req, vars)
        statusCell.innerHTML = `<span class="at-status-badge ${statusClass(r.status)}">${r.status}</span>`
        timeCell.textContent = String(r.duration)
        result.status = r.status; result.duration = r.duration
        addConsoleEntry({ method: req.method, url: req.url, status: r.status, duration: r.duration }); passed++
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro'
        statusCell.innerHTML = `<span class="at-status-badge at-status-5xx">${esc(msg.slice(0,30))}</span>`; timeCell.textContent = '—'
        result.error = msg
        addConsoleEntry({ method: req.method, url: req.url, status: null, duration: null, error: msg }); failed++
      }
      runnerResults.push(result); done++; upd()
    }
  }
  startBtn.disabled = false; stopBtn.disabled = true
  progressBar.style.width = `${Math.round((done / total) * 100)}%`
  progressText.textContent = `Concluído: ${done} / ${total}`
  el('atRunnerExport').hidden = false
}

// ---- Import ----
interface ResolvedParam { name: string; in: string }
function resolveRawParams(raw: unknown[], comp: Record<string, Record<string, unknown>>): ResolvedParam[] {
  return raw.flatMap(p => {
    let param = p as Record<string, unknown>
    if (typeof param['$ref'] === 'string') { const k = (param['$ref'] as string).split('/').pop()!; param = comp[k] ?? {} }
    if (!param['name'] || !param['in']) return []
    return [{ name: String(param['name']), in: String(param['in']) }]
  })
}
function mergeParams(base: ResolvedParam[], override: ResolvedParam[]): ResolvedParam[] {
  const keys = new Set(override.map(p => `${p.in}:${p.name}`))
  return [...base.filter(p => !keys.has(`${p.in}:${p.name}`)), ...override]
}

function parseOpenApiCollection(json: unknown, baseUrlOverride?: string): { name: string; requests: CollectionItem[] } | null {
  const spec = json as Record<string, unknown>
  if (typeof spec['openapi'] !== 'string' || !spec['paths'] || typeof spec['paths'] !== 'object') return null
  const info = (spec['info'] ?? {}) as Record<string, unknown>
  const name = (info['title'] as string) || 'Coleção OpenAPI'
  const components = (spec['components'] ?? {}) as Record<string, unknown>
  const compParams = (components['parameters'] ?? {}) as Record<string, Record<string, unknown>>
  const schemes = (components['securitySchemes'] ?? {}) as Record<string, Record<string, unknown>>
  let apiKeyHeader: string | null = null
  for (const s of Object.values(schemes)) { if (s['type'] === 'apiKey' && s['in'] === 'header' && typeof s['name'] === 'string') { apiKeyHeader = s['name']; break } }
  const servers = spec['servers'] as Array<Record<string, unknown>> | undefined
  const baseUrl = baseUrlOverride ?? (servers?.[0]?.['url'] as string) ?? ''
  const globalSec = spec['security'] as Array<Record<string, unknown>> | undefined
  const globalNeedsKey = apiKeyHeader != null && (globalSec?.some(s => apiKeyHeader! in s) ?? false)
  const folderMap = new Map<string, ApiRequest[]>(); const untagged: ApiRequest[] = []
  const paths = spec['paths'] as Record<string, Record<string, unknown>>

  for (const [path, pathItem] of Object.entries(paths)) {
    const pathParams = resolveRawParams((pathItem['parameters'] as unknown[]) ?? [], compParams)
    for (const [httpMethod, operation] of Object.entries(pathItem)) {
      if (!['get','post','put','delete','patch','head','options'].includes(httpMethod)) continue
      const op = operation as Record<string, unknown>
      const allParams = mergeParams(pathParams, resolveRawParams((op['parameters'] as unknown[]) ?? [], compParams))
      const queryParams: KVPair[] = allParams.filter(p => p.in === 'query').map(p => ({ key: p.name, value: '', enabled: true }))
      const headerParams: KVPair[] = allParams.filter(p => p.in === 'header').map(p => ({ key: p.name, value: '', enabled: true }))
      if (apiKeyHeader && !headerParams.some(h => h.key === apiKeyHeader)) {
        const opSec = op['security'] as Array<Record<string, unknown>> | undefined
        if (opSec != null ? opSec.some(s => apiKeyHeader! in s) : globalNeedsKey) headerParams.unshift({ key: apiKeyHeader, value: '', enabled: true })
      }
      let body: ApiRequestBody = { type: 'none', content: '' }
      if (op['requestBody'] && typeof op['requestBody'] === 'object') {
        const rb = op['requestBody'] as Record<string, unknown>; const ct = (rb['content'] as Record<string, unknown> | undefined)
        if (ct?.['application/json']) body = { type: 'json', content: '' }
      }
      const m = httpMethod.toUpperCase(); const desc = (op['description'] as string) || (op['summary'] as string) || ''
      const rawName = desc ? `${m} ${path} — ${desc}` : `${m} ${path}`
      const req: ApiRequest = { id: crypto.randomUUID(), name: rawName.length > 100 ? rawName.slice(0,97)+'…' : rawName, method: m, url: baseUrl + path, params: queryParams, headers: headerParams, body }
      const tags = op['tags'] as string[] | undefined; const tag = tags?.[0]
      if (tag) { if (!folderMap.has(tag)) folderMap.set(tag, []); folderMap.get(tag)!.push(req) } else { untagged.push(req) }
    }
  }
  const items: CollectionItem[] = []
  for (const [tag, reqs] of folderMap.entries()) items.push({ type: 'folder', id: crypto.randomUUID(), name: tag, requests: reqs })
  untagged.forEach(r => items.push(r))
  return items.length > 0 ? { name, requests: items } : null
}

function parsePostmanCollection(json: unknown): { name: string; requests: CollectionItem[] } | null {
  const col = json as Record<string, unknown>
  if (!col['info'] || !Array.isArray(col['item'])) return null
  const name = ((col['info'] as Record<string, unknown>)['name'] as string) || 'Coleção importada'

  function parseItem(item: Record<string, unknown>): CollectionItem | null {
    if (Array.isArray(item['item'])) {
      const folderReqs: ApiRequest[] = []
      item['item'].forEach((sub: unknown) => {
        const r = parseItem(sub as Record<string, unknown>); if (!r) return
        if (isFolder(r)) r.requests.forEach(req => folderReqs.push(req)); else folderReqs.push(r)
      })
      return { type: 'folder', id: crypto.randomUUID(), name: (item['name'] as string) || 'Pasta', requests: folderReqs }
    }
    const req = item['request'] as Record<string, unknown> | undefined; if (!req) return null
    const method = ((req['method'] as string) || 'GET').toUpperCase()
    let url = ''; const urlField = req['url']
    if (typeof urlField === 'string') url = urlField
    else if (urlField && typeof urlField === 'object') url = ((urlField as Record<string, unknown>)['raw'] as string) || ''
    const headers: KVPair[] = []; if (Array.isArray(req['header'])) req['header'].forEach((h: unknown) => { const hh = h as Record<string, unknown>; if (hh['key']) headers.push({ key: String(hh['key']), value: String(hh['value'] ?? ''), enabled: !hh['disabled'] }) })
    const params: KVPair[] = []
    if (urlField && typeof urlField === 'object') { const uObj = urlField as Record<string, unknown>; if (Array.isArray(uObj['query'])) { uObj['query'].forEach((q: unknown) => { const qq = q as Record<string, unknown>; if (qq['key']) params.push({ key: String(qq['key']), value: String(qq['value'] ?? ''), enabled: !qq['disabled'] }) }); if (params.length) url = url.split('?')[0] ?? url } }
    let body: ApiRequestBody = { type: 'none', content: '' }
    if (req['body'] && typeof req['body'] === 'object') { const b = req['body'] as Record<string, unknown>; const mode = b['mode'] as string; if (mode === 'raw') { const lang = ((b['options'] as Record<string, unknown> | undefined)?.['raw'] as Record<string, unknown> | undefined)?.['language']; body = { type: lang === 'json' ? 'json' : 'raw', content: String(b['raw'] ?? '') } } else if (mode === 'urlencoded' && Array.isArray(b['urlencoded'])) { body = { type: 'form', content: (b['urlencoded'] as Record<string, unknown>[]).filter(p => p['key']).map(p => `${p['key']}=${p['value'] ?? ''}`).join('&') } } }
    return { id: crypto.randomUUID(), name: (item['name'] as string) || url, method, url, params, headers, body }
  }
  const items: CollectionItem[] = [];
  (col['item'] as unknown[]).forEach(item => { const r = parseItem(item as Record<string, unknown>); if (r) items.push(r) })
  return items.length > 0 ? { name, requests: items } : null
}

function parseNativeCollection(json: unknown): { name: string; requests: CollectionItem[] } | null {
  const col = json as Record<string, unknown>
  if (typeof col['name'] !== 'string' || !Array.isArray(col['requests'])) return null
  return { name: col['name'], requests: col['requests'] as CollectionItem[] }
}

function sanitizeJsonString(s: string): string {
  // Strip BOM
  let start = s.charCodeAt(0) === 0xFEFF ? 1 : 0
  let result = s.slice(0, start)
  let inString = false, escaped = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!
    const code = s.charCodeAt(i)
    if (escaped) { result += ch; escaped = false; continue }
    if (inString) {
      if (ch === '\\') { result += ch; escaped = true }
      else if (ch === '"') { result += ch; inString = false }
      else if (code < 0x20 && code !== 0x09) {
        // escape raw control chars inside strings
        if (code === 0x0a) result += '\\n'
        else if (code === 0x0d) result += '\\r'
        else result += '\\u' + code.toString(16).padStart(4, '0')
      } else { result += ch }
    } else {
      if (ch === '"') { result += ch; inString = true }
      else { result += ch }
    }
  }
  return result
}

async function importFromUrl(rawUrl: string): Promise<void> {
  const url = rawUrl.trim()
  if (!url) return
  const btn = el<HTMLButtonElement>('atImportUrlSubmit')
  btn.disabled = true; btn.textContent = '...'
  try {
    const res = await fetch('/api/api-tester/proxy', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'GET', url })
    })
    const json = (await res.json()) as { success: boolean; data?: { body: string; status: number }; error?: string }
    if (!json.success || !json.data) { showToast(json.error ?? 'Erro ao buscar URL', 'error'); return }
    if (json.data.status >= 400) { showToast(`Servidor retornou ${json.data.status}`, 'error'); return }
    await importFromJsonString(json.data.body)
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : 'Erro ao buscar URL', 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Importar'
  }
}

async function importFromJsonString(jsonStr: string): Promise<void> {
  let parsed: unknown
  try { parsed = JSON.parse(sanitizeJsonString(jsonStr)) } catch { showToast('JSON inválido.', 'error'); return }

  // If it's OpenAPI without a servers field, ask for base URL before parsing
  let baseUrlOverride: string | undefined
  const maybeSpec = parsed as Record<string, unknown>
  if (typeof maybeSpec['openapi'] === 'string' && maybeSpec['paths']) {
    const servers = maybeSpec['servers'] as Array<Record<string, unknown>> | undefined
    if (!servers?.[0]?.['url']) {
      const url = await showPrompt('URL base da API (ex: https://api.integrati.cloud/distribuicao):')
      if (url === null) return
      baseUrlOverride = url
    }
  }

  const result = parseOpenApiCollection(parsed, baseUrlOverride) ?? parseNativeCollection(parsed) ?? parsePostmanCollection(parsed)
  if (!result) { showToast('Formato não reconhecido. Aceito: OpenAPI 3.x, Postman v2/v2.1 ou nativo.', 'error'); return }
  try {
    const res = await fetch('/api/api-tester/collections', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: result.name, requests: result.requests }) })
    const json = (await res.json()) as { success: boolean; data?: ApiCollection }
    if (json.success && json.data) {
      openCollections.add(json.data.id); collections = [json.data, ...collections]; renderCollections()
    }
  } catch (err: unknown) { showToast(err instanceof Error ? err.message : 'Erro ao importar', 'error') }
}

// ---- Initializer ----
export function initApiTesterTool(): void {
  document.querySelectorAll<HTMLButtonElement>('.at-tab').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset['tab'] as ActiveTab)))
  document.querySelectorAll<HTMLButtonElement>('.at-resp-tab').forEach(btn => btn.addEventListener('click', () => setRespTab(btn.dataset['tab'] as RespTab)))
  el<HTMLButtonElement>('atSendBtn').addEventListener('click', () => { void sendRequest() })
  el<HTMLInputElement>('atUrl').addEventListener('keydown', e => { if (e.key === 'Enter') void sendRequest() })
  el<HTMLButtonElement>('atNewReqBtn').addEventListener('click', () => {
    currentRequest = makeNewRequest(); currentCollectionId = null
    el<HTMLInputElement>('atReqName').value = currentRequest.name; el<HTMLSelectElement>('atMethod').value = 'GET'; el<HTMLInputElement>('atUrl').value = ''
    el<HTMLTableSectionElement>('atParamsTbody').innerHTML = ''; el<HTMLTableSectionElement>('atHeadersTbody').innerHTML = ''
    const none = document.querySelector<HTMLInputElement>('input[name="atBodyType"][value="none"]'); if (none) none.checked = true
    el<HTMLTextAreaElement>('atBodyContent').value = ''; updateBodyVisibility(); clearResponse(); renderCollections()
  })
  el<HTMLButtonElement>('atAddParam').addEventListener('click', () => addKvRow(el<HTMLTableSectionElement>('atParamsTbody')))
  el<HTMLButtonElement>('atAddHeader').addEventListener('click', () => addKvRow(el<HTMLTableSectionElement>('atHeadersTbody')))
  document.querySelectorAll<HTMLInputElement>('input[name="atBodyType"]').forEach(r => r.addEventListener('change', updateBodyVisibility)); updateBodyVisibility()
  el<HTMLButtonElement>('atRespCopyBtn').addEventListener('click', () => {
    const text = el<HTMLPreElement>('atRespBodyPre').textContent ?? ''
    void navigator.clipboard.writeText(text).then(() => { const btn = el<HTMLButtonElement>('atRespCopyBtn'); btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = 'Copiar' }, 1500) })
  })
  el<HTMLButtonElement>('atNewCollectionBtn').addEventListener('click', async () => { const n = await showPrompt('Nome da coleção:'); if (n) void createCollection(n) })
  el<HTMLButtonElement>('atCurlBtn').addEventListener('click', showCurlModal)
  el<HTMLButtonElement>('atCurlModalClose').addEventListener('click', () => { el('atCurlModal').hidden = true })
  el<HTMLButtonElement>('atCurlCopy').addEventListener('click', () => {
    void navigator.clipboard.writeText(el<HTMLPreElement>('atCurlPre').textContent ?? '').then(() => {
      const btn = el<HTMLButtonElement>('atCurlCopy'); btn.textContent = 'Copiado!'
      setTimeout(() => { btn.textContent = 'Copiar' }, 1500)
    })
  })
  el<HTMLButtonElement>('atSaveBtn').addEventListener('click', showSaveModal)
  el<HTMLButtonElement>('atSaveModalClose').addEventListener('click', () => { el('atSaveModal').hidden = true })
  el<HTMLButtonElement>('atSaveNewColl').addEventListener('click', async () => { el('atSaveModal').hidden = true; const n = await showPrompt('Nome da nova coleção:'); if (n) { const col = await createCollection(n); if (col) void saveToCollection(col.id, null) } })
  el<HTMLButtonElement>('atMoveModalClose').addEventListener('click', () => { el('atMoveModal').hidden = true })
  el<HTMLButtonElement>('atRunnerBtn').addEventListener('click', () => { el('atRunner').hidden = false })
  el<HTMLButtonElement>('atRunnerClose').addEventListener('click', () => { el('atRunner').hidden = true })
  el<HTMLButtonElement>('atRunnerStart').addEventListener('click', () => { const id = Number(el<HTMLSelectElement>('atRunnerCollSelect').value); if (!id) { showToast('Selecione uma coleção', 'error'); return }; el<HTMLTableSectionElement>('atRunnerTbody').innerHTML = ''; void runCollection(id) })
  el<HTMLButtonElement>('atRunnerStop').addEventListener('click', () => { runnerStop = true })
  const runnerFileInput = el<HTMLInputElement>('atRunnerFileInput')
  el<HTMLButtonElement>('atRunnerFileBtn').addEventListener('click', () => runnerFileInput.click())
  runnerFileInput.addEventListener('change', () => {
    const file = runnerFileInput.files?.[0]; if (!file) return
    const sep = el<HTMLSelectElement>('atRunnerSepSelect').value
    const reader = new FileReader()
    if (/\.xlsx?$/i.test(file.name)) {
      reader.onload = e => { runnerData = parseXlsxBuffer(e.target?.result as ArrayBuffer); el('atRunnerFileInfo').textContent = `${runnerData.length} linhas · ${file.name}`; renderRunnerPreview() }
      reader.readAsArrayBuffer(file)
    } else {
      reader.onload = e => { runnerData = parseCsv(e.target?.result as string, sep); el('atRunnerFileInfo').textContent = `${runnerData.length} linhas · ${file.name}`; renderRunnerPreview() }
      reader.readAsText(file)
    }
    runnerFileInput.value = ''
  })
  el<HTMLButtonElement>('atRunnerFileClear').addEventListener('click', () => { runnerData = []; el('atRunnerFileInfo').textContent = '—'; el('atRunnerPreview').hidden = true })
  el<HTMLSelectElement>('atRunnerCollSelect').addEventListener('change', renderRunnerPreview)
  const importInput = el<HTMLInputElement>('atImportInput')
  el<HTMLButtonElement>('atImportBtn').addEventListener('click', () => importInput.click())
  importInput.addEventListener('change', () => { const file = importInput.files?.[0]; if (file) { const r = new FileReader(); r.onload = e => { void importFromJsonString(e.target?.result as string) }; r.readAsText(file); importInput.value = '' } })

  const urlRow = el<HTMLDivElement>('atImportUrlRow')
  const urlInput = el<HTMLInputElement>('atImportUrlInput')
  const closeUrlRow = (): void => { urlRow.hidden = true; urlInput.value = '' }
  const submitUrlImport = (): void => { const u = urlInput.value.trim(); if (u) { void importFromUrl(u); closeUrlRow() } }
  el<HTMLButtonElement>('atImportUrlBtn').addEventListener('click', () => {
    urlRow.hidden = !urlRow.hidden
    if (!urlRow.hidden) urlInput.focus()
  })
  el<HTMLButtonElement>('atImportUrlSubmit').addEventListener('click', submitUrlImport)
  el<HTMLButtonElement>('atImportUrlCancel').addEventListener('click', closeUrlRow)
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUrlImport(); else if (e.key === 'Escape') closeUrlRow() })
  el<HTMLButtonElement>('atConsoleToggle').addEventListener('click', () => { const body = el('atConsoleBody'); const ch = el('atConsoleChevron'); body.hidden = !body.hidden; ch.textContent = body.hidden ? '▸' : '▾' })
  el<HTMLButtonElement>('atConsoleExport').addEventListener('click', exportConsoleCsv)
  el<HTMLButtonElement>('atConsoleClear').addEventListener('click', () => { consoleEntries.length = 0; renderConsole() })

  el<HTMLButtonElement>('atRunnerPreviewToggle').addEventListener('click', () => {
    const body = el('atRunnerPreviewBody'); const chevron = el('atRunnerPreviewChevron')
    body.hidden = !body.hidden; chevron.textContent = body.hidden ? '▸' : '▾'
  })
  el<HTMLButtonElement>('atRunnerExportCsv').addEventListener('click', () => exportRunnerResults('csv'))
  el<HTMLButtonElement>('atRunnerExportXls').addEventListener('click', () => exportRunnerResults('xlsx'))

  // Sidebar resize handle
  const handle = el<HTMLDivElement>('atSidebarHandle')
  const sidebar = el<HTMLElement>('atSidebar')
  let resizeDragging = false; let resizeStartX = 0; let resizeStartW = 0
  handle.addEventListener('mousedown', e => {
    resizeDragging = true; resizeStartX = e.clientX; resizeStartW = sidebar.getBoundingClientRect().width
    handle.classList.add('is-dragging')
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    e.preventDefault()
  })
  document.addEventListener('mousemove', e => {
    if (!resizeDragging) return
    const w = Math.max(160, Math.min(500, resizeStartW + e.clientX - resizeStartX))
    sidebar.style.width = `${w}px`
  })
  document.addEventListener('mouseup', () => {
    if (!resizeDragging) return
    resizeDragging = false; handle.classList.remove('is-dragging')
    document.body.style.cursor = ''; document.body.style.userSelect = ''
  })

  void loadCollections()
}
