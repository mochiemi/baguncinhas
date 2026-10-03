import type { FastifyInstance } from 'fastify'

import { CACHE_NONE } from '../lib/cache-headers.js'
import { postIndex } from '../services/post-index.js'

/**
 * Endpoint de saúde.
 *
 * Regra que este endpoint segue: NÃO faz trabalho pesado. Ele só relata o
 * estado do índice. Se ele disparasse uma varredura, um monitor externo
 * chamando de minuto em minuto consumiria mais quota do que os leitores.
 *
 * O campo `ageMs` é o mais útil na prática: se ele cresce sem parar, a
 * atualização parou de funcionar e `lastError` diz por quê.
 */
export function healthRoutes(app: FastifyInstance, _options: unknown, done: () => void): void {
  app.get('/health', async (_request, reply) => {
    const index = postIndex.status()

    reply.header('cache-control', CACHE_NONE)

    return {
      status: index.loaded ? 'ok' : 'warming',
      uptimeSeconds: Math.round(process.uptime()),
      index,
    }
  })

  done()
}
