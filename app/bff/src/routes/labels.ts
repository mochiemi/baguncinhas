import type { FastifyInstance } from 'fastify'

import { CACHE_LABELS } from '../lib/cache-headers.js'
import { postIndex } from '../services/post-index.js'

/**
 * Lista de categorias com contagem.
 *
 * Detalhe importante: a API v3 do Blogger NÃO tem endpoint de rótulos. A v2
 * tinha. Na v3, os rótulos só existem dentro de cada post, no campo `labels`.
 *
 * Isso seria um problema se estivéssemos chamando a API a cada visita: para
 * montar o menu de categorias seria preciso baixar todos os posts. Como já
 * mantemos o índice completo em memória, a lista de categorias sai de graça.
 * É um bom exemplo de decisão de arquitetura pagando dividendos mais adiante.
 */
export function labelsRoutes(app: FastifyInstance, _options: unknown, done: () => void): void {
  app.get('/labels', async (_request, reply) => {
    const labels = await postIndex.labels()

    reply.header('cache-control', CACHE_LABELS)
    return labels
  })

  done()
}
