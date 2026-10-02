/**
 * O mínimo que este projeto usa de uma resposta HTTP.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO USAR O `Response` GLOBAL
 * ---------------------------------------------------------------------------
 * Com `lib: ["ES2023"]` e `types: ["node"]`, o nome `Response` não aponta para
 * nada que a gente tenha declarado: ele vem de um malabarismo do próprio
 * `@types/node`, que decide entre o `Response` do DOM e o do `undici-types`
 * conforme o ambiente de tipos enxergado.
 *
 * Localmente resolve certo. No build do Vercel, o MESMO código, com o mesmo
 * `tsc`, a mesma versão e o mesmo `pnpm-lock.yaml`, falhou assim:
 *
 *   src/blogger/client.ts(77,17): error TS2339: Property 'ok' does not exist on
 *   type 'Response'
 *
 * E o mesmo para `status` e `json` — os três membros mais básicos de uma
 * resposta. Um `Response` sem eles não existe em biblioteca nenhuma: é um tipo
 * que não conseguiu ser resolvido, e o TypeScript o apresenta pelo nome.
 *
 * A conclusão prática é que um build não pode depender de como cada máquina
 * resolve esses nomes globais. Declarar o que a gente usa tira o problema da
 * mesa: `ok`, `status` e `json()` são tudo o que este projeto pede de uma
 * resposta, e isso não muda com o ambiente.
 */
export interface HttpResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/**
 * Converte o retorno do `fetch` para o formato acima.
 *
 * A conversão existe porque o tipo real do `fetch` depende do ambiente (veja
 * acima), e ela é segura por construção: tanto o `undici` quanto o navegador
 * devolvem objetos com esses três membros, e é só isso que a gente lê.
 *
 * Recebe `unknown` de propósito, para não depender do tipo que o ambiente
 * atribui ao `fetch`.
 */
export function asHttpResponse(value: unknown): HttpResponse {
  return value as HttpResponse
}
