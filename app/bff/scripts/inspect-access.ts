/**
 * Diagnóstico manual da autorização do Google.
 *
 * Uso:
 *   pnpm --filter @mochiblog/bff inspect:access
 *
 * Mostra a resposta **crua** do Google sobre a conta do `GOOGLE_REFRESH_TOKEN`:
 * de quem é o token, quais blogs essa conta administra e se ela manda no blog
 * configurado. Serve para separar duas causas parecidas de 403:
 *
 *   1. o token é de uma conta que não administra o blog (problema de conta);
 *   2. o token está sem os escopos certos (problema de autorização).
 *
 * O e-mail só aparece se a autorização tiver o escopo `email`.
 */
import { getBlogId } from '../src/blogger/client.js'
import { getAccessToken } from '../src/blogger/oauth.js'

/** Mostra JSON legível sem estourar a largura do terminal. */
function show(label: string, value: unknown): void {
  console.log(`\n=== ${label} ===`)
  console.log(JSON.stringify(value, null, 2))
}

const token = await getAccessToken()
const blogId = await getBlogId()

const call = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  const body: unknown = await response.json().catch(() => null)
  console.log(`\n--- GET ${url}`)
  console.log(`HTTP ${response.status}`)
  return body
}

show('userinfo (quem é o dono do token)', await call('https://www.googleapis.com/oauth2/v3/userinfo'))

/**
 * Os escopos que o token REALMENTE carrega.
 *
 * É a primeira coisa a olhar quando o Blogger responde 403, porque existem dois
 * 403 parecidos e de soluções opostas:
 *
 *   - "insufficient authentication scopes" → falta ESCOPO no token;
 *   - "The caller does not have permission" → o token é de uma conta que não
 *     administra o blog.
 *
 * A primeira é problema de autorização, a segunda é problema de conta. Sem esta
 * lista as duas parecem a mesma coisa, e a gente persegue o culpado errado.
 *
 * Feito fora do `call` de propósito: aqui o token vai na URL, e eu não quero que
 * ele apareça no terminal.
 */
const tokenInfo = (await (
  await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`)
).json()) as { scope?: string }

const grantedScopes = (tokenInfo.scope ?? '').split(' ').filter(Boolean)
console.log(`\n=== Escopos concedidos (${grantedScopes.length}) ===`)
for (const scope of grantedScopes) console.log(`  ${scope}`)

const WRITE_SCOPE = 'https://www.googleapis.com/auth/blogger'
if (!grantedScopes.includes(WRITE_SCOPE)) {
  console.log(
    `\nFALTA o escopo de escrita: ${WRITE_SCOPE}\n` +
      'Enquanto ele não estiver na lista acima, todo método do Blogger responde 403\n' +
      '"insufficient authentication scopes". Esse erro NÃO é falta de permissão no\n' +
      'blog: é falta de autorização no token. Refazer o fluxo de /admin, aceitando a\n' +
      'permissão do Blogger, resolve.',
  )
}

const owned = (await call('https://www.googleapis.com/blogger/v3/users/self/blogs')) as {
  items?: { id: string; name: string; url: string }[]
}

show(
  `users/self/blogs/${blogId} (o que esta conta pode no blog do .env)`,
  await call(`https://www.googleapis.com/blogger/v3/users/self/blogs/${blogId}`),
)

/**
 * A pergunta que importa: em qual desses blogs a escrita vai passar?
 *
 * `hasAdminAccess: false` não vale só para o blog do .env — vale para qualquer
 * blog que a conta não administre. Por isso a lista sai junto com o veredito de
 * cada um: dá para escolher um blog de teste e validar a escrita na hora.
 */
console.log('\n=== hasAdminAccess por blog administrado ===')
for (const blog of owned.items ?? []) {
  const info = (await call(`https://www.googleapis.com/blogger/v3/users/self/blogs/${blog.id}`)) as {
    blog_user_info?: { hasAdminAccess?: boolean }
  }
  console.log(`${blog.name} — ${blog.url} — hasAdminAccess: ${info.blog_user_info?.hasAdminAccess === true}`)
}

console.log('\nFim. `hasAdminAccess: true` é o que libera a escrita.')
