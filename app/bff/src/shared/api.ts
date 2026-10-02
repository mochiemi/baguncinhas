/**
 * Formato de toda listagem paginada da API.
 *
 * Por que `page` e não `cursor`?
 * A API do Blogger devolve um `nextPageToken` (cursor opaco), o que tornaria
 * impossível pular direto para a página 5. Para um blog isso é ruim: queremos
 * URLs como `/pagina/3` que o Google consegue indexar e o leitor consegue
 * compartilhar.
 *
 * A solução está no BFF: ele mantém um índice local dos posts e pagina em
 * memória. O upstream continua sendo cursor; o que expomos é página numerada.
 */
export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  /** Total de posts conhecidos. `null` se o Blogger não informar. */
  totalItems: number | null
  totalPages: number
  hasMore: boolean
}

/** Formato único de erro da API. Facilita tratar no front. */
export interface ApiError {
  error: {
    code: 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'BAD_REQUEST' | 'INTERNAL'
    message: string
  }
}
