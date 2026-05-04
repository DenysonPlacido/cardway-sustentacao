const STATUS_LABELS: Record<number, string> = {
  1: 'Novo',
  2: 'Em atendimento (atribuído)',
  3: 'Em atendimento (planejado)',
  4: 'Pendente',
  5: 'Resolvido',
  6: 'Fechado',
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Muito baixa',
  2: 'Baixa',
  3: 'Média',
  4: 'Alta',
  5: 'Muito alta',
  6: 'Urgente',
}

const OBSERVER_GROUP_FILTER = String(process.env.GLPI_OBSERVER_GROUP_NAME || 'Implantação').trim()

export interface GlpiTicket {
  id: number
  name: string
  status: number
  statusLabel: string
  priority: number
  priorityLabel: string
  date: string
  solvedate: string | null
  content: string
  assignedTo: string
  observerGroup: string
}

interface GlpiTicketRaw {
  id?: unknown
  name?: unknown
  status?: unknown
  priority?: unknown
  date?: unknown
  solvedate?: unknown
  content?: unknown
  [key: string]: unknown
}

export class GlpiClient {
  private readonly baseUrl: string
  private readonly appToken: string
  private readonly userToken: string
  private sessionToken: string | null = null

  constructor(baseUrl: string, appToken: string, userToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.appToken = appToken
    this.userToken = userToken
  }

  private commonHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.appToken) headers['App-Token'] = this.appToken
    return headers
  }

  private sessionHeaders(): Record<string, string> {
    if (!this.sessionToken) throw new Error('GlpiClient: sessão não iniciada')
    return { ...this.commonHeaders(), 'Session-Token': this.sessionToken }
  }

  async initSession(): Promise<void> {
    const url = `${this.baseUrl}/initSession/?user_token=${this.userToken}`
    console.log('[GLPI] initSession →', url)
    const res = await fetch(url, { headers: this.commonHeaders() })
    console.log('[GLPI] initSession status:', res.status)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GLPI initSession falhou (${res.status}): ${body}`)
    }
    const data = (await res.json()) as { session_token: string }
    this.sessionToken = data.session_token
    console.log('[GLPI] sessão iniciada:', this.sessionToken)
  }

  async killSession(): Promise<void> {
    if (!this.sessionToken) return
    console.log('[GLPI] killSession')
    try {
      await fetch(`${this.baseUrl}/killSession`, { headers: this.sessionHeaders() })
    } finally {
      this.sessionToken = null
    }
  }

  async listTickets(status?: number): Promise<GlpiTicket[]> {
    const params = new URLSearchParams({ range: '0-49', sort: '15', order: 'DESC' })
    console.log('[GLPI] listTickets status filter:', status)

    params.set('criteria[0][field]', '65')
    params.set('criteria[0][searchtype]', 'contains')
    params.set('criteria[0][value]', OBSERVER_GROUP_FILTER)

    if (status !== undefined) {
      params.set('criteria[1][field]', '12')
      params.set('criteria[1][searchtype]', 'equals')
      params.set('criteria[1][value]', String(status))
    }

    // forcedisplay: 2=ID, 1=Name, 5=Técnico, 8=Grupo técnico, 12=Status, 3=Prioridade, 15=Date, 21=Description
    const displayFields = ['2', '1', '5', '8', '65', '12', '3', '15', '21']
    displayFields.forEach((field, i) => params.set(`forcedisplay[${i}]`, field))

    const searchUrl = `${this.baseUrl}/search/Ticket?${params.toString()}`
    console.log('[GLPI] listTickets URL:', searchUrl)
    const res = await fetch(searchUrl, { headers: this.sessionHeaders() })
    console.log('[GLPI] listTickets status:', res.status)
    if (!res.ok) {
      const body = await res.text()
      console.log('[GLPI] listTickets erro body:', body)
      throw new Error(`GLPI listTickets falhou (${res.status}): ${body}`)
    }

    const data = (await res.json()) as { data?: GlpiTicketRaw[] }
    const tickets = (data.data ?? [])
      .map(mapTicket)
      .filter((ticket) => ticket.observerGroup.toLowerCase().includes(OBSERVER_GROUP_FILTER.toLowerCase()))
    console.log('[GLPI] listTickets retornou', tickets.length, 'tickets')
    return tickets
  }

  async getTicket(id: number): Promise<GlpiTicket | null> {
    const res = await fetch(`${this.baseUrl}/Ticket/${id}`, { headers: this.sessionHeaders() })
    if (res.status === 404) return null
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GLPI getTicket falhou (${res.status}): ${body}`)
    }
    const raw = (await res.json()) as GlpiTicketRaw
    return mapTicket(raw)
  }

  async fetchAsset(src: string): Promise<{ contentType: string; body: ArrayBuffer }> {
    const assetUrl = resolveAssetUrl(this.baseUrl, src)
    const res = await fetch(assetUrl, { headers: this.sessionHeaders() })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GLPI fetchAsset falhou (${res.status}): ${body}`)
    }
    return {
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body: await res.arrayBuffer(),
    }
  }

  async addFollowup(ticketId: number, content: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/ITILFollowup`, {
      method: 'POST',
      headers: this.sessionHeaders(),
      body: JSON.stringify({ input: { itemtype: 'Ticket', items_id: ticketId, content } }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GLPI addFollowup falhou (${res.status}): ${body}`)
    }
  }
}

function mapTicket(r: GlpiTicketRaw): GlpiTicket {
  const statusNum = Number(r['12'] ?? r.status ?? 1)
  const priorityNum = Number(r['3'] ?? r.priority ?? 3)
  const technician = normalizeAssignment(r['5'])
  const technicalGroup = normalizeAssignment(r['8'])
  const observerGroup = String(r['65'] ?? '').trim()
  const assignedTo = [technicalGroup, technician].filter(Boolean).join(' · ') || 'Sem atribuição'

  return {
    id: Number(r['2'] ?? r.id ?? 0),
    name: String(r['1'] ?? r.name ?? ''),
    status: statusNum,
    statusLabel: STATUS_LABELS[statusNum] ?? `Status ${statusNum}`,
    priority: priorityNum,
    priorityLabel: PRIORITY_LABELS[priorityNum] ?? `Prioridade ${priorityNum}`,
    date: String(r['15'] ?? r.date ?? ''),
    solvedate: r.solvedate != null ? String(r.solvedate) : null,
    content: String(r['21'] ?? r.content ?? ''),
    assignedTo,
    observerGroup,
  }
}

function normalizeAssignment(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  if (/^\d+$/.test(raw)) {
    return `Técnico #${raw}`
  }

  return raw
}

function resolveAssetUrl(baseUrl: string, src: string): string {
  const raw = String(src ?? '').trim()
  if (!raw) throw new Error('src inválido')

  if (/^data:/i.test(raw)) {
    throw new Error('data URI não deve ser solicitado via proxy')
  }

  const origin = new URL(baseUrl).origin

  try {
    const parsed = new URL(raw, origin)
    if (parsed.origin !== origin) {
      throw new Error('origem externa não permitida')
    }
    return parsed.toString()
  } catch {
    const path = raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`
    return `${origin}${path}`
  }
}

export async function withGlpiSession<T>(
  client: GlpiClient,
  fn: (client: GlpiClient) => Promise<T>
): Promise<T> {
  await client.initSession()
  try {
    return await fn(client)
  } finally {
    await client.killSession()
  }
}
