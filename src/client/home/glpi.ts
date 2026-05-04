import {
  AiAnalysis,
  GlpiTicket,
  PRIORITY_CLASS,
  TicketDrawerMode,
  escapeHtml,
  formatGlpiDate,
  normalizeTicketContent,
  renderTicketHtml,
  truncateText,
} from './shared'

let drawerMode: TicketDrawerMode = 'view'
let glpiTicketsCache: GlpiTicket[] = []
let activeTicket: GlpiTicket | null = null
let lastAnalysis: AiAnalysis | null = null

function rewriteEmbeddedTicketAssets(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('[src], [href], [srcset]').forEach((el) => {
    const src = el.getAttribute('src')
    if (src && /front\/document\.send\.php/i.test(src)) {
      el.setAttribute('src', `/api/automacao/glpi-asset?src=${encodeURIComponent(src)}`)
    }

    const href = el.getAttribute('href')
    if (href && /front\/document\.send\.php/i.test(href)) {
      el.setAttribute('href', `/api/automacao/glpi-asset?src=${encodeURIComponent(href)}`)
    }

    const srcset = el.getAttribute('srcset')
    if (srcset && /front\/document\.send\.php/i.test(srcset)) {
      const rewritten = srcset
        .split(',')
        .map((part) => {
          const trimmed = part.trim()
          const [url, descriptor] = trimmed.split(/\s+/, 2)
          if (/front\/document\.send\.php/i.test(url)) {
            return `/api/automacao/glpi-asset?src=${encodeURIComponent(url)}${descriptor ? ` ${descriptor}` : ''}`
          }
          return trimmed
        })
        .join(', ')
      el.setAttribute('srcset', rewritten)
    }
  })
}

