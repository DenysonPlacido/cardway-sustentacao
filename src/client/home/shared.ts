export interface GlpiTicket {
  id: number
  name: string
  statusLabel: string
  priority: number
  priorityLabel: string
  date: string
  content: string
  assignedTo: string
  observerGroup?: string
}

export interface AiAnalysis {
  analise: string
  tipo: 'PADRONIZADO' | 'COMPLEXO'
  confianca: number
  acao_sugerida: string
  risco: 'BAIXO' | 'MEDIO' | 'ALTO'
}

export const PRIORITY_CLASS: Record<number, string> = {
  1: 'priority-low', 2: 'priority-low',
  3: 'priority-medium',
  4: 'priority-high', 5: 'priority-high', 6: 'priority-urgent',
}

export type TicketDrawerMode = 'view' | 'reply' | 'edit'
const GLPI_ASSET_PROXY = '/api/automacao/glpi-asset?src='

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function formatGlpiDate(raw: string): string {
  if (!raw) return 'â€”'
  const d = new Date(raw.replace(' ', 'T'))
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function decodeHtmlEntities(raw: string): string {
  const holder = document.createElement('textarea')
  holder.innerHTML = raw
  return holder.value || holder.textContent || raw
}

function sanitizeUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('mailto:')) return value
  if (/^https?:\/\//i.test(value)) return value
  if (/^data:image\//i.test(value)) return value
  return null
}

function proxyTicketAssetUrl(raw: string): string {
  return `${GLPI_ASSET_PROXY}${encodeURIComponent(raw)}`
}

function rewriteGlpiAssetUrls(raw: string): string {
  return raw.replace(/(?:https?:\/\/[^"'<>\s]+)?\/?front\/document\.send\.php\?[^"'<>\s]+/gi, (match) => {
    const path = match.replace(/^https?:\/\/[^/]+/i, '')
    return proxyTicketAssetUrl(path)
  })
}

export function normalizeTicketContent(raw: string): string {
  if (!raw) return 'â€”'
  const decoded = decodeHtmlEntities(raw).trim()
  if (!decoded) return 'â€”'

  const holder = document.createElement('div')
  holder.innerHTML = decoded
  return (holder.innerText || holder.textContent || '').replace(/\s+/g, ' ').trim() || 'â€”'
}

export function renderTicketHtml(raw: string): string {
  if (!raw) return '<p>â€”</p>'

  const decoded = decodeHtmlEntities(raw).trim()
  if (!decoded) return '<p>â€”</p>'
  const rewritten = rewriteGlpiAssetUrls(decoded)

  const parser = new DOMParser()
  const doc = parser.parseFromString(rewritten, 'text/html')
  const allowed = new Set(['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'pre', 'code', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'img'])
  const blockTags = new Set(['p', 'div', 'ul', 'ol', 'pre', 'blockquote', 'table'])

  const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent ?? '')
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }

    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    const children = Array.from(el.childNodes).map(walk).join('')

    if (!allowed.has(tag)) {
      return children
    }

    if (tag === 'br') return '<br />'
    if (tag === 'hr') return '<hr />'

    if (tag === 'a') {
      const hrefRaw = el.getAttribute('href') ?? ''
      const href = sanitizeUrl(hrefRaw)
      if (!href) return children || escapeHtml(el.textContent ?? '')
      const finalHref = /front\/document\.send\.php/i.test(hrefRaw) ? proxyTicketAssetUrl(hrefRaw) : href
      return `<a href="${escapeAttr(finalHref)}" target="_blank" rel="noreferrer noopener">${children || escapeHtml(href)}</a>`
    }

    if (tag === 'img') {
      const srcRaw = el.getAttribute('src') ?? ''
      const src = sanitizeUrl(srcRaw)
      if (!src) return ''
      if (/^data:image\//i.test(src)) {
        const alt = escapeAttr(el.getAttribute('alt') ?? 'Imagem')
        return `<img class="ticket-inline-image" src="${escapeAttr(src)}" alt="${alt}" />`
      }
      const alt = escapeAttr(el.getAttribute('alt') ?? 'Imagem')
      const finalSrc = /front\/document\.send\.php/i.test(srcRaw) ? proxyTicketAssetUrl(srcRaw) : proxyTicketAssetUrl(src)
      return `<img class="ticket-inline-image" src="${escapeAttr(finalSrc)}" alt="${alt}" />`
    }

    const attrs: string[] = []
    if (tag === 'table') attrs.push('class="ticket-html-table"')
    if (tag === 'pre') attrs.push('class="ticket-html-pre"')
    if (tag === 'blockquote') attrs.push('class="ticket-html-quote"')

    const inner = children || (blockTags.has(tag) ? '&nbsp;' : '')
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner}</${tag}>`
  }

  const body = Array.from(doc.body.childNodes).map(walk).join('').trim()
  return body || '<p>â€”</p>'
}

export function truncateText(raw: string, maxLength = 180): string {
  const text = normalizeTicketContent(raw)
  if (text === 'â€”' || text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}â€¦`
}

export async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    const orig = btn.textContent
    btn.textContent = 'Copiado!'
    setTimeout(() => { btn.textContent = orig }, 1500)
  } catch {
    btn.textContent = 'Erro'
  }
}
