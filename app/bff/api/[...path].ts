import type { IncomingMessage, ServerResponse } from 'node:http'

import type { FastifyInstance } from 'fastify'

import { resolveRequestUrl } from '../src/lib/request-url.js'

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
 * ---------------------------------------------------------------------------
 * O NOME DESTE ARQUIVO NÃO É UM PEGA-TUDO. ISSO JÁ DERRUBOU QUASE TODA A API.
 * ---------------------------------------------------------------------------
 * A suposição natural — e era o que estava escrito aqui antes — é que
 * `[...path].ts` casa com qualquer caminho abaixo de /api. Não casa. Nesta
 * pasta de funções, fora do Next.js, o Vercel gera a rota casando UM segmento:
 *
 *   /api/health        -> chega aqui
 *   /api/posts         -> chega aqui
 *   /api/posts/test-4  -> 404 do próprio Vercel, sem executar uma linha nossa
 *   /api/auth/login    -> 404 do próprio Vercel, sem executar uma linha nossa
 *
 * O sintoma engana: metade da API funcionava (as rotas de um segmento) e a
 * outra metade devolvia a página de erro do Vercel. O login caía no segundo
 * grupo, então o painel ficou inalcançável em produção enquanto tudo passava
 * nos testes locais.
 *
 * A correção tem duas partes:
 *   1. `vercel.json` reescreve `/api/*` para este arquivo, mandando o caminho
 *      real no parâmetro `rest`.
 *   2. `resolveRequestUrl` recomõe a URL a partir daí antes de entregar ao
 *      Fastify.
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
  // Antes de qualquer coisa: o Fastify tem que enxergar o caminho REAL.
  // O porquê está inteiro em `src/lib/request-url.ts`.
  request.url = resolveRequestUrl(request.url)

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