export function ensureGlpiUiStructure(): void {
  const headerRow = document.querySelector('#glpiTableWrap .glpi-table thead tr')
  if (headerRow) {
    headerRow.innerHTML = `
      <th>#</th>
      <th>Título</th>
      <th>Status</th>
      <th>Prioridade</th>
      <th>Atribuído - Técnico</th>
      <th>Conteúdo</th>
      <th>Aberto em</th>
      <th>Ações</th>
    `
  }

  const drawerBody = document.querySelector('.ticket-drawer-body')
  if (drawerBody && !document.getElementById('ticketWorkspace')) {
    const controls = document.createElement('div')
    controls.className = 'ticket-mode-bar'
    controls.innerHTML = `
      <button type="button" class="ticket-mode-btn active" data-ticket-mode="view">Visualizar</button>
      <button type="button" class="ticket-mode-btn" data-ticket-mode="reply">Responder</button>
      <button type="button" class="ticket-mode-btn" data-ticket-mode="edit">Editar</button>
    `

    const workspace = document.createElement('div')
    workspace.id = 'ticketWorkspace'
    workspace.className = 'ticket-workspace'

    const rail = document.createElement('aside')
    rail.className = 'ticket-rail'
    rail.innerHTML = `
      <div class="ticket-rail-title">Chamado</div>
      <button type="button" class="ticket-rail-item active">Chamado</button>
      <button type="button" class="ticket-rail-item">Estatísticas</button>
      <button type="button" class="ticket-rail-item">Aprovações</button>
      <button type="button" class="ticket-rail-item">Custos</button>
      <button type="button" class="ticket-rail-item">Histórico</button>
      <button type="button" class="ticket-rail-item">Todos</button>
    `

    const center = document.createElement('section')
    center.className = 'ticket-center'

    const contentCard = document.createElement('div')
    contentCard.className = 'ticket-content-card ticket-content-card--glpi'
    contentCard.innerHTML = `
      <div class="ticket-content-card-head">
        <div>
          <div class="ticket-content-title">Conteúdo do chamado</div>
          <div class="ticket-content-subtitle" id="drawerTicketSnippet"></div>
        </div>
      </div>
      <div class="ticket-content-body" id="drawerTicketContent"></div>
    `

    const replyPanel = document.createElement('div')
    replyPanel.className = 'ticket-panel ticket-reply-panel'
    replyPanel.hidden = true
    replyPanel.innerHTML = `
      <div class="ticket-panel-title">Responder chamado</div>
      <textarea id="drawerReplyContent" class="ticket-panel-textarea" rows="5" placeholder="Escreva a resposta que será enviada ao GLPI..."></textarea>
      <label class="ticket-panel-check">
        <input type="checkbox" id="drawerReplyPrivate" />
        Resposta privada
      </label>
      <div class="ticket-panel-actions">
        <button type="button" class="btn btn-primary" id="drawerSendReplyBtn">Enviar resposta</button>
      </div>
    `

    const editPanel = document.createElement('div')
    editPanel.className = 'ticket-panel ticket-edit-panel'
    editPanel.hidden = true
    editPanel.innerHTML = `
      <div class="ticket-panel-title">Editar chamado</div>
      <input id="drawerEditTitle" class="ticket-panel-input" type="text" placeholder="Título do chamado" />
      <textarea id="drawerEditContent" class="ticket-panel-textarea" rows="6" placeholder="Conteúdo do chamado"></textarea>
      <div class="ticket-panel-actions">
        <button type="button" class="btn btn-primary" id="drawerSaveEditBtn">Salvar alterações</button>
      </div>
    `

    const message = document.createElement('div')
    message.id = 'ticketActionMessage'
    message.className = 'ticket-action-message'
    message.hidden = true

    const properties = document.createElement('aside')
    properties.className = 'ticket-properties'
    properties.innerHTML = `
      <div class="ticket-side-card">
        <div class="ticket-side-title">Chamado</div>
        <div class="ticket-side-row">
          <span>Entidade</span>
          <strong id="drawerTicketEntity">Agente-CSC</strong>
        </div>
        <div class="ticket-side-row">
          <span>Data de abertura</span>
          <strong id="drawerTicketDate"></strong>
        </div>
        <div class="ticket-side-row">
          <span>Status</span>
          <strong id="drawerTicketStatus"></strong>
        </div>
        <div class="ticket-side-row">
          <span>Prioridade</span>
          <strong id="drawerTicketPriority"></strong>
        </div>
        <div class="ticket-side-row">
          <span>Grupo observador</span>
          <strong id="drawerTicketObserver"></strong>
        </div>
        <div class="ticket-side-row">
          <span>Atribuído a</span>
          <strong id="drawerTicketAssigned"></strong>
        </div>
      </div>
      <div class="ticket-side-card">
        <div class="ticket-side-title">GLPI inteligente</div>
        <p class="ticket-side-note">Abra, responda e edite o chamado sem sair da análise assistida por IA.</p>
      </div>
    `

    center.appendChild(contentCard)
    center.appendChild(replyPanel)
    center.appendChild(editPanel)
    center.appendChild(message)
    center.appendChild(document.getElementById('aiTimeline') as HTMLElement)
    center.appendChild(document.getElementById('aiAnalysisResult') as HTMLElement)
    center.appendChild(document.getElementById('aiApprovalSection') as HTMLElement)

    workspace.appendChild(rail)
    workspace.appendChild(center)
    workspace.appendChild(properties)

    drawerBody.insertBefore(controls, drawerBody.firstChild)
    drawerBody.insertBefore(workspace, controls.nextSibling)
    drawerBody.appendChild(document.getElementById('feedbackSection') as HTMLElement)
  }
}

