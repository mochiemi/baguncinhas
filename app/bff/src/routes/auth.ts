import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getSession, requireSession } from '../auth/guard.js'
import { verifyPassword } from '../auth/password.js'
import {
  SESSION_COOKIE,
  createSession,
  sealSession,
  sessionCookieOptions,
} from '../auth/session.js'
import { authConfig } from '../env.js'
import { fold } from '../lib/text.js'

const loginSchema = z.object({
  user: z.string().trim().min(1, 'Informe o usuário.'),
  password: z.string().min(1, 'Informe a senha.'),
})

/**
 * Rotas de entrada do painel.
 *
 * Este arquivo só é registrado quando o bloco de autenticação está completo no
 * ambiente. Sem configuração, estas rotas não existem.
 */
export function authRoutes(app: FastifyInstance, _options: unknown, done: () => void): void {
  if (!authConfig.enabled) {
    // Defensivo: quem registra confere antes, mas se alguém registrar sem
    // configurar, é melhor falhar na inicialização do que servir uma rota que
    // aceitaria qualquer senha.
    throw new Error('authRoutes foi registrado sem a autenticação configurada.')
  }

  const { user: adminUser, passwordHash } = authConfig

  app.post(
    '/auth/login',
    {
      /**
       * Limite de tentativas.
       *
       * Sem isto, uma senha de 12 caracteres cai por força bruta em horas. Com
       * cinco tentativas por minuto por IP, o mesmo ataque leva séculos.
       *
       * O limite é por rota e não global: os endpoints de leitura precisam
       * continuar livres para os leitores do blog.
       */
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { user, password } = loginSchema.parse(request.body)

      /**
       * As duas verificações SEMPRE rodam, e o resultado só é combinado no fim.
       *
       * Se a gente saísse mais cedo quando o usuário não confere, o tempo de
       * resposta diria qual das duas informações estava certa — e aí metade do
       * segredo vaza de graça. Do jeito de baixo, errar o usuário e errar a
       * senha custam o mesmo tempo.
       */
      const userMatches = fold(user) === fold(adminUser)
      const passwordMatches = await verifyPassword(password, passwordHash)

      if (!userMatches || !passwordMatches) {
        request.log.warn({ ip: request.ip }, 'Tentativa de login recusada')
        return reply.status(401).send({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Usuário ou senha incorretos.',
          },
        })
      }

      reply.setCookie(SESSION_COOKIE, sealSession(createSession(adminUser)), sessionCookieOptions())

      request.log.info({ ip: request.ip }, 'Login aceito')
      return { authenticated: true, user: adminUser }
    },
  )

  /**
   * Consulta se a sessão está viva. A interface usa isto para decidir se mostra
   * o painel ou a tela de entrada.
   *
   * Não leva `requireSession` porque "não estou logado" é uma resposta válida, e
   * não um erro. Devolver 401 aqui obrigaria a interface a tratar exceção para
   * um caso perfeitamente normal.
   */
  app.get('/auth/me', async (request) => {
    const session = getSession(request)
    if (!session) return { authenticated: false, user: null }

    return { authenticated: true, user: session.user }
  })

  /**
   * Sair.
   *
   * Passa pelo `requireSession` para aproveitar a checagem de origem: sem ela,
   * um site malicioso conseguiria deslogar a autora à força. É incômodo menor,
   * mas não custa nada bloquear.
   *
   * Como a sessão mora no cookie, sair é só apagar o cookie. Não há nada no
   * servidor para limpar.
   */
  app.post('/auth/logout', { preHandler: requireSession }, async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/api' })
    return { authenticated: false }
  })

  done()
}
