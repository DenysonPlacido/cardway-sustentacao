import { copyText } from './shared'

type ValueMode = 'auto' | 'string' | 'number'
type ClauseMode = 'in' | 'not-in' | 'any' | 'all'
type DetectedMode = 'string' | 'number'

interface Stats {
  total: number
  unique: number
  duplicates: number
  detected: DetectedMode | null
  effectiveMode: DetectedMode | null
  chunks: number
}

const NUMBER_PATTERN = /^-?(?:\d+|\d{1,3}(?:[._ ]\d{3})+)(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function isNumericValue(value: string): boolean {
  return NUMBER_PATTERN.test(value.replace(/\s+/g, ''))
}

function detectMode(values: string[]): DetectedMode | null {
  if (!values.length) return null
  return values.every((value) => isNumericValue(value)) ? 'number' : 'string'
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function normalizeNumeric(value: string): string {
  return value.replace(/\s+/g, '').replace(/_/g, '').replace(',', '.')
}

function formatLiteral(value: string, mode: DetectedMode): string {
  if (mode === 'string') return escapeSqlString(value)
  return normalizeNumeric(value)
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }

  return out
}

function sortValues(values: string[], mode: DetectedMode): string[] {
  const sorted = [...values]
  if (mode === 'number') {
    return sorted.sort((a, b) => {
      const diff = Number(normalizeNumeric(a)) - Number(normalizeNumeric(b))
      if (Number.isFinite(diff) && diff !== 0) return diff
      return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
    })
  }

  return sorted.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }))
}

function chunkValues(values: string[], blockSize: number): string[][] {
  const chunks: string[][] = []
  const safeBlockSize = Math.max(1, Math.floor(blockSize) || 1)

  for (let i = 0; i < values.length; i += safeBlockSize) {
    chunks.push(values.slice(i, i + safeBlockSize))
  }

  return chunks
}

function buildChunkExpression(column: string, values: string[], clause: ClauseMode, mode: DetectedMode): string {
  const formatted = values.map((value) => formatLiteral(value, mode)).join(', ')

  if (clause === 'any') {
    return `${column} = ANY(ARRAY[${formatted}])`
  }

  if (clause === 'all') {
    return `${column} <> ALL(ARRAY[${formatted}])`
  }

  const operator = clause === 'not-in' ? 'NOT IN' : 'IN'
  return `${column} ${operator} (${formatted})`
}

function buildSql(
  column: string,
  table: string,
  values: string[],
  clause: ClauseMode,
  mode: DetectedMode,
  blockSize: number,
  completeSelect: boolean
): string {
  if (!values.length) return ''

  if (clause === 'any' || clause === 'all') {
    const expression = buildChunkExpression(column, values, clause, mode)
    return completeSelect ? `SELECT * FROM ${table} WHERE ${expression};` : expression
  }

  const chunks = chunkValues(values, blockSize)
  const connector = clause === 'not-in' ? 'AND' : 'OR'
  const expressions = chunks.map((chunk) => buildChunkExpression(column, chunk, clause, mode))

  if (!completeSelect) {
    return expressions.length === 1
      ? expressions[0]
      : expressions.map((expr) => `(${expr})`).join(` ${connector}\n`)
  }

  const where = expressions.length === 1
    ? expressions[0]
    : expressions.map((expr) => `(${expr})`).join(` ${connector}\n  `)

  return `SELECT * FROM ${table} WHERE ${expressions.length === 1 ? where : `\n  ${where}`};`
}

function calculateStats(rawValues: string[], mode: ValueMode, blockSize: number, clause: ClauseMode): Stats {
  const total = rawValues.length
  const unique = new Set(rawValues).size
  const duplicates = Math.max(0, total - unique)
  const detected = detectMode(rawValues)
  const effectiveMode = mode === 'auto' ? detected : mode
  const chunks = total === 0
    ? 0
    : clause === 'any' || clause === 'all'
      ? 1
      : Math.max(1, Math.ceil(total / Math.max(1, Math.floor(blockSize) || 1)))

  return { total, unique, duplicates, detected, effectiveMode, chunks }
}

function renderStatValue(value: number | string | null): string {
  if (value === null) return '—'
  if (typeof value === 'number') return String(value)
  return value
}

function setResultSummary(
  summaryEl: HTMLSpanElement,
  stats: Stats,
  mode: ValueMode,
  clause: ClauseMode,
  dedupe: boolean,
  sort: boolean,
  completeSelect: boolean
): void {
  const modeLabel = stats.effectiveMode === 'number' ? 'Numérico' : stats.effectiveMode === 'string' ? 'Texto' : '—'
  const detectedLabel = stats.detected === 'number' ? 'Número' : stats.detected === 'string' ? 'Texto' : '—'
  const clauseLabel = {
    in: 'IN',
    'not-in': 'NOT IN',
    any: '= ANY(ARRAY[])',
    all: '<> ALL(ARRAY[])',
  }[clause]

  summaryEl.textContent = [
    `${stats.total} total`,
    `${stats.unique} únicos`,
    `${stats.duplicates} duplicados`,
    `modo ${mode === 'auto' ? `auto (${detectedLabel})` : modeLabel}`,
    `cláusula ${clauseLabel}`,
    `${stats.chunks} bloco${stats.chunks === 1 ? '' : 's'}`,
    dedupe ? 'dedupe ativo' : 'dedupe desligado',
    sort ? 'ordem ativa' : 'ordem original',
    completeSelect ? 'SELECT completo' : 'cláusula simples',
  ].join(' · ')
}

function setStat(el: HTMLElement | null, value: number | string | null): void {
  if (!el) return
  el.textContent = renderStatValue(value)
}