function timelineItem(iconClass: string, iconSvg: string, label: string, sub?: string): string {
  return `
    <div class="ai-timeline-item">
      <div class="ai-timeline-icon ${iconClass}">${iconSvg}</div>
      <div class="ai-timeline-content">
        <div class="ai-timeline-label">${escapeHtml(label)}</div>
        ${sub ? `<div class="ai-timeline-sub">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>`
}

const SVG_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`
const SVG_SPIN = `<svg class="ai-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`
const SVG_ERROR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
const SVG_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`

function setTimeline(items: string[]): void {
  document.getElementById('aiTimeline')!.innerHTML = items.join('')
}

function setDrawerMessage(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  const el = document.getElementById('ticketActionMessage')
  if (!el) return
  el.textContent = message
  el.dataset['kind'] = kind
  el.hidden = !message
}

function setDrawerMode(mode: TicketDrawerMode): void {
  drawerMode = mode
  document.querySelectorAll<HTMLElement>('[data-ticket-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset['ticketMode'] === mode)
  })

  const replyPanel = document.querySelector<HTMLElement>('.ticket-reply-panel')
  const editPanel = document.querySelector<HTMLElement>('.ticket-edit-panel')
  if (replyPanel) replyPanel.hidden = mode !== 'reply'
  if (editPanel) editPanel.hidden = mode !== 'edit'

  if (mode === 'view') {
    document.getElementById('aiAnalysisResult')!.hidden = !lastAnalysis
    document.getElementById('aiApprovalSection')!.hidden = !lastAnalysis
    document.getElementById('feedbackSection')!.hidden = true
  } else {
    document.getElementById('aiAnalysisResult')!.hidden = true
    document.getElementById('aiApprovalSection')!.hidden = true
    document.getElementById('feedbackSection')!.hidden = true
  }

  setDrawerMessage('', 'info')
}

function renderTickets(tickets: GlpiTicket[]): void {
  const tbody = document.getElementById('glpiTableBody')!
  const wrap = document.getElementById('glpiTableWrap')!
  const empty = document.getElementById('glpiEmpty')!

  tbody.innerHTML = ''

  if (!tickets.length) {
    wrap.classList.add('hidden')
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  wrap.classList.remove('hidden')

  tickets.forEach((t) => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="glpi-id">#${t.id}</td>
      <td class="glpi-name">${escapeHtml(t.name)}</td>
      <td><span class="glpi-status-badge">${escapeHtml(t.statusLabel)}</span></td>
      <td><span class="glpi-priority-badge ${PRIORITY_CLASS[t.priority] ?? ''}">${escapeHtml(t.priorityLabel)}</span></td>
      <td class="glpi-assigned">${escapeHtml(t.assignedTo)}</td>
      <td class="glpi-content-cell" title="${escapeHtml(normalizeTicketContent(t.content))}">
        <div class="glpi-content-preview">${escapeHtml(truncateText(t.content, 180))}</div>
      </td>
      <td class="glpi-date">${formatGlpiDate(t.date)}</td>
      <td class="glpi-actions-cell">
        <button type="button" class="glpi-action-btn" data-action="open-ticket">Abrir</button>
      </td>
    `
    tr.addEventListener('click', () => openTicketDrawer(t))
    tr.querySelector('[data-action="open-ticket"]')?.addEventListener('click', (event) => {
      event.stopPropagation()
      openTicketDrawer(t)
    })
    tbody.appendChild(tr)
  })
}

