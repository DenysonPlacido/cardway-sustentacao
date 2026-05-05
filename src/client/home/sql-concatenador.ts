import { copyText } from './shared'

function buildConcat(column: string, raw: string, type: 'string' | 'number'): string {
  const vals = raw.split('\n').map((v) => v.trim()).filter(Boolean)
  if (!vals.length) return ''
  const fmt = type === 'string' ? vals.map((v) => `'${v}'`) : vals
  const chunks: string[][] = []
  for (let i = 0; i < fmt.length; i += 1000) chunks.push(fmt.slice(i, i + 1000))
  return chunks.map((c) => `${column} IN (${c.join(', ')})`).join(' OR\n')
}

export function initConcatenadorTool(): void {
  const col    = document.getElementById('concatColumn')      as HTMLInputElement
  const vals   = document.getElementById('concatValues')      as HTMLTextAreaElement
  const result = document.getElementById('concatResult')      as HTMLDivElement
  const pre    = document.getElementById('concatResultPre')   as HTMLPreElement
  const count  = document.getElementById('concatResultCount') as HTMLSpanElement

  function run(type: 'string' | 'number'): void {
    if (!col.value.trim() || !vals.value.trim()) return
    const out = buildConcat(col.value.trim(), vals.value, type)
    const n = vals.value.split('\n').filter((v) => v.trim()).length
    pre.textContent = out
    count.textContent = `${n} valores`
    result.classList.remove('hidden')
  }

  document.getElementById('concatBtnString')!.addEventListener('click', () => run('string'))
  document.getElementById('concatBtnNumber')!.addEventListener('click', () => run('number'))
  document.getElementById('concatClearBtn')!.addEventListener('click', () => {
    col.value = ''
    vals.value = ''
    result.classList.add('hidden')
  })
  document.getElementById('concatCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('concatCopyBtn') as HTMLButtonElement)
  )
}
