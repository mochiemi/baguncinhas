import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { env } from '../env.js'
import { CACHE_LIST, CACHE_POST } from '../lib/cache-headers.js'
import { postIndex } from '../services/post-index.js'

/**
 * Validação dos parâmetros de paginação.
 *
 * `z.coerce.number()` é necessário porque tudo que chega numa query string é
 * texto: `?page=2` chega como a string "2". Coagir aqui evita um número mágico
 * com `Number()` espalhado pelas rotas.
 *
 * O `.max(env.MAX_PAGE_SIZE)` é uma proteção de serviço, não de UI. Sem ele,
 * alguém poderia pedir `?pageSize=100000` e forçar o servidor a montar um JSON
 * gigante. Todo parâmetro que controla volume de resposta precisa de teto.
 */
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(env.MAX_PAGE_SIZE).default(env.DEFAULT_PAGE_SIZE),
})

const listQuerySchema = paginationSchema.extend({
  label: z.string().trim().min(1).max(100).optional(),
})

const searchQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).default(''),
})

export function postsRoutes(app: FastifyInstance, _options: unknown, done: () => void): void {
  /**
   * Ordem das rotas importa.
   *
   * `/posts/search` é uma rota estática e `/posts/:slug` é paramétrica. O
   * roteador do Fastify dá precedência para a estática, então `/posts/search`
   * nunca cai em `:slug` valendo "search". Mesmo assim, deixamos a estática
   * declarada primeiro, porque a intenção fica legível para quem ler depois.
   */
  app.get('/posts/search', async (request, reply) => {
    const { q, page, pageSize } = searchQuerySchema.parse(request.query)
    const result = await postIndex.search(q, page, pageSize)

    reply.header('cache-control', CACHE_LIST)
    return result
  })

  app.get('/posts', async (request, reply) => {
    const { page, pageSize, label } = listQuerySchema.parse(request.query)
    const result = await postIndex.list({ page, pageSize, label })

    reply.header('cache-control', CACHE_LIST)
    return result
  })

  app.get<{ Params: { slug: string } }>('/posts/:slug', async (request, reply) => {
    const post = await postIndex.bySlug(request.params.slug)

    if (!post) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Nenhum post encontrado com o endereço "${request.params.slug}".`,
        },
      })
    }

    reply.header('cache-control', CACHE_POST)
    return post
  })

  done()
}
