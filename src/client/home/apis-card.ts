interface ApiEnv {
  url: string | null
  label?: string
}

interface ApiService {
  name: string
  dev: ApiEnv
  hml: ApiEnv
  prod: ApiEnv
}

const SERVICES: ApiService[] = [
  {
    name: 'Distribuição',
    dev: { url: null },
    hml: { url: null, label: 'api-cobranca' },
    prod: { url: 'https://api.integrati.cloud/distribuicao/', label: 'api-distribuicao' },
  },
  {
    name: 'Logística',
    dev: { url: null },
    hml: { url: null },
    prod: { url: 'https://api.integrati.cloud/logistica/docs/' },
  },
  {
    name: 'Cobrança',
    dev: { url: null },
    hml: { url: null, label: 'api-cobranca' },
    prod: { url: null, label: 'API Cobrança' },
  },
  {
    name: 'Pedido',
    dev: { url: null, label: 'API-Pedido DEV' },
    hml: { url: null, label: 'API-Pedido HML' },
    prod: { url: null, label: 'API-Pedido PROD' },
  },
  {
    name: 'Fusio',
    dev: { url: null },
    hml: { url: null, label: 'Sandbox' },
    prod: { url: null, label: 'HUB' },
  },
  {
    name: 'Relatório',
    dev: { url: null },
    hml: { url: null },
    prod: { url: 'https://api.integrati.cloud/relatorio/docs/' },
  },
  {
    name: 'FAM',
    dev: { url: null },
    hml: { url: null },
    prod: { url: 'https://api.integrati.cloud/fam/docs/' },
  },
]

function makeEnvCell(env: ApiEnv, tag: 'DEV' | 'HML' | 'PROD'): HTMLTableCellElement {
  const td = document.createElement('td')
  const cls = tag === 'DEV' ? 'ac-badge-dev' : tag === 'HML' ? 'ac-badge-hml' : 'ac-badge-prod'

  if (env.url) {
    const a = document.createElement('a')
    a.href = env.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.className = `ac-badge ${cls}`
    a.textContent = env.label ?? tag
    a.title = env.url
    td.appendChild(a)
    return td
  }

  if (env.label) {
    const span = document.createElement('span')
    span.className = `ac-badge ${cls} ac-badge--pending`
    span.textContent = env.label
    span.title = 'URL não configurada'
    td.appendChild(span)
    return td
  }

  const span = document.createElement('span')
  span.className = 'ac-dash'
  span.textContent = '—'
  td.appendChild(span)
  return td
}

export function initApisCardTool(): void {
  const tbody = document.getElementById('acTableBody')
  if (!tbody) return

  SERVICES.forEach((svc) => {
    const tr = document.createElement('tr')

    const nameTd = document.createElement('td')
    nameTd.className = 'ac-service-name'
    nameTd.textContent = svc.name
    tr.appendChild(nameTd)

    tr.appendChild(makeEnvCell(svc.dev, 'DEV'))
    tr.appendChild(makeEnvCell(svc.hml, 'HML'))
    tr.appendChild(makeEnvCell(svc.prod, 'PROD'))

    tbody.appendChild(tr)
  })
}