export function initConcatenadorTool(): void {
  const col = document.getElementById('concatColumn') as HTMLInputElement
  const tbl = document.getElementById('concatTable') as HTMLInputElement
  const vals = document.getElementById('concatValues') as HTMLTextAreaElement
  const result = document.getElementById('concatResult') as HTMLDivElement
  const pre = document.getElementById('concatResultPre') as HTMLPreElement
  const summary = document.getElementById('concatResultCount') as HTMLSpanElement
  const modeInfo = document.getElementById('concatModeInfo') as HTMLSpanElement
  const totalStat = document.getElementById('concatTotalStat')
  const uniqueStat = document.getElementById('concatUniqueStat')
  const dupStat = document.getElementById('concatDuplicateStat')
  const typeStat = document.getElementById('concatTypeStat')
  const blockStat = document.getElementById('concatBlocksStat')
  const clauseSelect = document.getElementById('concatClause') as HTMLSelectElement
  const blockSize = document.getElementById('concatBlockSize') as HTMLInputElement
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-concat-mode]'))
  const dedupeToggle = document.getElementById('concatDedupe') as HTMLInputElement
  const sortToggle = document.getElementById('concatSort') as HTMLInputElement
  const selectToggle = document.getElementById('concatFullSelect') as HTMLInputElement

  let currentMode: ValueMode = 'auto'

  function getInputs(): string[] {
    return splitLines(vals.value)
  }

  function readBlockSize(): number {
    const parsed = Number.parseInt(blockSize.value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
  }

  function updateModeButtons(): void {
    modeButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.concatMode === currentMode)
    })
  }

  function showIssue(message: string): void {
    summary.textContent = message
    pre.textContent = ''
    result.classList.remove('hidden')
  }

  function updateStats(): void {
    const rawValues = getInputs()
    const stats = calculateStats(rawValues, currentMode, readBlockSize(), clauseSelect.value as ClauseMode)

    setStat(totalStat, stats.total)
    setStat(uniqueStat, stats.unique)
    setStat(dupStat, stats.duplicates)
    setStat(typeStat, stats.detected ? (stats.detected === 'number' ? 'Número' : 'Texto') : '—')
    setStat(blockStat, stats.chunks)

    const detectedLabel = stats.detected === 'number' ? 'Número' : stats.detected === 'string' ? 'Texto' : '—'
    const effectiveLabel = stats.effectiveMode === 'number' ? 'Numérico' : stats.effectiveMode === 'string' ? 'Texto' : '—'
    modeInfo.textContent = currentMode === 'auto'
      ? `Detectado: ${detectedLabel} · execução: ${effectiveLabel}`
      : `Modo manual: ${effectiveLabel}`
  }

  function run(requestedMode: ValueMode = currentMode): void {
    const column = col.value.trim()
    const table = tbl.value.trim()
    const rawValues = getInputs()

    if (!column) {
      showIssue('Informe o nome da coluna para gerar o SQL.')
      return
    }
    if (!rawValues.length) {
      showIssue('Cole ao menos um valor para gerar o SQL.')
      return
    }

    const detected = detectMode(rawValues)
    const effectiveMode = requestedMode === 'auto' ? detected : requestedMode

    if (!effectiveMode) {
      showIssue('Não foi possível detectar o tipo dos valores.')
      return
    }

    if (selectToggle.checked && !table) {
      showIssue('Informe o nome da tabela para gerar o SELECT completo.')
      return
    }

    if (effectiveMode === 'number') {
      const invalid = rawValues.filter((value) => !isNumericValue(value))
      if (invalid.length > 0) {
        showIssue(`Foram encontrados valores não numéricos: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '...' : ''}`)
        return
      }
    }

    const block = readBlockSize()
    const prepared = dedupeToggle.checked ? dedupePreserveOrder(rawValues) : [...rawValues]
    const ordered = sortToggle.checked ? sortValues(prepared, effectiveMode) : prepared
    const sql = buildSql(column, table, ordered, clauseSelect.value as ClauseMode, effectiveMode, block, selectToggle.checked)
    const stats = calculateStats(rawValues, requestedMode, block, clauseSelect.value as ClauseMode)

    pre.textContent = sql
    setResultSummary(summary, stats, requestedMode, clauseSelect.value as ClauseMode, dedupeToggle.checked, sortToggle.checked, selectToggle.checked)
    result.classList.remove('hidden')
  }

  function clearAll(): void {
    col.value = ''
    tbl.value = ''
    vals.value = ''
    blockSize.value = '1000'
    clauseSelect.value = 'in'
    dedupeToggle.checked = true
    sortToggle.checked = false
    selectToggle.checked = false
    currentMode = 'auto'
    updateModeButtons()
    updateStats()
    result.classList.add('hidden')
    pre.textContent = ''
    summary.textContent = 'Pronto para gerar'
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      currentMode = button.dataset.concatMode as ValueMode
      updateModeButtons()
      updateStats()
      if (getInputs().length) run(currentMode)
    })
  })

  const refreshListeners = [vals, clauseSelect, blockSize, dedupeToggle, sortToggle, selectToggle, col, tbl]
  refreshListeners.forEach((el) => {
    el.addEventListener('input', updateStats)
    el.addEventListener('change', updateStats)
  })

  document.getElementById('concatBtnString')?.addEventListener('click', () => run('string'))
  document.getElementById('concatBtnNumber')?.addEventListener('click', () => run('number'))
  document.getElementById('concatBtnAuto')?.addEventListener('click', () => run('auto'))
  document.getElementById('concatClearBtn')?.addEventListener('click', clearAll)
  document.getElementById('concatCopyBtn')?.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('concatCopyBtn') as HTMLButtonElement)
  )
  document.getElementById('concatGenerateBtn')?.addEventListener('click', () => run())

  updateModeButtons()
  updateStats()
}
