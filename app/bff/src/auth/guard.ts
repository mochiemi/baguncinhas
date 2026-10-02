import type { FastifyReply, FastifyRequest } from 'fastify'

import { env } from '../env.js'
import { SESSION_COOKIE, unsealSession, type SessionPayload } from './session.js'

/**
 * Lê a sessão da requisição. Devolve `null` se não houver, se estiver vencida ou
 * se o cookie tiver sido adulterado.
 */
export function getSession(request: FastifyRequest): SessionPayload | null {
  const raw = request.cookies?.[SESSION_COOKIE]
  if (!raw) return null
  return unsealSession(raw)
}

/**
 * Compara origens ignorando barra final.
 *
 * `https://site.com` e `https://site.com/` são a mesma origem, mas como texto
 * são diferentes. Sem normalizar, uma barra a mais no `.env` bloquearia tudo.
 */
function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value
  }
}

/**
 * A requisição veio do próprio site?
 *
 * Isto é a defesa contra CSRF: outro site consegue fazer o navegador da vítima
 * enviar uma requisição para cá, mas não consegue falsificar o cabeçalho
 * `Origin` — é o navegador que preenche.
 *
 * Ausência de `Origin` é permitida de propósito. Navegador manda esse cabeçalho
 * em requisições que mudam estado; `curl` e chamadas entre serviços, não. E sem
 * navegador não existe CSRF, porque não há vítima para ser enganada. Isso também
 * é o que deixa os testes por linha de comando funcionarem.
 */
function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin
  if (!origin) return true

  return normalizeOrigin(origin) === normalizeOrigin(env.SITE_ORIGIN)
}

/**
 * Porteiro das rotas protegidas. Usar como `preHandler`.
 *
 * O detalhe que faz isso valer: quando um `preHandler` responde, o Fastify
 * interrompe a corrente e o handler da rota NÃO roda. É por isso que a
 * verificação aqui é suficiente — não existe caminho em que a rota execute sem
 * passar por esta função.
 *
 * Vale repetir o princípio, porque é o que responde à sua preocupação: esconder
 * o botão na interface não protege nada. O que protege é o servidor recusar
 * toda requisição sem sessão válida, venha ela de onde vier.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!getSession(request)) {
    await reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Faça login para continuar.',
      },
    })
    return
  }

  if (!isSameOrigin(request)) {
    await reply.status(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'Requisição recusada: a origem não confere com o site.',
      },
    })
  }
}
