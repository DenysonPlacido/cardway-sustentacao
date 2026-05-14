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
const togglePassword = document.getElementById('togglePassword') as HTMLButtonElement

form.addEventListener('submit', async (event: SubmitEvent) => {
  event.preventDefault()
  hideError()
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

    const data = (await response.json().catch(() => ({}))) as LoginResponse

    if (response.ok && data.success) {
      window.location.href = '/home'
      return
    }

    showError(getFriendlyLoginError(response.status, data))
  } catch {
    showError('Não consegui alcançar o servidor. Verifique sua conexão e tente novamente.')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = 'Entrar'
  }
})

togglePassword.addEventListener('click', () => {
  const showing = passwordInput.type === 'text'
  passwordInput.type = showing ? 'password' : 'text'
  togglePassword.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha')
})

function showError(message: string): void {
  errorMsg.textContent = message
  errorMsg.hidden = false
}

function hideError(): void {
  errorMsg.textContent = ''
  errorMsg.hidden = true
}

function getFriendlyLoginError(status: number, payload: LoginResponse): string {
  const raw = String(payload.error ?? '').trim().toLowerCase()

  if (status === 401 || raw.includes('credencial')) {
    return 'Login ou senha inválidos.'
  }

  if (status === 503 || raw.includes('indispon') || raw.includes('banco') || raw.includes('database')) {
    return 'A autenticação está indisponível agora. Tente novamente em alguns minutos.'
  }

  if (status === 400) {
    return payload.error ?? 'Verifique os dados informados.'
  }

  return payload.error ?? 'Não foi possível entrar agora. Tente novamente.'
}
