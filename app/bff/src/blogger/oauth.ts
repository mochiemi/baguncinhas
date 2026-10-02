import { googleWriteConfig } from '../env.js'

import { getBlogId } from './client.js'

/**
 * Token de escrita do Blogger.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE SE JÁ TEMOS UMA API KEY
 * ---------------------------------------------------------------------------
 * A API key que usamos para ler funciona assim: ela identifica o PROJETO, não a
 * pessoa. Serve para ler conteúdo público, e só. Escrever exige provar que você
 * é o dono do blog, e isso só um token OAuth 2.0 obtido com a autorização do
 * dono faz.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISSO NÃO É UM LOGIN
 * ---------------------------------------------------------------------------
 * A autorização acontece UMA vez, na instalação, feita pelo dono do blog. O que
 * o Google devolve é um `refresh_token`: um valor permanente que, sozinho,
 * permite pedir novos tokens de acesso sempre que precisar.
 *
 * Ele fica na variável de ambiente do servidor. Nunca vai para o navegador,
 * nunca aparece numa tela, e quem escreve no painel não vê o Google em momento
 * nenhum.
 *
 * Pense nele como uma segunda API key, com poder de escrita.
 */

export class WriteNotConfiguredError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(
      `A escrita no Blogger não está configurada. Falta preencher: ${missing.join(', ')}. ` +
        'Enquanto isso, o site continua funcionando como leitura.',
    )
    this.name = 'WriteNotConfiguredError'
    this.missing = missing
  }
}

export class WriteAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WriteAuthError'
  }
}

/**
 * Cache do token de acesso.
 *
 * O `refresh_token` não é usado direto em cada chamada: ele é trocado por um
 * `access_token` de vida curta (cerca de 1 hora). Trocar a cada requisição
 * funcionaria, mas seria uma ida extra ao Google por chamada, sem necessidade.
 * Guardamos em memória até perto do vencimento.
 */
let cachedAccessToken: { value: string; expiresAt: number } | null = null

/** Margem de segurança: renovamos 60s antes de vencer, para não perder corrida. */
const RENEW_MARGIN_MS = 60_000

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/**
 * Devolve um token de acesso válido, renovando se necessário.
 */