function updateAssignedFilterOptions(tickets: GlpiTicket[]): void {
  const select = document.getElementById('glpiAssignedFilter') as HTMLSelectElement | null
  if (!select) return

  const current = select.value
  const values = Array.from(new Set(
    tickets.map((ticket) => ticket.assignedTo.trim()).filter((value) => value && value !== 'Sem atribuição'),
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'))

  select.innerHTML = '<option value="">Todos os técnicos</option>'
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    select.appendChild(option)
  }

  if (current && values.includes(current)) {
    select.value = current
  }
}

function applyGlpiFilters(): void {
  const select = document.getElementById('glpiAssignedFilter') as HTMLSelectElement | null
  const assignedFilter = select?.value ?? ''
  const tickets = assignedFilter
    ? glpiTicketsCache.filter((ticket) => ticket.assignedTo === assignedFilter)
    : glpiTicketsCache
  renderTickets(tickets)
}

function openTicketDrawer(ticket: GlpiTicket): void {
  activeTicket = ticket
  lastAnalysis = null
  drawerMode = 'view'

  document.getElementById('drawerTicketId')!.textContent = `#${ticket.id}`
  document.getElementById('drawerTicketTitle')!.textContent = ticket.name

  const meta = document.getElementById('drawerTicketMeta')!
  meta.innerHTML = `
    <span class="glpi-status-badge">${escapeHtml(ticket.statusLabel)}</span>
    <span class="glpi-priority-badge ${PRIORITY_CLASS[ticket.priority] ?? ''}">${escapeHtml(ticket.priorityLabel)}</span>
    <span style="font-size:12px;color:var(--t2)">${formatGlpiDate(ticket.date)}</span>
  `

  const ticketSnippet = document.getElementById('drawerTicketSnippet')
  if (ticketSnippet) ticketSnippet.textContent = normalizeTicketContent(ticket.content)
  const ticketEntity = document.getElementById('drawerTicketEntity')
  if (ticketEntity) ticketEntity.textContent = 'Agente-CSC'
  const ticketDate = document.getElementById('drawerTicketDate')
  if (ticketDate) ticketDate.textContent = formatGlpiDate(ticket.date)
  const ticketStatus = document.getElementById('drawerTicketStatus')
  if (ticketStatus) ticketStatus.textContent = ticket.statusLabel
  const ticketPriority = document.getElementById('drawerTicketPriority')
  if (ticketPriority) ticketPriority.textContent = ticket.priorityLabel
  const ticketObserver = document.getElementById('drawerTicketObserver')
  if (ticketObserver) ticketObserver.textContent = ticket.observerGroup ?? 'Implantação'
  const ticketAssigned = document.getElementById('drawerTicketAssigned')
  if (ticketAssigned) ticketAssigned.textContent = ticket.assignedTo

  document.getElementById('aiAnalysisResult')!.hidden = true
  document.getElementById('aiApprovalSection')!.hidden = true
  document.getElementById('feedbackSection')!.hidden = true

  const replyContent = document.getElementById('drawerReplyContent') as HTMLTextAreaElement | null
  const replyPrivate = document.getElementById('drawerReplyPrivate') as HTMLInputElement | null
  if (replyContent) replyContent.value = ''
  if (replyPrivate) replyPrivate.checked = false
  const editTitle = document.getElementById('drawerEditTitle') as HTMLInputElement | null
  const editContent = document.getElementById('drawerEditContent') as HTMLTextAreaElement | null
  if (editTitle) editTitle.value = ticket.name
  if (editContent) editContent.value = normalizeTicketContent(ticket.content)

  const contentBody = document.getElementById('drawerTicketContent')!
  contentBody.innerHTML = renderTicketHtml(ticket.content)
  rewriteEmbeddedTicketAssets(contentBody)

  setDrawerMode('view')
  setTimeline([timelineItem('idle', SVG_SHIELD, 'Pronto para análise', 'Clique em "Analisar com IA" para iniciar')])
  document.getElementById('ticketDrawer')!.hidden = false
}

function closeTicketDrawer(): void {
  document.getElementById('ticketDrawer')!.hidden = true
  activeTicket = null
  lastAnalysis = null
  drawerMode = 'view'
}

async function handleDrawerReply(): Promise<void> {
  if (!activeTicket) return

  const content = (document.getElementById('drawerReplyContent') as HTMLTextAreaElement | null)?.value.trim() ?? ''
  const isPrivate = (document.getElementById('drawerReplyPrivate') as HTMLInputElement | null)?.checked ?? false

  if (!content) {
    setDrawerMessage('Escreva uma resposta antes de enviar.', 'error')
    return
  }

  const btn = document.getElementById('drawerSendReplyBtn') as HTMLButtonElement | null
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Enviando...'
  }

  try {
    const res = await fetch(`/api/automacao/tickets/${activeTicket.id}/reply`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, isPrivate }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error ?? `Erro ${res.status}`)
    }

    setDrawerMessage('Resposta enviada ao GLPI.', 'success')
    ;(document.getElementById('drawerReplyContent') as HTMLTextAreaElement | null)!.value = ''
    setDrawerMode('view')
  } catch (err) {
    setDrawerMessage(err instanceof Error ? err.message : 'Falha ao responder o chamado.', 'error')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Enviar resposta'
    }
  }
}

