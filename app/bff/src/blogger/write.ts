import { env } from '../env.js'

import { BloggerError, getBlogId } from './client.js'
import { WriteAuthError, getAccessToken } from './oauth.js'
import type { RawPost } from './types.js'

const API_ROOT = 'https://www.googleapis.com/blogger/v3'

/**
 * Escrita no Blogger.
 *
 * Diferença essencial em relação ao `client.ts`: lá usamos a API key como
 * parâmetro de URL e só lemos. Aqui o token vai no cabeçalho `Authorization`,
 * identifica uma PESSOA (o dono do blog) e permite alterar conteúdo.
 *
 * Todo método daqui devolve o post como o Blogger o gravou. Isso é de propósito:
 * em vez de confiar no que enviamos, usamos a resposta como fonte da verdade —
 * ela traz o `id`, a `url` final e os campos que o Blogger normalizou.
 */

export interface PostInput {
  title: string
  /** Corpo em HTML. Já vem sanitizado pela rota que chama. */
  content: string
  labels?: string[]
}

interface WriteOptions {
  method: 'POST' | 'PATCH' | 'DELETE'
  /** Viram query string. `isDraft`, por exemplo, é parâmetro e não campo do corpo. */
  params?: Record<string, string | boolean>
  body?: unknown
}

async function writeRequest<T>(path: string, options: WriteOptions): Promise<T> {
  const token = await getAccessToken()

  const url = new URL(`${API_ROOT}${path}`)
  for (const [name, value] of Object.entries(options.params ?? {})) {
    url.searchParams.set(name, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new BloggerError(
      `Não foi possível falar com a API do Blogger (${(cause as Error).message}).`,
      504,
    )
  }

  /**
   * 401 e 403 aqui não são "token errado" no sentido do leitor.
   *
   * Significam que a ação foi recusada, e há DUAS causas bem diferentes com o
   * mesmo código: a API do Blogger não estar habilitada no projeto, ou a conta
   * autorizada não administrar este blog. A mensagem do Google distingue as
   * duas, então ela precisa chegar inteira — foi por descartá-la que este erro
   * ficou enigmático na primeira vez.
   */
  if (response.status === 401 || response.status === 403) {
    const detail = await readErrorDetail(response)

    const hint =
      detail.toLowerCase().includes('has not been used') ||
      detail.toLowerCase().includes('is disabled')
        ? 'A API do Blogger não está habilitada no projeto do Google Cloud que é dono deste cliente OAuth. Habilite em "APIs e serviços → Biblioteca".'
        : 'Confira se a autorização foi feita com a conta dona do blog e com o escopo auth/blogger.'

    throw new WriteAuthError(
      `O Blogger recusou a escrita (HTTP ${response.status})${detail.length > 0 ? `: ${detail}` : '.'} ${hint}`,
    )
  }

  if (!response.ok) {
    throw new BloggerError(await explainWriteFailure(response, path), response.status)
  }

  // DELETE responde 204, sem corpo. Tentar ler JSON daria erro.
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } }
    return payload.error?.message ?? ''
  } catch {
    // Corpo não era JSON. Segue sem detalhe.
    return ''
  }
}

async function explainWriteFailure(response: Response, path: string): Promise<string> {
  const detail = await readErrorDetail(response)

  const base = `O Blogger recusou a escrita em ${path} (HTTP ${response.status})`
  return detail.length > 0 ? `${base}: ${detail}` : `${base}.`
}

/**
 * Cria um post.
 *
 * `isDraft` é parâmetro de QUERY, não campo do corpo — está assim na própria
 * descoberta da API. Criar como rascunho é o padrão seguro: nada aparece no blog
 * público até alguém publicar de propósito.
 */
export async function createPost(
  input: PostInput,
  options: { draft: boolean },
): Promise<RawPost> {
  const blogId = await getBlogId()

  return writeRequest<RawPost>(`/blogs/${blogId}/posts`, {
    method: 'POST',
    params: { isDraft: options.draft, fetchBody: true },
    body: {
      kind: 'blogger#post',
      title: input.title,
      content: input.content,
      labels: input.labels ?? [],
    },
  })
}

/** Altera campos de um post existente, sem tocar no que não foi enviado. */
export async function patchPost(postId: string, input: Partial<PostInput>): Promise<RawPost> {
  const blogId = await getBlogId()

  return writeRequest<RawPost>(`/blogs/${blogId}/posts/${postId}`, {
    method: 'PATCH',
    body: input,
  })
}

/**
 * Publica ou volta para rascunho.
 *
 * São dois endpoints diferentes, e não um campo. `publish` tira do rascunho,
 * `revert` devolve para rascunho. Vale saber que `revert` despublica de verdade:
 * o post sai do ar no blog.
 */
export async function setPublished(postId: string, published: boolean): Promise<RawPost> {
  const blogId = await getBlogId()
  const action = published ? 'publish' : 'revert'

  return writeRequest<RawPost>(`/blogs/${blogId}/posts/${postId}/${action}`, {
    method: 'POST',
  })
}

/**
 * Exclui um post.
 *
 * O Blogger move para a lixeira antes de apagar de vez, o que dá uma rede de
 * segurança. Ainda assim, é a única operação daqui que não tem desfazer pela
 * nossa interface.
 */
export async function deletePost(postId: string): Promise<void> {
  const blogId = await getBlogId()

  await writeRequest<void>(`/blogs/${blogId}/posts/${postId}`, { method: 'DELETE' })
}

/**
 * Endereço do post no editor do Blogger.
 *
 * Existe por causa de uma limitação da API: não há endpoint de upload de imagem.
 * Os recursos são blogs, comments, pages, posts, pageViews, postUserInfos e
 * users — nenhum de mídia. O editor do Blogger sobe imagem por um caminho
 * interno que não está na API pública.
 *
 * Então o fluxo honesto é: escrever o texto aqui e, quando o post tiver foto,
 * abrir este endereço e adicionar as imagens lá. Cada ferramenta no que ela faz
 * melhor.
 */
export async function bloggerEditUrl(postId: string): Promise<string> {
  const blogId = await getBlogId()
  return `https://www.blogger.com/blog/post/edit/${blogId}/${postId}`
}
