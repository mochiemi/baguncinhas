import type { IncomingMessage, ServerResponse } from 'node:http'

import type { FastifyInstance } from 'fastify'

/**
 * Adaptador para função serverless do Vercel.
 *
 * Por que este arquivo existe se já temos `src/server.ts`?
 * São dois modelos de execução diferentes:
 *   - `src/server.ts` abre uma porta e fica escutando. É o que usamos local e em
 *     qualquer hospedagem de contêiner.
 *   - Aqui não existe porta: o Vercel entrega um par requisição/resposta pronto
 *     e espera que a gente escreva nele.
 *
 * O Fastify só precisa do evento `request` para executar todo o pipeline dele.
 * É essa linha que faz um servidor HTTP virar uma função.
 *
 * O nome do arquivo `[...path].ts` é uma rota "pega-tudo" do Vercel: qualquer
 * caminho sob /api cai aqui, preservando a URL original em `req.url`. É isso
 * que permite o Fastify rotear normalmente.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O IMPORT É DINÂMICO, E POR QUE ISSO IMPORTA
 * ---------------------------------------------------------------------------
 * A versão anterior fazia `import { buildApp }` no topo e `const app =
 * buildApp()`. Era mais simples, e tinha um defeito grave: `src/env.ts` valida o
 * ambiente e LANÇA se algo estiver errado, e ele é importado no topo do
 * `app.ts`. Com o import estático, a exceção acontecia durante a avaliação deste
 * módulo, antes de qualquer código nosso rodar. Não havia onde pegar.
 *
 * O resultado era o pior erro possível de depurar: `500
 * FUNCTION_INVOCATION_FAILED` em toda rota, inclusive numa que não existe,
 * corpo vazio, e a explicação morando num log que a gente tinha que ir caçar.
 * Custou várias rodadas de tentativa e erro.
 *
 * Com o import dinâmico, a falha vira uma exceção que dá para tratar, e o
 * serviço consegue DIZER o que está errado. A instância continua sendo criada
 * uma vez por contêiner quente e guardada em `appPromise`, então o índice de
 * posts continua sobrevivendo entre invocações — que era o motivo de o `app`
 * estar fora do handler.
 */
let appPromise: Promise<FastifyInstance> | null = null

function getApp(): Promise<FastifyInstance> {
  appPromise ??= import('../src/app.js').then((module) => module.buildApp())
  return appPromise
}

/** A mensagem que o `env.ts` produz quando a configuração não fecha. */
const ENV_ERROR_PREFIX = 'Configuração inválida do ambiente'

/**
 * Explica a falha em vez de devolver um 500 mudo.
 *
 * O que sai na resposta é só o essencial, e só quando o erro é o nosso: a
 * mensagem do `env.ts` lista NOMES de variável e o motivo, nunca valores. É
 * informação de operação, não segredo, e o serviço está fora do ar de qualquer
 * forma.
 *
 * Para qualquer outro erro, a resposta é genérica de propósito: uma exceção
 * inesperada pode carregar token ou URL com credencial dentro, e isso não pode
 * ir para o corpo de uma resposta pública. O detalhe fica no log.
 */
function fail(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const isConfigError = message.startsWith(ENV_ERROR_PREFIX)

  console.error('[bff] falha ao iniciar:', message)

  const body = isConfigError
    ? `O BFF não conseguiu iniciar por causa da configuração do ambiente.\n\n${message}\n\n` +
      'Nenhuma dessas variáveis é segredo: são nomes e o motivo da recusa. ' +
      'Corrija no painel do provedor e publique de novo.\n'
    : 'O BFF não conseguiu iniciar. O motivo está no log da função.\n'

  response.statusCode = 503
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let app: FastifyInstance

  try {
    app = await getApp()
    await app.ready()
  } catch (error) {
    /**
     * Esquece a tentativa que falhou. Sem isto, uma promessa rejeitada ficaria
     * guardada e todo pedido seguinte no mesmo contêiner herdaria a mesma falha,
     * mesmo depois de a causa ter sido corrigida.
     */
    appPromise = null
    fail(response, error)
    return
  }

  app.server.emit('request', request, response)
}