async function handleDrawerEdit(): Promise<void> {
  if (!activeTicket) return

  const name = (document.getElementById('drawerEditTitle') as HTMLInputElement | null)?.value.trim() ?? ''
  const content = (document.getElementById('drawerEditContent') as HTMLTextAreaElement | null)?.value.trim() ?? ''

  if (!name && !content) {
    setDrawerMessage('Preencha ao menos o título ou o conteúdo.', 'error')
    return
  }

  const btn = document.getElementById('drawerSaveEditBtn') as HTMLButtonElement | null
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Salvando...'
  }

  try {
    const res = await fetch(`/api/automacao/tickets/${activeTicket.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(name ? { name } : {}),
        ...(content ? { content } : {}),
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error ?? `Erro ${res.status}`)
    }

    activeTicket = {
      ...activeTicket,
      name: name || activeTicket.name,
      content: content || activeTicket.content,
    }

    document.getElementById('drawerTicketTitle')!.textContent = activeTicket.name
    document.getElementById('drawerTicketContent')!.innerHTML = renderTicketHtml(activeTicket.content)
    rewriteEmbeddedTicketAssets(document.getElementById('drawerTicketContent') as HTMLElement)
    setDrawerMessage('Chamado atualizado no GLPI.', 'success')
    await fetchGlpiTickets()
    setDrawerMode('view')
  } catch (err) {
    setDrawerMessage(err instanceof Error ? err.message : 'Falha ao atualizar o chamado.', 'error')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Salvar alterações'
    }
  }
}

async function runTicketAnalysis(): Promise<void> {
  if (!activeTicket) return

  const btn = document.getElementById('drawerAnalyzeBtn') as HTMLButtonElement
  btn.disabled = true

  document.getElementById('aiAnalysisResult')!.hidden = true
  document.getElementById('aiApprovalSection')!.hidden = true
  document.getElementById('feedbackSection')!.hidden = true

  setTimeline([
    timelineItem('done', SVG_CHECK, 'Chamado lido pela IA', `#${activeTicket.id} — ${activeTicket.name}`),
    timelineItem('running', SVG_SPIN, 'Analisando padrões...', 'Aguarde'),
  ])

  try {
    const res = await fetch('/api/automacao/analisar-ticket', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: activeTicket.id }),
    })

    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? `Erro ${res.status}`)
    }

    const data = await res.json() as { analysis: AiAnalysis }
    lastAnalysis = data.analysis

    setTimeline([
      timelineItem('done', SVG_CHECK, 'Chamado lido pela IA', `#${activeTicket.id} — ${activeTicket.name}`),
      timelineItem('done', SVG_CHECK, 'Análise concluída', `Tipo: ${data.analysis.tipo} · Risco: ${data.analysis.risco}`),
      timelineItem('running', SVG_SHIELD, 'Aguardando aprovação do analista'),
    ])

    renderAnalysis(data.analysis)
    document.getElementById('aiAnalysisResult')!.hidden = false
    document.getElementById('aiApprovalSection')!.hidden = false
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    setTimeline([
      timelineItem('done', SVG_CHECK, 'Chamado lido pela IA', `#${activeTicket?.id}`),
      timelineItem('error', SVG_ERROR, 'Falha na análise', msg),
    ])
  } finally {
    btn.disabled = false
  }
}

function renderAnalysis(a: AiAnalysis): void {
  const tipoClass = a.tipo === 'PADRONIZADO' ? 'padronizado' : 'complexo'
  document.getElementById('aiTipo')!.innerHTML = `<span class="tipo-badge ${tipoClass}">${a.tipo}</span>`
  document.getElementById('aiAnalise')!.textContent = a.analise
  document.getElementById('aiAcao')!.textContent = a.acao_sugerida

  const riscoClass = a.risco.toLowerCase()
  document.getElementById('aiRisco')!.innerHTML = `<span class="risco-badge ${riscoClass}">${a.risco}</span>`

  const pct = Math.round(a.confianca * 100)
  document.getElementById('aiConfianca')!.innerHTML = `
    <div class="confianca-bar">
      <div class="confianca-track"><div class="confianca-fill" style="width:${pct}%"></div></div>
      <span class="confianca-pct">${pct}%</span>
    </div>`
}

