import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import { BloggerError } from './blogger/client.js'
import { WriteAuthError, WriteNotConfiguredError } from './blogger/oauth.js'
import { authConfig, env } from './env.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { googleConnectRoutes } from './routes/google-connect.js'
import { healthRoutes } from './routes/health.js'
import { labelsRoutes } from './routes/labels.js'
import { postsRoutes } from './routes/posts.js'

export interface BuildAppOptions {
  /** Desliga o log. Útil em teste, onde o ruído atrapalha. */
  logger?: boolean
}

/**
 * Monta a aplicação Fastify.
 *
 * Está separada do arquivo que sobe o servidor de propósito: em teste, dá para
 * instanciar o app e usar `app.inject()` sem abrir porta nenhuma. Um único
 * arquivo que faz as duas coisas é o motivo mais comum de "não dá para testar
 * isso".
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : env.NODE_ENV === 'production'
          ? { level: env.LOG_LEVEL }
          : {
              level: env.LOG_LEVEL,
              // pino-pretty só em desenvolvimento: ele abre uma thread extra,
              // o que é desperdício (e às vezes problema) em serverless.
              transport: {
                target: 'pino-pretty',
                options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
              },
            },
    // Necessário atrás de proxy (Vercel, Cloudflare). Sem isso, o Fastify
    // enxerga o IP do proxy em vez do IP do leitor.
    trustProxy: true,
  })

  /**
   * Leitura e escrita de cookies. Necessário para a sessão do painel.
   *
   * Registrado sempre, mesmo com a autenticação desligada: assim quem liga a
   * autenticação depois não precisa lembrar de vir aqui.
   */
  void app.register(cookie)

  /**
   * Limitador de tentativas.
   *
   * `global: false` é a parte importante: sem isso, o limite valeria para TODAS
   * as rotas, e os leitores do blog começariam a receber 429 ao navegar rápido.
   * O limite é aplicado rota a rota, e só o login precisa dele.
   */
  void app.register(rateLimit, {
    global: false,
    /**
     * Mensagem do limite em português e no nosso formato de erro.
     *
     * Detalhe que me custou uma depuração: o plugin LANÇA o que esta função
     * devolve. Então o retorno precisa ser um `Error` com `statusCode` — devolver
     * um objeto simples faz o erro chegar sem status, e aí qualquer tratador
     * genérico responde 500 em vez de 429.
     *
     * O `context.statusCode` é usado em vez de fixar 429 porque o plugin também
     * usa este caminho para banimento, e nesse caso ele manda 403.
     *
     * Não uso o `context.after` pronto porque ele vem em inglês ("1 minute").
     */
    errorResponseBuilder: (_request, context) => {
      const seconds = Math.max(1, Math.ceil(context.ttl / 1000))
      const when = seconds === 1 ? '1 segundo' : `${seconds} segundos`

      const error = new Error(
        `Muitas tentativas em pouco tempo. Tente de novo em ${when}.`,
      ) as Error & { statusCode: number }
      error.statusCode = context.statusCode

      return error
    },
  })

  /**
   * CORS é registrado SOMENTE se CORS_ORIGINS estiver preenchido.
   *
   * O caminho normal do projeto não precisa de CORS nenhum: o front conversa
   * com este BFF através de um proxy do próprio front, então para o navegador
   * tudo é same-origin e não existe preflight para responder.
   *
   * Deixar o CORS desligado por padrão é mais seguro do que abrir `origin: true`
   * "para funcionar". Um BFF que aceita qualquer origem é um BFF que qualquer
   * site consegue usar como intermediário.
   */
  if (env.CORS_ORIGINS.length > 0) {
    void app.register(cors, {
      origin: env.CORS_ORIGINS,
      methods: ['GET', 'HEAD', 'OPTIONS'],
      maxAge: 86400,
    })
  }

  /**
   * Formato de erro único para toda a API: `{ error: { code, message } }`.
   *
   * Vantagem de centralizar: o front escreve o tratamento de erro uma vez só.
   * Sem isso, cada rota inventa um formato e o cliente vira uma colcha de
   * retalhos de `if`.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      // Parâmetro inválido é erro do cliente, não nosso.
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        },
      })
    }

    if (error instanceof BloggerError) {
      /**
       * Sempre 502, nunca o status que o Google devolveu.
       *
       * O 400 do Blogger quer dizer "sua chave está errada"; repassá-lo faria o
       * navegador (e quem estiver depurando) procurar o problema no lugar
       * errado. O status original vai para o log, onde é útil.
       */
      request.log.error(
        { err: error, upstreamStatus: error.upstreamStatus },
        'Falha ao consultar a API do Blogger',
      )
      return reply.status(502).send({
        error: { code: 'UPSTREAM_ERROR', message: error.message },
      })
    }

    if (error instanceof WriteNotConfiguredError) {
      /**
       * 503, e não 500: o serviço está no ar e saudável, apenas não recebeu a
       * permissão de escrita. A mensagem diz exatamente quais variáveis faltam.
       */
      request.log.warn({ err: error }, 'Escrita pedida sem a permissão do Google configurada')
      return reply.status(503).send({
        error: { code: 'WRITE_NOT_CONFIGURED', message: error.message },
      })
    }

    if (error instanceof WriteAuthError) {
      request.log.error({ err: error }, 'O Google recusou a autorização de escrita')
      return reply.status(502).send({
        error: { code: 'UPSTREAM_ERROR', message: error.message },
      })
    }

    /**
     * Erros que o próprio Fastify ou um plugin geram: corpo JSON inválido,
     * payload grande demais, tipo de conteúdo não aceito, limite de tentativas.
     *
     * Todos já chegam com um `statusCode` correto, e achatá-los em 500 seria
     * duplamente ruim: jogaria a culpa no servidor e esconderia de quem depura a
     * causa real. Foi exatamente o que aconteceu aqui: o limite de tentativas
     * respondia 500 em vez de 429.
     *
     * Restrito à faixa 4xx de propósito. Um 5xx vindo de plugin continua caindo
     * no tratamento genérico abaixo, porque aí a mensagem original pode conter
     * detalhe interno que não deve sair na resposta.
     */
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 400 && statusCode < 500) {
      request.log.warn({ err: error, statusCode }, 'Requisição recusada')
      return reply.status(statusCode).send({
        error: {
          code: statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST',
          message: error.message,
        },
      })
    }

    request.log.error({ err: error }, 'Erro não tratado');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL',
        message: 'Erro interno no serviço de conteúdo.',
      },
    })
  })

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `A rota ${request.method} ${request.url} não existe nesta API.`,
      },
    })
  })

  /**
   * Todas as rotas vivem sob /api.
   *
   * Isso deixa a URL do BFF idêntica à URL que o front chama (/api/posts nos
   * dois lados), o que elimina toda uma categoria de confusão na hora de
   * depurar: se funciona no navegador, funciona no servidor, com o mesmo
   * caminho.
   */
  void app.register(
    async (api) => {
      await api.register(postsRoutes)
      await api.register(labelsRoutes)
      await api.register(healthRoutes)

      /**
       * As rotas de login e de escrita só existem se o bloco de autenticação
       * estiver configurado no ambiente.
       *
       * Registro condicional, e não um 401: rota que não existe não pode ser
       * atacada. Enquanto ninguém configurar a autenticação, a superfície de
       * escrita simplesmente não está lá.
       */
      if (authConfig.enabled) {
        await api.register(authRoutes)
        await api.register(adminRoutes)
        /**
         * A autorização do Google exige sessão, então vem junto com o login.
         * Mas ela funciona mesmo sem `GOOGLE_REFRESH_TOKEN` configurado: é
         * justamente esse fluxo que produz o token.
         */
        await api.register(googleConnectRoutes)
      } else {
        app.log.warn(
          { faltando: authConfig.missing },
          'Autenticação desligada: as rotas de login e de escrita NÃO foram registradas. O site segue funcionando como leitura.',
        )
      }
    },
    { prefix: '/api' },
  )

  return app
}
