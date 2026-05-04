import { copyText } from './shared'

function buildWith(name: string, cols: string[], blocks: string[][]): string {
  const selects: string[] = []
  for (const block of blocks) {
    for (const line of block) {
      const parts = line.split(',').map((v) => v.trim())
      if (parts.length !== cols.length) continue
      selects.push(`SELECT ${parts.join(', ')} FROM dual`)
    }
  }
  if (!selects.length) return ''
  const w = name || 'dados'
  return `WITH ${w} (${cols.join(', ')}) AS (\n  ${selects.join('\n  UNION ALL\n  ')}\n)\nSELECT *\nFROM ${w};`
}

export function initWithTool(): void {
  const nameInp = document.getElementById('withName') as HTMLInputElement
  const colInputs = Array.from(document.querySelectorAll<HTMLInputElement>('#withCols input'))
  const blockTAs = Array.from(document.querySelectorAll<HTMLTextAreaElement>('#withBlocks textarea'))
  const result = document.getElementById('withResult') as HTMLDivElement
  const pre = document.getElementById('withResultPre') as HTMLPreElement

  document.getElementById('withGenerateBtn')!.addEventListener('click', () => {
    const cols = colInputs.map((i) => i.value.trim()).filter(Boolean)
    const blocks = blockTAs.map((ta) => ta.value.trim().split('\n').filter(Boolean)).filter((b) => b.length)
    if (!cols.length || !blocks.length) return
    pre.textContent = buildWith(nameInp.value.trim(), cols, blocks)
    result.classList.remove('hidden')
  })

  document.getElementById('withClearBtn')!.addEventListener('click', () => {
    nameInp.value = ''
    colInputs.forEach((i) => { i.value = '' })
    blockTAs.forEach((ta) => { ta.value = '' })
    result.classList.add('hidden')
  })

  document.getElementById('withCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('withCopyBtn') as HTMLButtonElement)
  )
}