async function handleApprove(): Promise<void> {
  if (!activeTicket || !lastAnalysis) return

  const btn = document.getElementById('approveBtn') as HTMLButtonElement
  btn.disabled = true
  btn.textContent = 'Executando...'

  try {
    const res = await fetch('/api/automacao/aprovar', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: activeTicket.id,
        acaoId: lastAnalysis.tipo,
        acaoDescricao: lastAnalysis.acao_sugerida,
      }),
    })

    if (!res.ok) throw new Error(`Erro ${res.status}`)

    setTimeline([
      timelineItem('done', SVG_CHECK, 'Chamado lido pela IA', `#${activeTicket.id}`),
      timelineItem('done', SVG_CHECK, 'Análise concluída', lastAnalysis.tipo),
      timelineItem('done', SVG_CHECK, 'Ação aprovada e executada', lastAnalysis.acao_sugerida),
    ])
    document.getElementById('aiApprovalSection')!.hidden = true
  } catch {
    btn.textContent = 'Erro — tentar novamente'
  } finally {
    btn.disabled = false
    if (btn.textContent !== 'Erro — tentar novamente') btn.textContent = 'Aprovado'
  }
}

function handleAssume(): void {
  if (!activeTicket || !lastAnalysis) return

  setTimeline([
    timelineItem('done', SVG_CHECK, 'Chamado lido pela IA', `#${activeTicket.id}`),
    timelineItem('done', SVG_CHECK, 'Análise concluída', lastAnalysis.tipo),
    timelineItem('error', SVG_ERROR, 'Analista assumiu manualmente'),
  ])

  document.getElementById('aiApprovalSection')!.querySelector('.ai-approval-actions')!.setAttribute('hidden', '')
  document.getElementById('feedbackSection')!.hidden = false
}

async function handleFeedbackSubmit(): Promise<void> {
  const input = document.getElementById('feedbackInput') as HTMLTextAreaElement
  const btn = document.getElementById('feedbackSubmitBtn') as HTMLButtonElement
  const text = input.value.trim()
  if (!text || !activeTicket) return

  btn.disabled = true
  btn.textContent = 'Enviando...'

  try {
    await fetch('/api/automacao/feedback', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: activeTicket.id, feedback: text }),
    })
    btn.textContent = 'Feedback enviado'
    input.value = ''
  } catch {
    btn.textContent = 'Erro ao enviar'
    btn.disabled = false
  }
}

async function fetchGlpiTickets(): Promise<void> {
  const loading = document.getElementById('glpiLoading')!
  const errorEl = document.getElementById('glpiError')!
  const wrap = document.getElementById('glpiTableWrap')!
  const empty = document.getElementById('glpiEmpty')!
  const filter = document.getElementById('glpiStatusFilter') as HTMLSelectElement

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
    glpiTicketsCache = data.tickets
    updateAssignedFilterOptions(data.tickets)
    applyGlpiFilters()
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : 'Erro ao buscar chamados'
    errorEl.classList.remove('hidden')
  } finally {
    loading.classList.add('hidden')
  }
}

let agentSource: EventSource | null = null
let currentChunkEl: HTMLSpanElement | null = null
const agentTicketMeta = new Map<number, { name: string; priorityLabel: string }>()

function terminalAppend(text: string, cls: string): void {
  const body = document.getElementById('agentTerminalBody')!
  const span = document.createElement('span')
  span.className = `agent-line ${cls}`
  span.textContent = text
  body.appendChild(span)
  currentChunkEl = null
  const term = document.getElementById('agentTerminal')!
  term.scrollTop = term.scrollHeight
}

function terminalChunk(text: string): void {
  const body = document.getElementById('agentTerminalBody')!
  if (!currentChunkEl) {
    currentChunkEl = document.createElement('span')
    currentChunkEl.className = 'agent-line chunk'
    body.appendChild(currentChunkEl)
  }
  currentChunkEl.textContent += text
  const term = document.getElementById('agentTerminal')!
  term.scrollTop = term.scrollHeight
}

