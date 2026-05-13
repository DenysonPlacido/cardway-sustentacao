import { copyText } from './shared'

interface WebResult {
  source: string
  file: string
  url: string
  lines: string[]
}

export function initLogWebTool(): void {
  const termEl = document.getElementById('webLogTerm') as HTMLInputElement
  const dateEl = document.getElementById('webLogDate') as HTMLInputElement
  const hourEl = document.getElementById('webLogHour') as HTMLInputElement
  const statusEl = document.getElementById('webLogStatus') as HTMLDivElement
  const resultsEl = document.getElementById('webLogResults') as HTMLDivElement
  const searchBtn = document.getElementById('webLogSearchBtn') as HTMLButtonElement
  const stopBtn = document.getElementById('webLogStopBtn') as HTMLButtonElement
  const clearBtn = document.getElementById('webLogClearBtn') as HTMLButtonElement
  const downloadBtn = document.getElementById('webLogDownloadBtn') as HTMLButtonElement

  const collectedResults: WebResult[] = []
  let activeEs: EventSource | null = null

  function setSearching(on: boolean): void {
    searchBtn.hidden = on
    stopBtn.hidden = !on
    searchBtn.disabled = on
  }

  function setStatus(msg: string, type: 'info' | 'error' = 'info', showDownload = false): void {
    statusEl.innerHTML = ''
    statusEl.className = `log-status ${type}`
    statusEl.hidden = !msg
    const text = document.createElement('span')
    text.textContent = msg
    statusEl.appendChild(text)
    downloadBtn.hidden = !showDownload
  }

  function downloadResultTxt(r: WebResult): void {
    const content = `===== ${r.source} | ${r.file} =====\n${r.lines.join('\n')}`
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = r.source.replace(/[/\\]/g, '-')
    a.download = `log-${safeName}-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function renderResult(r: WebResult): void {
    const card = document.createElement('div')
    card.className = 'log-result-card'

    const header = document.createElement('div')
    header.className = 'log-result-header'

    const title = document.createElement('span')
    title.className = 'log-result-id'
    title.textContent = r.source
    header.appendChild(title)

    if (r.url) {
      const link = document.createElement('a')
      link.href = r.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.className = 'log-result-link'
      link.textContent = r.file
      header.appendChild(link)
    }

    if (r.lines.length) {
      const dlBtn = document.createElement('button')
      dlBtn.className = 'btn-card-download'
      dlBtn.title = 'Baixar TXT desta instância'
      dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> TXT`
      dlBtn.addEventListener('click', () => downloadResultTxt(r))
      header.appendChild(dlBtn)
    }

    card.appendChild(header)

    if (!r.lines.length) {
      const msg = document.createElement('p')
      msg.className = 'log-result-msg'
      msg.textContent = 'Nenhuma linha encontrada.'
      card.appendChild(msg)
    } else {
      const pre = document.createElement('pre')
      pre.className = 'log-result-pre'
      pre.textContent = r.lines.join('\n')

      const copyBtn = document.createElement('button')
      copyBtn.className = 'btn-copy'
      copyBtn.textContent = 'Copiar'
      copyBtn.addEventListener('click', () => copyText(pre.textContent ?? '', copyBtn))

      const wrap = document.createElement('div')
      wrap.className = 'log-result-pre-wrap'
      wrap.appendChild(pre)
      wrap.appendChild(copyBtn)
      card.appendChild(wrap)
    }

    resultsEl.appendChild(card)
  }

  function buildTxt(): string {
    return collectedResults.map((r) => {
      const header = `===== ${r.source} | ${r.file} =====`
      const body = r.lines.length ? r.lines.join('\n') : 'Nenhuma linha encontrada.'
      return `${header}\n${body}`
    }).join('\n\n')
  }

  function downloadTxt(): void {
    const blob = new Blob([buildTxt()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-web-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function clearResults(): void {
    resultsEl.innerHTML = ''
    statusEl.hidden = true
    downloadBtn.hidden = true
    collectedResults.length = 0
  }

  function getSelectedServers(): string {
    const boxes = document.querySelectorAll<HTMLInputElement>('input[name="webServer"]:checked')
    return Array.from(boxes).map((b) => b.value).join(',')
  }

  searchBtn.addEventListener('click', async () => {
    const term = termEl.value.trim()
    const date = dateEl.value.trim()
    const hour = hourEl.value.trim()
    const servers = getSelectedServers()

    if (!term || !date) {
      setStatus('Preencha o termo de busca e a data.', 'error')
      return
    }
    if (!servers) {
      setStatus('Selecione ao menos um servidor.', 'error')
      return
    }

    clearResults()
    setSearching(true)
    setStatus('Iniciando busca...', 'info', false)

    const params = new URLSearchParams({ term, date, servers })
    if (hour) params.set('hour', hour)
    const url = `/api/logs/web/buscar?${params.toString()}`

    try {
      const es = new EventSource(url)
      activeEs = es

      es.addEventListener('status', (e: MessageEvent) => {
        const d = JSON.parse(e.data) as { msg: string }
        setStatus(d.msg)
      })

      es.addEventListener('result', (e: MessageEvent) => {
        const d = JSON.parse(e.data) as WebResult
        collectedResults.push(d)
        renderResult(d)
      })

      es.addEventListener('done', (e: MessageEvent) => {
        const d = JSON.parse(e.data) as { msg: string }
        setStatus(d.msg, 'info', collectedResults.length > 0)
        es.close()
        activeEs = null
        setSearching(false)
      })

      es.addEventListener('error', (e: MessageEvent) => {
        const d = JSON.parse(e.data ?? '{}') as { msg?: string }
        setStatus(d.msg ?? 'Erro na busca', 'error')
        es.close()
        activeEs = null
        setSearching(false)
      })

      es.onerror = () => {
        es.close()
        activeEs = null
        setSearching(false)
      }
    } catch (err) {
      setStatus(`Erro: ${err instanceof Error ? err.message : String(err)}`, 'error')
      activeEs = null
      setSearching(false)
    }
  })

  stopBtn.addEventListener('click', () => {
    if (activeEs) {
      activeEs.close()
      activeEs = null
    }
    setSearching(false)
    const partial = collectedResults.length
    setStatus(
      `Busca interrompida. ${partial} resultado(s) coletado(s).`,
      'info',
      partial > 0
    )
  })

  clearBtn.addEventListener('click', () => {
    if (activeEs) { activeEs.close(); activeEs = null }
    termEl.value = ''
    dateEl.value = ''
    hourEl.value = ''
    setSearching(false)
    clearResults()
  })

  downloadBtn.addEventListener('click', downloadTxt)
}
