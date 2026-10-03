import { buildApp } from './app.js'
import { env } from './env.js'
import { postIndex } from './services/post-index.js'

const app = buildApp()

try {
  await app.listen({ port: env.PORT, host: env.HOST })
} catch (error) {
  app.log.error(error, 'Não foi possível subir o servidor')
  process.exit(1)
}

/**
 * Aquecimento do índice em segundo plano.
 *
 * Sem isso, a primeira visita depois de subir o servidor paga a varredura
 * completa do blog e fica esperando. Disparando agora, quando o primeiro leitor
 * chegar o índice já está quente.
 *
 * O `catch` é obrigatório: uma Promise rejeitada sem tratamento derruba o
 * processo no Node, e um blog fora do ar por causa de aquecimento seria um
 * péssimo negócio.
 */
if (env.NODE_ENV !== 'test') {
  postIndex
    .get()
    .then((posts) => {
      app.log.info({ posts: posts.length }, 'Índice de posts aquecido')
    })
    .catch((error: unknown) => {
      // Não é fatal: a próxima requisição tenta de novo. Só avisamos.
      app.log.warn({ err: error }, 'Aquecimento do índice falhou; tentaremos sob demanda')
    })
}

/**
 * Encerramento gracioso.
 *
 * Em um contêiner, o orquestrador manda SIGTERM e espera alguns segundos antes
 * de matar à força. Aproveitar essa janela evita cortar uma resposta no meio.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`Recebido ${signal}, encerrando...`)
    void app.close().then(() => process.exit(0))
  })
}
