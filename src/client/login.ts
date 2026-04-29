interface LoginResponse {
  success?: boolean
  user?: { login: string; name: string }
  error?: string
}

const form = document.getElementById('loginForm') as HTMLFormElement
const loginInput = document.getElementById('login') as HTMLInputElement
const passwordInput = document.getElementById('password') as HTMLInputElement
const errorMsg = document.getElementById('errorMsg') as HTMLDivElement
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement

form.addEventListener('submit', async (event: SubmitEvent) => {
  event.preventDefault()
  errorMsg.hidden = true
  submitBtn.disabled = true
  submitBtn.textContent = 'Entrando...'

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        login: loginInput.value.trim(),
        password: passwordInput.value,
      }),
    })

    const data = (await response.json()) as LoginResponse

    if (response.ok && data.success) {
      window.location.href = '/home'
      return
    }

    showError(data.error ?? 'Credenciais invalidas')
  } catch {
    showError('Erro de conexao. Tente novamente.')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = 'Entrar'
  }
})

function showError(message: string): void {
  errorMsg.textContent = message
  errorMsg.hidden = false
}
