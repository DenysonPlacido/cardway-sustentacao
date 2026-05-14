import { copyText } from './shared'

interface ColState {
  wrapper: HTMLDivElement
  textarea: HTMLTextAreaElement
  aliasEl: HTMLInputElement
  tipoEl: HTMLSelectElement
}

let cols: ColState[] = []
let nextId = 0
let container: HTMLDivElement

function fmtVal(raw: string, tipo: string): string {
  return tipo === 'string' ? `'${raw.replace(/'/g, "''")}'` : raw
}

function getLines(c: ColState): string[] {
  return c.textarea.value.split('\n').map((v) => v.trim()).filter(Boolean)
}

function getAlias(c: ColState, idx: number): string {
  return c.aliasEl.value.trim() || `col${idx + 1}`
}

function buildPostgres(cteName: string, active: ColState[]): string {
  const aliases = active.map(getAlias)
  const n = getLines(active[0]).length
  const rows = Array.from({ length: n }, (_, i) =>
    `    (${active.map((c) => fmtVal(getLines(c)[i] ?? '', c.tipoEl.value)).join(', ')})`
  )
  return [
    `WITH ${cteName} AS (`,
    `  SELECT * FROM (VALUES`,
    rows.join(',\n'),
    `  ) AS t(${aliases.join(', ')})`,
    `)`,
    `SELECT * FROM ${cteName};`,
  ].join('\n')
}

function buildOracle(cteName: string, active: ColState[]): string {
  const aliases = active.map(getAlias)
  const n = getLines(active[0]).length
  const selects = Array.from({ length: n }, (_, i) => {
    const vals = active
      .map((c, ci) => `${fmtVal(getLines(c)[i] ?? '', c.tipoEl.value)} AS ${aliases[ci]}`)
      .join(', ')
    return `    SELECT ${vals} FROM DUAL${i < n - 1 ? ' UNION ALL' : ''}`
  })
  return [
    `WITH ${cteName} AS (`,
    `  SELECT ${aliases.join(', ')} FROM (`,
    selects.join('\n'),
    `  )`,
    `)`,
    `SELECT * FROM ${cteName};`,
  ].join('\n')
}

function refreshLabels(): void {
  cols.forEach((c, i) => {
    const lbl = c.wrapper.querySelector<HTMLSpanElement>('.cte-col-label')
    if (lbl) lbl.textContent = `Coluna ${i + 1}`
  })
  cols.forEach((c) => {
    const btn = c.wrapper.querySelector<HTMLButtonElement>('.cte-col-remove')
    if (btn) btn.disabled = cols.length <= 1
  })
}

function addCol(): ColState {
  const id = ++nextId
  const wrapper = document.createElement('div')
  wrapper.className = 'cte-col-card'
  wrapper.innerHTML = `
    <div class="cte-col-hdr">
      <span class="cte-col-label">Coluna ${id}</span>
      <button class="cte-col-remove" title="Remover coluna">&times;</button>
    </div>
    <textarea rows="6" placeholder="Valor por linha"></textarea>
    <input type="text" placeholder="Alias (ex: id)" />
    <select>
      <option value="string">String</option>
      <option value="int">Inteiro</option>
    </select>`

  const state: ColState = {
    wrapper,
    textarea: wrapper.querySelector('textarea')!,
    aliasEl:  wrapper.querySelector('input')!,
    tipoEl:   wrapper.querySelector('select')!,
  }

  wrapper.querySelector<HTMLButtonElement>('.cte-col-remove')!.addEventListener('click', () => {
    cols = cols.filter((c) => c !== state)
    wrapper.remove()
    refreshLabels()
  })

  cols.push(state)
  container.appendChild(wrapper)
  refreshLabels()
  return state
}

export function initCteTool(): void {
  container    = document.getElementById('cteColsContainer') as HTMLDivElement
  const addBtn = document.getElementById('cteAddColBtn')     as HTMLButtonElement
  const genBtn = document.getElementById('cteGenerateBtn')   as HTMLButtonElement
  const clrBtn = document.getElementById('cteClearBtn')      as HTMLButtonElement
  const cpyBtn = document.getElementById('cteCopyBtn')       as HTMLButtonElement
  const nameEl = document.getElementById('cteName')          as HTMLInputElement
  const dialEl = document.getElementById('cteDialect')       as HTMLSelectElement
  const resEl  = document.getElementById('cteResult')        as HTMLDivElement
  const preEl  = document.getElementById('cteResultPre')     as HTMLPreElement
  const cntEl  = document.getElementById('cteResultCount')   as HTMLSpanElement
  const errEl  = document.getElementById('cteError')         as HTMLDivElement

  addCol(); addCol()

  addBtn.addEventListener('click', () => {
    if (cols.length >= 8) return
    addCol()
    addBtn.disabled = cols.length >= 8
  })

  genBtn.addEventListener('click', () => {
    errEl.classList.add('hidden')
    const cteName = nameEl.value.trim() || 'dados'
    const active  = cols.filter((c) => getLines(c).length > 0)

    if (active.length === 0) {
      errEl.textContent = 'Preencha pelo menos uma coluna.'
      errEl.classList.remove('hidden')
      return
    }
    const n = getLines(active[0]).length
    if (!active.every((c) => getLines(c).length === n)) {
      errEl.textContent = 'Todas as colunas preenchidas devem ter o mesmo número de linhas.'
      errEl.classList.remove('hidden')
      return
    }

    const sql = dialEl.value === 'oracle' ? buildOracle(cteName, active) : buildPostgres(cteName, active)
    preEl.textContent = sql
    cntEl.textContent = `${n} linha${n !== 1 ? 's' : ''} · ${active.length} coluna${active.length !== 1 ? 's' : ''}`
    resEl.classList.remove('hidden')
  })

  clrBtn.addEventListener('click', () => {
    cols.forEach((c) => { c.textarea.value = ''; c.aliasEl.value = ''; c.tipoEl.value = 'string' })
    nameEl.value = ''
    resEl.classList.add('hidden')
    errEl.classList.add('hidden')
  })

  cpyBtn.addEventListener('click', () => copyText(preEl.textContent ?? '', cpyBtn))
}
