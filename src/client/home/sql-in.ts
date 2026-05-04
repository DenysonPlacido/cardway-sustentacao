import { copyText } from './shared'

function buildSqlIn(column: string, raw: string, type: 'string' | 'number'): string {
  const vals = raw.split('\n').map((v) => v.trim()).filter(Boolean)
  if (!vals.length) return ''
  const fmt = type === 'string' ? vals.map((v) => `'${v.replace(/'/g, "''")}'`) : vals
  const chunks: string[][] = []
  for (let i = 0; i < fmt.length; i += 1000) chunks.push(fmt.slice(i, i + 1000))
  return chunks.map((c) => `${column} IN (${c.join(', ')})`).join(' OR\n')
}

export function initSqlTool(): void {
  const col = document.getElementById('sqlColumn') as HTMLInputElement
  const vals = document.getElementById('sqlValues') as HTMLTextAreaElement
  const result = document.getElementById('sqlResult') as HTMLDivElement
  const pre = document.getElementById('sqlResultPre') as HTMLPreElement
  const count = document.getElementById('sqlResultCount') as HTMLSpanElement

  function run(type: 'string' | 'number'): void {
    if (!col.value.trim() || !vals.value.trim()) return
    const out = buildSqlIn(col.value.trim(), vals.value, type)
    const n = vals.value.split('\n').filter((v) => v.trim()).length
    pre.textContent = out
    count.textContent = `${n} valores`
    result.classList.remove('hidden')
  }

  document.getElementById('sqlBtnString')!.addEventListener('click', () => run('string'))
  document.getElementById('sqlBtnNumber')!.addEventListener('click', () => run('number'))
  document.getElementById('sqlClearBtn')!.addEventListener('click', () => {
    col.value = ''
    vals.value = ''
    result.classList.add('hidden')
  })
  document.getElementById('sqlCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('sqlCopyBtn') as HTMLButtonElement)
  )
}