export async function getAccessToken(): Promise<string> {
  if (!googleWriteConfig.enabled) {
    throw new WriteNotConfiguredError(googleWriteConfig.missing)
  }

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + RENEW_MARGIN_MS) {
    return cachedAccessToken.value
  }

  const body = new URLSearchParams({
    client_id: googleWriteConfig.clientId,
    client_secret: googleWriteConfig.clientSecret,
    refresh_token: googleWriteConfig.refreshToken,
    grant_type: 'refresh_token',
  })

  let response: Response
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    })
  } catch (cause) {
    throw new WriteAuthError(
      `Não foi possível falar com o Google para renovar o token (${(cause as Error).message}).`,
    )
  }

  const payload = (await response.json()) as TokenResponse

  if (!response.ok || !payload.access_token) {
    /**
     * Os dois motivos clássicos de falha aqui:
     *   - `invalid_grant`: o refresh token foi revogado, ou expirou. Acontece
     *     quando a autorização é removida na conta Google, ou quando o app fica
     *     em modo de teste e o token vence.
     *   - `invalid_client`: client ID ou secret não conferem.
     *
     * Vale deixar a mensagem específica, porque a ação para corrigir é bem
     * diferente em cada caso.
     */
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`
    throw new WriteAuthError(
      `O Google recusou a renovação do token (${detail}). ` +
        'Se for "invalid_grant", é preciso refazer a autorização e atualizar GOOGLE_REFRESH_TOKEN.',
    )
  }

  const expiresInSeconds = payload.expires_in ?? 3600
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  }

  return cachedAccessToken.value
}

/** Usado pelo endpoint de saúde para relatar o estado sem tentar escrever nada. */
export function writeTokenStatus(): { configured: boolean; missing: string[]; hasCachedToken: boolean } {
  return {
    configured: googleWriteConfig.enabled,
    missing: googleWriteConfig.enabled ? [] : googleWriteConfig.missing,
    hasCachedToken: cachedAccessToken !== null,
  }
}

/**
 * O que dá para saber sobre a autorização atual.
 *
 * São três estados, e não dois, porque existem DOIS 403 diferentes neste caminho
 * e eles pedem soluções opostas:
 *
 * - `no-write-scope`: o token não tem o escopo `blogger`. Nenhum método de
 *   escrita funciona, nem em blog que a conta administra. O Google responde
 *   "Request had insufficient authentication scopes". A solução é refazer a
 *   autorização ACEITANDO a permissão do Blogger.
 * - `verified` com `hasAdminAccess: false`: o token é bom, mas a conta não
 *   administra este blog. O Google responde "The caller does not have
 *   permission". A solução é autorizar com OUTRA conta.
 * - `unknown`: não deu para verificar (rede, resposta inesperada). É diferente de
 *   "não tem acesso": acusar a conta por causa de uma falha de rede seria pior
 *   do que não dizer nada.
 *
 * Antes disto os dois primeiros casos chegavam aqui iguais, e o resultado foi
 * uma caçada à conta errada enquanto o problema era o escopo.
 */
export type AuthorizationState =
  | { state: 'verified'; email: string | null; hasAdminAccess: boolean }
  | { state: 'no-write-scope'; email: string | null; grantedScopes: string[] }
  | { state: 'unknown'; email: string | null }

/** O escopo que autoriza escrever. É o único indispensável. */
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/blogger'

/**
 * Pergunta ao Google de quem é o token, o que ele pode, e se manda no blog.
 *
 * Duas chamadas:
 *
 * 1. `tokeninfo` — devolve o e-mail E a lista de escopos concedidos. Escolhido no
 *    lugar do `userinfo` por isso: a mesma identidade, mais os escopos, no mesmo
 *    pedido. O token vai na URL aqui, que é como o endpoint funciona; por isso
 *    esta URL nunca é registrada em log.
 * 2. `users/self/blogs/{id}` — o veredito de permissão. O campo `hasAdminAccess`
 *    é resposta do próprio Google, não heurística nossa.
 */
export async function inspectAuthorization(accessToken: string): Promise<AuthorizationState> {
  const headers = { authorization: `Bearer ${accessToken}` }

  let email: string | null = null
  let grantedScopes: string[] = []

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (response.ok) {
      const payload = (await response.json()) as { email?: string; scope?: string }
      email = payload.email ?? null
      grantedScopes = (payload.scope ?? '').split(' ').filter(Boolean)
    }
  } catch {
    // Sem tokeninfo a gente segue: o veredito da permissão vem da chamada abaixo.
  }

  /**
   * Escopo ausente decide sozinho, e vem ANTES da pergunta sobre permissão.
   *
   * Um token sem o escopo de escrita não escreve em blog nenhum, inclusive nos
   * que a conta administra. Perguntar de permissão antes disto daria a resposta
   * certa para a pergunta errada.
   *
   * A condição exige lista não vazia para não condenar o token quando o
   * `tokeninfo` falhou: ali a lista veio vazia por falta de resposta, não por
   * falta de escopo.
   */
  if (grantedScopes.length > 0 && !grantedScopes.includes(WRITE_SCOPE)) {
    return { state: 'no-write-scope', email, grantedScopes }
  }

  try {
    const blogId = await getBlogId()
    const response = await fetch(
      `https://www.googleapis.com/blogger/v3/users/self/blogs/${blogId}`,
      { headers, signal: AbortSignal.timeout(5000) },
    )

    if (!response.ok) {
      /**
       * O mesmo 403 pode ser falta de escopo, e isto acontece quando o `tokeninfo`
       * não respondeu: aí a lista veio vazia e não deu para decidir acima. O
       * motivo `insufficientPermissions` é o Google dizendo exatamente isso, então
       * vale ler antes de culpar a conta.
       */
      if (response.status === 403) {
        const body = (await response.json().catch(() => null)) as {
          error?: { errors?: { reason?: string }[] }
        } | null

        if (body?.error?.errors?.[0]?.reason === 'insufficientPermissions') {
          return { state: 'no-write-scope', email, grantedScopes }
        }
      }

      return { state: 'unknown', email }
    }

    const payload = (await response.json()) as {
      blog_user_info?: { hasAdminAccess?: boolean }
    }

    return {
      state: 'verified',
      email,
      hasAdminAccess: payload.blog_user_info?.hasAdminAccess === true,
    }
  } catch {
    return { state: 'unknown', email }
  }
}

/**
 * Os blogs que a conta do token administra.
 *
 * Existe para o caso de a conta estar simplesmente errada. Sem esta lista, a
 * página de erro só consegue dizer "esta conta não administra o blog", e quem
 * está autorizando fica tentando conta por conta no escuro. Com ela, a pessoa vê
 * os blogs da conta que acabou de usar e reconhece na hora se pegou a trocada.
 *
 * ⚠️ O endpoint é `blogs.listByUser`, em `/users/self/blogs`. NÃO é o campo
 * `blogs` do `/users/self`: aquele vem sempre vazio, e foi por causa dele que eu
 * concluí, errado, que a conta autorizada não administrava blog nenhum.
 */
export async function listAdministeredBlogs(
  accessToken: string,
): Promise<{ id: string; name: string; url: string }[]> {
  try {
    const response = await fetch('https://www.googleapis.com/blogger/v3/users/self/blogs', {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })

    // Lista é conveniência: se falhar, a página de erro segue sem ela.
    if (!response.ok) return []

    const payload = (await response.json()) as {
      items?: { id?: unknown; name?: unknown; url?: unknown }[]
    }

    return (payload.items ?? [])
      .filter(
        (item): item is { id: string; name: string; url: string } =>
          typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string',
      )
      .map((item) => ({ id: item.id, name: item.name, url: item.url }))
  } catch {
    return []
  }
}

/**
 * Mesma checagem do `inspectAuthorization`, obtendo o token sozinha. Usada pelo painel.
 *
 * Devolve `null` apenas quando nem isso deu: sem token configurado, ou falha na
 * troca do refresh token. É diagnóstico, não requisito: se falhar, o painel
 * simplesmente não afirma nada sobre o token.
 */
export async function describeAuthorizedAccount(): Promise<AuthorizationState | null> {
  try {
    return await inspectAuthorization(await getAccessToken())
  } catch {
    return null
  }
}
