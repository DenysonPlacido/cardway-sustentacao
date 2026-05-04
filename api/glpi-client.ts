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
    return { 'App-Token': this.appToken, 'Content-Type': 'application/json' }
  }

  private sessionHeaders(): Record<string, string> {
    if (!this.sessionToken) throw new Error('GlpiClient: sessão não iniciada')
    return { ...this.commonHeaders(), 'Session-Token': this.sessionToken }
  }

  async initSession(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/initSession`, {
      headers: { ...this.commonHeaders(), Authorization: `user_token ${this.userToken}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GLPI initSession falhou (${res.status}): ${body}`)
    }
    const data = (await res.json()) as { session_token: string }
    this.sessionToken = data.session_token
  }

  async killSession(): Promise<void> {
    if (!this.sessionToken) return
    try {
      await fetch(`${this.baseUrl}/killSession`, { headers: this.sessionHeaders() })
    } finally {
      this.sessionToken = null
    }
  }

  async listTickets(status?: number): Promise<GlpiTicket[]> {
    const params = new URLSearchParams({ range: '0-49', sort: '15', order: 'DESC' })

    if (status !== undefined) {
      params.set('criteria[0][field]', '12')
      params.set('criteria[0][searchtype]', 'equals')
      params.set('criteria[0][value]', String(status))
    }

    // forcedisplay: 2=ID, 1=Name, 12=Status, 7=Priority, 15=Date, 21=Description
    const displayFields = ['2', '1', '12', '7', '15', '21']
    displayFields.forEach((field, i) => params.set(`forcedisplay[${i}]`, field))

    const res = await fetch(`${this.baseUrl}/search/Ticket?${params.toString()}`, {
      headers: this.sessionHeaders(),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GLPI listTickets falhou (${res.status}): ${body}`)
    }

    const data = (await res.json()) as { data?: GlpiTicketRaw[] }
    return (data.data ?? []).map(mapTicket)
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
  const priorityNum = Number(r['7'] ?? r.priority ?? 3)
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
