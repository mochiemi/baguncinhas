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
 * AS DEPENDÊNCIAS DE VERDADE FICAM DE FORA, DE PROPÓSITO
 * ---------------------------------------------------------------------------
 * `packages: 'external'` mantém `fastify`, `zod` e `sanitize-html` como imports
 * normais, resolvidos do `node_modules` que o Vercel instala. Elas são rastreadas
 * sem problema; empacotá-las só engordaria o arquivo sem resolver nada.
 *
 * Mas isso cria uma armadilha: `external` trata QUALQUER nome sem barra como
 * pacote de npm, e o `@mochiblog/shared` também tem nome sem barra. Medido antes
 * de escolher: sem o `alias` abaixo, a linha `from "@mochiblog/shared"` continuava
 * no arquivo final e o problema permanecia. Com o alias, ela desaparece.
 *
 * A alternativa seria listar cada dependência em `--external`, o que vira uma
 * lista para esquecer de atualizar a cada dependência nova. O alias é uma linha
 * que resolve exatamente o caso que precisa.
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
  packages: 'external',
  alias: {
    '@mochiblog/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
  },
  sourcemap: false,
  logLevel: 'warning',
})

console.log(`Função gerada: ${outfile}`)
