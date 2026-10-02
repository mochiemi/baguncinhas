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

/**
 * Explica a falha em vez de devolver um 500 mudo.
 *
 * A mensagem vai na resposta em QUALQUER caso, e o motivo merece ser dito porque
 * eu errei nisso: na primeira versão eu só mostrava o detalhe quando o erro era o
 * meu de configuração, e escondia o resto atrás de um "veja o log". O resultado
 * foi um 503 genérico que não dizia nada — exatamente o problema que este
 * tratador existe para resolver.
 *
 * O que tornou a decisão fácil foi perceber o contexto: isto é uma falha de
 * INICIALIZAÇÃO. Acontece antes de qualquer requisição ser processada, então não
 * existe dado de requisição para vazar. O que aparece são nomes de variável,
 * caminhos de arquivo e motivos de recusa do Node — nada que sirva a quem não
 * deveria ver.
 *
 * A trilha completa, com a pilha, continua indo para o log.
 */
function fail(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)

  console.error('[bff] falha ao iniciar:', error)

  response.statusCode = 503
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(
    `O BFF não conseguiu iniciar.\n\n${message}\n\n` +
      'Nenhum valor de variável aparece aqui: só nomes, caminhos e motivos.\n' +
      'A trilha completa, com a pilha, está no log da função.\n',
  )
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

