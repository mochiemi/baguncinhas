interface AuthSession {
  authenticated: boolean
  user: string | null
}

/**
 * Sessão do painel.
 *
 * O estado vive num `useState` para ser compartilhado entre a página e os
 * componentes. Sem isso, cada componente faria a própria pergunta ao servidor e
 * eles poderiam discordar por um instante — exatamente o tipo de coisa que faz o
 * formulário aparecer para quem já está logado.
 *
 * Nada de token aqui. A sessão mora num cookie `HttpOnly` que o JavaScript não
 * consegue ler; este composable só guarda a RESPOSTA do servidor sobre quem está
 * logado. Quem decide de verdade é o servidor, a cada requisição.
 */
export function useAuth() {
  /**
   * `useRequestFetch` porque este código roda também no servidor.
   *
   * Durante a renderização, ele encaminha os cabeçalhos da requisição original —
   * inclusive o cookie. É isso que permite a página já sair do servidor no
   * estado certo, sem o formulário piscar antes de virar painel.
   */
  const request = useRequestFetch()

  const session = useState<AuthSession>('auth:session', () => ({
    authenticated: false,
    user: null,
  }))

  /** Pergunta ao servidor quem está logado e atualiza o estado local. */
  async function refresh(): Promise<AuthSession> {
    const result = await request<AuthSession>('/api/auth/me')
    session.value = result
    return result
  }

  async function login(user: string, password: string): Promise<void> {
    const result = await request<{ authenticated: boolean; user: string }>('/api/auth/login', {
      method: 'POST',
      body: { user, password },
    })

    session.value = { authenticated: true, user: result.user }
  }

  async function logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' })
    session.value = { authenticated: false, user: null }
  }

  return { session, refresh, login, logout }
}

/**
 * Extrai a mensagem de erro que o BFF mandou.
 *
 * O `$fetch` lança uma exceção e coloca o corpo da resposta em `error.data`.
 * Como toda a API responde no mesmo formato, dá para ler a mensagem pronta em
 * vez de inventar um texto genérico na interface.
 *
 * O `?? ` final existe para o caso raro de o erro nem ser da API (rede caiu,
 * por exemplo), quando não há corpo nenhum para ler.
 */
export function describeAuthError(error: unknown): string {
  const data = (error as { data?: { error?: { message?: string } } })?.data
  return data?.error?.message ?? 'Não foi possível falar com o servidor. Tente de novo.'
}