function buildResultCard(id: number, name: string, priorityLabel: string, analysis: AiAnalysis): HTMLDivElement {
  const tipoClass = analysis.tipo === 'PADRONIZADO' ? 'padronizado' : 'complexo'
  const riscoClass = analysis.risco.toLowerCase()
  const pct = Math.round(analysis.confianca * 100)

  const card = document.createElement('div')
  card.className = 'agent-result-item'
  card.dataset['ticketId'] = String(id)
  card.innerHTML = `
    <div class="agent-result-top">
      <span class="agent-result-id">#${id}</span>
      <span class="agent-result-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <span class="tipo-badge ${tipoClass}">${analysis.tipo}</span>
      <span class="risco-badge ${riscoClass}">${analysis.risco}</span>
    </div>
    <div class="agent-result-action-label">Ação sugerida pela IA:</div>
    <div class="agent-result-action-text">${escapeHtml(analysis.acao_sugerida)}</div>
    <div class="agent-result-pct">Confiança: ${pct}% · ${escapeHtml(priorityLabel)}</div>
    <div class="agent-result-actions">
      <button class="btn-approve" data-action="approve">✓ Aprovar</button>
      <button class="btn-correct" data-action="correct">✎ Corrigir</button>
    </div>
    <div class="agent-correction-form" hidden>
      <textarea placeholder="Descreva a ação correta..."></textarea>
      <button class="btn-save-correction">Salvar correção</button>
    </div>`

  const approveBtn = card.querySelector<HTMLButtonElement>('[data-action="approve"]')!
  const correctBtn = card.querySelector<HTMLButtonElement>('[data-action="correct"]')!
  const corrForm = card.querySelector<HTMLDivElement>('.agent-correction-form')!
  const corrTA = card.querySelector<HTMLTextAreaElement>('textarea')!
  const saveBtn = card.querySelector<HTMLButtonElement>('.btn-save-correction')!

  approveBtn.addEventListener('click', async () => {
    approveBtn.disabled = true
    approveBtn.textContent = 'Aprovando...'
    try {
      const res = await fetch('/api/automacao/aprovar', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: id, acaoId: analysis.tipo, acaoDescricao: analysis.acao_sugerida }),
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      card.querySelector('.agent-result-actions')!.innerHTML =
        `<span class="agent-result-status approved">✓ Aprovado — registrado no GLPI</span>`
      corrForm.hidden = true
    } catch (err) {
      approveBtn.disabled = false
      approveBtn.textContent = '✓ Aprovar'
      terminalAppend(`\n✗ Erro ao aprovar #${id}: ${err instanceof Error ? err.message : 'Erro'}`, 'fail')
    }
  })

  correctBtn.addEventListener('click', () => {
    corrForm.hidden = !corrForm.hidden
    if (!corrForm.hidden) corrTA.focus()
  })

  saveBtn.addEventListener('click', async () => {
    const correcao = corrTA.value.trim()
    if (!correcao) return

    saveBtn.disabled = true
    saveBtn.textContent = 'Salvando...'
    try {
      await fetch('/api/automacao/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: id, feedback: correcao }),
      })
      card.querySelector('.agent-result-actions')!.innerHTML =
        `<span class="agent-result-status corrected">✎ Corrigido — feedback enviado</span>`
      corrForm.hidden = true
    } catch {
      saveBtn.disabled = false
      saveBtn.textContent = 'Salvar correção'
    }
  })

  return card
}

