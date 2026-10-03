import { env } from '../env.js'
import { asHttpResponse, type HttpResponse } from '../lib/http.js'

import type { RawBlog, RawPost, RawPostList } from './types.js'

const API_ROOT = 'https://www.googleapis.com/blogger/v3'

/**
 * Quantos posts pedimos por vez na varredura do índice.
 *
 * A documentação diz que o padrão é 10 e não crava um teto. Pedir 100 mantém a
 * varredura de um blog de tamanho médio em pouquíssimas requisições. Se a API
 * recusar, é aqui que se ajusta.
 */
const POSTS_PER_PAGE = 100

/**
 * Trava de segurança da varredura. Com 100 por página, 25 páginas cobrem 2.500
 * posts. O limite existe para que um bug (token que nunca acaba) não consuma a
 * quota inteira do dia em um único refresh.
 */
const MAX_INDEX_PAGES = 25

export class BloggerError extends Error {
  /**
   * Código HTTP que o GOOGLE devolveu.
   *
   * Repare que ele é separado do status que devolvemos ao nosso cliente, e isso
   * é de propósito. Um 400 do Blogger quase sempre significa "a nossa chave de
   * API está errada" ou "a API não está habilitada no projeto". Repassar esse
   * 400 para o navegador seria mentir: diria que QUEM PEDIU fez algo errado,
   * quando o erro é nosso.
   *
   * Por isso este campo existe para log e diagnóstico, e o erro que sai daqui
   * é sempre 502 (bad gateway): "o vizinho de quem eu dependo falhou".
   */
  readonly upstreamStatus: number

  constructor(message: string, upstreamStatus: number) {
    super(message)
    this.name = 'BloggerError'
    this.upstreamStatus = upstreamStatus
  }
}

type QueryValue = string | number | boolean | undefined

/**
 * Chamada crua à API do Blogger.
 *
 * Decisão importante: a API key entra como parâmetro `key` na URL, e não como
 * header. É assim que a API do Blogger funciona. Como esta função roda só no
 * servidor, a chave nunca chega ao navegador.
 */
async function request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const url = new URL(`${API_ROOT}${path}`)
  url.searchParams.set('key', env.BLOGGER_API_KEY)

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, String(value))
  }

  let response: HttpResponse
  try {
    response = asHttpResponse(
      await fetch(url, {
        signal: AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      }),
    )
  } catch (cause) {
    // Timeout e queda de rede chegam aqui. Traduzimos para uma mensagem que diz
    // o que fazer, em vez de vazar um "fetch failed" genérico.
    throw new BloggerError(
      `Não foi possível falar com a API do Blogger (${(cause as Error).message}).`,
      504,
    )
  }

  if (!response.ok) {
    throw new BloggerError(explainUpstreamFailure(response.status, path), response.status)
  }

  return (await response.json()) as T
}

/**
 * Traduz o código HTTP do Google para uma frase que ajuda a corrigir o problema.
 * Os dois casos clássicos são a API não habilitada (403) e o blog inexistente (404).
 */
function explainUpstreamFailure(status: number, path: string): string {
  switch (status) {
    case 400:
      return `O Blogger recusou a requisição para ${path}. Normalmente é a chave de API inválida ou um parâmetro errado.`
    case 403:
      return 'O Blogger negou o acesso. Confira se a "Blogger API v3" está habilitada no projeto do Google Cloud e se a chave de API não está restrita demais.'
    case 404:
      return `O Blogger não encontrou o recurso em ${path}. Verifique BLOGGER_BLOG_URL ou BLOGGER_BLOG_ID.`
    case 429:
      return 'Quota da Blogger API excedida. Aumente INDEX_TTL_MS para reduzir a frequência de atualização.'
    default:
      return `Erro ${status} da API do Blogger em ${path}.`
  }
}

let blogIdPromise: Promise<string> | null = null

/**
 * Descobre o ID numérico do blog a partir da URL.
 *
 * Por que isso existe: quase todos os endpoints do Blogger v3 exigem o ID
 * numérico, mas ninguém decora esse número. A solução é deixar o `.env` com a
 * URL amigável e resolver o ID na primeira necessidade, guardando em memória.
 *
 * Guardamos a Promise, não o valor. Assim, se dez requisições pedirem o ID ao
 * mesmo tempo com o cache frio, o Google recebe uma chamada só.
 */
export function getBlogId(): Promise<string> {
  if (env.BLOGGER_BLOG_ID) return Promise.resolve(env.BLOGGER_BLOG_ID)

  blogIdPromise ??= request<RawBlog>('/blogs/byurl', { url: env.BLOGGER_BLOG_URL })
    .then((blog) => blog.id)
    .catch((error: unknown) => {
      // Sem isso, uma falha na primeira tentativa ficaria congelada para sempre
      // na Promise rejeitada, e o serviço nunca se recuperaria sem reiniciar.
      blogIdPromise = null
      throw error
    })

  return blogIdPromise
}

/** Informações do blog. Usado pelo endpoint de saúde e para o nome do site. */
export async function fetchBlog(): Promise<RawBlog> {
  const blogId = await getBlogId()
  return request<RawBlog>(`/blogs/${blogId}`)
}

/**
 * Varre TODOS os posts do blog, com corpo e metadados de imagem.
 *
 * Parece caro, e é: uma varredura custa poucas requisições e traz o blog
 * inteiro. A aposta é que vale muito mais fazer isso de 15 em 15 minutos do que
 * fazer uma chamada por visita. Com o índice quente, nenhuma visita ao site
 * toca a API do Google.
 */
export async function fetchAllPosts(): Promise<RawPost[]> {
  const blogId = await getBlogId()
  const posts: RawPost[] = []

  let pageToken: string | undefined
  let page = 0

  do {
    const response = await request<RawPostList>(`/blogs/${blogId}/posts`, {
      maxResults: POSTS_PER_PAGE,
      fetchBodies: true,
      fetchImages: true,
      status: 'live',
      pageToken,
    })

    posts.push(...(response.items ?? []))
    pageToken = response.nextPageToken
    page += 1
  } while (pageToken && page < MAX_INDEX_PAGES)

  return posts
}
