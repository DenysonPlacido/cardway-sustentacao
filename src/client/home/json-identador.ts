import { copyText } from './shared'

export function initJsonTool(): void {
  const input = document.getElementById('jsonInput') as HTMLTextAreaElement
  const err = document.getElementById('jsonError') as HTMLDivElement
  const result = document.getElementById('jsonResult') as HTMLDivElement
  const pre = document.getElementById('jsonResultPre') as HTMLPreElement

  document.getElementById('jsonFormatBtn')!.addEventListener('click', () => {
    err.classList.add('hidden')
    result.classList.add('hidden')
    try {
      pre.textContent = JSON.stringify(JSON.parse(input.value), null, 2)
      result.classList.remove('hidden')
    } catch (e) {
      err.textContent = `JSON inválido: ${(e as Error).message}`
      err.classList.remove('hidden')
    }
  })

  document.getElementById('jsonClearBtn')!.addEventListener('click', () => {
    input.value = ''
    err.classList.add('hidden')
    result.classList.add('hidden')
  })

  document.getElementById('jsonCopyBtn')!.addEventListener('click', () =>
    copyText(pre.textContent ?? '', document.getElementById('jsonCopyBtn') as HTMLButtonElement)
  )
}