function runAgent(): void {
  const filter = (document.getElementById('agentStatusFilter') as HTMLSelectElement).value
  const url = `/api/automacao/rodar-agente${filter ? `?status=${filter}` : ''}`
  const runBtn = document.getElementById('agentRunBtn') as HTMLButtonElement
  const stopBtn = document.getElementById('agentStopBtn') as HTMLButtonElement

  if (agentSource) {
    agentSource.close()
    agentSource = null
  }

  runBtn.disabled = true
  stopBtn.disabled = false
  currentChunkEl = null

  agentTicketMeta.clear()
  document.getElementById('agentTerminalBody')!.innerHTML = ''
  document.getElementById('agentResultsList')!.innerHTML = ''
  document.getElementById('agentResultsEmpty')!.hidden = false

  agentSource = new EventSource(url)
  agentSource.addEventListener('log', (e: MessageEvent) => {
    const { text } = JSON.parse(e.data as string) as { text: string }
    terminalAppend(text, 'log')
  })
  agentSource.addEventListener('ticket_start', (e: MessageEvent) => {
    const t = JSON.parse(e.data as string) as { id: number; name: string; priorityLabel: string }
    agentTicketMeta.set(t.id, { name: t.name, priorityLabel: t.priorityLabel ?? '' })
    terminalAppend(`\n[#${t.id}] ${t.name}`, 'ticket')
  })
  agentSource.addEventListener('chunk', (e: MessageEvent) => {
    const { text } = JSON.parse(e.data as string) as { text: string }
    terminalChunk(text)
  })
  agentSource.addEventListener('ticket_done', (e: MessageEvent) => {
    const { id, analysis } = JSON.parse(e.data as string) as { id: number; analysis: AiAnalysis }
    const meta = agentTicketMeta.get(id) ?? { name: `Ticket #${id}`, priorityLabel: '' }
    const list = document.getElementById('agentResultsList')!
    const empty = document.getElementById('agentResultsEmpty')!
    empty.hidden = true
    list.prepend(buildResultCard(id, meta.name, meta.priorityLabel, analysis))
  })
  agentSource.addEventListener('ticket_error', (e: MessageEvent) => {
    const { id, message } = JSON.parse(e.data as string) as { id: number; message: string }
    terminalAppend(`\n✗ #${id}: ${message}`, 'fail')
  })
  agentSource.addEventListener('agent_done', () => {
    terminalAppend('\n─── Pronto. Revise e aprove as ações acima. ───', 'success')
    runBtn.disabled = false
    stopBtn.disabled = true
    agentSource?.close()
    agentSource = null
  })
  agentSource.addEventListener('error', () => {
    if (agentSource?.readyState === EventSource.CLOSED) {
      runBtn.disabled = false
      stopBtn.disabled = true
      agentSource = null
    }
  })
}

function stopAgent(): void {
  agentSource?.close()
  agentSource = null
  terminalAppend('\n[Agente interrompido pelo analista]', 'fail')
  ;(document.getElementById('agentRunBtn') as HTMLButtonElement).disabled = false
  ;(document.getElementById('agentStopBtn') as HTMLButtonElement).disabled = true
}

function switchGlpiTab(tab: string): void {
  document.querySelectorAll<HTMLElement>('.glpi-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['tab'] === tab)
  })
  const chamados = document.getElementById('tab-chamados')!
  const agente = document.getElementById('tab-agente')!
  chamados.hidden = tab !== 'chamados'
  agente.hidden = tab !== 'agente'
  if (tab === 'chamados') fetchGlpiTickets()
}

export function initGlpiTool(): void {
  ensureGlpiUiStructure()
  document.getElementById('glpiRefreshBtn')!.addEventListener('click', fetchGlpiTickets)
  document.getElementById('glpiStatusFilter')!.addEventListener('change', fetchGlpiTickets)
  document.getElementById('glpiAssignedFilter')?.addEventListener('change', applyGlpiFilters)
  document.getElementById('agentRunBtn')!.addEventListener('click', runAgent)
  document.getElementById('agentStopBtn')!.addEventListener('click', stopAgent)
  document.querySelectorAll<HTMLElement>('[data-ticket-mode]').forEach((button) => {
    button.addEventListener('click', () => setDrawerMode(button.dataset['ticketMode'] as TicketDrawerMode))
  })
  document.getElementById('ticketDrawerClose')!.addEventListener('click', closeTicketDrawer)
  document.getElementById('ticketDrawerOverlay')!.addEventListener('click', closeTicketDrawer)
  document.getElementById('drawerAnalyzeBtn')!.addEventListener('click', runTicketAnalysis)
  document.getElementById('drawerSendReplyBtn')?.addEventListener('click', handleDrawerReply)
  document.getElementById('drawerSaveEditBtn')?.addEventListener('click', handleDrawerEdit)
  document.getElementById('approveBtn')!.addEventListener('click', handleApprove)
  document.getElementById('assumeBtn')!.addEventListener('click', handleAssume)
  document.getElementById('feedbackSubmitBtn')!.addEventListener('click', handleFeedbackSubmit)
  document.querySelectorAll<HTMLElement>('.glpi-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchGlpiTab(btn.dataset['tab']!))
  })
}

export { fetchGlpiTickets }
