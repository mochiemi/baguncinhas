/**
 * Reconstrói a URL que o Fastify deve enxergar.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 * ---------------------------------------------------------------------------
 * A função do Vercel vive em `api/[...path].ts`, e o nome sugere um pega-tudo.
 * Não é. Fora do Next.js, o Vercel gera essa rota casando **um** segmento:
 *
 *   /api/health        -> chega na função
 *   /api/posts         -> chega na função
 *   /api/posts/test-4  -> 404 do Vercel, sem executar nada nosso
 *   /api/auth/login    -> 404 do Vercel, sem executar nada nosso
 *
 * Como quase toda a API tem dois ou três segmentos, quase nada funcionava em
 * produção — e o login, que é o que destrança o painel, caía justo no lado
 * quebrado.
 *
 * ---------------------------------------------------------------------------
 * A CORREÇÃO
 * ---------------------------------------------------------------------------
 * O `vercel.json` reescreve `/api/*` para a função, carregando o caminho real
 * no parâmetro `rest`. Aqui a URL é remontada antes de ser entregue ao Fastify.
 *
 * Aceitamos DUAS formas de propósito, porque qual delas acontece é um detalhe
 * interno do Vercel que ninguém prometeu:
 *
 *   a) A URL original foi preservada: `/api/posts/test-4`. Nada a fazer.
 *   b) A URL virou o destino da reescrita, e o caminho real veio no `rest`:
 *      `/api/[...path]?rest=posts/test-4`.
 *
 * Aceitar as duas custa poucas linhas e poupa uma rodada inteira de
 * "sobe, testa, descobre, sobe de novo" para responder uma dúvida de plataforma.
 */

/** O caminho do arquivo de função, que é o destino da reescrita. */
const DESTINO_DA_REESCRITA = '/api/[...path]'

/**
 * O nome do parâmetro que o `vercel.json` injeta com o caminho real.
 * É nosso, não do Vercel: por isso some daqui antes de chegar ao Fastify.
 */
const PARAMETRO_DO_CAMINHO = 'rest'

export function resolveRequestUrl(rawUrl: string | undefined): string {
  const url = new URL(rawUrl ?? '/', 'http://bff.interno')

  const veioDoDestino =
    url.pathname === DESTINO_DA_REESCRITA ||
    url.pathname === `${DESTINO_DA_REESCRITA}/`

  const caminhoReal = url.searchParams.get(PARAMETRO_DO_CAMINHO)

  if (caminhoReal !== null && veioDoDestino) {
    // A barra inicial é do parâmetro, não do caminho: `/api` + `posts` já basta.
    url.pathname = `/api/${caminhoReal.replace(/^\/+/, '')}`
  }

  /**
   * O parâmetro tem que sair.
   *
   * Se ficasse, viraria parâmetro de consulta em toda rota — e a busca, que usa
   * `?q=`, não deve receber visita extra. Também evita que alguém de fora mande
   * `?rest=` numa URL de verdade e consiga mexer no caminho.
   */
  url.searchParams.delete(PARAMETRO_DO_CAMINHO)

  return `${url.pathname}${url.search}`
}
