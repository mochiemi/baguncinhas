// O contrato da API vive no BFF, e o front o consome daqui. É `import type`, então
// isto é apagado na compilação: nada atravessa para o bundle do navegador.
import type { LabelSummary, Paginated, Post, PostSummary } from '../../bff/src/shared/index.js'

export interface ListPostsParams {
  page?: number
  pageSize?: number
  label?: string
}

/**
 * Cliente da nossa própria API.
 *
 * Repare que os caminhos são relativos: `/api/posts`, e não
 * `https://mochiblog-bff.vercel.app/api/posts`. Isso é consequência do proxy
 * configurado no `nuxt.config.ts`, e é o que permite as duas coisas funcionarem
 * com o MESMO código:
 *
 *   - No servidor, durante a renderização: a chamada sai do Nitro e vai para o
 *     BFF. Como acontece entre máquinas, não existe CORS envolvido.
 *   - No navegador: a chamada vai para o próprio domínio do site, e o Nitro
 *     repassa. Como o navegador enxerga tudo como same-origin, também não
 *     existe CORS.
 *
 * Os tipos vêm do pacote compartilhado, então se o BFF mudar o formato de
 * resposta, o build do front quebra aqui, na hora de compilar, e não em
 * produção com um `undefined` na tela.
 */
export function useBlogApi() {
  /**
   * `useRequestFetch` em vez de `$fetch` puro.
   *
   * Durante o SSR, `$fetch('/api/posts')` falha: URL relativa não tem origem
   * para resolver no lado do servidor. O `useRequestFetch` resolve a URL contra
   * a requisição que está sendo atendida e ainda encaminha os cabeçalhos dela.
   * No navegador ele se comporta exatamente como o `$fetch`.
   */
  const request = useRequestFetch()

  return {
    listPosts: ({ page, pageSize, label }: ListPostsParams = {}) =>
      request<Paginated<PostSummary>>('/api/posts', {
        query: { page, pageSize, label },
      }),

    getPost: (slug: string) =>
      request<Post>(`/api/posts/${encodeURIComponent(slug)}`),

    searchPosts: (q: string, page = 1, pageSize?: number) =>
      request<Paginated<PostSummary>>('/api/posts/search', {
        query: { q, page, pageSize },
      }),

    listLabels: () => request<LabelSummary[]>('/api/labels'),
  }
}
