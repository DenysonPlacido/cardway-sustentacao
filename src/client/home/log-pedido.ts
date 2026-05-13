import { copyText } from './shared'

interface PedidoInput {
  id: number
  data_alteracao: string
}

interface ResultEvent {
  id: number
  pod?: string
  file?: string
  url?: string
  lines: string[]
  error?: string
}

// Parseia o output do SQL*Plus:
//     369289 07/04/26 14:28:06 api-backoffice
// Também aceita colunas separadas por tabulação ou múltiplos espaços.
function parseSqlOutput(raw: string): PedidoInput[] {
  const pedidos: PedidoInput[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || /^[-\s]+$/.test(trimmed) || /^ID\s/i.test(trimmed)) continue
    // Captura: número + data DD/MM/YY + hora HH:MM:SS
    const m = trimmed.match(/(\d+)\s+([\d]{2}\/[\d]{2}\/[\d]{2,4})\s+([\d]{2}:[\d]{2}:[\d]{2})/)
    if (m) {
      pedidos.push({ id: Number(m[1]), data_alteracao: `${m[2]} ${m[3]}` })
    }
  }
  return pedidos
}

export function initLogPedidoTool(): void {
  const serviceEl = document.getElementById('logService') as HTMLSelectElement
  const inputArea = document.getElementById('logInput') as HTMLTextAreaElement
  const statusEl = document.getElementById('logStatus') as HTMLDivElement
  const resultsEl = document.getElementById('logResults') as HTMLDivElement
  const searchBtn = document.getElementById('logSearchBtn') as HTMLButtonElement
  const clearBtn = document.getElementById('logClearBtn') as HTMLButtonElement
  const downloadBtn = document.getElementById('logDownloadBtn') as HTMLButtonElement

  const collectedResults: ResultEvent[] = []

  function setStatus(msg: string, type: 'info' | 'error' = 'info', showDownload = false): void {
    statusEl.innerHTML = ''
    statusEl.className = `log-status ${type}`
    statusEl.hidden = !msg

    const text = document.createElement('span')
    text.textContent = msg
    statusEl.appendChild(text)

    downloadBtn.hidden = !showDownload
  }

  function renderResult(r: ResultEvent): void {
    const card = document.createElement('div')
    card.className = `log-result-card ${r.error ? 'log-result-error' : ''}`

    const header = document.createElement('div')
    header.className = 'log-result-header'

    const title = document.createElement('span')
    title.className = 'log-result-id'
    title.textContent = `Pedido ${r.id}`
    header.appendChild(title)

    if (r.url) {
      const link = document.createElement('a')
      link.href = r.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.className = 'log-result-link'
      link.textContent = r.file ?? ''
      header.appendChild(link)
    }

    card.appendChild(header)

    if (r.error) {
      const msg = document.createElement('p')
      msg.className = 'log-result-msg'
      msg.textContent = r.error
      card.appendChild(msg)
    } else if (!r.lines.length) {
      const msg = document.createElement('p')
      msg.className = 'log-result-msg'
      msg.textContent = 'Nenhuma linha encontrada no arquivo.'
      card.appendChild(msg)
    } else {
      const pre = document.createElement('pre')
      pre.className = 'log-result-pre'
      pre.textContent = r.lines.join('\n')

      const copyBtn = document.createElement('button')
      copyBtn.className = 'btn-copy'
      copyBtn.textContent = 'Copiar'
      copyBtn.addEventListener('click', () => copyText(pre.textContent ?? '', copyBtn))

      const preWrapper = document.createElement('div')
      preWrapper.className = 'log-result-pre-wrap'
      preWrapper.appendChild(pre)
      preWrapper.appendChild(copyBtn)
      card.appendChild(preWrapper)
    }

    resultsEl.appendChild(card)
  }

  function buildTxtContent(): string {
    return collectedResults.map((r) => {
      const header = `===== Pedido ${r.id}${r.file ? ` | ${r.file}` : ''} =====`
      const body = r.error
        ? `ERRO: ${r.error}`
        : r.lines.length ? r.lines.join('\n') : 'Nenhuma linha encontrada.'
      return `${header}\n${body}`
    }).join('\n\n')
  }

  function downloadTxt(): void {
    const content = buildTxtContent()
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-pedidos-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function clearResults(): void {
    resultsEl.innerHTML = ''
    statusEl.hidden = true
    downloadBtn.hidden = true
    collectedResults.length = 0
  }

  searchBtn.addEventListener('click', async () => {
    const raw = inputArea.value.trim()
    if (!raw) return

    const pedidos = parseSqlOutput(raw)
    if (!pedidos.length) {
      setStatus('Nenhum pedido reconhecido. Cole o resultado do SELECT com ID e DATA_ALTERACAO.', 'error')
      return
    }

    clearResults()
    searchBtn.disabled = true
    setStatus(`Iniciando busca de ${pedidos.length} pedido(s)...`, 'info', false)

    const service = serviceEl.value
    const url = `/api/logs/buscar-pedidos?service=${encodeURIComponent(service)}&pedidos=${encodeURIComponent(JSON.stringify(pedidos))}`

    try {
      const es = new EventSource(url)

      es.addEventListener('status', (e: MessageEvent) => {
        const d = JSON.parse(e.data) as { msg: string }
        setStatus(d.msg)
      })

      es.addEventListener('result', (e: MessageEvent) => {
        const d = JSON.parse(e.data) as ResultEvent
        collectedResults.push(d)
        renderResult(d)
      })

      es.addEventListener('done', (e: MessageEvent) => {
        const d = JSON.parse(e.data) as { msg: string }
        setStatus(d.msg, 'info', collectedResults.length > 0)
        es.close()
        searchBtn.disabled = false
      })

      es.addEventListener('error', (e: MessageEvent) => {
        const d = JSON.parse(e.data ?? '{}') as { msg?: string }
        setStatus(d.msg ?? 'Erro na busca', 'error')
        es.close()
        searchBtn.disabled = false
      })

      es.onerror = () => {
        // EventSource fecha ao terminar o stream (res.end) — não é necessariamente erro
        es.close()
        searchBtn.disabled = false
      }
    } catch (err) {
      setStatus(`Erro: ${err instanceof Error ? err.message : String(err)}`, 'error')
      searchBtn.disabled = false
    }
  })

  clearBtn.addEventListener('click', () => {
    inputArea.value = ''
    clearResults()
  })

  downloadBtn.addEventListener('click', downloadTxt)
}
