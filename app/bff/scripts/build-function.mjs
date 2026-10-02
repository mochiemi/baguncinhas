/**
 * Gera a função serverless que o Vercel publica.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE PASSO EXISTE
 * ---------------------------------------------------------------------------
 * O Vercel empacota a função a partir dos arquivos que consegue ALCANÇAR a partir
 * da entrada, e só dentro da Root Directory do projeto (`app/bff`). O
 * `@mochiblog/shared` mora em `packages/shared`, fora dessa raiz, e é
 * distribuído como TypeScript, sem etapa de build. Duas consequências, e as duas
 * quebram o deploy:
 *
 *   1. o arquivo não entra no pacote da função;
 *   2. mesmo se entrasse, é `.ts`, e o Node não carrega `.ts`.
 *
 * O sintoma era `Cannot find module '.../@mochiblog/shared/src/index.ts'` na
 * inicialização, que virava 500 em toda rota, sem corpo e sem pista.
 *
 * Empacotando aqui, o código compartilhado é INLINADO, e não sobra nenhuma
 * resolução de módulo em tempo de execução.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TUDO É EMPACOTADO, INCLUSIVE AS DEPENDÊNCIAS
 * ---------------------------------------------------------------------------
 * A primeira versão deixava as dependências de fora (`packages: 'external'`),
 * que é o padrão em projetos Node. Não serviu aqui: o Vercel publicou a função e
 * ela morreu com `FUNCTION_INVOCATION_FAILED`, antes de qualquer código nosso
 * rodar. O indício é que os `import` de `zod`, `fastify` e afins ficavam
 * espalhados no meio do arquivo gerado, e não no topo.
 *
 * Empacotando TUDO, sobram apenas imports de `node:crypto`, que é embutido do
 * próprio Node. Não existe mais nada para resolver em tempo de execução, então
 * a classe inteira de problema "não achou o módulo" deixa de existir.
 *
 * O preço é o tamanho: cerca de 2 MB. Irrelevante para o limite do Vercel.
 *
 * ⚠️ Empacotar tem uma armadilha que vale conhecer: o `pino` resolve o NOME do
 * transporte de log em tempo de execução, e um bundle não tem como garantir
 * isso. Por isso o `buildApp` cai num log simples se o transporte falhar —
 * empacotamento não pode derrubar a API por causa de log colorido.
 *
 * ---------------------------------------------------------------------------
 * O ARQUIVO GERADO NÃO VAI PARA O GIT
 * ---------------------------------------------------------------------------
 * `api/[...path].js` é ignorado pelo `.gitignore` e reconstruído a cada build.
 * Guardar uma cópia no repositório criaria a pior falha possível: alguém edita
 * `src/`, esquece de reconstruir, e o site publicado serve código velho em
 * silêncio.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../..')

const outfile = resolve(packageRoot, 'api/[...path].js')

await build({
  entryPoints: [resolve(packageRoot, 'src/vercel-handler.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: {
    '@mochiblog/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
  },
  sourcemap: false,
  logLevel: 'warning',
})

console.log(`Função gerada: ${outfile}`)
