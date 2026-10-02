import type { IncomingMessage, ServerResponse } from 'node:http'

import { buildApp } from '../src/app.js'

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
 * Detalhe que vale ouro: `app` fica no escopo do módulo, FORA do handler. O
 * Vercel reaproveita a instância enquanto o contêiner estiver quente, então o
 * índice de posts sobrevive entre invocações. Se o `buildApp()` estivesse
 * dentro do handler, cada requisição varreria o blog inteiro de novo e a quota
 * da API acabaria em minutos.
 *
 * O nome do arquivo `[...path].ts` é uma rota "pega-tudo" do Vercel: qualquer
 * caminho sob /api cai aqui, preservando a URL original em `req.url`. É isso
 * que permite o Fastify rotear normalmente.
 */
const app = buildApp()

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await app.ready()
  app.server.emit('request', request, response)
}
